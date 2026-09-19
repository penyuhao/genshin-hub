// routes/status.js — Kuma 状态查询 + SSE 实时推送
const router = require('express').Router();
const statusService = require('../services/statusService');
const sseBus = require('../services/sseBus');
const kumaSocket = require('../services/kumaSocket');
const kumaConfig = require('../services/kumaConfig');

/** GET /api/status/monitors — 合并后的监控列表（含摘要、心跳历史） */
router.get('/monitors', async (req, res, next) => {
  try {
    const snapshot = await statusService.getStatus({ force: req.query.refresh === '1' });
    res.set('Cache-Control', 'no-store');
    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

/** GET /api/status/summary — 整体状态摘要 */
router.get('/summary', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await statusService.getSummary());
  } catch (err) {
    next(err);
  }
});

/** GET /api/status/heartbeat/:id — 指定监控的心跳历史 */
router.get('/heartbeat/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: '监控 ID 非法' });
    }
    const data = await statusService.getHeartbeat(id);
    if (!data) return res.status(404).json({ error: '监控不存在' });
    res.set('Cache-Control', 'no-store');
    return res.json(data);
  } catch (err) {
    return next(err);
  }
});

/** GET /api/status/connection — Kuma 连接状态（含 Socket/SSE 信息） */
router.get('/connection', async (req, res, next) => {
  try {
    const info = await statusService.getConnectionInfo();
    res.set('Cache-Control', 'no-store');
    res.json({ ...info, socket: kumaSocket.getSocketStatus() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/status/open — 服务端跳转到 Kuma 状态页（前端永远拿不到 Kuma URL）
    地址与 slug 取自「面板配置优先、.env 兜底」的运行时设置 */
router.get('/open', (req, res) => {
  const cfg = kumaConfig.runtimeCredentials();
  const base = (cfg.url || '').trim().replace(/\/+$/, '');
  const slug = (cfg.slug || '').trim();

  if (!base || !slug) {
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Mock 演示模式</title>' +
          '<body style="font-family:system-ui;background:#0b1020;color:#f0ece0;padding:40px;line-height:1.8">' +
          '<h2 style="color:#e8c877">当前为 Mock 演示模式</h2>' +
          '<p>还没有配置数据源，所以没有外部状态页可跳转。</p>' +
          '<p><b>配置方法</b>：登录 <a style="color:#7fd8d8" href="/#admin">管理后台</a> → 左侧「<b>数据源设置</b>」→ 填 Kuma 地址与状态页 slug（可选 API Key）→「测试连接」→「保存并热重载」。</p>' +
          '<p>也支持写在 <code>server/.env</code> 的 <code>KUMA_URL</code> / <code>KUMA_STATUS_SLUG</code>，但<b>面板配置优先</b>。</p>' +
          '<p>配置好后，本链接会由后端 302 跳转到真实的 Uptime Kuma 状态页（前端始终不接触 Kuma 地址）。</p>' +
          '<p style="color:#9aa0b5;font-size:13px">当前生效配置来源：' +
          (kumaConfig.get().source === 'panel'
            ? '控制面板'
            : kumaConfig.get().source === 'env'
              ? '环境变量 .env'
              : '未配置') +
          '</p>' +
          '</body>'
      );
    return;
  }

  // 只允许 http(s) 跳转，防开放重定向
  if (!/^https?:\/\//i.test(base)) {
    return res.status(500).json({ error: 'Kuma 地址配置非法（必须是 http(s):// 开头）' });
  }
  return res.redirect(302, `${base}/status/${encodeURIComponent(slug)}`);
});

/** GET /api/status/events — SSE 实时推送（轮询变化 + 可选 Socket 心跳） */
router.get('/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 关闭 Nginx 缓冲
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let initial = null;
  try {
    const snapshot = await statusService.getStatus();
    initial = {
      monitors: snapshot.monitors,
      summary: snapshot.summary,
      lastUpdated: snapshot.lastUpdated,
      source: snapshot.source,
      stale: Boolean(snapshot.stale),
    };
  } catch {
    initial = null;
  }

  sseBus.addClient(res, initial);

  req.on('close', () => {
    sseBus.removeClient(res);
    res.end();
  });
});

module.exports = router;