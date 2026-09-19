// tests/smoke.mjs — 跨平台冒烟测试（Windows / Linux / macOS 通用，纯 Node，零依赖）
//
// 用法：
//   npm start            # 另开一个终端先把服务跑起来
//   node tests/smoke.mjs
//   BASE_URL=http://localhost:3001 node tests/smoke.mjs
//
// 说明：管理员账号密码从 server/.env 读取（读不到就跳过登录相关用例），
//      不会把任何凭据写死在代码里。
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
// 本地自签 HTTPS 实例：Node 默认不信任自签证书，测试里放开校验（只影响测试进程）
if (String(BASE).startsWith('https:')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const ROOT = path.resolve(import.meta.dirname, '..');

/** 用 node:http / node:https 发一次 GET（fetch 不允许设置 If-None-Match、Origin 这类头） */
function httpGet(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${pathname}`);
    // 本地自签 https 实例也要能测（只影响测试进程）
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers,
        ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

/** 读取 server/.env（不存在返回空对象） */
function readEnv() {
  const map = {};
  try {
    const text = fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i === -1) continue;
      map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* 无 .env：使用默认流程 */
  }
  return map;
}

async function req(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, options);
  let json = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { json = await res.json(); } catch { /* ignore */ }
  }
  return { status: res.status, json, headers: res.headers, text: json ? null : await res.text().catch(() => '') };
}

const env = readEnv();
const bypass = env.CAPTCHA_BYPASS_TOKEN || '';
const adminUser = env.ADMIN_USERNAME || 'admin';
const adminPass = env.ADMIN_PASSWORD || '';

console.log('\n=== 原神功能快捷站 · 跨平台冒烟测试 ===');
console.log(`目标: ${BASE}`);
console.log(`平台: ${process.platform} | Node ${process.version}\n`);

// ---------- 1. 服务与安全头 ----------
console.log('[1] 服务存活与安全响应头');
try {
  const health = await req('/health');
  check('GET /health 返回 200', health.status === 200, `HTTP ${health.status}`);
  check('status = ok', health.json?.status === 'ok', JSON.stringify(health.json));
  check('报告数据源模式', ['mock', 'live'].includes(health.json?.mode), health.json?.mode);
} catch (err) {
  check('GET /health 可访问', false, err.message);
  console.log('\n服务未启动？请先运行 npm start\n');
  process.exit(1);
}

const health = await req('/health');
const cspHeader = health.headers.get('content-security-policy') || '';
check('CSP 含 default-src \'self\'', cspHeader.includes("default-src 'self'"));
check('CSP 的图片/媒体允许 http:（自建 http 站点也能用外链图）',
  /img-src[^;]*http:/.test(cspHeader) && /media-src[^;]*http:/.test(cspHeader), cspHeader.slice(0, 140));
check('X-Frame-Options = DENY', health.headers.get('x-frame-options') === 'DENY');
check('X-Content-Type-Options = nosniff', health.headers.get('x-content-type-options') === 'nosniff');

// 回归：站点换成 https（自签证书 / 反代域名）后，浏览器会带 https 的 Origin，
// 白名单只写 http 会把**同源**请求判成跨域 → "验证码加载失败：Failed to fetch"、后台进不去。
// 同源请求必须永远放行（Origin 头在浏览器里是禁设的，所以这里用 node:http 发）
{
  const sameOrigin = await httpGet('/api/config', { Origin: `https://${new URL(BASE).host}` });
  check('同源请求带 https Origin 也放行（换成 https 访问后台不会进不去）',
    sameOrigin.status === 200, `HTTP ${sameOrigin.status}`);
  const crossSite = await httpGet('/api/config', { Origin: 'https://evil.example.com' });
  check('真正的跨站来源仍然被拒（403）', crossSite.status === 403, `HTTP ${crossSite.status}`);
}

// /health 报出的版本要和 package.json 一致：排查"更新了却没生效"时靠它确认跑的是哪一版
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
check('GET /health 返回版本号且与 package.json 一致', health.json?.version === pkgVersion,
  `health=${health.json?.version} package=${pkgVersion}`);

// ---------- 2. 静态资源 ----------
console.log('\n[2] 前端静态资源');
for (const [file, expectType] of [
  ['/', 'text/html'],
  ['/css/main.css', 'text/css'],
  ['/js/main.js', 'javascript'],
  ['/js/vendor/three.module.js', 'javascript'],
]) {
  const res = await fetch(`${BASE}${file}`);
  const type = res.headers.get('content-type') || '';
  check(`${file} 可访问且 MIME 正确`, res.status === 200 && type.includes(expectType), `HTTP ${res.status} ${type}`);
}

// 前端没有构建步骤、文件名不带指纹：长缓存会导致"更新了但页面没变"。
// 这些资源必须每次回服务器校验（no-cache + ETag）
console.log('\n[2.1] 静态资源缓存策略（保证更新即时生效）');
for (const file of ['/js/main.js', '/js/admin.js', '/css/main.css', '/css/animations.css']) {
  const res = await fetch(`${BASE}${file}`);
  const cache = (res.headers.get('cache-control') || '').toLowerCase();
  check(`${file} 不做长缓存（no-cache，带 ETag 校验）`,
    cache.includes('no-cache') && !/max-age=[1-9]/.test(cache), cache || '(无 Cache-Control)');
}
{
  // 条件请求应当拿到 304，说明 no-cache 并不等于"每次都重新下载"。
  // 注意：If-None-Match / If-Modified-Since 属于 fetch 规范的禁用请求头，
  // 用 fetch 发不出去，所以这里直接用 node:http。
  const first = await fetch(`${BASE}/js/main.js`);
  const etag = first.headers.get('etag');
  const second = await httpGet('/js/main.js', { 'If-None-Match': etag || '' });
  const third = await httpGet('/js/main.js', { 'If-Modified-Since': first.headers.get('last-modified') || '' });
  check('带 ETag 的条件请求返回 304（省流量）', Boolean(etag) && second.status === 304, `etag=${etag} HTTP ${second.status}`);
  check('带 Last-Modified 的条件请求也返回 304', third.status === 304, `HTTP ${third.status}`);
}

// ---------- 3. 公开 API ----------
console.log('\n[3] 公开接口');
const config = await req('/api/config');
check('GET /api/config 返回配置', config.status === 200 && Boolean(config.json?.site?.title), `HTTP ${config.status}`);
check('画廊屏数 ≥ 7', (config.json?.hero?.slides?.length || 0) >= 7, `实际 ${config.json?.hero?.slides?.length}`);
check('不含资讯区块（备案合规）', config.json?.news === undefined);
check('快捷入口存在', Array.isArray(config.json?.links?.items), `实际 ${typeof config.json?.links?.items}`);

const fonts = await req('/api/fonts');
check('GET /api/fonts 返回字体清单', fonts.status === 200 && Array.isArray(fonts.json?.fonts), `HTTP ${fonts.status}`);
check('至少发现 1 套架空文字字体', (fonts.json?.fonts?.length || 0) >= 1, `实际 ${fonts.json?.fonts?.length}`);

const monitors = await req('/api/status/monitors');
check('GET /api/status/monitors 返回监控列表', monitors.status === 200 && Array.isArray(monitors.json?.monitors),
  `HTTP ${monitors.status}`);
check('监控数据结构完整', Boolean(monitors.json?.summary && monitors.json?.lastUpdated));

const summary = await req('/api/status/summary');
check('GET /api/status/summary 返回摘要', summary.status === 200 && typeof summary.json?.total === 'number');

const missing = await req('/api/does-not-exist');
check('未知 API 返回 JSON 404', missing.status === 404 && Boolean(missing.json?.error), `HTTP ${missing.status}`);

// ---------- 4. 认证与验证码 ----------
console.log('\n[4] 认证、验证码与权限边界');
const captcha = await req('/api/auth/captcha', { headers: bypass ? { 'X-Captcha-Bypass': bypass } : {} });
check('GET /api/auth/captcha 下发 PNG 验证码', captcha.status === 200 && String(captcha.json?.image || '').startsWith('data:image/png;base64,'),
  `HTTP ${captcha.status}`);
check('验证码答案不随响应泄露', bypass ? Boolean(captcha.json?.code) : captcha.json?.code === undefined,
  bypass ? '（已配旁路令牌，答案按预期返回给测试）' : '未配置旁路却返回了答案');

const noCaptcha = await req('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: adminUser, password: adminPass || 'x' }),
});
check('缺验证码时登录被拒（400）', noCaptcha.status === 400 && noCaptcha.json?.code === 'CAPTCHA_REQUIRED',
  `HTTP ${noCaptcha.status}`);

