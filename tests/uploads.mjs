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
  TRUST_PROXY: '1', // 让测试能验证 X-Forwarded-Proto=https 的场景
  RATE_LIMIT_BYPASS_LOOPBACK: 'true',
  // 从链接导入图片时允许访问本机地址（测试用本地图片服务；生产不要开）
  ALLOW_PRIVATE_IMAGE_IMPORT: 'true',
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

  const globalOk = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      layers: [
        { view: 'global', image: '/images/masks/vignette.svg', blur: 2, dim: 0.3, maskOpacity: 0.2 },
      ],
    }),
  });
  check('支持「全局（星空那一层）」背景', globalOk.status === 200, `HTTP ${globalOk.status}`);

  console.log('\n[7] 多张背景图 + 媒体库');
  const multiOk = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      layers: [{
        view: 'download',
        images: ['/uploads/images/a.webp', '/uploads/images/b.webp', '/images/masks/dots.svg'],
        interval: 8,
      }],
    }),
  });
  check('可以给一个界面配多张背景图', multiOk.status === 200, `HTTP ${multiOk.status} ${JSON.stringify(multiOk.json).slice(0, 120)}`);
  const multiSaved = (await jsonReq('/api/config')).json?.backgrounds?.layers?.find((l) => l.view === 'download');
  check('多张背景图与轮播间隔都持久化了',
    multiSaved?.images?.length === 3 && multiSaved?.interval === 8, JSON.stringify(multiSaved || null));

  const badInterval = await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layers: [{ view: 'about', images: ['/images/masks/dots.svg'], interval: 1 }] }),
  });
  check('轮播间隔过短会被拒（防止闪屏）', badInterval.status === 400, `HTTP ${badInterval.status}`);

  const mediaNoAuth = await jsonReq('/api/uploads/list');
  check('媒体库需要管理员权限', mediaNoAuth.status === 401, `HTTP ${mediaNoAuth.status}`);

  const media = await jsonReq('/api/uploads/list', { headers: { Authorization: `Bearer ${token}` } });
  check('媒体库列出已上传的文件（省去手拼地址）',
    media.status === 200 && Array.isArray(media.json?.items) && media.json.items.length >= 1,
    `HTTP ${media.status} / ${media.json?.items?.length} 个文件`);
  check('媒体库返回可直接使用的地址与目录提示',
    (media.json?.items || []).every((it) => String(it.url).startsWith('/uploads/'))
    && Boolean(media.json?.dirs?.images),
    JSON.stringify(media.json?.items?.[0] || null));

  console.log('\n[7] 从链接导入图片（官方站点美术图）');
  // 本地起一个只服务测试图片的站点（隔离实例已用 ALLOW_PRIVATE_IMAGE_IMPORT=true 放开内网限制）
  const http = await import('node:http');
  const served = { png: pngBuffer(), text: Buffer.from('这不是图片'), hits: 0 };
  const imgServer = http.createServer((req, res) => {
    served.hits += 1;
    if (req.url?.includes('redirect')) {
      res.writeHead(302, { Location: '/cover.png' });
      res.end();
      return;
    }
    if (req.url?.includes('text')) {
      res.writeHead(200, { 'Content-Type': 'image/png' }); // 故意谎报类型
      res.end(served.text);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(served.png);
  });
  await new Promise((resolve) => imgServer.listen(0, '127.0.0.1', resolve));
  const imgPort = imgServer.address().port;
  const imgBase = `http://127.0.0.1:${imgPort}`;

  const imported = await jsonReq('/api/uploads/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${imgBase}/cover.png` }),
  });
  check('可以从链接把图片抓到本地', imported.status === 200 && /^\/uploads\/images\//.test(imported.json.url || ''),
    `HTTP ${imported.status} ${JSON.stringify(imported.json).slice(0, 120)}`);
  check('抓下来的图片真的落盘了',
    Boolean(imported.json.url) && fs.existsSync(path.join(DATA_DIR, 'uploads', 'images', path.basename(imported.json.url))),
    imported.json.url);
  check('记录来源地址（便于追溯）', String(imported.json.source || '').includes('/cover.png'), imported.json.source);

  const redirected = await jsonReq('/api/uploads/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${imgBase}/redirect.png` }),
  });
  check('会跟随跳转（每一跳都重新校验）', redirected.status === 200, `HTTP ${redirected.status}`);

  const notImage = await jsonReq('/api/uploads/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${imgBase}/text.png` }),
  });
  check('谎报 Content-Type 的非图片被魔数校验拦下', notImage.status === 400,
    `HTTP ${notImage.status} ${JSON.stringify(notImage.json)}`);

  const badProtocol = await jsonReq('/api/uploads/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: 'file:///etc/passwd' }),
  });
  check('只允许 http/https 协议', badProtocol.status === 400, `HTTP ${badProtocol.status}`);

  const noAuth = await jsonReq('/api/uploads/from-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${imgBase}/cover.png` }),
  });
  check('未登录不允许抓取外部图片', noAuth.status === 401, `HTTP ${noAuth.status}`);
  imgServer.close();

  console.log('\n[8] 站点体检接口');
  const diagNoAuth = await jsonReq('/api/diagnostics');
  check('体检接口需要管理员权限', diagNoAuth.status === 401, `HTTP ${diagNoAuth.status}`);

  const diag = await jsonReq('/api/diagnostics', { headers: { Authorization: `Bearer ${token}` } });
  check('体检返回结构化清单', diag.status === 200 && Array.isArray(diag.json?.checks) && diag.json.checks.length > 5,
    `HTTP ${diag.status} / ${diag.json?.checks?.length} 项`);
  check('体检结果分级统计正确',
    typeof diag.json?.summary?.ok === 'number'
    && diag.json.summary.ok + diag.json.summary.warn + diag.json.summary.error === diag.json.checks.length,
    JSON.stringify(diag.json?.summary));
  check('体检覆盖数据目录与版本等运行环境项',
    diag.json.checks.some((c) => c.id === 'env:data-dir') && diag.json.checks.some((c) => c.id === 'env:version'),
    diag.json.checks.slice(0, 3).map((c) => c.id).join(','));

  // 故意放一个不存在的本地图片，体检必须报出来
  await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      layers: [{ view: 'about', image: '/uploads/images/definitely-missing.webp', mask: '' }],
    }),
  });
  const diagBroken = await jsonReq('/api/diagnostics', { headers: { Authorization: `Bearer ${token}` } });
  check('体检能发现"配置里引用的文件不存在"',
    (diagBroken.json?.summary?.error || 0) >= 1
    && diagBroken.json.checks.some((c) => c.level === 'error' && /找不到文件/.test(c.title)),
    JSON.stringify(diagBroken.json?.summary));

  // 还原
  await jsonReq('/api/config/backgrounds', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ layers: [{ view: 'about', mask: '/images/masks/waves.svg', maskOpacity: 0.14 }] }),
  });

  console.log('\n[8.5] HTTPS 相关安全头按请求判定（反代终止 TLS 也能正确工作）');
  const plain = await jsonReq('/api/uploads/limits');
  const plainCsp = (await fetch(`${BASE}/health`)).headers.get('content-security-policy') || '';
  check('纯 http 请求不带 upgrade-insecure-requests（否则局域网访问会把资源全打挂）',
    !plainCsp.includes('upgrade-insecure-requests'), plainCsp.slice(0, 80));
  const proxied = await fetch(`${BASE}/health`, { headers: { 'X-Forwarded-Proto': 'https' } });
  const proxiedCsp = proxied.headers.get('content-security-policy') || '';
  check('反代声明 https 时自动补上该指令（trust proxy 生效）',
    proxiedCsp.includes('upgrade-insecure-requests'), proxiedCsp.slice(0, 80));
  void plain;
  console.log('\n[9] 版本更新检查');
  const ghServer = http.createServer((req, res) => {
    if (req.url?.includes('/releases/latest')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v99.0.0', name: 'v99.0.0 测试版', published_at: new Date().toISOString(), html_url: 'https://example.com/releases/tag/v99.0.0', body: '- 测试更新说明' }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((resolve) => ghServer.listen(0, '127.0.0.1', resolve));
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${ghServer.address().port}`;

  const updNoAuth = await jsonReq('/api/update/check');
  check('更新检查需要管理员权限', updNoAuth.status === 401, `HTTP ${updNoAuth.status}`);

  const upd = await jsonReq('/api/update/check', { headers: { Authorization: `Bearer ${token}` } });
  check('能查到 GitHub 上的最新版本并比对',
    upd.status === 200 && upd.json?.latest === '99.0.0' && upd.json?.hasUpdate === true,
    `HTTP ${upd.status} latest=${upd.json?.latest} hasUpdate=${upd.json?.hasUpdate} current=${upd.json?.current}`);
  check('返回更新说明与发布页地址', Boolean(upd.json?.notes) && /^https?:\/\//.test(upd.json?.htmlUrl || ''), upd.json?.htmlUrl);

  const applyBlocked = await jsonReq('/api/update/apply', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  check('一键更新默认关闭（未开 ALLOW_SELF_UPDATE 时拒绝）',
    applyBlocked.status === 403 && /ALLOW_SELF_UPDATE/.test(applyBlocked.json?.error || ''),
    `HTTP ${applyBlocked.status} ${JSON.stringify(applyBlocked.json).slice(0, 100)}`);
  ghServer.close();
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
