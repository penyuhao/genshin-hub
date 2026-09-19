// js/config.js — 站点配置加载（后端优先 → localStorage 兜底 → 内置默认值）
import { fetchWithTimeout } from './util.js';

const STORAGE_KEY = 'genshinHub.config.v1';
/** 跨标签页同步用的版本号：后台保存后写一次，其它标签页靠 storage 事件收到通知 */
const REVISION_KEY = 'genshinHub.config.rev';

/** 内置兜底配置：后端完全不可用时站点仍可打开 */
export const DEFAULT_CONFIG = {
  site: {
    title: '原神功能快捷站',
    subtitle: '提瓦特旅行者手册',
    logo: '/images/logo.svg',
    favicon: '/images/favicon.svg',
    footer: '非官方粉丝站点 · 游戏素材版权归米哈游所有',
  },
  hero: {
    slides: [
      {
        title: '原神',
        subtitle: 'TEYVAT',
        desc: '提瓦特旅行者手册',
        bgImage: '/images/hero1.svg',
        font: 'Teyvat Neue',
        textColor: '#e8c877',
        cta: '',
        ctaView: 'home',
      },
      {
        title: '璃月',
        subtitle: 'LIYUE',
        desc: '千岩牢固，重嶂不移',
        bgImage: '/images/hero2.svg',
        font: 'Khaenriah Neue',
        textColor: '#ffd97d',
      },
      {
        title: '稻妻',
        subtitle: 'INAZUMA',
        desc: '常道恢弘，鸣神永恒',
        bgImage: '/images/hero3.svg',
        font: 'Inazuma Neue',
        textColor: '#c9a6ff',
      },
      {
        title: '须弥',
        subtitle: 'SUMERU',
        desc: '智慧之城，雨林之梦',
        bgImage: '/images/hero4.svg',
        font: 'Sumeru',
        textColor: '#9be8b0',
        cta: '进入网站',
        ctaView: 'tools',
      },
    ],
    autoplay: 0,
  },
  theme: {
    primaryColor: '#e8c877',
    accentColor: '#7fd8d8',
    bgColor: '#0b1020',
    bgColor2: '#12172b',
    textColor: '#f0ece0',
    textMuted: '#9aa0b5',
    upColor: '#4ade80',
    downColor: '#ef4444',
    radius: 14,
    cardShadow: '0 12px 40px rgba(0, 0, 0, 0.45)',
    overlayStrength: 0.9,
  },
  navigation: {
    items: [
      { label: '首页', view: 'home', visible: true },
      { label: '下载', view: 'download', visible: true },
      { label: '功能', view: 'tools', visible: true },
      { label: '关于', view: 'about', visible: true },
    ],
  },
  features: {
    enableBackgroundMusic: false,
    enableStarfield: true,
    enableStarRings: true,
    enableMoon: true,
    enableParticles: true,
    enableMouseTrail: true,
    enableKumaPanel: true,
    enableParallax: true,
  },
  music: { url: '', volume: 0.35, autoplay: false },
  download: { cards: [] },
  about: { sections: [] },
  links: { title: '快捷入口', subtitle: '', items: [] },
  fonts: { custom: [] },
};

function mergeConfig(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) out[key] = value;
    else if (value && typeof value === 'object') out[key] = mergeConfig(base[key] || {}, value);
    else out[key] = value;
  }
  return out;
}

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), config }));
  } catch {
    /* 隐私模式下忽略 */
  }
}

/**
 * 加载配置：**始终以服务端为准**，本地缓存只在接口不可用时兜底。
 *
 * 这里以前有个 5 分钟 TTL：缓存没过期就直接用缓存、连请求都不发。
 * 后果是后台改完配置，另一个标签页 / 刚刷新的页面在 5 分钟内依旧渲染旧配置，
 * 看起来就是"保存了但不生效"。配置接口本身就带 ETag（没变返回 304），
 * 每次问一下服务端几乎没有代价，所以 TTL 直接去掉了。
 *
 * @param {{ force?: boolean }} options 保留参数以兼容旧调用（现在无论如何都是最新）
 * @returns {Promise<{config: object, source: 'api'|'cache'|'default'}>}
 */
export async function loadConfig({ force = false } = {}) {
  const cached = readCache();
  void force;

  try {
    const res = await fetchWithTimeout('/api/config', { headers: { Accept: 'application/json' } }, 6000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    writeCache(config);
    return { config: mergeConfig(DEFAULT_CONFIG, config), source: 'api' };
  } catch (err) {
    if (cached) {
      console.warn('[config] 接口不可用，使用本地缓存：', err.message);
      return { config: mergeConfig(DEFAULT_CONFIG, cached.config), source: 'cache' };
    }
    console.warn('[config] 接口不可用，使用内置默认配置：', err.message);
    return { config: DEFAULT_CONFIG, source: 'default' };
  }
}

/**
 * 清空本地配置缓存并广播一个版本号。
 * 后台保存后调用：本标签页立即重渲染，**其它已打开的标签页**会收到 storage 事件，
 * 也去重新拉一次配置（否则会出现"这个标签页是新的、那个标签页还是旧的"）。
 */
export function invalidateConfigCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(REVISION_KEY, `${Date.now()}`);
  } catch {
    /* 隐私模式下忽略 */
  }
}

/** 其它标签页更新配置时的事件键（main.js 用它监听） */
export const CONFIG_REVISION_KEY = REVISION_KEY;

/** 把主题配置写入 CSS 变量 */
export function applyTheme(theme = {}) {
  const root = document.documentElement;
  const map = {
    '--gold': theme.primaryColor,
    '--gold-bright': theme.primaryColor,
    '--cyan': theme.accentColor,
    '--bg': theme.bgColor,
    '--bg-2': theme.bgColor2,
    '--text': theme.textColor,
    '--text-muted': theme.textMuted,
    '--up': theme.upColor,
    '--down': theme.downColor,
    '--radius': theme.radius !== undefined ? `${theme.radius}px` : undefined,
    '--card-shadow': theme.cardShadow,
    // 背景遮罩强度：画廊文字可读性的总开关
    '--scrim': theme.overlayStrength !== undefined ? String(theme.overlayStrength) : undefined,
  };

  for (const [name, value] of Object.entries(map)) {
    if (value === undefined || value === null || value === '') continue;
    root.style.setProperty(name, String(value));
  }

  // 同步浏览器主题色
  if (theme.bgColor) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme.bgColor);
  }
}

/** 站点元信息：标题 / favicon / 描述 */
export function applySiteMeta(site = {}) {
  if (site.title) {
    document.title = site.subtitle ? `${site.title} · ${site.subtitle}` : site.title;
  }
  if (site.favicon) {
    const link = document.getElementById('faviconLink');
    if (link) link.setAttribute('href', site.favicon);
  }
}