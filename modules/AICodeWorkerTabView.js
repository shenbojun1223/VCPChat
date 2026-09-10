(function installAICodeWorkerTabView(globalObject, factory) {
    'use strict';
    const api = factory(globalObject);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (globalObject) {
        globalObject.AICodeWorkerTabView = api;

        function tryRegisterNextUiApp() {
            if (!globalObject.nextUiApps || typeof globalObject.nextUiApps.register !== 'function') return false;
            try {
                if (!globalObject.nextUiApps.get('aicodeworker')) {
                    globalObject.nextUiApps.register({
                        id: 'aicodeworker',
                        title: '代码调度',
                        icon: 'terminal',
                        launchpadIcon: 'terminal',
                        kind: 'internal',
                        discoverable: true,
                        mount: (container, context) => api.mount(container, context),
                    });
                    return true;
                }
            } catch (err) {
                console.warn('[AICodeWorkerTabView] Auto-registration failed:', err);
            }
            return false;
        }

        if (!tryRegisterNextUiApp()) {
            globalObject.addEventListener?.('next-ui-apps-ready', tryRegisterNextUiApp, { once: true });
            globalObject.document?.addEventListener?.('DOMContentLoaded', tryRegisterNextUiApp, { once: true });
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

    function removeNode(node) {
        if (!node) return;
        if (typeof node.remove === 'function') node.remove();
        else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
            node.parentNode.removeChild(node);
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

    function extractJobTitle(job) {
        if (!job) return '未命名任务';
        if (job.title && typeof job.title === 'string' && job.title.trim()) {
            return job.title.trim();
        }
        if (job.prompt && typeof job.prompt === 'string') {
            const firstLine = job.prompt.split('\n')[0].replace(/^[#*\s-]+/, '').trim();
            if (firstLine.length > 0) {
                return firstLine.length > 36 ? `${firstLine.slice(0, 36)}…` : firstLine;
            }
        }
        if (Array.isArray(job.changedFiles) && job.changedFiles.length > 0) {
            const firstFile = job.changedFiles[0].path || job.changedFiles[0].oldPath;
            if (firstFile) {
                const baseName = firstFile.split(/[/\\]/).pop();
                return `${baseName} · 变更审计`;
            }
        }
        if (job.projectPath) {
            const folderName = job.projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop();
            if (folderName) {
                return `${folderName} · ${job.mode || '任务'}`;
            }
        }
        const shortId = job.jobId && job.jobId.length > 8 ? job.jobId.slice(-8) : (job.jobId || 'task');
        return `任务 #${shortId}`;
    }

    function parseStructuredSummary(rawInput, job) {
        const result = {
            alertType: null,
            alertTitle: '',
            alertDesc: '',
            diagnoses: [],
            commands: [],
            diffSummary: '',
        };

        if (job.state === 'timeout') {
            result.alertType = 'warning';
            result.alertTitle = '任务超时告警';
            result.alertDesc = '该任务超过执行时间门禁，已由守护模块触发保护性中断。';
        } else if (job.state === 'failed') {
            result.alertType = 'error';
            result.alertTitle = '任务执行失败';
            result.alertDesc = job.error || job.exitReason || '任务执行非零退出，请检查测试或构建输出。';
        }

        const text = typeof rawInput === 'string' ? rawInput.trim() : '';
        if (!text) {
            if (job.state === 'running') {
                result.diagnoses.push('正在执行阶段门禁与代码分析…');
            }
            return result;
        }

        const lines = text.split('\n');
        let hasJsonLine = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    hasJsonLine = true;
                    if (parsed.type === 'agent_message' && parsed.text) {
                        result.diagnoses.push(parsed.text);
                    } else if (parsed.item?.type === 'agent_message' && parsed.item.text) {
                        result.diagnoses.push(parsed.item.text);
                    } else if (parsed.type === 'command_execution' && parsed.command) {
                        result.commands.push(parsed.command);
                    } else if (parsed.item?.type === 'command_execution' && parsed.item.command) {
                        result.commands.push(parsed.item.command);
                    }
                    continue;
                } catch {}
            }

            if (!hasJsonLine) {
                result.diagnoses.push(trimmed);
            }
        }

        return result;
    }

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
            this.filterMode = 'all';
            this.traceTab = 'summary';
            this._timerId = null;
            this._storeDisposers = [];
            this._domDisposers = [];

            // 增量 DOM 映射与高保真就地更新缓存
            this._cards = new Map();
            this._currentStageJobId = null;
            this._stageNodes = null;
            this._pendingQueries = new Set();
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

            const sidebar = this.document.createElement('aside');
            sidebar.className = 'aicw-tab-sidebar';

            const sidebarHeader = this.document.createElement('div');
            sidebarHeader.className = 'aicw-tab-sidebar-header';

            const titleGroup = this.document.createElement('div');
            titleGroup.className = 'aicw-tab-header-title-group';

            const title = this.document.createElement('h2');
            title.className = 'aicw-tab-sidebar-title';
            title.textContent = '代码调度';

            const taskBadge = this.document.createElement('span');
            taskBadge.className = 'aicw-tab-task-badge';
            taskBadge.textContent = '0 活跃';
            this._taskBadge = taskBadge;

            titleGroup.append(title, taskBadge);
            sidebarHeader.append(titleGroup);

            const filterBar = this.document.createElement('div');
            filterBar.className = 'aicw-tab-sidebar-filter';
            filterBar.setAttribute('role', 'tablist');

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
                btn.setAttribute('role', 'tab');
                btn.setAttribute('aria-selected', this.filterMode === f.id ? 'true' : 'false');
                btn.addEventListener('click', () => {
                    this.filterMode = f.id;
                    filterBar.querySelectorAll('.aicw-tab-filter-btn').forEach(el => {
                        const isMatch = el.dataset.filter === f.id;
                        el.classList.toggle('active', isMatch);
                        el.setAttribute('aria-selected', isMatch ? 'true' : 'false');
                    });
                    this.update();
                });
                filterBar.append(btn);
            });

            sidebarHeader.append(filterBar);

            const jobsList = this.document.createElement('div');
            jobsList.className = 'aicw-tab-jobs-list';
            jobsList.setAttribute('role', 'list');

            sidebar.append(sidebarHeader, jobsList);

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

            const runningCount = jobs.filter(j => j.state === 'running').length;
            if (this._taskBadge) {
                this._taskBadge.textContent = `${runningCount} 活跃`;
            }

            const filteredJobs = jobs.filter(job => {
                if (this.filterMode === 'running') return job.state === 'running';
                if (this.filterMode === 'completed') return job.state !== 'running';
                return true;
            });

            if (filteredJobs.length > 0) {
                if (!this.selectedJobId || !jobs.some(j => j.jobId === this.selectedJobId)) {
                    this.selectedJobId = filteredJobs[0].jobId;
                }
            } else {
                this.selectedJobId = null;
            }

            // 增量对齐左侧列表，防止会话上下跳动与滚动重置
            this._reconcileJobCards(filteredJobs);

            // 增量就地对齐右侧舞台，彻底根治下拉自动回弹
            this._renderStage();
        }

        _reconcileJobCards(filteredJobs) {
            const currentIds = new Set(filteredJobs.map(j => j.jobId));

            // 清理不在当前过滤列表中的卡片
            for (const [id, card] of this._cards.entries()) {
                if (!currentIds.has(id)) {
                    removeNode(card);
                    this._cards.delete(id);
                }
            }

            if (filteredJobs.length === 0) {
                this._jobsList.replaceChildren();
                const empty = this.document.createElement('div');
                empty.className = 'aicw-tab-stage-empty';
                empty.textContent = '暂无任务记录';
                this._jobsList.append(empty);
                return;
            }

            const emptyEl = this._jobsList.querySelector('.aicw-tab-stage-empty');
            if (emptyEl) removeNode(emptyEl);

            filteredJobs.forEach(job => {
                let card = this._cards.get(job.jobId);
                if (!card) {
                    card = this._createJobCard(job);
                    this._cards.set(job.jobId, card);
                } else {
                    this._updateJobCard(card, job);
                }
                // append 会在 DOM 中保持已有节点而仅做次序稳定对齐，避免滚动条重置
                this._jobsList.append(card);
            });
        }

        _createJobCard(job) {
            const card = this.document.createElement('div');
            card.className = `aicw-tab-job-card${this.selectedJobId === job.jobId ? ' active' : ''}`;
            card.dataset.jobid = job.jobId;
            card.dataset.state = job.state || 'unknown';
            card.tabIndex = 0;

            const indicator = this.document.createElement('div');
            indicator.className = 'aicw-tab-card-indicator';
            card.append(indicator);

            const body = this.document.createElement('div');
            body.className = 'aicw-tab-card-body';

            const topRow = this.document.createElement('div');
            topRow.className = 'aicw-tab-card-top-row';

            const title = this.document.createElement('span');
            title.className = 'aicw-tab-card-title';
            const titleText = extractJobTitle(job);
            title.textContent = titleText;
            title.title = titleText;

            const duration = this.document.createElement('span');
            duration.className = 'aicw-tab-card-duration aicw-tab-job-card-elapsed';
            duration.textContent = formatElapsed(job.startedAt, job.completedAt, this.now());

            topRow.append(title, duration);

            const subRow = this.document.createElement('div');
            subRow.className = 'aicw-tab-card-sub-row';

            const shortHash = job.jobId && job.jobId.length > 8 ? job.jobId.slice(-8) : (job.jobId || '');
            const hashSpan = this.document.createElement('span');
            hashSpan.className = 'aicw-tab-card-hash';
            hashSpan.textContent = `#${shortHash}`;

            const separator = this.document.createElement('span');
            separator.className = 'aicw-tab-card-separator';
            separator.textContent = '·';

            const metaSpan = this.document.createElement('span');
            metaSpan.className = 'aicw-tab-card-meta';
            metaSpan.textContent = [job.worker || 'codex', job.mode || 'write'].join(' / ');

            const tagSpan = this.document.createElement('span');
            tagSpan.className = `aicw-tab-status-tag aicw-tab-job-card-state tag-${job.state || 'unknown'}`;
            tagSpan.textContent = KNOWN_STATES[job.state] || job.state || '未知';

            subRow.append(hashSpan, separator, metaSpan, tagSpan);
            body.append(topRow, subRow);
            card.append(body);

            card.addEventListener('click', () => {
                if (this.selectedJobId !== job.jobId) {
                    this.selectedJobId = job.jobId;
                    this._jobsList.querySelectorAll('.aicw-tab-job-card').forEach(el => {
                        el.classList.toggle('active', el.dataset.jobid === job.jobId);
                    });
                    this._ensureJobDetail(job.jobId);
                    this._renderStage();
                }
            });

            return card;
        }

        _updateJobCard(card, job) {
            const isMatch = this.selectedJobId === job.jobId;
            card.classList.toggle('active', isMatch);
            card.dataset.state = job.state || 'unknown';

            const titleEl = card.querySelector('.aicw-tab-card-title');
            if (titleEl) {
                const titleText = extractJobTitle(job);
                if (titleEl.textContent !== titleText) {
                    titleEl.textContent = titleText;
                    titleEl.title = titleText;
                }
            }

            const elapsedEl = card.querySelector('.aicw-tab-job-card-elapsed');
            if (elapsedEl) {
                const elapsedStr = formatElapsed(job.startedAt, job.completedAt, this.now());
                if (elapsedEl.textContent !== elapsedStr) {
                    elapsedEl.textContent = elapsedStr;
                }
            }

            const metaEl = card.querySelector('.aicw-tab-card-meta');
            if (metaEl) {
                const metaStr = [job.worker || 'codex', job.mode || 'write'].join(' / ');
                if (metaEl.textContent !== metaStr) {
                    metaEl.textContent = metaStr;
                }
            }

            const tagEl = card.querySelector('.aicw-tab-status-tag');
            if (tagEl) {
                tagEl.className = `aicw-tab-status-tag aicw-tab-job-card-state tag-${job.state || 'unknown'}`;
                const label = KNOWN_STATES[job.state] || job.state || '未知';
                if (tagEl.textContent !== label) {
                    tagEl.textContent = label;
                }
            }
        }

        _ensureJobDetail(jobId) {
            if (!jobId || !this.store || typeof this.store.fetchJobDetail !== 'function') return;
            const job = this.store.getJob(jobId);

            // 终态判定：若任务已结束且已有任一关键详情产物，跳过查询
            const hasDetail = job && (
                Boolean(job.summary) ||
                Boolean(job.output) ||
                Boolean(job.rawTrace) ||
                (Array.isArray(job.executionTrace) && job.executionTrace.length > 0) ||
                (Array.isArray(job.changedFiles) && job.changedFiles.length > 0)
            );
            const isTerminal = ['completed', 'failed', 'cancelled', 'timeout'].includes(job?.state);
            if (isTerminal && hasDetail) return;

            // 直接交由 Store 状态机统一纳管在途并发锁与异常安全恢复
            this.store.fetchJobDetail(jobId, this.traceTab);
        }

        /**
         * 舞台增量就地更新（In-place Reconciliation），彻底杜绝滚动条跳跃复位
         */
        _renderStage() {
            if (!this._stage) return;

            const job = this.selectedJobId ? this.store?.getJob?.(this.selectedJobId) : null;
            if (!job) {
                this._currentStageJobId = null;
                this._stageNodes = null;
                this._stage.replaceChildren();
                const empty = this.document.createElement('div');
                empty.className = 'aicw-tab-stage-empty';
                empty.innerHTML = '<span>⚡ 请在左侧选择一个任务查看详情与审查轨迹</span>';
                this._stage.append(empty);
                return;
            }

            this._ensureJobDetail(job.jobId);

            // 若为首次初始化或切换至其他任务，构建舞台骨架
            if (this._currentStageJobId !== job.jobId || !this._stageNodes) {
                this._buildStageShell(job);
                return;
            }

            // 同一任务：就地增量差分更新，绝不 replaceChildren，彻底保持滚动条位置
            this._updateStageInPlace(job);
        }

        _buildStageShell(job) {
            this._stage.replaceChildren();
            this._currentStageJobId = job.jobId;

            const header = this.document.createElement('header');
            header.className = 'aicw-tab-stage-header';

            const headlineGroup = this.document.createElement('div');
            headlineGroup.className = 'aicw-tab-stage-headline-group';

            const titleRow = this.document.createElement('div');
            titleRow.className = 'aicw-tab-stage-title-row';

            const statusPill = this.document.createElement('span');
            statusPill.className = `aicw-tab-status-pill-lg pill-${job.state || 'unknown'}`;
            const elapsedStr = formatElapsed(job.startedAt, job.completedAt, this.now());
            statusPill.textContent = `${KNOWN_STATES[job.state] || job.state}${elapsedStr ? ` (${elapsedStr})` : ''}`;

            const mainTitle = this.document.createElement('h2');
            mainTitle.className = 'aicw-tab-stage-title';
            mainTitle.textContent = extractJobTitle(job);

            titleRow.append(statusPill, mainTitle);

            const jobIdWrap = this.document.createElement('div');
            jobIdWrap.className = 'aicw-tab-job-id-wrap';

            const jobIdText = this.document.createElement('span');
            jobIdText.className = 'aicw-tab-job-id-text';
            jobIdText.textContent = job.jobId;

            const copyBtn = this.document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'aicw-tab-copy-btn';
            copyBtn.title = '复制完整 Job ID';
            copyBtn.textContent = '⎘';
            copyBtn.addEventListener('click', () => {
                if (globalObject.navigator?.clipboard?.writeText) {
                    globalObject.navigator.clipboard.writeText(job.jobId);
                    copyBtn.textContent = '✓';
                    setTimeout(() => { copyBtn.textContent = '⎘'; }, 1500);
                }
            });

            jobIdWrap.append(jobIdText, copyBtn);
            headlineGroup.append(titleRow, jobIdWrap);

            const actions = this.document.createElement('div');
            actions.className = 'aicw-tab-stage-actions';

            const killBtn = this.document.createElement('button');
            killBtn.type = 'button';
            killBtn.className = 'aicw-tab-kill-btn';
            killBtn.textContent = '🛑 安全终止 (Kill PID)';
            killBtn.addEventListener('click', () => {
                killBtn.disabled = true;
                killBtn.textContent = '正在终止…';
                this.store?.cancelWorkerJob?.(job.jobId);
            });

            if (job.state === 'running') {
                actions.append(killBtn);
            }

            header.append(headlineGroup, actions);

            const content = this.document.createElement('div');
            content.className = 'aicw-tab-stage-content';

            const grid = this.document.createElement('div');
            grid.className = 'aicw-tab-meta-grid';
            const metaValues = new Map();
            const metaFields = [
                ['工作目录', 'projectPath', job.projectPath || '—', true],
                ['守护 PID', 'pid', job.pid ? String(job.pid) : '—', false],
                ['退出码', 'exitCode', job.exitCode !== undefined && job.exitCode !== null ? String(job.exitCode) : '—', false],
                ['开始时间', 'startedAt', job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—', false],
                ['完成时间', 'completedAt', job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : '—', false],
                ['执行 Worker', 'worker', [job.worker || 'codex', job.mode || 'write'].join(' / '), false],
            ];
            metaFields.forEach(([label, key, val, isCode]) => {
                const item = this.document.createElement('div');
                item.className = 'aicw-tab-meta-item';
                const l = this.document.createElement('span');
                l.className = 'aicw-tab-meta-label';
                l.textContent = label;
                const v = this.document.createElement('span');
                v.className = `aicw-tab-meta-value${isCode ? ' code' : ''}`;
                v.textContent = val;
                metaValues.set(key, v);
                item.append(l, v);
                grid.append(item);
            });

            const diffSlot = this.document.createElement('div');
            diffSlot.className = 'aicw-tab-diff-slot';
            const diffPanel = this._renderDiffPanel(job);
            if (diffPanel) diffSlot.append(diffPanel);

            const consoleSection = this.document.createElement('section');
            consoleSection.className = 'aicw-tab-console-section';

            const consoleToolbar = this.document.createElement('div');
            consoleToolbar.className = 'aicw-tab-console-toolbar';

            const traceTabs = this.document.createElement('div');
            traceTabs.className = 'aicw-tab-console-tabs';
            traceTabs.setAttribute('role', 'tablist');

            const tabModes = [
                { id: 'summary', label: 'Summary 结构化摘要' },
                { id: 'events', label: 'Events 事件树' },
                { id: 'raw', label: 'Raw 原始终端流' },
            ];
            tabModes.forEach(m => {
                const b = this.document.createElement('button');
                b.type = 'button';
                b.className = `aicw-tab-c-tab aicw-tab-trace-tab-btn${this.traceTab === m.id ? ' active' : ''}`;
                b.dataset.mode = m.id;
                b.textContent = m.label;
                b.setAttribute('role', 'tab');
                b.setAttribute('aria-selected', this.traceTab === m.id ? 'true' : 'false');
                b.addEventListener('click', () => {
                    this.traceTab = m.id;
                    traceTabs.querySelectorAll('.aicw-tab-c-tab').forEach(el => {
                        const isMatch = el.dataset.mode === m.id;
                        el.classList.toggle('active', isMatch);
                        el.setAttribute('aria-selected', isMatch ? 'true' : 'false');
                    });
                    this.store?.fetchJobDetail?.(job.jobId, m.id);
                    this._updateTraceBody(consoleViewport, job);
                });
                traceTabs.append(b);
            });

            const consoleActions = this.document.createElement('div');
            consoleActions.className = 'aicw-tab-console-actions';

            const pulseDot = this.document.createElement('span');
            pulseDot.className = `aicw-tab-pulse-dot dot-${job.state || 'unknown'}`;

            const streamText = this.document.createElement('span');
            streamText.className = 'aicw-tab-stream-text';
            streamText.textContent = job.state === 'running' ? '实时执行中' : '进程已终结';

            consoleActions.append(pulseDot, streamText);
            consoleToolbar.append(traceTabs, consoleActions);

            const consoleViewport = this.document.createElement('div');
            consoleViewport.className = 'aicw-tab-console-viewport aicw-tab-trace-body';
            this._updateTraceBody(consoleViewport, job);

            consoleSection.append(consoleToolbar, consoleViewport);
            content.append(grid, diffSlot, consoleSection);

            this._stage.append(header, content);

            this._stageNodes = {
                statusPill,
                mainTitle,
                jobIdText,
                actions,
                killBtn,
                metaValues,
                diffSlot,
                pulseDot,
                streamText,
                traceTabs,
                consoleViewport,
                content,
            };
        }

        _updateStageInPlace(job) {
            const nodes = this._stageNodes;
            if (!nodes) return;

            // 1. 状态大胶囊与耗时
            const elapsedStr = formatElapsed(job.startedAt, job.completedAt, this.now());
            const targetPillText = `${KNOWN_STATES[job.state] || job.state}${elapsedStr ? ` (${elapsedStr})` : ''}`;
            if (nodes.statusPill.textContent !== targetPillText) {
                nodes.statusPill.textContent = targetPillText;
            }
            nodes.statusPill.className = `aicw-tab-status-pill-lg pill-${job.state || 'unknown'}`;

            // 2. 标题
            const targetTitle = extractJobTitle(job);
            if (nodes.mainTitle.textContent !== targetTitle) {
                nodes.mainTitle.textContent = targetTitle;
            }

            // 3. Kill 按钮
            if (job.state === 'running') {
                if (!nodes.actions.contains?.(nodes.killBtn) && !nodes.actions.children?.includes?.(nodes.killBtn)) {
                    nodes.actions.append(nodes.killBtn);
                }
                if (nodes.killBtn.disabled) {
                    nodes.killBtn.disabled = false;
                    nodes.killBtn.textContent = '🛑 安全终止 (Kill PID)';
                }
            } else {
                removeNode(nodes.killBtn);
            }

            // 4. Meta 字段
            const metaMap = {
                projectPath: job.projectPath || '—',
                pid: job.pid ? String(job.pid) : '—',
                exitCode: job.exitCode !== undefined && job.exitCode !== null ? String(job.exitCode) : '—',
                startedAt: job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : '—',
                completedAt: job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : '—',
                worker: [job.worker || 'codex', job.mode || 'write'].join(' / '),
            };
            for (const [key, textVal] of Object.entries(metaMap)) {
                const node = nodes.metaValues.get(key);
                if (node && node.textContent !== textVal) {
                    node.textContent = textVal;
                }
            }

            // 5. Diff 面板就地刷新
            const newDiffPanel = this._renderDiffPanel(job);
            nodes.diffSlot.replaceChildren();
            if (newDiffPanel) nodes.diffSlot.append(newDiffPanel);

            // 6. 控制台状态与脉冲点
            nodes.pulseDot.className = `aicw-tab-pulse-dot dot-${job.state || 'unknown'}`;
            const targetStreamText = job.state === 'running' ? '实时执行中' : '进程已终结';
            if (nodes.streamText.textContent !== targetStreamText) {
                nodes.streamText.textContent = targetStreamText;
            }

            // 7. 外层 Content 与内层 Console Viewport 滚动保真
            const oldContentScrollTop = nodes.content.scrollTop;
            const oldConsoleScrollTop = nodes.consoleViewport.scrollTop;

            this._updateTraceBody(nodes.consoleViewport, job);

            if (oldContentScrollTop > 0 && typeof nodes.content.scrollTop === 'number') {
                nodes.content.scrollTop = oldContentScrollTop;
            }
            if (oldConsoleScrollTop > 0 && typeof nodes.consoleViewport.scrollTop === 'number') {
                nodes.consoleViewport.scrollTop = oldConsoleScrollTop;
            }
        }

        _renderDiffPanel(job) {
            const changedFiles = Array.isArray(job.changedFiles) ? job.changedFiles : [];
            const hasCandidate = job.candidateAvailable === true || job.patchAvailable === true;
            if (changedFiles.length === 0 && !hasCandidate && !job.validation) return null;

            const panel = this.document.createElement('div');
            panel.className = 'aicw-tab-diff-panel';

            const header = this.document.createElement('div');
            header.className = 'aicw-tab-diff-header';

            const title = this.document.createElement('div');
            title.className = 'aicw-tab-diff-title';
            title.textContent = `变更审查 (${changedFiles.length} 个文件)`;

            if (hasCandidate) {
                const badge = this.document.createElement('span');
                badge.className = 'aicw-tab-candidate-badge';
                badge.textContent = job.resultCommit ? `候选 Commit: ${job.resultCommit.slice(0, 7)}` : '补丁已就绪';
                title.append(badge);
            }
            header.append(title);
            panel.append(header);

            if (changedFiles.length > 0) {
                const list = this.document.createElement('div');
                list.className = 'aicw-tab-diff-files-list';
                changedFiles.forEach(file => {
                    const item = this.document.createElement('div');
                    item.className = 'aicw-tab-diff-file-item';

                    const pathSpan = this.document.createElement('span');
                    pathSpan.className = 'aicw-tab-diff-file-path';
                    pathSpan.textContent = file.path || file.oldPath || 'unknown';

                    const statusSpan = this.document.createElement('span');
                    statusSpan.className = 'aicw-tab-diff-file-status';
                    statusSpan.dataset.status = file.status || 'M';
                    statusSpan.textContent = file.status || 'M';

                    item.append(pathSpan, statusSpan);
                    list.append(item);
                });
                panel.append(list);
            }

            if (job.validation && Array.isArray(job.validation.steps) && job.validation.steps.length > 0) {
                const stepsContainer = this.document.createElement('div');
                stepsContainer.className = 'aicw-tab-validation-steps';
                job.validation.steps.forEach(step => {
                    const chip = this.document.createElement('span');
                    const passed = step.status === 'passed' || step.exitCode === 0;
                    chip.className = `aicw-tab-validation-chip ${passed ? 'pass' : 'fail'}`;
                    chip.textContent = `${step.name || 'check'}: ${passed ? '✓' : '✕'}`;
                    stepsContainer.append(chip);
                });
                panel.append(stepsContainer);
            }

            return panel;
        }

        _updateTraceBody(container, job) {
            container.replaceChildren();
            if (this.traceTab === 'summary') {
                const rawSummary = job.summary || job.exitReason || job.error || job.output;
                const structured = parseStructuredSummary(rawSummary, job);

                if (structured.alertType && structured.alertTitle) {
                    const alertCard = this.document.createElement('div');
                    alertCard.className = `aicw-tab-summary-card alert-${structured.alertType}`;

                    const icon = this.document.createElement('div');
                    icon.className = 'aicw-tab-card-icon';
                    icon.textContent = structured.alertType === 'warning' ? '⚠️' : '🚨';

                    const alertContent = this.document.createElement('div');
                    alertContent.className = 'aicw-tab-card-content';

                    const alertTitle = this.document.createElement('div');
                    alertTitle.className = 'aicw-tab-card-title';
                    alertTitle.textContent = structured.alertTitle;

                    const alertDesc = this.document.createElement('div');
                    alertDesc.className = 'aicw-tab-card-desc';
                    alertDesc.textContent = structured.alertDesc;

                    alertContent.append(alertTitle, alertDesc);
                    alertCard.append(icon, alertContent);
                    container.append(alertCard);
                }

                if (structured.diagnoses.length > 0) {
                    const diagBlock = this.document.createElement('div');
                    diagBlock.className = 'aicw-tab-summary-block';

                    const blockHeader = this.document.createElement('div');
                    blockHeader.className = 'aicw-tab-block-header';
                    blockHeader.textContent = 'Agent 执行诊断与阶段判定';

                    diagBlock.append(blockHeader);

                    structured.diagnoses.forEach(diagText => {
                        const p = this.document.createElement('p');
                        p.className = 'aicw-tab-agent-text';
                        p.textContent = diagText;
                        diagBlock.append(p);
                    });

                    container.append(diagBlock);
                }

                if (structured.commands.length > 0) {
                    const cmdBlock = this.document.createElement('div');
                    cmdBlock.className = 'aicw-tab-summary-block';

                    const cmdHeader = this.document.createElement('div');
                    cmdHeader.className = 'aicw-tab-block-header';
                    cmdHeader.textContent = '关键执行命令';

                    cmdBlock.append(cmdHeader);

                    structured.commands.forEach(cmdText => {
                        const codeBox = this.document.createElement('div');
                        codeBox.className = 'aicw-tab-code-quote';
                        codeBox.textContent = cmdText;
                        cmdBlock.append(codeBox);
                    });

                    container.append(cmdBlock);
                }

                if (!structured.alertType && structured.diagnoses.length === 0 && structured.commands.length === 0) {
                    const p = this.document.createElement('p');
                    p.className = 'aicw-tab-agent-text';
                    p.textContent = job.state === 'running' ? '正在执行任务阶段门禁与代码分析…' : '无附加阶段摘要';
                    container.append(p);
                }
            } else if (this.traceTab === 'events') {
                const events = job.executionTrace || job.events || job.traceEvents;
                if (Array.isArray(events) && events.length > 0) {
                    const timeline = this.document.createElement('div');
                    timeline.className = 'aicw-tab-event-timeline';
                    events.forEach((ev, idx) => {
                        const item = this.document.createElement('div');
                        item.className = 'aicw-tab-event-item';
                        const head = this.document.createElement('div');
                        head.className = 'aicw-tab-event-head';
                        head.textContent = `#${idx + 1} [${ev.kind || ev.type || 'event'}] ${ev.status || ''}`;
                        const body = this.document.createElement('div');
                        body.className = 'aicw-tab-event-content';
                        body.textContent = ev.text || ev.command || ev.summary || JSON.stringify(ev, null, 2);
                        item.append(head, body);
                        timeline.append(item);
                    });
                    container.append(timeline);
                } else {
                    const traceText = job.traceText;
                    if (traceText) {
                        container.textContent = traceText;
                    } else {
                        container.textContent = `[事件流]\n- 状态更新: ${job.state}\n- 关联进程: PID ${job.pid || 'N/A'}\n- 执行模态: ${job.mode || 'write'}\n- 退出码: ${job.exitCode ?? 'N/A'}`;
                    }
                }
            } else {
                const raw = job.rawTrace || job.output || job.logs || job.rawLog || (job.state === 'running' ? '等待进程输出…' : '无终端输出记录');
                container.textContent = raw;
            }
        }

        _updateElapsedTimes() {
            if (!this._jobsList) return;
            const now = this.now();
            this._cards.forEach((card, jobId) => {
                const job = this.store?.getJob?.(jobId);
                if (job && job.state === 'running') {
                    const elapsedEl = card.querySelector('.aicw-tab-job-card-elapsed');
                    if (elapsedEl) elapsedEl.textContent = formatElapsed(job.startedAt, job.completedAt, now);
                }
            });

            if (this._stageNodes && this.selectedJobId) {
                const currentJob = this.store?.getJob?.(this.selectedJobId);
                if (currentJob && currentJob.state === 'running') {
                    const elapsedStr = formatElapsed(currentJob.startedAt, currentJob.completedAt, now);
                    this._stageNodes.statusPill.textContent = `${KNOWN_STATES[currentJob.state] || currentJob.state}${elapsedStr ? ` (${elapsedStr})` : ''}`;
                }
            }
        }

        dispose() {
            if (this._timerId !== null && typeof this.clearInterval === 'function') {
                this.clearInterval(this._timerId);
                this._timerId = null;
            }
            this._storeDisposers.splice(0).forEach(d => d());
            this._domDisposers.splice(0).forEach(d => d());
            this._cards.clear();
            this._stageNodes = null;
            this._currentStageJobId = null;
            this._pendingQueries.clear();
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