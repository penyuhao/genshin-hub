// services/kumaRest.js — Uptime Kuma REST 集成
// 关键点：
//  1. /api/status-page/{slug}           → 监控列表（含名称、分组、类型）
//  2. /api/status-page/heartbeat/{slug} → 心跳数组 + uptimeList（24h 可用率）
//  3. 以 monitorID 为键做 merge，输出统一格式（心跳接口不返回监控名称）
//  4. 未配置 KUMA_URL 时自动使用 Mock 数据源
const axios = require('axios');
const { getMockSnapshot } = require('./mockKuma');
const kumaConfig = require('./kumaConfig');

const STATUS_MAP = { 0: 'down', 1: 'up', 2: 'pending', 3: 'maintenance' };

function buildClient(overrides = null) {
  const cfg = overrides || kumaConfig.runtimeCredentials();
  const baseURL = (cfg.url || '').trim();
  if (!baseURL) return null;

  const headers = { 'Content-Type': 'application/json' };
  const auth = {};

  // 推荐方式：API Key 走 Basic Auth（username 留空，password 填 Key）
  if (cfg.apiKey) {
    auth.username = '';
    auth.password = cfg.apiKey;
  } else if (cfg.username && cfg.password) {
    auth.username = cfg.username;
    auth.password = cfg.password;
  }

  return axios.create({
    baseURL,
    timeout: 10000,
    headers,
    auth: Object.keys(auth).length ? auth : undefined,
    validateStatus: (s) => s >= 200 && s < 300,
    maxContentLength: 8 * 1024 * 1024,
  });
}

function isConfigured() {
  return kumaConfig.isConfigured();
}

async function fetchStatusPage(client, slug) {
  const { data } = await client.get(`/api/status-page/${encodeURIComponent(slug)}`);
  return data;
}

async function fetchHeartbeat(client, slug) {
  const { data } = await client.get(`/api/status-page/heartbeat/${encodeURIComponent(slug)}`);
  return data;
}

/** 从 status-page 响应中拍平出监控列表（兼容 publicGroupList / incident 结构） */
function flattenMonitors(statusPage) {
  const groups = Array.isArray(statusPage?.publicGroupList) ? statusPage.publicGroupList : [];
  const out = [];
  for (const group of groups) {
    const list = Array.isArray(group?.monitorList) ? group.monitorList : [];
    for (const m of list) {
      out.push({
        id: m.id,
        name: typeof m.name === 'string' ? m.name : `Monitor #${m.id}`,
        type: m.type || 'http',
        group: group.name || '',
        url: m.url || '',
        description: m.description || '',
      });
    }
  }
  return out;
}

/** 合并真实 Kuma 数据 → 统一格式（与 Mock 输出结构一致） */
async function getLiveSnapshot(overrides = null) {
  const cfg = overrides || kumaConfig.runtimeCredentials();
  const client = buildClient(cfg);
  const slug = (cfg.slug || '').trim();

  if (!client || !slug) throw new Error('Kuma 未配置');

  const [statusPage, heartbeat] = await Promise.all([
    fetchStatusPage(client, slug),
    fetchHeartbeat(client, slug),
  ]);

  const monitors = flattenMonitors(statusPage);
  const heartbeatList = heartbeat?.heartbeatList || {};
  const uptimeList = heartbeat?.uptimeList || {};

  const enriched = monitors.map((monitor) => {
    const beats = Array.isArray(heartbeatList[monitor.id]) ? heartbeatList[monitor.id] : [];
    const last = beats.length ? beats[beats.length - 1] : null;
    const uptime = uptimeList[`${monitor.id}_24`];

    return {
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      group: monitor.group,
      status: last ? STATUS_MAP[last.status] || 'unknown' : 'unknown',
      uptime24h: typeof uptime === 'number' ? Number((uptime * 100).toFixed(2)) : null,
      ping: last && typeof last.ping === 'number' ? last.ping : null,
      lastHeartbeat: last ? last.time : null,
      msg: last?.msg || '',
      // 最近 48 条心跳用于小折线图
      history: beats.slice(-48).map((b) => ({
        time: b.time,
        status: b.status,
        ping: typeof b.ping === 'number' ? b.ping : null,
        msg: b.msg || '',
      })),
    };
  });

  const summary = {
    total: enriched.length,
    up: enriched.filter((m) => m.status === 'up').length,
    down: enriched.filter((m) => m.status === 'down').length,
    pending: enriched.filter((m) => m.status === 'pending').length,
    maintenance: enriched.filter((m) => m.status === 'maintenance').length,
  };

  return {
    monitors: enriched,
    summary,
    lastUpdated: new Date().toISOString(),
    source: 'live',
    stale: false,
    statusPageTitle: statusPage?.config?.title || '',
  };
}

/**
 * 统一入口：真实数据源优先，未配置时返回 Mock
 * @returns {Promise<object>} { monitors, summary, lastUpdated, source, stale }
 */
async function getSnapshot() {
  if (!isConfigured()) {
    return getMockSnapshot();
  }
  return getLiveSnapshot();
}

/**
 * 连接自检：用于 /api/status/connection 与后台「测试连接」
 * @param {object|null} overrides 传入则用该配置测试（不落盘），否则用当前生效配置
 */
async function checkConnection(overrides = null) {
  const configured = overrides ? Boolean(overrides.url && overrides.slug) : isConfigured();

  if (!configured) {
    return {
      ok: true,
      mode: 'mock',
      configured: false,
      message: 'Mock 演示模式：在管理后台「数据源设置」填入 Kuma 地址与状态页 slug 后自动切换真实数据',
    };
  }

  const started = Date.now();
  try {
    const snapshot = await getLiveSnapshot(overrides);
    return {
      ok: true,
      mode: 'live',
      configured: true,
      latency: Date.now() - started,
      monitors: snapshot.monitors.length,
      statusPageTitle: snapshot.statusPageTitle || '',
      message: `Kuma 连接正常（${snapshot.monitors.length} 个监控）`,
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'live',
      configured: true,
      latency: Date.now() - started,
      error: err.response ? `HTTP ${err.response.status}` : err.message,
      message: 'Kuma 连接失败，将回退缓存数据',
    };
  }
}

module.exports = { getSnapshot, getLiveSnapshot, checkConnection, isConfigured };