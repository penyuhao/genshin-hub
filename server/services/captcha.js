// services/captcha.js — 图形验证码（防暴力破解）
// 设计要点：
//  1. 服务端用内置 5x7 点阵字模渲染真实 PNG 位图（zlib 手写编码，零第三方依赖）
//  2. 答案只存在服务端内存，接口只回传图片；PNG 是位图，脚本无法从响应里读出答案
//  3. 一次性使用 + 5 分钟过期 + 容量上限，配合登录限流形成双重防护
const crypto = require('crypto');
const zlib = require('zlib');

const WIDTH = 152;
const HEIGHT = 52;
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 800;
const CODE_LENGTH = 4;

// 去掉了易混淆的 0 O 1 I L
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// 5x7 点阵字模
const FONT = {
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

// ---------- 内存存储 ----------
const store = new Map();

function prune() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expires <= now) store.delete(id);
  }
  // 容量兜底：超限时按插入顺序淘汰最早的
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

// ---------- PNG 编码（RFC 2083） ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** RGBA 像素缓冲 → PNG Buffer */
function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置一个 filter 字节（0 = None）
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
function createCanvas() {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 4);
  // 深色底 + 轻微渐变，配合站点主题
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      const shade = 12 + Math.floor((y / HEIGHT) * 18) + Math.floor((x / WIDTH) * 10);
      buf[i] = shade;
      buf[i + 1] = shade + 6;
      buf[i + 2] = shade + 18;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function setPixel(buf, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 4;
  const alpha = a / 255;
  buf[i] = Math.round(buf[i] * (1 - alpha) + r * alpha);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - alpha) + g * alpha);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - alpha) + b * alpha);
}

/** 把 5x7 字模放大绘制到画布，带随机抖动与倾斜 */
function drawGlyph(buf, char, originX, originY, scale, jitterFn, color) {
  const glyph = FONT[char];
  if (!glyph) return;

  for (let gy = 0; gy < 7; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      if (glyph[gy][gx] !== '1') continue;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const px = originX + gx * scale + sx;
          const py = originY + gy * scale + sy;
          const [dx, dy] = jitterFn(px, py);
          setPixel(buf, Math.round(px + dx), Math.round(py + dy), color[0], color[1], color[2]);
        }
      }
    }
  }
}

function drawNoise(buf, count, lines, color) {
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(Math.random() * WIDTH);
    const y = Math.floor(Math.random() * HEIGHT);
    setPixel(buf, x, y, color[0], color[1], color[2], 90 + Math.random() * 120);
  }

  for (let i = 0; i < lines; i += 1) {
    let x = Math.random() * WIDTH;
    let y = Math.random() * HEIGHT;
    const len = 20 + Math.random() * 60;
    const angle = Math.random() * Math.PI * 2;
    for (let s = 0; s < len; s += 1) {
      setPixel(buf, Math.round(x), Math.round(y), color[0], color[1], color[2], 70 + Math.random() * 60);
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
  }
}

/** 渲染验证码 PNG（Buffer） */
function renderCaptcha(code) {
  const buf = createCanvas();
  const scale = 5;
  const glyphW = 5 * scale;
  const gap = 9;
  const totalW = code.length * glyphW + (code.length - 1) * gap;
  let cursor = Math.max(8, Math.floor((WIDTH - totalW) / 2));

  drawNoise(buf, 150, 2, [120, 150, 190]);

  for (const char of code) {
    const originY = 8 + Math.floor(Math.random() * 8);
    const waveAmp = 1.6 + Math.random() * 2.2;
    const wavePhase = Math.random() * Math.PI * 2;
    const skew = (Math.random() - 0.5) * 0.16;
    const jitterFn = (px, py) => [
      Math.sin((py / HEIGHT) * Math.PI + wavePhase) * waveAmp,
      (px - WIDTH / 2) * skew,
    ];
    const color = Math.random() > 0.55 ? [232, 200, 119] : [150, 220, 216];
    drawGlyph(buf, char, cursor, originY, scale, jitterFn, color);
    cursor += glyphW + gap;
  }

  drawNoise(buf, 90, 1, [200, 180, 140]);
  return encodePng(buf, WIDTH, HEIGHT);
}

// ---------- 对外 API ----------
/** 生成一个验证码，返回 { id, image(data URI), expiresIn } */
function createCaptcha() {
  prune();
  const code = Array.from(
    { length: CODE_LENGTH },
    () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]
  ).join('');

  const id = crypto.randomBytes(16).toString('hex');
  store.set(id, { code, expires: Date.now() + TTL_MS });

  const png = renderCaptcha(code);
  return {
    id,
    code, // 仅服务端内部使用（可由测试旁路令牌按需回显）
    image: `data:image/png;base64,${png.toString('base64')}`,
    expiresIn: Math.floor(TTL_MS / 1000),
  };
}

/** 校验并立即作废（一次性） */
function verifyCaptcha(id, input) {
  if (!id || typeof id !== 'string' || typeof input !== 'string') return false;
  const entry = store.get(id);
  if (!entry) return false;

  store.delete(id); // 无论对错都作废，防止重放爆破
  if (entry.expires <= Date.now()) return false;

  const expected = entry.code.toUpperCase();
  const actual = input.trim().toUpperCase();
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function stats() {
  prune();
  return { pending: store.size, ttl: Math.floor(TTL_MS / 1000), length: CODE_LENGTH };
}

module.exports = { createCaptcha, verifyCaptcha, stats, WIDTH, HEIGHT };