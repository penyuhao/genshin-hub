// services/diagnostics.js — 站点体检：把"哪里有问题"变成一份可读的清单
//
// 检查分三类：
//   1) 运行环境（数据目录可写、配置可读、隧道/协议、限流…）
//   2) 配置引用（画廊背景图、页面背景、遮罩、快捷入口、下载卡片…指向的资源是否真的能访问）
//   3) 常见坑（背景填成了网页地址、重复的界面背景、必填项为空、字体没找到…）
// 网络检查有节制：最多 24 个地址、并发 4、单个 6 秒超时，避免体检本身把站点拖慢。
const fs = require('fs').promises;
const path = require('path');
const paths = require('../paths');

const MAX_URL_CHECKS = 40;
const CHECK_TIMEOUT_MS = 6000;
const CONCURRENCY = 4;

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:\?|#|$)/i;
const VIDEO_EXT = /\.(?:mp4|m4v|webm|ogv|mov)(?:\?|#|$)/i;

function item(level, id, title, detail = '', hint = '') {
  return { level, id, title, detail, hint };
}

/** 站内路径 → 本地文件路径（用于判断"文件在不在"，比发 HTTP 请求更准） */
function localPathOf(url) {
  const clean = String(url).split('?')[0].split('#')[0];
  if (clean.startsWith('/uploads/')) {
    return path.join(paths.UPLOAD_DIR, clean.slice('/uploads/'.length));
  }
  if (clean.startsWith('/')) {
    return path.join(paths.FRONTEND_DIR, clean.slice(1));
  }
  return '';
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** 收集配置里所有"应当能访问"的引用 */
function collectReferences(config) {
  const refs = [];
  const push = (url, label, kind) => {
    const value = String(url || '').trim();
    if (!value || value === '#') return;
    refs.push({ url: value, label, kind });
  };

  (config.hero?.slides || []).forEach((slide, index) => {
    const name = slide?.title || `第 ${index + 1} 屏`;
    push(slide?.bgImage, `画廊「${name}」背景图`, 'image');
    push(slide?.bgVideo, `画廊「${name}」背景视频`, 'video');
  });
  (config.backgrounds?.layers || []).forEach((layer) => {
    const name = layer?.label || layer?.view || '未命名界面';
    push(layer?.image, `页面背景「${name}」背景图`, 'image');
    push(layer?.mask, `页面背景「${name}」遮罩图`, 'image');
  });
  push(config.site?.logo, '站点 Logo', 'image');
  push(config.site?.favicon, '站点 favicon', 'image');
  push(config.music?.url, '背景音乐', 'media');
  (config.links?.items || []).forEach((link, index) => {
    push(link?.url, `快捷入口「${link?.title || index + 1}」`, 'link');
  });
  (config.download?.cards || []).forEach((card, index) => {
    push(card?.url, `下载卡片「${card?.title || index + 1}」`, 'link');
  });
  return refs;
}

/** 单个引用检查：站内看文件、站外发 HEAD（失败再退回 GET 前几字节） */
async function checkReference(ref) {
  if (ref.url.startsWith('/') && !ref.url.startsWith('//')) {
    const file = localPathOf(ref.url);
    if (!file) return item('warn', `ref:${ref.url}`, `${ref.label} 指向站内路径`, ref.url);
    const ok = await exists(file);
    return ok
      ? item('ok', `ref:${ref.url}`, `${ref.label} 存在`, ref.url)
      : item('error', `ref:${ref.url}`, `${ref.label} 找不到文件`, ref.url,
        '这个路径在本机不存在：确认文件是否被删掉，或在后台重新上传/换一个地址');
  }

  try {
    const res = await fetch(ref.url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { 'User-Agent': 'genshin-hub-diagnostics' },
    });
    if (res.ok) {
      const type = res.headers.get('content-type') || '';
      const looksImage = type.startsWith('image/');
      if (ref.kind === 'image' && type && !looksImage && !IMAGE_EXT.test(ref.url)) {
        return item('warn', `ref:${ref.url}`, `${ref.label} 可能不是图片`, `${ref.url} → ${type}`,
          'CSS 背景只能放图片；如果是网页地址，用「从链接导入」让它自动取封面图');
      }
      return item('ok', `ref:${ref.url}`, `${ref.label} 可访问`, `${ref.url} → HTTP ${res.status}`);
    }
    return item('warn', `ref:${ref.url}`, `${ref.label} 返回 HTTP ${res.status}`, ref.url,
      '对方站点可能拒绝外链或已下线；建议用「从链接导入」把图片存到本地');
  } catch (err) {
    return item('warn', `ref:${ref.url}`, `${ref.label} 无法访问`, `${ref.url} → ${err.message}`,
      '网络不可达或对方拦截；外链图建议导入到本地');
  }
}

async function runReferenceChecks(config) {
  const refs = collectReferences(config);
  // 去重 + 截断，保证体检够快
  const seen = new Set();
  const queue = [];
  const skipped = [];
  for (const ref of refs) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    if (queue.length >= MAX_URL_CHECKS) {
      skipped.push(ref.url);
      continue;
    }
    queue.push(ref);
  }

  const results = [];
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((ref) => checkReference(ref)))));
  }
  return { results, checked: queue.length, total: refs.length, deduped: refs.length - seen.size, skipped };
}

