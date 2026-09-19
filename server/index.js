// index.js — 原神功能快捷站后端入口
// 职责：启动自举 → 安全中间件 → 静态资源托管 → API 路由 → SPA 回退 → 统一错误处理
// 可移植性：路径与数据目录全部来自 paths.js，支持 HOST / PORT / DATA_DIR / TRUST_PROXY 环境变量
// quiet: 关闭 dotenv 的启动提示（不想让日志里混入无关 banner；旧版本会忽略这个选项）
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');

const paths = require('./paths');
const { helmetConfig, corsConfig, apiLimiter } = require('./middleware/security');
const configRoutes = require('./routes/config');
const statusRoutes = require('./routes/status');
const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const settingsRoutes = require('./routes/settings');

const configService = require('./services/configService');
const fontService = require('./services/fontService');
const statusService = require('./services/statusService');
const kumaSocket = require('./services/kumaSocket');
const kumaConfig = require('./services/kumaConfig');
const authService = require('./services/authService');
const bootstrap = require('./services/bootstrap');
const sseBus = require('./services/sseBus');
const { isConfigured } = require('./services/kumaRest');

const FRONTEND_DIR = paths.FRONTEND_DIR;
const PORT = Number(process.env.PORT) || 3001;
// 默认监听所有网卡（容器 / PaaS 需要）；本机想只允许本机访问就设 HOST=127.0.0.1
const HOST = (process.env.HOST || '0.0.0.0').trim();
const isProd = process.env.NODE_ENV === 'production';

/** TRUST_PROXY：1（默认，单层反代）| false（直连）| loopback | true | 数字 */
function resolveTrustProxy() {
  const raw = String(process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (raw === '') return 1;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw; // 'loopback' 等 express 支持的写法
}

const app = express();
app.disable('x-powered-by');
// 部署在 Nginx / 云负载均衡之后时可正确识别客户端 IP（限流依赖）
app.set('trust proxy', resolveTrustProxy());

// ---------- 安全中间件 ----------
app.use(helmetConfig);
app.use(corsConfig);

// ---------- 静态资源（同源托管前端，避免跨域与密钥暴露）----------
const staticOptions = {
  etag: true,
  lastModified: true,
  maxAge: isProd ? '7d' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('.woff2') || filePath.endsWith('.woff')) {
      res.setHeader('Cache-Control', isProd ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
  },
};

app.use(express.static(FRONTEND_DIR, staticOptions));

// 后台上传的图片与字体存放在数据目录（可挂载卷 / 只读代码目录也能用）
app.use(
  '/uploads',
  express.static(paths.UPLOAD_DIR, {
    ...staticOptions,
    index: false,
    dotfiles: 'deny',
    maxAge: isProd ? '30d' : 0,
  })
);

// ---------- 健康检查 ----------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: isConfigured() ? 'live' : 'mock',
    uptime: Math.round(process.uptime()),
    sseClients: sseBus.clientCount(),
    time: new Date().toISOString(),
  });
});

// ---------- API ----------
app.use('/api', apiLimiter);

// 配置接口体积上限放宽（管理后台可能提交较长的关于内容）
app.use('/api/config', express.json({ limit: '256kb' }), configRoutes);
// 其余接口保持 10kb 的小体积上限
app.use(express.json({ limit: '10kb' }));
app.use('/api/status', statusRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', mediaRoutes);

// 未命中的 API 一律 JSON 404，不要落到 SPA
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// ---------- SPA 回退（#hash 路由，任意路径都交给 index.html）----------
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ---------- 统一错误处理 ----------
app.use((err, req, res, next) => {
  // CORS 白名单拒绝
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: '来源不被允许' });
  }
  // 请求体过大
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: '请求体过大' });
  }
  // JSON 解析失败
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON 格式错误' });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err.stack || err.message);

  return res.status(status).json({
    error: status >= 500 && isProd ? '服务器内部错误' : err.message || '服务器内部错误',
  });
});

// ---------- 启动 ----------
let server = null;

async function start() {
  // 1) 目录准备（数据目录可指向挂载卷）
  const dirs = await paths.ensureDirs();
  await fontService.ensureDirs();

  const writable = await paths.checkWritable();
  if (!writable.ok) {
    console.error('');
    console.error('  ⚠ 数据目录不可写：', dirs.dataDir);
    console.error('    原因：', writable.error);
    console.error('    解决：设置 DATA_DIR 指向可写目录（或给容器挂载可写卷），例如');
    console.error('          DATA_DIR=/data  docker run -v mydata:/data ...');
    console.error('');
  }

  // 2) 首次启动自举：JWT 密钥 + 管理员凭据（无需手写 .env）
  const jwt = await bootstrap.ensureJwtSecret();
  const admin = await bootstrap.ensureAdminCredentials();

  // 3) 配置与运行时设置
  await configService.ensureConfigFile(); // 生成 DATA_DIR/config.json
  await kumaConfig.ensureLoaded(); // DATA_DIR/kuma.json
  await authService.ensureStore(); // DATA_DIR/auth.json

  // 4) 状态轮询 + SSE 广播（间隔来自后台「数据源设置」）
  const interval = statusService.startPolling();
  // 5) 可选：Kuma Socket 实时通道
  const socketInfo = kumaSocket.connectKuma();

  bootstrap.printFirstRunNotice({ jwt, admin, dataDirInfo: dirs.dataDir });

  server = app.listen(PORT, HOST, async () => {
    const configured = isConfigured();
    const authSettings = await authService.getSettings().catch(() => ({ username: 'admin', captchaEnabled: true }));
    const kumaCfg = kumaConfig.get();
    const shownHost = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;

    console.log('');
    console.log('  原神功能快捷站 · 后端已启动');
    console.log(`  ├─ 监听      ${HOST}:${PORT}${HOST === '0.0.0.0' ? '（所有网卡）' : ''}`);
    console.log(`  ├─ 地址      http://${shownHost}:${PORT}`);
    console.log(`  ├─ 健康检查  http://${shownHost}:${PORT}/health`);
    console.log(`  ├─ 数据源    ${configured ? '真实 Kuma 数据源' : 'Mock 演示模式'}${configured ? `（来源：${kumaCfg.source === 'panel' ? '控制面板' : '环境变量'}）` : ''}`);
    console.log(`  ├─ 轮询间隔  ${interval / 1000}s（SSE 推送）`);
    console.log(`  ├─ Socket    ${socketInfo.enabled ? '已启用' : '未启用（轮询模式）'}`);
    console.log(`  ├─ 验证码    ${authSettings.captchaEnabled ? '已开启（登录需图形验证码）' : '已关闭'}`);
    console.log(`  ├─ 数据目录  ${dirs.dataDir}${writable.ok ? '' : '  ⚠ 不可写'}`);
    console.log(`  ├─ 上传目录  ${dirs.uploadDir}`);
    console.log(`  ├─ 管理后台  http://${shownHost}:${PORT}/#admin`);
    console.log(`  └─ 管理员    ${authSettings.username}`);
    console.log('');
  });
}

function shutdown(signal) {
  console.log(`\n[${signal}] 正在优雅退出...`);
  sseBus.closeAll();
  statusService.stopPolling();
  kumaSocket.disconnectKuma();
  if (server) {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 未捕获异常不应让进程静默死亡（容器编排更希望看到日志）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

start().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});

module.exports = app;