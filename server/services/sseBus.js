// services/sseBus.js — SSE 客户端注册表与广播
const clients = new Set();
let keepAliveTimer = null;

const KEEPALIVE_MS = 25000;

function writeEvent(res, event, data) {
  try {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    removeClient(res);
  }
}

/** 注册一个 SSE 连接 */
function addClient(res, initialPayload) {
  clients.add(res);
  res.write(': connected\n\n');
  if (initialPayload) writeEvent(res, 'status', initialPayload);
  ensureKeepAlive();
}

function removeClient(res) {
  clients.delete(res);
  if (clients.size === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

/** 保持连接不被中间层断开 */
function ensureKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        removeClient(res);
      }
    }
  }, KEEPALIVE_MS);
  if (keepAliveTimer.unref) keepAliveTimer.unref();
}

/** 广播给全部客户端 */
function broadcast(event, data) {
  for (const res of [...clients]) writeEvent(res, event, data);
}

function clientCount() {
  return clients.size;
}

/** 进程退出/重启前通知前端重连 */
function closeAll() {
  for (const res of [...clients]) {
    try {
      res.write('event: bye\ndata: {"reason":"server-restart"}\n\n');
      res.end();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

module.exports = { addClient, removeClient, broadcast, clientCount, closeAll };