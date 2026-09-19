// routes/settings.js — 运行时可配置项（管理后台「数据源设置」）
// 数据源凭据保存在 server/data/kuma.json，绝不进入公开的 /api/config
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const { kumaSettingsSchema } = require('../middleware/validate');
const kumaConfig = require('../services/kumaConfig');
const statusService = require('../services/statusService');
const kumaSocket = require('../services/kumaSocket');
const kumaRest = require('../services/kumaRest');

/** GET /api/settings/kuma — 读取当前数据源设置（密钥脱敏） */
router.get('/kuma', requireAdmin, async (req, res, next) => {
  try {
    const view = kumaConfig.adminView();
    const connection = await kumaRest.checkConnection();
    res.json({ ...view, connection });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/settings/kuma — 保存并热重载（无需重启进程） */
router.put('/kuma', requireAdmin, async (req, res, next) => {
  try {
    const parsed = kumaSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: '设置校验失败',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const saved = await kumaConfig.persist(parsed.data);

    // 热重载：清缓存 + 重启轮询 + 重连 Socket
    statusService.stopPolling();
    kumaSocket.disconnectKuma();
    const interval = statusService.startPolling(saved.pollInterval);
    const socketInfo = kumaSocket.connectKuma();
    await statusService.refresh().catch(() => {});

    const connection = await kumaRest.checkConnection();

    return res.json({
      ok: true,
      message: kumaConfig.isConfigured()
        ? `已保存并切换到真实数据源（轮询 ${interval / 1000}s${socketInfo.enabled ? '，Socket 已启用' : ''}）`
        : '已保存：当前仍为 Mock 演示模式（需填写 Kuma 地址与状态页 slug）',
      settings: kumaConfig.adminView(),
      connection,
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /api/settings/kuma/test — 用当前（或传入的）配置测试连接，不落盘 */
router.post('/kuma/test', requireAdmin, async (req, res, next) => {
  try {
    const hasOverrides = req.body && Object.keys(req.body).length > 0;
    let overrides = null;

    if (hasOverrides) {
      const parsed = kumaSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: '测试参数校验失败',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      // 未填写的字段沿用已保存的值（便于「只改 slug 再测」）
      const current = kumaConfig.runtimeCredentials();
      overrides = {
        url: parsed.data.url ?? current.url,
        slug: parsed.data.slug ?? current.slug,
        apiKey: parsed.data.apiKey ?? current.apiKey,
        username: parsed.data.username ?? current.username,
        password: parsed.data.password ?? current.password,
      };
    }

    const result = await kumaRest.checkConnection(overrides);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;