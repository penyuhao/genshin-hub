// tests/admin-save.mjs — 管理后台「点保存 → 真的存下去」的端到端测试
//
// 为什么必须有这个测试：
//   「保存配置」按钮在 header 里，是 <form> 的**兄弟节点**。type="submit" 的按钮
//   只有在能解析出 form owner 时才提交表单，否则点击等于什么都没发生 —— 后台所有用
//   通用表单渲染的区块（站点/画廊/主题/导航/开关/音乐/下载/关于/快捷入口/字体）
//   曾因此完全无法保存，而且界面上一点报错都没有。
//   这个测试真的去点那个按钮，然后检查服务端配置是否变化。
//
// 特点：自带隔离实例（临时 DATA_DIR + 独立端口 + 自写测试凭据），不碰你的真实配置。
// 运行： node tests/admin-save.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM, VirtualConsole } from 'jsdom';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, '.tmp-admin-save-test');
const PORT = Number(process.env.ADMIN_TEST_PORT || 3198);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { username: 'admin', password: 'admin-save-test-pw' };

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 收集未处理的 Promise 异常（前端异步链路出错时会落在这里） */
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(String(reason)));

// ---------- 隔离环境（必须在 require 服务端之前设置） ----------
fs.rmSync(DATA_DIR, { recursive: true, force: true });
Object.assign(process.env, {
  DATA_DIR,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  TRUST_PROXY: 'false',
  RATE_LIMIT_BYPASS_LOOPBACK: 'true',
  KUMA_URL: '',
  KUMA_STATUS_SLUG: '',
  KUMA_API_KEY: '',
  KUMA_USERNAME: '',
  KUMA_PASSWORD: '',
  KUMA_SOCKET_ENABLED: '',
  JWT_SECRET: '',
  ADMIN_PASSWORD: '',
  ADMIN_PASSWORD_HASH: '',
  CAPTCHA_BYPASS_TOKEN: '',
});

const require = createRequire(import.meta.url);
require(path.join(ROOT, 'server', 'index.js'));

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('隔离实例未能在 20 秒内启动');
}

/** 在一个 jsdom 环境里完整启动前端（等价于用户打开 /#admin） */
async function bootFrontend(token) {
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  const noise = [];
  const virtualConsole = new VirtualConsole();
  const warnings = [];
  virtualConsole.on('jsdomError', (err) => {
    const message = String(err?.message || err);
    if (/Not implemented|Could not parse CSS|getContext|WebGL/i.test(message)) return;
    noise.push(message);
  });
  virtualConsole.on('warn', (msg) => warnings.push(`warn: ${msg}`));
  virtualConsole.on('error', (msg) => warnings.push(`error: ${msg}`));
  virtualConsole.on('log', (msg) => warnings.push(`log: ${msg}`));

  const dom = new JSDOM(html, {
    url: `${BASE}/#admin`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole,
  });
  const { window } = dom;

  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });
  window.scrollTo = () => {};

  const nativeFetch = globalThis.fetch;
  const define = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
      globalThis[key] = value;
    }
  };
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('location', window.location);
  define('history', window.history);
  define('localStorage', window.localStorage);
  define('matchMedia', window.matchMedia);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  define('requestAnimationFrame', (cb) => window.requestAnimationFrame(cb));
  define('cancelAnimationFrame', (id) => window.cancelAnimationFrame(id));
  define('fetch', (input, init) => nativeFetch(typeof input === 'string' ? new URL(input, BASE).href : input, init));
  define('Node', window.Node);
  define('Element', window.Element);
  define('HTMLElement', window.HTMLElement);
  define('CustomEvent', window.CustomEvent);
  define('Event', window.Event);
  define('HashChangeEvent', window.HashChangeEvent);
  define('KeyboardEvent', window.KeyboardEvent);
  define('MouseEvent', window.MouseEvent);
  define('FormData', globalThis.FormData);
  define('scrollTo', () => {});

  // 直接塞一个真令牌：跳过登录表单，专注验证"保存"这条链路
  window.localStorage.setItem('genshinHub.adminToken', token);

  await import(`${pathToFileURL(path.join(ROOT, 'frontend/js/main.js')).href}?adminTest=${Date.now()}`);

  for (let i = 0; i < 80; i += 1) {
    if (window.document.querySelector('#bootScreen')?.classList.contains('is-hidden')) break;
    await sleep(200);
  }
  return { window, noise, warnings };
}

const q = (window, sel) => window.document.querySelector(sel);
const qa = (window, sel) => Array.from(window.document.querySelectorAll(sel));

/** 等某个条件成立（默认 6 秒） */
async function waitFor(fn, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) return true;
    await sleep(120);
  }
  return false;
}

async function getConfig() {
  const res = await fetch(`${BASE}/api/config`);
  return res.json();
}

