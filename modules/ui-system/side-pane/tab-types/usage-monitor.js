import { createLazyProvider } from './lazy-provider.js';

export function defineUsageMonitorTabType({ document: doc, window: win, chatAPI, sidePaneController, uiHelper }) {
    const provider = createLazyProvider(async () => {
        const { createUsageMonitorSideProvider } = await import('../usageMonitorSideProvider.js');
        return createUsageMonitorSideProvider({
            document: doc,
            api: chatAPI || win?.electronAPI,
            sidePaneController,
            uiHelper
        });
    }, ['openUsageMonitorTab'], {
        label: '用量',
        notify: (message, type) => uiHelper?.showToastNotification?.(message, type)
    });

    return Object.freeze({
        kind: 'usage-monitor',
        label: '用量',
        icon: 'donut_small',
        searchHint: '模型 用量 额度 配额 余额 token 缓存 NewAPI CPAMP',
        entry: {
            id: 'usage-monitor',
            order: 66,
            open: () => provider.openUsageMonitorTab()
        },
        provider
    });
}