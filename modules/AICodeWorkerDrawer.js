/* AICodeWorker companion-task drawer. */
(function installAICodeWorkerDrawer(globalObject, factory) {
    const AICodeWorkerDrawer = factory(globalObject);
    if (typeof module === 'object' && module.exports) module.exports = AICodeWorkerDrawer;
    if (globalObject) globalObject.AICodeWorkerDrawer = AICodeWorkerDrawer;
})(typeof window !== 'undefined' ? window : globalThis, function createAICodeWorkerDrawer(globalObject) {
    'use strict';

    const ACTION_RESULT_EVENT = 'action-result';
    const CANCEL_CONFIRMATION_TIMEOUT = 5000;
    const TIMER_INTERVAL = 5000;
    const KNOWN_STATES = Object.freeze({
        running: Object.freeze({ label: '运行中', className: 'running' }),
        completed: Object.freeze({ label: '已完成', className: 'completed' }),
        failed: Object.freeze({ label: '失败', className: 'failed' }),
        cancelled: Object.freeze({ label: '已取消', className: 'cancelled' }),
        timeout: Object.freeze({ label: '超时', className: 'timeout' }),
    });

    function safeString(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        try {
            return String(value);
        } catch (error) {
            return fallback;
        }
    }

    function hasValue(value) {
        return value !== null && value !== undefined && value !== '';
    }

    function appendChildren(parent, ...children) {
        children.filter(Boolean).forEach(child => {
            if (typeof parent.append === 'function') parent.append(child);
            else parent.appendChild(child);
        });
    }

    function removeNode(node) {
        if (!node) return;
        if (typeof node.remove === 'function') node.remove();
        else node.parentNode?.removeChild?.(node);
    }

    function setText(element, value) {
        if (element) element.textContent = safeString(value);
    }

    function getState(job) {
        const rawState = hasValue(job?.state) ? safeString(job.state, '未知状态') : '未知状态';
        const known = Object.prototype.hasOwnProperty.call(KNOWN_STATES, rawState)
            ? KNOWN_STATES[rawState]
            : null;
        return known
            ? { raw: rawState, label: known.label, className: known.className }
            : { raw: rawState, label: rawState, className: 'unknown' };
    }

    function formatElapsed(startedAt, completedAt, now) {
        if (!hasValue(startedAt)) return '';
        const start = new Date(startedAt).getTime();
        if (!Number.isFinite(start)) return '';
        const end = hasValue(completedAt) ? new Date(completedAt).getTime() : now;
        if (!Number.isFinite(end)) return '';
        const seconds = Math.max(0, Math.floor((end - start) / 1000));
        if (seconds < 60) return `${seconds}s`;
        return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
    }

    function createField(document, key, label) {
        const row = document.createElement('div');
        row.className = 'aicw-worker-drawer-detail-row';
        const name = document.createElement('span');
        name.className = 'aicw-worker-drawer-detail-label';
        name.textContent = label;
        const value = document.createElement('span');
        value.className = 'aicw-worker-drawer-detail-value';
        row.dataset.field = key;
        appendChildren(row, name, value);
        return { row, value };
    }

    class AICodeWorkerDrawer {
        constructor(options = {}) {
            this.document = options.document || globalObject.document;
            this.store = options.store || null;
            this.escapeDispatcher = options.escapeDispatcher || null;
            this.overlayCoordinator = options.overlayCoordinator || null;
            this.acquireOverlay = options.acquireOverlay
                || (this.overlayCoordinator ? owner => this.overlayCoordinator.acquire(owner) : owner => Promise.resolve(owner));
            this.releaseOverlay = options.releaseOverlay
                || (this.overlayCoordinator ? owner => this.overlayCoordinator.release(owner) : () => false);
            this.host = options.host || null;
            this.now = options.now || (() => (globalObject.Date || Date).now());
            this.setInterval = options.setInterval || globalObject.setInterval?.bind(globalObject);
            this.clearInterval = options.clearInterval || globalObject.clearInterval?.bind(globalObject);
            this.setTimeout = options.setTimeout || globalObject.setTimeout?.bind(globalObject);
            this.clearTimeout = options.clearTimeout || globalObject.clearTimeout?.bind(globalObject);
            this.warn = options.warn || ((...args) => console.warn(...args));
            this.cancelConfirmationTimeout = Number.isFinite(options.cancelConfirmationTimeout)
                ? options.cancelConfirmationTimeout
                : CANCEL_CONFIRMATION_TIMEOUT;
            this.timerInterval = Number.isFinite(options.timerInterval)
                ? options.timerInterval
                : TIMER_INTERVAL;

            this._mounted = false;
            this._destroyed = false;
            this._state = 'idle';
            this._generation = 0;
            this._attempt = null;
            this._activeAttempt = null;
            this._element = null;
            this._trigger = null;
            this._closeButton = null;
            this._list = null;
            this._runningCount = null;
            this._drawerStatus = null;
            this._openError = null;
            this._cardSequence = 0;
            this._cards = new Map();
            this._notices = new Map();
            this._pendingCancels = new Map();
            this._ambiguousCancels = new Set();
            this._domDisposers = [];
            this._storeDisposers = [];
            this._escapeDisposer = null;
            this._timerId = null;
        }

        get element() {
            return this._element;
        }

        get mounted() {
            return this._mounted;
        }

        get isOpen() {
            return this._state === 'visible' || this._state === 'opening';
        }

        mount(scope = null) {
            if (this._mounted) return true;
            if (this._destroyed || !this.document?.createElement) return false;
            const host = this.host || this.document.getElementById?.('nextUiChatWorkerDrawerHost');
            if (!host || (typeof host.append !== 'function' && typeof host.appendChild !== 'function')) {
                this.warn('[AICodeWorkerDrawer] Host element not found; drawer disabled.');
                return false;
            }

            try {
                this.host = host;
                this._createDom();
                this._bindStore();
                this._bindEscape();
                this._mounted = true;
                this.update();
                if (typeof this.setInterval === 'function') {
                    this._timerId = this.setInterval(() => this._updateRunningElapsed(), this.timerInterval);
                }
                return true;
            } catch (error) {
                this.warn('[AICodeWorkerDrawer] Failed to mount drawer:', error);
                this._cleanupDomAndSubscriptions();
                return false;
            }
        }

        _createDom() {
            const document = this.document;
            const trigger = document.createElement('button');
            trigger.id = 'aicwWorkerDrawerToggle';
            trigger.type = 'button';
            trigger.className = 'aicw-worker-drawer-trigger aicw-worker-drawer-scope';
            trigger.setAttribute('aria-controls', 'aicwWorkerDrawer');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.setAttribute('aria-label', '伴随任务，运行中 0 个');
            trigger.title = '查看 AICodeWorker 伴随任务';

            const triggerIcon = document.createElement('span');
            triggerIcon.className = 'aicw-worker-drawer-trigger-icon';
            triggerIcon.setAttribute('aria-hidden', 'true');
            triggerIcon.textContent = '◌';
            const count = document.createElement('span');
            count.className = 'aicw-worker-drawer-running-count';
            count.textContent = '0';
            appendChildren(trigger, triggerIcon, count);

            const drawer = document.createElement('aside');
            drawer.id = 'aicwWorkerDrawer';
            drawer.className = 'aicw-worker-drawer aicw-worker-drawer-scope';
            drawer.hidden = true;
            drawer.setAttribute('aria-hidden', 'true');
            drawer.setAttribute('aria-label', 'AICodeWorker 伴随任务');

            const header = document.createElement('header');
            header.className = 'aicw-worker-drawer-header';
            const heading = document.createElement('h2');
            heading.className = 'aicw-worker-drawer-title';
            heading.textContent = '伴随任务';
            const runningSummary = document.createElement('span');
            runningSummary.className = 'aicw-worker-drawer-running-summary';
            runningSummary.textContent = '运行中 0 个';
            const closeButton = document.createElement('button');
            closeButton.id = 'aicwWorkerDrawerClose';
            closeButton.type = 'button';
            closeButton.className = 'aicw-worker-drawer-close';
            closeButton.setAttribute('aria-label', '关闭伴随任务');
            closeButton.title = '关闭';
            closeButton.textContent = '×';
            appendChildren(header, heading, runningSummary, closeButton);

            const status = document.createElement('div');
            status.className = 'aicw-worker-drawer-status';
            status.hidden = true;
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');

            const list = document.createElement('div');
            list.className = 'aicw-worker-drawer-list';
            list.setAttribute('role', 'list');

            appendChildren(drawer, header, status, list);
            appendChildren(this.host, trigger);
            const parent = this.document.body || this.host;
            appendChildren(parent, drawer);

            this._element = drawer;
            this._trigger = trigger;
            this._closeButton = closeButton;
            this._list = list;
            this._runningCount = { count, summary: runningSummary };
            this._drawerStatus = status;

            this._listenDom(trigger, 'click', () => { void this.open(); });
            this._listenDom(closeButton, 'click', () => this.close());
        }

        _listenDom(target, type, listener, options) {
            target.addEventListener(type, listener, options);
            this._domDisposers.push(() => target.removeEventListener?.(type, listener, options));
        }

        _bindStore() {
            if (!this.store || typeof this.store.addEventListener !== 'function') return;
            const onChange = () => this.update();
            const onActionResult = event => this._handleActionResult(event?.detail || {});
            this.store.addEventListener('change', onChange);
            this.store.addEventListener(globalObject.AICodeWorkerStoreActionResultEvent || ACTION_RESULT_EVENT, onActionResult);
            this._storeDisposers.push(() => this.store.removeEventListener?.('change', onChange));
            this._storeDisposers.push(() => this.store.removeEventListener?.(
                globalObject.AICodeWorkerStoreActionResultEvent || ACTION_RESULT_EVENT,
                onActionResult
            ));
        }

        _bindEscape() {
            if (!this.escapeDispatcher || typeof this.escapeDispatcher.register !== 'function') return;
            this._escapeDisposer = this.escapeDispatcher.register({
                priority: 10,
                isActive: () => this.isOpen && !this._hasBlockingModal(),
                close: () => {
                    this.close();
                    return true;
                },
            });
        }

        _hasBlockingModal() {
            return Boolean(this.document?.querySelector?.(
                '.vcp-ui-modal-overlay, wa-dialog[open], .confirm-dialog-overlay.visible, .modal.active'
            ));
        }

        update(jobs) {
            if (!this._mounted || !this._list) return this;
            const focused = this._captureDrawerFocus();
            let nextJobs = jobs;
            if (!Array.isArray(nextJobs)) {
                try {
                    nextJobs = this.store?.getJobs?.() || [];
                } catch (error) {
                    this.warn('[AICodeWorkerDrawer] Failed to read jobs:', error);
                    nextJobs = [];
                }
            }
            if (!Array.isArray(nextJobs)) nextJobs = [];

            const validJobs = nextJobs.filter(job => hasValue(job?.jobId));
            const liveIds = new Set(validJobs.map(job => safeString(job.jobId)));
            for (const [jobId, card] of this._cards) {
                if (!liveIds.has(jobId)) {
                    card.disposers?.forEach(dispose => dispose());
                    removeNode(card.node);
                    this._cards.delete(jobId);
                }
            }

            let running = 0;
            if (validJobs.length > 0) removeNode(this._empty);
            validJobs.forEach((job, index) => {
                const jobId = safeString(job.jobId);
                if (job.state === 'running') running += 1;
                let card = this._cards.get(jobId);
                if (!card) {
                    card = this._createCard(jobId);
                    this._cards.set(jobId, card);
                }
                this._updateCard(card, job);
                this._placeCard(card.node, index);
            });

            if (validJobs.length === 0) {
                if (!this._empty) {
                    this._empty = this.document.createElement('p');
                    this._empty.className = 'aicw-worker-drawer-empty';
                    this._empty.textContent = '暂无任务记录';
                }
                appendChildren(this._list, this._empty);
            }

            this._restoreDrawerFocus(focused);
            this._setRunningCount(running);
            return this;
        }

        _contains(root, node) {
            if (!root || !node) return false;
            if (typeof root.contains === 'function') return root.contains(node);
            let current = node;
            while (current) {
                if (current === root) return true;
                current = current.parentNode;
            }
            return false;
        }

        _captureDrawerFocus() {
            const active = this.document?.activeElement;
            return this._contains(this._element, active) ? active : null;
        }

        _restoreDrawerFocus(focused) {
            if (!focused || this.document?.activeElement === focused) return;
            if (!this._contains(this._element, focused) || typeof focused.focus !== 'function') return;
            try {
                focused.focus({ preventScroll: true });
            } catch (error) {
                try {
                    focused.focus();
                } catch (fallbackError) {
                    // Focus restoration is best effort when a host element rejects focus.
                }
            }
        }

        _placeCard(node, index) {
            const current = this._list?.children?.[index] || null;
            if (current === node) return;
            if (typeof this._list?.insertBefore === 'function') this._list.insertBefore(node, current);
            else appendChildren(this._list, node);
        }

        _setRunningCount(running) {
            const count = Math.max(0, Number(running) || 0);
            setText(this._runningCount?.count, count);
            setText(this._runningCount?.summary, `运行中 ${count} 个`);
            if (!this._trigger) return;
            this._trigger.dataset.running = count > 0 ? 'true' : 'false';
            this._trigger.setAttribute('aria-label', `伴随任务，运行中 ${count} 个`);
        }

        _createCard(jobId) {
            const document = this.document;
            const article = document.createElement('article');
            article.className = 'aicw-worker-drawer-card aicw-state-unknown';
            article.dataset.jobid = jobId;
            article.setAttribute('role', 'listitem');

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'aicw-worker-drawer-card-toggle';
            toggle.setAttribute('aria-expanded', 'false');

            const stateDot = document.createElement('span');
            stateDot.className = 'aicw-worker-drawer-state-dot';
            stateDot.setAttribute('aria-hidden', 'true');
            const jobLabel = document.createElement('span');
            jobLabel.className = 'aicw-worker-drawer-job-id';
            const workerInfo = document.createElement('span');
            workerInfo.className = 'aicw-worker-drawer-worker-info';
            const stateLabel = document.createElement('span');
            stateLabel.className = 'aicw-worker-drawer-state-label';
            const elapsed = document.createElement('span');
            elapsed.className = 'aicw-worker-drawer-elapsed';
            appendChildren(toggle, stateDot, jobLabel, workerInfo, stateLabel, elapsed);

            const details = document.createElement('div');
            details.className = 'aicw-worker-drawer-details';
            details.hidden = true;
            details.id = `aicwWorkerDetail${this._cardSequence += 1}`;
            toggle.setAttribute('aria-controls', details.id);

            const cardHeader = document.createElement('div');
            cardHeader.className = 'aicw-worker-drawer-card-header';

            const notice = document.createElement('p');
            notice.className = 'aicw-worker-drawer-card-notice';
            notice.hidden = true;

            const card = {
                node: article,
                header: cardHeader,
                toggle,
                details,
                notice,
                jobLabel,
                workerInfo,
                stateLabel,
                elapsed,
                cancelButton: null,
                detailFields: new Map(),
                disposers: [],
                job: null,
            };

            const toggleCard = () => {
                const expanded = !details.hidden;
                details.hidden = expanded;
                toggle.setAttribute('aria-expanded', String(!expanded));
            };
            this._listenCard(card, toggle, 'click', toggleCard);
            appendChildren(cardHeader, toggle);
            appendChildren(article, cardHeader, details, notice);
            return card;
        }

        _listenCard(card, target, type, listener, options) {
            target.addEventListener(type, listener, options);
            card.disposers.push(() => target.removeEventListener?.(type, listener, options));
        }

        _updateCard(card, job) {
            card.job = job;
            const state = getState(job);
            card.node.className = `aicw-worker-drawer-card aicw-state-${state.className}`;
            card.node.dataset.state = state.raw;

            const fullJobId = safeString(job.jobId);
            const shortJobId = fullJobId.length > 8 ? fullJobId.slice(-8) : fullJobId;
            setText(card.jobLabel, `#${shortJobId || '?'}`);
            card.jobLabel.title = fullJobId;
            setText(card.workerInfo, [job.worker, job.mode].filter(hasValue).map(value => safeString(value)).join(' / '));
            setText(card.stateLabel, state.label);
            setText(card.elapsed, formatElapsed(job.startedAt, job.completedAt, this.now()));
            card.toggle.setAttribute('aria-label', `${fullJobId || '任务'}，${state.label}`);

            if (state.raw !== 'running') {
                this._finishPendingCancel(fullJobId, true);
                this._ambiguousCancels.delete(fullJobId);
            }
            this._updateDetails(card, job);
            this._updateCancelButton(card, state.raw, fullJobId);
            this._updateNotice(card, fullJobId);
        }

        _updateDetails(card, job) {
            const fields = [
                ['projectPath', '路径'],
                ['pid', 'PID'],
                ['exitCode', '退出码'],
                ['exitReason', '原因'],
                ['startedAt', '开始时间'],
                ['completedAt', '完成时间'],
            ];
            const present = new Set();
            fields.forEach(([key, label]) => {
                if (!hasValue(job?.[key])) return;
                present.add(key);
                let field = card.detailFields.get(key);
                if (!field) {
                    field = createField(this.document, key, label);
                    card.detailFields.set(key, field);
                    appendChildren(card.details, field.row);
                }
                setText(field.value, job[key]);
            });
            for (const [key, field] of card.detailFields) {
                if (present.has(key)) continue;
                removeNode(field.row);
                card.detailFields.delete(key);
            }
        }

        _updateCancelButton(card, state, jobId) {
            if (state === 'running') {
                if (!card.cancelButton) {
                    const button = this.document.createElement('button');
                    button.type = 'button';
                    button.className = 'aicw-worker-drawer-cancel';
                    button.textContent = '取消';
                    button.setAttribute('aria-label', `请求取消任务 ${jobId}`);
                    card.cancelButton = button;
                    this._listenCard(card, button, 'click', event => {
                        event.stopPropagation?.();
                        this._requestCancel(jobId);
                    });
                    appendChildren(card.header, button);
                }
                const pending = this._pendingCancels.get(jobId);
                card.cancelButton.disabled = Boolean(pending?.waiting);
                card.cancelButton.setAttribute('aria-disabled', String(Boolean(pending?.waiting)));
                return;
            }
            if (card.cancelButton) {
                removeNode(card.cancelButton);
                card.cancelButton = null;
            }
        }

        _updateNotice(card, jobId) {
            const notice = this._notices.get(jobId);
            card.notice.hidden = !notice;
            setText(card.notice, notice?.text || '');
            if (notice?.variant) card.notice.dataset.variant = notice.variant;
            else delete card.notice.dataset.variant;
        }

        _setNotice(jobId, text, variant = 'info') {
            if (!jobId) return;
            this._notices.set(jobId, { text: safeString(text), variant });
            const card = this._cards.get(jobId);
            if (card) this._updateNotice(card, jobId);
        }

        _setGlobalStatus(text, variant = 'error') {
            if (!this._drawerStatus) return;
            this._drawerStatus.hidden = !text;
            this._drawerStatus.dataset.variant = variant;
            setText(this._drawerStatus, text || '');
        }

        _requestCancel(jobId) {
            if (!jobId || this._pendingCancels.get(jobId)?.waiting) return false;
            const pending = { waiting: true, timerId: null };
            this._pendingCancels.set(jobId, pending);
            this._setNotice(jobId, '已请求，等待确认', 'pending');
            this._cards.get(jobId) && this._updateCard(this._cards.get(jobId), this._cards.get(jobId).job);

            let result;
            try {
                result = this.store?.cancelWorkerJob?.(jobId) || false;
            } catch (error) {
                this._failCancel(jobId, '取消请求发送失败');
                return false;
            }
            if (!result) {
                this._failCancel(jobId, '取消请求发送失败');
                return false;
            }
            if (result && typeof result.then === 'function') {
                void Promise.resolve(result).then(
                    () => undefined,
                    () => {
                        if (this._pendingCancels.get(jobId) === pending) this._failCancel(jobId, '取消请求发送失败');
                    }
                );
            }
            if (typeof this.setTimeout === 'function') {
                pending.timerId = this.setTimeout(() => {
                    if (this._pendingCancels.get(jobId) !== pending) return;
                    pending.waiting = false;
                    this._pendingCancels.delete(jobId);
                    this._ambiguousCancels.add(jobId);
                    this._setNotice(jobId, '未确认；任务状态仍由实际更新决定', 'warning');
                    const card = this._cards.get(jobId);
                    if (card) this._updateCard(card, card.job);
                }, this.cancelConfirmationTimeout);
            }
            return true;
        }

        _failCancel(jobId, message) {
            this._finishPendingCancel(jobId, true);
            this._setNotice(jobId, message, 'error');
            const card = this._cards.get(jobId);
            if (card) this._updateCard(card, card.job);
        }

        _finishPendingCancel(jobId, clearNotice) {
            const pending = this._pendingCancels.get(jobId);
            if (!pending) return;
            if (pending.timerId !== null && typeof this.clearTimeout === 'function') this.clearTimeout(pending.timerId);
            this._pendingCancels.delete(jobId);
            if (clearNotice) this._notices.delete(jobId);
        }

        _handleActionResult(detail) {
            if (!detail || (detail.action && detail.action !== 'cancel')) return;
            const jobId = hasValue(detail.jobId) ? safeString(detail.jobId) : '';
            const pending = jobId ? this._pendingCancels.get(jobId) : null;
            if (detail.success === false) {
                const error = hasValue(detail.error) ? safeString(detail.error) : '未提供原因';
                if (this._ambiguousCancels.has(jobId)) {
                    this._setNotice(jobId, `收到取消操作失败反馈（无法关联具体请求）：${error}`, 'error');
                    const card = this._cards.get(jobId);
                    if (card) this._updateCard(card, card.job);
                    return;
                }
                if (pending) {
                    this._finishPendingCancel(jobId, false);
                    this._setNotice(jobId, `收到取消操作失败反馈：${error}`, 'error');
                    const card = this._cards.get(jobId);
                    if (card) this._updateCard(card, card.job);
                } else if (jobId) {
                    this._setNotice(jobId, `收到取消操作失败反馈（无法关联具体请求）：${error}`, 'error');
                } else {
                    this._setGlobalStatus(`收到取消操作失败反馈：${error}`);
                }
                return;
            }
            if (detail.success !== true) return;
            if (this._ambiguousCancels.has(jobId)) {
                this._setNotice(jobId, '收到取消回执，无法关联具体请求', 'warning');
                const card = this._cards.get(jobId);
                if (card) this._updateCard(card, card.job);
                return;
            }
            if (pending) {
                pending.feedback = 'returned';
                this._setNotice(jobId, '请求已返回，等待任务状态确认', 'pending');
            } else if (jobId) {
                this._setNotice(jobId, '收到取消回执，无法关联具体请求', 'warning');
            } else {
                this._setGlobalStatus('收到取消回执，无法关联具体请求', 'warning');
            }
        }

        _updateRunningElapsed() {
            if (!this._mounted) return;
            for (const card of this._cards.values()) {
                if (card.job?.state !== 'running') continue;
                setText(card.elapsed, formatElapsed(card.job.startedAt, card.job.completedAt, this.now()));
            }
        }

        open() {
            if (!this._mounted || this._destroyed) return Promise.resolve(false);
            if (this._state === 'visible') return Promise.resolve(true);
            if (this._state === 'opening' && this._attempt?.promise) return this._attempt.promise;

            const attempt = {
                owner: Symbol(`aicw-drawer:${this._generation + 1}`),
                generation: ++this._generation,
                cancelled: false,
                released: false,
                acquired: false,
                promise: null,
            };
            this._attempt = attempt;
            this._state = 'opening';
            this._clearOpenError();

            let acquireResult;
            try {
                acquireResult = this.acquireOverlay(attempt.owner);
            } catch (error) {
                acquireResult = Promise.reject(error);
            }
            attempt.promise = Promise.resolve(acquireResult).then(
                () => {
                    if (!this._isCurrentAttempt(attempt)) {
                        this._releaseAttempt(attempt);
                        return false;
                    }
                    try {
                        attempt.acquired = true;
                        this._state = 'visible';
                        this._activeAttempt = attempt;
                        this._attempt = null;
                        this._element.hidden = false;
                        this._element.setAttribute('aria-hidden', 'false');
                        this._element.dataset.open = 'true';
                        this._trigger.setAttribute('aria-expanded', 'true');
                        this.update();
                        return true;
                    } catch (error) {
                        this._releaseAttempt(attempt);
                        if (this._isCurrentAttempt(attempt)) this._handleOpenFailure(attempt);
                        return false;
                    }
                },
                () => {
                    this._releaseAttempt(attempt);
                    if (this._isCurrentAttempt(attempt)) this._handleOpenFailure(attempt);
                    return false;
                }
            );
            return attempt.promise;
        }

        _isCurrentAttempt(attempt) {
            return !this._destroyed
                && (this._attempt === attempt || this._activeAttempt === attempt)
                && attempt.generation === this._generation
                && !attempt.cancelled;
        }

        _handleOpenFailure(attempt) {
            if (!this._isCurrentAttempt(attempt)) return;
            if (this._attempt === attempt) this._attempt = null;
            if (this._activeAttempt === attempt) this._activeAttempt = null;
            this._state = 'idle';
            this._setClosedDom();
            this._setOpenError('任务抽屉打开失败，请点击入口重试。');
        }

        _setOpenError(message) {
            this._openError = safeString(message);
            if (this._drawerStatus) {
                this._drawerStatus.hidden = false;
                this._drawerStatus.dataset.variant = 'error';
                setText(this._drawerStatus, this._openError);
            }
            if (this._trigger) {
                this._trigger.dataset.openError = 'true';
                this._trigger.setAttribute('aria-label', '伴随任务，打开失败，点击重试');
            }
        }

        _clearOpenError() {
            this._openError = null;
            if (this._drawerStatus && !this._drawerStatus.dataset.feedback) this._drawerStatus.hidden = true;
            if (this._trigger) {
                delete this._trigger.dataset.openError;
                this._trigger.setAttribute('aria-label', `伴随任务，运行中 ${this._runningCount?.count?.textContent || 0} 个`);
            }
        }

        _releaseAttempt(attempt) {
            if (!attempt || attempt.released) return;
            attempt.released = true;
            try {
                const releaseResult = this.releaseOverlay(attempt.owner);
                if (releaseResult && typeof releaseResult.then === 'function') {
                    void Promise.resolve(releaseResult).catch(error => this.warn('[AICodeWorkerDrawer] Overlay release failed:', error));
                }
            } catch (error) {
                this.warn('[AICodeWorkerDrawer] Overlay release failed:', error);
            }
        }

        _setClosedDom() {
            if (!this._element) return;
            this._element.hidden = true;
            this._element.setAttribute('aria-hidden', 'true');
            delete this._element.dataset.open;
            this._trigger?.setAttribute('aria-expanded', 'false');
        }

        close(options = {}) {
            if (!this._mounted) return false;
            const wasActive = this._state !== 'idle' || Boolean(this._attempt || this._activeAttempt);
            const attempt = this._attempt;
            const activeAttempt = this._activeAttempt;
            this._generation += 1;
            this._state = 'idle';
            this._attempt = null;
            this._activeAttempt = null;
            if (attempt) {
                attempt.cancelled = true;
                this._releaseAttempt(attempt);
            }
            if (activeAttempt) {
                activeAttempt.cancelled = true;
                this._releaseAttempt(activeAttempt);
            }
            this._setClosedDom();
            if (options.restoreFocus !== false && wasActive) this.focus();
            return wasActive;
        }

        focus() {
            if (!this._trigger || typeof this._trigger.focus !== 'function') return false;
            this._trigger.focus();
            return true;
        }

        _cleanupDomAndSubscriptions() {
            if (this._timerId !== null && typeof this.clearInterval === 'function') this.clearInterval(this._timerId);
            this._timerId = null;
            this._domDisposers.splice(0).reverse().forEach(dispose => dispose());
            this._storeDisposers.splice(0).reverse().forEach(dispose => dispose());
            this._escapeDisposer?.();
            this._escapeDisposer = null;
            for (const pending of this._pendingCancels.values()) {
                if (pending.timerId !== null && typeof this.clearTimeout === 'function') this.clearTimeout(pending.timerId);
            }
            this._pendingCancels.clear();
            this._ambiguousCancels.clear();
            for (const card of this._cards.values()) card.disposers?.forEach(dispose => dispose());
            this._cards.clear();
            removeNode(this._element);
            removeNode(this._trigger);
            this._element = null;
            this._trigger = null;
            this._closeButton = null;
            this._list = null;
            this._runningCount = null;
            this._drawerStatus = null;
            this._empty = null;
        }

        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;
            this.close({ restoreFocus: false });
            this._mounted = false;
            this._cleanupDomAndSubscriptions();
            this._notices.clear();
            this._state = 'idle';
        }
    }

    return AICodeWorkerDrawer;
});
