import { createStreamCoordinator } from './streamCoordinator.js';

const MANAGED_TYPES = new Set(['agent_thinking', 'start', 'data', 'end', 'error']);
// VCP message ids are one-shot. Keep a bounded recent terminal cache so delayed
// IPC cannot resurrect an operation without retaining every id for the app lifetime.
const MAX_RETIRED_SESSIONS = 2048;
const TOOL_PAUSE_CODES = new Set(['VCP_TOOL_BLOCK_INCOMPLETE', 'VCP_TOOL_LOOP_STUCK', 'VCP_TOOL_LOOP_LIMIT']);

/** Adapts preload's externally-produced VCP stream events to owner-scoped handles. */
export function createVcpStreamBridge({ createConsumer, reportError = console.error } = {}) {
    if (typeof createConsumer !== 'function') throw new TypeError('VCP stream bridge requires a consumer factory');
    const operations = new Map();
    const consumers = new Map();
    const messageOperations = new Map();
    const retiredSessions = new Set();
    let disposed = false;
    const retireSession = sessionId => {
        if (!sessionId) return;
        retiredSessions.delete(sessionId);
        retiredSessions.add(sessionId);
        while (retiredSessions.size > MAX_RETIRED_SESSIONS) {
            retiredSessions.delete(retiredSessions.values().next().value);
        }
    };

    const coordinator = createStreamCoordinator({
        reportError,
        run: (request, controls) => new Promise(resolve => {
            const operation = {
                controls,
                resolve,
                chain: Promise.resolve(),
                handle: null,
                disposePromise: null,
                cancelPromise: null,
                accepting: true,
                projecting: true,
            };
            operations.set(request.sessionId, operation);
            controls.signal.addEventListener('abort', () => {
                if (operations.get(request.sessionId) === operation) resolve({ kind: 'discarded', reason: controls.signal.reason });
            }, { once: true });
        }),
        persist: value => consumers.get(value.request.sessionId)?.persist?.(value),
    });

    const ensureOperation = event => {
        if (disposed) return null;
        const messageId = String(event?.messageId || '').trim();
        const sessionId = String(event?.streamOperationId || messageId).trim();
        if (!messageId || !sessionId || retiredSessions.has(sessionId)) return null;
        let operation = operations.get(sessionId);
        if (operation) return operation;

        const context = event.context || {};
        const conversationKey = context.groupId
            ? `group:${context.groupId}/topic:${context.topicId || ''}`
            : `agent:${context.agentId || ''}/topic:${context.topicId || ''}`;
        const consumer = createConsumer(event);
        consumers.set(sessionId, consumer);
        messageOperations.set(messageId, sessionId);
        const handle = coordinator.start({
            sessionId,
            messageId,
            conversationKey,
            context,
        }, {
            surfaceGeneration: consumer.surfaceGeneration,
            onEvent: streamEvent => consumer.consume?.(streamEvent),
        });
        handle.done.finally(() => {
            retireSession(sessionId);
            consumer.dispose?.();
            if (operations.get(sessionId)?.handle === handle) operations.delete(sessionId);
            if (consumers.get(sessionId) === consumer) consumers.delete(sessionId);
            if (messageOperations.get(messageId) === sessionId) messageOperations.delete(messageId);
        });
        operation = operations.get(sessionId);
        operation.handle = handle;
        return operation;
    };

    const disposeOperation = (messageId, reason = 'surface-disposed') => {
        const visibleId = String(messageId || '').trim();
        const sessionId = messageOperations.get(visibleId) || visibleId;
        retireSession(sessionId);
        const operation = operations.get(sessionId);
        if (!operation) return Promise.resolve(false);
        if (!operation.disposePromise) {
            operation.accepting = false;
            operation.projecting = false;
            operation.disposePromise = (async () => {
                const outcome = await operation.handle.dispose(reason);
                await Promise.allSettled([operation.chain]);
                return outcome;
            })();
        }
        return operation.disposePromise;
    };
    const cancelOperation = (messageId, reason = 'cancelled') => {
        const visibleId = String(messageId || '').trim();
        const sessionId = messageOperations.get(visibleId) || visibleId;
        const operation = operations.get(sessionId);
        if (!operation) {
            retireSession(sessionId);
            return Promise.resolve(null);
        }
        if (!operation.cancelPromise) {
            operation.accepting = false;
            operation.cancelPromise = operation.chain.then(() => {
                const consumer = consumers.get(sessionId);
                for (const chunk of consumer?.flushChunks?.() ?? []) operation.controls.pushChunk(chunk);
                return operation.handle.cancel(reason);
            });
        }
        return operation.cancelPromise;
    };

    return Object.freeze({
        accept(event) {
            if (!MANAGED_TYPES.has(event?.type) || !event?.messageId) return false;
            const operation = ensureOperation(event);
            if (!operation?.accepting) return false;
            const consumer = consumers.get(String(event.streamOperationId || event.messageId));
            operation.chain = operation.chain.then(async () => {
                if (!operation.projecting) return;
                await consumer?.prepare?.(event);
                if (!operation.projecting) return;
                if (event.type === 'data') {
                    const normalized = consumer?.normalizeChunks?.(event.chunk)
                        ?? [consumer?.normalizeChunk?.(event.chunk) ?? event.chunk];
                    for (const chunk of normalized) operation.controls.pushChunk(chunk);
                }
                if (event.type === 'end' || event.type === 'error') {
                    const cancelled = event.interrupted === true ||
                        ['cancelled', 'canceled', 'cancelled_by_user', 'aborted'].includes(event.finish_reason);
                    const upstreamFailure = {
                        UPSTREAM_STREAM_ERROR: '上游响应返回错误',
                        UPSTREAM_STREAM_INCOMPLETE: '上游响应未完整结束',
                    };
                    const failureCode = event.vcp_status?.code;
                    const failureMessage = typeof failureCode === 'string' &&
                        Object.hasOwn(upstreamFailure, failureCode)
                        ? upstreamFailure[failureCode] : null;
                    // Transport EOF/DONE is not business success. Keep explicit
                    // user cancellation, and never infer failure from native tool metadata.
                    // A closed transport can carry a partial answer. Save it without treating a tool pause as a network fault.
                    const manualReason = event.type === 'end' && !cancelled && !failureMessage
                        ? (TOOL_PAUSE_CODES.has(failureCode) ? failureCode : event.finish_reason === 'length' ? 'length' : null)
                        : null;
                    for (const chunk of consumer?.flushChunks?.() ?? []) operation.controls.pushChunk(chunk);
                    const terminal = event.type === 'end'
                        ? {
                            kind: cancelled ? 'cancelled' : failureMessage ? 'failed' : manualReason ? 'completed' : (event.finish_reason || 'completed'),
                            ...(manualReason ? { finishReason: manualReason, requiresManualContinuation: true } : {}),
                            ...(failureMessage && !cancelled
                                ? { error: { code: failureCode, message: failureMessage } } : {}),
                            fullResponse: event.fullResponse, context: event.context,
                            ...(event.usage ? { usage: event.usage } : {}),
                        }
                        : { kind: 'failed', error: event.error, fullResponse: event.fullResponse || event.accumulatedResponse, context: event.context };
                    operation.accepting = false;
                    operation.projecting = false;
                    operation.controls.terminal(terminal);
                    operation.resolve(terminal);
                }
            }).catch(error => {
                operation.accepting = false;
                operation.projecting = false;
                reportError('[VcpStreamBridge] event projection failed', error);
                const terminal = { kind: 'failed', phase: 'projection', error };
                operation.controls.terminal(terminal);
                operation.resolve(terminal);
            });
            return true;
        },
        cancelOperation,
        disposeOperation,
        async dispose() {
            if (disposed) return;
            disposed = true;
            operations.forEach(operation => {
                operation.accepting = false;
                operation.projecting = false;
            });
            await coordinator.dispose();
            await Promise.allSettled([...operations.values()].map(operation => operation.chain));
            operations.clear();
            consumers.clear();
            messageOperations.clear();
            retiredSessions.clear();
        },
    });
}
