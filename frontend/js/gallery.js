// js/gallery.js — 首页画廊：11 屏纵向堆叠，**原生滚动**（一条滚下来）
//
// 布局模型：每一屏都是 min-height:100svh 的普通区块，页面自然向下滚动。
//   不再劫持滚轮、不再有"界面切换"感，刷新后滚动位置由浏览器正确恢复。
//
// 仍然保留的体验：
//   • 逐字浮现标题（进入视口时触发）
//   • Ken Burns 背景缓慢缩放（仅当前屏播放，省电）
//   • 背景视频：当前屏播放、离开即暂停，相邻屏才挂载地址（省流量）
//   • 圆点导航（桌面端右侧固定竖排，点击平滑跳转）
//   • 首屏「向下浏览」提示（滚过首屏自动隐藏）
//   • 键盘 ↑/↓ 与 PageUp/PageDown 原生滚动
import { el, clear, qsa, hasText, prefersReducedMotion } from './util.js';
import { fontClassOf } from './fonts.js';

/** 判定"当前屏"的可见比例阈值 */
const ACTIVE_RATIO = 0.45;

/** 一屏切换的动画时长（毫秒）：太短显生硬、太长显拖沓 */
const STEP_DURATION = 520;

export class Gallery {
  constructor({ container, dots, scrollHint, onCta, onSlideChange, onExitDown }) {
    this.container = container;
    this.dotsContainer = dots;
    this.scrollHint = scrollHint;
    this.onCta = onCta;
    this.onSlideChange = onSlideChange;
    this.onExitDown = onExitDown;

    this.slides = [];
    this.slideEls = [];
    this.dots = [];
    this.videoEls = [];
    this.currentIndex = -1;
    this.enabled = true;
    this.observer = null;
    this.ratios = new Map();
    this.animatedIn = new Set();
    this.boundHandlers = [];
    this.animating = false;
    this.rafId = null;
  }

