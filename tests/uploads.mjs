// tests/uploads.mjs — 上传链路集成测试（图片 / 字体 / 视频）
//
// 为什么单独一个文件：
//   上传是全站唯一"写文件"的入口，值得有真实端到端验证（不只是源码契约）。
//   本测试在**本进程内**启动一个隔离实例：
//     • DATA_DIR 指向 .tmp-uploads-test（跑完即删，绝不碰你的真实配置与凭据）
//     • 独立端口（默认 3199），不打扰正在运行的服务
//     • 自己写入测试管理员凭据 —— 所以不需要知道你的真实密码
//     • 全程离线：清空 KUMA_* 环境变量，不连任何外部数据源
//
// 运行： node tests/uploads.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(ROOT, '.tmp-uploads-test');
const PORT = Number(process.env.UPLOADS_TEST_PORT || 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { username: 'admin', password: 'uploads-test-pw-1' };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 隔离环境（必须在 require 服务端之前设置：paths.js 在加载时就读取） ----------
fs.rmSync(DATA_DIR, { recursive: true, force: true });
Object.assign(process.env, {
  DATA_DIR,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  TRUST_PROXY: 'false',
  RATE_LIMIT_BYPASS_LOOPBACK: 'true',
  // 清掉所有外部依赖，保证测试离线且可重复
  KUMA_URL: '',
  KUMA_STATUS_SLUG: '',
  KUMA_API_KEY: '',
  KUMA_USERNAME: '',
  KUMA_PASSWORD: '',
  KUMA_SOCKET_ENABLED: '',
  JWT_SECRET: '',
  ADMIN_PASSWORD: '',
  ADMIN_PASSWORD_HASH: '',
  CAPTCHA_BYPASS_TOKEN: '',
});

const require = createRequire(import.meta.url);
require(path.join(ROOT, 'server', 'index.js'));

const VIDEO_DIR = path.join(DATA_DIR, 'uploads', 'videos');

function videoFiles() {
  try {
    return fs.readdirSync(VIDEO_DIR);
  } catch {
    return [];
  }
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return res.json();
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('隔离实例未能在 20 秒内启动');
}

/** 造一个"真"MP4 头：第 5~8 字节必须是 ftyp */
const mp4Buffer = () =>
  Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(72, 0x21)]);

/** 造一个 WebM 头：1A 45 DF A3 */
const webmBuffer = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 0x11)]);

/** 1×1 透明 PNG */
const pngBuffer = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+26JNFgAAAABJRU5ErkJggg==',
    'base64'
  );

