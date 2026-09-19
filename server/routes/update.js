// routes/update.js — 版本检查与一键更新（管理员）
//
// 两个接口：
//   GET  /api/update/check  查询 GitHub 上最新 Release，和当前版本比对
//   POST /api/update/apply  执行 git pull + 安装依赖（**默认关闭**，需 .env 里 ALLOW_SELF_UPDATE=true）
//
// 为什么默认关闭：从网页点一下就改代码 + 装依赖，等于给出一个远程执行入口；
// 而且升级过程中页面还在跑旧代码，容器/PaaS 上还可能需要重新构建。所以：
//   · 检查更新（只读，安全）永远可用
//   · 真正执行更新必须显式开启，并且只在「git 工作区干净」时才动手
const router = require('express').Router();
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const configService = require('../services/configService');

const ROOT = path.join(__dirname, '..', '..');
const APP_VERSION = (() => {
  try {
    return require(path.join(ROOT, 'package.json')).version;
  } catch {
    return '0.0.0';
  }
})();

/** GitHub API 地址（可覆盖，便于内网镜像或测试） */
const apiBase = () => (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const selfUpdateEnabled = () => String(process.env.ALLOW_SELF_UPDATE || '').toLowerCase() === 'true';

/** 从配置里的站点信息推断仓库（site.repoUrl → owner/repo） */
async function repoOf() {
  const config = await configService.getConfig().catch(() => ({}));
  const url = String(config?.site?.repoUrl || process.env.REPO_URL || '').trim();
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  if (!m) return '';
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
}

/** 版本号比较（1.2.10 > 1.2.9） */
function isNewer(latest, current) {
  const a = String(latest).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(current).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function github(pathname) {
  const headers = {
    'User-Agent': 'genshin-hub-updater',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${apiBase()}${pathname}`, { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`GitHub 返回 HTTP ${res.status}`);
  return res.json();
}

/** GET /api/update/check — 检查是否有新版本 */
router.get('/check', requireAdmin, async (req, res) => {
  const repo = await repoOf();
  const result = {
    current: APP_VERSION,
    repo,
    selfUpdateEnabled: selfUpdateEnabled(),
    hasUpdate: false,
    latest: '',
    name: '',
    publishedAt: '',
    notes: '',
    htmlUrl: repo ? `https://github.com/${repo}/releases` : '',
  };

  if (!repo) {
    return res.json({ ...result, error: '没有配置仓库地址（后台「站点设置 → 开源仓库地址」）' });
  }

  try {
    const release = await github(`/repos/${repo}/releases/latest`);
    result.latest = String(release.tag_name || '').replace(/^v/, '');
    result.name = release.name || release.tag_name || '';
    result.publishedAt = release.published_at || '';
    result.notes = String(release.body || '').slice(0, 4000);
    result.htmlUrl = release.html_url || result.htmlUrl;
    result.hasUpdate = isNewer(result.latest, result.current);
    return res.json(result);
  } catch (err) {
    // 2023 起 GitHub 对未认证请求限流较严；失败不该影响站点，返回提示即可
    return res.json({ ...result, error: `查询 GitHub 失败：${err.message}` });
  }
});

/** POST /api/update/apply — 执行 git pull（默认关闭） */
router.post('/apply', requireAdmin, async (req, res) => {
  if (!selfUpdateEnabled()) {
    return res.status(403).json({
      error: '一键更新未开启。请在 .env 里设置 ALLOW_SELF_UPDATE=true，并确认这是 git 检出且数据目录已挂载之后再试',
      hint: '也可以手动更新：git pull && npm install && 重启进程',
    });
  }

  const { execFile } = require('child_process');
  const run = (cmd, args, cwd) =>
    new Promise((resolve) => {
      execFile(cmd, args, { cwd, timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
        resolve({
          cmd: `${cmd} ${args.join(' ')}`,
          ok: !err,
          output: `${stdout || ''}${stderr || ''}`.trim().slice(-4000) || (err ? err.message : ''),
        });
      });
    });

  const steps = [];
  steps.push(await run('git', ['fetch', '--all', '--tags'], ROOT));
  if (!steps[0].ok) {
    return res.status(500).json({ error: 'git fetch 失败', steps });
  }
  steps.push(await run('git', ['pull', '--ff-only'], ROOT));
  if (!steps[1].ok) {
    return res.status(409).json({
      error: 'git pull 失败（可能有本地改动或冲突）—— 请手动处理后重试',
      steps,
      hint: '查看 git status；需要保留本地改动时先 git stash',
    });
  }
  steps.push(await run('npm', ['install', '--no-audit', '--no-fund'], path.join(ROOT, 'server')));

  return res.json({
    ok: true,
    version: APP_VERSION,
    steps,
    restartHint: '代码已更新。请重启进程（pm2 restart / systemctl restart / docker compose up -d --build）让新版本生效',
  });
});

module.exports = router;
