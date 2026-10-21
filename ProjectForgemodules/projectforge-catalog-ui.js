/* Optional presentation adapter. No IPC, network, filesystem or persistent state.
 * Host hooks: mount -> filterProjects -> enhanceList. Remove hooks to restore
 * upstream rendering. Source aliases describe catalog origin, never lease owner.
 */
(function (root, factory) {
    const ui = factory();
    if (typeof module === 'object' && module.exports) module.exports = ui;
    else root.ProjectForgeCatalogUI = ui;
})(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    const aliases = Object.freeze({
        'home-forge-plans': '家中',
        'company-forge-plans': '公司',
        'server-forge-plans': '服务器',
    });
    const escape = value => String(value ?? '').replace(/[&<>"']/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const remote = p => p.catalog?.remote === true;
    function origin(p) {
        if (!remote(p)) return { key: 'local', label: '本机' };
        if (p.catalog.kind === 'global') return { key: 'global', label: '接续工程' };
        const id = String(p.catalog.sourceId || '');
        return { key: 'source:' + id, label: aliases[id] || id || '未知来源' };
    }
    function dateText(value, compact = false) {
        if (value === null || value === undefined || value === '') return '未知';
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return '未知';
        const pad = n => String(n).padStart(2, '0');
        const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        if (compact) return d.getFullYear() === new Date().getFullYear()
            ? day : `${d.getFullYear()}-${day}`;
        return `${d.getFullYear()}-${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function matches(p, term) {
        const q = String(term || '').trim().toLowerCase();
        return !q || [p.name, p.id, p.workspace_alias, p.catalog?.sourceId,
            p.catalog?.localProjectId, origin(p).label, ...(p.maids || [])]
            .some(v => String(v || '').toLowerCase().includes(q));
    }
    function progress(p) {
        const total = p.progress?.total, done = p.progress?.done;
        if (!Number.isSafeInteger(total) || total < 0 ||
            !Number.isSafeInteger(done) || done < 0 || done > total) {
            return { text: remote(p) ? '待读取' : '无', percent: 0, known: false };
        }
        return { text: `${done}/${total}`, percent: total ? 100 * done / total : 0,
            known: true, total, done };
    }
    // deleteHtml comes only from the host's already-rendered local action nodes.
    function card(p, { statusHtml = '', deleteHtml = '' } = {}) {
        const o = origin(p), r = remote(p), stale = r && p.catalog.stale;
        const id = p.catalog?.localProjectId || p.id;
        const pr = progress(p);
        const updated = p.updated_at; // Never substitute cache acquisition time.
        const status = r ? (stale ? '只读 · 离线缓存' : '远端只读') : '本地';
        const detail = r
            ? `${stale ? '当前离线，显示会话缓存，可能已过期。' : ''}远端计划，只读。\n` +
              `来源：${p.catalog.sourceId || '未知'}\n获取时间：${dateText(p.catalog.observedAt)}\n` +
              '代码历史未同步；查看不下载源码、不取得施工写权。' +
              (p.catalog.kind === 'global' ? '\n接续工程的来源不代表当前持权设备。' : '')
            : `本机工程\n工作区：${p.workspace_alias || '未知'}\n${p.stats?.nodeCount || 0} 次变动`;
        const tipId = 'pf-origin-' + encodeURIComponent(String(p.id));
        const barLabel = pr.known ? `Todo 已完成 ${pr.done}，共 ${pr.total}` : 'Todo 数量待读取';
        return `<div class="pf-catalog-title">
            <span class="name" title="${escape(p.name)}">${escape(p.name)}</span>
            <span class="pf-catalog-actions">${statusHtml}${r ? '' : deleteHtml}</span>
        </div>
        <div class="pf-catalog-meta">
            <span class="pf-catalog-origin" title="${escape(o.label)}">${escape(o.label)}</span>
            <code class="pf-catalog-id" title="${escape(id)}">${escape(id)}</code>
            <span class="pf-catalog-access${stale ? ' is-stale' : ''}" tabindex="0"
                aria-describedby="${escape(tipId)}">${escape(status)}
                <span class="pf-catalog-tip" role="tooltip" id="${escape(tipId)}">${escape(detail)}</span>
            </span>
        </div>
        <div class="pf-catalog-footer">
            <span>Todo ${escape(pr.text)}</span>
            <span class="pf-catalog-progress" role="img" aria-label="${escape(barLabel)}">
                <span style="width:${pr.percent}%"></span>
            </span>
            <span class="pf-catalog-time" tabindex="0" title="计划更新时间：${escape(dateText(updated))}"
                aria-label="计划更新时间：${escape(dateText(updated))}">更新 ${escape(dateText(updated, true))}</span>
        </div>`;
    }

    let selected = 'all', select = null, hint = null;
    function mount({ document, onChange }) {
        if (select?.isConnected) return;
        const parent = document.querySelector('#side-page-projects .sidebar-head');
        if (!parent) return;
        const label = document.createElement('label');
        label.className = 'pf-catalog-filter';
        label.textContent = '来源';
        select = document.createElement('select');
        select.id = 'pf-catalog-source-filter';
        select.setAttribute('aria-label', '按计划来源筛选');
        label.append(select);
        parent.append(label);
        hint = document.createElement('span');
        hint.className = 'pf-catalog-filter-count';
        hint.setAttribute('aria-live', 'polite');
        label.append(hint);
        select.addEventListener('change', () => {
            selected = select.value;
            onChange();
        });
    }
    function filterProjects(projects, term) {
        if (select) {
            const options = new Map([['all', '全部来源'], ['local', '本机']]);
            for (const p of projects) {
                const o = origin(p);
                options.set(o.key, o.label);
            }
            if (!options.has(selected)) selected = 'all';
            select.innerHTML = [...options].map(([key, label]) =>
                `<option value="${escape(key)}">${escape(label)}</option>`).join('');
            select.value = selected;
        }
        const result = projects.filter(p => (selected === 'all' || origin(p).key === selected) && matches(p, term));
        if (hint) hint.textContent = `${result.length}/${projects.length}`;
        return result;
    }
    function enhanceList(ul, projects, statusBadge) {
        const rows = new Map(projects.map(p => [String(p.id), p]));
        for (const li of ul.querySelectorAll('.project-item')) {
            const p = rows.get(li.dataset.id);
            if (!p) continue;
            const actions = li.querySelector('.project-delete-wrap');
            li.classList.add('pf-catalog-card');
            li.dataset.origin = origin(p).key;
            li.innerHTML = card(p, {
                statusHtml: statusBadge(p),
                deleteHtml: actions?.outerHTML || '',
            });
        }
        if (!projects.length) {
            ul.innerHTML = '<li class="muted pf-catalog-empty">没有符合当前来源和搜索条件的计划。</li>';
        }
    }
    return Object.freeze({ origin, matches, progress, card, mount, filterProjects, enhanceList });
});