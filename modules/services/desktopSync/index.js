const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');
const {
    writeJsonAtomic,
} = require('../atomicJsonFile');
const {
    listTopicDeletions,
    removeTopicDeletions,
} = require('./topicTombstones');
const {
    listOwnerDeletions,
    removeOwnerDeletions,
} = require('./ownerTombstones');
const {
    listMessageDeletions,
    removeMessageDeletions,
} = require('./messageTombstones');

const AGENT_FIELDS = [
    'name',
    'systemPrompt',
    'model',
    'temperature',
    'contextTokenLimit',
    'maxOutputTokens',
    'streamOutput'
];
const GROUP_FIELDS = [
    'name',
    'members',
    'mode',
    'memberTags',
    'groupPrompt',
    'invitePrompt',
    'useUnifiedModel',
    'unifiedModel',
    'tagMatchMode',
    'createdAt'
];
const AGENT_TOPIC_FIELDS = ['id', 'name', 'createdAt', 'locked', 'unread'];
const GROUP_TOPIC_FIELDS = ['id', 'name', 'createdAt'];

const LOCAL_ONLY_KEY = /(?:path|dir|directory|executable)$/i;
const SECRET_KEY = /(?:api[_-]?key|token|secret|password|credential)/i;

function stableStringify(value, key = '') {
    if (value === null) return 'null';
    if (typeof value === 'number') {
        if (key === 'temperature' && Number.isInteger(value)) return value.toFixed(1);
        return value.toString();
    }
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(childKey =>
            `${JSON.stringify(childKey)}:${stableStringify(value[childKey], childKey)}`
        ).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function hashDto(dto, fields) {
    const filtered = {};
    for (const field of fields) {
        if (dto[field] !== undefined && dto[field] !== null) filtered[field] = dto[field];
    }
    if (typeof filtered.temperature === 'number') {
        filtered.temperature = Math.round(filtered.temperature * 100) / 100;
    }
    return sha256(stableStringify(filtered));
}

function hashMessage(message) {
    const hashes = (message.attachments || [])
        .map(attachment => attachment?.hash || attachment?._fileManagerData?.hash || '')
        .filter(Boolean)
        .sort();
    const value = { content: message.content || '' };
    if (hashes.length) value.attachmentHashes = hashes;
    return sha256(stableStringify(value));
}

function aggregateHashes(hashes) {
    if (!hashes.length) return '';
    return sha256([...hashes].sort().join(''));
}

function topicMetadataFingerprint(topics) {
    return sha256(stableStringify(
        topics
            .map(topic => ({
                id: topic.id,
                ownerId: topic.ownerId,
                ownerType: topic.ownerType,
                configHash: topic.configHash
            }))
            .sort((left, right) => left.id.localeCompare(right.id))
    ));
}

function syncErrorMessage(value, fallback = '同步失败') {
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object') {
        if (typeof value.message === 'string' && value.message) return value.message;
        if (typeof value.code === 'string' && value.code) return value.code;
    }
    return fallback;
}

function sanitizeConfigValue(value, key = '') {
    if (key === 'topics' || key === 'avatarUrl') return undefined;
    if (SECRET_KEY.test(key) || LOCAL_ONLY_KEY.test(key)) return undefined;
    if (typeof value === 'string' && /^(?:file:\/\/|[a-z]:[\\/])/i.test(value)) return undefined;
    if (Array.isArray(value)) {
        return value.map(item => sanitizeConfigValue(item)).filter(item => item !== undefined);
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            const sanitized = sanitizeConfigValue(childValue, childKey);
            if (sanitized !== undefined) result[childKey] = sanitized;
        }
        return result;
    }
    return value;
}

function sanitizeConfig(config) {
    return sanitizeConfigValue(config || {}) || {};
}

function normalizeHttpUrl(value) {
    const url = new URL(String(value || '').trim());
    url.pathname = url.pathname.replace(/\/(?:api\/mobile-sync)?\/?$/, '');
    url.search = '';
    url.hash = '';
    return `${url.toString().replace(/\/$/, '')}/api/mobile-sync`;
}

function normalizeWsUrl(value) {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('同步 WebSocket URL 必须使用 ws:// 或 wss://');
    if (url.pathname === '/' || !url.pathname) url.pathname = '/ws-sync';
    return url;
}

function extensionFromAttachment(attachment) {
    const nameExt = path.extname(attachment?.name || '').toLowerCase();
    if (/^\.[a-z0-9]{1,10}$/i.test(nameExt)) return nameExt;
    const map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'application/pdf': '.pdf',
        'text/plain': '.txt',
        'text/markdown': '.md',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'video/mp4': '.mp4'
    };
    return map[attachment?.type] || '.bin';
}

class DesktopSyncService {
    constructor({ appDataPath, notify = () => {}, logger = console }) {
        this.appDataPath = appDataPath;
        this.notify = notify;
        this.logger = logger;
        this.settings = {};
        this.timer = null;
        this.startupTimer = null;
        this.running = null;
        this.lastStatus = { state: 'disabled', message: '桌面同步未启用' };
    }

