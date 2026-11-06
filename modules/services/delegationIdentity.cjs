'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CHAT_PATHS = new Set(['/v1/chat/completions', '/v1/chatvcp/completions']);
const SIGNED_PATHS = new Set([...CHAT_PATHS, '/v1/delegations/inbox', '/v1/delegations/report']);
const forbidden = /^(?:group(?:_|$)|assistant_chat(?:_|$)|sidechat_|voicechat_)/i;

function deny() { throw new Error('DELEGATION_AUTHORITY_DENIED'); }
function text(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 200
        && value.trim() === value && ![...value].some(char => char.charCodeAt(0) < 32);
}
function segment(value) {
    return text(value) && value !== '.' && value !== '..'
        && !/[\\/:*?"<>|]/.test(value) && !/[. ]$/.test(value) && !forbidden.test(value);
}
function isSingleScope(scope) {
    return scope && segment(scope.agentId) && segment(scope.topicId)
        && !scope.groupId && scope.isGroupMessage !== true
        && (scope.itemType == null || scope.itemType === 'agent')
        && (scope.ownerType == null || scope.ownerType === 'agent')
        && scope.sessionId == null;
}
function origin(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== '/'
        || ![url.origin, `${url.origin}/`].includes(value)) deny();
    return url.origin;
}
async function readSmallJson(file, fsp = fs, limit = 1024 * 1024) {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size > limit) deny();
    const bytes = await fsp.readFile(file);
    if (bytes.length > limit) deny();
    return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}
async function loadIdentity({ env = process.env, fsPromises = fs } = {}) {
    const file = env.VCP_DELEGATION_IDENTITY_FILE;
    if (!file) return null; // No file access, directory creation, timer or network when absent.
    const config = await readSmallJson(file, fsPromises, 65536);
    if (config.enabled !== true) return null;
    if (config.version !== 1 || !text(config.keyId) || !text(config.sourceNode)
        || !text(config.caller) || typeof config.privateKeyPem !== 'string') deny();
    const privateKey = crypto.createPrivateKey(config.privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ed25519') deny();
    return Object.freeze({
        version: 1, enabled: true, keyId: config.keyId, privateKey,
        serverOrigin: origin(config.serverOrigin), autoResume: config.autoResume === true,
        sourceNode: config.sourceNode, caller: config.caller,
    });
}
function inside(root, target) {
    const rel = path.relative(root, target);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
async function authorizeScope(scope, { agentConfigManager, userDataDir, fsPromises = fs }) {
    if (!isSingleScope(scope) || !agentConfigManager?.getAgentPaths
        || !agentConfigManager?.readAgentConfig || !agentConfigManager.agentDir) deny();
    const { agentId, topicId } = scope;
    const configPath = agentConfigManager.getAgentPaths(agentId).configPath;
    const historyPath = path.join(userDataDir, agentId, 'topics', topicId, 'history.json');
    const [agentRoot, historyRoot, configReal, historyReal] = await Promise.all([
        fsPromises.realpath(agentConfigManager.agentDir), fsPromises.realpath(userDataDir),
        fsPromises.realpath(configPath), fsPromises.realpath(historyPath),
    ]);
    if (!inside(agentRoot, configReal) || !inside(historyRoot, historyReal)) deny();
    const canonical = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
    const ownerId = agentConfigManager.normalizeId?.(agentId) || agentId;
    // No junction/symlink may borrow a sibling owner's config or topic history.
    if (canonical(configReal) !== canonical(path.join(agentRoot, ownerId, 'config.json'))
        || canonical(historyReal) !== canonical(path.join(historyRoot, agentId, 'topics', topicId, 'history.json'))) deny();
    // Manager fallback/cache is useful for UI, but is not evidence that an owner still exists.
    const disk = await readSmallJson(configReal, fsPromises);
    const config = await agentConfigManager.readAgentConfig(agentId, { allowDefault: false });
    const normalize = id => agentConfigManager.normalizeId?.(id) || id;
    for (const candidate of [disk, config]) {
        if (!candidate || (candidate.id != null && normalize(candidate.id) !== normalize(agentId))
            || (candidate.type != null && candidate.type !== 'agent')
            || candidate.delegationAutoResume === false
            || !Array.isArray(candidate.topics)) deny();
        const topic = candidate.topics.find(item => item?.id === topicId);
        if (!topic || topic.deleted === true || topic.cancelled === true
            || topic.delegationAutoResume === false
            || (topic.type != null && topic.type !== 'agent' && topic.type !== 'chat')) deny();
    }
    const history = await fsPromises.stat(historyReal);
    if (!history.isFile()) deny();
    return { agentId, topicId, sessionId: null };
}
function hostId(identity) {
    return crypto.createHash('sha256').update(JSON.stringify([
        identity.serverOrigin, identity.keyId, identity.sourceNode, identity.caller,
    ])).digest('hex');
}
function scopeId(identity, scope) {
    return crypto.createHash('sha256').update(JSON.stringify([
        hostId(identity), scope.agentId, scope.topicId, null,
    ])).digest('hex');
}
function signRequest(identity, scope, urlString, serializedBody, { now = Date.now, randomBytes = crypto.randomBytes } = {}) {
    if (!identity || !isSingleScope(scope) || typeof serializedBody !== 'string') deny();
    const url = new URL(urlString);
    if (url.origin !== identity.serverOrigin || url.username || url.password
        || url.search || url.hash || !SIGNED_PATHS.has(url.pathname)) deny();
    const issuedAt = now();
    if (!Number.isSafeInteger(issuedAt)) deny();
    const claims = {
        version: 1,
        keyId: identity.keyId,
        nonce: randomBytes(16).toString('hex'),
        issuedAt,
        expiresAt: issuedAt + 60000,
        method: 'POST',
        path: url.pathname,
        bodyHash: crypto.createHash('sha256').update(serializedBody, 'utf8').digest('hex'),
        agentId: scope.agentId,
        topicId: scope.topicId,
        sessionId: null,
        autoResumeEligible: identity.enabled === true && identity.autoResume === true,
    };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(claims), 'utf8'), identity.privateKey).toString('base64url');
    // Proof must remain in the transport header, never messages, settings, logs or sync.
    return Buffer.from(JSON.stringify({ claims, signature }), 'utf8').toString('base64url');
}

module.exports = {
    CHAT_PATHS, loadIdentity, authorizeScope, signRequest, hostId, scopeId,
    isSingleScope, readSmallJson,
};