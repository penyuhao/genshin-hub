// middleware/security.js — Helmet(CSP/HSTS) + CORS 白名单 + 速率限制
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const isProd = process.env.NODE_ENV === 'production';

// ---- CSP：default-src 'self'，第三方来源一律显式白名单 ----
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // 动态主题变量需要内联 style 属性
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", 'https:'], // 背景音乐
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  // HSTS 仅在 HTTPS 生产环境启用（Let's Encrypt + Nginx 前置）
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
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

const corsConfig = cors({
  origin(origin, cb) {
    // 同源请求（无 Origin 头）直接放行
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: 来源不在白名单内'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 600,
});

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

module.exports = { helmetConfig, corsConfig, apiLimiter, loginLimiter, API_MAX, LOGIN_MAX, bypassLoopback };
