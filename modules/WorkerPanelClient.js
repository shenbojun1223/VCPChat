// WorkerPanelClient.js
// 渲染进程侧的 AICodeWorker 任务面板客户端。
// 消费 main.js 经由 IPC 转发的 worker-panel-message 事件，渲染任务卡列表。

(function () {
    'use strict';

    // ── 状态 ──────────────────────────────────────────────────
    const jobs = new Map(); // jobId -> jobData
    let panelVisible = false;

    // ── DOM 引用（懒初始化）───────────────────────────────────
    let panelEl = null;
    let listEl = null;
    let badgeEl = null;

    // ── 初始化 ────────────────────────────────────────────────
    function init() {
        panelEl = document.getElementById('worker-panel');
        listEl = document.getElementById('worker-panel-list');
        badgeEl = document.getElementById('worker-panel-badge');

        if (!panelEl || !listEl) {
            console.warn('[WorkerPanel] DOM elements not found. Panel disabled.');
            return;
        }

        // 关闭按钮
        const closeBtn = document.getElementById('worker-panel-close');
        if (closeBtn) closeBtn.addEventListener('click', hidePanel);

        // 触发按钮
        const toggleBtn = document.getElementById('worker-panel-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', togglePanel);

        // 监听来自 main.js 的 WS 消息
        if (window.chatAPI && typeof window.chatAPI.onWorkerPanelMessage === 'function') {
            window.chatAPI.onWorkerPanelMessage((data) => {
                handleMessage(data);
            });
        } else {
            // 兜底：直接监听 IPC（若 preload 未暴露则静默降级）
            console.warn('[WorkerPanel] chatAPI.onWorkerPanelMessage not available; panel events may not arrive.');
        }

        console.log('[WorkerPanel] Initialized.');
    }

    // ── 消息处理 ──────────────────────────────────────────────
    function handleMessage(data) {
        if (!data || data.type !== 'job_status_update') return;
        const job = data.data;
        if (!job || !job.jobId) return;

        const existing = jobs.get(job.jobId) || {};
        jobs.set(job.jobId, Object.assign({}, existing, job, {
            updatedAt: Date.now()
        }));

        // 保留最近 20 条，按更新时间倒序
        if (jobs.size > 20) {
            const oldest = Array.from(jobs.entries())
                .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))[0];
            if (oldest) jobs.delete(oldest[0]);
        }

        renderList();
        updateBadge();
    }

    // ── 渲染 ──────────────────────────────────────────────────
    function renderList() {
        if (!listEl) return;

        const sorted = Array.from(jobs.values())
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        if (sorted.length === 0) {
            listEl.innerHTML = '<div class="wp-empty">暂无任务记录</div>';
            return;
        }

        listEl.innerHTML = sorted.map(job => buildCardHTML(job)).join('');

        // 绑定展开/折叠
        listEl.querySelectorAll('.wp-card-header').forEach(header => {
            header.addEventListener('click', () => {
                const card = header.closest('.wp-card');
                card && card.classList.toggle('wp-expanded');
            });
        });

        // 绑定取消按钮
        listEl.querySelectorAll('.wp-cancel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.dataset.jobid;
                if (jobId && window.chatAPI && typeof window.chatAPI.cancelWorkerJob === 'function') {
                    window.chatAPI.cancelWorkerJob(jobId);
                }
            });
        });
    }

    function buildCardHTML(job) {
        const stateClass = {
            running: 'wp-state-running',
            completed: 'wp-state-completed',
            failed: 'wp-state-failed',
            cancelled: 'wp-state-cancelled',
            timeout: 'wp-state-timeout'
        }[job.state] || 'wp-state-unknown';

        const stateLabel = {
            running: '运行中',
            completed: '已完成',
            failed: '失败',
            cancelled: '已取消',
            timeout: '超时'
        }[job.state] || job.state || '未知';

        const elapsed = job.startedAt
            ? formatElapsed(job.startedAt, job.completedAt)
            : '';

        const jobIdShort = job.jobId ? job.jobId.slice(-8) : '?';
        const workerInfo = [job.worker, job.mode].filter(Boolean).join(' / ');

        const cancelBtn = job.state === 'running'
            ? `<button class="wp-cancel-btn" data-jobid="${escHtml(job.jobId)}">取消</button>`
            : '';

        const detailRows = [
            job.projectPath ? `<div class="wp-detail-row"><span>路径</span><span class="wp-mono">${escHtml(shortPath(job.projectPath))}</span></div>` : '',
            job.pid ? `<div class="wp-detail-row"><span>PID</span><span class="wp-mono">${job.pid}</span></div>` : '',
            job.exitCode !== null && job.exitCode !== undefined ? `<div class="wp-detail-row"><span>退出码</span><span class="wp-mono">${job.exitCode}</span></div>` : '',
            job.exitReason ? `<div class="wp-detail-row"><span>原因</span><span>${escHtml(job.exitReason)}</span></div>` : ''
        ].filter(Boolean).join('');

        return `
<div class="wp-card ${stateClass}">
  <div class="wp-card-header">
    <span class="wp-state-dot"></span>
    <span class="wp-job-id">#${escHtml(jobIdShort)}</span>
    <span class="wp-worker-info">${escHtml(workerInfo)}</span>
    <span class="wp-state-label">${escHtml(stateLabel)}</span>
    <span class="wp-elapsed">${escHtml(elapsed)}</span>
    ${cancelBtn}
    <span class="wp-expand-icon">›</span>
  </div>
  ${detailRows ? `<div class="wp-card-detail">${detailRows}</div>` : ''}
</div>`;
    }

    // ── 工具函数 ──────────────────────────────────────────────
    function escHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function shortPath(p) {
        if (!p) return '';
        const parts = p.replace(/\\/g, '/').split('/');
        return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
    }

    function formatElapsed(startedAt, completedAt) {
        const start = new Date(startedAt).getTime();
        if (isNaN(start)) return '';
        const end = completedAt ? new Date(completedAt).getTime() : Date.now();
        const sec = Math.floor((end - start) / 1000);
        if (sec < 60) return `${sec}s`;
        const min = Math.floor(sec / 60);
        return `${min}m${sec % 60}s`;
    }

    function updateBadge() {
        if (!badgeEl) return;
        const running = Array.from(jobs.values()).filter(j => j.state === 'running').length;
        badgeEl.textContent = running > 0 ? String(running) : '';
        badgeEl.style.display = running > 0 ? 'flex' : 'none';
    }

    // ── 面板开关 ──────────────────────────────────────────────
    function showPanel() {
        if (!panelEl) return;
        panelVisible = true;
        panelEl.classList.add('wp-visible');
    }

    function hidePanel() {
        if (!panelEl) return;
        panelVisible = false;
        panelEl.classList.remove('wp-visible');
    }

    function togglePanel() {
        panelVisible ? hidePanel() : showPanel();
    }

    // ── 实时计时（running 状态下刷新耗时显示）────────────────
    setInterval(() => {
        if (!panelVisible) return;
        const hasRunning = Array.from(jobs.values()).some(j => j.state === 'running');
        if (hasRunning) renderList();
    }, 5000);

    // ── 导出 ──────────────────────────────────────────────────
    window.WorkerPanelClient = { init, handleMessage, showPanel, hidePanel, togglePanel };

    // 自动初始化（DOM 就绪后）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();