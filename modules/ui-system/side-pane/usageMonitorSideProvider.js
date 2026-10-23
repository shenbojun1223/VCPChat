'use strict';

import { createSidePaneRootScope, pollWhileVisible } from './side-pane-occurrence.js';

const TAB_ID = 'usage-monitor:main';
const POLL_INTERVAL_MS = 60 * 1000;
const PERIOD_OPTIONS = Object.freeze([
    { key: 'today', label: '今日' },
    { key: '7d', label: '近7天' },
    { key: 'month', label: '本月' }
]);

const COMPACT_FORMATTER = new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1
});

export function formatNullableCompact(value) {
    if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
        return '—';
    }
    return COMPACT_FORMATTER.format(value);
}

export function formatPercent(value) {
    if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
        return '—';
    }
    return `${Number(value.toFixed(1))}%`;
}

export function formatCurrency(currency, amount) {
    if (amount === null || amount === undefined || typeof amount !== 'number' || !Number.isFinite(amount)) {
        return '—';
    }
    const code = String(currency || 'CNY').trim().toUpperCase();
    const prefix = code === 'CNY' ? '¥' : code === 'USD' ? '$' : `${code} `;
    return `${prefix}${amount.toFixed(2)}`;
}

export function formatResetLabel(iso, nowMs = Date.now()) {
    if (!iso) return '';
    const targetMs = Date.parse(iso);
    if (Number.isNaN(targetMs)) return '';
    const diffMin = Math.round((targetMs - nowMs) / 60000);
    if (diffMin <= 0) {
        return '已过重置时点';
    }
    if (diffMin < 60) {
        return `${diffMin}分钟后重置`;
    }
    if (diffMin < 24 * 60) {
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        return m > 0 ? `${h}小时${m}分后重置` : `${h}小时后重置`;
    }
    const d = new Date(targetMs);
    return `${d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 重置`;
}

