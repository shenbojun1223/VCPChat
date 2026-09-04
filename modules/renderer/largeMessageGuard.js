export const LARGE_MESSAGE_THRESHOLDS = Object.freeze({
    folded: 50 * 1024,
    plaintext: 200 * 1024,
    blocked: 500 * 1024,
});

export const LARGE_MESSAGE_PREVIEW_CHARS = 7000;
export const LARGE_MESSAGE_PAGE_CHARS = 20000;

export function classifyLargeMessage(charLength) {
    const length = Number(charLength) || 0;
    if (length >= LARGE_MESSAGE_THRESHOLDS.blocked) return 'blocked';
    if (length >= LARGE_MESSAGE_THRESHOLDS.plaintext) return 'plaintext';
    if (length >= LARGE_MESSAGE_THRESHOLDS.folded) return 'folded';
    return null;
}

function getTierCopy(tier) {
    if (tier === 'blocked') {
        return {
            title: '超大消息已阻止直接渲染',
            detail: '内容超过 500 KB。为防止客户端卡死，只允许分页纯文本查看。',
        };
    }
    if (tier === 'plaintext') {
        return {
            title: '超长消息已切换为安全模式',
            detail: '内容超过 200 KB。已跳过 Markdown、高亮和高级渲染，只允许分页纯文本查看。',
        };
    }
    return {
        title: '长消息已安全折叠',
        detail: '已暂缓 Markdown 和高级渲染。可分页查看纯文本，或在确认后完整渲染。',
    };
}

function buildPreview(text) {
    if (text.length <= LARGE_MESSAGE_PREVIEW_CHARS) return text;
    const tailLength = 1000;
    const headLength = LARGE_MESSAGE_PREVIEW_CHARS - tailLength;
    return `${text.slice(0, headLength)}\n\n…… 已省略中间内容，可使用分页查看 ……\n\n${text.slice(-tailLength)}`;
}

