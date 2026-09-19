// js/router.js — 视图切换（#hash 路由 + 过渡动画）
import { qsa } from './util.js';

const ROUTES = ['home', 'download', 'tools', 'about', 'admin'];
const LEAVE_MS = 320;

let currentView = null;
const listeners = new Set();

export function onViewChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function getCurrentView() {
  return currentView;
}

function viewFromLocation() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES.includes(hash) ? hash : 'home';
}

function syncNav(view) {
  qsa('.nav-link').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.view === view);
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

/** 切换视图（含旧视图淡出上移、新视图淡入） */
export function showView(view, { scrollTop = true } = {}) {
  const target = ROUTES.includes(view) ? view : 'home';
  const next = document.getElementById(`view-${target}`);
  if (!next) return;

  if (currentView === target) {
    syncNav(target);
    return;
  }

  const prev = currentView ? document.getElementById(`view-${currentView}`) : null;

  // index.html 里给首页预置了 is-active（无 JS 时也能看到内容），
  // 而首屏这次调用 currentView 还是空的 —— 如果不显式收掉，
  // 直接在 #download / #tools 等地址刷新就会变成"首页与目标页同时 display:block"，
  // 表现为页面看起来还是首页、下面又接了一截别的内容。
  document.querySelectorAll('.view.is-active, .view.is-leaving').forEach((el) => {
    if (el === next || el === prev) return;
    el.classList.remove('is-active', 'is-leaving');
  });

  if (prev && prev !== next) {
    prev.classList.add('is-leaving');
    setTimeout(() => {
      prev.classList.remove('is-active', 'is-leaving');
    }, LEAVE_MS);
  }

  next.classList.remove('is-leaving');
  // 强制重排，确保动画重新触发
  void next.offsetWidth;
  next.classList.add('is-active');

  currentView = target;
  syncNav(target);

  if (scrollTop) window.scrollTo({ top: 0, behavior: 'auto' });

  document.body.dataset.view = target;
  document.dispatchEvent(new CustomEvent('view-enter', { detail: { view: target } }));
  listeners.forEach((fn) => {
    try {
      fn(target);
    } catch (err) {
      console.error('[router] 视图监听器异常：', err);
    }
  });
}

/** 导航（写历史 + 切换视图） */
export function navigate(view, { push = true } = {}) {
  const target = ROUTES.includes(view) ? view : 'home';

  if (push) {
    const hash = `#${target}`;
    if (location.hash !== hash) history.pushState({ view: target }, '', hash);
  }

  showView(target);
}

function handleLocationChange() {
  showView(viewFromLocation());
}

export function initRouter() {
  // 顶栏导航点击
  qsa('.nav-link, .logo[data-view]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const view = link.dataset.view;
      if (!view) return;
      event.preventDefault();
      navigate(view);
      const nav = document.getElementById('nav');
      if (nav) nav.classList.remove('is-open');
      document.getElementById('menuToggle')?.classList.remove('is-open');
      document.getElementById('menuToggle')?.setAttribute('aria-expanded', 'false');
    });
  });

  window.addEventListener('popstate', handleLocationChange);
  window.addEventListener('hashchange', handleLocationChange);

  const initial = viewFromLocation();
  history.replaceState({ view: initial }, '', `#${initial}`);
  currentView = null;
  showView(initial, { scrollTop: false });

  return initial;
}

export { ROUTES };