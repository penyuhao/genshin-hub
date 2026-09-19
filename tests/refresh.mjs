// tests/refresh.mjs — 「直接刷新在子页面」的路由回归测试
//
// 为什么需要它：
//   index.html 给首页预置了 class="view is-active"（这样无 JS 时也能看到内容），
//   而首屏那次 showView 的 currentView 还是空的。旧实现不会收掉这个预置类，
//   于是刷新在 #download / #tools / #about 时会变成
//   「首页与目标页同时 display:block」—— 页面看起来还是首页，下面又接了一截别的内容。
//
// 这个测试在真实的 jsdom 里完整跑一遍 boot()，专门盯这种情况。
//
// 用法：
//   node tests/refresh.mjs                 # 默认验证 #download
//   node tests/refresh.mjs '#tools'        # 也可以指定其它视图
//   node tests/refresh.mjs '#download' '#tools' '#about' '#home'   # 一次验证多个
import { JSDOM, VirtualConsole } from 'jsdom';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const ROOT = path.resolve(import.meta.dirname, '..');
const HASHES = process.argv.slice(2).filter(Boolean);
const TARGETS = HASHES.length ? HASHES : ['#download'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** 在一个全新的 jsdom 环境里完整启动一次前端（等价于用户按下 F5） */
async function bootAt(hash, html) {
  const noise = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    const message = String(err?.message || err);
    if (/Not implemented|Could not parse CSS|getContext/i.test(message)) return;
    noise.push(message);
  });

  const dom = new JSDOM(html, {
    url: `${BASE}/${hash}`,
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
  // 相对路径要补全成绝对地址（jsdom 的 fetch 在 Node 里不会自动补）
  define('fetch', (input, init) =>
    nativeFetch(typeof input === 'string' ? new URL(input, BASE).href : input, init));
  define('Node', window.Node);
  define('Element', window.Element);
  define('HTMLElement', window.HTMLElement);
  define('CustomEvent', window.CustomEvent);
  define('Event', window.Event);
  define('KeyboardEvent', window.KeyboardEvent);
  define('MouseEvent', window.MouseEvent);
  define('HashChangeEvent', window.HashChangeEvent);
  define('FormData', globalThis.FormData);
  define('scrollTo', () => {});

  // 每次都用带查询串的 URL 导入：绕开 ESM 模块缓存，拿到一套全新的模块状态
  const mainUrl = `${pathToFileURL(path.join(ROOT, 'frontend/js/main.js')).href}?boot=${encodeURIComponent(hash)}-${Date.now()}`;
  await import(mainUrl);

  for (let i = 0; i < 80; i += 1) {
    if (window.document.querySelector('#bootScreen')?.classList.contains('is-hidden')) break;
    await sleep(200);
  }
  await sleep(400);

  return { window, noise };
}

async function main() {
  console.log('\n=== 子页面刷新回归测试（路由重叠 / 画廊状态）===');
  console.log(`目标: ${BASE}`);
  console.log(`用例: ${TARGETS.join(' ')}\n`);

  const html = await fetch(`${BASE}/`).then((r) => r.text());
  check('index.html 给首页预置了 is-active（本用例的场景前提）',
    /id="view-home"[^>]*class="[^"]*is-active/.test(html));

  for (const hash of TARGETS) {
    const expectedView = `view-${hash.replace(/^#\/?/, '')}`;
    const expectedName = hash.replace(/^#\/?/, '');
    console.log(`\n[${hash}] 模拟直接刷新`);

    // 注意：每次都要重新 import 一次 main.js（带不同查询串），所以这里逐个 await
    const { window, noise } = await bootAt(hash, html);
    const q = (sel) => window.document.querySelector(sel);
    const qa = (sel) => Array.from(window.document.querySelectorAll(sel));
    const active = qa('.view.is-active').map((el) => el.id);

    check(`只显示 ${expectedName} 一个视图（不会与首页重叠）`,
      active.length === 1 && active[0] === expectedView, `实际 ${active.join(',') || '(无)'}`);
    check('body[data-view] 与地址一致', window.document.body.dataset.view === expectedName,
      window.document.body.dataset.view);
    check('导航高亮跟随当前页',
      qa('.nav-link').find((a) => a.classList.contains('is-active'))?.dataset.view === expectedName,
      qa('.nav-link').find((a) => a.classList.contains('is-active'))?.textContent);
    check('画廊依然渲染了 11 屏（切回首页即有内容）',
      qa('#gallery > .gallery-slide').length === 11, `${qa('#gallery > .gallery-slide').length} 屏`);
    check('圆点导航 11 个', qa('#galleryDots .gallery-dot').length === 11,
      `${qa('#galleryDots .gallery-dot').length} 个`);

    if (expectedView !== 'view-home') {
      check('首页已被正确收起（不再 is-active）', !q('#view-home').classList.contains('is-active'),
        q('#view-home').className);
    }

    // 切回首页：视图与画廊状态都要恢复正常
    window.location.hash = '#home';
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await sleep(500);
    const back = qa('.view.is-active').map((el) => el.id);
    check('切回首页后只剩首页激活', back.length === 1 && back[0] === 'view-home', back.join(','));
    check('首页第一屏被激活（标题动画 / 圆点就位）',
      qa('#gallery .gallery-slide.is-active').length === 1,
      `${qa('#gallery .gallery-slide.is-active').length} 屏激活`);
    check('无运行时报错', noise.length === 0, noise.slice(0, 2).join(' | '));
  }

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
  .finally(() => process.exit(fail > 0 ? 1 : 0));
