// middleware/auth.js — 管理员 JWT 认证中间件
const jwt = require('jsonwebtoken');
const authService = require('../services/authService');

/**
 * 校验 Authorization: Bearer <token>
 * 通过后在 req.user 注入解码结果
 * 令牌内带 tokenVersion（v）：改密后服务端版本自增 → 所有旧令牌立即失效
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) return res.status(401).json({ error: '未提供认证令牌' });

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: '服务端认证密钥未配置' });

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (!decoded || decoded.isAdmin !== true) {
      return res.status(403).json({ error: '权限不足' });
    }

    const currentVersion = authService.getTokenVersion();
    if (Number(decoded.v || 1) !== Number(currentVersion)) {
      return res.status(401).json({ error: '登录状态已失效，请重新登录' });
    }

    req.user = decoded;
    return next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? '令牌已过期，请重新登录' : '令牌无效' });
  }
}

module.exports = { requireAdmin };