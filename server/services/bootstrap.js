// services/bootstrap.js — 首次启动自举
//
// 目标：仓库拷到任何机器都能直接 `npm start` 跑起来，不强制先手写 .env。
//   1. JWT_SECRET   ：环境变量优先；否则生成并持久化到 DATA_DIR/secrets.json
//   2. 管理员凭据   ：.env 或 auth.json 任一存在即沿用；
//                     都没有时生成随机强密码，bcrypt 落盘并在控制台打印一次
//   3. 目录自检     ：数据目录不可写时给出明确告警而不是运行时崩溃
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const paths = require('../paths');
const authService = require('./authService');

/** 生成易读但足够强的随机密码：4 组 4 位，去掉易混字符 */
function generateReadablePassword(groups = 4, size = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const chunks = [];
  for (let g = 0; g < groups; g += 1) {
    let chunk = '';
    for (let i = 0; i < size; i += 1) chunk += alphabet[crypto.randomInt(0, alphabet.length)];
    chunks.push(chunk);
  }
  return chunks.join('-');
}

async function loadSecrets() {
  try {
    return JSON.parse(await fs.readFile(paths.SECRETS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveSecrets(data) {
  const tmp = `${paths.SECRETS_PATH}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(paths.SECRETS_PATH), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmp, paths.SECRETS_PATH);
}

/** 确保 JWT 签名密钥可用 */
async function ensureJwtSecret() {
  if ((process.env.JWT_SECRET || '').trim()) {
    return { source: 'env', generated: false };
  }

  const secrets = await loadSecrets();
  if (secrets.jwtSecret) {
    process.env.JWT_SECRET = secrets.jwtSecret;
    return { source: 'file', generated: false };
  }

  const jwtSecret = crypto.randomBytes(48).toString('hex');
  process.env.JWT_SECRET = jwtSecret;
  await saveSecrets({ ...secrets, jwtSecret, createdAt: new Date().toISOString() });
  return { source: 'generated', generated: true, path: paths.SECRETS_PATH };
}

/**
 * 确保存在管理员凭据
 * @returns {{created: boolean, username: string, password?: string, source: string}}
 */
async function ensureAdminCredentials() {
  const hasEnv =
    Boolean((process.env.ADMIN_PASSWORD_HASH || '').trim()) || Boolean((process.env.ADMIN_PASSWORD || '').trim());

  const settings = await authService.getSettings();
  const hasFile = settings.credentialSource === 'file';

  if (hasEnv || hasFile) {
    return { created: false, username: settings.username, source: hasFile ? 'file' : 'env' };
  }

  const username = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const password = generateReadablePassword();
  await authService.setInitialCredentials({ username, password });
  return { created: true, username, password, source: 'generated' };
}

/** 控制台打印首次启动信息（密码只在这里出现一次） */
function printFirstRunNotice({ jwt, admin, dataDirInfo }) {
  if (!jwt.generated && !admin.created) return;

  const line = '─'.repeat(64);
  console.log('');
  console.log(`  ┌${line}┐`);
  console.log('  │  首次启动：已自动完成初始化（无需手写 .env 即可使用）          │');
  console.log(`  ├${line}┤`);

  if (jwt.generated) {
    console.log('  │  • JWT 签名密钥已随机生成并保存到：                            │');
    console.log(`  │      ${path.relative(process.cwd(), jwt.path || paths.SECRETS_PATH).padEnd(56)}│`);
  }

  if (admin.created) {
    console.log('  │  • 管理员账号（请立即登录后台修改密码）：                       │');
    console.log(`  │      用户名：${admin.username.padEnd(48)}│`);
    console.log(`  │      密码　：${String(admin.password).padEnd(48)}│`);
    console.log('  │    修改位置：管理后台 → 账号与安全                              │');
  }

  console.log('  ├' + line + '┤');
  console.log(`  │  数据目录：${String(dataDirInfo).slice(0, 52).padEnd(52)}│`);
  console.log('  │  想固定这些值？在 server/.env 里设置 JWT_SECRET / ADMIN_PASSWORD │');
  console.log(`  └${line}┘`);
  console.log('');
}

module.exports = {
  ensureJwtSecret,
  ensureAdminCredentials,
  printFirstRunNotice,
  generateReadablePassword,
};