// js/main.js — 应用入口：加载配置 → 渲染各视图 → 初始化动效与交互
import { el, clear, qs, qsa, toast, hasText, isMobileViewport, prefersReducedMotion, formatRelativeTime, formatDuration, fetchWithTimeout } from './util.js';
import { loadConfig, applyTheme, applySiteMeta, CONFIG_REVISION_KEY } from './config.js';
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
  renderHomeIndex(config);
  renderHomeLinks(config);
  renderHomeRuntime(config);
  bindContentWheelBack();
}

/** 统一的区块标题行 */
function homeBlockHead(title, hint, extra) {
  return el('div', { class: 'home-block-head' },
    el('h3', { class: 'home-block-title', text: title }),
    hasText(hint) ? el('span', { class: 'home-block-hint', text: hint }) : null,
    extra || null
  );
}

/** 提瓦特索引：把 11 屏变成可点击的导航卡片（点一下跳回那一屏） */
function renderHomeIndex(config) {
  const wrap = qs('#homeIndex');
  if (!wrap) return;
  clear(wrap);

  const slides = Array.isArray(config.hero?.slides) ? config.hero.slides.filter(Boolean) : [];
  if (slides.length < 2) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  const grid = el('div', { class: 'index-grid' });
  slides.forEach((slide, index) => {
    grid.appendChild(
      el('button', {
        class: 'index-card',
        type: 'button',
        'aria-label': `跳转到第 ${index + 1} 屏：${slide.title || ''}`,
        onclick: () => state.gallery?.goTo(index),
      },
        // 国家/地区图标（没配就按标题自动匹配内置图标）
        el('span', { class: 'index-icon' },
          el('img', { src: iconOf(slide), alt: '', loading: 'lazy', width: '28', height: '28' })),
        el('span', { class: 'index-body' },
          el('span', { class: 'index-title', text: hasText(slide.title) ? slide.title : `第 ${index + 1} 屏` }),
          hasText(slide.subtitle) ? el('span', { class: 'index-sub', text: slide.subtitle }) : null),
        el('span', { class: 'index-no', text: String(index + 1).padStart(2, '0') })
      )
    );
  });

  wrap.append(homeBlockHead('提瓦特索引', '点击卡片即可跳回对应那一屏'), grid);
}

/** 站点运行信息：数据源 / 监控概况 / 服务运行时长 */
function renderHomeRuntime(config) {
  const wrap = qs('#homeRuntime');
  if (!wrap) return;
  clear(wrap);

  const card = el('div', { class: 'runtime-card', id: 'homeRuntimeCard' },
    el('div', { class: 'runtime-row' },
      el('span', { class: 'runtime-label', text: '状态' }),
      el('span', { class: 'runtime-value', text: '读取中…' })));

  wrap.append(
    homeBlockHead('站点运行信息', '数据源、监控概况与运行时长'),
    card,
    el('div', { class: 'home-block-actions' },
      el('button', {
        class: 'btn btn-ghost',
        type: 'button',
        text: '刷新信息',
        onclick: () => loadRuntime(),
      }))
  );

  loadRuntime();
}