async function upload(pathname, buffer, filename, type, token) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), filename);
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function jsonReq(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, options);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log('\n=== 上传链路集成测试（隔离实例）===');
  console.log(`数据目录: ${DATA_DIR}`);
  console.log(`地址: ${BASE}\n`);

  const health = await waitForHealth();
  check('隔离实例已启动且处于 Mock 模式（未连真实数据源）', health.status === 'ok' && health.mode === 'mock', JSON.stringify(health));

  // ---------- 凭据 ----------
  const authService = require(path.join(ROOT, 'server', 'services', 'authService.js'));
  await authService.setInitialCredentials(ADMIN);
  await authService.setCaptchaEnabled(false);

  const login = await jsonReq('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  const token = login.json?.token;
  check('临时管理员可登录（无需知道真实密码）', login.status === 200 && typeof token === 'string',
    `HTTP ${login.status} ${JSON.stringify(login.json).slice(0, 120)}`);
  if (!token) throw new Error('登录失败，后续用例无法进行');

  console.log('\n[1] 视频上传');
  check('未登录不允许上传视频', (await upload('/api/uploads/video', mp4Buffer(), 'a.mp4', 'video/mp4')).status === 401);

  const before = videoFiles().length;
  const okMp4 = await upload('/api/uploads/video', mp4Buffer(), 'teyvat.mp4', 'video/mp4', token);
  check('MP4 上传成功', okMp4.status === 200 && okMp4.json.ok === true, `HTTP ${okMp4.status} ${JSON.stringify(okMp4.json)}`);
  check('返回站内视频地址', /^\/uploads\/videos\/\d+-[0-9a-f]{12}\.mp4$/.test(okMp4.json.url || ''), okMp4.json.url);
  check('识别出容器类型为 mp4/mov', okMp4.json.container === 'mp4/mov', okMp4.json.container);
  const stored = path.join(VIDEO_DIR, path.basename(okMp4.json.url || 'x'));
  check('视频真的落盘到 DATA_DIR/uploads/videos', fs.existsSync(stored), stored);

  const webm = await upload('/api/uploads/video', webmBuffer(), 'night.webm', 'video/webm', token);
  check('WebM 上传成功（第二套容器特征码）', webm.status === 200 && webm.json.container === 'webm/mkv',
    `HTTP ${webm.status} ${JSON.stringify(webm.json)}`);

  const fakeMp4 = await upload('/api/uploads/video', Buffer.from('这其实是一个文本文件，只是改了扩展名'), 'evil.mp4', 'video/mp4', token);
  check('扩展名伪造的"MP4"被拒（容器特征码校验）', fakeMp4.status === 400, `HTTP ${fakeMp4.status} ${JSON.stringify(fakeMp4.json)}`);
  check('被拒文件不留在数据卷里', videoFiles().length === before + 2, `目录里 ${videoFiles().length} 个，期望 ${before + 2}`);

  const wrongType = await upload('/api/uploads/video', Buffer.from('hello'), 'note.txt', 'text/plain', token);
  check('非视频扩展名被拒', wrongType.status === 400 && /不支持/.test(wrongType.json.error || ''), JSON.stringify(wrongType.json));

  console.log('\n[2] 视频可被播放器读取（Range 请求）');
  const rangeRes = await fetch(`${BASE}${okMp4.json.url}`, { headers: { Range: 'bytes=0-3' } });
  check('支持 Range 请求（206）', rangeRes.status === 206, `HTTP ${rangeRes.status}`);
  check('声明 accept-ranges', (rangeRes.headers.get('accept-ranges') || '') === 'bytes', rangeRes.headers.get('accept-ranges'));
  check('Content-Range 正确', /^bytes 0-3\/\d+$/.test(rangeRes.headers.get('content-range') || ''), rangeRes.headers.get('content-range'));
  check('Content-Type 为 video/mp4', (rangeRes.headers.get('content-type') || '').includes('video/mp4'),
    rangeRes.headers.get('content-type'));

  console.log('\n[3] 其它上传未被破坏（回归）');
  const png = await upload('/api/uploads/image', pngBuffer(), 'cover.png', 'image/png', token);
  check('图片上传仍然可用', png.status === 200 && /^\/uploads\/images\//.test(png.json.url || ''),
    `HTTP ${png.status} ${JSON.stringify(png.json)}`);
  const limits = await jsonReq('/api/uploads/limits');
  check('上传上限接口返回三类上限',
    Number(limits.json?.image?.maxMB) > 0 && Number(limits.json?.font?.maxMB) > 0 && Number(limits.json?.video?.maxMB) > 0,
    JSON.stringify(limits.json));

  console.log('\n[4] 配置校验：背景视频字段');
  const configNow = await jsonReq('/api/config');
  const slides = configNow.json?.hero?.slides || [];
  check('出厂配置可读出画廊屏', slides.length >= 1, `${slides.length} 屏`);

  const badProto = await jsonReq('/api/config/hero', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slides: slides.map((s, i) => (i === 0 ? { ...s, bgVideo: 'javascript:alert(1)' } : s)) }),
  });
  check('拒绝 javascript: 伪协议视频地址', badProto.status === 400, `HTTP ${badProto.status}`);

  const badTraversal = await jsonReq('/api/config/hero', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ slides: slides.map((s, i) => (i === 0 ? { ...s, bgVideo: '/uploads/../secrets.json' } : s)) }),
  });
  check('拒绝路径穿越的视频地址', badTraversal.status === 400, `HTTP ${badTraversal.status}`);

  const goodPatch = await jsonReq('/api/config/hero', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      slides: slides.map((s, i) =>
        i === 0 ? { ...s, bgVideo: okMp4.json.url, videoMuted: true, videoLoop: true, videoOpacity: 0.8 } : s
      ),
    }),
  });
  check('合法的视频配置可以保存', goodPatch.status === 200, `HTTP ${goodPatch.status} ${JSON.stringify(goodPatch.json).slice(0, 120)}`);

  const after = await jsonReq('/api/config');
  const saved = after.json?.hero?.slides?.[0] || {};
  check('配置持久化了视频字段',
    saved.bgVideo === okMp4.json.url && saved.videoOpacity === 0.8 && saved.videoMuted === true,
    JSON.stringify({ bgVideo: saved.bgVideo, videoOpacity: saved.videoOpacity, videoMuted: saved.videoMuted }));

  console.log('\n[5] 链接字段：只写域名也能保存（回归："我明明填了链接但显示链接待补充"）');
  const cards = [
    { title: '游戏本体', url: 'ys.mihoyo.com', tag: '官方' },
    { title: '云原神', url: 'www.yuanshen.com/cloud', tag: '官方' },
    { title: '工具站', url: 'http://enka.network/', tag: '工具' },
    { title: '站内页', url: '/download', tag: '站内' },
    { title: '待补充', url: '', tag: '' },
  ];
  const saveCards = await jsonReq('/api/config/download', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cards }),
  });
  check('缺少协议的域名可以保存（不再整段被拒）', saveCards.status === 200,
    `HTTP ${saveCards.status} ${JSON.stringify(saveCards.json).slice(0, 140)}`);

  const savedCards = (await jsonReq('/api/config')).json?.download?.cards || [];
  check('裸域名自动补成 https://', savedCards[0]?.url === 'https://ys.mihoyo.com', savedCards[0]?.url);
  check('带路径的裸域名同样补全', savedCards[1]?.url === 'https://www.yuanshen.com/cloud', savedCards[1]?.url);
  check('http:// 原样保留（内网 / NAS 上只提供 http 的服务很常见）',
    savedCards[2]?.url === 'http://enka.network/', savedCards[2]?.url);
  check('站内路径原样保留', savedCards[3]?.url === '/download', savedCards[3]?.url);
  check('留空的卡片仍然允许（占位用）', savedCards[4]?.url === '', JSON.stringify(savedCards[4]?.url));

  const badLink = await jsonReq('/api/config/download', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cards: [{ title: '坏链接', url: 'javascript:alert(1)' }] }),
  });
  check('仍然拒绝 javascript: 链接', badLink.status === 400, `HTTP ${badLink.status}`);

  const spaceLink = await jsonReq('/api/config/download', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ cards: [{ title: '坏链接', url: 'upl oad.com' }] }),
  });
  check('拒绝含空格的地址（并返回字段级错误，便于后台高亮）',
    spaceLink.status === 400 && Array.isArray(spaceLink.json?.details) && spaceLink.json.details.length > 0,
    `HTTP ${spaceLink.status} ${JSON.stringify(spaceLink.json?.details || null)}`);

  console.log('\n[6] 页面背景（背景图 / 覆盖色 / 遮罩图）校验');
  const goodBg = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      layers: [
        {
          view: 'download',
          image: '/uploads/images/bg.webp',
          blur: 6,
          dim: 0.4,
          fixed: true,
          overlayColor: '#0b1020',
          overlayOpacity: 0.5,
          mask: '/images/masks/grid.svg',
          maskOpacity: 0.2,
          maskBlend: 'overlay',
          maskSize: 'tile',
        },
      ],
    }),
  });
  check('合法的页面背景配置可以保存', goodBg.status === 200,
    `HTTP ${goodBg.status} ${JSON.stringify(goodBg.json).slice(0, 140)}`);

  const savedBg = (await jsonReq('/api/config')).json?.backgrounds?.layers || [];
  check('背景字段完整持久化（含混合模式与铺法）',
    savedBg[0]?.maskBlend === 'overlay' && savedBg[0]?.maskSize === 'tile' && savedBg[0]?.blur === 6
    && savedBg[0]?.fixed === true,
    JSON.stringify(savedBg[0] || null));

  const badView = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layers: [{ view: 'admin', mask: '/images/masks/dots.svg' }] }),
  });
  check('拒绝不在白名单里的界面', badView.status === 400, `HTTP ${badView.status}`);

  const badBlend = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layers: [{ view: 'about', maskBlend: 'url(javascript:alert(1))' }] }),
  });
  check('拒绝非法的混合模式（防 CSS 注入）', badBlend.status === 400, `HTTP ${badBlend.status}`);

  console.log('\n=== 测试结果 ===');
  console.log(`  通过: ${pass}`);
  console.log(`  失败: ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n测试执行异常：', err);
    fail += 1;
  })
  .finally(() => {
    // 临时数据目录用完即删：配置、凭据、上传文件全部回收
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(fail > 0 ? 1 : 0);
  });