/** 配置层面的"常见坑" */
function configWarnings(config) {
  const out = [];
  const slides = config.hero?.slides || [];

  const noBg = slides.filter((s) => !String(s?.bgImage || '').trim() && !String(s?.bgVideo || '').trim());
  if (noBg.length) {
    out.push(item('warn', 'hero:no-bg', `${noBg.length} 屏既没有背景图也没有视频`,
      noBg.map((s) => s?.title || '(无标题)').join('、'), '这些屏会显示成纯背景色'));
  }

  const dupViews = {};
  for (const layer of config.backgrounds?.layers || []) {
    const key = layer?.view || '';
    dupViews[key] = (dupViews[key] || 0) + 1;
  }
  const dupes = Object.entries(dupViews).filter(([, n]) => n > 1).map(([k]) => k);
  if (dupes.length) {
    out.push(item('warn', 'bg:dup', '同一个界面配了多份背景', dupes.join('、'), '只有第一份生效，建议删掉多余的'));
  }

  for (const layer of config.backgrounds?.layers || []) {
    const image = String(layer?.image || '');
    if (image && !IMAGE_EXT.test(image) && !image.includes('x-oss-process')) {
      out.push(item('warn', `bg:notimage:${layer.view}`, `「${layer.label || layer.view}」的背景图可能不是图片地址`,
        image.slice(0, 90), 'CSS 只能把图片当背景；网页地址请用「从链接导入」自动取封面图'));
    }
  }

  const navViews = (config.navigation?.items || []).map((i) => i?.view).filter(Boolean);
  if (new Set(navViews).size !== navViews.length) {
    out.push(item('warn', 'nav:dup', '导航里有重复的视图', navViews.join('、'), '重复项会让点击行为变得奇怪'));
  }

  if (!String(config.site?.title || '').trim()) {
    out.push(item('error', 'site:title', '站点标题为空', '', '在「站点设置」里填一个标题'));
  }

  if (!(config.links?.items || []).length) {
    out.push(item('warn', 'links:empty', '快捷入口是空的', '', '首页会少一块内容；在「快捷入口」里加几条外链'));
  }

  // 背景音乐：最常见的两种"配了没声音"
  const musicUrl = String(config.music?.url || '').trim();
  const musicOn = config.features?.enableBackgroundMusic === true;
  if (musicUrl && !musicOn) {
    out.push(item('error', 'music:switch-off', '配了背景音乐地址，但「功能开关 → 背景音乐」是关的',
      musicUrl.slice(0, 80), '去「功能开关」把「背景音乐」打开，音乐才会生效'));
  }
  if (musicOn && !musicUrl) {
    out.push(item('warn', 'music:no-url', '打开了背景音乐但没填地址', '', '在「背景音乐」里填一个直接的音频文件地址（.mp3/.m4a/.ogg）'));
  }
  if (musicUrl && !/\.(?:mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:\?|#|$)/i.test(musicUrl)) {
    out.push(item('warn', 'music:not-audio', '背景音乐地址看起来不是音频文件',
      musicUrl.slice(0, 80), '要填「直接指向音频文件」的地址（右键音频 → 复制链接），不是播放页面地址'));
  }
  if (musicOn && musicUrl && config.music?.autoplay) {
    out.push(item('ok', 'music:autoplay', '背景音乐已开启（自动播放）',
      '浏览器的自动播放策略会拦下带声音的音频：页面会显示 ♪ 按钮，用户第一次点击/按键后会自动开始播放'));
  }

  return out;
}

async function run({ config, authSettings, kumaCfg, isConfigured, sseClients, version, uptime, tls, proto = '' }) {
  const checks = [];

  // ---------- 运行环境 ----------
  checks.push(item('ok', 'env:version', '站点版本', `v${version}`));
  checks.push(item('ok', 'env:node', 'Node 版本', process.version));
  checks.push(item('ok', 'env:uptime', '已运行', `${Math.round(uptime / 60)} 分钟`));

  try {
    const probe = path.join(paths.DATA_DIR, `.diag-probe-${process.pid}`);
    await fs.writeFile(probe, 'ok', 'utf-8');
    await fs.unlink(probe);
    checks.push(item('ok', 'env:data-dir', '数据目录可写', paths.DATA_DIR));
  } catch (err) {
    checks.push(item('error', 'env:data-dir', '数据目录不可写', `${paths.DATA_DIR} → ${err.message}`,
      '配置和上传都会失败：给容器挂可写卷，或 chown -R 1000:1000 ./data'));
  }

  const uploadsOk = await exists(paths.UPLOAD_DIR);
  checks.push(uploadsOk
    ? item('ok', 'env:uploads', '上传目录存在', paths.UPLOAD_DIR)
    : item('warn', 'env:uploads', '上传目录还没有创建', paths.UPLOAD_DIR, '上传一次图片就会自动建好'));

  checks.push(item('ok', 'env:auth', '登录保护', authSettings?.captchaEnabled ? '图形验证码已开启' : '图形验证码已关闭',
    authSettings?.captchaEnabled ? '' : '建议开启：后台「账号与安全」'));

  checks.push(isConfigured
    ? item('ok', 'env:kuma', '数据源', `${kumaCfg?.url || ''}（来源：${kumaCfg?.source === 'panel' ? '控制面板' : '环境变量'}）`)
    : item('warn', 'env:kuma', '数据源处于 Mock 演示模式', '没有配置 Uptime Kuma', '在后台「数据源设置」里填地址与 API Key'));

  checks.push(tls
    ? item('ok', 'env:tls', '已在服务端启用 HTTPS', '已加载证书')
    : item('ok', 'env:tls', '当前是 HTTP', '适合放在 Nginx / Caddy 后面；也可用 SSL_CERT/SSL_KEY 直接跑 https'));

  checks.push(item('ok', 'env:sse', 'SSE 实时连接数', String(sseClients ?? 0)));

  const backups = await fs.readdir(paths.BACKUP_DIR).catch(() => []);
  const configBackups = backups.filter((f) => f.endsWith('.json'));
  checks.push(configBackups.length
    ? item('ok', 'env:backups', '配置备份', `${configBackups.length} 份（最多保留 20 份）`)
    : item('warn', 'env:backups', '还没有配置备份', '', '在后台保存一次配置就会自动生成'));

  // ---------- 配置本身 ----------
  checks.push(...configWarnings(config));

  // ---------- 引用可达性 ----------
  const { results, checked, total, deduped, skipped } = await runReferenceChecks(config);
  checks.push(...results);
  checks.push(item('ok', 'refs:summary', '资源检查完成',
    `配置里 ${total} 个引用（重复 ${deduped} 个合并），实际检查 ${checked} 个${skipped.length ? `，超出上限跳过 ${skipped.length} 个` : ''}`,
    skipped.length ? '引用特别多时刻意只查前若干个，避免体检太慢' : ''));

  // 混合内容：整站是 https 时，配置里的 http 资源会被浏览器直接拦掉
  const pageProto = String(proto || '').toLowerCase();
  const isHttpsPage = Boolean(tls) || pageProto === 'https';
  if (isHttpsPage) {
    const insecure = [...new Set(
      collectReferences(config)
        .map((r) => r.url)
        .filter((u) => /^http:\/\//i.test(u))
    )];
    if (insecure.length) {
      checks.push(item('error', 'refs:mixed-content', `${insecure.length} 个 http 资源会被浏览器拦掉`,
        insecure.slice(0, 5).join('、'), '整站是 https 时浏览器禁止加载 http 图片/媒体：把地址改成 https，或直接「从链接导入」存成本地文件'));
    }
  }

  const summary = {
    ok: checks.filter((c) => c.level === 'ok').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    error: checks.filter((c) => c.level === 'error').length,
  };

  return {
    ranAt: new Date().toISOString(),
    summary,
    checks: checks.sort((a, b) => {
      const rank = { error: 0, warn: 1, ok: 2 };
      return rank[a.level] - rank[b.level];
    }),
  };
}

module.exports = { run };