async function loadRuntime() {
  const card = qs('#homeRuntimeCard');
  if (!card) return;

  const [summary, health] = await Promise.all([
    fetchWithTimeout('/api/status/summary', { headers: { Accept: 'application/json' } }, 9000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetchWithTimeout('/health', { headers: { Accept: 'application/json' } }, 6000)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const summaryData = summary?.summary || summary || {};
  const rows = [];

  rows.push(['数据源', summary?.source === 'live' ? '真实 Uptime Kuma' : summary?.source === 'mock' ? 'Mock 演示模式' : '未知']);
  rows.push(['监控概况', `${summaryData.total ?? 0} 个监控 · 在线 ${summaryData.up ?? 0} · 异常 ${summaryData.down ?? 0}`]);
  rows.push(['数据更新', formatRelativeTime(summary?.lastUpdated)]);
  rows.push(['实时推送', summary?.stale ? '数据可能过期（已降级）' : 'SSE 长连接正常']);
  rows.push(['服务运行', formatDuration(health?.uptime)]);
  rows.push(['访问通道', health?.sseClients != null ? `${health.sseClients} 个实时连接` : '--']);

  clear(card);
  for (const [label, value] of rows) {
    card.appendChild(
      el('div', { class: 'runtime-row' },
        el('span', { class: 'runtime-label', text: label }),
        el('span', { class: 'runtime-value', text: String(value) }))
    );
  }
}

/** 在下方内容区向上滚 → 一次手势回退约一屏，直到回到画廊 */
function bindContentWheelBack() {
  const content = qs('#homeContent');
  if (!content || content.dataset.wheelBound) return;
  content.dataset.wheelBound = '1';

  const stage = qs('.gallery-stage');
  let animating = false;

  content.addEventListener('wheel', (event) => {
    if (event.deltaY >= 0) return;      // 只处理向上滚（向下交给原生滚动）
    const y = window.scrollY;
    if (y <= 0) return;                 // 已经在顶部：交给画廊自己的翻屏逻辑

    event.preventDefault();
    if (animating) return;              // 一次手势只走一步，不被连续事件反复打断
    animating = true;

    // 一步回退约一屏。但如果这一步会停在"画廊只露出一小半"的位置，
    // 就直接对齐到画廊顶部 —— 否则画面会卡在拼贴状态：
    // 上面是坎瑞亚（最后一屏）被截掉下半截的空背景，下面接着内容区开头的空白。
    const step = Math.max(0, y - window.innerHeight * 0.92);
    const galleryBottom = stage ? stage.offsetTop + stage.offsetHeight : 0;
    const target = step > 0 && step < galleryBottom ? 0 : step;

    animateWindowScroll(target, 520, () => {
      animating = false;
    });
  }, { passive: false });
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
  if (!snapshot) return;
  state.lastStatus = snapshot;

  const card = qs('#homeStatusCard');
  if (!card) return;

  // 兼容两种来源：/api/status/summary（扁平）与工具面板/SSE 推送（{ monitors, summary } 嵌套）
  const summary = snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : snapshot;

  const total = Number(summary.total ?? 0);
  const up = Number(summary.up ?? 0);
  const down = Number(summary.down ?? 0);
  const pending = Number(summary.pending ?? 0);
  const maintenance = Number(summary.maintenance ?? 0);
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
        el('span', { class: 'stat-value', text: String(pending + maintenance) }))),
    el('p', { class: 'status-meta' },
      `更新于 ${formatRelativeTime(snapshot.lastUpdated)}`,
      snapshot.source === 'live' ? ' · 实时数据' : snapshot.source === 'mock' ? ' · 演示数据' : '',
      snapshot.stale ? ' · 数据可能过期' : '')
  );

  // 数字滚动：只在数值**变化**时滚一次，避免每次 SSE 推送都重新跳一遍
  const counts = [total, up, down, pending + maintenance];
  qsa('#homeStatusCard .stat-value').forEach((node, index) => {
    if (state.lastStatusCounts?.[index] !== counts[index]) animateCount(node, 700);
  });
  state.lastStatusCounts = counts;
  state.scrollProgress?.(); // 内容高度变了，进度条基数跟着更新
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
   滚动：回到画廊第一屏 / 跳到下方内容
   ============================================================ */

/**
 * 窗口级缓动滚动：自己控制每一帧。
 * 不用 window.scrollTo({behavior:'smooth'}) 是因为连续滚动事件会让浏览器
 * 反复重启同一条动画，页面只会一点点往前挪（"滚不上去"的观感）。
 * 另外 CSS 里的 scroll-behavior 也一并去掉了，避免和逐帧写入互相打架。
 */
let windowScrollRaf = null;

function animateWindowScroll(to, duration = 520, done) {
  cancelAnimationFrame(windowScrollRaf);

  const from = window.scrollY || window.pageYOffset || 0;
  const delta = to - from;
  // 逐帧写入期间先关掉页面级滚动吸附，否则浏览器会在每帧之后重新吸附，
  // 动画会被"拽"回锚点（和画廊内部动画期间关掉 scroll-snap 是同一个道理）
  const root = document.documentElement;
  root.classList.add('is-page-animating');

  const finish = () => {
    windowScrollRaf = null;
    root.classList.remove('is-page-animating');
    done?.();
  };

  if (Math.abs(delta) < 2 || prefersReducedMotion()) {
    window.scrollTo({ top: to, behavior: 'instant' });
    finish();
    return;
  }

  let started = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

  const tick = (now) => {
    const stamp = typeof now === 'number' ? now : performance.now();
    if (started === null) started = stamp;

    const p = Math.max(0, Math.min(1, (stamp - started) / duration));
    window.scrollTo({ top: from + delta * ease(p), behavior: 'instant' });

    if (p < 1) windowScrollRaf = requestAnimationFrame(tick);
    else {
      window.scrollTo({ top: to, behavior: 'instant' });
      finish();
    }
  };

  windowScrollRaf = requestAnimationFrame(tick);
}

function scrollToGallery() {
  // 回到画廊 = 画廊内部回第一屏 + 页面滚回画廊顶部。
  // 两件事都要做：否则人还停在下方内容区，画廊却在背后偷偷重置了。
  if (state.gallery) state.gallery.goTo(0);
  animateWindowScroll(0, 520, () => {
    // 落回画廊后再同步一次当前屏，保证圆点高亮 / 月亮 / 光幕状态都对
    if (state.gallery) state.gallery.activate(state.gallery.currentIndexFromScroll(), { animate: true });
  });
}

function scrollToHomeContent() {
  const target = qs('#homeContent');
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY;
  animateWindowScroll(Math.max(0, top), 560);
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
    const tryAutoplay = () => {
      let promise = null;
      try {
        promise = audio.play?.();
      } catch {
        promise = null;
      }
      // 有些环境（jsdom / 极老的浏览器）play() 不返回 Promise，这里必须容错，
      // 否则一个 TypeError 会把整个 renderAll 打断，页面其它部分全都不渲染。
      if (!promise || typeof promise.then !== 'function') {
        button.classList.add('is-playing');
        return;
      }
      promise
        .then(() => {
          button.classList.add('is-playing');
          button.classList.remove('is-waiting');
          button.setAttribute('aria-label', '暂停背景音乐');
        })
        .catch(() => {
          // 浏览器自动播放策略：带声音的音频必须等用户先交互一次。
          // 这里不报错，而是把按钮标成"待点击"，并在第一次交互时自动重试 ——
          // 否则用户会觉得"配了背景音乐却没声音"。
          button.classList.add('is-waiting');
          button.setAttribute('aria-label', '点击播放背景音乐');
        });
    };

    tryAutoplay();

    if (!button.dataset.autoplayRetry) {
      button.dataset.autoplayRetry = '1';
      const retry = () => {
        if (!audio.paused || !button.classList.contains('is-waiting')) return;
        tryAutoplay();
      };
      // 只监听一次用户交互（once），避免长期挂着监听
      window.addEventListener('pointerdown', retry, { once: true, passive: true });
      window.addEventListener('keydown', retry, { once: true });
    }
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
  renderBackgrounds(config);
  renderHomeContent(config);
  renderDownload(config);
  renderAbout(config);
  renderFooter(config);
  applyFeatures(config);   // 内部会调用 setupMusic(config)
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
    onCta: (view) => {
      // 「进入网站」= 进入站点主体（滚到画廊下方内容区）；其余值走视图切换
      if (view === 'home') scrollToHomeContent();
      else navigate(view);
    },
    // 当前屏变化：月亮只在首屏出现（-1 = 画廊整体滚出视口）
    onSlideChange: (index) => {
      state.currentSlide = index;
      updateMoonVisibility();
    },
    // 末屏继续下滑：整段跳到下方内容区
    onExitDown: () => scrollToHomeContent(),
  });

  // 一屏一步（滚轮由 Gallery 自己接管做动画，触摸交给 CSS 吸附）
  state.gallery.render(config.hero?.slides || []);
}