  /** 依据配置渲染所有屏（纵向堆叠，一次手势一屏） */
  render(slides = []) {
    this.slides = Array.isArray(slides) ? slides.filter(Boolean) : [];
    this.stopAnimation();
    clear(this.container);
    clear(this.dotsContainer);
    this.slideEls = [];
    this.dots = [];
    this.videoEls = [];
    this.animatedIn.clear();
    this.ratios.clear();
    this.currentIndex = -1;
    this.container.scrollTop = 0;

    if (!this.slides.length) {
      this.container.appendChild(
        el('div', { class: 'empty-state', style: { margin: '30vh auto', maxWidth: '520px' } },
          el('p', { class: 'empty-title', text: '画廊暂无内容' }),
          el('p', { text: '请进入管理后台 → 画廊管理 添加幻灯片' }))
      );
      return;
    }

    this.slides.forEach((slide, index) => {
      const titleText = hasText(slide.title) ? slide.title : '';

      // 逐屏外观：特效 / 对齐 / 垂直位置 / 字号倍率 / 遮罩强度 / Ken Burns
      const effect = ['shine', 'gradient', 'neon', 'outline', 'offset', 'plain'].includes(slide.effect)
        ? slide.effect
        : 'shine';
      const align = ['left', 'center', 'right'].includes(slide.align) ? slide.align : 'left';
      const vertical = ['top', 'center', 'bottom'].includes(slide.vertical) ? slide.vertical : 'center';
      const titleScale = typeof slide.titleScale === 'number' ? slide.titleScale : 1;
      const kenBurns = slide.kenBurns !== false;
      const scrim = typeof slide.scrim === 'number' ? slide.scrim : null;
      const offsetX = typeof slide.offsetX === 'number' ? slide.offsetX : 0;
      const offsetY = typeof slide.offsetY === 'number' ? slide.offsetY : 0;

      const slideEl = el('section', {
        class: [
          'gallery-slide',
          `effect-${effect}`,
          `align-${align}`,
          `v-${vertical}`,
          kenBurns ? '' : 'no-kenburns',
        ].filter(Boolean).join(' '),
        dataset: { index: String(index), effect, align, vertical },
        style: {
          ...(scrim !== null ? { '--scrim': scrim } : {}),
          ...(titleScale !== 1 ? { '--title-scale': titleScale } : {}),
          ...(offsetX !== 0 ? { '--content-x': `${offsetX}%` } : {}),
          ...(offsetY !== 0 ? { '--content-y': `${offsetY}%` } : {}),
        },
        'aria-label': hasText(titleText) ? titleText : `第 ${index + 1} 屏`,
      });

      // 背景（自己铺满所属区块）
      const safeBg = slide.bgImage ? String(slide.bgImage).replace(/["()\\]/g, '') : '';
      const videoSrc = hasText(slide.bgVideo) ? String(slide.bgVideo).trim() : '';
      const bgEl = el('div', {
        class: videoSrc ? 'slide-bg has-video' : 'slide-bg',
        style: safeBg ? { backgroundImage: `url("${safeBg}")` } : {},
        'aria-hidden': 'true',
      });

      let videoEl = null;
      if (videoSrc) {
        const muted = slide.videoMuted !== false; // 静音是浏览器允许自动播放的前提
        const loop = slide.videoLoop !== false;
        videoEl = el('video', {
          class: 'slide-video',
          muted,
          loop,
          playsinline: true,
          'webkit-playsinline': true,
          // 第一屏立刻取流，其余按需（相邻屏由 syncVideos 提前挂载）
          preload: index === 0 ? 'auto' : 'none',
          poster: safeBg || null,
          tabindex: '-1',
          'aria-hidden': 'true',
          dataset: { src: videoSrc, index: String(index) },
        });
        // 属性写进 DOM，属性值也设一遍：某些浏览器只认其中之一
        videoEl.muted = muted;
        videoEl.loop = loop;
        if (typeof slide.videoOpacity === 'number') {
          videoEl.style.opacity = String(slide.videoOpacity);
        }
        bgEl.appendChild(videoEl);
      }

      slideEl.appendChild(bgEl);

      const content = el('div', { class: 'slide-content' });

      if (hasText(titleText)) {
        const title = el('h1', {
          class: `slide-title ${fontClassOf(slide.font)}`,
          style: slide.textColor ? { color: slide.textColor } : {},
          'data-text': titleText,
        });
        const span = el('span', { class: 'title-text' });
        for (const char of Array.from(titleText)) {
          span.appendChild(el('span', { class: 'char', text: char }));
        }
        title.appendChild(span);
        // 只有需要光幕的特效才加这层
        if (effect === 'shine') {
          title.appendChild(el('span', { class: 'title-shine', 'aria-hidden': 'true' }));
        }
        content.appendChild(title);
      }

      if (hasText(slide.subtitle)) {
        content.appendChild(
          el('p', {
            class: `slide-subtitle ${fontClassOf(slide.font)}`,
            style: slide.textColor ? { color: slide.textColor } : {},
            text: slide.subtitle,
          })
        );
      }

      if (hasText(slide.desc)) {
        content.appendChild(el('p', { class: 'slide-desc', text: slide.desc }));
      }

      if (hasText(slide.cta)) {
        const ctaView = slide.ctaView || 'tools';
        content.appendChild(
          el('div', { class: 'slide-cta' },
            el('button', {
              class: 'btn btn-primary',
              type: 'button',
              text: slide.cta,
              onclick: () => this.onCta?.(ctaView),
            }))
        );
      }

      slideEl.appendChild(content);
      this.container.appendChild(slideEl);
      this.slideEls.push(slideEl);
      this.videoEls.push(videoEl);

      // 圆点导航（桌面端右侧竖排）
      const dot = el('button', {
        class: 'gallery-dot',
        type: 'button',
        'aria-label': `跳转到第 ${index + 1} 屏${hasText(titleText) ? `：${titleText}` : ''}`,
        title: hasText(titleText) ? titleText : `第 ${index + 1} 屏`,
        onclick: () => this.goTo(index),
      });
      this.dotsContainer.appendChild(dot);
      this.dots.push(dot);
    });

    this.bindScrollHint();
    this.bindWheel();
    this.bindKeyboard();
    this.bindVisibility();
    this.setupObserver();
    // 首屏先进入"已激活"状态，动画立刻播放
    this.activate(0, { animate: true });
  }

  /** 进入视口的观察器：决定当前屏、触发标题动画、控制提示与圆点 */
  setupObserver() {
    if (typeof IntersectionObserver === 'undefined') {
      // 降级（含无 IntersectionObserver 的环境）：首屏激活，其余静态展示
      this.activate(0, { animate: true, force: true });
      this.scrollHint?.classList.add('is-visible');
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number(entry.target.dataset.index);
          this.ratios.set(index, entry.intersectionRatio);
          if (entry.intersectionRatio < 0.08) this.animatedIn.delete(index);
        }

        // 选出可见比例最高的一屏作为当前屏
        let best = -1;
        let bestRatio = ACTIVE_RATIO;
        for (const [index, ratio] of this.ratios) {
          if (ratio > bestRatio) {
            best = index;
            bestRatio = ratio;
          }
        }

        // 整体滚出视口（例如页面已滚到下方内容）→ 视为"没有当前屏"，月亮与提示一起隐藏
        if (best < 0) {
          if (this.currentIndex !== -1) {
            this.currentIndex = -1;
            this.slideEls.forEach((elm) => elm.classList.remove('is-active'));
            this.dots.forEach((dot) => dot.classList.remove('is-active'));
            this.syncVideos(-1); // 看不见画面了就别再解码视频
            this.onSlideChange?.(-1, this.slideEls.length);
          }
        } else if (best !== this.currentIndex) {
          this.activate(best, { animate: true });
        }

        // 「向下浏览」提示：只在首屏处于视口内时显示
        const firstRatio = this.ratios.get(0) || 0;
        this.scrollHint?.classList.toggle('is-visible', firstRatio > 0.55 && this.currentIndex <= 0);
      },
      { threshold: [0, 0.08, 0.25, 0.45, 0.6, 0.8, 1] }
    );

    this.slideEls.forEach((slideEl) => this.observer.observe(slideEl));
  }

