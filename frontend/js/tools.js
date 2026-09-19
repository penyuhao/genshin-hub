// js/tools.js — 功能视图：Uptime Kuma 状态面板
// 数据全部来自本站后端（前端不接触 Kuma 地址与凭据）
import { el, clear, buildSparkline, formatRelativeTime, toast, fetchWithTimeout, isMobileViewport } from './util.js';

const FALLBACK_POLL_MS = 60000; // SSE 不可用时的兜底轮询（不狂刷）

const STATUS_TEXT = {
  up: '运行中',
  down: '异常',
  pending: '等待中',
  maintenance: '维护中',
  unknown: '未知',
};

export class ToolsPanel {
  constructor(refs = {}) {
    this.summaryEl = refs.summaryEl;
    this.gridEl = refs.gridEl;
    this.emptyEl = refs.emptyEl;
    this.badgeEl = refs.badgeEl;
    this.toolbarEl = refs.toolbarEl;
    this.refreshBtn = refs.refreshBtn;
    this.openLink = refs.openLink;

    this.enabled = true;
    this.snapshot = null;
    this.mode = 'mock';
    this.source = null;
    this.eventSource = null;
    this.fallbackTimer = null;
    this.loading = false;
    this.bound = [];
  }

  init(config = {}) {
    const features = config.features || {};
    this.enabled = features.enableKumaPanel !== false;

    if (!this.enabled) {
      this.renderDisabled();
      return;
    }

    if (this.refreshBtn) {
      const handler = () => this.load({ force: true });
      this.refreshBtn.addEventListener('click', handler);
      this.bound.push(() => this.refreshBtn.removeEventListener('click', handler));
    }

    // Mock 模式下「打开状态页」只给提示，不跳转到说明页
    if (this.openLink) {
      const linkHandler = (event) => {
        if (this.mode !== 'mock') return;
        event.preventDefault();
        toast('Mock 演示模式：配置 Kuma 后此链接会跳转到真实状态页（前端不接触 Kuma 地址）', 'info', 4200);
      };
      this.openLink.addEventListener('click', linkHandler);
      this.bound.push(() => this.openLink.removeEventListener('click', linkHandler));
    }

    if (this.toolbarEl) this.toolbarEl.hidden = false;
    this.load({ force: true });
    this.connectSSE();
  }

  /** 面板被功能开关关闭 */
  renderDisabled() {
    clear(this.gridEl);
    if (this.toolbarEl) this.toolbarEl.hidden = true;
    if (this.summaryEl) {
      clear(this.summaryEl);
      this.summaryEl.hidden = true;
    }
    if (this.emptyEl) {
      this.emptyEl.hidden = false;
      clear(this.emptyEl);
      this.emptyEl.append(
        el('p', { class: 'empty-title', text: '功能模块已关闭' }),
        el('p', { text: '管理员可在「管理后台 → 功能开关」中重新启用 Kuma 状态面板' })
      );
    }
  }

  /** 拉取一次状态数据 */
  async load({ force = false } = {}) {
    if (!this.enabled || this.loading) return;
    this.loading = true;
    this.refreshBtn?.classList.add('is-loading');

    try {
      const res = await fetchWithTimeout(
        `/api/status/monitors${force ? '?refresh=1' : ''}`,
        { headers: { Accept: 'application/json' } },
        10000
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.mode = data.source === 'live' ? 'live' : 'mock';
      this.source = data.source;
      this.render(data);
      this.setBadge({
        state: data.stale ? 'stale' : this.mode,
        text: data.stale
          ? `数据可能过期（${formatRelativeTime(data.lastUpdated)}）`
          : this.mode === 'live'
            ? `实时数据 · ${formatRelativeTime(data.lastUpdated)}`
            : `演示数据 · ${formatRelativeTime(data.lastUpdated)}`,
      });
    } catch (err) {
      this.renderError(err);
    } finally {
      this.loading = false;
      this.refreshBtn?.classList.remove('is-loading');
    }
  }

  renderError(err) {
    if (!this.summaryEl) return;
    clear(this.summaryEl);
    this.summaryEl.hidden = false;
    this.summaryEl.append(
      el('div', { class: 'summary-status is-down' },
        el('span', { class: 'status-dot' }),
        el('span', { class: 'status-text', text: '状态数据加载失败' })),
      el('p', { class: 'monitor-msg', text: `原因：${err?.message || '未知错误'}` }),
      el('div', { style: { marginTop: '14px' }, class: 'toolbar-actions' },
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: '重试',
          onclick: () => this.load({ force: true }),
        }))
    );

