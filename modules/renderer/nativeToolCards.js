import { normalizeNativeToolEvent } from '../chat/nativeToolEvents.js';

const LABELS = Object.freeze({
    pending: '等待中',
    running: '调用已发起（CLI 报告）',
    succeeded: '成功（CLI 报告）',
    failed: '失败（CLI 报告）',
    denied: '已拒绝（报告状态）',
    cancelled: '已取消（CLI 报告）',
    unknown: '状态未知',
});

/** Append a separate, inert metadata panel. Never render these values as HTML.
 * Callers must supply a snapshot belonging to this message/stream operation.
 */
export function renderNativeToolCards(messageItem, records) {
    if (!messageItem?.ownerDocument) return false;
    if (!Array.isArray(records) || records.length > 128) return false;
    const events = [];
    const seen = new Set();
    for (const raw of records) {
        const event = normalizeNativeToolEvent(raw);
        if (!event) return false;
        const key = `${event.requestId}\u0000${event.callId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        events.push(event);
    }

    // The message root is a horizontal avatar/content row. Do not add a third
    // column there, or the native panel will squeeze the answer into a strip.
    const column = [...messageItem.children].find(
        child => child.classList?.contains('details-and-bubble-wrapper'),
    ) || messageItem;
    const isPanel = child => child.dataset?.vcpNativeTools === 'true';
    const previous = [...column.children].find(isPanel) ||
        [...messageItem.children].find(isPanel); // Migrate an older live projection.
    if (!events.length) {
        previous?.remove();
        return true;
    }
    const doc = messageItem.ownerDocument;
    const panel = doc.createElement('details');
    panel.dataset.vcpNativeTools = 'true';
    panel.className = 'vcp-native-tool-panel';
    panel.open = previous ? previous.open : true;
    panel.style.cssText = 'align-self:stretch;box-sizing:border-box;min-width:0;max-width:100%;margin:8px 0;padding:8px 12px;border:1px solid var(--border-color,currentColor);border-radius:8px;font-size:0.85em;line-height:1.5;overflow-wrap:anywhere;background:var(--secondary-bg,#f5f5f7);color:var(--text-color,#252530);';
    const summary = doc.createElement('summary');
    summary.textContent = `AGY 原生工具 · ${events.length} 项`;
    panel.appendChild(summary);

    const notice = doc.createElement('p');
    notice.textContent = '上游报告的 AGY 原生调用，非 VCP 插件。仅展示，不代表已获准执行或已独立核验；参数与结果详情不展示。';
    panel.appendChild(notice);
    const list = doc.createElement('ul');
    for (const event of events) {
        const item = doc.createElement('li');
        item.dataset.nativeStatus = event.status;
        const name = doc.createElement('strong');
        name.textContent = event.name || '未提供工具名';
        const state = doc.createElement('span');
        state.textContent = ` — ${LABELS[event.status]}`;
        item.append(name, state);
        const identity = doc.createElement('small');
        identity.style.cssText = 'display:block;opacity:0.7;overflow-wrap:anywhere;';
        identity.textContent = `${event.requestId} / ${event.callId}`;
        item.appendChild(identity);
        if (event.evidence === 'missing_terminal') {
            const note = doc.createElement('span');
            note.textContent = ' · 未收到调用终态，不能据此判断是否执行完成';
            item.appendChild(note);
        }
        list.appendChild(item);
    }
    panel.appendChild(list);
    if (previous?.parentElement === column) previous.replaceWith(panel);
    else {
        previous?.remove();
        column.appendChild(panel);
    }
    return true;
}