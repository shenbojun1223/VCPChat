const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');
const {
    computeMessageFingerprint,
    computeMessageLeafHash,
} = require('../../../VCPDistributedServer/Plugin/VCPMobileSync/core/hash');
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
const WIRE_PROTOCOL_VERSION = '1.4';
const MOBILE_SYNC_PLUGIN_VERSION = '1.4.0';

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
    return computeMessageFingerprint(message);
}

function aggregateHashes(hashes) {
    if (!hashes.length) return '';
    return sha256([...hashes].sort().join(''));
}

function ownerIdentityKey(value) {
    return `${value.ownerType}\0${value.ownerId}`;
}

function topicIdentityKey(value) {
    return `${value.ownerType}\0${value.ownerId}\0${value.topicId ?? value.id}`;
}

function messageUpdatedAt(message) {
    for (const value of [message?.updatedAt, message?.timestamp]) {
        if (Number.isSafeInteger(value) && value >= 0) return value;
    }
    return 0;
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
            .sort((left, right) => topicIdentityKey(left).localeCompare(topicIdentityKey(right)))
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
                const ws = await this.openWebSocket();
                try {
                    const version = await this.wsRequest(ws, {
                        type: 'VERSION_CHECK',
                        mobileVersion: 'vcpchat-desktop-sync-1.4',
                        protocolVersion: WIRE_PROTOCOL_VERSION
                    });
                    if (
                        version.pluginVersion !== MOBILE_SYNC_PLUGIN_VERSION ||
                        version.protocolVersion !== WIRE_PROTOCOL_VERSION
                    ) {
                        throw new Error(
                            `同步协议不兼容：服务端插件 ${version.pluginVersion || '未知'}，协议 ${version.protocolVersion || '未知'}`
                        );
                    }
                    const flushedMessageIds = await this.flushMessageTombstones(ws);
                    await this.flushOwnerTombstones(ws);
                    const configSyncResult = await this.syncFullConfigs(ws);
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
                    authorization: `Bearer ${this.settings.token}`,
                    ...(body !== undefined && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}),
                    ...headers,
                    // Select the desktop data contract; Bearer authentication is still required.
                    'X-VCP-Sync-Contract': 'desktop-full-v1'
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
                SYNC_MANIFEST_REQUEST: 'SYNC_MANIFEST_RESULT',
                SYNC_TOPIC_DIFF_REQUEST: 'SYNC_TOPIC_DIFF_RESULT',
                SYNC_MESSAGE_DIFF_REQUEST: 'SYNC_MESSAGE_DIFF_RESULT',
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

    wsSend(ws, payload) {
        return new Promise((resolve, reject) => {
            ws.send(JSON.stringify(payload), error => error ? reject(error) : resolve());
        });
    }

    async confirmPriorFrames(ws, phase) {
        await this.wsRequest(ws, { type: 'PHASE_START', phase });
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

    async syncFullConfigs(ws) {
        let localItems = await this.listConfigs();
        const manifest = await this.wsRequest(ws, {
            type: 'SYNC_MANIFEST_REQUEST',
            manifestType: 'owner',
            items: localItems.map(item => ({
                ownerType: item.type,
                ownerId: item.id,
                configHash: item.hash,
                contentHash: '',
                updatedAt: item.ts,
            })),
        });
        const actions = Array.isArray(manifest.results) ? manifest.results : [];
        const pulls = actions.filter(item => item.action === 'PULL');
        const pushes = actions.filter(item => item.action === 'PUSH');
        const deletes = actions.filter(item => item.action === 'PULL_DELETE');

        const deletedConfigIds = await this.applyRemoteOwnerDeletions(deletes);

        if (pulls.length) {
            const response = await this.apiJson('/entities/pull', {
                method: 'POST',
                body: {
                    items: pulls.map(action => ({
                        entityType: 'owner',
                        ownerType: action.ownerType,
                        ownerId: action.ownerId,
                    })),
                },
            });
            for (const remote of response.results || []) {
                if (remote.ok !== true) {
                    throw new Error(syncErrorMessage(remote.error, `Owner pull failed for ${remote.ownerId}`));
                }
                await this.applyRemoteConfig(remote);
            }
        }

        if (pushes.length) {
            localItems = await this.listConfigs();
            const localMap = new Map(localItems.map(item => [
                ownerIdentityKey({ ownerType: item.type, ownerId: item.id }),
                item,
            ]));
            const items = pushes
                .map(action => localMap.get(ownerIdentityKey(action)))
                .filter(Boolean)
                .map(item => ({
                    entityType: 'owner',
                    ownerType: item.type,
                    ownerId: item.id,
                    data: item.data,
                }));
            if (items.length) {
                const response = await this.apiJson('/entities/push', { method: 'POST', body: { items } });
                const failed = (response.results || []).find(item => item.ok !== true);
                if (failed) {
                    throw new Error(syncErrorMessage(failed.error, `Owner push failed for ${failed.ownerId}`));
                }
            }
        }
        return {
            pulledConfigIds: pulls.map(item => `${item.ownerType}:${item.ownerId}`),
            deletedConfigIds,
        };
    }

    async flushMessageTombstones(ws) {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listMessageDeletions(userDataDir);
        if (!tombstones.length) return [];

        for (const tombstone of tombstones) {
            const identity = tombstone.ownerType && tombstone.ownerId
                ? tombstone
                : await this.resolveTopicOwner(tombstone.topicId);
            await this.wsSend(ws, {
                type: 'SYNC_ENTITY_DELETE',
                targetType: 'message',
                ownerType: identity.ownerType,
                ownerId: identity.ownerId,
                topicId: tombstone.topicId,
                msgId: tombstone.msgId,
                deletedAt: tombstone.deletedAt,
            });
        }
        await this.confirmPriorFrames(ws, 'topic_metadata');
        await removeMessageDeletions(userDataDir, tombstones);
        return tombstones.map(item => `${item.topicId}:${item.msgId}`);
    }

    async flushOwnerTombstones(ws) {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listOwnerDeletions(userDataDir);
        if (!tombstones.length) return [];

        for (const tombstone of tombstones) {
            await this.wsSend(ws, {
                type: 'SYNC_ENTITY_DELETE',
                targetType: 'owner',
                ownerType: tombstone.type,
                ownerId: tombstone.id,
                deletedAt: tombstone.deletedAt,
            });
        }
        await this.confirmPriorFrames(ws, 'owner_metadata');
        await removeOwnerDeletions(userDataDir, tombstones);
        return tombstones.map(item => `${item.type}:${item.id}`);
    }

    async resolveTopicOwner(topicId) {
        const matches = [];
        for (const owner of await this.listConfigs()) {
            const config = await fs.readJson(owner.filePath);
            if ((config.topics || []).some(topic => topic?.id === topicId)) {
                matches.push({ ownerType: owner.type, ownerId: owner.id });
            }
        }
        if (matches.length !== 1) {
            throw new Error(`无法唯一确定话题 ${topicId} 的 Owner，消息删除将保留并稍后重试`);
        }
        return matches[0];
    }

    async applyRemoteOwnerDeletions(actions) {
        const deleted = [];
        for (const action of actions) {
            const type = action?.ownerType;
            const id = typeof action?.ownerId === 'string' ? action.ownerId : '';
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
        const folder = remote.ownerType === 'group' ? 'AgentGroups' : 'Agents';
        const filePath = path.join(this.appDataPath, folder, remote.ownerId, 'config.json');
        await fs.ensureDir(path.dirname(filePath));
        let existing = {};
        try { existing = await fs.readJson(filePath); } catch {}
        const topics = Array.isArray(existing.topics) ? existing.topics : [];
        const merged = { ...existing, ...sanitizeConfig(remote.data), topics };
        if (remote.ownerType === 'group') merged.id = remote.ownerId;
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
                if (!topic?.id) continue;
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
                const messageStates = {};
                for (const message of messages) {
                    if (!message?.id) continue;
                    const messageHash = hashMessage(message);
                    messageHashes[message.id] = messageHash;
                    messageStates[message.id] = {
                        messageHash,
                        updatedAt: messageUpdatedAt(message),
                    };
                }
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
                    contentHash: aggregateHashes(Object.entries(messageHashes).map(
                        ([messageId, messageHash]) => computeMessageLeafHash(messageId, messageHash),
                    )),
                    ts: Math.max(owner.ts, historyMtime),
                    messageHashes,
                    messageStates,
                    messages,
                    historyPath
                });
            }
        }
        return topics;
    }

    async syncTopicsAndMessages(ws) {
        await this.flushTopicTombstones(ws);
        let topics = await this.buildTopicState();
        const pulledTopicIds = new Set();
        const deletedTopicIds = new Set();
        let metadataStable = false;
        for (let pass = 0; pass < 3; pass++) {
            const advertisedFingerprint = topicMetadataFingerprint(topics);
            const owners = await this.listConfigs();
            const targetedOwners = new Map();
            for (const owner of owners) {
                const identity = { ownerType: owner.type, ownerId: owner.id };
                targetedOwners.set(ownerIdentityKey(identity), identity);
            }
            for (const topic of topics) {
                const identity = { ownerType: topic.ownerType, ownerId: topic.ownerId };
                targetedOwners.set(ownerIdentityKey(identity), identity);
            }
            const manifestResponse = await this.wsRequest(ws, {
                type: 'SYNC_MANIFEST_REQUEST',
                manifestType: 'topic',
                targetedOwners: [...targetedOwners.values()],
                items: topics.map(topic => ({
                    topicId: topic.id,
                    configHash: topic.configHash,
                    contentHash: topic.contentHash,
                    updatedAt: topic.ts,
                    ownerType: topic.ownerType,
                    ownerId: topic.ownerId
                }))
            });

            const actions = Array.isArray(manifestResponse.results) ? manifestResponse.results : [];
            const pulls = actions.filter(item => item.action === 'PULL');
            const pushes = actions.filter(item => item.action === 'PUSH');
            const remoteDeletes = actions.filter(item => item.action === 'PULL_DELETE');
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
            type: 'SYNC_MESSAGE_DIFF_REQUEST',
            topics: topics.map(topic => ({
                topicId: topic.id,
                ownerType: topic.ownerType,
                ownerId: topic.ownerId,
                contentHash: topic.contentHash,
                messages: topic.messageStates,
            }))
        });
        if (!Array.isArray(diff.results)) {
            throw new Error('消息差异同步失败：服务端未返回 1.4 结果数组');
        }
        const results = new Map();
        for (const result of diff.results) {
            const key = topicIdentityKey(result);
            if (results.has(key)) throw new Error(`消息差异同步失败：重复话题结果 ${result.topicId}`);
            results.set(key, result);
        }
        const failedTopics = topics.filter(topic => {
            const result = results.get(topicIdentityKey(topic));
            return !result || result.ok === false || result.error;
        });
        if (failedTopics.length) {
            const details = failedTopics.slice(0, 5).map(topic => {
                const result = results.get(topicIdentityKey(topic));
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

    async flushTopicTombstones(ws) {
        const userDataDir = path.join(this.appDataPath, 'UserData');
        const tombstones = await listTopicDeletions(userDataDir);
        if (!tombstones.length) return [];

        for (const tombstone of tombstones) {
            await this.wsSend(ws, {
                type: 'SYNC_ENTITY_DELETE',
                targetType: 'topic',
                ownerType: tombstone.ownerType,
                ownerId: tombstone.ownerId,
                topicId: tombstone.id,
                deletedAt: tombstone.deletedAt,
            });
        }
        await this.confirmPriorFrames(ws, 'topic_metadata');
        await removeTopicDeletions(userDataDir, tombstones);
        return tombstones.map(item => item.id);
    }

    async applyRemoteTopicDeletions(actions, topics = []) {
        const localById = new Map(topics.map(topic => [topicIdentityKey(topic), topic]));
        const deletedTopicIds = [];
        for (const action of actions) {
            const topicId = action.topicId;
            const local = localById.get(topicIdentityKey(action));
            const ownerId = action.ownerId || local?.ownerId;
            const ownerType = action.ownerType || local?.ownerType;
            if (!topicId || !ownerId || !['agent', 'group'].includes(ownerType)) {
                throw new Error(`Topic deletion ${topicId || '<unknown>'} is missing owner identity`);
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
                    const remaining = config.topics.filter(topic => topic?.id !== topicId);
                    removed = remaining.length !== config.topics.length;
                    if (removed) {
                        config.topics = remaining;
                        await this.writeJsonAtomic(configPath, config);
                    }
                }
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }

            const topicDir = path.join(this.appDataPath, 'UserData', ownerId, 'topics', topicId);
            if (await fs.pathExists(topicDir)) {
                await fs.remove(topicDir);
                removed = true;
            }
            if (removed) deletedTopicIds.push(topicId);
        }
        return deletedTopicIds;
    }

    async pullTopics(actions) {
        const response = await this.apiJson('/entities/pull', {
            method: 'POST',
            body: {
                items: actions.map(item => ({
                    entityType: 'topic',
                    topicId: item.topicId,
                    ownerType: item.ownerType,
                    ownerId: item.ownerId,
                }))
            }
        });
        const pulledTopicIds = [];
        for (const remote of response.results || []) {
            if (remote?.ok !== true) {
                throw new Error(syncErrorMessage(
                    remote.error,
                    `Topic pull failed for ${remote.topicId || '<unknown>'}`,
                ));
            }
            const data = remote.data || {};
            const ownerId = remote.ownerId;
            const ownerType = remote.ownerType;
            if (!ownerId) continue;
            const configPath = path.join(
                this.appDataPath,
                ownerType === 'group' ? 'AgentGroups' : 'Agents',
                ownerId,
                'config.json'
            );
            const config = await fs.readJson(configPath);
            if (!Array.isArray(config.topics)) config.topics = [];
            const index = config.topics.findIndex(topic => topic.id === remote.topicId);
            const current = index >= 0 ? config.topics[index] : {};
            const topic = { ...current, ...data, id: remote.topicId };
            delete topic.ownerId;
            delete topic.ownerType;
            if (index >= 0) config.topics[index] = topic;
            else config.topics.push(topic);
            await this.writeJsonAtomic(configPath, config);
            const historyPath = path.join(this.appDataPath, 'UserData', ownerId, 'topics', remote.topicId, 'history.json');
            if (!await fs.pathExists(historyPath)) await this.writeJsonAtomic(historyPath, []);
            pulledTopicIds.push(remote.topicId);
        }
        return { pulledTopicIds };
    }

    async pushTopics(actions, topics) {
        const topicMap = new Map(topics.map(topic => [topicIdentityKey(topic), topic]));
        const items = actions.map(action => topicMap.get(topicIdentityKey(action))).filter(Boolean).map(topic => ({
            entityType: 'topic',
            topicId: topic.id,
            ownerType: topic.ownerType,
            ownerId: topic.ownerId,
            data: topic.dto
        }));
        if (items.length) {
            const response = await this.apiJson('/entities/push', { method: 'POST', body: { items } });
            const failed = (response.results || []).find(item => item.ok !== true);
            if (failed) throw new Error(syncErrorMessage(failed.error, `Topic push failed for ${failed.topicId}`));
        }
    }

    async pullMessages(results, topics, snapshots = new Map(), pulledTopicIds = new Set()) {
        const requests = [];
        for (const topic of topics) {
            const ids = results.get(topicIdentityKey(topic))?.pullMessageIds;
            if (Array.isArray(ids) && ids.length) requests.push({
                topicId: topic.id,
                ownerType: topic.ownerType,
                ownerId: topic.ownerId,
                messageIds: ids
            });
        }
        if (!requests.length) return;
        const response = await this.api('/messages/pull', { method: 'POST', body: { topics: requests } });
        const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
        const topicMap = new Map(topics.map(topic => [topicIdentityKey(topic), topic]));
        for (const line of lines) {
            const frame = JSON.parse(line);
            const topic = topicMap.get(topicIdentityKey(frame));
            if (frame.kind === 'error' || frame.ok === false) {
                throw new Error(
                    syncErrorMessage(frame.error),
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
                    const result = results.get(topicIdentityKey(topic));
                    if (result) result.pushTopic = true;
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
            const tombstones = results.get(topicIdentityKey(topic))?.deleteMessages;
            if (tombstones === undefined) continue;
            if (
                !Array.isArray(tombstones) ||
                tombstones.some(item =>
                    !item ||
                    typeof item.msgId !== 'string' ||
                    !item.msgId ||
                    !Number.isSafeInteger(item.deletedAt) ||
                    item.deletedAt < 0
                ) ||
                new Set(tombstones.map(item => item.msgId)).size !== tombstones.length
            ) {
                throw new Error(
                    `消息删除结果格式无效：${topic.id}`,
                );
            }
            const ids = tombstones.map(item => item.msgId);
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
                this.logger.warn?.(
                    `[DesktopSync] Attachment ${hash.slice(0, 12)} is referenced but unavailable locally; keeping a placeholder.`,
                );
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
        const selected = topics.filter(topic => results.get(topicIdentityKey(topic))?.pushTopic === true);
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
            kind: 'topic',
            topicId: topic.id,
            ownerType: topic.ownerType,
            ownerId: topic.ownerId,
            messages: messages.map(message => this.toTransportMessage(message)),
            deletedMessages: [],
        })).join('\n') + '\n';
        const response = await this.api('/messages/push', {
            method: 'POST',
            body,
            headers: { 'content-type': 'application/x-ndjson' }
        });
        const lines = (await response.text()).split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            const frame = JSON.parse(line);
            if (frame.kind === 'error' || frame.ok === false) {
                throw new Error(syncErrorMessage(
                    frame.error,
                    `Message push failed for ${frame.topicId || 'unknown topic'}`,
                ));
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
            type: 'SYNC_MANIFEST_REQUEST',
            manifestType: 'avatar',
            items: avatars.map(item => ({
                ownerType: item.type,
                ownerId: item.ownerId,
                binaryHash: item.hash,
                updatedAt: item.ts,
            })),
        });
        const localMap = new Map(avatars.map(item => [ownerIdentityKey({
            ownerType: item.type,
            ownerId: item.ownerId,
        }), item]));
        const pulledAvatarIds = [];
        for (const action of response.results || []) {
            const type = action.ownerType;
            const ownerId = action.ownerId;
            if (!type || !ownerId) continue;
            if (action.action === 'PULL') {
                const result = await this.api(`/avatars/pull?ownerId=${encodeURIComponent(ownerId)}&ownerType=${encodeURIComponent(type)}`);
                const target = type === 'user'
                    ? path.join(this.appDataPath, 'UserData', 'user_avatar.png')
                    : path.join(this.appDataPath, type === 'group' ? 'AgentGroups' : 'Agents', ownerId, 'avatar.png');
                await fs.ensureDir(path.dirname(target));
                await fs.writeFile(target, Buffer.from(await result.arrayBuffer()));
                pulledAvatarIds.push(`${type}:${ownerId}`);
            } else if (action.action === 'PUSH') {
                const local = localMap.get(ownerIdentityKey(action));
                if (!local) continue;
                await this.api(`/avatars/push?ownerId=${encodeURIComponent(local.ownerId)}&ownerType=${encodeURIComponent(local.type)}`, {
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
