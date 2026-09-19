// js/main.js — 应用入口：加载配置 → 渲染各视图 → 初始化动效与交互
import { el, clear, qs, qsa, toast, hasText, isMobileViewport, prefersReducedMotion, formatRelativeTime, fetchWithTimeout } from './util.js';
import { loadConfig, applyTheme, applySiteMeta } from './config.js';
import { initFonts } from './fonts.js';
import { initRouter, onViewChange, navigate } from './router.js';
import { Gallery } from './gallery.js';
import { createStarfield } from './starfield.js';
import { Effects } from './effects.js';
import { ToolsPanel } from './tools.js';
import { AdminPanel } from './admin.js';

const state = {
  config: null,
  configSource: 'default',
  gallery: null,
  starfield: null,
  effects: null,
  tools: null,
  admin: null,
  adminReady: false,
  lastStatus: null,
  currentSlide: 0,
};

/* ============================================================
   渲染：导航
   ============================================================ */
function renderNav(config) {
  const nav = qs('#nav');
  if (!nav) return;
  clear(nav);

  const items = (config.navigation?.items || []).filter((item) => item && item.visible !== false && hasText(item.label));
  const list = items.length
    ? items
    : [
        { label: '首页', view: 'home' },
        { label: '下载', view: 'download' },
        { label: '功能', view: 'tools' },
        { label: '关于', view: 'about' },
      ];

  for (const item of list) {
    nav.appendChild(
      el('a', {
        class: 'nav-link',
        href: `#${item.view}`,
        dataset: { view: item.view },
        text: item.label,
      })
    );
  }
}

/* ============================================================
   渲染：首页画廊下方（服务状态速览 + 快捷入口）
   注意：原「资讯区」（兑换码 / 卡池活动）已按要求移除
   ============================================================ */
function renderHomeContent(config) {
  renderHomeStatus(config);
  renderHomeLinks(config);
}

/** 服务状态速览：首屏下方最实用的模块，也是画廊下滑的直接落点 */
function renderHomeStatus(config) {
  const wrap = qs('#homeStatus');
  if (!wrap) return;
  clear(wrap);

  if (config.features?.enableKumaPanel === false) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  wrap.append(
    el('div', { class: 'home-block-head' },
      el('h3', { class: 'home-block-title', text: '服务状态速览' }),
      el('button', {
        class: 'mini-btn',
        type: 'button',
        text: '↑ 返回画廊',
        onclick: () => scrollToGallery(),
      })),
    el('div', { class: 'status-overview', id: 'homeStatusCard' },
      el('div', { class: 'skeleton skeleton-line' }),
      el('div', { class: 'skeleton skeleton-line short' })),
    el('div', { class: 'home-block-actions' },
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: '查看完整状态面板',
        onclick: () => navigate('tools'),
      }))
  );

  if (state.lastStatus) updateHomeStatus(state.lastStatus);
  else loadHomeStatus();
}

