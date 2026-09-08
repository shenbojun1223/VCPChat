(function installAICodeWorkerTabView(globalObject, factory) {
    'use strict';
    const api = factory(globalObject);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (globalObject) {
        globalObject.AICodeWorkerTabView = api;
        // 若在 Next UI 环境下且未注册，自动注册该内部应用
        if (globalObject.nextUiApps && typeof globalObject.nextUiApps.register === 'function') {
            try {
                if (!globalObject.nextUiApps.get('aicodeworker')) {
                    globalObject.nextUiApps.register({
                        id: 'aicodeworker',
                        title: '代码调度',
                        icon: 'terminal',
                        kind: 'internal',
                        discoverable: true,
                        mount: (container, context) => api.mount(container, context),
                    });
                }
            } catch (err) {
                console.warn('[AICodeWorkerTabView] Auto-registration failed:', err);
            }
        }
    }
})(typeof window !== 'undefined' ? window : globalThis, function createAICodeWorkerTabViewApi(globalObject) {
    'use strict';

    function safeString(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        try {
            return String(value);
        } catch {
            return fallback;
        }
    }

    function formatElapsed(startedAt, completedAt, now) {
        if (!startedAt) return '';
        const start = new Date(startedAt).getTime();
        if (!Number.isFinite(start)) return '';
        const end = completedAt ? new Date(completedAt).getTime() : now;
        if (!Number.isFinite(end)) return '';
        const seconds = Math.max(0, Math.floor((end - start) / 1000));
        if (seconds < 60) return `${seconds}s`;
        return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
    }

    const KNOWN_STATES = Object.freeze({
        running: '运行中',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
        timeout: '超时',
    });

    class AICodeWorkerTabView {
        constructor(options = {}) {
            this.container = options.container || null;
            this.store = options.store || globalObject.aicodeWorkerStore || null;
            this.document = options.document || globalObject.document;
            this.scope = options.scope || null;
            this.now = options.now || (() => (globalObject.Date || Date).now());
            this.setInterval = options.setInterval || globalObject.setInterval?.bind(globalObject);
            this.clearInterval = options.clearInterval || globalObject.clearInterval?.bind(globalObject);

            this.selectedJobId = null;
            this.filterMode = 'all'; // 'all' | 'running' | 'completed'
            this.traceTab = 'summary'; // 'summary' | 'events' | 'raw'
            this._timerId = null;
            this._storeDisposers = [];
            this._domDisposers = [];
            this._cards = new Map();
        }

        mount() {
            if (!this.container || !this.document) return false;
            this._renderShell();
            this._bindStore();
            this.update();

            if (typeof this.setInterval === 'function') {
                this._timerId = this.setInterval(() => this._updateElapsedTimes(), 3000);
            }
            return true;
        }

        _renderShell() {
            const container = this.container;
            container.replaceChildren();

            const root = this.document.createElement('div');
            root.className = 'aicw-tab-view';

            // 左侧：列表侧栏
            const sidebar = this.document.createElement('aside');
            sidebar.className = 'aicw-tab-sidebar';

            const sidebarHeader = this.document.createElement('div');
            sidebarHeader.className = 'aicw-tab-sidebar-header';
            const title = this.document.createElement('h2');
            title.className = 'aicw-tab-sidebar-title';
            title.textContent = '代码调度';
            sidebarHeader.append(title);

            const filterBar = this.document.createElement('div');
            filterBar.className = 'aicw-tab-sidebar-filter';
            const filters = [
                { id: 'all', label: '全部' },
                { id: 'running', label: '运行中' },
                { id: 'completed', label: '已结束' },
            ];
            filters.forEach(f => {
                const btn = this.document.createElement('button');
                btn.type = 'button';
                btn.className = `aicw-tab-filter-btn${this.filterMode === f.id ? ' active' : ''}`;
                btn.dataset.filter = f.id;
                btn.textContent = f.label;
                btn.addEventListener('click', () => {
                    this.filterMode = f.id;
                    filterBar.querySelectorAll('.aicw-tab-filter-btn').forEach(el => {
                        el.classList.toggle('active', el.dataset.filter === f.id);
                    });
                    this.update();
                });
                filterBar.append(btn);
            });

            const jobsList = this.document.createElement('div');
            jobsList.className = 'aicw-tab-jobs-list';
            jobsList.setAttribute('role', 'list');

            sidebar.append(sidebarHeader, filterBar, jobsList);

            // 右侧：审查舞台
            const stage = this.document.createElement('section');
            stage.className = 'aicw-tab-stage';

            root.append(sidebar, stage);
            container.append(root);

            this._jobsList = jobsList;
            this._stage = stage;
        }

        _bindStore() {
            if (!this.store || typeof this.store.addEventListener !== 'function') return;
            const onChange = () => this.update();
            this.store.addEventListener('change', onChange);
            this._storeDisposers.push(() => this.store.removeEventListener?.('change', onChange));
        }

        update() {
            if (!this._jobsList) return;
            const jobs = this.store?.getJobs?.() || [];

            // 过滤
            const filteredJobs = jobs.filter(job => {
                if (this.filterMode === 'running') return job.state === 'running';
                if (this.filterMode === 'completed') return job.state !== 'running';
                return true;
            });

            // 维护选中项：如果没有选中或选中任务不在列表中，默认选中第一项
            if (filteredJobs.length > 0) {
                if (!this.selectedJobId || !jobs.some(j => j.jobId === this.selectedJobId)) {
                    this.selectedJobId = filteredJobs[0].jobId;
                }
            } else {
                this.selectedJobId = null;
            }

            // 渲染左侧列表
            this._jobsList.replaceChildren();
            if (filteredJobs.length === 0) {
                const empty = this.document.createElement('div');
                empty.className = 'aicw-tab-stage-empty';
                empty.textContent = '暂无任务记录';
                this._jobsList.append(empty);
            } else {
                filteredJobs.forEach(job => {
                    const card = this._createJobCard(job);
                    this._jobsList.append(card);
                });
            }

            // 渲染右侧主舞台
            this._renderStage();
        }

        _createJobCard(job) {
            const card = this.document.createElement('div');
            card.className = `aicw-tab-job-card${this.selectedJobId === job.jobId ? ' active' : ''}`;
            card.dataset.jobid = job.jobId;
            card.dataset.state = job.state || 'unknown';

            const header = this.document.createElement('div');
            header.className = 'aicw-tab-job-card-header';
            const idSpan = this.document.createElement('span');
            idSpan.className = 'aicw-tab-job-card-id';
            const shortId = job.jobId.length > 10 ? job.jobId.slice(-10) : job.jobId;
            idSpan.textContent = `#${shortId}`;
            const stateSpan = this.document.createElement('span');
            stateSpan.className = 'aicw-tab-job-card-state';
            stateSpan.textContent = KNOWN_STATES[job.state] || job.state || '未知';
            header.append(idSpan, stateSpan);

            const body = this.document.createElement('div');
            body.className = 'aicw-tab-job-card-body';
            const worker = this.document.createElement('span');
            worker.className = 'aicw-tab-job-card-worker';
            worker.textContent = [job.worker, job.mode].filter(Boolean).join(' / ') || 'worker';
            const elapsed = this.document.createElement('span');
            elapsed.className = 'aicw-tab-job-card-elapsed';
            elapsed.textContent = formatElapsed(job.startedAt, job.completedAt, this.now());
            body.append(worker, elapsed);

            card.append(header, body);
            card.addEventListener('click', () => {
                if (this.selectedJobId !== job.jobId) {
                    this.selectedJobId = job.jobId;
                    this._jobsList.querySelectorAll('.aicw-tab-job-card').forEach(el => {
                        el.classList.toggle('active', el.dataset.jobid === job.jobId);
                    });
                    this._renderStage();
                }
            });
            return card;
        }

        _renderStage() {
            if (!this._stage) return;
            this._stage.replaceChildren();

            const job = this.selectedJobId ? this.store?.getJob?.(this.selectedJobId) : null;
            if (!job) {
                const empty = this.document.createElement('div');
                empty.className = 'aicw-tab-stage-empty';
                empty.innerHTML = '<span>⚡ 请在左侧选择一个任务查看详情与审查轨迹</span>';
                this._stage.append(empty);
                return;
            }

            // Stage Header
            const header = this.document.createElement('header');
            header.className = 'aicw-tab-stage-header';

            const headline = this.document.createElement('div');
            headline.className = 'aicw-tab-stage-headline';
            const titleRow = this.document.createElement('div');
            titleRow.className = 'aicw-tab-stage-title-row';
            const title = this.document.createElement('h3');
            title.className = 'aicw-tab-stage-title';
            title.textContent = `任务 #${job.jobId}`;
            titleRow.append(title);

            const meta = this.document.createElement('div');
            meta.className = 'aicw-tab-stage-meta';
            meta.textContent = `${job.worker || 'codex'} · ${job.mode || 'write'} · 耗时 ${formatElapsed(job.startedAt, job.completedAt, this.now()) || '0s'}`;
            headline.append(titleRow, meta);

            const actions = this.document.createElement('div');
            actions.className = 'aicw-tab-stage-actions';
            if (job.state === 'running') {
                const killBtn = this.document.createElement('button');
                killBtn.type = 'button';
                killBtn.className = 'aicw-tab-kill-btn';
                killBtn.textContent = '🛑 安全终止 (Kill PID)';
                killBtn.addEventListener('click', () => {
                    killBtn.disabled = true;
                    killBtn.textContent = '正在终止…';
                    this.store?.cancelWorkerJob?.(job.jobId);
                });
                actions.append(killBtn);
            }
            header.append(headline, actions);

            // Stage Content
            const content = this.document.createElement('div');
            content.className = 'aicw-tab-stage-content';

            // Meta Grid
            const grid = this.document.createElement('div');
            grid.className = 'aicw-tab-meta-grid';
            const metaFields = [
                ['状态', KNOWN_STATES[job.state] || job.state],
                ['工作目录', job.projectPath || '—'],
                ['PID', job.pid ? String(job.pid) : '—'],
                ['退出码', job.exitCode !== undefined && job.exitCode !== null ? String(job.exitCode) : '—'],
                ['开始时间', job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—'],
                ['完成时间', job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : '—'],
            ];
            metaFields.forEach(([label, val]) => {
                const item = this.document.createElement('div');
                item.className = 'aicw-tab-meta-item';
                const l = this.document.createElement('span');
                l.className = 'aicw-tab-meta-label';
                l.textContent = label;
                const v = this.document.createElement('span');
                v.className = 'aicw-tab-meta-value';
                v.textContent = val;
                item.append(l, v);
                grid.append(item);
            });

            // Trace Panel
            const tracePanel = this.document.createElement('div');
            tracePanel.className = 'aicw-tab-trace-panel';

            const traceHeader = this.document.createElement('div');
            traceHeader.className = 'aicw-tab-trace-header';
            const traceTabs = this.document.createElement('div');
            traceTabs.className = 'aicw-tab-trace-tabs';

            const tabModes = [
                { id: 'summary', label: 'Summary 摘要' },
                { id: 'events', label: 'Events 事件树' },
                { id: 'raw', label: 'Raw 终端流' },
            ];
            tabModes.forEach(m => {
                const b = this.document.createElement('button');
                b.type = 'button';
                b.className = `aicw-tab-trace-tab-btn${this.traceTab === m.id ? ' active' : ''}`;
                b.dataset.mode = m.id;
                b.textContent = m.label;
                b.addEventListener('click', () => {
                    this.traceTab = m.id;
                    traceTabs.querySelectorAll('.aicw-tab-trace-tab-btn').forEach(el => {
                        el.classList.toggle('active', el.dataset.mode === m.id);
                    });
                    this._updateTraceBody(traceBody, job);
                });
                traceTabs.append(b);
            });
            traceHeader.append(traceTabs);

            const traceBody = this.document.createElement('div');
            traceBody.className = 'aicw-tab-trace-body';
            this._updateTraceBody(traceBody, job);

            tracePanel.append(traceHeader, traceBody);
            content.append(grid, tracePanel);

            this._stage.append(header, content);
        }

        _updateTraceBody(container, job) {
            container.replaceChildren();
            if (this.traceTab === 'summary') {
                const summary = job.exitReason || job.summary || job.error || (job.state === 'running' ? '正在执行任务阶段门禁与代码分析…' : '无附加阶段摘要');
                container.textContent = summary;
            } else if (this.traceTab === 'events') {
                const events = job.events || job.traceEvents;
                if (Array.isArray(events) && events.length > 0) {
                    container.textContent = JSON.stringify(events, null, 2);
                } else {
                    container.textContent = `[事件流]\n- 状态更新: ${job.state}\n- 关联进程: PID ${job.pid || 'N/A'}\n- 执行模态: ${job.mode || 'write'}\n- 退出码: ${job.exitCode ?? 'N/A'}`;
                }
            } else {
                const raw = job.output || job.logs || job.rawLog || (job.state === 'running' ? '等待进程输出…' : '无终端输出记录');
                container.textContent = raw;
            }
        }

        _updateElapsedTimes() {
            if (!this._jobsList) return;
            const now = this.now();
            this._jobsList.querySelectorAll('.aicw-tab-job-card').forEach(card => {
                const jobId = card.dataset.jobid;
                const job = this.store?.getJob?.(jobId);
                if (job && job.state === 'running') {
                    const elapsedEl = card.querySelector('.aicw-tab-job-card-elapsed');
                    if (elapsedEl) elapsedEl.textContent = formatElapsed(job.startedAt, job.completedAt, now);
                }
            });
        }

        dispose() {
            if (this._timerId !== null && typeof this.clearInterval === 'function') {
                this.clearInterval(this._timerId);
                this._timerId = null;
            }
            this._storeDisposers.splice(0).forEach(d => d());
            this._domDisposers.splice(0).forEach(d => d());
            if (this.container) this.container.replaceChildren();
            this.container = null;
        }
    }

    return {
        AICodeWorkerTabView,
        mount: (container, context = {}) => {
            const view = new AICodeWorkerTabView({
                container,
                store: globalObject.aicodeWorkerStore,
                document: globalObject.document,
                scope: context.scope,
            });
            view.mount();
            return () => view.dispose();
        }
    };
});