// A saved reply is not necessarily a completed task. Only explicit wire fields affect continuation.
const PAUSE_CODES = new Set([
    'VCP_TOOL_LOOP_STUCK', 'VCP_TOOL_LOOP_LIMIT', 'VCP_TOOL_BLOCK_INCOMPLETE', 'VCP_MODEL_PROTOCOL_HALT',
]);

export function nonStreamReplyTerminal(reply) {
    const code = reply?.vcp_status?.code;
    if (PAUSE_CODES.has(code)) return { finishReason: code, requiresManualContinuation: true };
    if (reply?.choices?.[0]?.finish_reason === 'length') {
        return { finishReason: 'length', requiresManualContinuation: true };
    }
    return { finishReason: 'completed' };
}