/** 拉取一次摘要（工具面板也会推送同样结构的数据） */
async function loadHomeStatus() {
  try {
    const res = await fetchWithTimeout('/api/status/summary', { headers: { Accept: 'application/json' } }, 9000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    updateHomeStatus(await res.json());
  } catch (err) {
    const card = qs('#homeStatusCard');
    if (!card) return;
    clear(card);
    card.append(
      el('div', { class: 'status-line' },
        el('span', { class: 'status-dot is-down' }),
        el('span', { text: '状态数据暂时不可用' })),
      el('p', { class: 'field-hint', text: `原因：${err.message}，可点击「查看完整状态面板」重试` })
    );
  }
}

function updateHomeStatus(snapshot) {
  state.lastStatus = snapshot;
  const card = qs('#homeStatusCard');
  if (!card || !snapshot) return;

  const total = Number(snapshot.total ?? 0);
  const up = Number(snapshot.up ?? 0);
  const down = Number(snapshot.down ?? 0);
  const pending = Number(snapshot.pending ?? 0);
  const allUp = down === 0 && total > 0;

  clear(card);
  card.append(
    el('div', { class: `status-line ${allUp ? 'is-up' : down > 0 ? 'is-down' : 'is-pending'}` },
      el('span', { class: 'status-dot' }),
      el('span', { class: 'status-text', text: total === 0 ? '暂无监控项' : allUp ? '所有服务正常' : `${down} 个服务异常` })),
    el('div', { class: 'status-metrics' },
      el('div', { class: 'status-metric' },
        el('span', { class: 'stat-label', text: '监控总数' }),
        el('span', { class: 'stat-value', text: String(total) })),
      el('div', { class: 'status-metric' },
        el('span', { class: 'stat-label', text: '在线' }),
        el('span', { class: 'stat-value is-up', text: String(up) })),
      el('div', { class: 'status-metric' },
        el('span', { class: 'stat-label', text: '异常' }),
        el('span', { class: 'stat-value is-down', text: String(down) })),
      el('div', { class: 'status-metric' },
        el('span', { class: 'stat-label', text: '等待 / 维护' }),
        el('span', { class: 'stat-value', text: String(pending) }))),
    el('p', { class: 'status-meta' },
      `更新于 ${formatRelativeTime(snapshot.lastUpdated)}`,
      snapshot.source === 'live' ? ' · 实时数据' : ' · 演示数据',
      snapshot.stale ? ' · 数据可能过期' : '')
  );
}

/** 快捷入口（保留外链卡片，不含任何资讯内容） */
function renderHomeLinks(config) {
  const wrap = qs('#homeLinks');
  if (!wrap) return;
  clear(wrap);

  const links = config.links || {};
  const items = Array.isArray(links.items) ? links.items.filter((item) => hasText(item?.title)) : [];
  if (!items.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const grid = el('div', { class: 'home-grid' });
  for (const item of items) {
    const external = /^https?:\/\//i.test(item.url || '');
    grid.appendChild(
      el('a', {
        class: 'content-card link-card',
        href: item.url || '#home',
        target: external ? '_blank' : null,
        rel: external ? 'noopener noreferrer' : null,
      },
        el('div', { style: { minWidth: '0' } },
          el('h4', { text: item.title }),
          hasText(item.desc) ? el('p', { text: item.desc }) : null),
        el('span', { class: 'arrow', text: '→' }))
    );
  }

  wrap.append(
    el('div', { class: 'home-block-head' },
      el('h3', { class: 'home-block-title', text: links.title || '快捷入口' }),
      hasText(links.subtitle) ? el('span', { class: 'home-block-hint', text: links.subtitle }) : null),
    grid
  );
}

/* ============================================================
   滚动：回到画廊顶部
   ============================================================ */
function scrollToGallery() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ============================================================
   渲染：下载视图
   ============================================================ */
function renderDownload(config) {
  const grid = qs('#downloadGrid');
  if (!grid) return;
  clear(grid);

  const cards = Array.isArray(config.download?.cards) ? config.download.cards : [];
  if (!cards.length) {
    grid.appendChild(
      el('div', { class: 'empty-state' },
        el('p', { class: 'empty-title', text: '内容整理中' }),
        el('p', { text: '管理员可在「管理后台 → 下载管理」中添加卡片' }))
    );
    return;
  }

  cards.forEach((card, index) => {
    const hasUrl = hasText(card.url) && card.url !== '#';
    const action = hasUrl
      ? el('a', {
          class: 'card-action',
          href: card.url,
          target: /^https?:\/\//i.test(card.url) ? '_blank' : null,
          rel: /^https?:\/\//i.test(card.url) ? 'noopener noreferrer' : null,
          text: '前往 →',
        })
      : el('span', { class: 'card-action is-disabled', text: '链接待补充' });

    grid.appendChild(
      el('article', { class: 'download-card', 'data-reveal': true, style: { transitionDelay: `${Math.min(index * 0.08, 0.4)}s` } },
        hasText(card.tag) ? el('span', { class: 'card-tag', text: card.tag }) : null,
        hasText(card.icon) ? el('div', { class: 'card-icon', text: card.icon }) : null,
        el('h3', { text: card.title }),
        hasText(card.desc) ? el('p', { text: card.desc }) : null,
        action)
    );
  });
}

/* ============================================================
   渲染：关于视图
   ============================================================ */
function renderAbout(config) {
  const wrap = qs('#aboutContent');
  const subtitle = qs('#aboutSubtitle');
  if (subtitle && hasText(config.site?.subtitle)) subtitle.textContent = config.site.subtitle;
  if (!wrap) return;
  clear(wrap);

  const sections = Array.isArray(config.about?.sections) ? config.about.sections : [];
  if (!sections.length) {
    wrap.appendChild(el('p', { class: 'text-muted', text: '关于内容待补充。' }));
    return;
  }

  sections.forEach((section, index) => {
    const block = el('section', { class: 'about-section', 'data-reveal': true, style: { transitionDelay: `${Math.min(index * 0.08, 0.4)}s` } },
      el('h3', { text: section.title })
    );

    const paragraphs = String(section.content || '').split(/\n+/).filter((line) => line.trim().length);
    for (const paragraph of paragraphs) {
      block.appendChild(el('p', { text: paragraph.trim() }));
    }
    wrap.appendChild(block);
  });
}

/* ============================================================
   功能开关
   ============================================================ */
function applyFeatures(config) {
  const features = config.features || {};

  // 星空
  if (state.starfield) {
    state.starfield.setEnabled(features.enableStarfield !== false);
    state.starfield.setPalette({
      gold: config.theme?.primaryColor,
      cyan: config.theme?.accentColor,
    });
  }

  // 星环（CSS 层）
  const rings = qs('#starRings');
  if (rings) rings.style.display = features.enableStarRings === false ? 'none' : '';

  // 前景粒子与鼠标层
  if (state.effects) {
    state.effects.setFeature('enableParticles', features.enableParticles !== false);
    state.effects.setFeature('enableMouseTrail', features.enableMouseTrail !== false);
  }

  // 月亮：仅在首页视图显示
  updateMoonVisibility();

  // Kuma 面板
  if (state.tools) {
    const enabled = features.enableKumaPanel !== false;
    if (enabled !== state.tools.enabled) {
      state.tools.enabled = enabled;
      if (enabled) {
        state.tools.init(config);
      } else {
        state.tools.renderDisabled();
      }
    }
  }

  setupMusic(config);
}

function updateMoonVisibility() {
  const moon = qs('#moon');
  if (!moon) return;
  const enabled = state.config?.features?.enableMoon !== false;
  const onHome = document.body.dataset.view === 'home';
  // 只有首页 + 首屏才显示月亮（滚动布局下月亮属于开场那一屏）
  const onFirstSlide = (state.currentSlide ?? 0) === 0;
  moon.classList.toggle('is-visible', enabled && onHome && onFirstSlide);
}

/* ============================================================
   背景音乐
   ============================================================ */
function setupMusic(config) {
  const audio = qs('#bgm');
  const button = qs('#musicToggle');
  if (!audio || !button) return;

  const features = config.features || {};
  const music = config.music || {};
  const enabled = features.enableBackgroundMusic === true && hasText(music.url);

  button.hidden = !enabled;
  if (!enabled) {
    audio.pause();
    button.classList.remove('is-playing');
    return;
  }

  if (audio.dataset.src !== music.url) {
    audio.dataset.src = music.url;
    audio.src = music.url;
    audio.volume = typeof music.volume === 'number' ? Math.min(Math.max(music.volume, 0), 1) : 0.35;
    audio.loop = true;
  }

  if (!button.dataset.bound) {
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      try {
        if (audio.paused) {
          await audio.play();
          button.classList.add('is-playing');
          button.setAttribute('aria-label', '暂停背景音乐');
        } else {
          audio.pause();
          button.classList.remove('is-playing');
          button.setAttribute('aria-label', '播放背景音乐');
        }
      } catch (err) {
        toast(`播放失败：${err.message}`, 'error');
      }
    });
  }

  if (music.autoplay && !prefersReducedMotion()) {
    audio.play().then(() => button.classList.add('is-playing')).catch(() => {
      /* 浏览器自动播放策略：等待用户首次交互 */
    });
  }
}