    if (this.gridEl) clear(this.gridEl);
    this.setBadge({ state: 'error', text: '后端不可用' });
  }

  /** 渲染摘要 + 监控网格 */
  render(snapshot) {
    if (!snapshot) return;
    this.snapshot = snapshot;

    // 通知首页「服务状态速览」同步（不额外开连接）
    document.dispatchEvent(new CustomEvent('status-updated', { detail: snapshot }));

    const summary = snapshot.summary || {};
    const monitors = Array.isArray(snapshot.monitors) ? snapshot.monitors : [];
    const offline = (summary.down || 0) + (summary.maintenance || 0);

    // ---- 摘要卡片 ----
    if (this.summaryEl) {
      clear(this.summaryEl);
      this.summaryEl.hidden = false;

      const stateClass = summary.down > 0 ? 'is-down' : summary.pending > 0 ? 'is-pending' : '';
      const text = summary.down > 0
        ? `${summary.down} 个服务异常`
        : summary.total === 0
          ? '暂无监控项'
          : '所有服务正常';

      this.summaryEl.append(
        el('div', { class: `summary-status ${stateClass}` },
          el('span', { class: 'status-dot' }),
          el('span', { class: 'status-text', text })),
        el('div', { class: 'summary-numbers' },
          el('span', {}, '总计 ', el('b', { text: String(summary.total ?? 0) })),
          el('span', {}, '在线 ', el('b', { text: String(summary.up ?? 0) })),
          el('span', {}, '离线 ', el('b', { text: String(summary.down ?? 0) })),
          el('span', {}, '维护 ', el('b', { text: String(summary.maintenance ?? 0) })),
          el('span', {}, '更新于 ', el('b', { text: formatRelativeTime(snapshot.lastUpdated) }))),
        snapshot.stale
          ? el('span', { class: 'stale-badge', text: `Kuma 不可用，正在展示最后一次成功数据${snapshot.error ? `（${snapshot.error}）` : ''}` })
          : el('span', { class: 'stale-badge', style: { display: 'none' } })
      );
      this.summaryEl.classList.toggle('is-stale', Boolean(snapshot.stale));
    }

    // ---- 监控网格 ----
    if (this.gridEl) {
      const previous = new Map();
      this.gridEl.querySelectorAll('.monitor-card').forEach((card) => {
        previous.set(card.dataset.id, card.dataset.status);
      });

      clear(this.gridEl);

      if (!monitors.length) {
        if (this.emptyEl) {
          this.emptyEl.hidden = false;
          clear(this.emptyEl);
          this.emptyEl.append(
            el('p', { class: 'empty-title', text: '暂无监控项' }),
            el('p', { text: '请在 Uptime Kuma 的状态页中添加监控，或在 server/.env 配置 KUMA_URL / KUMA_STATUS_SLUG' })
          );
        }
      } else {
        if (this.emptyEl) this.emptyEl.hidden = true;

        // 按 Kuma 状态页的分组显示（顺序也沿用 Kuma 里排好的顺序）：
        // 后端就是按状态页 publicGroupList 的顺序输出的，这里只负责"分块 + 加标题"。
        const groups = new Map();
        for (const monitor of monitors) {
          const name = String(monitor.group || '').trim();
          if (!groups.has(name)) groups.set(name, []);
          groups.get(name).push(monitor);
        }
        const hasGroups = [...groups.keys()].some((name) => name);

        for (const [groupName, list] of groups) {
          if (hasGroups) {
            this.gridEl.appendChild(
              el('div', { class: 'monitor-group' },
                el('h3', { class: 'monitor-group-title', text: groupName || '未分组' }),
                el('span', { class: 'monitor-group-count', text: `${list.length} 项` }))
            );
          }
          for (const monitor of list) {
            const card = this.buildMonitorCard(monitor);
            if (!previous.has(String(monitor.id))) card.classList.add('is-new');
            this.gridEl.appendChild(card);
          }
        }
      }
    }

    if (this.openLink) {
      this.openLink.hidden = false;
      this.openLink.href = '/api/status/open';
    }
  }

  buildMonitorCard(monitor) {
    const status = String(monitor.status || 'unknown');
    const uptime = typeof monitor.uptime24h === 'number' ? `${monitor.uptime24h.toFixed(2)}%` : '--';
    const ping = typeof monitor.ping === 'number' ? `${monitor.ping} ms` : '--';

    const card = el('article', {
      class: 'monitor-card',
      dataset: { id: String(monitor.id), status },
      tabindex: '0',
      role: 'button',
      'aria-label': `${monitor.name}：${STATUS_TEXT[status] || status}，24 小时可用率 ${uptime}，延迟 ${ping}`,
    },
      el('header', { class: 'monitor-header' },
        el('span', { class: 'monitor-dot' }),
        el('span', { class: 'monitor-name', text: monitor.name || `监控 #${monitor.id}` })),
      el('div', { class: 'monitor-stats' },
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: '24h 可用率' }),
          el('span', { class: 'stat-value', text: uptime })),
        el('div', { class: 'stat' },
          el('span', { class: 'stat-label', text: '延迟' }),
          el('span', { class: 'stat-value', text: ping }))),
      monitor.msg ? el('p', { class: 'monitor-msg', text: `最近状态：${monitor.msg}` }) : null,
      monitor.history?.length ? buildSparkline(monitor.history, { width: 240, height: 30 }) : null
    );

    const open = () => {
      // Mock 演示模式没有真实状态页：给出明确提示，而不是打开一张说明页
      if (this.mode === 'mock') {
        toast('当前为 Mock 演示模式：可在管理后台「数据源设置」填入 Kuma 地址与状态页 slug 后跳转真实状态页', 'info', 4600);
        return;
      }
      // 由后端 302 跳转，前端不接触 Kuma 地址
      window.open('/api/status/open', '_blank', 'noopener,noreferrer');
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    return card;
  }

  setBadge({ state, text }) {
    if (!this.badgeEl) return;
    this.badgeEl.className = `conn-badge is-${state}`;
    const textEl = this.badgeEl.querySelector('.conn-text');
    if (textEl) textEl.textContent = text;
  }

  /** SSE 实时推送：成功则不做轮询，失败才启用兜底轮询 */
  connectSSE() {
    if (!this.enabled || typeof EventSource === 'undefined') {
      this.startFallbackPolling();
      return;
    }

    try {
      this.eventSource = new EventSource('/api/status/events');
    } catch {
      this.startFallbackPolling();
      return;
    }

    this.eventSource.addEventListener('open', () => {
      this.stopFallbackPolling();
      this.setBadge({ state: this.mode, text: this.mode === 'live' ? '实时推送已连接' : '实时推送已连接（演示数据）' });
    });

    this.eventSource.addEventListener('status', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data || !Array.isArray(data.monitors)) return;
        this.mode = data.source === 'live' ? 'live' : 'mock';
        this.render(data);
        this.setBadge({
          state: data.stale ? 'stale' : this.mode,
          text: data.stale ? '数据可能过期' : `实时推送 · ${formatRelativeTime(data.lastUpdated)}`,
        });
      } catch (err) {
        console.warn('[tools] SSE 数据解析失败：', err);
      }
    });

    this.eventSource.addEventListener('error', () => {
      this.setBadge({ state: 'stale', text: '实时推送中断，已切换为定时刷新' });
      this.startFallbackPolling();
    });

    // 自定义事件：Kuma Socket 心跳（阶段10 可选通道）
    this.eventSource.addEventListener('heartbeat', () => {
      if (!this.loading) this.load();
    });
  }

  startFallbackPolling() {
    if (this.fallbackTimer) return;
    this.fallbackTimer = setInterval(() => {
      if (!document.hidden) this.load();
    }, FALLBACK_POLL_MS);
  }

  stopFallbackPolling() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /** 供管理后台保存配置后调用（例如切换了功能开关） */
  refresh() {
    if (!this.enabled) return;
    this.load({ force: true });
  }

  destroy() {
    this.stopFallbackPolling();
    this.eventSource?.close();
    this.eventSource = null;
    this.bound.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    this.bound = [];
  }
}