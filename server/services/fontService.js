// services/fontService.js — 字体自动发现
// 扫描 frontend/fonts（含 uploads 子目录），把文件名解析为 CSS 字族名。
// 前端启动时拉取该列表并动态注入 @font-face，因此「把 ttf 丢进目录即可生效」。
const fs = require('fs').promises;
const path = require('path');

const FONT_DIR = path.join(__dirname, '../../frontend/fonts');
const UPLOAD_DIR = path.join(FONT_DIR, 'uploads');
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

const CATEGORY_HINTS = [
  ['teyvat', 'Teyvat'],
  ['inazuma', 'Inazuma'],
  ['khaenriah', 'Khaenriah'],
  ['khaenri\'ah', 'Khaenriah'],
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

async function scanDir(dir, source) {
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

    const rel = path.relative(FONT_DIR, path.join(dir, entry.name)).split(path.sep).join('/');
    out.push({
      family: familyFromFile(entry.name),
      file: `/fonts/${rel}`,
      format: ext.slice(1),
      category: categoryOf(entry.name),
      source,
    });
  }
  return out;
}

/** 列出可用字体（内置目录 + 上传目录） */
async function listFonts() {
  const [builtin, uploaded] = await Promise.all([scanDir(FONT_DIR, 'builtin'), scanDir(UPLOAD_DIR, 'upload')]);
  return [...builtin, ...uploaded].sort((a, b) => a.family.localeCompare(b.family));
}

/** 确保上传目录存在 */
async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

module.exports = { listFonts, ensureDirs, FONT_DIR, UPLOAD_DIR, familyFromFile, categoryOf };