    configure(settings = {}) {
        this.settings = {
            enabled: settings.DesktopSyncEnabled === true,
            httpUrl: String(settings.DesktopSyncHttpUrl || '').trim(),
            wsUrl: String(settings.DesktopSyncWsUrl || '').trim(),
            token: String(settings.DesktopSyncToken || ''),
            intervalSeconds: Math.max(30, Number(settings.DesktopSyncIntervalSeconds) || 60)
        };
        if (this.timer) clearInterval(this.timer);
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.timer = null;
        this.startupTimer = null;
        if (!this.settings.enabled) {
            this.setStatus('disabled', '桌面同步未启用');
            return;
        }
        try {
            this.validateSettings();
        } catch (error) {
            this.setStatus('error', error.message);
            return;
        }
        this.timer = setInterval(() => void this.runNow('interval'), this.settings.intervalSeconds * 1000);
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null;
            void this.runNow('startup');
        }, 2500);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        if (this.startupTimer) clearTimeout(this.startupTimer);
        this.timer = null;
        this.startupTimer = null;
    }

    status() {
        return { ...this.lastStatus, running: Boolean(this.running) };
    }

    validateSettings() {
        if (!this.settings.httpUrl) throw new Error('请配置同步 HTTP URL');
        if (!this.settings.wsUrl) throw new Error('请配置同步 WebSocket URL');
        if (!this.settings.token) throw new Error('请配置同步 Token');
        normalizeHttpUrl(this.settings.httpUrl);
        normalizeWsUrl(this.settings.wsUrl);
    }

    setStatus(state, message, extra = {}) {
        this.lastStatus = { state, message, at: Date.now(), ...extra };
        this.notifyStatus();
    }

    notifyStatus() {
        try {
            this.notify(this.status());
        } catch (error) {
            this.logger.warn?.('[DesktopSync] Status notification failed:', error);
        }
    }

    async runNow(trigger = 'manual') {
        if (this.running) return this.running;
        if (!this.settings.enabled && trigger !== 'manual') return this.status();
        try {
            this.validateSettings();
        } catch (error) {
            this.setStatus('error', error.message);
            return this.status();
        }

        this.running = (async () => {
            const startedAt = Date.now();
            this.setStatus('syncing', '正在同步配置、话题和聊天记录…', { trigger });
            try {
                const flushedMessageIds = await this.flushMessageTombstones();
                await this.flushOwnerTombstones();
                const configSyncResult = await this.syncFullConfigs();
                const ws = await this.openWebSocket();
                try {
                    const version = await this.wsRequest(ws, {
                        type: 'VERSION_CHECK',
                        mobileVersion: 'vcpchat-desktop-sync-1.2',
                        protocolVersion: '1.2'
                    });
                    if (version.pluginVersion !== '1.2.0' || version.protocolVersion !== '1.2') {
                        throw new Error(
                            `同步协议不兼容：服务端插件 ${version.pluginVersion || '未知'}，协议 ${version.protocolVersion || '未知'}`
                        );
                    }
                    const topicSyncResult = await this.syncTopicsAndMessages(ws);
                    const avatarSyncResult = await this.syncAvatars(ws);
                    const skippedTopics = topicSyncResult?.skippedTopics || [];
                    const missingAttachmentHashes = topicSyncResult?.missingAttachmentHashes || [];
                    const pulledConfigIds = configSyncResult?.pulledConfigIds || [];
                    const deletedConfigIds = configSyncResult?.deletedConfigIds || [];
                    const pulledTopicIds = topicSyncResult?.pulledTopicIds || [];
                    const pulledMessageTopicIds = topicSyncResult?.pulledMessageTopicIds || [];
                    const deletedTopicIds = topicSyncResult?.deletedTopicIds || [];
                    const deletedMessageIds = [...new Set([
                        ...flushedMessageIds,
                        ...(topicSyncResult?.deletedMessageIds || []),
                    ])];
                    const pulledAvatarIds = avatarSyncResult?.pulledAvatarIds || [];
                    const dataChanged = [
                        pulledConfigIds,
                        deletedConfigIds,
                        pulledTopicIds,
                        pulledMessageTopicIds,
                        deletedTopicIds,
                        deletedMessageIds,
                        pulledAvatarIds,
                    ].some(items => items.length > 0);
                    const syncDetails = {
                        trigger,
                        durationMs: Date.now() - startedAt,
                        dataChanged,
                        pulledConfigIds,
                        deletedConfigIds,
                        pulledTopicIds,
                        pulledMessageTopicIds,
                        deletedTopicIds,
                        deletedMessageIds,
                        pulledAvatarIds,
                        skippedTopics,
                    };
                    const durationMs = Date.now() - startedAt;
                    if (missingAttachmentHashes.length) {
                        this.setStatus(
                            'success',
                            `同步完成（${missingAttachmentHashes.length} 个附件在当前设备缺失，等待其他设备补传；已跳过 ${skippedTopics.length} 个相关话题）`,
                            { ...syncDetails, durationMs, missingAttachmentHashes },
                        );
                    } else {
                        this.setStatus('success', '同步完成', { ...syncDetails, durationMs });
                    }
                } finally {
                    ws.close();
                }
            } catch (error) {
                this.logger.error('[DesktopSync] Sync failed:', error);
                this.setStatus('error', `同步失败：${error.message}`, { trigger });
            }
            return this.status();
        })();

        try {
            await this.running;
        } finally {
            this.running = null;
            this.notifyStatus();
        }
        return this.status();
    }

    async api(pathname, { method = 'GET', body, headers = {} } = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
            const response = await fetch(`${normalizeHttpUrl(this.settings.httpUrl)}${pathname}`, {
                method,
                headers: {
                    'x-sync-token': this.settings.token,
                    ...(body !== undefined && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
                    ...headers
                },
                body: body === undefined ? undefined : Buffer.isBuffer(body) || typeof body === 'string'
                    ? body
                    : JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) {
                const detail = (await response.text()).slice(0, 500);
                const error = new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
                error.status = response.status;
                throw error;
            }
            return response;
        } finally {
            clearTimeout(timeout);
        }
    }

    async apiJson(pathname, options) {
        return (await this.api(pathname, options)).json();
    }

    openWebSocket() {
        return new Promise((resolve, reject) => {
            const url = normalizeWsUrl(this.settings.wsUrl);
            url.searchParams.set('token', this.settings.token);
            const ws = new WebSocket(url.toString());
            const timeout = setTimeout(() => {
                ws.terminate();
                reject(new Error('同步 WebSocket 连接超时'));
            }, 15000);
            ws.once('open', () => {
                clearTimeout(timeout);
                resolve(ws);
            });
            ws.once('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    wsRequest(ws, payload) {
        return new Promise((resolve, reject) => {
            const expectedType = {
                SYNC_MANIFEST: 'SYNC_DIFF_RESULTS',
                GET_MESSAGE_MANIFEST: 'MESSAGE_MANIFEST_RESULTS',
                SYNC_TOPIC_HASH_BATCH: 'SYNC_TOPIC_HASH_RESULTS',
                SYNC_TOPIC_HASH_BATCH_V2: 'SYNC_TOPIC_HASH_RESULTS',
                SYNC_MESSAGE_DIFF_BATCH: 'SYNC_DIFF_RESULTS_BATCH',
                PHASE_START: 'PHASE_ACK',
                PHASE_COMPLETED: 'PHASE_ACK',
                VERSION_CHECK: 'VERSION_ACK'
            }[payload.type];
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`等待 ${payload.type} 响应超时`));
            }, 60000);
            const onMessage = data => {
                try {
                    const response = JSON.parse(data.toString('utf8'));
                    if (response.type === 'SYNC_ERROR') {
                        cleanup();
                        reject(new Error(response.error?.message || response.error?.code || '同步协议失败'));
                        return;
                    }
                    // The upstream server also broadcasts structured sync logs
                    // on this socket. Ignore those out-of-band frames and wait
                    // for the response belonging to this request.
                    if (expectedType && response.type !== expectedType) return;
                    cleanup();
                    resolve(response);
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };
            const onClose = () => {
                cleanup();
                reject(new Error('同步 WebSocket 已断开'));
            };
            const cleanup = () => {
                clearTimeout(timeout);
                ws.off('message', onMessage);
                ws.off('close', onClose);
            };
            ws.on('message', onMessage);
            ws.once('close', onClose);
            ws.send(JSON.stringify(payload), error => {
                if (error) {
                    cleanup();
                    reject(error);
                }
            });
        });
    }

    async listConfigs() {
        const items = [];
        for (const [type, folder] of [['agent', 'Agents'], ['group', 'AgentGroups']]) {
            const basePath = path.join(this.appDataPath, folder);
            const entries = await fs.readdir(basePath, { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]+$/.test(entry.name)) continue;
                const filePath = path.join(basePath, entry.name, 'config.json');
                try {
                    const [data, stats] = await Promise.all([fs.readJson(filePath), fs.stat(filePath)]);
                    const sanitized = sanitizeConfig(data);
                    items.push({
                        id: entry.name,
                        type,
                        data: sanitized,
                        hash: sha256(stableStringify(sanitized)),
                        ts: Math.trunc(stats.mtimeMs || Date.now()),
                        filePath
                    });
                } catch (error) {
                    this.logger.warn(`[DesktopSync] Skipped ${type} ${entry.name}: ${error.message}`);
                }
            }
        }
        return items;
    }

    async syncFullConfigs() {
        let localItems = await this.listConfigs();
        const manifest = await this.apiJson('/desktop/config-manifest', {
            method: 'POST',
            body: { items: localItems.map(({ filePath, data, ...item }) => item) }
        });
        const pulls = (manifest.actions || []).filter(item => item.action === 'PULL');
        const pushes = (manifest.actions || []).filter(item => item.action === 'PUSH');
        const deletes = (manifest.actions || []).filter(item => item.action === 'DELETE');

        const deletedConfigIds = await this.applyRemoteOwnerDeletions(deletes);

        if (pulls.length) {
            const response = await this.apiJson('/desktop/download-configs', {
                method: 'POST',
                body: { items: pulls }
            });
            for (const remote of response.items || []) await this.applyRemoteConfig(remote);
        }

        if (pushes.length) {
            localItems = await this.listConfigs();
            const localMap = new Map(localItems.map(item => [`${item.type}:${item.id}`, item]));
            const items = pushes.map(action => localMap.get(`${action.type}:${action.id}`)).filter(Boolean)
                .map(({ filePath, ...item }) => item);
            if (items.length) {
                await this.apiJson('/desktop/upload-configs', { method: 'POST', body: { items } });
            }
        }
        return {
            pulledConfigIds: pulls.map(item => `${item.type}:${item.id}`),
            deletedConfigIds,
        };
    }

    async flushMessageTombstones() {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listMessageDeletions(userDataDir);
        if (!tombstones.length) return [];

        const acknowledged = [];
        for (const tombstone of tombstones) {
            const response = await this.apiJson('/delete-message', {
                method: 'POST',
                body: tombstone,
            });
            if (
                response?.success !== true ||
                response.topicId !== tombstone.topicId ||
                response.msgId !== tombstone.msgId
            ) {
                throw new Error(
                    `消息删除确认不匹配：${tombstone.topicId}/${tombstone.msgId}`,
                );
            }
            acknowledged.push(tombstone);
        }
        await removeMessageDeletions(userDataDir, acknowledged);
        return acknowledged.map(item => `${item.topicId}:${item.msgId}`);
    }

    async flushOwnerTombstones() {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listOwnerDeletions(userDataDir);
        if (!tombstones.length) return [];

        const acknowledged = [];
        for (const tombstone of tombstones) {
            await this.apiJson('/delete-entity', {
                method: 'POST',
                body: tombstone,
            });
            acknowledged.push(tombstone);
        }
        await removeOwnerDeletions(userDataDir, acknowledged);
        return acknowledged.map(item => `${item.type}:${item.id}`);
    }

    async applyRemoteOwnerDeletions(actions) {
        const deleted = [];
        for (const action of actions) {
            const type = action?.type;
            const id = typeof action?.id === 'string' ? action.id : '';
            if (!['agent', 'group'].includes(type) || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                continue;
            }
            const folder = type === 'group' ? 'AgentGroups' : 'Agents';
            await Promise.all([
                fs.remove(path.join(this.appDataPath, folder, id)),
                fs.remove(path.join(this.appDataPath, 'UserData', id)),
            ]);
            deleted.push(`${type}:${id}`);
        }
        return deleted;
    }

    async applyRemoteConfig(remote) {
        const folder = remote.type === 'group' ? 'AgentGroups' : 'Agents';
        const filePath = path.join(this.appDataPath, folder, remote.id, 'config.json');
        await fs.ensureDir(path.dirname(filePath));
        let existing = {};
        try { existing = await fs.readJson(filePath); } catch {}
        const topics = Array.isArray(existing.topics) ? existing.topics : [];
        const merged = { ...existing, ...sanitizeConfig(remote.data), topics };
        if (remote.type === 'group') merged.id = remote.id;
        await this.writeJsonAtomic(filePath, merged);
    }

    extractOwnerDto(config, type) {
        const fields = type === 'group' ? GROUP_FIELDS : AGENT_FIELDS;
        const dto = {};
        for (const field of fields) if (config[field] !== undefined) dto[field] = config[field];
        return dto;
    }

    async buildTopicState() {
        const configs = await this.listConfigs();
        const topics = [];
        for (const owner of configs) {
            const fullConfig = await fs.readJson(owner.filePath);
            for (const topic of Array.isArray(fullConfig.topics) ? fullConfig.topics : []) {
                if (!topic?.id || topic.id === 'default') continue;
                const historyPath = path.join(
                    this.appDataPath,
                    'UserData',
                    owner.id,
                    'topics',
                    topic.id,
                    'history.json'
                );
                let messages = [];
                let historyMtime = 0;
                try {
                    [messages, historyMtime] = await Promise.all([
                        fs.readJson(historyPath),
                        fs.stat(historyPath).then(stats => Math.trunc(stats.mtimeMs || 0))
                    ]);
                } catch (error) {
                    if (error?.code !== 'ENOENT') {
                        throw new Error(
                            `聊天历史损坏或不可读：${owner.id}/${topic.id}: ${error.message}`,
                            { cause: error }
                        );
                    }
                }
                if (!Array.isArray(messages)) {
                    throw new Error(`聊天历史格式无效：${owner.id}/${topic.id} 必须是数组`);
                }
                const messageHashes = {};
                for (const message of messages) if (message?.id) messageHashes[message.id] = hashMessage(message);
                const dto = {
                    id: topic.id,
                    name: topic.name,
                    createdAt: Number(topic.createdAt) || 0,
                    ownerId: owner.id,
                    ownerType: owner.type
                };
                if (owner.type === 'agent') {
                    dto.locked = topic.locked ?? true;
                    dto.unread = topic.unread ?? false;
                }
                topics.push({
                    id: topic.id,
                    ownerId: owner.id,
                    ownerType: owner.type,
                    dto,
                    configHash: hashDto(dto, owner.type === 'group' ? GROUP_TOPIC_FIELDS : AGENT_TOPIC_FIELDS),
                    contentHash: aggregateHashes(Object.values(messageHashes)),
                    ts: Math.max(owner.ts, historyMtime),
                    messageHashes,
                    messages,
                    historyPath
                });
            }
        }
        return topics;
    }

    async syncTopicsAndMessages(ws) {
        await this.flushTopicTombstones();
        let topics = await this.buildTopicState();
        const pulledTopicIds = new Set();
        const deletedTopicIds = new Set();
        let metadataStable = false;
        for (let pass = 0; pass < 3; pass++) {
            const advertisedFingerprint = topicMetadataFingerprint(topics);
            const owners = await this.listConfigs();
            const targetedOwners = [...new Set([
                ...owners.map(owner => owner.id),
                ...topics.map(topic => topic.ownerId)
            ])];
            const manifestResponse = await this.wsRequest(ws, {
                type: 'SYNC_MANIFEST',
                dataType: 'topic',
                phase: 2,
                targetedOwners,
                data: topics.map(topic => ({
                    id: topic.id,
                    hash: topic.configHash,
                    configHash: topic.configHash,
                    contentHash: topic.contentHash,
                    ts: topic.ts,
                    ownerType: topic.ownerType,
                    ownerId: topic.ownerId
                }))
            });

            const pulls = (manifestResponse.data || []).filter(item => item.action === 'PULL');
            const pushes = (manifestResponse.data || []).filter(item => item.action === 'PUSH');
            const remoteDeletes = (manifestResponse.data || []).filter(item => item.action === 'PUSH_DELETE');
            if (remoteDeletes.length) {
                for (const id of await this.applyRemoteTopicDeletions(remoteDeletes, topics)) {
                    deletedTopicIds.add(id);
                }
            }
            if (pulls.length) {
                for (const id of (await this.pullTopics(pulls)).pulledTopicIds) {
                    pulledTopicIds.add(id);
                }
            }
            if (pushes.length) await this.pushTopics(pushes, topics);

            topics = await this.buildTopicState();
            if (topicMetadataFingerprint(topics) === advertisedFingerprint) {
                metadataStable = true;
                break;
            }
        }
        if (!metadataStable) {
            throw new Error('话题清单在同步期间持续变化，已停止消息同步以避免漏传');
        }
        if (!topics.length) return {
            pushedTopicIds: [],
            skippedTopics: [],
            missingAttachmentHashes: [],
            pulledTopicIds: [...pulledTopicIds],
            pulledMessageTopicIds: [],
            deletedTopicIds: [...deletedTopicIds],
            deletedMessageIds: [],
        };
        const diff = await this.wsRequest(ws, {
            type: 'SYNC_MESSAGE_DIFF_BATCH',
            topics: Object.fromEntries(topics.map(topic => [topic.id, {
                ownerType: topic.ownerType,
                ownerId: topic.ownerId,
                topicHash: topic.contentHash,
                messages: topic.messageHashes
            }]))
        });
        const results = diff.results || {};
        const failedTopics = topics.filter(topic => {
            const result = results[topic.id];
            return !result || result.ok === false || result.error;
        });
        if (failedTopics.length) {
            const details = failedTopics.slice(0, 5).map(topic => {
                const result = results[topic.id];
                return `${topic.id}: ${syncErrorMessage(result?.error, '服务端未返回话题结果')}`;
            });
            throw new Error(
                `消息差异同步失败（${failedTopics.length} 个话题）：${details.join('; ')}`
            );
        }
        const deletedMessageIds = await this.applyRemoteMessageDeletions(
            results,
            topics,
        );
        const pullSnapshots = new Map();
        const pulledMessageTopicIds = new Set();
        try {
            await this.pullMessages(results, topics, pullSnapshots, pulledMessageTopicIds);
            topics = await this.buildTopicState();
            return {
                ...await this.pushMessages(results, topics),
                pulledTopicIds: [...pulledTopicIds],
                pulledMessageTopicIds: [...pulledMessageTopicIds],
                deletedTopicIds: [...deletedTopicIds],
                deletedMessageIds,
            };
        } catch (error) {
            await this.restorePulledHistories(pullSnapshots);
            throw error;
        }
    }

    async flushTopicTombstones() {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listTopicDeletions(userDataDir);
        if (!tombstones.length) return [];

        const acknowledged = [];
        for (const tombstone of tombstones) {
            await this.apiJson('/delete-entity', {
                method: 'POST',
                body: {
                    id: tombstone.id,
                    type: tombstone.ownerType === 'group' ? 'group_topic' : 'agent_topic',
                    deletedAt: tombstone.deletedAt,
                },
            });
            acknowledged.push(tombstone);
        }
        await removeTopicDeletions(userDataDir, acknowledged);
        return acknowledged.map(item => item.id);
    }

    async applyRemoteTopicDeletions(actions, topics = []) {
        const localById = new Map(topics.map(topic => [topic.id, topic]));
        const deletedTopicIds = [];
        for (const action of actions) {
            const local = localById.get(action.id);
            const ownerId = action.ownerId || local?.ownerId;
            const ownerType = action.ownerType || local?.ownerType;
            if (!action.id || !ownerId || !['agent', 'group'].includes(ownerType)) {
                throw new Error(`Topic deletion ${action.id || '<unknown>'} is missing owner identity`);
            }

            const configPath = path.join(
                this.appDataPath,
                ownerType === 'group' ? 'AgentGroups' : 'Agents',
                ownerId,
                'config.json'
            );
            let removed = false;
            try {
                const config = await fs.readJson(configPath);
                if (Array.isArray(config.topics)) {
                    const remaining = config.topics.filter(topic => topic?.id !== action.id);
                    removed = remaining.length !== config.topics.length;
                    if (removed) {
                        config.topics = remaining;
                        await this.writeJsonAtomic(configPath, config);
                    }
                }
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }

            const topicDir = path.join(this.appDataPath, 'UserData', ownerId, 'topics', action.id);
            if (await fs.pathExists(topicDir)) {
                await fs.remove(topicDir);
                removed = true;
            }
            if (removed) deletedTopicIds.push(action.id);
        }
        return deletedTopicIds;
    }

    async pullTopics(actions) {
        const response = await this.apiJson('/download-entities', {
            method: 'POST',
            body: {
                requests: actions.map(item => ({
                    id: item.id,
                    type: item.ownerType === 'group' ? 'group_topic' : 'agent_topic'
                }))
            }
        });
        const pulledTopicIds = [];
        for (const remote of Array.isArray(response) ? response : []) {
            if (remote?.success === false) {
                throw new Error(syncErrorMessage(
                    remote.error,
                    `Topic pull failed for ${remote.id || '<unknown>'}`,
                ));
            }
            const data = remote.data || {};
            const ownerId = data.ownerId;
            const ownerType = remote.type === 'group_topic' ? 'group' : 'agent';
            if (!ownerId) continue;
            const configPath = path.join(
                this.appDataPath,
                ownerType === 'group' ? 'AgentGroups' : 'Agents',
                ownerId,
                'config.json'
            );
            const config = await fs.readJson(configPath);
            if (!Array.isArray(config.topics)) config.topics = [];
            const index = config.topics.findIndex(topic => topic.id === remote.id);
            const current = index >= 0 ? config.topics[index] : {};
            const topic = { ...current, ...data, id: remote.id };
            delete topic.ownerId;
            delete topic.ownerType;
            if (index >= 0) config.topics[index] = topic;
            else config.topics.push(topic);
            await this.writeJsonAtomic(configPath, config);
            const historyPath = path.join(this.appDataPath, 'UserData', ownerId, 'topics', remote.id, 'history.json');
            if (!await fs.pathExists(historyPath)) await this.writeJsonAtomic(historyPath, []);
            pulledTopicIds.push(remote.id);
        }
        return { pulledTopicIds };
    }

    async pushTopics(actions, topics) {
        const topicMap = new Map(topics.map(topic => [topic.id, topic]));
        const items = actions.map(action => topicMap.get(action.id)).filter(Boolean).map(topic => ({
            id: topic.id,
            type: topic.ownerType === 'group' ? 'group_topic' : 'agent_topic',
            data: topic.dto
        }));
        if (items.length) await this.apiJson('/upload-entities-batch', { method: 'POST', body: { items } });
    }

    async pullMessages(results, topics, snapshots = new Map(), pulledTopicIds = new Set()) {
        const requests = [];
        for (const topic of topics) {
            const ids = results[topic.id]?.toPull;
            if (Array.isArray(ids) && ids.length) requests.push({
                topicId: topic.id,
                ownerType: topic.ownerType,
                ownerId: topic.ownerId,
                msgIds: ids
            });
        }
        if (!requests.length) return;
        const response = await this.api('/download-messages-stream', { method: 'POST', body: { requests } });
        const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
        const topicMap = new Map(topics.map(topic => [topic.id, topic]));
        for (const line of lines) {
            const frame = JSON.parse(line);
            const topic = topicMap.get(frame.topicId);
            if (frame._stream_error || frame._error) {
                throw new Error(
                    syncErrorMessage(frame._stream_error || frame._error),
                );
            }
            if (!topic || !Array.isArray(frame.messages)) continue;
            let currentMessages = [];
            try {
                currentMessages = await fs.readJson(topic.historyPath);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            if (!Array.isArray(currentMessages)) {
                throw new Error(`聊天历史格式无效：${topic.id}`);
            }
            if (!snapshots.has(topic.historyPath)) {
                snapshots.set(topic.historyPath, {
                    messages: currentMessages,
                    afterHash: null
                });
            }
            const localMap = new Map(currentMessages.map(message => [message.id, message]));
            let changed = false;
            for (const message of frame.messages) {
                const remoteMessage = await this.normalizeRemoteMessage(message);
                const localMessage = localMap.get(remoteMessage.id);
                if (this.shouldKeepLocalMessage(localMessage, remoteMessage)) {
                    if (results[topic.id]) results[topic.id].toPush = true;
                    this.logger.warn?.(
                        `[DesktopSync] Kept non-empty local message ${remoteMessage.id} instead of an empty remote version.`,
                    );
                    continue;
                }
                localMap.set(remoteMessage.id, remoteMessage);
                changed = true;
            }
            const merged = Array.from(localMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            await this.writeJsonAtomic(topic.historyPath, merged);
            snapshots.get(topic.historyPath).afterHash = sha256(stableStringify(merged));
            if (changed) pulledTopicIds.add(topic.id);
        }
        return snapshots;
    }

    async applyRemoteMessageDeletions(results, topics) {
        const deleted = [];
        for (const topic of topics) {
            const ids = results[topic.id]?.toDelete;
            if (ids === undefined) continue;
            if (
                !Array.isArray(ids) ||
                new Set(ids).size !== ids.length ||
                ids.some(id => typeof id !== 'string' || id.length === 0)
            ) {
                throw new Error(
                    `消息删除结果格式无效：${topic.id}`,
                );
            }
            if (!ids.length) continue;

            let history = [];
            try {
                history = await fs.readJson(topic.historyPath);
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            if (!Array.isArray(history)) {
                throw new Error(`聊天历史格式无效：${topic.id}`);
            }
            const deleteIds = new Set(ids);
            const remaining = history.filter(message => !deleteIds.has(message?.id));
            if (remaining.length === history.length) continue;
            await this.writeJsonAtomic(topic.historyPath, remaining);
            for (const message of history) {
                if (deleteIds.has(message?.id)) {
                    deleted.push(`${topic.id}:${message.id}`);
                }
            }
        }
        return deleted;
    }

    shouldKeepLocalMessage(localMessage, remoteMessage) {
        if (!localMessage || !remoteMessage) return false;
        const localContent = typeof localMessage.content === 'string' ? localMessage.content.trim() : '';
        const remoteContent = typeof remoteMessage.content === 'string' ? remoteMessage.content.trim() : '';
        return localContent.length > 0 && remoteContent.length === 0;
    }

    async restorePulledHistories(snapshots) {
        for (const [historyPath, snapshot] of snapshots) {
            if (!snapshot?.afterHash) continue;
            let currentMessages;
            try {
                currentMessages = await fs.readJson(historyPath);
            } catch {
                continue;
            }
            if (sha256(stableStringify(currentMessages)) !== snapshot.afterHash) {
                this.logger.warn?.(
                    `[DesktopSync] Did not roll back ${historyPath} because it changed after the sync pull.`,
                );
                continue;
            }
            await this.writeJsonAtomic(historyPath, snapshot.messages);
        }
    }

    async normalizeRemoteMessage(message) {
        const { contentHash, ...cleanMessage } = message;
        if (!Array.isArray(message.attachments)) return cleanMessage;
        const attachmentsDir = path.join(this.appDataPath, 'UserData', 'attachments');
        await fs.ensureDir(attachmentsDir);
        const attachments = [];
        for (const attachment of message.attachments) {
            const hash = attachment?.hash || attachment?._fileManagerData?.hash;
            if (!hash) {
                attachments.push(attachment);
                continue;
            }
            const ext = extensionFromAttachment(attachment);
            let localPath = await this.findAttachment(hash);
            let attachmentAvailable = Boolean(localPath);
            if (!localPath) {
                localPath = path.join(attachmentsDir, `${hash}${ext}`);
                try {
                    const response = await this.api(`/download-attachment?hash=${encodeURIComponent(hash)}`);
                    await fs.writeFile(localPath, Buffer.from(await response.arrayBuffer()));
                    attachmentAvailable = true;
                } catch (error) {
                    if (error?.status !== 404) throw error;
                    this.logger.warn?.(
                        `[DesktopSync] Attachment ${hash.slice(0, 12)} is referenced but unavailable on the sync server; keeping a local placeholder.`,
                    );
                }
            }
            const fileUrl = pathToFileURL(localPath).toString();
            attachments.push({
                type: attachment.type || 'application/octet-stream',
                src: fileUrl,
                name: attachment.name || path.basename(localPath),
                size: Number(attachment.size) || 0,
                status: attachmentAvailable ? 'ready' : 'missing',
                _fileManagerData: {
                    id: `attachment_${hash}`,
                    name: attachment.name || path.basename(localPath),
                    internalFileName: path.basename(localPath),
                    internalPath: fileUrl,
                    type: attachment.type || 'application/octet-stream',
                    size: Number(attachment.size) || 0,
                    hash,
                    createdAt: attachment.createdAt || Date.now(),
                    extractedText: attachment.extractedText || null,
                    imageFrames: attachment.imageFrames || null
                }
            });
        }
        return { ...cleanMessage, attachments };
    }

    async pushMessages(results, topics) {
        const selected = topics.filter(topic => results[topic.id]?.toPush === true);
        if (!selected.length) return { pushedTopicIds: [], skippedTopics: [], missingAttachmentHashes: [] };
        const ready = [];
        const skippedTopics = [];
        const missingAttachmentHashes = new Set();
        for (const topic of selected) {
            const messages = topic.messages.filter(message => !this.isEmptyAssistantMessage(message));
            if (!messages.length) continue;
            const topicMissingAttachmentHashes = await this.findMissingAttachmentHashes(messages);
            if (topicMissingAttachmentHashes.length) {
                for (const hash of topicMissingAttachmentHashes) missingAttachmentHashes.add(hash);
                skippedTopics.push({
                    topicId: topic.id,
                    missingAttachmentHashes: topicMissingAttachmentHashes
                });
                this.logger.warn?.(
                    `[DesktopSync] Skipped topic ${topic.id}; ${topicMissingAttachmentHashes.length} referenced attachment(s) are missing locally.`,
                );
                continue;
            }
            ready.push({ topic, messages });
        }
        if (!ready.length) return {
            pushedTopicIds: [],
            skippedTopics,
            missingAttachmentHashes: [...missingAttachmentHashes].sort()
        };
        const body = ready.map(({ topic, messages }) => JSON.stringify({
            topicId: topic.id,
            ownerType: topic.ownerType,
            ownerId: topic.ownerId,
            messages: messages.map(message => this.toTransportMessage(message))
        })).join('\n') + '\n';
        const response = await this.api('/upload-messages-batch', {
            method: 'POST',
            body,
            headers: { 'content-type': 'application/x-ndjson' }
        });
        const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            const frame = JSON.parse(line);
            if (frame._stream_error || frame.success === false) {
                throw new Error(syncErrorMessage(
                    frame._stream_error || frame.error,
                    `Message push failed for ${frame.topicId || 'unknown topic'}`,
                ));
            }
            for (const hash of frame.neededAttachmentHashes || []) {
                const result = await this.uploadAttachment(hash);
                if (result?.status === 'missing') missingAttachmentHashes.add(hash);
            }
        }
        return {
            pushedTopicIds: ready.map(({ topic }) => topic.id),
            skippedTopics,
            missingAttachmentHashes: [...missingAttachmentHashes].sort()
        };
    }

    isEmptyAssistantMessage(message) {
        if (message?.role !== 'assistant') return false;
        return typeof message.content !== 'string' || message.content.trim() === '';
    }

    async findMissingAttachmentHashes(messages) {
        const hashes = new Set();
        for (const message of messages) {
            for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
                const fileData = attachment?._fileManagerData || {};
                const hash = attachment?.hash || fileData.hash;
                if (typeof hash === 'string' && hash) hashes.add(hash);
            }
        }
        const missing = [];
        for (const hash of hashes) {
            if (!await this.findAttachment(hash)) missing.push(hash);
        }
        return missing.sort();
    }

    toTransportMessage(message) {
        if (!Array.isArray(message.attachments)) return message;
        return {
            ...message,
            attachments: message.attachments.map(attachment => {
                const fileData = attachment?._fileManagerData || {};
                return {
                    type: attachment.type || fileData.type || 'application/octet-stream',
                    name: attachment.name || fileData.name || 'unnamed',
                    size: Number(attachment.size || fileData.size) || 0,
                    hash: attachment.hash || fileData.hash || null,
                    extractedText: attachment.extractedText || fileData.extractedText || null,
                    imageFrames: attachment.imageFrames || fileData.imageFrames || null,
                    createdAt: attachment.createdAt || fileData.createdAt || null
                };
            })
        };
    }

    async findAttachment(hash) {
        const dir = path.join(this.appDataPath, 'UserData', 'attachments');
        const names = await fs.readdir(dir).catch(() => []);
        const match = names.find(name => name === hash || name.startsWith(`${hash}.`));
        return match ? path.join(dir, match) : null;
    }

    async uploadAttachment(hash) {
        const filePath = await this.findAttachment(hash);
        if (!filePath) {
            this.logger.warn?.(
                `[DesktopSync] Attachment ${hash} is required by the sync server but is missing locally; ` +
                'continuing the main sync and waiting for another device to upload it.',
            );
            return { status: 'missing', hash };
        }
        const data = await fs.readFile(filePath);
        await this.api(`/upload-attachment?hash=${encodeURIComponent(hash)}&name=${encodeURIComponent(path.basename(filePath))}`, {
            method: 'POST',
            body: data,
            headers: { 'content-type': 'application/octet-stream' }
        });
        return { status: 'uploaded', hash };
    }

    async buildAvatarManifest() {
        const items = [];
        const userAvatar = path.join(this.appDataPath, 'UserData', 'user_avatar.png');
        if (await fs.pathExists(userAvatar)) {
            const [buffer, stats] = await Promise.all([fs.readFile(userAvatar), fs.stat(userAvatar)]);
            items.push({ id: 'user:user_avatar', type: 'user', ownerId: 'user_avatar', filePath: userAvatar, hash: sha256(buffer), ts: Math.trunc(stats.mtimeMs) });
        }
        for (const [type, folder] of [['agent', 'Agents'], ['group', 'AgentGroups']]) {
            const entries = await fs.readdir(path.join(this.appDataPath, folder), { withFileTypes: true }).catch(() => []);
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
                    const filePath = path.join(this.appDataPath, folder, entry.name, `avatar.${ext}`);
                    if (!await fs.pathExists(filePath)) continue;
                    const [buffer, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
                    items.push({ id: `${type}:${entry.name}`, type, ownerId: entry.name, filePath, hash: sha256(buffer), ts: Math.trunc(stats.mtimeMs) });
                    break;
                }
            }
        }
        return items;
    }

    async syncAvatars(ws) {
        const avatars = await this.buildAvatarManifest();
        const response = await this.wsRequest(ws, {
            type: 'SYNC_MANIFEST',
            dataType: 'avatar',
            phase: 1,
            data: avatars.map(({ id, hash, ts }) => ({ id, hash, ts }))
        });
        const localMap = new Map(avatars.map(item => [item.id, item]));
        const pulledAvatarIds = [];
        for (const action of response.data || []) {
            const [type, ownerId] = String(action.id || '').split(':');
            if (!type || !ownerId) continue;
            if (action.action === 'PULL') {
                const result = await this.api(`/download-avatar?id=${encodeURIComponent(ownerId)}&type=${encodeURIComponent(type)}`);
                const target = type === 'user'
                    ? path.join(this.appDataPath, 'UserData', 'user_avatar.png')
                    : path.join(this.appDataPath, type === 'group' ? 'AgentGroups' : 'Agents', ownerId, 'avatar.png');
                await fs.ensureDir(path.dirname(target));
                await fs.writeFile(target, Buffer.from(await result.arrayBuffer()));
                pulledAvatarIds.push(action.id);
            } else if (action.action === 'PUSH') {
                const local = localMap.get(action.id);
                if (!local) continue;
                await this.api(`/upload-avatar?id=${encodeURIComponent(local.ownerId)}&type=${encodeURIComponent(local.type)}`, {
                    method: 'POST',
                    body: await fs.readFile(local.filePath),
                    headers: { 'content-type': 'application/octet-stream' }
                });
            }
        }
        return { pulledAvatarIds };
    }

    async writeJsonAtomic(filePath, value) {
        await writeJsonAtomic(filePath, value);
    }
}

module.exports = {
    DesktopSyncService,
    stableStringify,
    hashDto,
    hashMessage,
    sanitizeConfig
};
