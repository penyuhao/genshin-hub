// services/fontService.js — 字体自动发现
// 扫描三处并把文件名解析为 CSS 字族名：
//   1) FRONTEND_DIR/fonts           随代码发布的字体（只读）
//   2) FRONTEND_DIR/fonts/uploads   旧版上传目录（兼容已有部署）
//   3) DATA_DIR/uploads/fonts       当前上传目录（可写卷，容器友好）
// 前端启动时拉取该列表并动态注入 @font-face，因此「把字体丢进目录即可生效」。
const fs = require('fs').promises;
const path = require('path');
const paths = require('../paths');

const FONT_DIR = paths.FONT_DIR;
const LEGACY_UPLOAD_DIR = paths.LEGACY_FONT_UPLOAD_DIR;
const UPLOAD_DIR = paths.FONT_UPLOAD_DIR;
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

const CATEGORY_HINTS = [
  ['teyvat', 'Teyvat'],
  ['inazuma', 'Inazuma'],
  ['khaenriah', 'Khaenriah'],
  ["khaenri'ah", 'Khaenriah'],
  ['sumeru', 'Sumeru'],
  ['deshret', 'Deshret'],
  ['chasm', 'Khaenriah'],
];

/** 'TeyvatNeue.ttf' → 'Teyvat Neue'；'Teyvat-Neue_v2.woff2' → 'Teyvat Neue v2' */
function familyFromFile(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  return base
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryOf(fileName) {
  const lower = fileName.toLowerCase();
  for (const [hint, category] of CATEGORY_HINTS) {
    if (lower.includes(hint)) return category;
  }
  return 'Other';
}

/** 扫描单个目录，返回字体条目；urlPrefix 决定前端可访问的路径 */
async function scanDir(dir, source, urlPrefix) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!FONT_EXTS.has(ext)) continue;

    out.push({
      family: familyFromFile(entry.name),
      file: `${urlPrefix}/${encodeURIComponent(entry.name)}`,
      format: ext.slice(1),
      category: categoryOf(entry.name),
      source,
    });
  }
  return out;
}

/** 列出可用字体（代码内置 + 旧版上传 + 新版上传），同名字族去重 */
async function listFonts() {
  const [builtin, legacy, uploaded] = await Promise.all([
    scanDir(FONT_DIR, 'builtin', '/fonts'),
    scanDir(LEGACY_UPLOAD_DIR, 'upload', '/fonts/uploads'),
    scanDir(UPLOAD_DIR, 'upload', paths.FONT_URL_PREFIX),
  ]);

  const seen = new Set();
  const merged = [];
  for (const font of [...builtin, ...legacy, ...uploaded]) {
    const key = font.family.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(font);
  }
  return merged.sort((a, b) => a.family.localeCompare(b.family));
}

/** 确保上传目录存在 */
async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

module.exports = {
  listFonts,
  ensureDirs,
  familyFromFile,
  categoryOf,
  FONT_DIR,
  UPLOAD_DIR,
  LEGACY_UPLOAD_DIR,
};
