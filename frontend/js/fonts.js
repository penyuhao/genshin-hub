// js/fonts.js — 字体自动发现与运行时 @font-face 注入
// 后端扫描 frontend/fonts（含 uploads），前端据此生成 @font-face。
// 因此：把 ttf/otf/woff/woff2 放进目录或用管理后台上传，刷新即生效。
import { fetchWithTimeout } from './util.js';

const FORMAT_MAP = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
};

/** 防注入：只保留安全字符 */
function sanitize(value) {
  return String(value ?? '')
    .replace(/[\\'"<>;{}()]/g, '')
    .trim();
}

function sanitizeUrl(value) {
  const url = String(value ?? '').trim();
  if (!/^\/[A-Za-z0-9._\-/]*$/.test(url)) return '';
  if (url.includes('..')) return '';
  return url;
}

let discovered = [];

/** 拉取字体清单并注入 @font-face */
export async function initFonts() {
  try {
    const res = await fetchWithTimeout('/api/fonts', { headers: { Accept: 'application/json' } }, 5000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    discovered = Array.isArray(data.fonts) ? data.fonts : [];
    injectFontFaces(discovered);
    return discovered;
  } catch (err) {
    console.warn('[fonts] 字体清单不可用，使用系统字体回退：', err.message);
    discovered = [];
    return [];
  }
}

function injectFontFaces(fonts) {
  const rules = [];

  for (const font of fonts) {
    const family = sanitize(font?.family);
    const file = sanitizeUrl(font?.file);
    if (!family || !file) continue;
    const format = FORMAT_MAP[String(font?.format || '').toLowerCase()] || 'truetype';
    rules.push(
      `@font-face{font-family:'${family}';src:url('${file}') format('${format}');font-display:swap;font-style:normal;font-weight:400 700;}`
    );
  }

  const existing = document.getElementById('dynamic-font-faces');
  if (existing) existing.remove();
  if (!rules.length) return;

  const style = document.createElement('style');
  style.id = 'dynamic-font-faces';
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

/**
 * 把配置里的字体名解析为实际可用的字族名
 * 例如配置写 "Teyvat Neue"，实际字体文件叫 "Teyvat Black" → 返回 'Teyvat Black'
 */
export function resolveFontFamily(name) {
  const target = String(name ?? '').trim();
  if (!target) return '';

  const lower = target.toLowerCase();
  const exact = discovered.find((f) => f.family.toLowerCase() === lower);
  if (exact) return exact.family;

  // 前缀/关键词匹配（Teyvat Neue → Teyvat Black）
  const keyword = lower.split(/\s+/)[0];
  const partial = discovered.find((f) => f.family.toLowerCase().startsWith(keyword));
  if (partial) return partial.family;

  return target; // 交给 CSS 回退链处理
}

/** 当前可用字体列表（管理后台表单用） */
export function getDiscoveredFonts() {
  return discovered.slice();
}

/** 配置里的字体名 → CSS 类名（.font-teyvat / .font-inazuma ...） */
export function fontClassOf(fontName) {
  const name = String(fontName ?? '').toLowerCase();
  if (!name || name.includes('system') || name.includes('noto') || name.includes('serif')) return 'font-system';
  if (name.includes('ainee')) return 'font-ainee';
  if (name.includes('teyvat')) return 'font-teyvat';
  if (name.includes('inazuma')) return 'font-inazuma';
  if (name.includes('khaenri') || name.includes('chasm')) return 'font-khaenriah';
  if (name.includes('sumeru')) return 'font-sumeru';
  if (name.includes('deshret')) return 'font-deshret';
  return 'font-teyvat';
}