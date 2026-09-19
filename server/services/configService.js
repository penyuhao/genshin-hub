// services/configService.js — 配置读写服务（原子写入 + 自动备份 + 内存缓存）
const fs = require('fs').promises;
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../data/config.json');
const BACKUP_DIR = path.join(__dirname, '../data/backups');
const MAX_BACKUPS = 20;

let memoryCache = null;
let memoryCacheMtime = 0;

/** 读取默认配置（config.default.json，缺失时回退空对象） */
async function readDefaults() {
  try {
    const raw = await fs.readFile(path.join(__dirname, '../data/config.default.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** 深合并：对象递归、数组整体替换 */
function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch === null || typeof patch !== 'object') return patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v !== null && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

/** 获取完整配置（带 mtime 校验的内存缓存） */
async function getConfig() {
  const stat = await fs.stat(CONFIG_PATH);
  if (memoryCache && stat.mtimeMs === memoryCacheMtime) return memoryCache;

  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`配置文件损坏：${err.message}`);
  }
  memoryCache = parsed;
  memoryCacheMtime = stat.mtimeMs;
  return parsed;
}

/** 获取单个区块 */
async function getConfigSection(section) {
  const config = await getConfig();
  return Object.prototype.hasOwnProperty.call(config, section) ? config[section] : null;
}

/** 清理超出保留数量的旧备份 */
async function pruneBackups() {
  try {
    const files = (await fs.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('config.') && f.endsWith('.json'))
      .sort();
    const stale = files.slice(0, Math.max(0, files.length - MAX_BACKUPS));
    await Promise.all(stale.map((f) => fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {})));
  } catch {
    /* 备份目录不存在时忽略 */
  }
}

/** 修改前备份当前配置 */
async function backupConfig(config) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `config.${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  await pruneBackups();
  return file;
}

/** 原子写入：先写临时文件再 rename，避免写一半损坏 */
async function atomicWrite(config) {
  const tmp = `${CONFIG_PATH}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(config, null, 2);
  await fs.writeFile(tmp, json, 'utf-8');
  await fs.rename(tmp, CONFIG_PATH);
  const stat = await fs.stat(CONFIG_PATH);
  memoryCache = config;
  memoryCacheMtime = stat.mtimeMs;
}

/**
 * 更新单个区块（浅合并区块内字段，数组整体替换）
 * @returns {{section: object, backup: string}}
 */
async function updateConfigSection(section, data, actor = 'admin') {
  const config = await getConfig();
  const backup = await backupConfig(config);

  const current = config[section];
  config[section] =
    current && typeof current === 'object' && !Array.isArray(current) && data && typeof data === 'object' && !Array.isArray(data)
      ? { ...current, ...data }
      : data;

  config.__meta = {
    ...(config.__meta || {}),
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: actor,
    lastSection: section,
  };

  await atomicWrite(config);
  return { section: config[section], backup: path.basename(backup) };
}

/** 批量更新多个区块 */
async function updateConfigSections(patch, actor = 'admin') {
  const config = await getConfig();
  const backup = await backupConfig(config);

  for (const [section, data] of Object.entries(patch)) {
    const current = config[section];
    config[section] =
      current && typeof current === 'object' && !Array.isArray(current) && data && typeof data === 'object' && !Array.isArray(data)
        ? deepMerge(current, data)
        : data;
  }

  config.__meta = {
    ...(config.__meta || {}),
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: actor,
    lastSection: Object.keys(patch).join(','),
  };

  await atomicWrite(config);
  return { config, backup: path.basename(backup) };
}

/** 恢复备份（管理后台灾难恢复用） */
async function restoreBackup(fileName) {
  const safe = path.basename(fileName);
  if (!/^config\.[0-9A-Za-z\-:.]+\.json$/.test(safe)) throw new Error('备份文件名非法');
  const src = path.join(BACKUP_DIR, safe);
  const data = JSON.parse(await fs.readFile(src, 'utf-8'));
  const current = await getConfig();
  await backupConfig(current);
  await atomicWrite(data);
  return { restored: safe };
}