async function main() {
  console.log('\n=== 管理后台保存链路测试（隔离实例 + 真实点击）===');
  console.log(`数据目录: ${DATA_DIR}`);
  console.log(`地址: ${BASE}\n`);

  const health = await waitForHealth();
  check('隔离实例已启动（Mock 模式）', health.status === 'ok' && health.mode === 'mock', JSON.stringify(health));

  const authService = require(path.join(ROOT, 'server', 'services', 'authService.js'));
  await authService.setInitialCredentials(ADMIN);
  await authService.setCaptchaEnabled(false);

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const login = await loginRes.json().catch(() => ({}));
  check('取得管理员令牌', loginRes.status === 200 && typeof login.token === 'string', `HTTP ${loginRes.status}`);
  if (!login.token) throw new Error('登录失败，后续用例无法进行');

  const { window, noise, warnings } = await bootFrontend(login.token);

  const shellReady = await waitFor(() => q(window, '#adminMain') && qa(window, '.admin-nav-link').length >= 10);
  check('后台面板已渲染（令牌有效，直接进入配置界面）', shellReady,
    `nav=${qa(window, '.admin-nav-link').length}`);
  await waitFor(() => /后台版本/.test(q(window, '.admin-sidebar-version')?.textContent || '')
    && !/读取中/.test(q(window, '.admin-sidebar-version')?.textContent || ''), 5000);
  check('侧栏显示当前后台版本', /后台版本 v?\d/.test(q(window, '.admin-sidebar-version')?.textContent || ''),
    q(window, '.admin-sidebar-version')?.textContent);

  // ---------- 1. 站点设置：改标题 → 点「保存配置」 → 服务端必须变 ----------
  console.log('\n[1] 站点设置：点「保存配置」是否真的写进服务端');
  const before = await getConfig();
  const siteLink = qa(window, '.admin-nav-link').find((a) => a.textContent.includes('站点设置'));
  siteLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const titleInputReady = await waitFor(() => Boolean(q(window, '#adminMain .input[data-key="title"]')));
  check('站点设置表单已渲染', titleInputReady);

  const newTitle = `保存链路测试 ${Date.now() % 100000}`;
  const titleInput = q(window, '#adminMain .input[data-key="title"]');
  titleInput.value = newTitle;
  titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));

  const saveBtn = qa(window, '#adminMain .admin-actions button').find((b) => b.textContent.includes('保存配置'));
  check('找到「保存配置」按钮', Boolean(saveBtn));
  saveBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(1500);

  if ((await getConfig()).site.title !== newTitle) {
    console.log('  [debug] 侧栏区块：', qa(window, '.admin-nav-link').map((a) => a.textContent).join(' / '));
    console.log('  [debug] 保存后的错误框：', q(window, '#adminMain .form-error')?.textContent || '(无)');
    console.log('  [debug] 提示条：', q(window, '#toastWrap')?.textContent || '(无)');
    console.log('  [debug] 控制台：', warnings.slice(-6).join(' | ') || '(无)');
  }

  const saved = await waitFor(async () => {
    const cfg = await getConfig();
    return cfg?.site?.title === newTitle;
  }, 8000);
  const after = await getConfig();
  check('点击「保存配置」后服务端配置真的变了', after.site.title === newTitle,
    `服务端标题="${after.site.title}"（期望 "${newTitle}"，原值 "${before.site.title}"）`);
  check('保存过程生成了配置备份（说明请求确实到了服务端）',
    fs.existsSync(path.join(DATA_DIR, 'backups')) &&
      fs.readdirSync(path.join(DATA_DIR, 'backups')).some((f) => f.endsWith('.json')),
    '');
  void saved;

  // ---------- 2. 再存一次（确认按钮不是"只灵一次"） ----------
  // 注意：保存成功后后台会重新渲染整个区块，所以引用必须重新取
  console.log('\n[2] 连续保存第二次');
  const secondTitle = `第二次 ${Date.now() % 100000}`;
  await waitFor(() => Boolean(q(window, '#adminMain .input[data-key="title"]')), 5000);
  const titleInput2 = q(window, '#adminMain .input[data-key="title"]');
  titleInput2.value = secondTitle;
  titleInput2.dispatchEvent(new window.Event('input', { bubbles: true }));
  qa(window, '#adminMain .admin-actions button')
    .find((b) => b.textContent.includes('保存配置'))
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const secondOk = await waitFor(async () => (await getConfig())?.site?.title === secondTitle, 8000);
  check('第二次保存同样生效', secondOk, (await getConfig()).site.title);

  // ---------- 3. 保存失败时要有看得见的错误框 ----------
  console.log('\n[3] 故意存一个非法链接：必须报错且不写入');
  // 上一次保存成功后后台会重新渲染区块，等它彻底稳定再切区块（切换是异步的）
  await sleep(800);
  const linksLink = qa(window, '.admin-nav-link').find((a) => a.textContent.includes('快捷入口'));
  linksLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const linksReady = await waitFor(
    () => (q(window, '#adminMain h2')?.textContent || '').includes('快捷入口')
      && qa(window, '#adminMain .repeat-item').length > 0,
    8000
  );
  const urlInput = q(window, '#adminMain .repeat-item .input[data-key="url"]');
  check('快捷入口条目渲染出链接输入框', linksReady && Boolean(urlInput),
    `当前区块="${q(window, '#adminMain h2')?.textContent}" 高亮=${qa(window, '.admin-nav-link.is-active').map((a) => a.textContent).join('/')} `
    + `条目=${qa(window, '#adminMain .repeat-item').length} 未处理异常=${unhandled.slice(0, 2).join(' | ')}`);
  if (urlInput) {
    const linksBefore = (await getConfig()).links.items.map((i) => i.url);
    urlInput.value = 'javascript:alert(1)';
    urlInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    const saveBtn2 = qa(window, '#adminMain .admin-actions button').find((b) => b.textContent.includes('保存配置'));
    saveBtn2?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    const errorShown = await waitFor(() => Boolean(q(window, '#adminMain .form-error')), 6000);
    check('保存失败会显示常驻错误框', errorShown, q(window, '#adminMain')?.textContent?.slice(0, 80));
    check('出问题的输入框被标红', Boolean(q(window, '#adminMain .has-error')));
    await sleep(400);
    const linksAfter = (await getConfig()).links.items.map((i) => i.url);
    check('非法链接没有被写进配置', JSON.stringify(linksBefore) === JSON.stringify(linksAfter), '');
  }

  check('无运行时报错', noise.length === 0, noise.slice(0, 3).join(' | '));

  console.log('\n=== 测试结果 ===');
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n测试执行异常：', err);
    fail += 1;
  })
  .finally(() => {
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(fail > 0 ? 1 : 0);
  });
