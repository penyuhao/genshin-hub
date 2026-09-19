// routes/media.js — 字体清单 + 图片/字体/视频上传（管理员）
// 上传文件写入 DATA_DIR/uploads（可挂载卷），通过 /uploads 静态服务对外提供
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const crypto = require('crypto');
const multer = require('multer');
const { requireAdmin } = require('../middleware/auth');
const fontService = require('../services/fontService');
const paths = require('../paths');

const IMAGE_DIR = paths.IMAGE_UPLOAD_DIR;
const FONT_DIR = paths.FONT_UPLOAD_DIR;
const VIDEO_DIR = paths.VIDEO_UPLOAD_DIR;

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

// 背景视频容器：mp4/m4v(H.264) 兼容性最好，webm 体积更小，其余作为兜底
const VIDEO_TYPES = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.mov', 'video/quicktime'],
]);

// 上传体积上限（MB）：部署环境可用环境变量放宽，无需改代码
const mb = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
const IMAGE_MAX_MB = mb(process.env.MAX_IMAGE_MB, 5);
const FONT_MAX_MB = mb(process.env.MAX_FONT_MB, 12);
const VIDEO_MAX_MB = mb(process.env.MAX_VIDEO_MB, 64);

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
  limits: { fileSize: IMAGE_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: makeFilter(IMAGE_TYPES),
});

const uploadFont = multer({
  storage: makeStorage(FONT_DIR),
  limits: { fileSize: FONT_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: makeFilter(FONT_TYPES),
});

const uploadVideo = multer({
  storage: makeStorage(VIDEO_DIR),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: makeFilter(VIDEO_TYPES),
});

/**
 * 视频容器特征码校验。
 * 扩展名与 Content-Type 都是客户端说了算，光看它们等于没校验；
 * 这里读文件头做"魔数"比对，确认它真的是一个能播的容器。
 *   mp4 / mov：第 5~8 字节是 box 类型（通常是 ftyp）
 *   webm / mkv：1A 45 DF A3
 *   ogg / ogv：OggS
 */
const VIDEO_SIGNATURES = [
  {
    name: 'mp4/mov',
    test: (buf) =>
      buf.length >= 12 &&
      ['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'styp'].includes(buf.toString('latin1', 4, 8)),
  },
  { name: 'webm/mkv', test: (buf) => buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3 },
  { name: 'ogg', test: (buf) => buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS' },
];

/** 读文件头（默认 64 字节）用于特征码校验 */
async function readHead(filePath, bytes = 64) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** GET /api/fonts — 可用字体清单（公开，前端注入 @font-face 用） */
router.get('/fonts', async (req, res, next) => {
  try {
    res.json({ fonts: await fontService.listFonts() });
  } catch (err) {
    next(err);
  }
});

/** 统一包装 multer 中间件，把上传错误转成 JSON */
function handleUpload(middleware, maxMB) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `文件过大（上限 ${maxMB}MB）` });
      }
      if (err.code === 'EACCES' || err.code === 'EROFS') {
        return res.status(500).json({ error: '数据目录不可写，请检查 DATA_DIR 挂载与权限' });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    });
  };
}

/** GET /api/uploads/limits — 各类上传的体积上限（管理后台显示提示用，公开只读） */
router.get('/uploads/limits', (req, res) => {
  res.json({
    image: { maxMB: IMAGE_MAX_MB, accept: [...IMAGE_TYPES.keys()].join(',') },
    font: { maxMB: FONT_MAX_MB, accept: [...FONT_TYPES.keys()].join(',') },
    video: { maxMB: VIDEO_MAX_MB, accept: [...VIDEO_TYPES.keys()].join(',') },
  });
});

/** POST /api/uploads/image — 上传背景图/Logo（管理员） */
router.post('/uploads/image', requireAdmin, handleUpload(uploadImage.single('file'), IMAGE_MAX_MB), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  res.json({
    ok: true,
    url: `${paths.IMAGE_URL_PREFIX}/${req.file.filename}`,
    size: req.file.size,
  });
});

/** POST /api/uploads/video — 上传画廊背景视频（管理员） */
router.post('/uploads/video', requireAdmin, handleUpload(uploadVideo.single('file'), VIDEO_MAX_MB), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });

    const head = await readHead(req.file.path);
    const matched = VIDEO_SIGNATURES.find((sig) => sig.test(head));
    if (!matched) {
      // 不是真正的视频容器：立刻删除，别把垃圾留在数据卷里
      await fsp.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        error: '文件不是有效的视频容器（支持 MP4 / WebM / OGV / MOV，推荐 H.264 编码的 MP4）',
      });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    return res.json({
      ok: true,
      url: `${paths.VIDEO_URL_PREFIX}/${req.file.filename}`,
      size: req.file.size,
      container: matched.name,
      mime: VIDEO_TYPES.get(ext) || 'video/mp4',
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/uploads/font — 上传原神架空文字字体（管理员） */
router.post('/uploads/font', requireAdmin, handleUpload(uploadFont.single('file'), FONT_MAX_MB), async (req, res, next) => {
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