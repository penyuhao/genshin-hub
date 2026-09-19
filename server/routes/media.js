// routes/media.js — 字体清单 + 图片/字体上传（管理员）
// 上传文件写入 DATA_DIR/uploads（可挂载卷），通过 /uploads 静态服务对外提供
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');
const fontService = require('../services/fontService');
const paths = require('../paths');

const IMAGE_DIR = paths.IMAGE_UPLOAD_DIR;
const FONT_DIR = paths.FONT_UPLOAD_DIR;

const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

const FONT_TYPES = new Map([
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function makeStorage(dir) {
  return multer.diskStorage({
    destination(req, file, cb) {
      // 目录可能因卷挂载顺序而尚未存在，这里兜底创建
      try {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      // 服务端生成文件名：杜绝路径穿越与同名覆盖
      const ext = path.extname(file.originalname).toLowerCase();
      const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      cb(null, name);
    },
  });
}

function makeFilter(allowed) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.has(ext)) {
      return cb(new Error(`不支持的文件类型：${ext || '未知'}`));
    }
    return cb(null, true);
  };
}

const uploadImage = multer({
  storage: makeStorage(IMAGE_DIR),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: makeFilter(IMAGE_TYPES),
});

const uploadFont = multer({
  storage: makeStorage(FONT_DIR),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: makeFilter(FONT_TYPES),
});

/** GET /api/fonts — 可用字体清单（公开，前端注入 @font-face 用） */
router.get('/fonts', async (req, res, next) => {
  try {
    res.json({ fonts: await fontService.listFonts() });
  } catch (err) {
    next(err);
  }
});

/** 统一包装 multer 中间件，把上传错误转成 JSON */
function handleUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: '文件过大' });
      }
      if (err.code === 'EACCES' || err.code === 'EROFS') {
        return res.status(500).json({ error: '数据目录不可写，请检查 DATA_DIR 挂载与权限' });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    });
  };
}

/** POST /api/uploads/image — 上传背景图/Logo（管理员） */
router.post('/uploads/image', requireAdmin, handleUpload(uploadImage.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  res.json({
    ok: true,
    url: `${paths.IMAGE_URL_PREFIX}/${req.file.filename}`,
    size: req.file.size,
  });
});

/** POST /api/uploads/font — 上传原神架空文字字体（管理员） */
router.post('/uploads/font', requireAdmin, handleUpload(uploadFont.single('file')), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const family = fontService.familyFromFile(req.file.originalname);
    const fonts = await fontService.listFonts();
    return res.json({
      ok: true,
      url: `${paths.FONT_URL_PREFIX}/${req.file.filename}`,
      family,
      category: fontService.categoryOf(req.file.originalname),
      fonts,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;