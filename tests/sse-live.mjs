// tests/sse-live.mjs — 验证 SSE 实时推送：初始快照 + 轮询变化后的主动广播
// 运行： node tests/sse-live.mjs   （约需 40 秒）
const BASE = process.env.BASE_URL || 'http://localhost:3001';

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60000);

let initialReceived = false;
let broadcastReceived = false;

try {
  const res = await fetch(`${BASE}/api/status/events`, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });

  console.log('HTTP', res.status, '| Content-Type:', res.headers.get('content-type'));
  if (res.status !== 200) throw new Error('SSE 未返回 200');
  if (!String(res.headers.get('content-type')).includes('text/event-stream')) {
    throw new Error('Content-Type 不是 text/event-stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (chunk.startsWith(':')) {
        console.log('keepalive:', chunk.trim());
        continue;
      }

      const eventMatch = chunk.match(/^event:\s*(.+)$/m);
      const dataMatch = chunk.match(/^data:\s*(.+)$/m);
      const eventName = eventMatch ? eventMatch[1].trim() : 'message';

      if (!initialReceived && eventName === 'status' && dataMatch) {
        const payload = JSON.parse(dataMatch[1]);
        if (Array.isArray(payload.monitors) && payload.monitors.length > 0) {
          initialReceived = true;
          console.log(`[PASS] 收到初始快照：${payload.monitors.length} 个监控，source=${payload.source}`);
        }
      } else if (initialReceived && eventName === 'status' && dataMatch) {
        const payload = JSON.parse(dataMatch[1]);
        if (Array.isArray(payload.monitors)) {
          broadcastReceived = true;
          console.log(`[PASS] 收到变化广播：up=${payload.summary?.up} down=${payload.summary?.down} at ${payload.lastUpdated}`);
          break;
        }
      }
    }
    if (broadcastReceived) break;
  }
} catch (err) {
  if (err.name !== 'AbortError') {
    console.error('[FAIL]', err.message);
  } else {
    console.error('[FAIL] 等待超时');
  }
} finally {
  clearTimeout(timeout);
  controller.abort();
}

console.log('');
console.log(`初始快照: ${initialReceived ? 'PASS' : 'FAIL'}`);
console.log(`变化广播: ${broadcastReceived ? 'PASS' : 'FAIL'}`);
process.exit(initialReceived && broadcastReceived ? 0 : 1);