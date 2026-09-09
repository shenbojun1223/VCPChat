// AICodeWorkerStore.js
// 渲染进程侧 AICodeWorker 任务状态的唯一数据 Store。

(function (global) {
    'use strict';

    const ACTION_RESULT_EVENT = 'action-result';
    const MAX_FEEDBACK_TEXT_LENGTH = 240;

    function safeText(value) {
        if (value === null || value === undefined) return null;
        let text;
        if (typeof value === 'string') text = value;
        else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
            text = String(value);
        } else if (typeof value === 'object' && typeof value.message === 'string') {
            text = value.message;
        } else {
            return null;
        }
        return text.length > MAX_FEEDBACK_TEXT_LENGTH
            ? `${text.slice(0, MAX_FEEDBACK_TEXT_LENGTH - 1)}…`
            : text;
    }

    function safeResultSummary(data) {
        const result = data?.result;
        const summary = data?.resultSummary ?? data?.summary ?? data?.message
            ?? (result && typeof result === 'object' ? result.summary ?? result.message ?? result.status : result);
        return safeText(summary);
    }

    function feedbackDetail(data = {}, overrides = {}) {
        return Object.freeze({
            action: safeText(overrides.action ?? data.action),
            jobId: safeText(overrides.jobId ?? data.jobId),
            success: overrides.success ?? data.success === true,
            error: safeText(overrides.error ?? data.error),
            resultSummary: safeResultSummary({ ...data, ...overrides }),
        });
    }

    class AICodeWorkerStore extends EventTarget {
        constructor(chatAPI) {
            super();
            this._chatAPI = chatAPI || global.chatAPI || null;
            this._jobs = new Map();
            this._initialized = false;
            this._unsubscribe = null;
        }

        init() {
            if (this._initialized) return false;
            this._initialized = true;

            const chatAPI = this._chatAPI || global.chatAPI;
            if (!chatAPI || typeof chatAPI.onWorkerPanelMessage !== 'function') {
                console.warn('[WorkerPanel] chatAPI.onWorkerPanelMessage not available; panel events may not arrive.');
                return false;
            }

            const unsubscribe = chatAPI.onWorkerPanelMessage((data) => {
                this.handleMessage(data);
            });
            this._unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;

            // 订阅建立后再补拉一次，消除主进程在渲染器订阅前已收到首个快照的竞态。
            chatAPI.requestWorkerPanelSnapshot?.();
            return true;
        }

        destroy() {
            const unsubscribe = this._unsubscribe;
            this._unsubscribe = null;
            this._initialized = false;
            if (unsubscribe) unsubscribe();
        }

        handleMessage(data) {
            if (!data) return false;

            if (data.type === 'job_status_snapshot') {
                const snapshotJobs = Array.isArray(data.data?.jobs) ? data.data.jobs : [];
                const baseTime = Date.now();
                snapshotJobs.slice().reverse().forEach((job, index) => {
                    this._mergeJob(job, baseTime + index, false);
                });
                this._notifyChange();
                return true;
            }

            if (data.type === 'worker_panel_action_result') {
                const actionData = data.data || {};
                const detail = feedbackDetail(actionData);
                if (actionData.action === 'query' && actionData.success === true && actionData.jobId && actionData.result) {
                    this._mergeJob(Object.assign({ jobId: actionData.jobId }, actionData.result), Date.now(), true);
                }
                this._notifyActionResult(detail);
                if (detail.success === false) {
                    console.warn('[WorkerPanel] Action failed:', detail.error || 'unknown error');
                }
                return true;
            }

            if (data.type !== 'job_status_update') return false;
            const changed = this._mergeJob(data.data, Date.now(), false);
            this._notifyChange();
            return changed;
        }

        cancelWorkerJob(jobId) {
            const chatAPI = this._chatAPI || global.chatAPI;
            if (!jobId || !chatAPI || typeof chatAPI.cancelWorkerJob !== 'function') return false;
            let result;
            try {
                result = chatAPI.cancelWorkerJob(jobId);
            } catch (error) {
                this._notifyActionResult(feedbackDetail({}, {
                    action: 'cancel',
                    jobId,
                    success: false,
                    error,
                }));
                return false;
            }
            if (result && typeof result.then === 'function') {
                void Promise.resolve(result).then(
                    () => undefined,
                    error => {
                        this._notifyActionResult(feedbackDetail({}, {
                            action: 'cancel',
                            jobId,
                            success: false,
                            error,
                        }));
                    }
                );
            }
            return true;
        }

        fetchJobDetail(jobId, traceMode = 'summary') {
            const chatAPI = this._chatAPI || global.chatAPI;
            if (!jobId || !chatAPI || typeof chatAPI.queryWorkerJob !== 'function') return false;
            let result;
            try {
                result = chatAPI.queryWorkerJob(jobId, traceMode);
            } catch (error) {
                this._notifyActionResult(feedbackDetail({}, {
                    action: 'query',
                    jobId,
                    success: false,
                    error,
                }));
                return false;
            }
            if (result && typeof result.then === 'function') {
                void Promise.resolve(result).then(
                    () => undefined,
                    error => {
                        this._notifyActionResult(feedbackDetail({}, {
                            action: 'query',
                            jobId,
                            success: false,
                            error,
                        }));
                    }
                );
            }
            return true;
        }

        _notifyActionResult(detail) {
            const EventConstructor = global.CustomEvent || global.Event;
            if (typeof EventConstructor !== 'function') return;
            let event;
            if (global.CustomEvent && EventConstructor === global.CustomEvent) {
                event = new EventConstructor(ACTION_RESULT_EVENT, { detail });
            } else {
                event = new EventConstructor(ACTION_RESULT_EVENT);
                Object.defineProperty(event, 'detail', { value: detail, enumerable: true });
            }
            this.dispatchEvent(event);
        }

        getJobs() {
            return Array.from(this._jobs.values())
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .map(job => Object.assign({}, job));
        }

        getJob(jobId) {
            const job = this._jobs.get(jobId);
            return job ? Object.assign({}, job) : null;
        }

        _mergeJob(job, updatedAt = Date.now(), notify = true) {
            if (!job || !job.jobId) return false;
            const existing = this._jobs.get(job.jobId) || {};
            this._jobs.set(job.jobId, Object.assign({}, existing, job, { updatedAt }));

            // 保留最近 20 条，按更新时间倒序。
            if (this._jobs.size > 20) {
                const oldest = Array.from(this._jobs.entries())
                    .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))[0];
                if (oldest) this._jobs.delete(oldest[0]);
            }

            if (notify) this._notifyChange();
            return true;
        }

        _notifyChange() {
            this.dispatchEvent(new Event('change'));
        }
    }

    global.AICodeWorkerStore = AICodeWorkerStore;
    global.AICodeWorkerStoreActionResultEvent = ACTION_RESULT_EVENT;
    if (!global.aicodeWorkerStore) {
        global.aicodeWorkerStore = new AICodeWorkerStore(global.chatAPI);
    }
})(window);
