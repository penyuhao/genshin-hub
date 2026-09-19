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

/**
 * GET /api/uploads/list — 媒体库（管理员）：列出数据目录里已有的图片/视频。
 *
 * 为什么需要它：部署到 Docker / NAS 之后，文件都在挂载卷里（例如宿主机的
 * ./data/uploads/images/），从后台想引用它们的"地址"很别扭 —— 得先知道文件名、
 * 再拼 /uploads/images/xxx。这个接口直接把它们列出来，点一下就填好。
 * 也方便用户用文件管理器/NAS 界面直接往这个目录里丢图，然后在后台里选。
 */
router.get('/uploads/list', requireAdmin, async (req, res, next) => {
  try {
    const readDir = async (dir, prefix) => {
      let files = [];
      try {
        files = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out = [];
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const isImage = IMAGE_TYPES.has(ext);
        const isVideo = VIDEO_TYPES.has(ext);
        if (!isImage && !isVideo) continue;
        const stat = await fsp.stat(path.join(dir, entry.name)).catch(() => null);
        if (!stat) continue;
        out.push({
          url: `${prefix}/${entry.name}`,
          name: entry.name,
          kind: isImage ? 'image' : 'video',
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
      return out;
    };

    const [images, videos] = await Promise.all([
      readDir(IMAGE_DIR, paths.IMAGE_URL_PREFIX),
      readDir(VIDEO_DIR, paths.VIDEO_URL_PREFIX),
    ]);

    const items = [...images, ...videos].sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    res.set('Cache-Control', 'no-store');
    res.json({
      items,
      dirs: {
        images: IMAGE_DIR,
        videos: VIDEO_DIR,
        hint: '把图片/视频直接放进这个目录（Docker 就是挂载卷里的 data/uploads/images），刷新媒体库就能选到',
      },
    });
  } catch (err) {
    next(err);
  }
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

/* ------------------------------------------------------------------
   从链接导入图片（管理员）
   场景：官方站点的美术资源 / 壁纸往往只能在网页里右键"复制图片地址"，
   直接把这些 https 链接填进配置虽然能用（CSP 允许 https 图片），但会受制于
   对方 CDN 的 referer 策略、也可能哪天失效。这个接口把远程图片抓下来存到本地。
   因为服务端要去访问用户给的地址，安全性上必须做限制：
     · 只允许 http/https，且拒绝解析到内网/回环/链路本地地址的域名（SSRF 防护）
     · 手动跟随最多 3 次跳转，每一跳都重新校验
     · 限制体积与超时，落盘前用**魔数**校验它真的是图片（不看 Content-Type 脸色）
   ------------------------------------------------------------------ */

/** 内网 / 保留地址判断（IPv4 + IPv6） */
function isPrivateAddress(address) {
  const addr = String(address || '').toLowerCase();
  if (!addr) return true;
  if (addr === '::1' || addr === '::' || addr.startsWith('fe80:') || addr.startsWith('fc') || addr.startsWith('fd')) return true;
  const v4 = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  const m = v4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // 不是 IPv4 形式（例如公网 IPv6）就交给后面的 DNS 判断
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT
  return false;
}

/** 允许抓内网地址（默认关闭；仅用于本地测试或纯内网部署） */
const allowPrivateImport = () => String(process.env.ALLOW_PRIVATE_IMAGE_IMPORT || '').toLowerCase() === 'true';

async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('地址格式不正确'), { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw Object.assign(new Error('只支持 http / https 地址'), { status: 400 });
  }
  if (allowPrivateImport()) return url;

  const dns = require('dns').promises;
  let records = [];
  try {
    records = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw Object.assign(new Error(`域名解析失败：${url.hostname}`), { status: 400 });
  }
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw Object.assign(new Error('该地址指向内网或本机，已拒绝（可用 ALLOW_PRIVATE_IMAGE_IMPORT=true 放开）'), { status: 400 });
  }
  return url;
}

/** 图片魔数校验（不看扩展名与 Content-Type） */
function sniffImage(buffer) {
  if (buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg';
  if (buffer.toString('latin1', 0, 3) === 'GIF') return '.gif';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (buffer.toString('latin1', 4, 12).includes('ftypavif')) return '.avif';
  return '';
}

router.post('/uploads/from-url', requireAdmin, async (req, res, next) => {
  const maxBytes = IMAGE_MAX_MB * 1024 * 1024;
  try {
    const input = String(req.body?.url || '').trim();
    if (!input) return res.status(400).json({ error: '请提供图片地址' });

    let url = await assertPublicUrl(input);
    let response = null;

    // 手动跟随跳转：每一跳都重新做一次安全校验
    for (let hop = 0; hop < 4; hop += 1) {
      response = await fetch(url.href, {
        redirect: 'manual',
        headers: { 'User-Agent': 'genshin-hub-image-import', Accept: 'image/*' },
        signal: AbortSignal.timeout(15000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        url = await assertPublicUrl(new URL(location, url).href);
        continue;
      }
      break;
    }

    if (!response || !response.ok) {
      return res.status(400).json({ error: `下载失败（HTTP ${response?.status || '无响应'}）` });
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      return res.status(413).json({ error: `图片过大（上限 ${IMAGE_MAX_MB}MB）` });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return res.status(413).json({ error: `图片过大（上限 ${IMAGE_MAX_MB}MB）` });
    }

    const ext = sniffImage(buffer);
    if (!ext) {
      return res.status(400).json({ error: '这个地址返回的不是图片（支持 PNG / JPEG / GIF / WebP / AVIF）' });
    }

    await fsp.mkdir(IMAGE_DIR, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    await fsp.writeFile(path.join(IMAGE_DIR, filename), buffer);

    return res.json({
      ok: true,
      url: `${paths.IMAGE_URL_PREFIX}/${filename}`,
      size: buffer.length,
      source: url.href,
    });
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return res.status(400).json({ error: '下载超时（对方站点太慢或不可达）' });
    }
    return next(err);
  }
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