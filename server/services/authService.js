// services/authService.js — 管理员凭据与登录安全设置
// 存储： server/data/auth.json（bcrypt 哈希，不进版本库、不进公开配置）
// 回退： 文件不存在时使用 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD(_HASH)
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const AUTH_PATH = path.join(__dirname, '../data/auth.json');

let cache = null;

/** 恒定时间比较，避免时序侧信道 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(AUTH_PATH, 'utf-8');
    cache = JSON.parse(raw);
  } catch {
    cache = { tokenVersion: 1 };
  }
  if (!Number.isInteger(cache.tokenVersion)) cache.tokenVersion = 1;
  return cache;
}

async function persist(data) {
  const tmp = `${AUTH_PATH}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(AUTH_PATH), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, AUTH_PATH);
  cache = data;
  return data;
}

/** 当前生效的账号设置（不含任何密码信息） */
async function getSettings() {
  const data = await ensureLoaded();
  const fallbackUser = process.env.ADMIN_USERNAME || 'admin';
  return {
    username: data.username || fallbackUser,
    captchaEnabled: data.captchaEnabled !== false,
    credentialSource: data.passwordHash
      ? 'file'
      : process.env.ADMIN_PASSWORD_HASH
        ? 'env-hash'
        : 'env-plain',
    updatedAt: data.updatedAt || null,
    tokenVersion: data.tokenVersion || 1,
  };
}

function getTokenVersion() {
  return cache?.tokenVersion || 1;
}

/** 校验账号密码（文件优先，其次 .env） */
async function verifyCredentials(username, password) {
  const data = await ensureLoaded();
  const expectedUser = data.username || process.env.ADMIN_USERNAME || 'admin';
  const userOk = safeEqual(username, expectedUser);

  let passOk = false;
  if (data.passwordHash) {
    passOk = await bcrypt.compare(String(password ?? ''), data.passwordHash).catch(() => false);
  } else if (process.env.ADMIN_PASSWORD_HASH) {
    passOk = await bcrypt.compare(String(password ?? ''), process.env.ADMIN_PASSWORD_HASH).catch(() => false);
  } else if (process.env.ADMIN_PASSWORD) {
    passOk = safeEqual(password, process.env.ADMIN_PASSWORD);
  }

  return userOk && passOk;
}

/**
 * 修改账号 / 密码（必须提供当前密码）
 * 改密后 tokenVersion 自增 → 所有已签发的 JWT 立即失效
 */
async function updateCredentials({ currentPassword, newUsername, newPassword, currentUsername }) {
  const data = await ensureLoaded();
  const settings = await getSettings();

  const ok = await verifyCredentials(currentUsername || settings.username, currentPassword);
  if (!ok) {
    const err = new Error('当前密码不正确');
    err.status = 400;
    throw err;
  }

  const next = { ...data, updatedAt: new Date().toISOString() };

  if (newUsername && newUsername !== settings.username) {
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(newUsername)) {
      const err = new Error('用户名只能包含字母、数字、下划线、点、连字符，长度 3~32');
      err.status = 400;
      throw err;
    }
    next.username = newUsername;
  }

  if (newPassword) {
    if (String(newPassword).length < 8) {
      const err = new Error('新密码至少 8 位');
      err.status = 400;
      throw err;
    }
    next.passwordHash = await bcrypt.hash(String(newPassword), 12);
    next.tokenVersion = (data.tokenVersion || 1) + 1; // 强制所有旧令牌下线
  }

  await persist(next);
  return getSettings();
}

/** 开关图形验证码 */
async function setCaptchaEnabled(enabled) {
  const data = await ensureLoaded();
  await persist({ ...data, captchaEnabled: Boolean(enabled), updatedAt: new Date().toISOString() });
  return getSettings();
}

/** 首次启动时确保 tokenVersion 存在 */
async function ensureStore() {
  const data = await ensureLoaded();
  try {
    await fs.access(AUTH_PATH);
  } catch {
    await persist(data);
  }
  return data;
}

module.exports = {
  AUTH_PATH,
  ensureLoaded,
  ensureStore,
  getSettings,
  getTokenVersion,
  verifyCredentials,
  updateCredentials,
  setCaptchaEnabled,
  safeEqual,
};