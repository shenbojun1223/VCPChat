'use strict';

const { send, on } = require('../core/define');

module.exports = {
    handlers: ['main.js'],
    roles: ['chat'],
    api: {
        connectWorkerPanel: send('connect-worker-panel', (url, key) => [{ url, key }]),
        onWorkerPanelMessage: on('worker-panel-message'),
        requestWorkerPanelSnapshot: send('request-worker-panel-snapshot'),
        cancelWorkerJob: send('cancel-worker-job', 'jobId'),
        queryWorkerJob: send('query-worker-job', (jobId, traceMode) => [{ jobId, traceMode }]),
    },
};