/* ============================================================
   移动端汉堡菜单
   ============================================================ */
function setupMobileMenu() {
  const toggle = qs('#menuToggle');
  const nav = qs('#nav');
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    document.body.style.overflow = open ? 'hidden' : '';
  };

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (event) => {
    if (event.target.closest('.nav-link')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });
  window.addEventListener('resize', () => {
    if (!isMobileViewport()) setOpen(false);
  });
}

/* ============================================================
   页脚
   ============================================================ */
function renderFooter(config) {
  const footer = qs('#siteFooter');
  const text = qs('#footerText');
  if (!footer || !text) return;

  const parts = [];
  if (hasText(config.site?.footer)) parts.push(config.site.footer);
  parts.push(`配置更新于 ${formatRelativeTime(config.__meta?.lastUpdated || Date.now())}`);

  text.textContent = parts.join(' · ');
  footer.hidden = false;
}

/* ============================================================
   全量渲染（配置变更后可重复调用）
   ============================================================ */
function renderAll(config) {
  state.config = config;
  applyTheme(config.theme || {});
  applySiteMeta(config.site || {});
  renderNav(config);
  renderGallery(config);
  renderHomeContent(config);
  renderDownload(config);
  renderAbout(config);
  renderFooter(config);
  applyFeatures(config);
  updateMoonVisibility();

  if (state.effects) {
    state.effects.observeReveals(document);
    if (state.gallery) state.gallery.setEnabled(true);
  }
}

