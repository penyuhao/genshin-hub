// middleware/security.js — Helmet(CSP/HSTS) + CORS 白名单 + 速率限制
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const isProd = process.env.NODE_ENV === 'production';

// 是否**真的**在提供 HTTPS：配了证书就跑 https；反代终止 TLS 时可用 FORCE_HTTPS_HEADERS=true 显式声明。
// 这一点很关键：CSP 的 upgrade-insecure-requests 会让浏览器把所有子资源请求升级成 https，
// 若站点其实是纯 http（局域网 IP 直连容器很常见），css/js/图片会全部 ERR_SSL_PROTOCOL_ERROR。
const tlsEnabled =
  Boolean(process.env.SSL_CERT || process.env.SSL_KEY || process.env.SSL_PFX) ||
  String(process.env.FORCE_HTTPS_HEADERS || '').toLowerCase() === 'true';

// ---- CSP：default-src 'self'，第三方来源一律显式白名单 ----
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // 动态主题变量需要内联 style 属性
      imgSrc: ["'self'", 'data:', 'https:', 'http:'], // http: 给自建 http 站点/内网图片放行；HTTPS 页面下浏览器仍会拦混合内容
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", 'https:', 'http:'], // 背景音乐与背景视频（同理）
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: tlsEnabled ? [] : null,
    },
  },
  // HSTS 仅在 HTTPS 生产环境启用（Let's Encrypt + Nginx 前置）
  hsts: isProd && tlsEnabled ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // 方案验收标准要求 X-Frame-Options: DENY（与 CSP frame-ancestors 'none' 双重保险）
  frameguard: { action: 'deny' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginEmbedderPolicy: false,
});

// ---- CORS：显式白名单，绝不用 * ----
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:3001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * 同源请求永远放行。
 *
 * 为什么必须这样：浏览器对 POST/PUT 等请求会带上**当前页面**的 Origin，
 * 一旦站点的协议/端口/域名有任何变化（例如从 http 换成 https 自签证书访问），
 * 或者部署到 NAS / 反向代理后面的其他域名，白名单就会把**自己的同源请求**判成跨域：
 * 表现是"验证码加载失败：Failed to fetch""后台进不去"，而白名单看起来又没写错。
 * 这里只要 Origin 的 host 与本次请求的 Host 一致，就直接放行。
 */
function isSameOrigin(origin, req) {
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host || '').trim().toLowerCase();
    if (!host) return false;
    return parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// cors 的 origin 回调拿不到 req，所以这里按请求包一层
const corsConfig = (req, res, next) =>
  cors({
    origin(origin, cb) {
      // 同源请求（无 Origin 头）直接放行
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      if (isSameOrigin(origin, req)) return cb(null, true);
      return cb(new Error('CORS: 来源不在白名单内'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 600,
  })(req, res, next);

// ---- 限流参数（可用环境变量调整，生产默认严格）----
const API_MAX = Number(process.env.API_RATE_LIMIT_MAX) > 0 ? Number(process.env.API_RATE_LIMIT_MAX) : 100;
const LOGIN_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX) > 0 ? Number(process.env.LOGIN_RATE_LIMIT_MAX) : 10;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * 本机开发豁免：仅在「非生产 + 显式开启 RATE_LIMIT_BYPASS_LOOPBACK」时，
 * 跳过来自回环地址的限流，方便本地反复刷新与跑自动化测试。
 * 生产环境（NODE_ENV=production）始终严格限流，且该开关默认关闭。
 */
const bypassLoopback =
  !isProd && String(process.env.RATE_LIMIT_BYPASS_LOOPBACK || '').toLowerCase() === 'true';

const isLoopbackRequest = (req) => bypassLoopback && LOOPBACK.has(req.ip);

// ---- 全局 API 限流：每 IP 每 15 分钟 N 次（SSE 长连接除外）----
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/status/events' || isLoopbackRequest(req),
  message: { error: '请求过于频繁，请稍后重试' },
});

// ---- 登录接口单独严格限流：每 IP 每 15 分钟 N 次 ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: LOGIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // 成功登录不占额度，防误伤；爆破仍被计数
  skip: (req) => isLoopbackRequest(req),
  message: { error: '登录尝试过于频繁，请 15 分钟后再试' },
});

module.exports = { helmetConfig, corsConfig, apiLimiter, loginLimiter, API_MAX, LOGIN_MAX, bypassLoopback, tlsEnabled };
