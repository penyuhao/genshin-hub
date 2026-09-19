// routes/config.js — 站点配置读写 + 备份管理
const router = require('express').Router();
const configService = require('../services/configService');
const { requireAdmin } = require('../middleware/auth');
const { validateSection, validateConfigBody, SECTIONS } = require('../middleware/validate');

/** GET /api/config — 完整配置（公开） */
router.get('/', async (req, res, next) => {
  try {
    const config = await configService.getConfig();
    res.set('Cache-Control', 'no-cache');
    res.json(config);
  } catch (err) {
    next(err);
  }
});

/** GET /api/config/sections — 可用区块清单（公开，供管理后台构建菜单） */
router.get('/sections', (req, res) => {
  res.json({ sections: SECTIONS });
});

/** GET /api/config/backups — 备份列表（管理员） */
router.get('/backups', requireAdmin, async (req, res, next) => {
  try {
    res.json({ backups: await configService.listBackups() });
  } catch (err) {
    next(err);
  }
});

/** POST /api/config/restore — 从备份恢复（管理员） */
router.post('/restore', requireAdmin, async (req, res, next) => {
  try {
    const file = typeof req.body?.file === 'string' ? req.body.file : '';
    if (!file) return res.status(400).json({ error: '缺少备份文件名' });
    const result = await configService.restoreBackup(file);
    const config = await configService.getConfig();
    return res.json({ ...result, config });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/** GET /api/config/:section — 单区块（公开） */
router.get('/:section', async (req, res, next) => {
  try {
    const section = await configService.getConfigSection(req.params.section);
    if (section === null) return res.status(404).json({ error: '配置区块不存在' });
    res.set('Cache-Control', 'no-cache');
    return res.json(section);
  } catch (err) {
    return next(err);
  }
});

/** PUT /api/config — 批量更新（管理员） */
router.put('/', requireAdmin, validateConfigBody, async (req, res, next) => {
  try {
    const { config, backup } = await configService.updateConfigSections(
      req.validatedConfig,
      req.user?.username || 'admin'
    );
    res.json({
      ok: true,
      updated: Object.keys(req.validatedConfig),
      warnings: req.validationWarnings || [],
      backup,
      config,
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/config/:section — 单区块更新（管理员 + zod 校验） */
router.put('/:section', requireAdmin, async (req, res, next) => {
  try {
    const { section } = req.params;
    const result = validateSection(section, req.body);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, details: result.details });
    }

    const updated = await configService.updateConfigSection(
      section,
      result.data,
      req.user?.username || 'admin'
    );
    return res.json({ ok: true, section, backup: updated.backup, data: updated.section });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;