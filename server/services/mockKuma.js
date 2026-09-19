// services/mockKuma.js — Mock 数据源
// 用途：KUMA_URL 未配置、或真实 Kuma 不可用且无缓存时的降级演示数据。
// 数据带轻微随机漂移，让前端看起来「活着」，便于完整验收全部视觉与交互。

const MONITOR_DEFS = [
  { id: 1, name: '提瓦特主站', type: 'http', basePing: 42, baseUptime: 99.98 },
  { id: 2, name: '派蒙 API 网关', type: 'http', basePing: 68, baseUptime: 99.92 },
  { id: 3, name: '祈愿记录服务', type: 'http', basePing: 95, baseUptime: 99.75 },
  { id: 4, name: '提瓦特大地图', type: 'http', basePing: 120, baseUptime: 99.4 },
  { id: 5, name: '圣遗物图鉴 CDN', type: 'http', basePing: 33, baseUptime: 99.99 },
  { id: 6, name: '深渊数据统计', type: 'http', basePing: 155, baseUptime: 98.8 },
  { id: 7, name: '米游社数据同步', type: 'http', basePing: 210, baseUptime: 97.6 },
  { id: 8, name: '七圣召唤对战服', type: 'port', basePing: 77, baseUptime: 99.6 },
];

const BEAT_COUNT = 48; // 24h / 每 30 分钟
const BEAT_INTERVAL_MS = 30 * 60 * 1000;

// 每次调用整体的「心情」：偶发一个服务处于降级/异常，制造真实感
let tick = 0;

function jitter(base, ratio = 0.35) {
  const delta = base * ratio;
  return base + (Math.random() * 2 - 1) * delta;
}

function buildHistory(def, forceDown) {
  const now = Date.now();
  const beats = [];
  let downIndex = -1;

  if (forceDown) downIndex = Math.floor(Math.random() * (BEAT_COUNT - 6)) + 3;

  for (let i = BEAT_COUNT - 1; i >= 0; i--) {
    const time = now - i * BEAT_INTERVAL_MS;
    // 绝大多数为 1(up)；状态 2 表示 pending，0 表示 down
    let status = 1;
    if (i <= 1) status = 1; // 最近一小时保持稳定，避免首屏就红
    if (downIndex >= 0 && Math.abs(i - downIndex) <= 1) status = 0;
    if (def.baseUptime < 98.5 && i > 6 && Math.random() < 0.06) status = 2;

    beats.push({
      time,
      status,
      ping: status === 1 ? Math.round(jitter(def.basePing)) : null,
      msg: status === 0 ? '连接超时' : status === 2 ? '等待重试' : 'OK',
    });
  }
  return beats;
}

function computeUptime(beats) {
  const valid = beats.filter((b) => b.status !== 2);
  if (!valid.length) return null;
  return Number(((valid.filter((b) => b.status === 1).length / valid.length) * 100).toFixed(2));
}

/** 生成一次 Mock 快照 */
function getMockSnapshot() {
  tick += 1;

  // 每 5 次「心情」轮换一次异常服务，保证大多数时间是全绿
  const degrade = tick % 5 === 0;
  const degradedId = degrade ? MONITOR_DEFS[(tick * 3) % MONITOR_DEFS.length].id : -1;

  const monitors = MONITOR_DEFS.map((def) => {
    const history = buildHistory(def, def.id === degradedId);
    const last = history[history.length - 1];
    const uptime24h = computeUptime(history);

    const statusMap = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' };

    return {
      id: def.id,
      name: def.name,
      type: def.type,
      status: statusMap[last.status] || 'unknown',
      uptime24h,
      ping: last.ping,
      lastHeartbeat: last.time,
      msg: last.msg,
      history,
    };
  });

  const summary = {
    total: monitors.length,
    up: monitors.filter((m) => m.status === 'up').length,
    down: monitors.filter((m) => m.status === 'down').length,
    pending: monitors.filter((m) => m.status === 'pending').length,
    maintenance: monitors.filter((m) => m.status === 'maintenance').length,
  };

  return {
    monitors,
    summary,
    lastUpdated: new Date().toISOString(),
    source: 'mock',
    stale: false,
  };
}

module.exports = { getMockSnapshot, MONITOR_DEFS };