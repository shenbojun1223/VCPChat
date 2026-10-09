'use strict';

const { invoke, on } = require('../core/define');

module.exports = {
    handlers: ['main.js'],
    roles: ['chat'],
    api: {
        runDesktopSync: invoke('desktop-sync-now'),
        getDesktopSyncStatus: invoke('desktop-sync-status'),
        onDesktopSyncStatus: on('desktop-sync-status'),
        onDesktopSyncDataUpdated: on('desktop-sync-data-updated'),
    },
};
