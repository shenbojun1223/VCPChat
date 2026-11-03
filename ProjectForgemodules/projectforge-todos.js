/* Read-only projection. Browser global + dependency-free CommonJS for tests. */
(function (root, factory) {
    'use strict';
    const commonJS = typeof module === 'object' && module.exports;
    const codec = commonJS
        ? require('../VCPDistributedServer/Plugin/ProjectForge/delegationReviewRecord')
        : root.ForgeDelegationReviewRecord;
    const value = factory(codec);
    if (commonJS) module.exports = value;
    else root.ProjectForgeTodos = value;
})(typeof globalThis === 'object' ? globalThis : this, function (Review) {
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
        ['派工方/验收', 'assignedBy'], ['派工/验收', 'assignedBy'],
        ['委托阶段', 'stage'], ['阶段', 'stage'], ['状态', 'stage'], ['stage', 'stage'], ['phase', 'stage'],
        ['session_id', 'sessionId'], ['sessionid', 'sessionId'], ['会话', 'sessionId'],
        ['delegationid', 'delegationId'], ['delegation_id', 'delegationId'], ['委托id', 'delegationId'],
        ['约定写入', 'writePaths'], ['writepaths', 'writePaths'], ['约定产物', 'artifacts'], ['artifacts', 'artifacts'],
        ['核验结果', 'verification'], ['verification', 'verification'],
    ]);
    function legacy(note) {
        const result = Object.create(null), duplicates = new Set(), evidence = [];
        let reservation = false;
        const identities = new Set(['role', 'assignedBy', 'sessionId', 'delegationId']);
        const opaque = new Set(['writePaths', 'artifacts']);
        const pair = part => {
            const match = /^\s*([^:=：。]{1,32})\s*[:=：]\s*([\s\S]*?)\s*$/.exec(part);
            const key = match && aliases.get(match[1].trim().toLowerCase());
            return key ? { key, value: match[2] } : null;
        };
        const add = item => {
            if (!item) return;
            const { key, value } = item;
            if (key === 'stage' || key === 'verification') evidence.push(item);
            if (own(result, key) && result[key] !== value) duplicates.add(key);
            else result[key] = value;
        };
        for (const part of note.split(/[;；\r\n]+/)) {
            const sentences = part.split('。');
            let current = null;
            for (let i = 0; i < sentences.length; i++) {
                const item = pair(sentences[i]);
                if (item) {
                    add(current);
                    current = item;
                    // Paths and artifacts may contain prose or example keys: never scan inside.
                    if (opaque.has(item.key)) {
                        current.value += i + 1 < sentences.length ? '。' + sentences.slice(i + 1).join('。') : '';
                        break;
                    }
                } else if (current && !identities.has(current.key)) {
                    // Retain "核验通过。仍需确认/核验未通过", not just its first sentence.
                    current.value += '。' + sentences[i];
                } else if (current) {
                    // Identity narration is not a positive status API, but cannot hide a denial.
                    const value = sentences[i].trim();
                    if (legacyStage(value).rejected) evidence.push({ key: 'stage', value });
                    if (value) reservation = true;
                }
            }
            add(current);
        }
        for (const key of duplicates) delete result[key];
        return { result, evidence, reservation, ambiguous: duplicates.size > 0 };
    }
    function list(value) {
        if (typeof value === 'string') return value ? [value] : [];
        return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).slice(0, 32) : [];
    }
    function normalizeRoles(data) {
        const explicit = Array.isArray(data.roles) ? data.roles.slice(0, 32).map(field).filter(Boolean) : [];
        const values = explicit.length ? explicit : [data.role];
        return [...new Set(values.flatMap(value => field(value).split(/[、,，]/))
            .map(field).filter(Boolean))].slice(0, 32);
    }
    function matchesRole(row, role) {
        return !role || Boolean(row.delegation?.roles.includes(role));
    }
    function legacyStage(value) {
        const raw = field(value).replace(/。+$/, '').trim(), v = raw.toLowerCase();
        // Denials remain visible even when a conflicting field also reports approval.
        if (/(?:核验|验收)[^。;；\r\n]{0,512}(?:不通过|未通过|失败|退回)|未验收通过/.test(v)) return { stage: 'review', rejected: true };
        if (/待核验|等待核验|待验收|未核验|尚未核验/.test(v)) return { stage: 'review', rejected: false };
        const known = {
            '待受理': 'pending', 'pending': 'pending', 'queued': 'pending',
            '施工中': 'working', '进行中': 'working', 'working': 'working', 'running': 'working',
            '待核验': 'review', 'review': 'review', '核验通过': 'verified', '已核验通过': 'verified',
            'verified': 'verified', 'unknown': 'unknown', '未知': 'unknown',
        };
        if (own(known, v)) return { stage: known[v], rejected: false };
        // Only these affirmative heads are accepted; arbitrary prose is not a status API.
        const sentences = raw.split('。');
        const head = sentences[0].trim();
        const tails = sentences.slice(1).filter(part => part.trim());
        const evidenceOnly = tails.every(part => /^(?:证据\s*[:：]|原始日志(?:\s*[:：]|依次))/.test(part.trim()));
        const qualified = /历史状态|曾经|引用|[“”「」『』"]|如果|若|假设|仍需|尚需|待确认|再接受|通过后/.test(v);
        if (!qualified && evidenceOnly && head === '审查交付已独立核验并接受') {
            return { stage: 'verified', rejected: false, label: '审查交付已接受', scope: '仅审查交付；不代表未测事项或整个工程通过' };
        }
        const scoped = /^限定范围验收通过\s*[:：]\s*(.+)$/.exec(head);
        if (!qualified && evidenceOnly && scoped) {
            return { stage: 'verified', rejected: false, label: '限定范围验收通过', scope: scoped[1] };
        }
        return { stage: 'unknown', rejected: false };
    }
    const RUNTIME = Object.freeze({
        queued: ['pending', '待受理'], running: ['working', '施工中'],
        waiting: ['working', '等待续跑'], cancelling: ['working', '取消中'],
        completed: ['review', '待核验'], failed: ['unknown', '执行失败'],
        cancelled: ['unknown', '已取消'], stopped: ['unknown', '已停止'],
    });
    function runtimeNote(raw, todo, context) {
        const start = '[[ForgeDelegation::v1]]\n', end = '\n[[/ForgeDelegation]]\n';
        if (!raw.startsWith(start)) return null;
        const at = raw.indexOf(end, start.length);
        if (at < 0 || at > 2048) return null;
        try {
            const d = JSON.parse(raw.slice(start.length, at));
            if (!record(d)) return null;
            const keys = ['version', 'projectId', 'todoId', 'todoSeq', 'delegationId', 'role',
                'assignedBy', 'sessionId', 'runtimeStatus', 'stage', 'sequence', 'updatedAt'];
            const clean = (v, max, empty = false) => typeof v === 'string'
                && (empty || v.length > 0) && v.length <= max && !/[\r\n\0]/.test(v);
            if (Object.keys(d).length !== keys.length || !keys.every(k => own(d, k))
                || d.version !== 1 || !/^p[A-Za-z0-9_-]{1,127}$/.test(d.projectId)
                || d.projectId !== context.projectId
                || !Number.isSafeInteger(d.todoId) || d.todoId < 1
                || !Number.isSafeInteger(d.todoSeq) || d.todoSeq !== todo.seq
                || (todo.id !== undefined && todo.id !== d.todoId)
                || !/^aa-delegation-\d{10,16}-[a-f0-9]{8}$/.test(d.delegationId)
                || !clean(d.role, 100) || !clean(d.assignedBy, 100) || !clean(d.sessionId, 256, true)
                || typeof d.runtimeStatus !== 'string' || !own(RUNTIME, d.runtimeStatus)
                || d.stage !== RUNTIME[d.runtimeStatus][0]
                || !Number.isSafeInteger(d.sequence) || d.sequence < 0
                || typeof d.updatedAt !== 'string' || new Date(d.updatedAt).toISOString() !== d.updatedAt) return null;
            return d;
        } catch { return null; }
    }
    function normalize(todo, context = {}) {
        todo = record(todo) ? todo : {};
        const rawNote = text(todo.note);
        const truncated = Array.isArray(todo.truncated) ? todo.truncated : [];
        const noteIncomplete = truncated.includes('note') || rawNote.length > 65536;
        const parseable = noteIncomplete ? rawNote.slice(0, 65536).replace(/[^;；。\r\n]*$/, '') : rawNote;
        const managed = rawNote.startsWith('[[ForgeDelegation::');
        const runtime = runtimeNote(rawNote, todo, context);
        const reviewRuntime = runtime && Review?.readRuntime(rawNote, {
            projectId: context.projectId, todoId: todo.id, todoSeq: todo.seq,
        });
        const review = reviewRuntime ? Review.readReview(rawNote, reviewRuntime) : null;
        // A broken managed header cannot fall through to a historical approval in the tail.
        const parsed = legacy(managed ? '' : parseable);
        const s = runtime || (record(todo.subagent) ? todo.subagent : null);
        const meaningful = s && ['role', 'roles', 'assignedBy', 'sessionId', 'session_id', 'delegationId', 'stage', 'writePaths', 'artifacts', 'verification']
            .some(key => own(s, key) && (typeof s[key] === 'string' || Array.isArray(s[key])));
        const data = meaningful ? s : parsed.result;
        const source = runtime ? 'runtime' : meaningful ? 'structured' : 'note';
        // A stage or an updater alone is not evidence of a delegated task.
        const roles = normalizeRoles(data);
        const identified = roles.length || field(data.sessionId) || field(data.session_id) || field(data.delegationId);
        const delegated = Boolean(identified);
        let phase = source !== 'note'
            ? { stage: typeof data.stage === 'string' && own(STAGES, data.stage) ? data.stage : 'unknown', rejected: false }
            : legacyStage(data.stage);
        const verification = field(data.verification).toLowerCase();
        const failure = value => /^(failed|rejected|不通过|未通过|失败|退回)(?:$|。)/.test(value.trim().toLowerCase())
            || /(?:核验|验收)[^。;；\r\n]{0,512}(?:不通过|未通过|失败|退回)|未验收通过/.test(value);
        const failed = failure(verification) || (source === 'note' && parsed.evidence.some(item =>
            item.key === 'stage' ? legacyStage(item.value).rejected : failure(item.value)));
        const passed = /^(passed|verified|通过|核验通过|验收通过)$/.test(verification);
        if (failed) phase = { stage: 'review', rejected: true };
        else if (phase.stage === 'verified' && own(data, 'verification') && !passed) phase = { stage: 'unknown', rejected: false };
        if (source === 'note' && parsed.ambiguous && !phase.rejected) phase = { stage: 'unknown', rejected: false };
        if (source === 'note' && parsed.reservation && phase.stage === 'verified') phase = { stage: 'unknown', rejected: false };
        if (source === 'note' && noteIncomplete) phase = { stage: 'unknown', rejected: false };
        const role = field(data.role) || roles.join('、');
        const sessionId = field(data.sessionId) || field(data.session_id);
        const delegationId = field(data.delegationId);
        const status = typeof todo.status === 'string' && own(STATUSES, todo.status) ? todo.status : 'unknown';
        return {
            key: JSON.stringify([text(context.sourceId) || 'local', text(context.projectId), todo.id ?? todo.seq ?? context.index ?? '', delegationId, sessionId]),
            seq: todo.seq, title: text(todo.title), status, rawNote,
            updatedBy: text(todo.updated_by), updatedAt: todo.updated_at,
            truncated: truncated.filter(v => typeof v === 'string'),
            delegation: delegated ? {
                role, roles, assignedBy: field(data.assignedBy), sessionId, delegationId,
                stage: phase.stage, rejected: phase.rejected, source,
                stageLabel: runtime ? RUNTIME[runtime.runtimeStatus][1] : phase.label || STAGES[phase.stage],
                scope: phase.scope || '', runtimeStatus: runtime?.runtimeStatus || '',
                runtimeUpdatedAt: runtime?.updatedAt || '',
                review,
                stageEvidence: runtime ? `AA ${runtime.runtimeStatus} · ${runtime.updatedAt}`
                    : source === 'note' ? field(data.stage) : '',
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
    function createViewState() { return { scope: '', role: '', expanded: new Set(), rows: new Map(), located: '' }; }
    function scopeOf(detail) {
        const p = detail?.project || {};
        return JSON.stringify([p.catalog?.remote ? p.catalog.sourceId : 'local', p.id, p.catalog?.localProjectId]);
    }
    function prepare(detail, view) {
        const scope = scopeOf(detail);
        if (view.scope !== scope) { view.scope = scope; view.role = ''; view.expanded.clear(); view.located = ''; }
        const rows = projectTodos(detail);
        const roles = [...new Set(rows.flatMap(t => t.delegation?.roles || []))];
        if (!roles.includes(view.role)) view.role = '';
        const keys = new Set(rows.map(t => t.key));
        for (const key of view.expanded) if (!keys.has(key)) view.expanded.delete(key);
        view.rows = new Map(rows.map(row => [row.key, row]));
        if (!rows.some(row => row.key === view.located && matchesRole(row, view.role))) view.located = '';
        return { rows, roles };
    }
    function steps(d) {
        const r = d.review;
        const stage = r?.verdict === 'passed' ? 'verified' : d.stage;
        const rejected = r?.verdict === 'rejected' || d.rejected;
        const index = ['pending', 'working', 'review', 'verified'].indexOf(stage);
        const labels = { ...STAGES, ...(r ? {
            review: '执行已结束', verified: r.verdict === 'passed' ? '限定核验通过' : '核验结果',
        } : {}) };
        return `<ol class="pf-delegation-steps phase-${stage}" aria-label="${r ? '执行与独立核验' : '委托阶段'}：${escape(r ? labels[stage] : d.stageLabel)}${rejected ? '，核验未通过' : ''}">${
            ['pending', 'working', 'review', 'verified'].map((step, i) =>
                `<li class="${index === i ? 'current' : index > i ? 'past' : ''}${rejected && i === 2 ? ' rejected' : ''}"${index === i ? ' aria-current="step"' : ''}>${escape(step === 'verified' && !r && d.stage === 'verified' ? d.stageLabel : labels[step])}</li>`).join('')
        }</ol>`;
    }
    function phaseHtml(t) {
        const d = t.delegation, r = d.review;
        const label = r && d.runtimeStatus === 'completed' ? '执行已结束' : d.stageLabel;
        return `<span class="pf-delegation-phase phase-${d.stage}${d.rejected ? ' rejected' : ''}">${escape(label)}${d.rejected ? ' · 核验退回' : ''}</span>${
            r ? `<span class="pf-review-badge ${r.verdict === 'passed' ? 'is-passed' : 'is-rejected'}">${r.verdict === 'passed' ? '限定核验通过' : '核验未通过'}</span>` : ''
        }${t.status === 'blocked' ? '<span class="pf-delegation-blocked">Todo 阻塞</span>' : ''}`;
    }
    function reviewHtml(d) {
        const r = d.review;
        if (!r) return '';
        const fields = [
            ['核验人', r.reviewedBy], ['核验时间', r.reviewedAt], ['限定范围', r.scope],
            ['结论说明', r.reason], ['证据引用', r.evidence.ref], ['证据 SHA256', r.evidence.sha256],
        ];
        return `<section class="pf-review-record ${r.verdict === 'passed' ? 'is-passed' : 'is-rejected'}" aria-label="独立核验">
            <strong>独立核验 · ${r.verdict === 'passed' ? '限定核验通过' : '核验未通过'} · 修订 ${r.revision}</strong>
            <dl>${fields.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('')}</dl>
            <p class="muted">仅对上述委托终态及范围负责；不代表整个工程验收。证据引用与摘要不等于内容已由客户端复核或数字签名。</p>
        </section>`;
    }
    function copyButtons(t) {
        return ['delegationId', 'sessionId'].filter(kind => t.delegation[kind]).map(kind => {
            const label = kind === 'delegationId' ? '委托 ID' : '会话 ID';
            return `<button type="button" class="pf-copy-btn" data-pf-copy="${kind}" data-pf-key="${escape(t.key)}"
                aria-label="复制${label}（Todo #${escape(t.seq)}）">复制${label}</button>`;
        }).join('');
    }
    function delegationHtml(t) {
        const d = t.delegation;
        const lines = [
            ['执行分身', d.role || '未指定执行人'], ['派工方', d.assignedBy || '未提供'],
            ...(d.delegationId ? [['委托 ID', d.delegationId]] : []),
            ...(d.sessionId ? [['会话', d.sessionId]] : []),
            ...(d.stageEvidence ? [['判定依据', d.stageEvidence]] : []),
            ...(d.scope ? [['验收范围', d.scope]] : []),
            ...d.writePaths.map(v => ['约定写入', v]), ...d.artifacts.map(v => ['约定产物', v]),
        ];
        return `<div class="pf-delegation-detail">${phaseHtml(t)}${steps(d)}
            <dl>${lines.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
            ${d.delegationId || d.sessionId ? `<div class="pf-delegation-actions">${copyButtons(t)}</div>` : ''}
            ${reviewHtml(d)}
            <p class="muted pf-delegation-origin">${d.source === 'runtime' ? '阶段来源：宿主生命周期快照（来源文本，非产物核验）'
                : d.source === 'note' ? '阶段来源：备注推导' : '阶段来源：结构化委托字段'} · 非实时监控；委托约定不证明磁盘产物存在或权限已隔离。</p>
            ${d.warning ? `<p class="warn-line">${escape(d.warning)}</p>` : ''}</div>`;
    }
    function render(detail, view, formatTime = value => String(value || '-')) {
        const { rows, roles } = prepare(detail, view);
        const delegations = rows.filter(t => t.delegation);
        const visible = rows.filter(t => matchesRole(t, view.role));
        const monitor = delegations.length ? `<section class="pf-delegation-monitor" aria-label="委托监视席">
            <div class="section-title">委托监视席 <span class="muted">${delegations.length} 条委托记录 · 只读快照</span></div>
            <p class="muted">Todo 状态与委托阶段独立；完成 Todo 不等于核验通过。</p>
            <div class="pf-delegation-cards">${delegations.filter(t => matchesRole(t, view.role)).map(t => `
                <article class="pf-delegation-card stage-${t.delegation.stage}${t.delegation.rejected ? ' is-rejected' : ''}${t.status === 'blocked' ? ' is-blocked' : ''}" data-pf-card="${escape(t.key)}">
                    <div class="pf-delegation-card-head"><strong>${escape(t.delegation.roles.join('\n') || '未指定执行人')}</strong>${phaseHtml(t)}</div>
                    <p><button type="button" class="pf-locate-btn" data-pf-locate="${escape(t.key)}"
                        aria-label="定位 Todo #${escape(t.seq)}">#${escape(t.seq)} ${escape(t.title)} <span aria-hidden="true">↘</span></button></p>
                    ${t.delegation.scope ? `<p class="pf-delegation-card-scope">验收范围：${escape(t.delegation.scope)}</p>` : ''}
                    ${reviewHtml(t.delegation)}
                    <div class="pf-delegation-card-foot">${steps(t.delegation)}
                        <div class="muted">Todo：${STATUSES[t.status]} · ${t.delegation.source === 'runtime' ? '宿主生命周期快照'
                            : t.delegation.source === 'note' ? '备注推导' : '结构化字段'}</div>
                        ${t.delegation.delegationId || t.delegation.sessionId ? `<code>${escape(t.delegation.delegationId || t.delegation.sessionId)}</code>
                            <div class="pf-delegation-actions">${copyButtons(t)}</div>` : ''}
                    </div>
                </article>`).join('')}</div></section>` : '';
        const filters = delegations.length && roles.length ? `<div class="pf-delegation-filters" role="group" aria-label="按执行角色筛选">
            ${['', ...roles].map(role => `<button type="button" data-pf-role="${escape(role)}" aria-pressed="${view.role === role}">${escape(role || '全部任务')}</button>`).join('')}</div>` : '';
        const total = detail?.project?.progress?.total;
        const partial = Number.isSafeInteger(total) && total > rows.length;
        return `${monitor}<div class="section-title">Todo</div>${filters}
            ${partial ? '<p class="warn-line">仅展示部分任务，已有完整条目的阶段仍有效。</p>' : ''}
            ${visible.length ? `<ul class="todo-list pf-todo-list">${visible.map(t => `<li data-pf-todo="${escape(t.key)}"${view.located === t.key ? ' class="is-located"' : ''}>
                <span class="todo-state ${t.status}">${STATUSES[t.status]}</span>
                <div class="pf-todo-body"><div class="pf-todo-title" data-pf-title="${escape(t.key)}" tabindex="-1">#${escape(t.seq)} ${escape(t.title)}</div>
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
        const control = active?.closest?.('[data-pf-role],[data-pf-locate],[data-pf-copy],[data-pf-title],summary');
        let focus = null;
        if (control && pane.contains(control)) {
            if (control.hasAttribute('data-pf-role')) focus = { role: control.dataset.pfRole };
            else if (control.hasAttribute('data-pf-locate')) focus = { locate: control.dataset.pfLocate };
            else if (control.hasAttribute('data-pf-copy')) focus = {
                copyKey: control.dataset.pfKey, kind: control.dataset.pfCopy,
                zone: control.closest('[data-pf-card]') ? 'card' : 'detail',
            };
            else if (control.hasAttribute('data-pf-title')) focus = { title: control.dataset.pfTitle };
            else focus = { note: control.closest('[data-pf-note]')?.dataset.pfNote };
        }
        const scroller = pane.closest('.tab-body') || pane;
        return { scope: view.scope, focus, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft };
    }
    function restore(pane, view, saved) {
        const scroller = pane.closest('.tab-body') || pane;
        if (!saved || saved.scope !== view.scope) { scroller.scrollTop = 0; scroller.scrollLeft = 0; return; }
        if (saved.focus) {
            const f = saved.focus;
            let target;
            if (f.role !== undefined) {
                target = [...pane.querySelectorAll('[data-pf-role]')].find(el => el.dataset.pfRole === f.role)
                    || pane.querySelector('[data-pf-role=""]');
            } else if (f.locate !== undefined) {
                target = [...pane.querySelectorAll('[data-pf-locate]')].find(el => el.dataset.pfLocate === f.locate);
            } else if (f.copyKey !== undefined) {
                target = [...pane.querySelectorAll('[data-pf-copy]')].find(el =>
                    el.dataset.pfKey === f.copyKey && el.dataset.pfCopy === f.kind
                    && (el.closest('[data-pf-card]') ? 'card' : 'detail') === f.zone);
            } else if (f.title !== undefined) {
                target = [...pane.querySelectorAll('[data-pf-title]')].find(el => el.dataset.pfTitle === f.title);
            } else {
                target = [...pane.querySelectorAll('[data-pf-note]')].find(el => el.dataset.pfNote === f.note)?.querySelector('summary');
            }
            target?.focus({ preventScroll: true });
        }
        scroller.scrollTop = saved.scrollTop;
        scroller.scrollLeft = saved.scrollLeft;
    }
    function actionRow(button, pane, view, key) {
        const owner = button.closest('[data-pf-card],[data-pf-todo]');
        if (!owner || !pane.contains(owner) || (owner.dataset.pfCard ?? owner.dataset.pfTodo) !== key) return null;
        const row = view.rows.get(key);
        return row?.delegation && matchesRole(row, view.role) ? row : null;
    }
    async function copyIdentity(button, pane, view, row, kind, options) {
        const scope = view.scope;
        // Detached/replaced controls invalidate feedback, including A -> B -> A navigation.
        const current = () => view.scope === scope && view.rows.get(row.key) === row
            && pane.isConnected && button.isConnected && pane.contains(button);
        let timer;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        try {
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('COPY_TIMEOUT')), 4000);
            });
            let operation;
            if (own(options, 'copyText')) {
                if (typeof options.copyText !== 'function') throw new Error('COPY_UNAVAILABLE');
                operation = options.copyText(row.delegation[kind]);
            } else {
                const clipboard = pane.ownerDocument.defaultView?.navigator.clipboard;
                if (typeof clipboard?.writeText !== 'function') throw new Error('COPY_UNAVAILABLE');
                // Start within the click's user activation; never read clipboard contents.
                operation = clipboard.writeText(row.delegation[kind]);
            }
            await Promise.race([operation, timeout]);
            if (current()) options.notify?.(kind === 'delegationId' ? '委托 ID 已复制' : '会话 ID 已复制', 'info');
        } catch {
            if (current()) options.notify?.('复制未确认：请重试，或手动选择 ID。', 'error');
        } finally {
            clearTimeout(timer);
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }
    }
    function handleClick(event, pane, view, rerender, options = {}) {
        const button = event.target.closest?.('button[data-pf-role],button[data-pf-locate],button[data-pf-copy]');
        if (!button || !pane.contains(button)) return false;
        if (button.disabled) return true;
        if (button.hasAttribute('data-pf-role')) {
            view.role = button.dataset.pfRole;
            rerender();
            return true;
        }
        const key = button.dataset.pfLocate ?? button.dataset.pfKey;
        const row = actionRow(button, pane, view, key);
        if (!row) {
            options.notify?.('当前委托不可用，请刷新后重试。', 'error');
            return true;
        }
        if (button.hasAttribute('data-pf-copy')) {
            const kind = button.dataset.pfCopy;
            if (!['delegationId', 'sessionId'].includes(kind) || !row.delegation[kind]) {
                options.notify?.('当前 ID 不可用，未复制。', 'error');
                return true;
            }
            void copyIdentity(button, pane, view, row, kind, options);
            return true;
        }
        const target = [...pane.querySelectorAll('[data-pf-todo]')].find(el => el.dataset.pfTodo === key);
        if (!target) {
            options.notify?.('当前 Todo 不可见，请刷新后重试。', 'error');
            return true;
        }
        view.located = key;
        for (const el of pane.querySelectorAll('[data-pf-todo]')) el.classList.toggle('is-located', el === target);
        target.querySelector('[data-pf-title]')?.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant', container: 'nearest' });
        return true;
    }
    return Object.freeze({ normalize, projectTodos, createViewState, scopeOf, prepare, render, capture, restore, handleClick, STAGES });
});