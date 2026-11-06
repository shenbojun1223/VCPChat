/** Main-window only; host owns credentials, report intake and durable consumption state. */
export function createDelegationResumeOwner({ api, chatManager, getSelection, getTopicId,
    schedule = setTimeout, unschedule = clearTimeout, randomId = () => crypto.randomUUID() }) {
    let stopped = false, enabled = false, timer = null, active = null, unsubscribe = null;
    const outcomeOf = result => {
        const event = result?.terminal?.event;
        if (!event || event.outcome?.persistence?.error) return { type: 'uncertain' };
        if (event.type === 'cancelled' || event.type === 'discarded') return { type: 'cancelled' };
        if (event.type === 'completed' && event.outcome?.persistence?.value) return { type: 'completed', persisted: true };
        if (event.type === 'failed' && event.outcome?.persistence?.value) return { type: 'failed', persisted: true };
        return { type: 'uncertain' };
    };
    async function dispatch(payload) {
        const run = active;
        if (!run || payload?.requestId !== run.requestId || run.dispatched) return;
        run.dispatched = true;
        let outcome = { type: 'uncertain' };
        try {
            if (stopped || !run.lease.valid() || payload.scope?.agentId !== run.scope.agentId
                || payload.scope?.topicId !== run.scope.topicId || typeof payload.content !== 'string'
                || payload.content.length > 4096) return;
            const result = await chatManager.handleSendMessage({
                content: payload.content, attachments: [], awaitTerminal: true, propagateError: true,
                delegationLease: run.lease, signal: run.lease.signal,
                delegationDispatch: { requestId: run.requestId, token: payload.token },
            });
            outcome = outcomeOf(result);
        } catch { /* Ambiguous send/persistence is never automatically retried. */ }
        finally {
            try { await api.settleDelegationDispatch({ requestId: run.requestId, token: payload.token, outcome }); }
            catch { /* Main timeout/restart retains uncertain responsibility. */ }
        }
    }
    async function tick() {
        if (stopped || !enabled || active) return;
        const selected = getSelection();
        if (selected?.type !== 'agent' || !getTopicId()) return;
        const scope = { agentId: selected.id, topicId: getTopicId(), sessionId: null };
        const lease = chatManager.tryAcquireDelegationLease(scope); // synchronous, before any IPC await
        if (!lease) return;
        const run = { scope, lease, requestId: randomId(), dispatched: false };
        active = run;
        try { await api.consumeDelegationInbox({ scope, requestId: run.requestId }); }
        catch { /* Disk responsibility is retained by the host. */ }
        finally {
            // IPC timeout is uncertain delivery, not permission to overlap the live local model.
            await run.dispatchTask?.catch(() => {});
            lease.release();
            if (active === run) active = null;
        }
    }
    function next() {
        if (stopped) return;
        timer = schedule(() => {
            timer = null;
            void tick().finally(next);
        }, 30000);
    }
    const ready = (async () => {
        if (!api?.getDelegationStatus || !api?.onDelegationDispatch
            || !api?.consumeDelegationInbox || !api?.settleDelegationDispatch) return false;
        const status = await api.getDelegationStatus();
        if (stopped || status?.enabled !== true) return false;
        enabled = true;
        unsubscribe = api.onDelegationDispatch(payload => {
            const run = active;
            if (!run || run.dispatched || payload?.requestId !== run.requestId) return;
            run.dispatchTask = dispatch(payload);
        });
        next();
        return true;
    })().catch(() => false);
    return Object.freeze({
        ready, tick,
        dispose() {
            stopped = true;
            unschedule(timer);
            unsubscribe?.();
            // Do not interrupt an active reply. Host timeout/restart reconciles an unacknowledged dispatch.
            if (!active?.dispatched) active?.lease.release();
        },
    });
}