/* ============================================================
   国家/地区图标：没配就按标题自动匹配内置图标（frontend/images/icons）
   ============================================================ */
const BUILTIN_ICONS = {
  原神: '/images/icons/genshin.svg',
  蒙德: '/images/icons/mondstadt.svg',
  璃月: '/images/icons/liyue.svg',
  稻妻: '/images/icons/inazuma.svg',
  须弥: '/images/icons/sumeru.svg',
  枫丹: '/images/icons/fontaine.svg',
  纳塔: '/images/icons/natlan.svg',
  至冬: '/images/icons/snezhnaya.svg',
  挪德卡莱: '/images/icons/nodkrai.svg',
  坎瑞亚: '/images/icons/khaenriah.svg',
  哥伦比娅: '/images/icons/columbina.svg',
};

function iconOf(slide) {
  const custom = String(slide?.icon || '').trim();
  if (custom) return custom;
  const title = String(slide?.title || '');
  for (const [keyword, path] of Object.entries(BUILTIN_ICONS)) {
    if (title.includes(keyword)) return path;
  }
  return '/images/icons/genshin.svg';
}

/* ============================================================
   页面背景（高度自定义：背景图 + 覆盖色 + 遮罩图 + 模糊/压暗）
   ============================================================ */

/** 每个可自定义背景的界面 → 容器元素 + CSS 变量前缀 */
const BACKGROUND_TARGETS = {
  global: { selector: '#globalBg', class: 'page-bg--global', create: true },
  homeContent: { selector: '#homeContent', class: 'page-bg--home-content' },
  download: { selector: '#view-download', class: 'page-bg--view' },
  tools: { selector: '#view-tools', class: 'page-bg--view' },
  about: { selector: '#view-about', class: 'page-bg--view' },
};

