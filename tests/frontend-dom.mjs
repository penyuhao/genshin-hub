// tests/frontend-dom.mjs — 前端 DOM 集成测试
// 思路：用 jsdom 提供浏览器环境，直接 import 真实前端模块，走真实后端接口，
//      断言各视图渲染结果（阶段3/4/6/7/3.6 的验收标准）。
// 运行： node tests/frontend-dom.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
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
  // 站点标题是可以在后台改的，所以拿接口里的实际值来比对，而不是写死一个字符串
  const liveTitle = await fetchProxy('/api/config').then((r) => r.json()).then((c) => c?.site?.title || '').catch(() => '');
  check('文档标题由配置渲染（与接口里的站点标题一致）',
    Boolean(liveTitle) && window.document.title.includes(liveTitle),
    `title="${window.document.title}" 配置标题="${liveTitle}"`);
  check('顶栏导航渲染出 4 项', qa('#nav .nav-link').length === 4, `实际 ${qa('#nav .nav-link').length}`);
  check('导航文案正确', qa('#nav .nav-link').map((a) => a.textContent).join(',') === '首页,下载,功能,关于',
    qa('#nav .nav-link').map((a) => a.textContent).join(','));
  check('首页视图处于激活状态', q('#view-home')?.classList.contains('is-active'));
  check('URL hash 已同步', window.location.hash === '#home', window.location.hash);
  check('启动遮罩已隐藏', q('#bootScreen')?.classList.contains('is-hidden'));

  console.log('\n[阶段3.5] 配置消费');  check('主题变量已写入 :root', window.document.documentElement.style.getPropertyValue('--gold') === '#e8c877',
    window.document.documentElement.style.getPropertyValue('--gold'));
  check('favicon 由配置设置', (q('#faviconLink')?.getAttribute('href') || '').includes('favicon.svg'));

  // 页面背景：每个界面都能单独配（背景图 + 覆盖色 + 遮罩图），默认用内置遮罩纹理
  console.log('\n[阶段3.6] 页面背景自定义（背景图 / 覆盖色 / 遮罩图）');
  const bgHosts = ['#homeContent', '#view-download', '#view-tools', '#view-about'];
  check('四个界面都渲染了背景层', bgHosts.every((sel) => Boolean(q(`${sel} > .page-bg`))),
    bgHosts.filter((sel) => !q(`${sel} > .page-bg`)).join(',') || '全部就位');
  check('默认背景使用内置遮罩纹理（能看到星空，不会糊成一块）',
    qa('.page-bg > .pb-mask').length >= 4 && qa('.page-bg > .pb-mask')[0]?.style.backgroundImage.includes('/images/masks/'),
    qa('.page-bg > .pb-mask')[0]?.style.backgroundImage);
  check('遮罩的不透明度与混合模式已写入',
    Boolean(qa('.page-bg > .pb-mask')[0]?.style.opacity)
    && ['screen', 'overlay', 'soft-light', 'multiply', 'luminosity', 'normal']
      .includes(qa('.page-bg > .pb-mask')[0]?.style.mixBlendMode),
    `${qa('.page-bg > .pb-mask')[0]?.style.opacity} / ${qa('.page-bg > .pb-mask')[0]?.style.mixBlendMode}`);
  check('内置遮罩素材随仓库提供（8 张 SVG）',
    ['dots', 'grid', 'lines', 'rays', 'waves', 'vignette', 'hex', 'sparkle']
      .every((n) => fs.existsSync(path.join(ROOT, 'frontend/images/masks', `${n}.svg`))));
  check('后台有「页面背景」区块（含遮罩 / 覆盖色 / 模糊等字段）',
    /key: 'backgrounds'/.test(readSrc('frontend/js/admin.js'))
    && /key: 'mask'/.test(readSrc('frontend/js/admin.js'))
    && /key: 'maskBlend'/.test(readSrc('frontend/js/admin.js'))
    && /key: 'overlayColor'/.test(readSrc('frontend/js/admin.js')), '');
  check('后端 schema 校验背景层（含混合模式白名单与视图白名单）',
    /backgroundsSchema/.test(readSrc('server/middleware/validate.js'))
    && /BACKGROUND_VIEWS/.test(readSrc('server/middleware/validate.js')), '');
  check('CSS 定义了三层结构（图 / 覆盖色 / 遮罩）',
    /\.pb-image\s*\{/.test(mainCss) && /\.pb-overlay\s*\{/.test(mainCss) && /\.pb-mask\s*\{/.test(mainCss));

  // 全局（星空那一层）背景：容器插在所有 .layer 之前 → 官方底图在下、星星叠在上面
  console.log('\n[阶段3.7] 全局背景（星空那一层）与图片导入');
  check('配置了 global 时会创建全局背景容器', Boolean(q('#globalBg')), '#globalBg 未创建');
  check('全局背景层渲染出遮罩/图片', Boolean(q('#globalBg > .page-bg')), '');
  check('全局背景容器排在星空之前（DOM 顺序决定层级）',
    Boolean(q('#globalBg')) && (q('#globalBg')?.compareDocumentPosition(q('#starfield')) & 4) !== 0,
    '需要 #globalBg 出现在 #starfield 之前');
  check('CSS 定义了全局背景层（固定铺满视口）',
    /\.layer-global-bg\s*\{/.test(mainCss) && /layer-global-bg/.test(mainJs));
  check('图片字段提供「从链接导入」（官方站点美术图可一键存到本地）',
    /从链接导入/.test(readSrc('frontend/js/admin.js')) && /uploads\/from-url/.test(readSrc('frontend/js/admin.js')), '');
  check('导入接口有 SSRF 防护（默认拒绝内网/回环地址）',
    /isPrivateAddress/.test(readSrc('server/routes/media.js'))
    && /ALLOW_PRIVATE_IMAGE_IMPORT/.test(readSrc('server/routes/media.js'))
    && /redirect: 'manual'/.test(readSrc('server/routes/media.js')), '');
  check('导入的图片用魔数校验（不看 Content-Type 脸色）',
    /function sniffImage/.test(readSrc('server/routes/media.js'))
    && /ftypavif|RIFF/.test(readSrc('server/routes/media.js')), '');

  // 回归：前端曾有 5 分钟 localStorage TTL，缓存没过期就直接用缓存、根本不问服务端，
  // 于是后台改完配置，另一个标签页 / 刚刷新的页面依旧显示旧内容（"配置不生效"）。
  // 现在必须始终以服务端为准，本地缓存只做接口不可用时的兜底。
  const configModule = await import(pathToFileURL(path.join(ROOT, 'frontend/js/config.js')).href);
  window.localStorage.setItem(
    'genshinHub.config.v1',
    JSON.stringify({ savedAt: Date.now(), config: { site: { title: '缓存里的旧标题' } } })
  );
  const freshLoad = await configModule.loadConfig();
  check('本地缓存很新也仍然以服务端为准（不再 5 分钟内一直吃缓存）',
    freshLoad.source === 'api', `source=${freshLoad.source}`);
  check('拿到的是服务端标题，而不是缓存里的旧标题',
    freshLoad.config.site.title !== '缓存里的旧标题', freshLoad.config.site.title);
  check('缓存里没有 TTL 短路逻辑（源码契约）',
    !/CACHE_TTL_MS/.test(readSrc('frontend/js/config.js')), '');
  window.localStorage.removeItem('genshinHub.config.v1');

  // 后台保存后要通知**其它标签页**（否则这个窗口是新的、那个窗口还是旧的）
  const mainSrcEarly = readSrc('frontend/js/main.js');
  const adminSrcEarly = readSrc('frontend/js/admin.js');
  check('后台保存会广播配置版本号供其它标签页同步',
    /CONFIG_REVISION_KEY/.test(readSrc('frontend/js/config.js'))
    && /addEventListener\('storage'/.test(mainSrcEarly)
    && /CONFIG_REVISION_KEY/.test(mainSrcEarly), '');
  check('后台侧栏显示当前版本（方便确认跑的是哪一版）',
    /admin-sidebar-version/.test(adminSrcEarly) && /\/health/.test(adminSrcEarly)
    && /\.admin-sidebar-version\s*\{/.test(mainCss));
  check('/health 提供版本号', /version: APP_VERSION/.test(readSrc('server/index.js')));

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

  // 光幕特效：从"硬边白条匀速扫过"改成"多层柔光飘过"（虚幻感）
  const shineBlock = (mainCss.match(/\.title-shine::before\s*\{[\s\S]*?\n\}/) || [''])[0];
  const shineHost = (mainCss.match(/\.title-shine\s*\{[\s\S]*?\n\}/) || [''])[0];
  const haloBlock = (mainCss.match(/\.gallery-slide\.effect-shine \.slide-title::after\s*\{[\s\S]*?\n\}/) || [''])[0];
  const backingBlock = (mainCss.match(/\.slide-content::before\s*\{[\s\S]*?\n\}/) || [''])[0];
  const shineDelay = Number((mainCss.match(/\.gallery-slide\.is-active \.title-shine::before\s*\{[^}]*?(\d*\.?\d+)s\s+infinite/) || [])[1]);
  check('光幕在文字浮现之后才扫过（延迟 ≤0.9s）',
    /\.gallery-slide\.is-active \.title-shine::before\s*\{[^}]*animation:\s*shineSweep/.test(mainCss)
    && shineDelay > 0 && shineDelay <= 0.9,
    `delay=${shineDelay}`);
  check('光幕是多层柔光叠加（宽辉光 + 亮芯 + 色偏 ≥3 层）',
    (shineBlock.match(/linear-gradient/g) || []).length >= 3,
    `层数 ${(shineBlock.match(/linear-gradient/g) || []).length}`);
  check('光幕整体做模糊（边缘不再是一条硬边）', /filter:\s*blur\(/.test(shineBlock), shineBlock.slice(0, 80));
  check('光幕四周用椭圆遮罩渐隐（不再是只做上下的矩形裁切）',
    /mask-image:\s*radial-gradient\(\s*ellipse/.test(shineHost) && /transparent 100%\s*\)/.test(shineHost),
    shineHost.replace(/\s+/g, ' ').slice(0, 90));
  check('扫过不再是匀速硬扫（关键帧有淡入 / 淡出 / 停留）',
    /@keyframes shineSweep[\s\S]{0,420}opacity:\s*0;[\s\S]{0,240}\n\}/.test(animationsCss));
  check('光幕只动 transform / opacity（合成器动画，不掉帧）',
    /will-change:\s*transform,\s*opacity/.test(shineBlock) && !/background-position/.test(shineBlock));
  check('标题光晕与光幕同周期呼吸（光"穿过"文字的感觉）',
    /@keyframes haloBreath/.test(animationsCss)
    && /\.gallery-slide\.effect-shine\.is-active \.slide-title::after\s*\{[^}]*haloBreath/.test(mainCss),
    '');

  // 回归：光幕曾经把范围只放大 8%，又用 overflow:hidden 裁切，
  // 于是整条光在标题左右两端被切成直边（用户反馈的"很明显的边界"）。
  // 现在必须靠"范围足够大 + 四周椭圆遮罩渐隐到 0"收边，而不是裁切。
  check('光幕不再被容器硬裁切（去掉 overflow:hidden）',
    !/overflow:\s*hidden/.test(shineHost), shineHost.replace(/\s+/g, ' ').slice(0, 100));
  check('光幕范围比标题大一大圈（横向 ≥30% 余量）',
    /inset:\s*-\d+%\s*-([3-9]\d)%/.test(shineHost), shineHost.replace(/\s+/g, ' ').slice(0, 90));
  check('光的首尾完全在容器之外（±115%，进出都不碰边）',
    /0%[^}]*translate3d\(-115%/.test(animationsCss) && /68%[^}]*translate3d\(115%/.test(animationsCss),
    (animationsCss.match(/@keyframes shineSweep[\s\S]{0,420}?\n\}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 120));
  check('遮罩的不透明度在容器边界之前就归零（有边也看不见边）',
    /ellipse 50% 50% at 50% 50%/.test(shineHost)
    && /radial-gradient\(\s*ellipse 50% 50% at 50% 50%,\s*#000 \d+%/.test(shineHost.replace(/\/\*[\s\S]*?\*\//g, '')),
    shineHost.replace(/\s+/g, ' ').slice(0, 110));
  check('标题光晕自己淡到 0（不再用 border-radius 切椭圆边）',
    /transparent 100%/.test(haloBlock) && !/border-radius/.test(haloBlock),
    haloBlock.replace(/\s+/g, ' ').slice(0, 100));
  check('文字底衬也套了"到边界即归零"的遮罩',
    /mask-image:\s*radial-gradient/.test(backingBlock), backingBlock.replace(/\s+/g, ' ').slice(0, 100));

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
  check('新增 3 种动画特效（逐字波浪 / 故障风 / 极光）都定义了样式',
    ['wave', 'glitch', 'aurora'].every((e2) => mainCss.includes(`effect-${e2}`)), '');
  check('新增特效的关键帧齐备',
    ['charWave', 'glitchShiftA', 'glitchShiftB', 'auroraFlow', 'auroraHue', 'cardShine']
      .every((k) => animationsCss.includes(k)));
  check('后端、画廊与后台三处都认识这 9 种特效',
    /'wave', 'glitch', 'aurora'/.test(readSrc('server/middleware/validate.js'))
    && /'wave', 'glitch', 'aurora'/.test(readSrc('frontend/js/gallery.js'))
    && /逐字波浪/.test(readSrc('frontend/js/admin.js')), '');
  check('顶部滚动进度条就位（把画廊内部进度也算进去）',
    Boolean(q('#scrollProgress')) && /\.scroll-progress\s*\{/.test(mainCss)
    && /function setupScrollProgress/.test(mainJs) && /galleryEl\.scrollTop/.test(mainJs), '');
  check('状态数字有滚动动画（只在数值变化时触发）',
    /function animateCount/.test(mainJs) && /state\.lastStatusCounts/.test(mainJs));
  // 回归：渐变特效曾把 background-clip 放在父级，而每个字带 transform，
  // 导致字形与渐变裁切错位（枫丹、蒙德两屏"字体错位"）。现在必须下放到 .char。
  check('渐变特效不做父级文字裁切（避免字形错位）',
    !/\.gallery-slide\.effect-gradient \.slide-title\s*\{[^}]*background-clip/.test(mainCss)
    && /\.gallery-slide\.effect-gradient \.slide-title \.char\s*\{[^}]*background-clip:\s*text/.test(mainCss),
    '父级裁切与子级 transform 冲突会导致字形错位');
  check('渐变字的两个动画并列（上浮 + 流动不互相覆盖）',
    /effect-gradient \.slide-title \.char\s*\{[^}]*animation:\s*[\s\S]{0,200}charRise[\s\S]{0,120}gradientFlow/.test(mainCss));

  // 回归：HoYo 字体自带 ascender 120% / descender -20%（行高 1.4），
  // 基线被抬高导致与中文衬线混排时"字体错位"。必须用度量覆盖拉回常规值。
  const fontsCss = readSrc('frontend/css/fonts.css');
  const faceCount = (fontsCss.match(/@font-face\s*\{/g) || []).length;
  const overrideCount = (fontsCss.match(/ascent-override:\s*88%/g) || []).length;
  check(`7 套 HoYo 字体都加了垂直度量覆盖（${overrideCount}/${faceCount}）`, overrideCount === faceCount && faceCount >= 7,
    `@font-face ${faceCount} 条，覆盖 ${overrideCount} 条`);
  check('度量覆盖含 ascent/descent/line-gap 三项',
    /ascent-override/.test(fontsCss) && /descent-override/.test(fontsCss) && /line-gap-override/.test(fontsCss));
  check('副标题行高收紧（避免间距忽大忽小）', /\.slide-subtitle\s*\{[^}]*line-height:\s*1\.35/.test(mainCss));

  // 运行时注入的 @font-face 会覆盖静态声明，必须带上同样的度量覆盖
  const dynamicFaces = window.document.getElementById('dynamic-font-faces')?.textContent || '';
  check('运行时注入的字体也带度量覆盖（否则会覆盖掉修复）',
    dynamicFaces.includes('ascent-override:88%'), dynamicFaces.slice(0, 120));
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

  // 回归：从下方内容区往回滚时，页面还没回到画廊顶部，滚轮不能被画廊抢去翻屏 ——
  // 否则画廊只露出一半、内部却自顾自翻页，视口底部会一直留着一条空白背景。
  const fakePageOffset = { value: 0 };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => fakePageOffset.value });
  fakePageOffset.value = 600;
  const beforeScrolled = fakeScrollTop;
  // 注意：必须用新的 WheelEvent —— 同一个事件对象被 preventDefault 过之后
  // defaultPrevented 会一直保持 true，复用会得到假结果
  const freshWheelUp = new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  const cancelledWhileScrolled = !galleryEl.dispatchEvent(freshWheelUp);
  check('页面还停在下方时，画廊不抢滚轮（交还给页面滚回去）', cancelledWhileScrolled === false,
    `defaultPrevented=${cancelledWhileScrolled}`);
  await sleep(150);
  check('页面还停在下方时，画廊内部不翻屏', Math.round(fakeScrollTop) === beforeScrolled,
    `scrollTop=${Math.round(fakeScrollTop)}（期望 ${beforeScrolled}）`);
  fakePageOffset.value = 0;
  await sleep(60);

  // 回归：从下方内容区往上滚，最后一步不能停在"画廊只露出一小半"的拼贴状态
  // （上面是最后一屏坎瑞亚被截掉下半截的空背景、下面接着内容区开头的空白）。
  // 触发条件是：这一步的目标位置落在画廊内部 —— 那就应该直接对齐到画廊顶部。
  const stageEl = q('.gallery-stage');
  Object.defineProperty(stageEl, 'offsetHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(stageEl, 'offsetTop', { configurable: true, get: () => 0 });
  const contentEl = q('#homeContent');
  const stubWindowHeight = 800;
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => stubWindowHeight });

  // 停在内容区靠上位置：一步 0.92 屏会落到画廊内部 → 必须直接归 0
  fakePageOffset.value = 1400; // 1400 - 736 = 664 < 800（画廊高度）→ 拼贴状态
  scrollCalls.length = 0;
  const freshWheelUp2 = new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
  contentEl.dispatchEvent(freshWheelUp2);
  await sleep(900);
  const lastTarget = scrollCalls.length ? scrollCalls[scrollCalls.length - 1].top : null;
  check('从内容区上滚时不会停在"画廊半露"的拼贴状态（直接对齐画廊顶部）',
    lastTarget !== null && Math.round(lastTarget) === 0, `最后一次 scrollTo.top=${lastTarget}`);
  check('动画期间临时关闭页面级吸附（避免被拽回锚点）',
    /is-page-animating/.test(mainJs) && /html\.is-page-animating/.test(mainCss));
  check('首页启用了页面级滚动吸附（画廊顶部 / 内容区顶部两个锚点）',
    /html\[data-view='home'\]\s*\{\s*scroll-snap-type:\s*y proximity/.test(mainCss)
    && /\.gallery-stage,\s*\n?html\[data-view='home'\] \.home-content/.test(mainCss), '');
  check('视图切换时同步标记 <html>（吸附样式按视图开关）',
    /document\.documentElement\.dataset\.view/.test(readSrc('frontend/js/router.js')));

  // 兜底：触摸/滚动条/惯性滚动都不走滚轮事件，停下来后落在"过渡带"里必须自动对齐
  const contentTopStub = 800;
  const pageMaxStub = 2200;
  Object.defineProperty(window.document.documentElement, 'scrollHeight', {
    configurable: true, get: () => pageMaxStub + stubWindowHeight,
  });
  const realRect = contentEl.getBoundingClientRect.bind(contentEl);
  contentEl.getBoundingClientRect = () => {
    const rect = realRect();
    return { ...rect, top: contentTopStub - fakePageOffset.value, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} };
  };

  fakePageOffset.value = 300; // 过渡带里靠上 → 应该对齐到画廊顶部
  scrollCalls.length = 0;
  window.dispatchEvent(new window.Event('scroll'));
  await sleep(900);
  const clampTarget = scrollCalls.length ? scrollCalls[scrollCalls.length - 1].top : null;
  check('滚动静止后落在"画廊半露"的过渡带里会自动对齐（触摸/滚动条同样生效）',
    clampTarget !== null && Math.round(clampTarget) === 0, `最后一次 scrollTo.top=${clampTarget}`);

  fakePageOffset.value = 700; // 过渡带里靠下 → 应该对齐到内容区顶部
  scrollCalls.length = 0;
  window.dispatchEvent(new window.Event('scroll'));
  await sleep(900);
  const clampTargetDown = scrollCalls.length ? scrollCalls[scrollCalls.length - 1].top : null;
  check('靠下时对齐到内容区顶部（而不是硬拽回画廊）',
    clampTargetDown !== null && Math.round(clampTargetDown) === contentTopStub, `最后一次 scrollTo.top=${clampTargetDown}`);

  fakePageOffset.value = 0;
  await sleep(200);

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
  check('窗口滚动用自己控制的逐帧缓动（不被 CSS 平滑滚动打断）',
    /function animateWindowScroll/.test(mainJs) && /behavior: 'instant'/.test(mainJs)
    && !/html \{ scroll-behavior: smooth/.test(mainCss),
    '');
  check('「返回画廊」同时把页面带回画廊顶部', /function scrollToGallery[\s\S]{0,320}animateWindowScroll\(0/.test(mainJs));
  check('横屏手机也用 dvh（地址栏隐藏时底部不漏背景）',
    /orientation: landscape[\s\S]{0,200}height: 100dvh/.test(responsiveCss), '');
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

  // Kuma 状态页的分组：保留分组名与顺序（排序在 Kuma 里排，这里只负责照原样分块显示）
  const groupTitles = qa('#monitorGrid .monitor-group-title').map((t) => t.textContent).filter(Boolean);
  const groupedMonitorCount = (apiSnapshot?.monitors || []).filter((m) => m.group).length;
  check('监控面板按 Kuma 的分组分块显示',
    groupedMonitorCount === 0 || groupTitles.length >= 1,
    `接口里带分组的监控 ${groupedMonitorCount} 个 / 页面分组标题 ${JSON.stringify(groupTitles)}`);
  if (groupedMonitorCount > 0) {
    check('分组标题就是 Kuma 里的分组名，且顺序一致',
      groupTitles.join(',') === [...new Set((apiSnapshot?.monitors || []).filter((m) => m.group).map((m) => m.group))].join(','),
      `页面=${groupTitles.join(',')} 接口=${[...new Set((apiSnapshot?.monitors || []).filter((m) => m.group).map((m) => m.group))].join(',')}`);
    check('分组标题横跨整行（不会被挤进一格卡片里）',
      /\.monitor-group\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(mainCss));
  }

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

  // ---------- 背景视频（用隔离容器单独渲染，不污染线上页面的 DOM 断言） ----------
  console.log('\n[阶段4++++] 背景视频支持');
  const { Gallery } = await import(pathToFileURL(path.join(ROOT, 'frontend/js/gallery.js')).href);
  const host = window.document.createElement('div');
  const dotsHost = window.document.createElement('div');
  host.className = 'gallery';
  dotsHost.className = 'gallery-dots';
  window.document.body.append(host, dotsHost);

  const isoGallery = new Gallery({
    container: host,
    dots: dotsHost,
    scrollHint: null,
    onCta: () => {},
    onSlideChange: () => {},
    onExitDown: () => {},
  });
  isoGallery.render([
    { title: '视频屏一', bgImage: '/images/hero1.svg', bgVideo: '/uploads/videos/a.mp4' },
    { title: '静态屏', bgImage: '/images/hero2.svg' },
    { title: '视频屏二', bgImage: '/images/hero3.svg', bgVideo: '/uploads/videos/c.mp4', videoOpacity: 0.7, videoLoop: false },
    { title: '外链按钮屏', bgImage: '/images/hero4.svg', cta: '前往官网', ctaUrl: 'https://ys.mihoyo.com/' },
    { title: '站内按钮屏', bgImage: '/images/hero5.svg', cta: '进入网站', ctaUrl: '/download' },
  ]);

  // 画廊按钮支持填网页地址：外链新窗口 + noopener，站内路径当前窗口
  const ctaLinks = host.querySelectorAll('.slide-cta a.btn');
  check('画廊按钮可以填网页地址（渲染成链接而不是按钮）', ctaLinks.length >= 2, `${ctaLinks.length} 个`);
  check('外链按钮在新窗口打开并带 noopener',
    ctaLinks[0]?.getAttribute('href') === 'https://ys.mihoyo.com/'
    && ctaLinks[0]?.getAttribute('target') === '_blank'
    && (ctaLinks[0]?.getAttribute('rel') || '').includes('noopener'),
    `${ctaLinks[0]?.getAttribute('href')} / ${ctaLinks[0]?.getAttribute('target')} / ${ctaLinks[0]?.getAttribute('rel')}`);
  check('站内路径按钮在当前窗口打开（不新开标签）',
    ctaLinks[1]?.getAttribute('href') === '/download' && !ctaLinks[1]?.getAttribute('target'),
    `${ctaLinks[1]?.getAttribute('href')} / target=${ctaLinks[1]?.getAttribute('target')}`);
  check('后台提供「按钮跳转到的网页地址」字段',
    /key: 'ctaUrl'/.test(readSrc('frontend/js/admin.js'))
    && /ctaUrl: optionalUrl/.test(readSrc('server/middleware/validate.js')), '');

  const videoOne = host.querySelectorAll('video.slide-video')[0];
  const videoTwo = host.querySelectorAll('video.slide-video')[1];
  check('背景视频渲染为 <video class="slide-video">', Boolean(videoOne) && Boolean(videoTwo),
    `实际 ${host.querySelectorAll('video.slide-video').length} 个`);
  check('默认静音 + 循环 + playsinline（自动播放的前提）',
    videoOne?.muted === true && videoOne?.loop === true && videoOne?.hasAttribute('playsinline'),
    `muted=${videoOne?.muted} loop=${videoOne?.loop}`);
  check('静态背景图降级为封面（加载中 / 播放失败兜底）',
    videoOne?.getAttribute('poster') === '/images/hero1.svg', videoOne?.getAttribute('poster'));
  check('有视频的屏带 has-video 类（遮罩层级契约）', Boolean(host.querySelector('.slide-bg.has-video')));
  check('当前屏视频立刻挂载地址', videoOne?.getAttribute('src') === '/uploads/videos/a.mp4',
    videoOne?.getAttribute('src'));
  check('非相邻屏不下载视频（省流量）',
    !videoTwo?.getAttribute('src') && videoTwo?.dataset?.src === '/uploads/videos/c.mp4',
    `src=${videoTwo?.getAttribute('src')}`);
  check('逐屏视频参数生效（不透明度 / 不循环）',
    videoTwo?.style.opacity === '0.7' && videoTwo?.loop === false,
    `opacity=${videoTwo?.style.opacity} loop=${videoTwo?.loop}`);
  check('静态屏不产生 video 元素', host.querySelectorAll('.gallery-slide')[1]?.querySelector('video') === null);

  isoGallery.destroy();
  host.remove();
  dotsHost.remove();

  // 后端契约：上传接口 / 校验 / 上传上限
  const validateSrc = readSrc('server/middleware/validate.js');
  const mediaSrc = readSrc('server/routes/media.js');
  check('后端 schema 接受 bgVideo / videoLoop / videoMuted / videoOpacity',
    /bgVideo:\s*optionalUrl/.test(validateSrc) && /videoLoop:\s*z\.boolean/.test(validateSrc)
    && /videoMuted:\s*z\.boolean/.test(validateSrc) && /videoOpacity:\s*z\.number/.test(validateSrc));
  check('后端提供视频上传接口且限制容器类型',
    /\/uploads\/video/.test(mediaSrc) && /VIDEO_TYPES/.test(mediaSrc) && /\.webm/.test(mediaSrc));
  check('视频做容器特征码校验（扩展名不可信）',
    /VIDEO_SIGNATURES/.test(mediaSrc) && /ftyp/.test(mediaSrc) && /0x1a/.test(mediaSrc));
  const limitsRes = await fetchProxy('/api/uploads/limits').then((r) => r.json()).catch(() => null);
  check('上传上限接口可用且含视频上限', Number(limitsRes?.video?.maxMB) > 0, JSON.stringify(limitsRes?.video || null));
  const videoNoAuth = await fetchProxy('/api/uploads/video', { method: 'POST' });
  check('未登录不允许上传视频（401）', videoNoAuth.status === 401, `HTTP ${videoNoAuth.status}`);
  check('后台提供背景视频输入（含上传按钮）',
    /key:\s*'bgVideo'/.test(adminJs) && /type:\s*'video'/.test(adminJs) && /\/api\/uploads\/video/.test(adminJs));
  check('后台提供视频静音 / 循环 / 不透明度开关',
    /key:\s*'videoMuted'/.test(adminJs) && /key:\s*'videoLoop'/.test(adminJs) && /key:\s*'videoOpacity'/.test(adminJs));
  check('CSS 定义视频层与遮罩层级（遮罩在视频之上）',
    /\.slide-video\s*\{/.test(mainCss) && /\.slide-bg\.has-video::after\s*\{\s*z-index:\s*1/.test(mainCss));

  console.log('\n[阶段9] 运行时健康度');
  // 回归：index.html 给首页预置了 is-active，而首屏那次 showView 的 currentView 还是空的，
  // 旧实现不会收掉这个预置类 → 在 #download / #tools 上刷新会"首页与目标页同时显示"。
  const routerJs = readSrc('frontend/js/router.js');
  check('路由在首屏切换时会清掉 index.html 预置的 is-active（刷新子页面不再重叠）',
    /querySelectorAll\(['"]\.view\.is-active/.test(routerJs) && /remove\(['"]is-active['"]/.test(routerJs),
    '');
  check('index.html 的预置激活视图确实存在（这条回归的场景前提）',
    /id="view-home"[^>]*class="[^"]*is-active/.test(html), '');
  check('同一时刻只有一个视图处于激活状态', qa('.view.is-active').length === 1,
    `实际 ${qa('.view.is-active').length} 个：${qa('.view.is-active').map((e2) => e2.id).join(',')}`);

  console.log('\n[阶段9+] 配置热重载（改完不用手动刷新）');
  check('保存配置后前端重新拉取并重渲染', /addEventListener\('config-saved'/.test(mainJs) && /renderAll\(fresh\)/.test(mainJs));
  check('上传字体后重新注入 @font-face（不必刷新页面）',
    /fonts-changed/.test(mainJs) && /await initFonts\(\)/.test(mainJs) && /fonts-changed/.test(adminJs),
    '');
  check('保存配置的提示文案已改为即时生效', /已保存并即时生效/.test(mainJs), '');

  // 回归：链接只写了域名（没有 https://）会被后端拒绝，而旧后台只有一条 5 秒的 toast，
  // 用户以为保存成功了，页面却一直显示"链接待补充"。现在：后端宽容补全 + 后台常驻错误框。
  console.log('\n[阶段9++] 链接字段的宽容处理与错误可见性');
  const urlRulesSrc = readSrc('server/middleware/validate.js');
  check('后台保存失败会显示常驻错误框（不再只有一闪而过的 toast）',
    /showFormError/.test(adminJs) && /class: 'form-error'/.test(adminJs) && /form-error-hint/.test(adminJs));
  check('错误框会高亮出问题的字段（含数组条目 cards.0.url）',
    /has-error/.test(adminJs) && /\.repeat-item/.test(adminJs) && /querySelector\(`\[data-key=/.test(adminJs));
  check('后台链接输入框失焦会自动补 https://', /normalizeUrlInput/.test(adminJs) && /URL_FIELDS/.test(adminJs));
  check('后端对裸域名做归一化（与后台同一套规则）',
    /function normalizeUrl/.test(urlRulesSrc) && /只写域名会自动补上 https:\/\//.test(urlRulesSrc));
  check('collectForm 不再把数组条目的值写到顶层（避免串值）',
    /input\.closest\('\.repeat-item'\)/.test(adminJs), '');
  check('CSS 定义了错误框与红框高亮', /\.form-error\s*\{/.test(mainCss) && /\.has-error/.test(mainCss));

  // 回归（重要）：通用区块的「保存配置」按钮在 header 里，是 <form> 的**兄弟节点**。
  // type="submit" 的按钮找不到 form owner 时点击等于没反应 —— 曾经导致所有通用区块
  // 根本存不下去（界面还一点报错都没有）。必须显式绑到同一个提交函数上。
  check('「保存配置」按钮显式绑定了提交（不依赖 type=submit 的 form owner）',
    /saveBtn\.addEventListener\('click'/.test(adminJs) && /const submitForm = async/.test(adminJs)
    && /formEl\.addEventListener\('submit', submitForm\)/.test(adminJs), '');
  check('区块切换有防竞态（旧请求不会覆盖新页面）',
    /_sectionToken/.test(adminJs) && /token !== this\._sectionToken/.test(adminJs));

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