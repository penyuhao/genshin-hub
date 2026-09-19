// services/statusService.js — 状态数据中枢：缓存 / 降级 / 轮询 / SSE 广播
const cache = require('../cache');
const { getSnapshot, checkConnection } = require('./kumaRest');
const { getMockSnapshot } = require('./mockKuma');
const kumaConfig = require('./kumaConfig');
const sseBus = require('./sseBus');

const FRESH_KEY = 'status:monitors'; // 带 TTL 的新鲜数据
const LAST_GOOD_KEY = 'status:lastGood'; // 无 TTL，用于降级

/** 缓存秒数：后台「数据源设置」可改，改后即时生效 */
function ttl() {
  const value = Number(kumaConfig.get().cacheTtl);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

let pollTimer = null;
let lastSignature = '';
let lastError = null;

/** 变化指纹：只有状态/延迟/可用率变化才推送，避免无意义刷屏 */
function signatureOf(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.monitors)) return '';
  return JSON.stringify({
    s: snapshot.summary,
    m: snapshot.monitors.map((m) => [m.id, m.status, m.ping, m.uptime24h]),
    src: snapshot.source,
  });
}

/** 拉取一次最新数据并写入缓存 */
async function refresh() {
  try {
    const snapshot = await getSnapshot();
    cache.set(FRESH_KEY, snapshot, ttl());
    cache.set(LAST_GOOD_KEY, snapshot, 0); // 永不过期，用于降级
    lastError = null;
    return snapshot;
  } catch (err) {
    lastError = err.message;
    throw err;
  }
}

/**
 * 取状态快照：新鲜缓存 → 实时拉取 → 旧数据(stale) → Mock 兜底
 */
async function getStatus({ force = false } = {}) {
  if (!force) {
    const fresh = cache.get(FRESH_KEY);
    if (fresh) return fresh;
  }

  try {
    return await refresh();
  } catch (err) {
    const lastGood = cache.get(LAST_GOOD_KEY);
    if (lastGood) {
      return { ...lastGood, stale: true, error: lastError, cachedAt: lastGood.lastUpdated };
    }
    // 连旧数据都没有（例如真实 Kuma 配置错误且从未成功）：给出 Mock 兜底并标记
    const mock = getMockSnapshot();
    return { ...mock, stale: true, degraded: true, error: lastError };
  }
}

async function getSummary() {
  const snapshot = await getStatus();
  return {
    ...snapshot.summary,
    lastUpdated: snapshot.lastUpdated,
    stale: Boolean(snapshot.stale),
    source: snapshot.source,
  };
}

async function getHeartbeat(id) {
  const snapshot = await getStatus();
  const monitor = snapshot.monitors.find((m) => m.id === id);
  if (!monitor) return null;
  return {
    id: monitor.id,
    name: monitor.name,
    status: monitor.status,
    uptime24h: monitor.uptime24h,
    ping: monitor.ping,
    history: monitor.history || [],
    stale: Boolean(snapshot.stale),
  };
}

async function getConnectionInfo() {
  const info = await checkConnection();
  const snap = cache.get(FRESH_KEY) || cache.get(LAST_GOOD_KEY);
  return {
    ...info,
    sseClients: sseBus.clientCount(),
    cacheTtl: ttl(),
    lastUpdated: snap ? snap.lastUpdated : null,
    stale: snap ? Boolean(snap.stale) : false,
    lastError,
  };
}

/** 轮询：定时刷新，变化时通过 SSE 广播 */
function startPolling(intervalSec = null) {
  if (pollTimer) clearInterval(pollTimer);
  const requested = Number(intervalSec) || Number(kumaConfig.get().pollInterval) || 30;
  const ms = Math.max(10, requested) * 1000;

  const run = async () => {
    try {
      const snapshot = await getStatus({ force: true });
      const sig = signatureOf(snapshot);
      if (sig && sig !== lastSignature) {
        lastSignature = sig;
        sseBus.broadcast('status', {
          monitors: snapshot.monitors,
          summary: snapshot.summary,
          lastUpdated: snapshot.lastUpdated,
          source: snapshot.source,
          stale: Boolean(snapshot.stale),
        });
      }
    } catch (err) {
      // 失败也推送一次，让前端显示 stale 状态
      sseBus.broadcast('status', {
        error: err.message,
        stale: true,
        lastUpdated: new Date().toISOString(),
      });
    }
  };

  run();
  pollTimer = setInterval(run, ms);
  if (pollTimer.unref) pollTimer.unref();
  return ms;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  getStatus,
  getSummary,
  getHeartbeat,
  getConnectionInfo,
  refresh,
  startPolling,
  stopPolling,
  ttl,
};