/** 列出备份文件（新到旧） */
async function listBackups() {
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const out = [];
    for (const f of files.filter((x) => x.startsWith('config.') && x.endsWith('.json'))) {
      const stat = await fs.stat(path.join(BACKUP_DIR, f));
      out.push({ file: f, size: stat.size, mtime: stat.mtime.toISOString() });
    }
    return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  } catch {
    return [];
  }
}

const CONFIG_VERSION = 2;

/** 旧版 4 屏画廊的特征（用于判断用户是否还在用出厂画廊） */
const LEGACY_HERO_IMAGES = ['/images/hero1.svg', '/images/hero2.svg', '/images/hero3.svg', '/images/hero4.svg'];

/** 旧版「关于」出厂内容特征（新增「字体说明」后需要升级） */
const LEGACY_ABOUT_TITLES = ['站点简介', '技术说明', '免责声明', '联系方式'];

/**
 * 配置迁移：
 *  v1 → v2
 *   1) 移除「资讯区」（兑换码 / 卡池活动）—— 未备案站点不提供资讯内容
 *   2) 原资讯区中的快捷链接迁移为独立的 links 区块
 *   3) 画廊从 4 屏升级为「七国 + 挪德卡莱 + 坎瑞亚 + 开场」共 10 屏
 *      （仅当用户仍在使用出厂画廊时才覆盖，避免冲掉自定义内容）
 */
async function migrateConfig(config) {
  let changed = false;

  if (config.news) {
    const legacyLinks = Array.isArray(config.news.links) ? config.news.links : [];
    if (!config.links) {
      config.links = {
        title: '快捷入口',
        subtitle: '常用工具与官方入口，点击新窗口打开',
        items: legacyLinks,
      };
    }
    delete config.news;
    changed = true;
  }

  const slides = config.hero?.slides;
  const isLegacyGallery =
    Array.isArray(slides) &&
    slides.length <= LEGACY_HERO_IMAGES.length &&
    slides.every((slide) => LEGACY_HERO_IMAGES.includes(slide?.bgImage));

  const aboutSections = config.about?.sections;
  const isLegacyAbout =
    Array.isArray(aboutSections) &&
    aboutSections.length === LEGACY_ABOUT_TITLES.length &&
    aboutSections.every((section, index) => section?.title === LEGACY_ABOUT_TITLES[index]);

  if (isLegacyGallery || isLegacyAbout) {
    const defaults = await readDefaults();

    if (isLegacyGallery && Array.isArray(defaults.hero?.slides) && defaults.hero.slides.length > slides.length) {
      config.hero = { ...config.hero, slides: defaults.hero.slides };
      changed = true;
    }

    if (isLegacyAbout && Array.isArray(defaults.about?.sections) && defaults.about.sections.length > aboutSections.length) {
      config.about = { ...config.about, sections: defaults.about.sections };
      changed = true;
    }
  }

  if (config.__meta?.version !== CONFIG_VERSION) {
    config.__meta = { ...(config.__meta || {}), version: CONFIG_VERSION };
    changed = true;
  }

  return changed;
}

/** 首次启动时若 config.json 缺失，则用默认配置生成；存在则执行迁移 */
async function ensureConfigFile() {
  let existed = true;
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    existed = false;
    const defaults = await readDefaults();
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    memoryCache = null;
  }

  const config = await getConfig();
  if (existed) {
    const changed = await migrateConfig(config);
    if (changed) {
      await backupConfig(config);
      await atomicWrite(config);
      console.log('[config] 配置已迁移到 v2（移除资讯区 / 快捷链接独立 / 画廊升级）');
    }
  }

  return getConfig();
}

module.exports = {
  CONFIG_PATH,
  BACKUP_DIR,
  getConfig,
  getConfigSection,
  updateConfigSection,
  updateConfigSections,
  restoreBackup,
  listBackups,
  ensureConfigFile,
  deepMerge,
};