  /** 激活某一屏：切换 .is-active、更新圆点、播放标题动画 */
  activate(index, { animate = false, force = false } = {}) {
    const slideEl = this.slideEls[index];
    if (!slideEl) return;

    if (this.currentIndex !== index || force) {
      this.slideEls.forEach((elm, i) => {
        const active = i === index;
        elm.classList.toggle('is-active', active);
      });
      this.dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        dot.setAttribute('aria-current', i === index ? 'true' : 'false');
      });
      this.currentIndex = index;
      this.syncVideos(index);
      this.onSlideChange?.(index, this.slideEls.length);
    }

    if (animate && !this.animatedIn.has(index)) {
      this.animatedIn.add(index);
      this.animateTitle(index);
    }
  }

  /** 逐字浮现：每个字从下往上 + 淡入，错开 60ms */
  animateTitle(index) {
    const slideEl = this.slideEls[index];
    if (!slideEl) return;

    const chars = qsa('.char', slideEl);
    if (!chars.length) return;

    const reduced = prefersReducedMotion();
    chars.forEach((char) => {
      char.style.animation = 'none';
      char.style.opacity = reduced ? '1' : '0';
      char.style.transform = reduced ? 'none' : 'translate3d(0, 0.5em, 0)';
    });

    void slideEl.offsetWidth; // 强制重排后再播放

    chars.forEach((char, i) => {
      char.style.animation = '';
      char.style.animationDelay = `${i * 0.06}s`;
      if (reduced) {
        char.style.opacity = '1';
        char.style.transform = 'none';
      }
    });
  }

  bindScrollHint() {
    if (!this.scrollHint) return;
    const handler = () => this.step(1);
    this.scrollHint.addEventListener('click', handler);
    this.boundHandlers.push(() => this.scrollHint.removeEventListener('click', handler));
  }

  /* ---------------- 背景视频：只让看得见的那一屏在播 ----------------
     背景视频最容易踩的坑是"11 屏同时解码"：手机上既卡又费流量。
     这里的策略：当前屏播放、相邻屏提前挂载、其余屏连 src 都不挂。          */

  /** 挂载视频地址（首次真正需要时才设置 src，避免一次性下载所有背景视频） */
  ensureVideoSrc(video) {
    if (!video || video.getAttribute('src')) return;
    const src = video.dataset?.src;
    if (!src) return;
    video.preload = 'auto';
    video.setAttribute('src', src);
    try {
      video.load?.();
    } catch {
      /* 某些环境（如 jsdom）未实现 load()，忽略 */
    }
  }

  /** 播放视频：自动播放被拦截（未静音 / 省电模式）时静默降级为封面图 */
  playVideo(video) {
    if (!video || prefersReducedMotion()) return;
    this.ensureVideoSrc(video);
    try {
      const promise = video.play?.();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {
      /* 忽略 */
    }
  }

  pauseVideo(video) {
    if (!video || video.paused) return;
    try {
      video.pause?.();
    } catch {
      /* 忽略 */
    }
  }

  /** 只播放 activeIndex 这一屏；-1 表示全部暂停 */
  syncVideos(activeIndex) {
    this.videoEls.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        this.playVideo(video);
        return;
      }
      this.pauseVideo(video);
      // 相邻屏先把地址挂上（不播），切过去时立刻有画面
      if (activeIndex >= 0 && Math.abs(index - activeIndex) === 1) this.ensureVideoSrc(video);
    });
  }

  /** 切到后台标签页时停掉视频：既不浪费电，回来时也能接着播 */
  bindVisibility() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    const handler = () => {
      if (document.hidden) this.syncVideos(-1);
      else if (this.currentIndex >= 0) this.syncVideos(this.currentIndex);
    };
    document.addEventListener('visibilitychange', handler);
    this.boundHandlers.push(() => document.removeEventListener('visibilitychange', handler));
  }

  /* ---------------- 滚轮 / 键盘：一次手势一屏 ---------------- */

  /**
   * 自己接管滚轮：立刻拦下，然后用一条连续的缓动动画走完整整一屏。
   * 这样不会出现"原生吸附先动一点、手势结束再跳过去"的生硬感。
   * 触摸设备不拦（交给 CSS 滚动吸附，手感更自然）。
   */
  bindWheel() {
    const handler = (event) => {
      if (!this.enabled) return;
      if (event.ctrlKey || event.metaKey) return; // 缩放 / 快捷键不拦
      const delta = event.deltaY;
      if (Math.abs(delta) < 3) return;

      event.preventDefault(); // 接管：不让浏览器先滚一点
      if (this.animating) return; // 动画进行中忽略连续滚动
      this.step(delta > 0 ? 1 : -1);
    };
    this.container.addEventListener('wheel', handler, { passive: false });
    this.boundHandlers.push(() => this.container.removeEventListener('wheel', handler));
  }

  /** 键盘：↑↓ / PageUp PageDown / 空格，同样一屏一步 */
  bindKeyboard() {
    const handler = (event) => {
      if (!this.enabled) return;
      if (document.body.dataset.view !== 'home') return;
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      const down = ['ArrowDown', 'PageDown', ' '].includes(event.key) || event.key === 'Spacebar';
      const up = ['ArrowUp', 'PageUp'].includes(event.key);
      if (!down && !up) return;

      event.preventDefault();
      if (this.animating) return;
      this.step(down ? 1 : -1);
    };
    document.addEventListener('keydown', handler);
    this.boundHandlers.push(() => document.removeEventListener('keydown', handler));
  }

  /** 依据真实滚动位置推算当前屏（比依赖观察器更稳，观察器不可用时也能正确翻页） */
  currentIndexFromScroll() {
    const y = this.container.scrollTop;
    let best = 0;
    let bestDist = Infinity;
    this.slideEls.forEach((elm, i) => {
      const dist = Math.abs(elm.offsetTop - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best;
  }

  /** 走一步：+1 下一屏 / -1 上一屏；到边界就把滚动交给页面 */
  step(dir) {
    const last = this.slideEls.length - 1;
    const current = this.currentIndexFromScroll();
    const target = current + dir;

    if (target < 0) return; // 已在首屏：向上不处理（页面本就在顶部）
    if (target > last) {
      // 末屏继续往下：整段交给下方内容区（一次手势到位，不是挪一点）
      this.onExitDown?.();
      return;
    }
    this.goTo(target);
  }

  /** 平滑滚动到指定屏（自己控制动画曲线，手感连续不顿挫） */
  goTo(index) {
    const target = this.slideEls[Math.max(0, Math.min(index, this.slideEls.length - 1))];
    if (!target) return;

    const top = target.offsetTop;
    if (prefersReducedMotion()) {
      this.container.scrollTop = top;
      return;
    }

    // 动画期间临时关掉 CSS 吸附，避免浏览器吸附与动画互相打架
    this.animating = true;
    this.container.classList.add('is-animating');
    this.animateScrollTop(this.container, top, STEP_DURATION, () => {
      this.container.classList.remove('is-animating');
      this.animating = false;
    });
  }

  /** rAF 缓动动画（easeInOutCubic），保证一屏一步顺滑到底 */
  animateScrollTop(el, to, duration, done) {
    cancelAnimationFrame(this.rafId);

    const from = el.scrollTop;
    const delta = to - from;
    if (Math.abs(delta) < 2) {
      el.scrollTop = to;
      done?.();
      return;
    }

    // 用「首帧的 rAF 时间戳」作为基准：避免 performance.now() 与 rAF 时间轴不一致导致进度为负
    let started = null;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

    const tick = (now) => {
      const stamp = typeof now === 'number' ? now : performance.now();
      if (started === null) started = stamp;

      const p = Math.max(0, Math.min(1, (stamp - started) / duration));
      el.scrollTop = from + delta * ease(p);

      if (p < 1) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        el.scrollTop = to;
        this.rafId = null;
        done?.();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopAnimation() {
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.animating = false;
    this.container?.classList.remove('is-animating');
  }

  next() {
    this.goTo(this.currentIndex + 1);
  }

  prev() {
    this.goTo(this.currentIndex - 1);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  /** 兼容旧调用：滚动布局下不再自动轮播 */
  setAutoplay() {
    /* 原生滚动布局无需自动轮播 */
  }

  destroy() {
    this.stopAnimation();
    this.syncVideos(-1);
    this.observer?.disconnect();
    this.observer = null;
    this.boundHandlers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    this.boundHandlers = [];
  }
}