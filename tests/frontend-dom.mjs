// tests/frontend-dom.mjs — 前端 DOM 集成测试
// 思路：用 jsdom 提供浏览器环境，直接 import 真实前端模块，走真实后端接口，
//      断言各视图渲染结果（阶段3/4/6/7/3.6 的验收标准）。
// 运行： node tests/frontend-dom.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const ROOT = path.resolve(import.meta.dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('\n=== 前端 DOM 集成测试 ===');
  console.log(`目标: ${BASE}\n`);

  // ---------- 1. 准备 jsdom 环境 ----------
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  check('GET / 返回 HTML 文档', html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'));

  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    // jsdom 不支持 canvas / WebGL，属于预期噪声
    const message = String(err?.message || err);
    if (/Not implemented|Could not parse CSS|getContext/i.test(message)) return;
    consoleErrors.push(message);
  });
  virtualConsole.on('error', (msg) => consoleErrors.push(String(msg)));

  const dom = new JSDOM(html, {
    url: `${BASE}/`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    virtualConsole,
  });

  const { window } = dom;

  // jsdom 缺失的浏览器 API 补齐
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });

  const nativeFetch = globalThis.fetch;

  // 从 server/.env 读取测试凭据（绝不写死在脚本里，避免随仓库泄露）
  const envValues = {};
  try {
    const envText = await import('node:fs').then((fs) =>
      fs.readFileSync(path.join(ROOT, 'server/.env'), 'utf-8')
    );
    for (const line of envText.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      envValues[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  } catch {
    /* .env 不存在时后面的登录用例会给出提示 */
  }

  const bypass = envValues.CAPTCHA_BYPASS_TOKEN || '';
  const adminUser = envValues.ADMIN_USERNAME || 'admin';
  const adminPassword = envValues.ADMIN_PASSWORD || '';

  let lastCaptcha = null;
  const fetchProxy = async (input, init) => {
    const url = typeof input === 'string' ? new URL(input, BASE).href : input;
    const headers = { ...(init?.headers || {}) };
    if (bypass) headers['X-Captcha-Bypass'] = bypass;

    const res = await nativeFetch(url, { ...init, headers });
    if (String(url).includes('/api/auth/captcha')) {
      try {
        lastCaptcha = await res.clone().json();
      } catch {
        /* ignore */
      }
    }
    return res;
  };

  // 暴露为全局（模块内部直接使用裸标识符）
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
  define('fetch', fetchProxy);
  define('Node', window.Node);
  define('Element', window.Element);
  define('HTMLElement', window.HTMLElement);
  define('CustomEvent', window.CustomEvent);
  define('Event', window.Event);
  define('KeyboardEvent', window.KeyboardEvent);
  define('MouseEvent', window.MouseEvent);
  define('FormData', window.FormData || globalThis.FormData);
  define('scrollTo', () => {});

  // 捕获模块内部未处理异常
  const runtimeErrors = [];
  window.addEventListener('error', (event) => runtimeErrors.push(String(event.message || event.error)));
  process.on('unhandledRejection', (reason) => runtimeErrors.push(`unhandledRejection: ${reason}`));

  // ---------- 2. 加载应用 ----------
  const mainUrl = pathToFileURL(path.join(ROOT, 'frontend/js/main.js')).href;
  await import(mainUrl);

  // 等待启动流程（字体 → 配置 → 渲染 → 状态面板请求）
  await sleep(3500);

  const q = (selector) => window.document.querySelector(selector);
  const qa = (selector) => Array.from(window.document.querySelectorAll(selector));

  console.log('[阶段3] SPA 骨架与路由');
  check('文档标题由配置渲染', /原神功能快捷站/.test(window.document.title), window.document.title);
  check('顶栏导航渲染出 4 项', qa('#nav .nav-link').length === 4, `实际 ${qa('#nav .nav-link').length}`);
  check('导航文案正确', qa('#nav .nav-link').map((a) => a.textContent).join(',') === '首页,下载,功能,关于',
    qa('#nav .nav-link').map((a) => a.textContent).join(','));
  check('首页视图处于激活状态', q('#view-home')?.classList.contains('is-active'));
  check('URL hash 已同步', window.location.hash === '#home', window.location.hash);
  check('启动遮罩已隐藏', q('#bootScreen')?.classList.contains('is-hidden'));

  console.log('\n[阶段3.5] 配置消费');
  check('主题变量已写入 :root', window.document.documentElement.style.getPropertyValue('--gold') === '#e8c877',
    window.document.documentElement.style.getPropertyValue('--gold'));
  check('favicon 由配置设置', (q('#faviconLink')?.getAttribute('href') || '').includes('favicon.svg'));

  console.log('\n[阶段4] 首页画廊（七国 + 挪德卡莱 + 坎瑞亚 + 开场 + 角色特写）');
  check('渲染出 11 屏', qa('.gallery-slide').length === 11, `实际 ${qa('.gallery-slide').length}`);
  check('七国全部在列（蒙德/璃月/稻妻/须弥/枫丹/纳塔/至冬）', ['蒙德', '璃月', '稻妻', '须弥', '枫丹', '纳塔', '至冬']
    .every((n) => qa('.gallery-slide').some((s) => s.querySelector('.slide-title')?.textContent.includes(n))),
    qa('.gallery-slide').map((s) => s.querySelector('.slide-title')?.textContent).join('/'));
  check('包含挪德卡莱与坎瑞亚', qa('.gallery-slide').some((s) => s.textContent.includes('挪德卡莱'))
    && qa('.gallery-slide').some((s) => s.textContent.includes('坎瑞亚')));
  check('第 1 屏激活', qa('.gallery-slide')[0]?.classList.contains('is-active'));
  check('标题逐字拆分（.char）', qa('.gallery-slide .slide-title .char').length >= 4,
    `实际 ${qa('.gallery-slide .slide-title .char').length}`);
  check('圆点导航 11 个', qa('#galleryDots .gallery-dot').length === 11, `实际 ${qa('#galleryDots .gallery-dot').length}`);
  check('背景图已绑定', (qa('.gallery-slide .slide-bg')[0]?.style.backgroundImage || '').includes('hero1.svg'),
    qa('.gallery-slide .slide-bg')[0]?.style.backgroundImage);
  check('真实美术素材已接入（哥伦比娅 webp）', qa('.gallery-slide .slide-bg')
    .some((el) => (el.style.backgroundImage || '').includes('colombina-1.webp')),
    qa('.gallery-slide .slide-bg').map((el) => el.style.backgroundImage).filter((v) => v.includes('gallery')).join(' '));
  check('标题应用了架空文字字体类', qa('.gallery-slide .slide-title')[0]?.className.includes('font-'),
    qa('.gallery-slide .slide-title')[0]?.className);
  check('月亮元素存在且可见', q('#moon')?.classList.contains('is-visible'));
  check('最后一屏有「进入网站」按钮', qa('.gallery-slide')[10]?.textContent.includes('进入网站'));

  console.log('\n[阶段4+] 画廊下滑跳转（一步跳到下方服务状态区）');
  const scrollCalls = [];
  const originalScrollTo = window.scrollTo;
  window.scrollTo = (opts) => { scrollCalls.push(opts); };

  const dots = qa('#galleryDots .gallery-dot');
  dots[dots.length - 1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(520);
  check('点击末屏圆点后第 11 屏激活', qa('.gallery-slide')[10]?.classList.contains('is-active'));

  scrollCalls.length = 0;
  q('#gallery').dispatchEvent(new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
  await sleep(150);
  check('末屏继续下滑 → 触发一步跳转', scrollCalls.length >= 1, `实际调用 ${scrollCalls.length} 次`);
  check('跳转为平滑滚动（非逐像素拖动）',
    ['smooth', 'auto'].includes(scrollCalls[0]?.behavior), JSON.stringify(scrollCalls[0]));

  scrollCalls.length = 0;
  q('#scrollHint').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  check('点击 ↓ 服务状态按钮同样跳转', scrollCalls.length >= 1, `实际调用 ${scrollCalls.length} 次`);

  scrollCalls.length = 0;
  q('#homeStatus')?.querySelector('.mini-btn')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  check('「↑ 返回画廊」按钮回到顶部', scrollCalls.some((c) => c.top === 0), JSON.stringify(scrollCalls[0]));

  window.scrollTo = originalScrollTo;

  console.log('\n[阶段4++] 字体接入（HoYo-Glyphs 官方 Release）');
  const fontsRes = await fetchProxy('/api/fonts').then((r) => r.json());
  check('后端发现 7 套架空文字字体', fontsRes.fonts.length === 7, `实际 ${fontsRes.fonts.length}`);
  check('提瓦特文字已登记', fontsRes.fonts.some((f) => f.family === 'Teyvat Black'));
  check('运行时注入的 @font-face 已写入文档', Boolean(window.document.getElementById('dynamic-font-faces')));
  check('静态 @font-face 字体文件可访问', await fetchProxy('/fonts/Teyvat_Black.woff2').then((r) => r.ok));

  console.log('\n[阶段7] 首页下方内容区 / 下载 / 关于');
  check('资讯区已移除（无兑换码/卡池）', qa('.code-card').length === 0 && qa('.news-block').length === 0);
  check('服务状态速览已渲染', /监控总数|所有服务正常|个服务异常|暂无监控项/.test(q('#homeStatus')?.textContent || ''),
    (q('#homeStatus')?.textContent || '').slice(0, 60));
  check('状态速览含返回画廊按钮', q('#homeStatus')?.textContent.includes('返回画廊'));
  check('快捷入口保留外链卡片', qa('#homeLinks .link-card').length >= 3, `实际 ${qa('#homeLinks .link-card').length}`);
  check('外链安全属性（noopener）', qa('#homeLinks .link-card[target="_blank"]')
    .every((a) => (a.getAttribute('rel') || '').includes('noopener')));
  check('下滑跳转锚点存在', Boolean(q('#homeContent')));
  check('下载卡片渲染 4 张', qa('#downloadGrid .download-card').length === 4, `实际 ${qa('#downloadGrid .download-card').length}`);
  check('下载卡片含链接按钮', qa('#downloadGrid .card-action').length === 4);
  check('关于渲染 5 个区块', qa('#aboutContent .about-section').length === 5, `实际 ${qa('#aboutContent .about-section').length}`);
  check('关于正文按段落拆分', qa('#aboutContent .about-section p').length >= 6, `实际 ${qa('#aboutContent .about-section p').length}`);
  check('页脚已渲染', q('#siteFooter') && !q('#siteFooter').hidden);

  console.log('\n[阶段6] 功能视图（Kuma 面板）');
  check('摘要卡片渲染出状态文案', /所有服务正常|个服务异常/.test(q('#summaryCard')?.textContent || ''),
    (q('#summaryCard')?.textContent || '').slice(0, 60));
  check('监控卡片渲染 8 张', qa('#monitorGrid .monitor-card').length === 8, `实际 ${qa('#monitorGrid .monitor-card').length}`);
  check('监控卡片含 24h 可用率', /24h 可用率/.test(q('#monitorGrid .monitor-card')?.textContent || ''));
  check('监控卡片含折线图', qa('#monitorGrid .sparkline').length === 8, `实际 ${qa('#monitorGrid .sparkline').length}`);
  check('连接状态徽标已标注数据源', /演示数据|实时数据|实时推送/.test(q('#connBadge')?.textContent || ''),
    q('#connBadge')?.textContent);
  check('状态链接指向后端转发地址', q('#openKuma')?.getAttribute('href') === '/api/status/open', q('#openKuma')?.getAttribute('href'));
  check('监控卡片状态色块属性正确', ['up', 'down', 'pending', 'maintenance', 'unknown'].includes(
    q('#monitorGrid .monitor-card')?.dataset.status), q('#monitorGrid .monitor-card')?.dataset.status);

  console.log('\n[阶段3.6] 管理后台');
  window.location.hash = '#admin';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(400);

  check('切换到 admin 视图', q('#view-admin')?.classList.contains('is-active'));
  check('未登录时渲染登录表单', Boolean(q('#adminApp .admin-login form')));
  check('登录表单含账号与密码输入', Boolean(q('#adminUser')) && Boolean(q('#adminPass')));
  check('登录表单含图形验证码（防暴力破解）', Boolean(q('#captchaImage')) && Boolean(q('#adminCaptcha')),
    `img=${Boolean(q('#captchaImage'))} input=${Boolean(q('#adminCaptcha'))}`);
  check('验证码图片为 PNG data URI', (q('#captchaImage')?.getAttribute('src') || '').startsWith('data:image/png;base64,'),
    (q('#captchaImage')?.getAttribute('src') || '').slice(0, 30));

  // 触发登录（带上验证码答案；凭据来自 server/.env）
  q('#adminUser').value = adminUser;
  q('#adminPass').value = adminPassword;
  if (!adminPassword) console.warn('  [WARN] 未从 server/.env 读到 ADMIN_PASSWORD，登录用例将失败');
  if (lastCaptcha?.code) q('#adminCaptcha').value = lastCaptcha.code;
  else console.warn('  [WARN] 未取到验证码答案，请确认 server/.env 配置了 CAPTCHA_BYPASS_TOKEN');
  q('#adminApp .admin-login form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(2800);

  check('登录成功后渲染后台骨架', Boolean(q('#adminShell')), (q('#adminApp')?.textContent || '').slice(0, 80));
  const sidebarLinks = qa('.admin-nav-link');
  check('侧栏包含全部配置区块', sidebarLinks.length >= 10, `实际 ${sidebarLinks.length}`);
  check('区块名包含「画廊管理」「主题编辑」',
    sidebarLinks.some((a) => a.textContent.includes('画廊管理')) && sidebarLinks.some((a) => a.textContent.includes('主题编辑')));
  check('默认区块表单已渲染输入框', qa('#adminMain .input, #adminMain .textarea').length >= 3,
    `实际 ${qa('#adminMain .input, #adminMain .textarea').length}`);

  // 切到主题区块：验证颜色选择器（表单渲染器）
  const themeLink = sidebarLinks.find((a) => a.textContent.includes('主题编辑'));
  themeLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(600);
  check('主题区块渲染颜色选择器', qa('#adminMain input[type="color"]').length >= 8,
    `实际 ${qa('#adminMain input[type="color"]').length}`);

  // 切到画廊区块：验证数组编辑器
  const heroLink = qa('.admin-nav-link').find((a) => a.textContent.includes('画廊管理'));
  heroLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(600);
  check('画廊区块渲染 11 个数组条目', qa('#adminMain .repeat-item').length === 11,
    `实际 ${qa('#adminMain .repeat-item').length}`);
  check('数组条目含「新增」按钮', qa('#adminMain .mini-btn').some((b) => b.textContent.includes('新增')));

  // 数据源设置区块
  const kumaLink = qa('.admin-nav-link').find((a) => a.textContent.includes('数据源设置'));
  kumaLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(900);
  check('数据源设置区块渲染 Kuma 表单', qa('#adminMain input.input').length >= 5,
    `实际 ${qa('#adminMain input.input').length}`);
  check('数据源区块含「测试连接」与「保存并热重载」',
    qa('#adminMain button').some((b) => b.textContent.includes('测试连接'))
    && qa('#adminMain button').some((b) => b.textContent.includes('保存并热重载')));
  check('数据源区块显示连接状态', /Mock 演示模式|连接正常|连接失败/.test(q('#adminMain .status-overview')?.textContent || ''),
    (q('#adminMain .status-overview')?.textContent || '').slice(0, 50));

  // 账号与安全区块
  const secLink = qa('.admin-nav-link').find((a) => a.textContent.includes('账号与安全'));
  secLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(800);
  check('账号安全区块含验证码开关', Boolean(q('#adminMain .switch')));
  check('账号安全区块含当前密码/新密码/确认密码', qa('#adminMain input[type="password"]').length >= 3,
    `实际 ${qa('#adminMain input[type="password"]').length}`);
  check('账号安全区块提示验证码状态', /登录图形验证码/.test(q('#adminMain')?.textContent || ''));

  console.log('\n[阶段9] 运行时健康度');
  check('无未捕获运行时异常', runtimeErrors.length === 0, runtimeErrors.slice(0, 3).join(' | '));
  const fatalConsole = consoleErrors.filter((m) => !/favicon|404/i.test(m));
  check('无严重控制台错误', fatalConsole.length === 0, fatalConsole.slice(0, 3).join(' | '));

  console.log('\n=== 测试结果 ===');
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n测试执行异常：', err);
  process.exit(1);
});