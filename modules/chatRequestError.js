'use strict';

function readStatus(value) {
    return Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

function describeChatRequestError(payload, httpStatus, fallback = '服务端未提供错误说明') {
    const nested = payload?.error;
    const status = readStatus(httpStatus) ?? readStatus(nested?.status) ?? readStatus(payload?.status);
    const detail = [nested?.message, payload?.message, nested, payload]
        .find(value => typeof value === 'string' && value.trim() && value.trim() !== '[object Object]');
    const message = (detail || fallback).replace(/\s+/g, ' ').trim().slice(0, 240);
    return status ? { error: `HTTP ${status}：${message}`, status } : { error: message };
}

async function readChatHttpError(response) {
    let payload;
    try {
        payload = JSON.parse(await response.text());
    } catch {
        // An HTML error page or unreadable body should not replace the HTTP status.
    }
    return describeChatRequestError(payload, response.status);
}

// VCP sends the readable notice in delta.content, not error.message.
// Rebuild a bounded diagnostic from display fields; never promote arbitrary delta text.
function vcpStreamFailureSummary(payload) {
    if (payload?.object !== 'chat.completion.chunk' || payload.model !== 'vcp-upstream-error' ||
        payload.error?.type !== 'upstream_error') return undefined;
    const { code, requestId, status } = payload.error;
    let message = status === 503 && code === 'system_cpu_overloaded'
        ? '上游网关报告 CPU 过载' : '上游请求失败';
    if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(code)) message += ' (' + code + ')';
    // Same public request-number shape used by the server's human-readable notice.
    if (typeof requestId === 'string' && /^\d{14}[A-Za-z0-9]{8,82}$/.test(requestId)) {
        message += '；请求编号：' + requestId;
    }
    return message;
}

/**
 * The server refused the request before sending it upstream because it exceeds the context
 * limit. On a stream this arrives as a normal-looking chunk; it is an error, not a reply.
 * (A tool loop stopped half-way carries stage 'tool_loop' and stays part of the reply.)
 */
function contextBudgetRefusal(payload) {
    if (payload?.vcp_context_budget?.stage !== 'outbound') return null;
    const text = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content;
    const message = typeof text === 'string' && text.trim()
        ? text.replace(/^\s*\[ERROR\]\s*/, '').trim()
        : '请求超过上下文上限，未发送给模型。';
    return Object.assign(new Error(message), { isChatResponseError: true, isContextBudgetRefusal: true });
}

function chatResponseError(payload) {
    const refusal = contextBudgetRefusal(payload);
    if (refusal) return refusal;
    if (!payload?.error) return null;
    const failure = describeChatRequestError(payload, undefined, vcpStreamFailureSummary(payload));
    return Object.assign(new Error(failure.error), { status: failure.status, isChatResponseError: true });
}

module.exports = { describeChatRequestError, readChatHttpError, chatResponseError };