function renderGallery(config) {
  const container = qs('#gallery');
  const dots = qs('#galleryDots');
  if (!container || !dots) return;

  if (state.gallery) state.gallery.destroy();

  state.gallery = new Gallery({
    container,
    dots,
    scrollHint: qs('#scrollHint'),
    onCta: (view) => navigate(view),
    // 当前屏变化：月亮只在首屏出现
    onSlideChange: (index) => {
      state.currentSlide = index;
      updateMoonVisibility();
    },
  });

  // 纵向堆叠 + 原生滚动：不再劫持滚轮，也不再自动轮播
  state.gallery.render(config.hero?.slides || []);
}

/* ============================================================
   启动
   ============================================================ */
async function boot() {
  // 启动遮罩兜底：无论发生什么都不要卡住用户
  const bootScreen = qs('#bootScreen');
  const hideBoot = () => bootScreen?.classList.add('is-hidden');
  setTimeout(hideBoot, 4200);

  try {
    // 1) 字体（先注入 @font-face，减少首屏字体闪烁）
    await initFonts();

    // 2) 配置
    const { config, source } = await loadConfig();
    state.config = config;
    state.configSource = source;
    if (source !== 'api') {
      console.warn(`[boot] 配置来源：${source}`);
    }

    // 3) 背景与特效（先于内容渲染，减少布局抖动）
    const canvas = qs('#starfield');
    state.starfield = createStarfield(canvas, {
      reducedMotion: prefersReducedMotion(),
      mobile: isMobileViewport(),
    });

    state.effects = new Effects(qs('#fxLayer'));
    state.effects.init(config.features || {});

    // 4) 工具面板
    state.tools = new ToolsPanel({
      summaryEl: qs('#summaryCard'),
      gridEl: qs('#monitorGrid'),
      emptyEl: qs('#toolsEmpty'),
      badgeEl: qs('#connBadge'),
      toolbarEl: qs('#panelToolbar'),
      refreshBtn: qs('#refreshMonitors'),
      openLink: qs('#openKuma'),
    });

    // 5) 渲染全部视图
    renderAll(config);
    state.tools.init(config);

    // 6) 交互骨架
    setupMobileMenu();

    // 7) 先注册视图监听，再初始化路由（保证首屏也能收到 view 回调）
    onViewChange((view) => {
      updateMoonVisibility();

      if (view === 'tools' && state.tools?.enabled && !state.tools.snapshot) {
        state.tools.load();
      }

      if (view === 'admin' && !state.adminReady) {
        state.adminReady = true;
        state.admin = new AdminPanel(qs('#adminApp'));
        state.admin.init();
      }

      // 首屏星空启动
      if (state.starfield) state.starfield.start();
    });

    initRouter();

    // 8) 管理后台保存配置后同步前端
    document.addEventListener('config-saved', async () => {
      const { config: fresh } = await loadConfig({ force: true });
      renderAll(fresh);
      toast('前端已同步最新配置', 'success');
    });

    // 9) 状态面板推送 → 首页「服务状态速览」实时同步
    document.addEventListener('status-updated', (event) => {
      if (event.detail) updateHomeStatus(event.detail);
    });

    // 10) 双保险：可见性变化时暂停/恢复星空
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) state.starfield?.stop();
      else state.starfield?.start();
    });

    hideBoot();
  } catch (err) {
    console.error('[boot] 启动失败：', err);
    hideBoot();
    toast(`初始化异常：${err.message}`, 'error', 6000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}