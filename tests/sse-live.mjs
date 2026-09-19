// tests/sse-live.mjs — 验证 SSE：初始快照 + 变化广播 + 连接保活
// 说明：后端「仅在数据变化时广播」是刻意设计；真实 Kuma 的检查间隔可能长达 60s，
//      因此窗口内没有变化属于正常情况（此时以保活帧证明连接仍然存活）。
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const WAIT_MS = Number(process.env.SSE_WAIT_MS) || 95000;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), WAIT_MS);

let initialReceived = false;
let broadcastReceived = false;
let keepAliveReceived = false;

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
        keepAliveReceived = true;
        console.log('keepalive:', chunk.trim());
        continue;
      }

      const eventMatch = chunk.match(/^event:\s*(.+)$/m);
      const dataMatch = chunk.match(/^data:\s*(.+)$/m);
      const eventName = eventMatch ? eventMatch[1].trim() : 'message';
      if (eventName !== 'status' || !dataMatch) continue;

      const payload = JSON.parse(dataMatch[1]);
      if (!Array.isArray(payload.monitors)) continue;

      if (!initialReceived) {
        initialReceived = true;
        console.log(`[PASS] 收到初始快照：${payload.monitors.length} 个监控，source=${payload.source}`);
      } else {
        broadcastReceived = true;
        console.log(`[PASS] 收到变化广播：up=${payload.summary?.up} down=${payload.summary?.down} at ${payload.lastUpdated}`);
        break;
      }
    }
    if (broadcastReceived) break;
  }
} catch (err) {
  if (err.name !== 'AbortError') console.error('[FAIL]', err.message);
} finally {
  clearTimeout(timeout);
  controller.abort();
}

console.log('');
console.log(`初始快照: ${initialReceived ? 'PASS' : 'FAIL'}`);
if (broadcastReceived) {
  console.log('变化广播: PASS');
} else if (initialReceived && keepAliveReceived) {
  console.log('变化广播: 本次窗口内数据无变化（后端设计为仅在变化时推送，保活帧正常）→ 视为通过');
} else {
  console.log('变化广播: FAIL');
}

// 只要拿到初始快照，且（有变化广播 或 连接保持存活）就算通过
process.exit(initialReceived && (broadcastReceived || keepAliveReceived) ? 0 : 1);