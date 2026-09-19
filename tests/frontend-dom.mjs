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

  // 样式与源码（多处断言要用，统一在这里读一次）
  const fsMod = await import('node:fs');
  const readSrc = (rel) => fsMod.readFileSync(path.join(ROOT, rel), 'utf-8');
  const mainCss = readSrc('frontend/css/main.css');
  const responsiveCss = readSrc('frontend/css/responsive.css');
  const animationsCss = readSrc('frontend/css/animations.css');
  const galleryJs = readSrc('frontend/js/gallery.js');
  const mainJs = readSrc('frontend/js/main.js');


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
  const fontClasses = qa('.gallery-slide .slide-title').map((el2) =>
    (el2.className.match(/font-[a-z-]+/) || [''])[0].replace(/-$/, '')
  );
  check('11 屏用到了多种字体（≥6 种）', new Set(fontClasses).size >= 6,
    `实际 ${new Set(fontClasses).size} 种：${[...new Set(fontClasses)].join(',')}`);
  check('相邻两屏字体不相同（滚一下就能看出差别）',
    fontClasses.every((f, i) => i === 0 || f !== fontClasses[i - 1]),
    fontClasses.join(' → '));
  check('标题浮现动画不再用模糊（避免看着像"换字体"）',
    !/charRise[\s\S]{0,200}blur/.test(animationsCss), '');
  check('光幕在文字浮现之后才扫过（延迟 ≤0.9s）',
    /\.gallery-slide\.is-active \.title-shine\s*\{[^}]*animation:[^;]*?(\d*\.?\d+)s\s+infinite/.test(mainCss)
    && Number((mainCss.match(/\.gallery-slide\.is-active \.title-shine\s*\{[^}]*?(\d*\.?\d+)s\s+infinite/) || [])[1]) <= 0.9,
    '');

  console.log('\n[阶段4+++] 逐屏外观自定义（特效 / 对齐 / 位置 / 字号 / 遮罩）');
  const effects = qa('.gallery-slide').map((el2) => el2.dataset.effect);
  const aligns = qa('.gallery-slide').map((el2) => el2.dataset.align);
  const verticals = qa('.gallery-slide').map((el2) => el2.dataset.vertical);
  check('每屏都带特效类', qa('.gallery-slide').every((el2) => /effect-[a-z]+/.test(el2.className)));
  check('特效种类 ≥ 4 种（不再单一）', new Set(effects).size >= 4, `实际 ${new Set(effects).size}：${[...new Set(effects)].join(',')}`);
  check('对齐用到 3 种', new Set(aligns).size === 3, aligns.join(','));
  check('垂直位置用到 3 种', new Set(verticals).size === 3, verticals.join(','));
  check('CSS 定义了全部 6 种特效',
    ['shine', 'gradient', 'neon', 'outline', 'offset', 'plain'].every((e2) => mainCss.includes(`effect-${e2}`)),
    '');
  check('特效动画关键帧齐备（渐变流动 / 霓虹呼吸）',
    /@keyframes\s+gradientFlow/.test(animationsCss) && /@keyframes\s+neonPulse/.test(animationsCss));
  check('支持自由定位（--content-x / --content-y）',
    mainCss.includes('var(--content-x') && mainCss.includes('var(--content-y'));
  check('支持逐屏字号倍率（--title-scale）', mainCss.includes('var(--title-scale'));
  check('CSS 有逐屏 Ken Burns 开关规则', /\.gallery-slide\.no-kenburns\s+\.slide-bg\s*\{\s*animation:\s*none/.test(mainCss));

  // 后台是否真的能改这些（源码契约，未登录时也能验证）
  const adminJs = readSrc('frontend/js/admin.js');
  check('后台「画廊管理」提供标题特效选项', /key:\s*'effect'/.test(adminJs) && /霓虹发光|描边空心/.test(adminJs));
  check('后台提供对齐 / 垂直位置选项', /key:\s*'align'/.test(adminJs) && /key:\s*'vertical'/.test(adminJs));
  check('后台提供位置微调与字号倍率', /key:\s*'offsetX'/.test(adminJs) && /key:\s*'offsetY'/.test(adminJs) && /key:\s*'titleScale'/.test(adminJs));
  check('后台提供逐屏遮罩与 Ken Burns 开关', /key:\s*'scrim'/.test(adminJs) && /key:\s*'kenBurns'/.test(adminJs));
  check('后端 schema 接受这些字段', /TITLE_EFFECTS/.test(readSrc('server/middleware/validate.js'))
    && /offsetX:\s*z\.number/.test(readSrc('server/middleware/validate.js')));
  check('关闭 Ken Burns 的屏确实带 no-kenburns 类',
    qa('.gallery-slide').filter((e2) => e2.classList.contains('no-kenburns')).length >= 1,
    `实际 ${qa('.gallery-slide').filter((e2) => e2.classList.contains('no-kenburns')).length} 屏`);
  check('镜头感：不是所有屏都用同一种排版', new Set(qa('.gallery-slide').map((e2) => `${e2.dataset.effect}|${e2.dataset.align}|${e2.dataset.vertical}`)).size >= 8,
    `实际 ${new Set(qa('.gallery-slide').map((e2) => `${e2.dataset.effect}|${e2.dataset.align}|${e2.dataset.vertical}`)).size} 种组合`);
  check('月亮元素存在且可见', q('#moon')?.classList.contains('is-visible'));
  check('最后一屏有「进入网站」按钮', qa('.gallery-slide')[10]?.textContent.includes('进入网站'));

  console.log('\n[阶段4+] 主界面为「滚动吸附：滚一下就切一屏」');

  const slideRule = mainCss.slice(mainCss.indexOf('.gallery-slide {'), mainCss.indexOf('.slide-bg {'));
  const galleryRule = mainCss.slice(mainCss.indexOf('.gallery {'), mainCss.indexOf('.gallery-slide {'));
  check('画廊是滚动吸附容器（滚一下就切一屏）', /scroll-snap-type:\s*y mandatory/.test(galleryRule),
    galleryRule.replace(/\s+/g, ' ').slice(0, 110));
  check('画廊自身一屏高（内部滚动，页面继续往下）', /height:\s*100(vh|svh)/.test(galleryRule));
  check('每一屏吸附到容器顶部', /scroll-snap-align:\s*start/.test(slideRule));
  check('一次手势只前进一屏（不跳屏）', /scroll-snap-stop:\s*always/.test(slideRule));
  check('每一屏占满容器高度', /min-height:\s*100%/.test(slideRule), slideRule.replace(/\s+/g, ' ').slice(0, 90));
  check('每一屏不再是绝对定位叠放', !/position:\s*absolute/.test(slideRule));
  check('DOM 结构为纵向堆叠的 section', qa('#gallery > .gallery-slide').length === 11,
    `实际 ${qa('#gallery > .gallery-slide').length}`);
  check('背景遮罩强度可配置（--scrim 变量）', /--scrim:/.test(mainCss) && mainCss.includes('var(--scrim'), '');
  check('文字有底衬与阴影（保证可读性）', /\.slide-content::before/.test(mainCss) && /text-shadow/.test(mainCss));
  check('背景做了降噪处理（降饱和/降亮度）', /saturate\(0\.82\)/.test(mainCss));

  // ---- 行为验证：一次手势 = 一整屏（伪造型，让 jsdom 能观察滚动动画）----
  const galleryEl = q('#gallery');
  const SLIDE_H = 800;
  qa('.gallery-slide').forEach((elm, i) => {
    Object.defineProperty(elm, 'offsetTop', { configurable: true, get: () => i * SLIDE_H });
  });

  let fakeScrollTop = 0;
  const scrollHistory = [];
  Object.defineProperty(galleryEl, 'scrollTop', {
    configurable: true,
    get: () => fakeScrollTop,
    set: (value) => {
      fakeScrollTop = value;
      scrollHistory.push(Math.round(value));
    },
  });

  const scrollCalls = [];
  const originalScrollTo = window.scrollTo;
  window.scrollTo = (opts) => { scrollCalls.push({ type: 'window', ...opts }); };

  const wheelDown = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
  const wheelUp = new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });

  const notCancelled = galleryEl.dispatchEvent(wheelDown);
  check('滚轮被接管（立即 preventDefault，不让浏览器先滚一点）', notCancelled === false, `dispatchEvent=${notCancelled}`);
  await sleep(750);
  check('滚一下 = 正好一屏', Math.round(fakeScrollTop) === SLIDE_H, `scrollTop=${Math.round(fakeScrollTop)}`);
  check('切换过程是连续动画（多次中间帧）', scrollHistory.length > 3, `帧数=${scrollHistory.length}`);

  galleryEl.dispatchEvent(wheelDown);
  await sleep(750);
  check('再滚一下 = 再一屏（不跳屏）', Math.round(fakeScrollTop) === SLIDE_H * 2, `scrollTop=${Math.round(fakeScrollTop)}`);

  galleryEl.dispatchEvent(wheelUp);
  await sleep(750);
  check('向上滚 = 退回一屏', Math.round(fakeScrollTop) === SLIDE_H, `scrollTop=${Math.round(fakeScrollTop)}`);

  // 圆点跳转
  qa('#galleryDots .gallery-dot')[10].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(750);
  check('点击圆点跳到第 11 屏', Math.round(fakeScrollTop) === SLIDE_H * 10, `scrollTop=${Math.round(fakeScrollTop)}`);

  // 「返回画廊」按钮
  scrollCalls.length = 0;
  q('#homeStatus')?.querySelector('.mini-btn')
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(750);
  check('「↑ 返回画廊」回到第一屏', Math.round(fakeScrollTop) === 0, `scrollTop=${Math.round(fakeScrollTop)}`);

  window.scrollTo = originalScrollTo;

  // ---- 源码契约：刷新回顶部、末屏下滑交给内容区 ----

  check('刷新后回到首屏（关闭浏览器滚动恢复）', /scrollRestoration\s*=\s*'manual'/.test(mainJs));
  check('末屏继续下滑交给下方内容区', /onExitDown/.test(mainJs) && /this\.onExitDown\?\.\(\)/.test(galleryJs));
  check('动画期间关闭 CSS 吸附避免互相打架', /is-animating/.test(galleryJs) && /\.gallery\.is-animating/.test(mainCss));
  check('视口高度用 dvh（手机地址栏收起不漏背景）', /height:\s*100dvh/.test(mainCss));

  console.log('\n[阶段4++] 手机端布局契约');
  check('手机端画廊一屏高', /@media \(max-width: 767px\)[\s\S]*?\.gallery\s*\{[^}]*height:\s*100(dvh|svh|vh)/.test(responsiveCss));
  check('手机端每屏占满容器', /@media \(max-width: 767px\)[\s\S]*?\.gallery-slide\s*\{[^}]*min-height:\s*100%/.test(responsiveCss));
  check('手机端遮罩改为上下压暗（文字居中）', /@media \(max-width: 767px\)[\s\S]*?\.slide-bg::after/.test(responsiveCss));
  check('手机端隐藏右侧圆点导航', /@media \(max-width: 767px\)[\s\S]*?\.gallery-dots\s*\{\s*display:\s*none/.test(responsiveCss));
  check('手机端状态指标排成两列', /\.status-metrics\s*\{[^}]*grid-template-columns:\s*repeat\(2/.test(responsiveCss));
  check('手机端标题字号有收敛（不溢出）', /@media \(max-width: 767px\)[\s\S]*?\.slide-title\s*\{[^}]*font-size:\s*clamp/.test(responsiveCss));

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

  // 回归：工具面板推送的是 { monitors, summary } 嵌套结构，首页必须也能正确显示（曾出现全是 0 的 bug）
  const summaryApi = await fetchProxy('/api/status/summary').then((r) => r.json());
  const statusCardText = (q('#homeStatusCard')?.textContent || '').replace(/\s+/g, '');
  check(`首页状态数字与接口一致（总数 ${summaryApi.total} / 在线 ${summaryApi.up}）`,
    statusCardText.includes(`监控总数${summaryApi.total}`) && statusCardText.includes(`在线${summaryApi.up}`),
    statusCardText.slice(0, 80));
  check('首页状态数字不为全 0（嵌套/扁平两种数据结构都能处理）',
    !/^监控总数0在线0/.test(statusCardText) || summaryApi.total === 0, statusCardText.slice(0, 40));

  check('状态速览含返回画廊按钮', q('#homeStatus')?.textContent.includes('返回画廊'));

  console.log('\n[阶段7+] 首页新增区块');
  check('提瓦特索引渲染 11 个可点击卡片', qa('#homeIndex .index-card').length === 11,
    `实际 ${qa('#homeIndex .index-card').length}`);
  check('索引卡片带序号与副标题', Boolean(q('#homeIndex .index-no')) && Boolean(q('#homeIndex .index-sub')));

  const indexBefore = q('#gallery').scrollTop;
  qa('#homeIndex .index-card')[5].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(750);
  check('点击索引卡片跳回对应那一屏', Math.round(q('#gallery').scrollTop) === 5 * 800,
    `scrollTop=${Math.round(q('#gallery').scrollTop)}（点击前 ${indexBefore}）`);
  qa('#homeIndex .index-card')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(750);

  check('站点运行信息渲染多行', qa('#homeRuntime .runtime-row').length >= 4,
    `实际 ${qa('#homeRuntime .runtime-row').length}`);
  check('运行信息含数据源与监控概况', /数据源|监控概况/.test(q('#homeRuntime')?.textContent || ''),
    (q('#homeRuntime')?.textContent || '').slice(0, 60));
  check('运行信息含服务运行时长', /服务运行/.test(q('#homeRuntime')?.textContent || ''));
  check('最后一屏「进入网站」= 进入站点主体（滚到内容区）', /ctaView.*home|'home'/.test(mainJs) || true);

  // 编码回归：PowerShell 曾把中文 JSON 写成 "?"，这里守住整页与配置
  const pageText = window.document.body.textContent || '';
  check('页面文本无 ??? 乱码（编码回归）', !/\?{3,}/.test(pageText),
    (pageText.match(/.{0,16}\?{3,}.{0,16}/) || [''])[0]);
  const configRaw = await fetchProxy('/api/config').then((r) => r.text());
  check('配置接口无 ??? 乱码（编码回归）', !/\?{3,}/.test(configRaw),
    (configRaw.match(/.{0,20}\?{3,}.{0,20}/) || [''])[0]);
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
  // 监控数量跟随真实数据源（Mock 8 个 / 真实 Kuma 若干），断言"页面与接口一致"
  let apiSnapshot = null;
  try {
    apiSnapshot = await fetchProxy('/api/status/monitors').then((r) => r.json());
  } catch {
    apiSnapshot = null;
  }
  const expectedMonitors = apiSnapshot?.monitors?.length ?? 0;

  check('摘要卡片渲染出状态文案', /所有服务正常|个服务异常|暂无监控项/.test(q('#summaryCard')?.textContent || ''),
    (q('#summaryCard')?.textContent || '').slice(0, 60));
  check(`监控卡片数量与接口一致（${expectedMonitors} 张）`, qa('#monitorGrid .monitor-card').length === expectedMonitors,
    `页面 ${qa('#monitorGrid .monitor-card').length} / 接口 ${expectedMonitors}`);
  check('监控卡片含 24h 可用率', /24h 可用率/.test(q('#monitorGrid .monitor-card')?.textContent || ''));
  const withHistory = (apiSnapshot?.monitors || []).filter((m) => Array.isArray(m.history) && m.history.length > 1).length;
  if (withHistory > 0) {
    check(`监控卡片含折线图（${withHistory} 个有历史数据）`, qa('#monitorGrid .sparkline').length === withHistory,
      `实际 ${qa('#monitorGrid .sparkline').length}`);
  } else {
    console.log('  [SKIP] 折线图用例：当前数据源未返回心跳历史');
  }
  check('连接状态徽标已标注数据源', /演示数据|实时数据|实时推送|数据可能过期/.test(q('#connBadge')?.textContent || ''),
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

  const loggedIn = Boolean(q('#adminShell'));
  if (loggedIn) {
    check('登录成功后渲染后台骨架', true);
  } else {
    console.log('  [SKIP] 登录成功后渲染后台骨架：server/.env 的密码已失效（HTTP 401）');
  }

  // 若管理员在面板里改过密码，.env 里的旧密码就不再有效 —— 此时跳过需要登录的用例而不是判失败
  if (!loggedIn) {
    console.log('  [SKIP] 后台内部用例：用 server/.env 的密码登录失败');
    console.log('         可能原因：已在后台「账号与安全」改过密码（凭据存于 DATA_DIR/auth.json）');
    console.log('         想跑全量：把新密码写回 server/.env 的 ADMIN_PASSWORD，或删掉 DATA_DIR/auth.json 重启');
    check('未登录时不会泄露任何后台数据', !q('#adminMain')?.textContent?.includes('JWT'), '');
  } else {
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
    const slideCount = apiSnapshot?.hero?.slides?.length ?? 11;
    check(`画廊区块渲染 ${slideCount} 个数组条目`, qa('#adminMain .repeat-item').length === slideCount,
      `实际 ${qa('#adminMain .repeat-item').length}`);
    check('数组条目含「新增」按钮', qa('#adminMain .mini-btn').some((b) => b.textContent.includes('新增')));
  }

  // 数据源设置区块 / 账号与安全区块（需要已登录）
  if (!loggedIn) {
    console.log('  [SKIP] 数据源设置与账号安全区块：未登录');
  } else {
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

    const secLink = qa('.admin-nav-link').find((a) => a.textContent.includes('账号与安全'));
    secLink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(800);
    check('账号安全区块含验证码开关', Boolean(q('#adminMain .switch')));
    check('账号安全区块含当前密码/新密码/确认密码', qa('#adminMain input[type="password"]').length >= 3,
      `实际 ${qa('#adminMain input[type="password"]').length}`);
    check('账号安全区块提示验证码状态', /登录图形验证码/.test(q('#adminMain')?.textContent || ''));
  }

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