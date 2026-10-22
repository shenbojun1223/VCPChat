'use strict';

const fs = require('fs-extra');
const path = require('path');
const { createApplicationSenderGuard, resolveWindowWebContents } = require('./applicationSender');

const VALID_PERIODS = new Set(['today', '7d', 'month']);
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB
const DENIED_RESPONSE = Object.freeze({
    success: false,
    errorCode: 'SENDER_DENIED',
    error: '当前窗口无权调用这个接口。'
});

function deriveSnapshotUrl(vcpServerUrl, period = 'today') {
    if (typeof vcpServerUrl !== 'string' || !vcpServerUrl.trim()) {
        return null;
    }
    try {
        const parsed = new URL(vcpServerUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        if (parsed.username || parsed.password) {
            return null;
        }
        const endpoint = new URL('/admin_api/usage-monitor/snapshot', `${parsed.protocol}//${parsed.host}`);
        endpoint.searchParams.set('period', period);
        return endpoint.toString();
    } catch (_) {
        return null;
    }
}

async function defaultHttpFetch(url, { headers, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'error',
            signal: controller.signal
        });

        const rawText = await response.text();
        if (Buffer.byteLength(rawText, 'utf8') > MAX_RESPONSE_BYTES) {
            const err = new Error('响应数据超过安全上限');
            err.code = 'RESPONSE_TOO_LARGE';
            throw err;
        }

        let body = null;
        if (rawText.trim()) {
            try {
                body = JSON.parse(rawText);
            } catch (_) {
                body = null;
            }
        }

        return {
            status: response.status,
            ok: response.ok,
            body
        };
    } catch (error) {
        if (error && (error.name === 'AbortError' || error.message === 'TIMEOUT')) {
            const timeoutErr = new Error('请求后端用量快照超时。');
            timeoutErr.code = 'TIMEOUT';
            throw timeoutErr;
        }
        if (error && /redirect/i.test(String(error.message || error.cause?.message || ''))) {
            const redirectErr = new Error('已拒绝重定向响应。');
            redirectErr.code = 'REDIRECT_REJECTED';
            throw redirectErr;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function createUsageMonitorSnapshotHandler({
    settingsManager,
    appDataDir,
    getMainWindow,
    httpFetch = defaultHttpFetch
}) {
    const isAllowedSender = createApplicationSenderGuard({
        pages: ['main.html'],
        getMainWebContents: () => resolveWindowWebContents(getMainWindow)
    });

    const forumConfigPath = path.join(appDataDir, 'UserData', 'forum.config.json');

    return async function handleLoadUsageMonitorSnapshot(event, rawPeriod = 'today') {
        if (!isAllowedSender(event)) {
            return DENIED_RESPONSE;
        }

        const period = typeof rawPeriod === 'string' && rawPeriod.trim()
            ? rawPeriod.trim().toLowerCase()
            : 'today';

        if (!VALID_PERIODS.has(period)) {
            return {
                success: false,
                errorCode: 'INVALID_PERIOD',
                error: '无效的统计周期参数，仅支持 today、7d、month。'
            };
        }

        let settings = null;
        try {
            settings = await settingsManager?.readSettings?.();
        } catch (_) {
            settings = null;
        }

        const snapshotUrl = deriveSnapshotUrl(settings?.vcpServerUrl, period);
        if (!snapshotUrl) {
            return {
                success: false,
                errorCode: 'SERVER_URL_NOT_CONFIGURED',
                error: '尚未配置有效的 VCP 后端服务器地址。'
            };
        }

        let forumConfig = null;
        try {
            if (await fs.pathExists(forumConfigPath)) {
                forumConfig = await fs.readJson(forumConfigPath);
            }
        } catch (_) {
            forumConfig = null;
        }

        const username = typeof forumConfig?.username === 'string' ? forumConfig.username.trim() : '';
        const password = typeof forumConfig?.password === 'string' ? forumConfig.password : '';

        if (!username || !password) {
            return {
                success: false,
                errorCode: 'ADMIN_AUTH_NOT_CONFIGURED',
                error: '管理认证尚未配置，请在全局设置中填写后端管理账号与密码。'
            };
        }

        const basicToken = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');

        try {
            const response = await httpFetch(snapshotUrl, {
                headers: {
                    'Authorization': `Basic ${basicToken}`,
                    'Accept': 'application/json'
                },
                timeoutMs: DEFAULT_TIMEOUT_MS
            });

            if (response.status === 404) {
                return {
                    success: false,
                    status: 404,
                    errorCode: 'BACKEND_NOT_UPDATED',
                    error: '后端尚未更新或未启用用量监控接口（HTTP 404）。'
                };
            }

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    status: response.status,
                    errorCode: 'ADMIN_AUTH_FAILED',
                    error: '后端管理认证未通过或无权限访问，请核对管理账号密码设置。'
                };
            }

            if (!response.ok || !response.body || response.body.success !== true || !response.body.data) {
                return {
                    success: false,
                    status: response.status,
                    errorCode: 'BACKEND_ERROR',
                    error: `后端用量快照返回异常（HTTP ${response.status}）。`
                };
            }

            return {
                success: true,
                data: response.body.data
            };
        } catch (error) {
            const code = error && error.code ? error.code : 'NETWORK_ERROR';
            return {
                success: false,
                errorCode: code,
                error: code === 'TIMEOUT'
                    ? '连接后端用量快照接口超时。'
                    : (code === 'REDIRECT_REJECTED' ? '已拒绝不安全的后端重定向响应。' : '无法连接 VCP 后端用量监控接口。')
            };
        }
    };
}

function registerUsageMonitorIpc({
    ipcMain,
    settingsManager,
    appDataDir,
    getMainWindow,
    httpFetch
}) {
    const handler = createUsageMonitorSnapshotHandler({
        settingsManager,
        appDataDir,
        getMainWindow,
        httpFetch
    });
    ipcMain.handle('usage-monitor:get-snapshot', handler);
    return handler;
}

module.exports = {
    deriveSnapshotUrl,
    createUsageMonitorSnapshotHandler,
    registerUsageMonitorIpc
};