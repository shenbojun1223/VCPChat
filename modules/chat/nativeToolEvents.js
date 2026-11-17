// Presentation-only metadata. Never dispatch tools or turn these records into
// model messages. "transport_reported" is not independent execution verification.
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;
const STATES = new Set([
    'pending', 'running', 'succeeded', 'failed', 'denied', 'cancelled', 'unknown',
]);
const TERMINAL = new Set(['succeeded', 'failed', 'denied', 'cancelled', 'unknown']);

export function normalizeNativeToolEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        input.schema !== 1 || input.source !== 'agy-native' ||
        typeof input.requestId !== 'string' || !ID.test(input.requestId) ||
        typeof input.callId !== 'string' || !ID.test(input.callId) ||
        !Number.isSafeInteger(input.revision) || input.revision < 0 ||
        !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
        !STATES.has(input.status) || input.detailsPolicy !== 'withheld' ||
        !['transport_reported', 'missing_terminal'].includes(input.evidence)) return null;
    if (input.name !== null &&
        (typeof input.name !== 'string' || !NAME.test(input.name))) return null;
    if (input.evidence === 'missing_terminal' && input.status !== 'unknown') return null;
    return Object.freeze({
        schema: 1,
        source: 'agy-native',
        requestId: input.requestId,
        callId: input.callId,
        revision: input.revision,
        sequence: input.sequence,
        name: input.name,
        status: input.status,
        evidence: input.evidence,
        detailsPolicy: 'withheld',
    });
}

/** Correlate metadata with its own upstream SSE envelope, not with a model label.
 * This is not source authentication. One VCP operation may span upstream rounds.
 */
export function normalizeNativeToolFrame(frame) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
        frame.object !== 'chat.completion.chunk' || Object.hasOwn(frame, 'error') ||
        !Array.isArray(frame.choices) || frame.choices.length !== 1) return null;
    const choice = frame.choices[0];
    const delta = choice?.delta;
    if (choice?.index !== 0 || choice.finish_reason !== null ||
        !delta || typeof delta !== 'object' || Array.isArray(delta) ||
        Object.keys(delta).some(key => key !== 'content' || delta[key] !== '')) return null;
    const event = normalizeNativeToolEvent(frame.vcp_native_tool);
    return event && frame.id === event.requestId ? event : null;
}
/** One instance per owned stream operation, never a global cross-topic store. */
export function createNativeToolState({ maxCalls = 128, maxEvents = 2048 } = {}) {
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 512 ||
        !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 8192) {
        throw new RangeError('Invalid native tool display limits');
    }
    const calls = new Map();
    let events = 0;
    let closed = false;
    const snapshot = () => Object.freeze([...calls.values()]);
    function accept(input) {
        if (closed) return { accepted: false, reason: 'closed' };
        if (++events > maxEvents) return { accepted: false, reason: 'event_limit' };
        const next = normalizeNativeToolEvent(input);
        if (!next) return { accepted: false, reason: 'invalid' };
        const key = `${next.requestId}\u0000${next.callId}`;
        const previous = calls.get(key);
        if (previous) {
            if (next.sequence <= previous.sequence ||
                next.revision < previous.revision) {
                return { accepted: false, reason: 'stale' };
            }
            // close() may emit missing_terminal with the last transport revision.
            if (next.revision === previous.revision &&
                next.evidence !== 'missing_terminal') {
                return { accepted: false, reason: 'stale' };
            }
            if (previous.name !== null && next.name !== previous.name) {
                return { accepted: false, reason: 'identity_conflict' };
            }
            if (TERMINAL.has(previous.status)) {
                return { accepted: false, reason:
                    next.status === previous.status ? 'duplicate_terminal' : 'terminal_conflict' };
            }
            if (previous.status === 'running' && next.status === 'pending') {
                return { accepted: false, reason: 'regression' };
            }
        } else if (calls.size >= maxCalls) {
            return { accepted: false, reason: 'call_limit' };
        }
        calls.set(key, next);
        return { accepted: true, event: next };
    }
    function close() {
        if (!closed) {
            closed = true;
            for (const [key, value] of calls) {
                if (!TERMINAL.has(value.status)) {
                    calls.set(key, Object.freeze({
                        ...value, status: 'unknown', evidence: 'missing_terminal',
                    }));
                }
            }
        }
        return snapshot();
    }
    return Object.freeze({ accept, snapshot, close });
}

/** Validate a snapshot without retaining unknown fields.
 * Finalization marks unfinished calls unknown; live projections preserve state.
 */
export function normalizeNativeToolSnapshot(input, { finalize = true } = {}) {
    if (!Array.isArray(input) || input.length > 128) return null;
    const state = createNativeToolState();
    const seen = new Set();
    for (const item of input) {
        const event = normalizeNativeToolEvent(item);
        if (!event) return null;
        const key = `${event.requestId}\u0000${event.callId}`;
        if (seen.has(key)) return null;
        seen.add(key);
        if (!state.accept(event).accepted) return null;
    }
    return finalize ? state.close() : state.snapshot();
}