export function formatShortTime(iso) {
    if (!iso) return '—';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return '—';
    return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatQuotaDiagnostic(account) {
    if (account?.source !== 'claude-bridge' || !['error', 'stale'].includes(account?.status)) return '';
    const messages = {
        quota_cooldown: '配额查询冷却中；暂不请求上游，请勿反复刷新。',
        refresh_http_429: '凭据刷新被上游限流（429），已进入冷却。',
        usage_http_429: '配额接口被上游限流（429），已进入冷却。',
        refresh_http_401: '凭据刷新认证失败（401）；需核查登录状态。',
        usage_http_401: '配额接口认证失败（401）；本次未获得新配额。',
        quota_service_busy: 'Bridge 正在处理其他任务，配额查询暂缓。',
        quota_cli_active: '检测到 Claude CLI 正在运行，配额查询暂缓。',
        residential_proxy_config_invalid: '住宅代理配置校验失败；已拒绝直连。',
        refresh_proxy_request_failed: '通过住宅代理刷新凭据失败；未回退直连。',
        usage_proxy_request_failed: '通过住宅代理查询配额失败；未回退直连。',
        credentials_persist_failed: '刷新后的凭据未能可靠保存，需检查。',
        credentials_changed_after_refresh: '刷新期间凭据发生并发变化，已拒绝覆盖。',
        quota_guard_failed: '配额保护检查失败，需查看脱敏诊断记录。'
    };
    return messages[account.errorCode] || '配额查询未成功；需查看后台诊断。';
}

export function formatAccountStatusText(account) {
    switch (account?.status) {
        case 'ok':
            return '正常';
        case 'stale':
            return '数据陈旧';
        case 'unconfigured':
            return '未配置';
        case 'unsupported':
            return '未接入';
        case 'error':
            return account?.errorCode === 'AUTH_REQUIRED' ? '需要重新授权' : '异常';
        default:
            return String(account?.status || '未知');
    }
}

const STYLE_ELEMENT_ID = 'vcp-side-usage-monitor-style';
const CSS_TEXT = `
.side-usage-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    color: var(--vcp-text-primary, var(--primary-text, #e5e7eb));
    font-size: 12px;
}
.side-usage-scope {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.side-usage-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--vcp-border-subtle, rgba(128,128,128,0.2));
}
.side-usage-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.side-usage-title {
    font-weight: 600;
    font-size: 13px;
}
.side-usage-updated {
    font-size: 11px;
    opacity: 0.72;
}
.side-usage-controls {
    display: flex;
    align-items: center;
    gap: 6px;
}
.side-usage-period-group {
    display: inline-flex;
    border-radius: 6px;
    background: var(--vcp-bg-elevated, rgba(128,128,128,0.12));
    padding: 2px;
    gap: 2px;
}
.side-usage-period-btn {
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.72;
    font-size: 11px;
    padding: 3px 7px;
    border-radius: 4px;
    cursor: pointer;
}
.side-usage-period-btn.is-active {
    opacity: 1;
    font-weight: 600;
    background: var(--vcp-bg-surface, rgba(128,128,128,0.22));
}
.side-usage-refresh-btn {
    border: 1px solid var(--vcp-border-subtle, rgba(128,128,128,0.24));
    background: transparent;
    color: inherit;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
}
.side-usage-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.side-usage-card {
    border: 1px solid var(--vcp-border-subtle, rgba(128,128,128,0.2));
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    background: var(--vcp-bg-surface, rgba(128,128,128,0.06));
}
.side-usage-card--stale {
    opacity: 0.82;
}
.side-usage-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.side-usage-card-title {
    font-weight: 600;
    font-size: 12px;
}
.side-usage-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(128,128,128,0.16);
}
.side-usage-badge--ok {
    color: #10b981;
}
.side-usage-badge--stale {
    color: #f59e0b;
}
.side-usage-badge--error {
    color: #ef4444;
}
.side-usage-win-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.side-usage-win-meta,
.side-usage-bal-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    font-size: 11px;
}
.side-usage-bar-track {
    width: 100%;
    height: 5px;
    border-radius: 999px;
    background: rgba(128,128,128,0.2);
    overflow: hidden;
}
.side-usage-bar-fill {
    height: 100%;
    border-radius: inherit;
    background: #10b981;
}
.side-usage-bar-fill.is-warning {
    background: #f59e0b;
}
.side-usage-bar-fill.is-critical {
    background: #ef4444;
}
.side-usage-win-reset,
.side-usage-meta-line {
    font-size: 10px;
    opacity: 0.72;
}
.side-usage-gateway-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
}
.side-usage-metric-box {
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(128,128,128,0.1);
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.side-usage-metric-label {
    font-size: 10px;
    opacity: 0.72;
}
.side-usage-metric-val {
    font-size: 13px;
    font-weight: 600;
}
.side-usage-empty {
    padding: 16px 12px;
    text-align: center;
    opacity: 0.78;
}
`;

function ensureStyles(doc) {
    if (!doc?.head || doc.getElementById?.(STYLE_ELEMENT_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = CSS_TEXT;
    doc.head.appendChild(style);
}

export function createUsageMonitorSideProvider({
    document: doc = globalThis.document,
    api = (typeof window !== 'undefined' ? (window.chatAPI || window.electronAPI) : null),
    sidePaneController = null
} = {}) {
    const kind = 'usage-monitor';

    return {
        kind,

        async openUsageMonitorTab() {
            if (!sidePaneController) return null;
            const handle = await sidePaneController.openTab({
                id: TAB_ID,
                kind,
                title: '用量',
                icon: 'donut_small',
                closable: true,
                scopeMode: 'global'
            });
            sidePaneController.setVisible?.(true);
            handle?.focus?.();
            return handle;
        },

        async mountTab(tab, viewElement, { scope: viewScope = null, occurrence = null } = {}) {
            if (!viewElement) return null;
            ensureStyles(doc);
            viewElement.innerHTML = '';
            viewElement.classList.add('side-usage-view');

            const own = createSidePaneRootScope(viewScope, 'usage-monitor');
            const isDisposed = () => !own.active;

            const h = (tag, className = '', text = null) => {
                const el = doc.createElement(tag);
                if (className) el.className = className;
                if (text !== null && text !== undefined) el.textContent = String(text);
                return el;
            };

            let currentPeriod = 'today';
            let snapshot = null;
            let loading = true;
            let errorMessage = '';
            let requestSeq = 0;

            const root = h('div', 'zc-scope vcp-ui-scope side-usage-scope');
            const header = h('div', 'side-usage-header');
            const titleWrap = h('div', 'side-usage-title-wrap');
            const titleEl = h('div', 'side-usage-title', '用量与额度');
            const updatedEl = h('div', 'side-usage-updated', '正在加载…');
            titleWrap.append(titleEl, updatedEl);

            const controls = h('div', 'side-usage-controls');
            const periodGroup = h('div', 'side-usage-period-group');
            const periodButtons = new Map();

            for (const opt of PERIOD_OPTIONS) {
                const btn = h('button', 'side-usage-period-btn', opt.label);
                btn.type = 'button';
                if (opt.key === currentPeriod) btn.classList.add('is-active');
                own.listen(btn, 'click', () => {
                    if (currentPeriod === opt.key) return;
                    currentPeriod = opt.key;
                    for (const [k, b] of periodButtons.entries()) {
                        b.classList.toggle('is-active', k === currentPeriod);
                    }
                    void refreshSnapshot();
                });
                periodButtons.set(opt.key, btn);
                periodGroup.appendChild(btn);
            }

            const refreshBtn = h('button', 'side-usage-refresh-btn', '刷新');
            refreshBtn.type = 'button';
            own.listen(refreshBtn, 'click', () => {
                void refreshSnapshot();
            });

            controls.append(periodGroup, refreshBtn);
            header.append(titleWrap, controls);

            const body = h('div', 'side-usage-body');
            root.append(header, body);
            viewElement.appendChild(root);

            function renderBody() {
                if (isDisposed()) return;
                body.replaceChildren();

                if (loading && !snapshot) {
                    body.appendChild(h('div', 'side-usage-empty', '正在读取模型用量与额度快照…'));
                    return;
                }

                if (errorMessage && !snapshot) {
                    body.appendChild(h('div', 'side-usage-empty', errorMessage));
                    updatedEl.textContent = '读取受阻';
                    return;
                }

                if (!snapshot) {
                    body.appendChild(h('div', 'side-usage-empty', '暂无用量数据'));
                    return;
                }

                updatedEl.textContent = errorMessage
                    ? `刷新受阻 · 上次 ${formatShortTime(snapshot.generatedAt)}`
                    : `最近更新 ${formatShortTime(snapshot.generatedAt)}`;

                const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
                for (const acct of accounts) {
                    const card = h('section', `side-usage-card side-usage-card--${acct.status || 'unknown'}`);
                    const top = h('div', 'side-usage-card-top');
                    top.append(
                        h('span', 'side-usage-card-title', acct.label || acct.id),
                        h('span', `side-usage-badge side-usage-badge--${acct.status || 'unknown'}`, formatAccountStatusText(acct))
                    );
                    card.appendChild(top);

                    const windows = Array.isArray(acct.windows) ? acct.windows : [];
                    for (const win of windows) {
                        const winRow = h('div', 'side-usage-win-row');
                        const meta = h('div', 'side-usage-win-meta');
                        meta.append(
                            h('span', '', `${win.label || win.id}剩余`),
                            h('strong', '', formatPercent(win.remainingPercent))
                        );
                        const track = h('div', 'side-usage-bar-track');
                        const fill = h('div', 'side-usage-bar-fill');
                        const pct = typeof win.remainingPercent === 'number' && Number.isFinite(win.remainingPercent)
                            ? Math.max(0, Math.min(100, win.remainingPercent))
                            : 0;
                        if (pct <= 15) fill.classList.add('is-critical');
                        else if (pct <= 35) fill.classList.add('is-warning');
                        fill.style.width = `${pct}%`;
                        track.appendChild(fill);
                        winRow.append(meta, track);

                        const resetText = formatResetLabel(win.resetsAt);
                        if (resetText) {
                            winRow.appendChild(h('div', 'side-usage-win-reset', resetText));
                        }
                        card.appendChild(winRow);
                    }

                    const balances = Array.isArray(acct.balances) ? acct.balances : [];
                    for (const bal of balances) {
                        const balRow = h('div', 'side-usage-bal-row');
                        balRow.append(
                            h('span', '', `${bal.currency || 'CNY'} 可用余额`),
                            h('strong', '', formatCurrency(bal.currency, bal.available))
                        );
                        card.appendChild(balRow);
                    }

                    if (acct.linkedChannels && acct.linkedChannels.length > 0) {
                        const poolNote = acct.sharedPool
                            ? `关联渠道：${acct.linkedChannels.join('、')}（共用此额度池）`
                            : `关联渠道：${acct.linkedChannels.join('、')}`;
                        card.appendChild(h('div', 'side-usage-meta-line', poolNote));
                    }

                    if (acct.observedAt) {
                        card.appendChild(h('div', 'side-usage-meta-line', `来源 ${acct.source || '—'} · 观测于 ${formatShortTime(acct.observedAt)}`));
                    }

                    const diagnosticNotice = formatQuotaDiagnostic(acct);
                    if (diagnosticNotice || acct.notice) {
                        card.appendChild(h('div', 'side-usage-meta-line', diagnosticNotice || acct.notice));
                    }
                    if (diagnosticNotice && acct.status === 'stale') {
                        card.appendChild(h('div', 'side-usage-meta-line', '保留上次观测结果，不代表当前额度。'));
                    }

                    body.appendChild(card);
                }

                if (snapshot.activity) {
                    const act = snapshot.activity;
                    const gwCard = h('section', 'side-usage-card');
                    const gwTop = h('div', 'side-usage-card-top');
                    gwTop.append(
                        h('span', 'side-usage-card-title', '网关调用统计 (NewAPI)'),
                        h('span', 'side-usage-badge', act.truncated ? '部分截断' : 'newapi-only')
                    );
                    gwCard.appendChild(gwTop);

                    const grid = h('div', 'side-usage-gateway-grid');
                    const metrics = [
                        ['调用次数', formatNullableCompact(act.totals?.requests)],
                        ['输入 Token', formatNullableCompact(act.totals?.inputTokens)],
                        ['输出 Token', formatNullableCompact(act.totals?.outputTokens)],
                        ['缓存读取', formatNullableCompact(act.totals?.cacheReadTokens)]
                    ];
                    for (const [mLabel, mVal] of metrics) {
                        const box = h('div', 'side-usage-metric-box');
                        box.append(
                            h('span', 'side-usage-metric-label', mLabel),
                            h('span', 'side-usage-metric-val', mVal)
                        );
                        grid.appendChild(box);
                    }
                    gwCard.appendChild(grid);

                    if (act.notice) {
                        gwCard.appendChild(h('div', 'side-usage-meta-line', act.notice));
                    }
                    body.appendChild(gwCard);
                }
            }

            async function refreshSnapshot() {
                if (isDisposed()) return;
                const seq = ++requestSeq;
                loading = true;
                if (!snapshot) renderBody();

                try {
                    if (typeof api?.loadUsageMonitorSnapshot !== 'function') {
                        if (seq !== requestSeq || isDisposed()) return;
                        loading = false;
                        errorMessage = '当前客户端尚未挂载用量监控 IPC 接口。';
                        renderBody();
                        return;
                    }

                    const result = await api.loadUsageMonitorSnapshot(currentPeriod);
                    if (seq !== requestSeq || isDisposed()) return;

                    loading = false;
                    if (result && result.success && result.data) {
                        snapshot = result.data;
                        errorMessage = '';
                    } else {
                        errorMessage = result?.error || '获取用量监控快照失败。';
                    }
                    renderBody();
                } catch (err) {
                    if (seq !== requestSeq || isDisposed()) return;
                    loading = false;
                    errorMessage = err?.message || '读取用量监控快照异常。';
                    renderBody();
                }
            }

            if (occurrence?.visible) {
                pollWhileVisible(own, occurrence.visible, () => refreshSnapshot(), POLL_INTERVAL_MS, {
                    leading: true,
                    label: 'usage-monitor-poll'
                });
            } else {
                void refreshSnapshot();
            }

            renderBody();

            return {
                dispose() {
                    return own.dispose('usage-monitor-unmounted');
                }
            };
        }
    };
}