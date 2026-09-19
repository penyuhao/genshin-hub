// services/kumaSocket.js — （阶段10 可选）与 Kuma 的 Socket.IO 长连接
// 默认休眠：只有 KUMA_SOCKET_ENABLED=true 且提供了 KUMA_USERNAME/KUMA_PASSWORD 时才启用。
// 未启用时，前端的实时推送由 statusService 的轮询 + SSE 承担。
const sseBus = require('./sseBus');
const kumaConfig = require('./kumaConfig');

let socket = null;
let enabled = false;
let status = { connected: false, lastEvent: null, error: null };

function shouldEnable() {
  const cfg = kumaConfig.runtimeCredentials();
  return Boolean(cfg.socketEnabled && cfg.url && cfg.username && cfg.password);
}

function connectKuma() {
  if (!shouldEnable()) {
    status = { connected: false, lastEvent: null, error: null, disabled: true };
    return { enabled: false };
  }

  let io;
  try {
    ({ io } = require('socket.io-client'));
  } catch (err) {
    status = { connected: false, lastEvent: null, error: 'socket.io-client 未安装' };
    return { enabled: false, error: status.error };
  }

  const cfg = kumaConfig.runtimeCredentials();

  enabled = true;
  socket = io(cfg.url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionAttempts: Infinity,
    timeout: 15000,
  });

  socket.on('connect', () => {
    status.connected = true;
    socket.emit('login', {
      username: cfg.username,
      password: cfg.password,
    });
  });

  socket.on('loginSuccess', () => {
    status.error = null;
    socket.emit('getMonitorList');
  });

  socket.on('loginFailed', () => {
    status.error = 'Kuma Socket 登录失败（用户名/密码或 2FA）';
  });

  // Kuma 的心跳事件名历史上有 heartbeat / heartbeatList 两种
  const forward = (data) => {
    status.lastEvent = new Date().toISOString();
    sseBus.broadcast('heartbeat', data);
  };
  socket.on('heartbeat', forward);
  socket.on('heartbeatList', forward);
  socket.on('monitorList', (data) => sseBus.broadcast('monitorList', data));

  socket.on('disconnect', () => {
    status.connected = false;
  });
  socket.on('connect_error', (err) => {
    status.connected = false;
    status.error = err.message;
  });

  return { enabled: true };
}

function getSocketStatus() {
  return { ...status, enabled };
}

function disconnectKuma() {
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  enabled = false;
  status.connected = false;
}

module.exports = { connectKuma, getSocketStatus, disconnectKuma };