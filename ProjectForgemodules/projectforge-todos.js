/* Read-only projection. Browser global + dependency-free CommonJS for tests. */
(function (root, factory) {
    'use strict';
    const value = factory();
    if (typeof module === 'object' && module.exports) module.exports = value;
    else root.ProjectForgeTodos = value;
})(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';
    const STAGES = Object.freeze({ pending: '待受理', working: '施工中', review: '待核验', verified: '核验通过', unknown: '未知' });
    const STATUSES = Object.freeze({ pending: '待办', doing: '进行中', blocked: '阻塞', done: '完成', unknown: '未知' });
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string' ? value : '';
    const field = value => typeof value === 'string' && value.trim().length <= 512 ? value.trim() : '';
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const aliases = new Map([
        ['执行分身', 'role'], ['执行角色', 'role'], ['subagent', 'role'], ['executor', 'role'], ['role', 'role'],
        ['派工方', 'assignedBy'], ['派工人', 'assignedBy'], ['assignedby', 'assignedBy'], ['delegatedby', 'assignedBy'],
        ['委托阶段', 'stage'], ['阶段', 'stage'], ['stage', 'stage'], ['phase', 'stage'],
        ['session_id', 'sessionId'], ['sessionid', 'sessionId'], ['会话', 'sessionId'],
        ['delegationid', 'delegationId'], ['delegation_id', 'delegationId'], ['委托id', 'delegationId'],
        ['约定写入', 'writePaths'], ['writepaths', 'writePaths'], ['约定产物', 'artifacts'], ['artifacts', 'artifacts'],
        ['核验结果', 'verification'], ['verification', 'verification'],
    ]);
    function legacy(note) {
        // Parse explicit key/value segments only, never arbitrary prose or JSON.
        const result = Object.create(null), duplicates = new Set();
        for (const part of note.split(/[;；\r\n]+/)) {
            const match = /^\s*([^:=：]{1,32})\s*[:=：]\s*([\s\S]*?)\s*$/.exec(part);
            if (!match) continue;
            const key = aliases.get(match[1].trim().toLowerCase());
            if (!key) continue;
            if (own(result, key) && result[key] !== match[2]) duplicates.add(key);
            else result[key] = match[2];
        }
        for (const key of duplicates) delete result[key];
        return { result, ambiguous: duplicates.size > 0 };
    }
    function list(value) {
        if (typeof value === 'string') return value ? [value] : [];
        return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).slice(0, 32) : [];
    }
    function legacyStage(value) {
        const v = field(value).toLowerCase();
        // Negative evidence wins; "已核验但不通过" must never turn green.
        if (/核验.*(不通过|未通过|失败|退回)|验收.*(不通过|未通过|失败|退回)/.test(v)) return { stage: 'review', rejected: true };
        if (/待核验|等待核验|待验收|未核验|尚未核验/.test(v)) return { stage: 'review', rejected: false };
        const known = {
            '待受理': 'pending', 'pending': 'pending', 'queued': 'pending',
            '施工中': 'working', '进行中': 'working', 'working': 'working', 'running': 'working',
            '待核验': 'review', 'review': 'review', '核验通过': 'verified', '已核验通过': 'verified',
            'verified': 'verified', 'unknown': 'unknown', '未知': 'unknown',
        };
        return { stage: own(known, v) ? known[v] : 'unknown', rejected: false };
    }
    function normalize(todo, context = {}) {
        todo = record(todo) ? todo : {};
        const rawNote = text(todo.note);
        const truncated = Array.isArray(todo.truncated) ? todo.truncated : [];
        const noteIncomplete = truncated.includes('note') || rawNote.length > 65536;
        const parseable = noteIncomplete ? rawNote.slice(0, 65536).replace(/[^;；\r\n]*$/, '') : rawNote;
        const parsed = legacy(parseable);
        const s = record(todo.subagent) ? todo.subagent : null;
        const meaningful = s && ['role', 'assignedBy', 'sessionId', 'session_id', 'delegationId', 'stage', 'writePaths', 'artifacts', 'verification']
            .some(key => own(s, key) && (typeof s[key] === 'string' || Array.isArray(s[key])));
        const data = meaningful ? s : parsed.result;
        const source = meaningful ? 'structured' : 'note';
        // A stage or an updater alone is not evidence of a delegated task.
        const identified = field(data.role) || field(data.sessionId) || field(data.session_id) || field(data.delegationId);
        const delegated = Boolean(identified);
        let phase = source === 'structured'
            ? { stage: typeof data.stage === 'string' && own(STAGES, data.stage) ? data.stage : 'unknown', rejected: false }
            : legacyStage(data.stage);
        const verification = field(data.verification).toLowerCase();
        const failed = /^(failed|rejected|不通过|未通过|退回)$/.test(verification)
            || /核验.*(不通过|未通过|失败|退回)|验收.*(不通过|未通过|失败|退回)/.test(verification);
        const passed = /^(passed|verified|通过|核验通过|验收通过)$/.test(verification);
        if (failed) phase = { stage: 'review', rejected: true };
        else if (phase.stage === 'verified' && own(data, 'verification') && !passed) phase = { stage: 'unknown', rejected: false };
        if (source === 'note' && (parsed.ambiguous || noteIncomplete)) phase = { stage: 'unknown', rejected: false };
        const role = field(data.role);
        const sessionId = field(data.sessionId) || field(data.session_id);
        const delegationId = field(data.delegationId);
        const status = typeof todo.status === 'string' && own(STATUSES, todo.status) ? todo.status : 'unknown';
        return {
            key: JSON.stringify([text(context.sourceId) || 'local', text(context.projectId), todo.id ?? todo.seq ?? context.index ?? '', delegationId, sessionId]),
            seq: todo.seq, title: text(todo.title), status, rawNote,
            updatedBy: text(todo.updated_by), updatedAt: todo.updated_at,
            truncated: truncated.filter(v => typeof v === 'string'),
            delegation: delegated ? {
                role, assignedBy: field(data.assignedBy), sessionId, delegationId,
                stage: phase.stage, rejected: phase.rejected, source,
                writePaths: list(data.writePaths), artifacts: list(data.artifacts),
                warning: source === 'note' && parsed.ambiguous ? '备注字段相互矛盾，阶段保守展示。' : '',
            } : null,
            noteIncomplete,
        };
    }
    function projectTodos(detail) {
        const project = detail?.project || {};
        const c = project.catalog;
        return (Array.isArray(detail?.todos) ? detail.todos : []).map((todo, index) => normalize(todo, {
            sourceId: c?.remote ? text(c.sourceId) : 'local',
            projectId: String(c?.localProjectId || project.id || ''), index,
        }));
    }
    function createViewState() { return { scope: '', role: '', expanded: new Set() }; }
    function scopeOf(detail) {
        const p = detail?.project || {};
        return JSON.stringify([p.catalog?.remote ? p.catalog.sourceId : 'local', p.id, p.catalog?.localProjectId]);
    }
    function prepare(detail, view) {
        const scope = scopeOf(detail);
        if (view.scope !== scope) { view.scope = scope; view.role = ''; view.expanded.clear(); }
        const rows = projectTodos(detail);
        const roles = [...new Set(rows.map(t => t.delegation?.role).filter(Boolean))];
        if (!roles.includes(view.role)) view.role = '';
        const keys = new Set(rows.map(t => t.key));
        for (const key of view.expanded) if (!keys.has(key)) view.expanded.delete(key);
        return { rows, roles };
    }
    function steps(d) {
        const index = ['pending', 'working', 'review', 'verified'].indexOf(d.stage);
        return `<ol class="pf-delegation-steps" aria-label="委托阶段：${escape(STAGES[d.stage])}${d.rejected ? '，核验退回' : ''}">${
            ['pending', 'working', 'review', 'verified'].map((stage, i) =>
                `<li class="${index === i ? 'current' : index > i ? 'past' : ''}${d.rejected && i === 2 ? ' rejected' : ''}"${index === i ? ' aria-current="step"' : ''}>${STAGES[stage]}</li>`).join('')
        }</ol>`;
    }
    function phaseHtml(t) {
        const d = t.delegation;
        return `<span class="pf-delegation-phase phase-${d.stage}${d.rejected ? ' rejected' : ''}">${STAGES[d.stage]}${d.rejected ? ' · 核验退回' : ''}</span>${t.status === 'blocked' ? '<span class="pf-delegation-blocked">Todo 阻塞</span>' : ''}`;
    }
    function delegationHtml(t) {
        const d = t.delegation;
        const lines = [
            ['执行分身', d.role || '未指定执行人'], ['派工方', d.assignedBy || '未提供'],
            ...(d.delegationId ? [['委托 ID', d.delegationId]] : []),
            ...(d.sessionId ? [['会话', d.sessionId]] : []),
            ...d.writePaths.map(v => ['约定写入', v]), ...d.artifacts.map(v => ['约定产物', v]),
        ];
        return `<div class="pf-delegation-detail">${phaseHtml(t)}${steps(d)}
            <dl>${lines.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
            <p class="muted pf-delegation-origin">${d.source === 'note' ? '阶段来源：备注推导' : '阶段来源：结构化委托字段'} · 非实时监控；委托约定不证明磁盘产物存在或权限已隔离。</p>
            ${d.warning ? `<p class="warn-line">${escape(d.warning)}</p>` : ''}</div>`;
    }
    function render(detail, view, formatTime = value => String(value || '-')) {
        const { rows, roles } = prepare(detail, view);
        const delegations = rows.filter(t => t.delegation);
        const visible = rows.filter(t => !view.role || t.delegation?.role === view.role);
        const monitor = delegations.length ? `<section class="pf-delegation-monitor" aria-label="委托监视席">
            <div class="section-title">委托监视席 <span class="muted">${delegations.length} 笔 · 只读快照</span></div>
            <p class="muted">Todo 状态与委托阶段独立；完成 Todo 不等于核验通过。</p>
            <div class="pf-delegation-cards">${delegations.filter(t => !view.role || t.delegation.role === view.role).map(t => `
                <article class="pf-delegation-card${t.status === 'blocked' ? ' is-blocked' : ''}">
                    <div class="pf-delegation-card-head"><strong>${escape(t.delegation.role || '未指定执行人')}</strong>${phaseHtml(t)}</div>
                    <p>#${escape(t.seq)} ${escape(t.title)}</p>${steps(t.delegation)}
                    <div class="muted">Todo：${STATUSES[t.status]} · ${t.delegation.source === 'note' ? '备注推导' : '结构化字段'}</div>
                    ${t.delegation.delegationId || t.delegation.sessionId ? `<code>${escape(t.delegation.delegationId || t.delegation.sessionId)}</code>` : ''}
                </article>`).join('')}</div></section>` : '';
        const filters = delegations.length && roles.length ? `<div class="pf-delegation-filters" role="group" aria-label="按执行角色筛选">
            ${['', ...roles].map(role => `<button type="button" data-pf-role="${escape(role)}" aria-pressed="${view.role === role}">${escape(role || '全部任务')}</button>`).join('')}</div>` : '';
        const total = detail?.project?.progress?.total;
        const partial = Number.isSafeInteger(total) && total > rows.length;
        return `${monitor}<div class="section-title">Todo</div>${filters}
            ${partial ? '<p class="warn-line">仅展示部分任务，已有完整条目的阶段仍有效。</p>' : ''}
            ${visible.length ? `<ul class="todo-list pf-todo-list">${visible.map(t => `<li data-pf-todo="${escape(t.key)}">
                <span class="todo-state ${t.status}">${STATUSES[t.status]}</span>
                <div class="pf-todo-body"><div class="pf-todo-title">#${escape(t.seq)} ${escape(t.title)}</div>
                    ${t.delegation ? delegationHtml(t) : ''}
                    ${t.rawNote ? `<details class="pf-todo-note" data-pf-note="${escape(t.key)}"${view.expanded.has(t.key) ? ' open' : ''}><summary>原始备注</summary><pre>${escape(t.rawNote)}</pre></details>` : ''}
                    ${t.truncated.length || t.noteIncomplete ? '<p class="muted">部分字段为截断预览，完整内容请在来源端查看；截断备注不推导委托阶段。</p>' : ''}
                </div><span class="muted todo-meta">更新者 ${escape(t.updatedBy ? '@' + t.updatedBy : '未署名')} · ${escape(formatTime(t.updatedAt))}</span>
            </li>`).join('')}</ul>` : '<p class="muted">暂无 Todo</p>'}`;
    }
    // Called before DOM replacement. Capture only our controls, never serialize nodes.
    function capture(pane, view) {
        for (const el of pane.querySelectorAll('details[data-pf-note]')) {
            if (el.open) view.expanded.add(el.dataset.pfNote);
            else view.expanded.delete(el.dataset.pfNote);
        }
        const active = pane.ownerDocument.activeElement;
        const control = active?.closest?.('[data-pf-role],summary');
        const focus = control && pane.contains(control)
            ? control.hasAttribute('data-pf-role') ? { role: control.dataset.pfRole }
                : { note: control.closest('[data-pf-note]')?.dataset.pfNote } : null;
        const scroller = pane.closest('.tab-body') || pane;
        return { scope: view.scope, focus, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft };
    }
    function restore(pane, view, saved) {
        const scroller = pane.closest('.tab-body') || pane;
        if (!saved || saved.scope !== view.scope) { scroller.scrollTop = 0; scroller.scrollLeft = 0; return; }
        if (saved.focus) {
            const target = saved.focus.role !== undefined
                ? [...pane.querySelectorAll('[data-pf-role]')].find(el => el.dataset.pfRole === saved.focus.role)
                    || pane.querySelector('[data-pf-role=""]')
                : [...pane.querySelectorAll('[data-pf-note]')].find(el => el.dataset.pfNote === saved.focus.note)?.querySelector('summary');
            target?.focus({ preventScroll: true });
        }
        scroller.scrollTop = saved.scrollTop;
        scroller.scrollLeft = saved.scrollLeft;
    }
    function handleClick(event, pane, view, rerender) {
        const button = event.target.closest?.('button[data-pf-role]');
        if (!button || !pane.contains(button)) return false;
        view.role = button.dataset.pfRole;
        rerender();
        return true;
    }
    return Object.freeze({ normalize, projectTodos, createViewState, scopeOf, prepare, render, capture, restore, handleClick, STAGES });
});