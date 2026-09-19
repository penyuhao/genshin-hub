// routes/auth.js — 管理员认证
// 安全链路：图形验证码（一次性） → 恒定时间比较/bcrypt → JWT（带 tokenVersion）
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { loginSchema } = require('../middleware/validate');
const { requireAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/security');
const authService = require('../services/authService');
const captcha = require('../services/captcha');

/** 测试/CI 用的验证码旁路令牌：仅在 .env 显式配置且请求头匹配时生效 */
function bypassToken() {
  return (process.env.CAPTCHA_BYPASS_TOKEN || '').trim();
}

function hasBypass(req) {
  const token = bypassToken();
  if (!token) return false;
  const provided = String(req.headers['x-captcha-bypass'] || '').trim();
  return provided.length > 0 && provided === token;
}

/** GET /api/auth/captcha — 取一张图形验证码（图片为 PNG data URI，答案只在服务端） */
router.get('/captcha', (req, res) => {
  const captchaData = captcha.createCaptcha();
  const payload = {
    ok: true,
    id: captchaData.id,
    image: captchaData.image,
    expiresIn: captchaData.expiresIn,
  };

  // 仅当携带正确的旁路令牌时，才把答案一并返回（用于自动化测试真实登录流程）
  if (hasBypass(req)) payload.code = captchaData.code;

  res.set('Cache-Control', 'no-store');
  res.json(payload);
});

/** GET /api/auth/public-settings — 登录页需要的公开信息（是否需要验证码） */
router.get('/public-settings', async (req, res, next) => {
  try {
    const settings = await authService.getSettings();
    res.json({ captchaEnabled: settings.captchaEnabled, siteTitle: '原神功能快捷站' });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/login — 管理员登录 */
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: '请求格式错误' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: '服务端认证密钥未配置' });

    const settings = await authService.getSettings();
    const { username, password, captchaId, captchaCode } = parsed.data;

    // ---- 验证码校验（可在后台「账号与安全」中关闭）----
    if (settings.captchaEnabled && !hasBypass(req)) {
      if (!captchaId || !captchaCode) {
        return res.status(400).json({ error: '请输入图形验证码', code: 'CAPTCHA_REQUIRED' });
      }
      if (!captcha.verifyCaptcha(captchaId, captchaCode)) {
        return res.status(400).json({ error: '验证码错误或已过期，请重新输入', code: 'CAPTCHA_INVALID' });
      }
    }

    const ok = await authService.verifyCredentials(username, password);
    if (!ok) {
      // 统一错误文案，不暴露用户名是否存在
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign(
      { username, isAdmin: true, v: authService.getTokenVersion() },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h', algorithm: 'HS256' }
    );

    return res.json({
      token,
      username,
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /api/auth/check — 校验令牌是否仍然有效 */
router.get('/check', requireAdmin, (req, res) => {
  res.json({ ok: true, user: { username: req.user.username, isAdmin: true } });
});

/** GET /api/auth/settings — 登录安全设置（管理员） */
router.get('/settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = await authService.getSettings();
    res.json({
      username: settings.username,
      captchaEnabled: settings.captchaEnabled,
      credentialSource: settings.credentialSource,
      updatedAt: settings.updatedAt,
      captcha: captcha.stats(),
      storePath: 'server/data/auth.json',
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/auth/settings — 开关验证码（管理员） */
router.put('/settings', requireAdmin, async (req, res, next) => {
  try {
    if (typeof req.body?.captchaEnabled !== 'boolean') {
      return res.status(400).json({ error: 'captchaEnabled 必须是布尔值' });
    }
    const settings = await authService.setCaptchaEnabled(req.body.captchaEnabled);
    return res.json({
      ok: true,
      captchaEnabled: settings.captchaEnabled,
      message: settings.captchaEnabled ? '图形验证码已开启' : '图形验证码已关闭（不建议）',
    });
  } catch (err) {
    return next(err);
  }
});

/** PUT /api/auth/credentials — 修改管理员账号 / 密码（需当前密码） */
router.put('/credentials', requireAdmin, async (req, res, next) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body || {};

    if (!currentPassword) {
      return res.status(400).json({ error: '请输入当前密码以确认身份' });
    }
    if (!newUsername && !newPassword) {
      return res.status(400).json({ error: '请至少填写新用户名或新密码' });
    }
    if (newPassword && String(newPassword).length < 8) {
      return res.status(400).json({ error: '新密码至少 8 位' });
    }

    const settings = await authService.updateCredentials({
      currentPassword,
      currentUsername: req.user?.username,
      newUsername: newUsername ? String(newUsername).trim() : '',
      newPassword: newPassword ? String(newPassword) : '',
    });

    // 改密后 tokenVersion 自增，旧令牌全部失效 → 需要重新登录
    const passwordChanged = Boolean(newPassword);
    return res.json({
      ok: true,
      username: settings.username,
      passwordChanged,
      message: passwordChanged
        ? '账号信息已更新，所有登录会话已失效，请用新密码重新登录'
        : '用户名已更新，请重新登录',
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

/** POST /api/auth/logout — 无状态 JWT：前端清除令牌即可 */
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = router;