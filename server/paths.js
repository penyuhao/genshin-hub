// paths.js — 全项目路径与目录管理（可移植性核心）
//
// 设计目标：仓库拷到任何机器 / 任何平台都能跑，不依赖绝对路径、不依赖代码目录可写。
//
//   DATA_DIR       运行时数据（配置 / 凭据 / 备份 / 上传），默认 server/data
//                  → 容器或 PaaS 上把它指到挂载卷即可持久化，代码目录可只读
//   FRONTEND_DIR   静态资源根目录，默认 ../frontend
//   UPLOAD_DIR     后台上传的图片 / 字体 / 背景视频，默认 DATA_DIR/uploads
//   CONFIG_DEFAULT 出厂默认配置（随代码走，不随 DATA_DIR 变）
//
// 所有需要写的目录都会由 ensureDirs() 统一创建。
const path = require('path');
const fs = require('fs').promises;

const CODE_DIR = __dirname; // server/
const PROJECT_ROOT = path.join(CODE_DIR, '..');

function resolveFromRoot(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(PROJECT_ROOT, raw);
}

const DATA_DIR = resolveFromRoot(process.env.DATA_DIR, path.join(CODE_DIR, 'data'));
const FRONTEND_DIR = resolveFromRoot(process.env.FRONTEND_DIR, path.join(PROJECT_ROOT, 'frontend'));
const UPLOAD_DIR = resolveFromRoot(process.env.UPLOAD_DIR, path.join(DATA_DIR, 'uploads'));

const paths = {
  PROJECT_ROOT,
  CODE_DIR,
  DATA_DIR,
  FRONTEND_DIR,
  UPLOAD_DIR,

  // ---- 运行时数据（可写卷）----
  CONFIG_PATH: path.join(DATA_DIR, 'config.json'),
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  AUTH_PATH: path.join(DATA_DIR, 'auth.json'),
  KUMA_PATH: path.join(DATA_DIR, 'kuma.json'),
  SECRETS_PATH: path.join(DATA_DIR, 'secrets.json'),
  LOG_DIR: path.join(DATA_DIR, 'logs'),

  // ---- 出厂模板（随代码，只读）----
  CONFIG_DEFAULT_PATH: path.join(CODE_DIR, 'data', 'config.default.json'),

  // ---- 上传目录（写进数据卷）----
  IMAGE_UPLOAD_DIR: path.join(UPLOAD_DIR, 'images'),
  FONT_UPLOAD_DIR: path.join(UPLOAD_DIR, 'fonts'),
  VIDEO_UPLOAD_DIR: path.join(UPLOAD_DIR, 'videos'),

  // ---- 静态资源（随代码，只读）----
  FONT_DIR: path.join(FRONTEND_DIR, 'fonts'),
  LEGACY_IMAGE_UPLOAD_DIR: path.join(FRONTEND_DIR, 'images/uploads'),
  LEGACY_FONT_UPLOAD_DIR: path.join(FRONTEND_DIR, 'fonts/uploads'),

  // ---- 上传后的公开 URL 前缀 ----
  IMAGE_URL_PREFIX: '/uploads/images',
  FONT_URL_PREFIX: '/uploads/fonts',
  VIDEO_URL_PREFIX: '/uploads/videos',
};

/** 需要存在且可写的目录 */
const REQUIRED_DIRS = [
  paths.DATA_DIR,
  paths.BACKUP_DIR,
  paths.IMAGE_UPLOAD_DIR,
  paths.FONT_UPLOAD_DIR,
  paths.VIDEO_UPLOAD_DIR,
];

let prepared = false;

/** 创建所有必需目录；返回数据目录是否可写（用于启动自检提示） */
async function ensureDirs() {
  for (const dir of REQUIRED_DIRS) {
    await fs.mkdir(dir, { recursive: true });
  }
  prepared = true;
  return { dataDir: paths.DATA_DIR, uploadDir: paths.UPLOAD_DIR };
}

/** 可写性自检：数据目录不可写时给出明确提示而不是运行时崩 */
async function checkWritable() {
  const probe = path.join(paths.DATA_DIR, `.write-probe-${process.pid}`);
  try {
    await fs.writeFile(probe, 'ok', 'utf-8');
    await fs.unlink(probe);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { ...paths, ensureDirs, checkWritable, isPrepared: () => prepared };