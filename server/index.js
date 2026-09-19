// index.js — 原神功能快捷站后端入口
// 职责：安全中间件 → 静态资源托管 → API 路由 → SPA 回退 → 统一错误处理
require('dotenv').config();

const path = require('path');
const express = require('express');

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
const sseBus = require('./services/sseBus');
const { isConfigured } = require('./services/kumaRest');

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const PORT = Number(process.env.PORT) || 3001;
const isProd = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
// 部署在 Nginx 之后时，正确识别客户端 IP（速率限制依赖）
app.set('trust proxy', 1);

// ---------- 安全中间件 ----------
app.use(helmetConfig);
app.use(corsConfig);

// ---------- 静态资源（同源托管前端，避免跨域与密钥暴露）----------
app.use(
  express.static(FRONTEND_DIR, {
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

async function bootstrap() {
  // 首次启动生成 data/config.json
  await configService.ensureConfigFile();
  // 数据源运行时设置（data/kuma.json）与管理员凭据（data/auth.json）
  await kumaConfig.ensureLoaded();
  await authService.ensureStore();
  // 上传目录
  await fontService.ensureDirs();
  await require('fs').promises.mkdir(path.join(FRONTEND_DIR, 'images/uploads'), { recursive: true });

  // 状态轮询 + SSE 广播（间隔来自后台「数据源设置」）
  const interval = statusService.startPolling();
  // 可选：Kuma Socket 实时通道
  const socketInfo = kumaSocket.connectKuma();

  server = app.listen(PORT, async () => {
    const configured = isConfigured();
    const authSettings = await authService.getSettings().catch(() => ({ username: 'admin', captchaEnabled: true }));
    const kumaCfg = kumaConfig.get();

    console.log('');
    console.log('  原神功能快捷站 · 后端已启动');
    console.log(`  ├─ 地址      http://localhost:${PORT}`);
    console.log(`  ├─ 健康检查  http://localhost:${PORT}/health`);
    console.log(`  ├─ 数据源    ${configured ? '真实 Kuma 数据源' : 'Mock 演示模式'}${configured ? `（来源：${kumaCfg.source === 'panel' ? '控制面板' : '环境变量'}）` : ''}`);
    console.log(`  ├─ 轮询间隔  ${interval / 1000}s（SSE 推送）`);
    console.log(`  ├─ Socket    ${socketInfo.enabled ? '已启用' : '未启用（轮询模式）'}`);
    console.log(`  ├─ 验证码    ${authSettings.captchaEnabled ? '已开启（登录需图形验证码）' : '已关闭'}`);
    console.log(`  ├─ 管理后台  http://localhost:${PORT}/#admin`);
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

bootstrap().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});

module.exports = app;