// js/gallery.js — 首页画廊：4 屏纵向滚动切换 + 逐字标题 + Ken Burns + 圆点导航
import { el, clear, qsa, hasText, clamp, prefersReducedMotion } from './util.js';
import { fontClassOf } from './fonts.js';

const SWITCH_LOCK_MS = 850;

export class Gallery {
  constructor({ container, dots, scrollHint, onCta, onExitDown }) {
    this.container = container;
    this.dotsContainer = dots;
    this.scrollHint = scrollHint;
    this.onCta = onCta;
    this.onExitDown = onExitDown;

    this.slides = [];
    this.slideEls = [];
    this.currentIndex = 0;
    this.locked = false;
    this.autoplayTimer = null;
    this.autoplayMs = 0;
    this.enabled = true;
    this.boundHandlers = [];
  }

  /** 依据配置渲染所有屏 */
  render(slides = [], { autoplay = 0 } = {}) {
    this.slides = Array.isArray(slides) ? slides.filter(Boolean) : [];
    clear(this.container);
    clear(this.dotsContainer);
    this.slideEls = [];

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
      const title = el('h1', {
        class: `slide-title ${fontClassOf(slide.font)}`,
        style: slide.textColor ? { color: slide.textColor } : {},
        'data-text': titleText,
      });

      if (hasText(titleText)) {
        const span = el('span', { class: 'title-text' });
        for (const char of Array.from(titleText)) {
          span.appendChild(el('span', { class: 'char', text: char }));
        }
        title.appendChild(span);
        title.appendChild(el('span', { class: 'title-shine', 'aria-hidden': 'true' }));
      }

      const content = el('div', { class: 'slide-content' }, title);

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

      const slideEl = el('div', {
        class: `gallery-slide${index === 0 ? ' is-active' : ''}`,
        dataset: { index: String(index) },
        'aria-hidden': index === 0 ? 'false' : 'true',
      },
        el('div', {
          class: 'slide-bg',
          style: slide.bgImage ? { backgroundImage: `url("${String(slide.bgImage).replace(/["()\\]/g, '')}")` } : {},
          'aria-hidden': 'true',
        }),
        content
      );

      this.slideEls.push(slideEl);
      this.container.appendChild(slideEl);

      const dot = el('button', {
        class: `gallery-dot${index === 0 ? ' is-active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-label': `第 ${index + 1} 屏${hasText(slide.title) ? `：${slide.title}` : ''}`,
        'aria-selected': index === 0 ? 'true' : 'false',
        onclick: () => this.goTo(index),
      });
      this.dotsContainer.appendChild(dot);
    });

    this.currentIndex = 0;
    this.animateTitle(0);
    this.bindInteractions();
    this.setAutoplay(autoplay);

    if (this.scrollHint) {
      // ↓ 一键跳到画廊下方的服务状态区
      const hintHandler = () => this.onExitDown?.();
      this.scrollHint.addEventListener('click', hintHandler);
      this.boundHandlers.push(() => this.scrollHint.removeEventListener('click', hintHandler));
    }
  }

  /** 滚轮 / 触摸 / 键盘 */
  bindInteractions() {
    const wheelHandler = (event) => {
      if (!this.enabled || this.slides.length < 2) return;
      const delta = event.deltaY;
      if (Math.abs(delta) < 3) return;

      const dir = delta > 0 ? 1 : -1;
      const nextIndex = this.currentIndex + dir;
      const canSwitch = nextIndex >= 0 && nextIndex < this.slideEls.length;

      if (!canSwitch) {
        // 最后一屏继续下滑：一步跳到画廊下方内容（不再逐像素拖动页面）
        if (dir > 0) {
          event.preventDefault();
          if (this.locked) return;
          this.locked = true;
          setTimeout(() => { this.locked = false; }, SWITCH_LOCK_MS);
          this.onExitDown?.();
        }
        return; // 第一屏继续上滑：放行原生滚动
      }

      event.preventDefault();
      if (this.locked) return;
      this.goTo(nextIndex, { fromWheel: true });
    };
    this.container.addEventListener('wheel', wheelHandler, { passive: false });
    this.boundHandlers.push(() => this.container.removeEventListener('wheel', wheelHandler));

    // 触摸：仅在「可切换」方向拦截，边界处保留原生滚动
    let startX = 0;
    let startY = 0;
    let swiping = false;

    const touchStart = (event) => {
      if (!this.enabled || this.slides.length < 2 || event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      swiping = false;
    };

    const touchMove = (event) => {
      if (!this.enabled || this.slides.length < 2 || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!swiping) {
        if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(dx) * 1.2) return; // 交给原生滚动
        const dir = dy < 0 ? 1 : -1;
        const nextIndex = this.currentIndex + dir;
        if (nextIndex < 0 || nextIndex >= this.slideEls.length) return; // 边界放行
        swiping = true;
      }
      event.preventDefault();
    };

    const touchEnd = (event) => {
      if (!swiping || !this.enabled) return;
      const touch = event.changedTouches[0];
      const dy = startY - touch.clientY;
      if (Math.abs(dy) > 44) {
        const dir = dy > 0 ? 1 : -1;
        this.goTo(this.currentIndex + dir);
      }
      swiping = false;
    };

    this.container.addEventListener('touchstart', touchStart, { passive: true });
    this.container.addEventListener('touchmove', touchMove, { passive: false });
    this.container.addEventListener('touchend', touchEnd, { passive: true });
    this.boundHandlers.push(() => {
      this.container.removeEventListener('touchstart', touchStart);
      this.container.removeEventListener('touchmove', touchMove);
      this.container.removeEventListener('touchend', touchEnd);
    });

    // 键盘：仅在首页视图激活时生效
    const keyHandler = (event) => {
      if (!this.enabled) return;
      if (document.body.dataset.view !== 'home') return;
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        if (this.currentIndex < this.slideEls.length - 1) this.goTo(this.currentIndex + 1);
        else this.onExitDown?.();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
        if (this.currentIndex > 0) {
          event.preventDefault();
          this.goTo(this.currentIndex - 1);
        }
      }
    };
    document.addEventListener('keydown', keyHandler);
    this.boundHandlers.push(() => document.removeEventListener('keydown', keyHandler));
  }

  goTo(index, { fromWheel = false } = {}) {
    const target = clamp(index, 0, this.slideEls.length - 1);
    if (target === this.currentIndex) return;

    this.currentIndex = target;
    this.locked = true;
    setTimeout(() => { this.locked = false; }, fromWheel ? SWITCH_LOCK_MS : 420);

    this.slideEls.forEach((slideEl, i) => {
      const active = i === target;
      slideEl.classList.toggle('is-active', active);
      slideEl.setAttribute('aria-hidden', active ? 'false' : 'true');
    });

    qsa('.gallery-dot', this.dotsContainer).forEach((dot, i) => {
      dot.classList.toggle('is-active', i === target);
      dot.setAttribute('aria-selected', i === target ? 'true' : 'false');
    });

    this.animateTitle(target);
    this.restartAutoplay();
  }

  next() {
    if (this.currentIndex < this.slideEls.length - 1) this.goTo(this.currentIndex + 1);
    else this.goTo(0);
  }

  /** 逐字浮现：每个字从下往上 + 淡入，错开 60ms */
  animateTitle(index) {
    const slideEl = this.slideEls[index];
    if (!slideEl) return;

    const chars = qsa('.char', slideEl);
    if (!chars.length) return;

    chars.forEach((char, i) => {
      char.style.animation = 'none';
      char.style.opacity = prefersReducedMotion() ? '1' : '0';
      char.style.transform = prefersReducedMotion() ? 'none' : 'translate3d(0, 0.5em, 0)';
    });

    // 强制重排后重新播放
    void slideEl.offsetWidth;

    chars.forEach((char, i) => {
      char.style.animation = '';
      char.style.animationDelay = `${i * 0.06}s`;
      if (prefersReducedMotion()) {
        char.style.opacity = '1';
        char.style.transform = 'none';
      }
    });
  }

  setAutoplay(ms) {
    this.autoplayMs = Number(ms) > 0 ? Number(ms) : 0;
    this.stopAutoplay();
    if (this.autoplayMs > 0 && !prefersReducedMotion()) {
      this.startAutoplay();
    }
  }

  startAutoplay() {
    this.stopAutoplay();
    if (this.autoplayMs <= 0) return;
    this.autoplayTimer = setInterval(() => {
      if (document.hidden) return;
      this.next();
    }, this.autoplayMs);
  }

  stopAutoplay() {
    if (this.autoplayTimer) {
      clearInterval(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  restartAutoplay() {
    if (this.autoplayMs > 0) this.startAutoplay();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  destroy() {
    this.stopAutoplay();
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