/** 安全化：只允许站内路径或 http(s) 链接，杜绝把奇怪的东西塞进 CSS url() */
function safeCssUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/^(\/[^\s"'()\\]*|https?:\/\/[^\s"'()\\]+)$/i.test(raw)) return '';
  // ".." 只对**站内相对路径**有意义（防目录穿越）。
  // 外链里出现 ".." 是完全正常的 —— 例如官方 CDN 的 home@1x.78a07083..jpg，
  // 以前这里一刀切，导致这种地址被静默丢掉、背景"设了没反应"。
  const isRelative = raw.startsWith('/') && !raw.startsWith('//');
  if (isRelative && raw.includes('..')) return '';
  return raw;
}

function renderBackgrounds(config) {
  // 重新渲染前先清掉上一轮的轮播定时器，避免越切越快
  (state.backgroundTimers || []).forEach((timer) => clearInterval(timer));
  state.backgroundTimers = [];

  const layers = Array.isArray(config.backgrounds?.layers) ? config.backgrounds.layers : [];
  const byView = new Map();
  for (const layer of layers) {
    if (layer && BACKGROUND_TARGETS[layer.view]) byView.set(layer.view, layer);
  }

  for (const [view, target] of Object.entries(BACKGROUND_TARGETS)) {
    let host = qs(target.selector);

    // global：星空那一层的全局背景容器（放在所有 .layer 之前，星星仍然叠在图片上面）
    // 只有真的配了 global 才创建这个容器，没配就完全不插节点
    if (!host && target.create && byView.has(view)) {
      host = el('div', { class: 'layer layer-global-bg', id: 'globalBg', 'aria-hidden': 'true' });
      const body = document.body;
      const firstLayer = body.querySelector('.layer');
      if (firstLayer) body.insertBefore(host, firstLayer);
      else body.prepend(host);
    }
    if (!host) continue;

    host.querySelectorAll(':scope > .page-bg').forEach((node) => node.remove());

    const layer = byView.get(view);
    const single = safeCssUrl(layer?.image);
    // 多张背景图：交叉淡入淡出轮播（填了 images 就以它为准）
    const list = (Array.isArray(layer?.images) ? layer.images : [])
      .map((item) => safeCssUrl(item))
      .filter(Boolean);
    const images = list.length ? list : (single ? [single] : []);
    const mask = safeCssUrl(layer?.mask);
    const hasOverlay = layer?.overlayColor && Number(layer?.overlayOpacity) > 0;

    if (!images.length && !mask && !hasOverlay) {
      host.classList.remove('has-page-bg');
      continue;
    }

    const node = el('div', {
      class: `page-bg ${target.class}`,
      'aria-hidden': 'true',
      style: {
        '--pb-blur': `${Number(layer?.blur) || 0}px`,
        '--pb-dim': String(1 - (Number(layer?.dim) || 0)),
        '--pb-attachment': layer?.fixed ? 'fixed' : 'scroll',
      },
    });

    if (images.length) {
      // 前两张各占一层，靠 opacity 交叉淡入淡出；再多就循环复用这两层
      const layers = images.slice(0, 2);
      layers.forEach((src, index) => {
        node.appendChild(el('i', {
          class: `pb-image${images.length > 1 ? ' pb-rotator' : ''}`,
          dataset: { index: String(index) },
          style: { backgroundImage: `url("${src}")`, opacity: index === 0 ? '1' : '0' },
        }));
      });

      if (images.length > 1 && !prefersReducedMotion()) {
        const seconds = Number(layer?.interval) > 0 ? Number(layer.interval) : 12;
        const layerEls = node.querySelectorAll('.pb-image');
        let current = 0;
        const timer = setInterval(() => {
          if (document.hidden) return; // 切到后台就别转了
          const next = (current + 1) % images.length;
          layerEls[current % 2].style.opacity = '0';
          layerEls[next % 2].style.backgroundImage = `url("${images[next]}")`;
          layerEls[next % 2].style.opacity = '1';
          current = next;
        }, Math.max(4, seconds) * 1000);
        state.backgroundTimers = state.backgroundTimers || [];
        state.backgroundTimers.push(timer);
      }
    }
    if (hasOverlay) {
      node.appendChild(el('i', {
        class: 'pb-overlay',
        style: {
          background: layer.overlayColor,
          opacity: String(Number(layer.overlayOpacity)),
        },
      }));
    }
    if (mask) {
      const size = layer.maskSize || 'cover';
      node.appendChild(el('i', {
        class: `pb-mask is-${size}`,
        style: {
          backgroundImage: `url("${mask}")`,
          opacity: String(layer.maskOpacity ?? 0.35),
          mixBlendMode: layer.maskBlend || 'screen',
        },
      }));
    }

    host.classList.add('has-page-bg');
    host.prepend(node);
  }
}

/* ============================================================
   动效小工具：滚动进度条 + 数字滚动
   ============================================================ */

/**
 * 顶部滚动进度条。
 * 画廊是**内层**滚动容器，所以进度要把"画廊内部进度"和"页面进度"加在一起算，
 * 否则在画廊里翻 11 屏时进度条纹丝不动。
 */
function setupScrollProgress() {
  const bar = qs('#scrollProgress');
  if (!bar) return;
  const galleryEl = qs('#gallery');
  let ticking = false;

  const update = () => {
    ticking = false;
    const inner = galleryEl ? galleryEl.scrollTop : 0;
    const innerMax = galleryEl ? Math.max(0, galleryEl.scrollHeight - galleryEl.clientHeight) : 0;
    const page = window.scrollY || window.pageYOffset || 0;
    const pageMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const total = innerMax + pageMax;
    const progress = total > 0 ? Math.min(1, Math.max(0, (inner + page) / total)) : 0;
    bar.style.setProperty('--progress', progress.toFixed(4));
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  galleryEl?.addEventListener('scroll', onScroll, { passive: true });
  update();

  state.scrollProgress = update; // 渲染后（内容变高）可以手动刷新一次
}

/** 数字滚动：15 → 0…15 涨上去，其余文字保持不变（尊重"减少动态效果"） */
function animateCount(node, duration = 700) {
  if (!node || prefersReducedMotion()) return;
  const template = String(node.textContent || '');
  const target = Number(template.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(target) || target <= 1) return;

  const started = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = template.replace(/\d+/, String(Math.round(target * eased)));
    if (p < 1) requestAnimationFrame(tick);
    else node.textContent = template;
  };
  requestAnimationFrame(tick);
}

/* ============================================================
   配置同步（后台保存 / 跨标签页）
   ============================================================ */
/** 从服务端重新拉配置并整站重渲染（字体清单也一起刷新） */
async function syncConfigFromServer(message = '已保存并即时生效') {
  try {
    const { config: fresh } = await loadConfig({ force: true });
    await initFonts();
    renderAll(fresh);
    toast(message, 'success');
  } catch (err) {
    toast(`同步配置失败：${err.message}`, 'error');
  }
}

/**
 * 画廊与内容区的"边界吸附"。
 *
 * 页面滚动在这两者之间有一段"过渡带"（0 < scrollY < 内容区顶部）：
 * 停在这里时，视口上半是**坎瑞亚（最后一屏）被切掉一半的空背景**，下半是内容区开头的空白 ——
 * 看起来就像页面坏了。滚轮那条路径已经会直接对齐到画廊顶部，但触摸滑动、拖滚动条、
 * 键盘 PageUp、触控板惯性都不经过滚轮事件，所以这里再加一道**兜底**：
 * 滚动停下来之后，如果位置落在过渡带里，就平滑地对齐到最近的一头。
 */
function bindGalleryBoundaryClamp() {
  const content = qs('#homeContent');
  if (!content) return;

  let settleTimer = null;

  const clamp = () => {
    const y = window.scrollY || window.pageYOffset || 0;
    const contentTop = content.getBoundingClientRect().top + y;
    const pageMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

    // 内容比一屏还短时没有可对齐的位置，别乱动
    if (!contentTop || contentTop > pageMax + 2) return;
    // 已经在两个"整齐位置"上（画廊顶部 / 内容区顶部）
    if (y <= 2 || y >= contentTop - 2) return;

    const toGallery = y < contentTop / 2;
    animateWindowScroll(toGallery ? 0 : contentTop, 340, () => {
      // 回到画廊时顺手把"当前屏"重新同步一次：
      // 否则可能出现"画面是坎瑞亚、右侧圆点却没高亮、月亮也不在"的状态
      if (toGallery && state.gallery) {
        state.gallery.activate(state.gallery.currentIndexFromScroll(), { animate: true });
      }
    });
  };

  window.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    // 等滚动停下来再判断，避免和手势本身打架
    settleTimer = setTimeout(clamp, 160);
  }, { passive: true });
}