const unauth = await req('/api/config/theme', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ primaryColor: '#ffffff' }),
});
check('未授权写入配置返回 401', unauth.status === 401, `HTTP ${unauth.status}`);

let token = '';
if (adminPass && bypass) {
  const cap = await req('/api/auth/captcha', { headers: { 'X-Captcha-Bypass': bypass } });
  const login = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUser, password: adminPass, captchaId: cap.json?.id, captchaCode: cap.json?.code }),
  });

  if (login.status === 200 && login.json?.token) {
    check('正确凭据 + 验证码可登录', true);
    token = login.json.token;
  } else {
    console.log(`  [SKIP] 登录用例：server/.env 的密码已失效（HTTP ${login.status}）`);
    console.log('         若在后台「账号与安全」改过密码，凭据存在 DATA_DIR/auth.json，请把新密码写回 .env');
  }

  if (token) {
    const settings = await req('/api/settings/kuma', { headers: { Authorization: `Bearer ${token}` } });
    check('GET /api/settings/kuma 需要管理员且密钥脱敏',
      settings.status === 200 && settings.json?.apiKey === undefined, `HTTP ${settings.status}`);

    const auth = await req('/api/auth/settings', { headers: { Authorization: `Bearer ${token}` } });
    check('账号安全设置可读', auth.status === 200 && typeof auth.json?.captchaEnabled === 'boolean', `HTTP ${auth.status}`);
  }
} else {
  console.log('  [SKIP] 登录相关用例：server/.env 未提供 ADMIN_PASSWORD 或 CAPTCHA_BYPASS_TOKEN');
}

// ---------- 5. SSE ----------
console.log('\n[5] SSE 实时推送');
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(`${BASE}/api/status/events`, { signal: controller.signal });
  const ctype = res.headers.get('content-type') || '';
  check('SSE 返回 text/event-stream', res.status === 200 && ctype.includes('text/event-stream'), `HTTP ${res.status} ${ctype}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotInitial = false;
  while (!gotInitial) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('"monitors"')) gotInitial = true;
  }
  clearTimeout(timer);
  controller.abort();
  check('SSE 推送初始快照', gotInitial);
} catch (err) {
  check('SSE 连接', false, err.message);
}

// ---------- 汇总 ----------
console.log('\n=== 测试结果 ===');
console.log(`  通过: ${pass}`);
console.log(`  失败: ${fail}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log('');
process.exit(fail > 0 ? 1 : 0);
