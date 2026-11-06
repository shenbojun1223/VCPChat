'use strict';
const crypto = require('node:crypto');

// No report body/credentials cross this bridge. The journal remains the only consumption truth.
function createDelegationDispatch({ host, webContents, schedule = setTimeout, unschedule = clearTimeout,
    timeoutMs = 600000 }) {
    let active = null, closed = false;
    function trusted(event) {
        return !closed && !webContents.isDestroyed()
            && event?.sender === webContents && event.senderFrame === webContents.mainFrame;
    }
    function stop() {
        closed = true;
        active?.finish({ type: 'uncertain' });
    }
    return Object.freeze({
        trusted,
        async status(event) {
            if (!trusted(event) || !host) return { enabled: false };
            try { return { enabled: await host.isAutoResumeEnabled() }; }
            catch { return { enabled: false }; }
        },
        async consume(event, { scope, requestId } = {}) {
            if (!trusted(event) || !host || active || typeof requestId !== 'string'
                || !/^[a-f0-9-]{36}$/.test(requestId)) return { skipped: true };
            const attempt = { requestId, token: crypto.randomBytes(24).toString('hex'), finish: () => {} };
            active = attempt;
            let timer;
            try {
                return await host.consumeOne(scope, {
                    tryAcquire: () => ({
                        valid: () => active === attempt && trusted(event),
                        release() {},
                    }),
                    send: payload => new Promise(resolve => {
                        let settled = false;
                        attempt.finish = outcome => {
                            if (settled) return;
                            settled = true;
                            attempt.finished = true;
                            unschedule(timer);
                            resolve(outcome);
                        };
                        timer = schedule(() => attempt.finish({ type: 'uncertain' }), timeoutMs);
                        timer?.unref?.();
                        if (!trusted(event)) return attempt.finish({ type: 'uncertain' });
                        active.scope = { ...payload.scope };
                        // Content is constructed by host.resumePrompt, never supplied by the renderer/callback.
                        try { webContents.send('delegation-dispatch', { requestId, token: attempt.token, ...payload }); }
                        catch { attempt.finish({ type: 'uncertain' }); }
                    }),
                });
            } catch { return { uncertain: true }; }
            finally {
                unschedule(timer);
                if (active === attempt) active = null;
            }
        },
        authorizeSend(event, proof, scope, messageId, commit = false) {
            if (!trusted(event) || !active || !active.scope || !proof
                || proof.requestId !== active.requestId || proof.token !== active.token
                || scope?.agentId !== active.scope.agentId || scope?.topicId !== active.scope.topicId
                || typeof messageId !== 'string' || !messageId || active.sent || active.finished) {
                throw new Error('DELEGATION_DISPATCH_REVOKED');
            }
            if (active.messageId && active.messageId !== messageId) throw new Error('DELEGATION_DISPATCH_REVOKED');
            active.messageId = messageId;
            if (commit) active.sent = true;
            return true;
        },
        settle(event, reply = {}) {
            if (!trusted(event) || !active || reply.requestId !== active.requestId
                || reply.token !== active.token) return { accepted: false };
            // Only the trusted main-frame committed terminal adapter may assert persistence.
            const type = ['completed', 'failed', 'cancelled'].includes(reply.outcome?.type)
                ? reply.outcome.type : 'uncertain';
            active.finish({ type, persisted: reply.outcome?.persisted === true });
            return { accepted: true };
        },
        close: stop,
    });
}
module.exports = { createDelegationDispatch };