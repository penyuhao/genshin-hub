// js/util.js — 通用工具（DOM 创建、提示、防抖等）
// 安全约定：所有来自配置/接口的文本一律走 textContent，绝不拼接 innerHTML

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * 创建元素（安全版）
 * el('div', { class: 'x', text: '内容', onclick: fn, dataset: { id: 1 } }, child1, child2)
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        if (val === null || val === undefined) continue;
        // 支持 CSS 自定义属性（--xxx）
        if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
        else node.style[prop] = val;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 判断文本是否值得渲染（避免空标题占位） */
export function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isMobileViewport() {
  return window.matchMedia('(max-width: 767px)').matches;
}

export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function debounce(fn, wait = 160) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 具体日期 */
export function formatRelativeTime(input) {
  const time = typeof input === 'number' ? input : Date.parse(input);
  if (!time || Number.isNaN(time)) return '--';

  const diff = Date.now() - time;
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  if (diff < 2_592_000_000) return `${Math.round(diff / 86_400_000)} 天前`;

  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatClock(input) {
  const time = typeof input === 'number' ? input : Date.parse(input);
  if (!time || Number.isNaN(time)) return '--';
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 秒数 → 易读时长：3 天 5 小时 / 2 小时 8 分 / 45 秒 */
export function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '--';

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${Math.floor(total % 60)} 秒`;
  return `${Math.floor(total)} 秒`;
}

/** 复制到剪贴板（含降级方案） */
export async function copyText(value) {
  const text = String(value ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续降级 */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 轻提示 */
export function toast(message, type = 'info', duration = 2800) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;

  const node = el('div', { class: `toast is-${type}`, role: 'status', text: String(message) });
  wrap.appendChild(node);

  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 320);
  }, duration);
}

/** 带超时的 fetch（兼容不支持 AbortSignal.timeout 的环境） */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 生成一个安全的 SVG 折线图（心跳趋势） */
export function buildSparkline(history, { width = 240, height = 30 } = {}) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const beats = Array.isArray(history) ? history.filter((b) => b && b.status !== undefined) : [];
  if (beats.length < 2) return svg;

  const pings = beats.map((b) => (typeof b.ping === 'number' ? b.ping : null));
  const numeric = pings.filter((p) => p !== null);
  const max = numeric.length ? Math.max(...numeric) : 100;
  const min = numeric.length ? Math.min(...numeric) : 0;
  const span = Math.max(1, max - min);
  const stepX = width / (beats.length - 1);

  const points = [];
  beats.forEach((beat, index) => {
    const x = index * stepX;
    const ping = typeof beat.ping === 'number' ? beat.ping : null;
    const y = ping === null ? height - 2 : height - 3 - ((ping - min) / span) * (height - 8);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);

    if (beat.status !== 1) {
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', (height - 4).toFixed(1));
      dot.setAttribute('r', '2.2');
      dot.setAttribute('class', beat.status === 0 ? 'beat-down' : 'beat-pending');
      svg.appendChild(dot);
    }
  });

  const polyline = document.createElementNS(svgNS, 'polyline');
  polyline.setAttribute('points', points.join(' '));
  svg.appendChild(polyline);
  return svg;
}