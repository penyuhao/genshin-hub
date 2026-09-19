// js/gallery.js — 首页画廊：11 屏纵向堆叠，**原生滚动**（一条滚下来）
//
// 布局模型：每一屏都是 min-height:100svh 的普通区块，页面自然向下滚动。
//   不再劫持滚轮、不再有"界面切换"感，刷新后滚动位置由浏览器正确恢复。
//
// 仍然保留的体验：
//   • 逐字浮现标题（进入视口时触发）
//   • Ken Burns 背景缓慢缩放（仅当前屏播放，省电）
//   • 圆点导航（桌面端右侧固定竖排，点击平滑跳转）
//   • 首屏「向下浏览」提示（滚过首屏自动隐藏）
//   • 键盘 ↑/↓ 与 PageUp/PageDown 原生滚动
import { el, clear, qsa, hasText, prefersReducedMotion } from './util.js';
import { fontClassOf } from './fonts.js';

/** 判定"当前屏"的可见比例阈值 */
const ACTIVE_RATIO = 0.45;

export class Gallery {
  constructor({ container, dots, scrollHint, onCta, onSlideChange }) {
    this.container = container;
    this.dotsContainer = dots;
    this.scrollHint = scrollHint;
    this.onCta = onCta;
    this.onSlideChange = onSlideChange;

    this.slides = [];
    this.slideEls = [];
    this.dots = [];
    this.currentIndex = -1;
    this.enabled = true;
    this.observer = null;
    this.ratios = new Map();
    this.animatedIn = new Set();
    this.boundHandlers = [];
  }

  /** 依据配置渲染所有屏（纵向堆叠） */
  render(slides = []) {
    this.slides = Array.isArray(slides) ? slides.filter(Boolean) : [];
    clear(this.container);
    clear(this.dotsContainer);
    this.slideEls = [];
    this.dots = [];
    this.animatedIn.clear();
    this.ratios.clear();
    this.currentIndex = -1;

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
      const slideEl = el('section', {
        class: 'gallery-slide',
        dataset: { index: String(index) },
        'aria-label': hasText(titleText) ? titleText : `第 ${index + 1} 屏`,
      });

      // 背景（自己铺满所属区块）
      slideEl.appendChild(
        el('div', {
          class: 'slide-bg',
          style: slide.bgImage
            ? { backgroundImage: `url("${String(slide.bgImage).replace(/["()\\]/g, '')}")` }
            : {},
          'aria-hidden': 'true',
        })
      );

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
        title.appendChild(el('span', { class: 'title-shine', 'aria-hidden': 'true' }));
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
        let best = this.currentIndex;
        let bestRatio = ACTIVE_RATIO;
        for (const [index, ratio] of this.ratios) {
          if (ratio > bestRatio) {
            best = index;
            bestRatio = ratio;
          }
        }
        if (best !== this.currentIndex && best >= 0) {
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
    const handler = () => this.goTo(Math.min(this.currentIndex + 1, this.slideEls.length - 1));
    this.scrollHint.addEventListener('click', handler);
    this.boundHandlers.push(() => this.scrollHint.removeEventListener('click', handler));
  }

  /** 平滑滚动到指定屏（原生滚动，不劫持滚轮） */
  goTo(index) {
    const target = this.slideEls[Math.max(0, Math.min(index, this.slideEls.length - 1))];
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    } else {
      // 极端降级：直接改滚动位置
      window.scrollTo({ top: target.offsetTop, behavior: 'auto' });
    }
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