/* ============================================================
   启动
   ============================================================ */
async function boot() {
  // 启动遮罩兜底：无论发生什么都不要卡住用户
  const bootScreen = qs('#bootScreen');
  const hideBoot = () => bootScreen?.classList.add('is-hidden');
  setTimeout(hideBoot, 4200);

  // 刷新后始终从首屏开始：浏览器会自动恢复"内层滚动容器"的位置，
  // 不关掉的话会出现"一刷新就停在最后一屏 / 页面停在底部"的错乱。
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  } catch {
    /* ignore */
  }
  window.scrollTo(0, 0);

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
    setupScrollProgress();
    bindGalleryBoundaryClamp();

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

    // 8) 管理后台保存配置后同步前端（无需手动刷新页面）
    document.addEventListener('config-saved', async () => {
      await syncConfigFromServer();
    });

    // 8.0) 跨标签页同步：后台在另一个标签页保存后，本标签页也要跟着更新
    //      （否则会出现"这个窗口是新的、那个窗口还是旧的"，很像"配置不生效"）
    window.addEventListener('storage', (event) => {
      if (event.key !== CONFIG_REVISION_KEY) return;
      syncConfigFromServer('另一个标签页更新了配置，已同步');
    });

    // 8.1) 上传了新字体：重新注入 @font-face（不用刷新页面）
    document.addEventListener('fonts-changed', async (event) => {
      await initFonts();
      const family = event?.detail?.family;
      toast(family ? `字体已生效：${family}` : '字体已生效', 'success');
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