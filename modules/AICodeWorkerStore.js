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

    function areArrayShallowEqual(a, b) {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    function areObjectsEqual(a, b) {
        if (a === b) return true;
        if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    /**
     * 解析任务的稳定时间戳，确保任务列表排序恒定，不因后台心跳或查询更新产生上蹿下跳。
     */
    function getJobSortTime(job) {
        if (!job) return 0;
        if (job.startedAt) {
            const t = new Date(job.startedAt).getTime();
            if (Number.isFinite(t) && t > 0) return t;
        }
        if (job.createdAt) {
            const t = new Date(job.createdAt).getTime();
            if (Number.isFinite(t) && t > 0) return t;
        }
        if (typeof job.jobId === 'string') {
            // 支持提取形如 job_20260909_154736_xxx 或 20260909_154736 时间戳
            const match = job.jobId.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
            if (match) {
                const year = Number(match[1]);
                const month = Number(match[2]) - 1;
                const day = Number(match[3]);
                const hour = Number(match[4]);
                const min = Number(match[5]);
                const sec = Number(match[6]);
                const parsed = new Date(year, month, day, hour, min, sec).getTime();
                if (Number.isFinite(parsed) && parsed > 0) return parsed;
            }
        }
        return job.firstSeenAt || 0;
    }

    class AICodeWorkerStore extends EventTarget {
        constructor(chatAPI) {
            super();
            this._chatAPI = chatAPI || global.chatAPI || null;
            this._jobs = new Map();
            this._initialized = false;
            this._unsubscribe = null;
            // 记录在途的详情请求: Map<`${jobId}:${traceMode}`, timestamp>
            this._inFlightQueries = new Map();
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
                if (actionData.action === 'query' && actionData.jobId) {
                    // 无论成功与否，解除所有匹配该任务的在途锁（涵盖不同 traceMode）
                    const prefix = `${actionData.jobId}:`;
                    for (const key of this._inFlightQueries.keys()) {
                        if (key.startsWith(prefix)) {
                            this._inFlightQueries.delete(key);
                        }
                    }
                    if (actionData.success === true && actionData.result) {
                        this._mergeJob(Object.assign({ jobId: actionData.jobId }, actionData.result), Date.now(), true);
                    }
                }
                this._notifyActionResult(detail);
                if (detail.success === false) {
                    console.warn('[WorkerPanel] Action failed:', detail.error || 'unknown error');
                }
                return true;
            }

            if (data.type !== 'job_status_update') return false;
            const changed = this._mergeJob(data.data, Date.now(), true);
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

            const queryKey = `${jobId}:${traceMode}`;
            const now = Date.now();
            const inFlightSince = this._inFlightQueries.get(queryKey);
            // 30 秒内相同的在途请求直接阻断，防止重复入队与网络风暴
            if (inFlightSince && (now - inFlightSince < 30000)) {
                return false;
            }
            this._inFlightQueries.set(queryKey, now);

            let result;
            try {
                result = chatAPI.queryWorkerJob(jobId, traceMode);
            } catch (error) {
                this._inFlightQueries.delete(queryKey);
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
                        this._inFlightQueries.delete(queryKey);
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

        /**
         * 任务列表按稳定创建/启动时间倒序排列（新任务在前，但一旦排定绝不因后续数据更新而颠簸跳位）
         */
        getJobs() {
            return Array.from(this._jobs.values())
                .sort((a, b) => {
                    const timeA = getJobSortTime(a);
                    const timeB = getJobSortTime(b);
                    if (timeB !== timeA) return timeB - timeA;
                    return String(b.jobId).localeCompare(String(a.jobId));
                })
                .map(job => Object.assign({}, job));
        }

        getJob(jobId) {
            const job = this._jobs.get(jobId);
            return job ? Object.assign({}, job) : null;
        }

        _mergeJob(job, updatedAt = Date.now(), notify = true) {
            if (!job || !job.jobId) return false;
            const existing = this._jobs.get(job.jobId) || {};
            const firstSeenAt = existing.firstSeenAt || updatedAt;

            // 脏检查：对比关键业务字段，采用值与结构深比对，阻断引用变化产生的伪脏广播
            let isSubstantiveChange = !existing.jobId;
            if (!isSubstantiveChange) {
                if (job.state !== undefined && existing.state !== job.state) isSubstantiveChange = true;
                else if (job.exitCode !== undefined && existing.exitCode !== job.exitCode) isSubstantiveChange = true;
                else if (job.summary !== undefined && existing.summary !== job.summary) isSubstantiveChange = true;
                else if (job.output !== undefined && existing.output !== job.output) isSubstantiveChange = true;
                else if (job.rawTrace !== undefined && existing.rawTrace !== job.rawTrace) isSubstantiveChange = true;
                else if (job.completedAt !== undefined && existing.completedAt !== job.completedAt) isSubstantiveChange = true;
                else if (job.pid !== undefined && existing.pid !== job.pid) isSubstantiveChange = true;
                else if (job.candidateAvailable !== undefined && existing.candidateAvailable !== job.candidateAvailable) isSubstantiveChange = true;
                else if (job.resultCommit !== undefined && existing.resultCommit !== job.resultCommit) isSubstantiveChange = true;
                else if (Array.isArray(job.changedFiles) && !areArrayShallowEqual(job.changedFiles, existing.changedFiles)) isSubstantiveChange = true;
                else if (Array.isArray(job.executionTrace) && !areArrayShallowEqual(job.executionTrace, existing.executionTrace)) isSubstantiveChange = true;
                else if (job.validation && !areObjectsEqual(job.validation, existing.validation)) isSubstantiveChange = true;
            }

            this._jobs.set(job.jobId, Object.assign({}, existing, job, {
                firstSeenAt,
                updatedAt,
            }));

            // 保留最近 20 条任务
            if (this._jobs.size > 20) {
                const oldest = Array.from(this._jobs.entries())
                    .sort((a, b) => getJobSortTime(a[1]) - getJobSortTime(b[1]))[0];
                if (oldest) this._jobs.delete(oldest[0]);
            }

            if (notify && isSubstantiveChange) {
                this._notifyChange();
            }
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
})(typeof window !== 'undefined' ? window : globalThis);