function setHidden(element, hidden) {
    element.hidden = !!hidden;
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

export function clearLargeMessageGuard(messageItem) {
    if (!messageItem) return;
    const cleanup = messageItem._vcpLargeMessageCleanup;
    if (typeof cleanup === 'function') cleanup();
}

export function mountLargeMessageGuard(options = {}) {
    const {
        messageItem,
        contentDiv,
        text = '',
        allowFormattedRender = false,
        onRenderFormatted = null,
    } = options;

    if (!messageItem || !contentDiv) {
        throw new TypeError('mountLargeMessageGuard requires messageItem and contentDiv');
    }

    const normalizedText = String(text ?? '');
    const tier = classifyLargeMessage(normalizedText.length);
    if (!tier) {
        clearLargeMessageGuard(messageItem);
        return { guarded: false, created: false, tier: null };
    }

    const existingController = messageItem._vcpLargeMessageController;
    if (existingController) {
        existingController.update(normalizedText, {
            allowFormattedRender,
            onRenderFormatted,
        });
        return { guarded: true, created: false, tier };
    }

    const ownerDocument = contentDiv.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    const shell = ownerDocument.createElement('section');
    shell.className = 'vcp-large-message-guard';
    shell.setAttribute('role', 'region');
    shell.setAttribute('aria-label', '超长消息安全查看器');

    const header = ownerDocument.createElement('div');
    header.className = 'vcp-large-message-guard__header';

    const title = ownerDocument.createElement('strong');
    title.className = 'vcp-large-message-guard__title';

    const meta = ownerDocument.createElement('span');
    meta.className = 'vcp-large-message-guard__meta';

    const detail = ownerDocument.createElement('p');
    detail.className = 'vcp-large-message-guard__detail';

    header.append(title, meta);
    shell.append(header, detail);

    const preview = ownerDocument.createElement('pre');
    preview.className = 'vcp-large-message-guard__preview';
    shell.appendChild(preview);

    const pager = ownerDocument.createElement('div');
    pager.className = 'vcp-large-message-guard__pager';
    setHidden(pager, true);

    const pageText = ownerDocument.createElement('pre');
    pageText.className = 'vcp-large-message-guard__page';

    const pagerControls = ownerDocument.createElement('div');
    pagerControls.className = 'vcp-large-message-guard__pager-controls';

    const previousButton = ownerDocument.createElement('button');
    previousButton.type = 'button';
    previousButton.textContent = '上一页';

    const pageStatus = ownerDocument.createElement('span');
    pageStatus.className = 'vcp-large-message-guard__page-status';
    pageStatus.setAttribute('aria-live', 'polite');

    const nextButton = ownerDocument.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = '下一页';

    const closePagerButton = ownerDocument.createElement('button');
    closePagerButton.type = 'button';
    closePagerButton.textContent = '收起分页';

    pagerControls.append(previousButton, pageStatus, nextButton, closePagerButton);
    pager.append(pageText, pagerControls);
    shell.appendChild(pager);

    const actions = ownerDocument.createElement('div');
    actions.className = 'vcp-large-message-guard__actions';

    const openPagerButton = ownerDocument.createElement('button');
    openPagerButton.type = 'button';
    openPagerButton.className = 'vcp-large-message-guard__button';
    openPagerButton.textContent = '分页查看纯文本';

    const formattedButton = ownerDocument.createElement('button');
    formattedButton.type = 'button';
    formattedButton.className = 'vcp-large-message-guard__button vcp-large-message-guard__button--warning';
    formattedButton.textContent = '完整格式化渲染';
    formattedButton.title = '完整渲染可能造成短暂卡顿，需要再次点击确认';

    actions.append(openPagerButton, formattedButton);
    shell.appendChild(actions);

    contentDiv.replaceChildren(shell);
    contentDiv.classList.add('vcp-large-message-content');
    messageItem.classList.add('vcp-large-message-guarded');
    messageItem.dataset.vcpHeavyActivated = 'true';
    contentDiv.dataset.vcpHeavyActivated = 'true';
    delete messageItem.dataset.vcpHeavyPending;
    delete contentDiv.dataset.vcpHeavyPending;
    delete messageItem._vcp_activateHeavy;
    delete messageItem._vcp_process;
    delete messageItem._vcp_renderSessionId;

    let rawText = normalizedText;
    let currentTier = tier;
    let currentPage = 0;
    let pagerOpen = false;
    let canRenderFormatted = false;
    let renderFormatted = null;
    let confirmationArmed = false;
    let confirmationTimer = null;
    let destroyed = false;

    const listeners = [];
    const listen = (element, eventName, handler) => {
        element.addEventListener(eventName, handler);
        listeners.push(() => element.removeEventListener(eventName, handler));
    };

    const clearConfirmation = () => {
        if (confirmationTimer !== null) {
            ownerWindow?.clearTimeout?.(confirmationTimer);
            confirmationTimer = null;
        }
        confirmationArmed = false;
        formattedButton.textContent = '完整格式化渲染';
        formattedButton.classList.remove('is-armed');
    };

    const renderPage = () => {
        const pageCount = Math.max(1, Math.ceil(rawText.length / LARGE_MESSAGE_PAGE_CHARS));
        currentPage = Math.min(Math.max(0, currentPage), pageCount - 1);
        const start = currentPage * LARGE_MESSAGE_PAGE_CHARS;
        pageText.textContent = rawText.slice(start, start + LARGE_MESSAGE_PAGE_CHARS);
        pageStatus.textContent = `第 ${currentPage + 1} / ${pageCount} 页`;
        previousButton.disabled = currentPage === 0;
        nextButton.disabled = currentPage >= pageCount - 1;
    };

    const update = (nextText, updateOptions = {}) => {
        if (destroyed) return;
        rawText = String(nextText ?? '');
        currentTier = classifyLargeMessage(rawText.length);
        const copy = getTierCopy(currentTier);
        title.textContent = copy.title;
        detail.textContent = copy.detail;
        meta.textContent = `${rawText.length.toLocaleString('zh-CN')} 字符`;
        preview.textContent = buildPreview(rawText);

        canRenderFormatted = currentTier === 'folded'
            && updateOptions.allowFormattedRender === true
            && typeof updateOptions.onRenderFormatted === 'function';
        renderFormatted = canRenderFormatted ? updateOptions.onRenderFormatted : null;
        formattedButton.hidden = !canRenderFormatted;

        messageItem.dataset.vcpLargeMessageTier = currentTier;
        messageItem.dataset.vcpLargeMessageLength = String(rawText.length);

        const pageCount = Math.max(1, Math.ceil(rawText.length / LARGE_MESSAGE_PAGE_CHARS));
        currentPage = Math.min(currentPage, pageCount - 1);
        if (pagerOpen) renderPage();
        clearConfirmation();
    };

    listen(openPagerButton, 'click', () => {
        pagerOpen = true;
        setHidden(preview, true);
        setHidden(pager, false);
        setHidden(openPagerButton, true);
        renderPage();
    });

    listen(closePagerButton, 'click', () => {
        pagerOpen = false;
        setHidden(pager, true);
        setHidden(preview, false);
        setHidden(openPagerButton, false);
    });

    listen(previousButton, 'click', () => {
        currentPage -= 1;
        renderPage();
    });

    listen(nextButton, 'click', () => {
        currentPage += 1;
        renderPage();
    });

    listen(formattedButton, 'click', () => {
        if (!canRenderFormatted || typeof renderFormatted !== 'function') return;
        if (!confirmationArmed) {
            confirmationArmed = true;
            formattedButton.textContent = '再次点击确认完整渲染';
            formattedButton.classList.add('is-armed');
            confirmationTimer = ownerWindow?.setTimeout?.(clearConfirmation, 5000) ?? null;
            return;
        }

        const callback = renderFormatted;
        formattedButton.disabled = true;
        clearConfirmation();
        Promise.resolve(callback()).catch(error => {
            formattedButton.disabled = false;
            console.error('[LargeMessageGuard] Formatted render failed:', error);
        });
    });

    const cleanup = () => {
        if (destroyed) return;
        destroyed = true;
        clearConfirmation();
        listeners.splice(0).reverse().forEach(dispose => dispose());
        messageItem.classList.remove('vcp-large-message-guarded');
        contentDiv.classList.remove('vcp-large-message-content');
        delete messageItem.dataset.vcpLargeMessageTier;
        delete messageItem.dataset.vcpLargeMessageLength;
        delete messageItem.dataset.vcpHeavyActivated;
        delete contentDiv.dataset.vcpHeavyActivated;
        if (messageItem._vcpLargeMessageController === controller) {
            delete messageItem._vcpLargeMessageController;
        }
        if (messageItem._vcpLargeMessageCleanup === cleanup) {
            delete messageItem._vcpLargeMessageCleanup;
        }
        rawText = '';
        renderFormatted = null;
    };

    const controller = Object.freeze({ update, destroy: cleanup });
    messageItem._vcpLargeMessageController = controller;
    messageItem._vcpLargeMessageCleanup = cleanup;

    update(normalizedText, { allowFormattedRender, onRenderFormatted });
    return { guarded: true, created: true, tier };
}