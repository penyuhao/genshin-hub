// js/effects.js — 交互与前景特效
// L4 前景层（元素粒子 + 鼠标拖尾）与 L5 交互层（光晕 + 点击涟漪），以及视差与滚动揭示
import { clamp, isMobileViewport, prefersReducedMotion, qsa } from './util.js';

const GOLD = '232, 200, 119';
const CYAN = '127, 216, 216';

export class Effects {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d', { alpha: true }) || null;

    this.trail = [];
    this.motes = [];
    this.pointer = { x: 0, y: 0, lastX: 0, lastY: 0, moved: false, active: false };
    this.rafId = null;
    this.running = false;
    this.dpr = 1;

    this.features = {
      enableMouseTrail: true,
      enableParticles: true,
      enableParallax: true,
    };

    this.mobile = isMobileViewport();
    this.reduced = prefersReducedMotion();
    this.revealObserver = null;
    this.bound = [];
  }

  init(features = {}) {
    this.features = { ...this.features, ...features };
    this.setupCanvas();
    this.setupPointer();
    this.setupRipples();
    this.setupTopbar();
    this.setupReveal();
    this.setupParallax();
    this.syncParticles();
    this.setupVisibility();

    if (!this.reduced) {
      this.start();
    } else {
      this.renderStatic();
    }
  }

  setupCanvas() {
    if (!this.canvas || !this.ctx) return;
    this.resize();
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.bound.push(() => window.removeEventListener('resize', onResize));
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  setupPointer() {
    const glow = document.getElementById('mouseGlow');
    if (!glow) return;

    // 触摸设备 / 关闭动画 / 关闭开关时不启用鼠标层
    if (this.mobile || this.reduced || !this.features.enableMouseTrail) {
      glow.style.display = 'none';
      return;
    }

    const onMove = (event) => {
      const x = event.clientX;
      const y = event.clientY;
      document.documentElement.style.setProperty('--mouse-x', `${x}px`);
      document.documentElement.style.setProperty('--mouse-y', `${y}px`);

      if (!this.pointer.active) {
        this.pointer.active = true;
        glow.classList.add('is-active');
      }

      // 拖尾：按移动距离采样，避免高速移动时断线
      const dx = x - this.pointer.lastX;
      const dy = y - this.pointer.lastY;
      const distance = Math.hypot(dx, dy);
      if (distance > 4) {
        const steps = clamp(Math.floor(distance / 12), 1, 4);
        for (let i = 0; i < steps; i += 1) {
          this.spawnTrailParticle(
            this.pointer.lastX + (dx * i) / steps,
            this.pointer.lastY + (dy * i) / steps
          );
        }
        this.pointer.lastX = x;
        this.pointer.lastY = y;
      }
    };

    const onLeave = () => {
      this.pointer.active = false;
      glow.classList.remove('is-active');
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    this.bound.push(() => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    });
  }

  spawnTrailParticle(x, y) {
    if (this.trail.length > 90) return;
    this.trail.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35 - 0.12,
      life: 1,
      decay: 0.016 + Math.random() * 0.014,
      size: 1.1 + Math.random() * 1.9,
      color: Math.random() > 0.72 ? CYAN : GOLD,
    });
  }

  /** 元素粒子（飘浮光点 / 花瓣） */
  syncParticles() {
    const target = !this.features.enableParticles ? 0 : this.mobile ? 14 : 34;

    if (this.motes.length > target) this.motes.length = target;
    while (this.motes.length < target) {
      this.motes.push(this.createMote(true));
    }
  }

  createMote(randomY = false) {
    const width = this.width || window.innerWidth;
    const height = this.height || window.innerHeight;
    const gold = Math.random() > 0.35;
    return {
      x: Math.random() * width,
      y: randomY ? Math.random() * height : height + 20,
      vx: (Math.random() - 0.5) * 0.18,
      vy: -(0.14 + Math.random() * 0.42),
      size: (this.mobile ? 1.2 : 1.6) + Math.random() * 2.6,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.004 + Math.random() * 0.008,
      alpha: 0.18 + Math.random() * 0.4,
      color: gold ? GOLD : CYAN,
      spin: Math.random() * Math.PI,
    };
  }

  setupRipples() {
    if (this.reduced) return;

    const onClick = (event) => {
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.clientY < 0 || event.clientX < 0) return;

      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 760);
    };

    document.addEventListener('click', onClick);
    this.bound.push(() => document.removeEventListener('click', onClick));
  }

  setupTopbar() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    let ticking = false;
    const update = () => {
      ticking = false;
      topbar.classList.toggle('is-scrolled', window.scrollY > 24);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    this.bound.push(() => window.removeEventListener('scroll', onScroll));
  }

  /** 滚动揭示（IntersectionObserver，进入视口后依次上浮淡入） */
  setupReveal() {
    if (!('IntersectionObserver' in window)) {
      qsa('[data-reveal]').forEach((elm) => elm.classList.add('is-visible'));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          this.revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    this.observeReveals(document);
  }

  /** 动态渲染后可再次调用 */
  observeReveals(root = document) {
    if (!this.revealObserver) {
      qsa('[data-reveal]', root).forEach((elm) => elm.classList.add('is-visible'));
      return;
    }
    qsa('[data-reveal]', root).forEach((elm, index) => {
      if (elm.classList.contains('is-visible')) return;
      elm.style.transitionDelay = `${Math.min(index * 0.06, 0.36)}s`;
      this.revealObserver.observe(elm);
    });
  }

  /** 视差：背景层移动速度为内容的一半（方案 6.2） */
  setupParallax() {
    if (this.reduced || !this.features.enableParallax) return;

    const aurora = document.querySelector('.layer-aurora');
    const rings = document.querySelector('.layer-rings');
    const factor = this.mobile ? 0.18 : 0.36;

    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const offset = clamp(y * factor, -140, 140);
      if (aurora) aurora.style.transform = `translate3d(0, ${offset * 0.5}px, 0)`;
      if (rings) rings.style.transform = `translate3d(0, ${offset}px, 0)`;

      const slideBg = document.querySelector('.gallery-slide.is-active .slide-bg');
      if (slideBg) {
        const drift = clamp(y * 0.5, 0, 60);
        slideBg.style.setProperty('--parallax-y', `${drift}px`);
      }
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    this.bound.push(() => window.removeEventListener('scroll', onScroll));
  }

  setupVisibility() {
    const onVisibility = () => {
      if (document.hidden) this.stop();
      else if (!this.reduced) this.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.bound.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  setFeature(key, value) {
    this.features[key] = Boolean(value);

    if (key === 'enableMouseTrail') {
      const glow = document.getElementById('mouseGlow');
      if (glow) glow.style.display = value ? '' : 'none';
      if (!value) this.trail.length = 0;
    }
    if (key === 'enableParticles') {
      this.syncParticles();
    }
  }

  start() {
    if (!this.ctx || this.running || this.reduced) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const delta = Math.min((now - this.lastTime) / 16.67, 3);
      this.lastTime = now;
      this.step(delta);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  step(delta) {
    const ctx = this.ctx;
    if (!ctx) return;
    const width = this.width || window.innerWidth;
    const height = this.height || window.innerHeight;

    ctx.clearRect(0, 0, width, height);

    // 元素粒子
    for (const mote of this.motes) {
      mote.sway += mote.swaySpeed * delta * 16.67;
      mote.x += (mote.vx + Math.sin(mote.sway) * 0.28) * delta;
      mote.y += mote.vy * delta;
      mote.spin += 0.01 * delta;

      if (mote.y < -30 || mote.x < -40 || mote.x > width + 40) {
        Object.assign(mote, this.createMote(false), { y: height + 20 });
      }

      ctx.globalAlpha = mote.alpha;
      ctx.fillStyle = `rgb(${mote.color})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 鼠标拖尾
    for (let i = this.trail.length - 1; i >= 0; i -= 1) {
      const particle = this.trail[i];
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.life -= particle.decay * delta;

      if (particle.life <= 0) {
        this.trail.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = particle.life * 0.5;
      ctx.fillStyle = `rgb(${particle.color})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  renderStatic() {
    // 关闭动画时只绘制一帧静态粒子
    if (!this.ctx) return;
    this.resize();
    this.step(1);
  }

  destroy() {
    this.stop();
    this.bound.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    this.bound = [];
    this.revealObserver?.disconnect();
  }
}