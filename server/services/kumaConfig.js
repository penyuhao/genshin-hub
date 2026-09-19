// services/kumaConfig.js — 数据源（Uptime Kuma）运行时可配置
// 存储： server/data/kuma.json（不进版本库、不进公开配置 /api/config）
// 优先级：kuma.json 中的非空值 > .env > 内置默认
const fs = require('fs').promises;
const path = require('path');

const KUMA_PATH = path.join(__dirname, '../data/kuma.json');

const DEFAULTS = {
  url: '',
  slug: '',
  apiKey: '',
  username: '',
  password: '',
  socketEnabled: false,
  pollInterval: 30,
  cacheTtl: 30,
};

let cache = null;

function envValue(key) {
  return (process.env[key] || '').trim();
}

/** 合并：文件 > 环境变量 > 默认 */
function merge(fileData = {}) {
  const pick = (fileKey, envKey, fallback) => {
    const fromFile = fileData[fileKey];
    if (fromFile !== undefined && fromFile !== null && String(fromFile).trim() !== '') return fromFile;
    const fromEnv = envKey ? envValue(envKey) : '';
    return fromEnv !== '' ? fromEnv : fallback;
  };

  return {
    url: String(pick('url', 'KUMA_URL', DEFAULTS.url)).replace(/\/+$/, ''),
    slug: String(pick('slug', 'KUMA_STATUS_SLUG', DEFAULTS.slug)),
    apiKey: String(pick('apiKey', 'KUMA_API_KEY', DEFAULTS.apiKey)),
    username: String(pick('username', 'KUMA_USERNAME', DEFAULTS.username)),
    password: String(pick('password', 'KUMA_PASSWORD', DEFAULTS.password)),
    socketEnabled:
      fileData.socketEnabled !== undefined
        ? Boolean(fileData.socketEnabled)
        : String(envValue('KUMA_SOCKET_ENABLED')).toLowerCase() === 'true',
    pollInterval: Number(pick('pollInterval', 'POLL_INTERVAL', DEFAULTS.pollInterval)) || DEFAULTS.pollInterval,
    cacheTtl: Number(pick('cacheTtl', 'CACHE_TTL', DEFAULTS.cacheTtl)) || DEFAULTS.cacheTtl,
    source: fileData.url ? 'panel' : envValue('KUMA_URL') ? 'env' : 'none',
  };
}

async function ensureLoaded() {
  if (cache) return cache;
  let fileData = {};
  try {
    fileData = JSON.parse(await fs.readFile(KUMA_PATH, 'utf-8'));
  } catch {
    fileData = {};
  }
  cache = merge(fileData);
  return cache;
}

/** 同步读取当前生效配置（模块启动后由 ensureLoaded 填充） */
function get() {
  if (!cache) {
    cache = merge({});
  }
  return cache;
}

function isConfigured() {
  const cfg = get();
  return Boolean(cfg.url && cfg.slug);
}

async function persist(patch) {
  let fileData = {};
  try {
    fileData = JSON.parse(await fs.readFile(KUMA_PATH, 'utf-8'));
  } catch {
    fileData = {};
  }

  const next = { ...fileData };
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] === undefined) continue;
    // apiKey/password 传空字符串表示「清空」
    next[key] = typeof patch[key] === 'string' ? patch[key].trim() : patch[key];
  }
  next.updatedAt = new Date().toISOString();

  const tmp = `${KUMA_PATH}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(KUMA_PATH), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  await fs.rename(tmp, KUMA_PATH);

  cache = merge(next);
  return cache;
}

/** 管理后台视图：密钥只回传是否已配置，不回传明文 */
function adminView() {
  const cfg = get();
  return {
    url: cfg.url,
    slug: cfg.slug,
    username: cfg.username,
    hasApiKey: Boolean(cfg.apiKey),
    apiKeyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}••••${cfg.apiKey.slice(-4)}` : '',
    hasPassword: Boolean(cfg.password),
    socketEnabled: cfg.socketEnabled,
    pollInterval: cfg.pollInterval,
    cacheTtl: cfg.cacheTtl,
    configured: isConfigured(),
    source: cfg.source,
    storePath: 'server/data/kuma.json',
  };
}

/** 供 kumaRest / kumaSocket 使用 */
function runtimeCredentials() {
  const cfg = get();
  return {
    url: cfg.url,
    slug: cfg.slug,
    apiKey: cfg.apiKey,
    username: cfg.username,
    password: cfg.password,
    socketEnabled: cfg.socketEnabled,
  };
}

module.exports = {
  KUMA_PATH,
  DEFAULTS,
  ensureLoaded,
  get,
  isConfigured,
  persist,
  adminView,
  runtimeCredentials,
};