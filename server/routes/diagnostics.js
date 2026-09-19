// routes/diagnostics.js — 站点体检（管理员）
// GET /api/diagnostics → 一份"哪里有问题"的清单
const router = require('express').Router();
const diagnostics = require('../services/diagnostics');
const configService = require('../services/configService');
const kumaConfig = require('../services/kumaConfig');
const authService = require('../services/authService');
const sseBus = require('../services/sseBus');
const { requireAdmin } = require('../middleware/auth');
const { isConfigured } = require('../services/kumaRest');

const APP_VERSION = (() => {
  try {
    return require('../../package.json').version;
  } catch {
    return 'unknown';
  }
})();

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const [config, authSettings] = await Promise.all([
      configService.getConfig(),
      authService.getSettings().catch(() => ({})),
    ]);

    const report = await diagnostics.run({
      config,
      authSettings,
      kumaCfg: kumaConfig.get(),
      isConfigured: isConfigured(),
      sseClients: sseBus.clientCount(),
      version: APP_VERSION,
      uptime: process.uptime(),
      tls: Boolean(process.env.SSL_CERT || process.env.SSL_PFX),
      // req.protocol 会尊重 trust proxy：反代终止 TLS 时这里也是 https
      proto: req.protocol,
    });

    res.set('Cache-Control', 'no-store');
    res.json(report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
