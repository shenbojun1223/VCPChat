const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const storeSource = fs.readFileSync(
    path.join(__dirname, '..', 'modules', 'AICodeWorkerStore.js'),
    'utf8'
);

function createClock(start = 1000) {
    const clock = { now: start };
    class TestDate extends Date {
        constructor(...args) {
            super(args.length === 0 ? clock.now : args[0], ...args.slice(1));
        }

        static now() {
            return clock.now;
        }
    }
    return { clock, Date: TestDate };
}

function createChatAPI() {
    const callbacks = new Set();
    const order = [];
    const api = {
        callbacks,
        order,
        unsubscribeCount: 0,
        requestCount: 0,
        cancelled: [],
        onWorkerPanelMessage(callback) {
            order.push('subscribe');
            callbacks.add(callback);
            return () => {
                if (callbacks.delete(callback)) api.unsubscribeCount += 1;
            };
        },
        requestWorkerPanelSnapshot() {
            order.push('snapshot-request');
            api.requestCount += 1;
        },
        cancelWorkerJob(jobId) {
            api.cancelled.push(jobId);
        },
        emit(data) {
            for (const callback of Array.from(callbacks)) callback(data);
        }
    };
    return api;
}

function loadStore(clockStart = 1000) {
    const { clock, Date: TestDate } = createClock(clockStart);
    const warnings = [];
    const context = {
        console: { warn: (...args) => warnings.push(args) },
        Event,
        EventTarget,
        Date: TestDate,
        window: null
    };
    context.window = context;
    vm.runInNewContext(storeSource, context, { filename: 'modules/AICodeWorkerStore.js' });
    return {
        clock,
        warnings,
        Store: context.AICodeWorkerStore,
        sharedStore: context.aicodeWorkerStore
    };
}

test('AICodeWorkerStore preserves the legacy data contract', () => {
    const { clock, Store } = loadStore();
    const store = new Store();
    let changeCount = 0;
    store.addEventListener('change', () => changeCount += 1);

    clock.now = 100;
    assert.equal(store.handleMessage({
        type: 'job_status_update',
        data: {
            jobId: 'job-1',
            state: 'running',
            worker: 'alpha',
            mode: 'batch',
            projectPath: 'C:\\work\\project'
        }
    }), true);

    clock.now = 200;
    assert.equal(store.handleMessage({
        type: 'job_status_update',
        data: { jobId: 'job-1', state: 'completed', completedAt: '2024-01-01T00:00:02.000Z' }
    }), true);

    const merged = store.getJob('job-1');
    assert.equal(merged.state, 'completed');
    assert.equal(merged.worker, 'alpha');
    assert.equal(merged.mode, 'batch');
    assert.equal(merged.projectPath, 'C:\\work\\project');
    assert.equal(merged.updatedAt, 200);
    assert.equal(changeCount, 2);

    const returnedJobs = store.getJobs();
    returnedJobs[0].state = 'failed';
    assert.equal(store.getJob('job-1').state, 'completed');

    const returnedJob = store.getJob('job-1');
    returnedJob.worker = 'mutated-outside';
    assert.equal(store.getJob('job-1').worker, 'alpha');
});

test('AICodeWorkerStore applies snapshot ordering without clearing existing jobs', () => {
    const { clock, Store } = loadStore(0);
    const store = new Store();
    store.handleMessage({ type: 'job_status_update', data: { jobId: 'keep-me', state: 'completed' } });

    clock.now = 500;
    store.handleMessage({
        type: 'job_status_snapshot',
        data: {
            jobs: [
                { jobId: 'snapshot-old', state: 'completed', worker: 'old' },
                { jobId: 'snapshot-new', state: 'running', worker: 'new' }
            ]
        }
    });

    assert.deepEqual(Array.from(store.getJobs(), job => job.jobId), [
        'snapshot-old',
        'snapshot-new',
        'keep-me'
    ]);
    assert.equal(store.getJob('keep-me').state, 'completed');
});

test('AICodeWorkerStore limits records to the latest 20 updates', () => {
    const { clock, Store } = loadStore();
    const store = new Store();

    for (let index = 0; index < 20; index += 1) {
        clock.now = index;
        store.handleMessage({ type: 'job_status_update', data: { jobId: `job-${index}`, state: 'completed' } });
    }
    clock.now = 20;
    store.handleMessage({ type: 'job_status_update', data: { jobId: 'job-20', state: 'completed' } });

    const ids = store.getJobs().map(job => job.jobId);
    assert.equal(ids.length, 20);
    assert.equal(ids.includes('job-0'), false);
    assert.equal(ids.includes('job-20'), true);
});

test('AICodeWorkerStore ignores invalid or unknown messages', () => {
    const { Store, warnings } = loadStore();
    const store = new Store();
    let changeCount = 0;
    store.addEventListener('change', () => changeCount += 1);

    assert.equal(store.handleMessage(null), false);
    assert.equal(store.handleMessage({ type: 'unknown', data: { jobId: 'unknown' } }), false);
    assert.equal(store.handleMessage({ type: 'job_status_update', data: null }), false);
    assert.equal(store.handleMessage({ type: 'job_status_update', data: {} }), false);
    assert.equal(store.getJobs().length, 0);
    assert.equal(changeCount, 2);

    assert.equal(store.handleMessage({ type: 'worker_panel_action_result', data: { success: false } }), true);
    assert.equal(store.getJobs().length, 0);
    assert.equal(warnings.length, 1);
});

test('AICodeWorkerStore initializes once, subscribes before requesting a snapshot, and destroys idempotently', () => {
    const { Store } = loadStore();
    const api = createChatAPI();
    const store = new Store(api);

    assert.equal(store.init(), true);
    assert.equal(store.init(), false);
    assert.deepEqual(api.order, ['subscribe', 'snapshot-request']);
    assert.equal(api.callbacks.size, 1);
    assert.equal(api.requestCount, 1);

    store.destroy();
    store.destroy();
    assert.equal(api.unsubscribeCount, 1);
    assert.equal(api.callbacks.size, 0);
});

test('AICodeWorkerStore forwards cancellation only and does not invent terminal state', () => {
    const { Store } = loadStore();
    const api = createChatAPI();
    const store = new Store(api);
    store.handleMessage({ type: 'job_status_update', data: { jobId: 'cancel-me', state: 'running' } });

    assert.equal(store.cancelWorkerJob('cancel-me'), true);
    assert.deepEqual(api.cancelled, ['cancel-me']);
    assert.equal(store.getJob('cancel-me').state, 'running');

    store.handleMessage({ type: 'worker_panel_action_result', data: { success: true } });
    assert.equal(store.getJob('cancel-me').state, 'running');
});

test('AICodeWorkerStore emits a frozen safe action-result detail', () => {
    const { Store } = loadStore();
    const store = new Store();
    const feedback = [];
    store.addEventListener('action-result', event => feedback.push(event.detail));

    store.handleMessage({
        type: 'worker_panel_action_result',
        data: {
            action: 'cancel',
            jobId: 'job-safe',
            success: true,
            error: { message: '<not-an-html-error>' },
            result: { secret: 'must-not-cross-boundary', message: 'request returned' },
            extra: 'must-not-cross-boundary',
        }
    });

    assert.equal(feedback.length, 1);
    assert.equal(Object.isFrozen(feedback[0]), true);
    assert.deepEqual(Object.keys(feedback[0]).sort(), [
        'action',
        'error',
        'jobId',
        'resultSummary',
        'success'
    ]);
    assert.deepEqual({ ...feedback[0] }, {
        action: 'cancel',
        jobId: 'job-safe',
        success: true,
        error: '<not-an-html-error>',
        resultSummary: 'request returned'
    });
});

test('AICodeWorkerStore handles cancellation Promise rejection without an unhandled rejection', async () => {
    const { Store } = loadStore();
    const api = createChatAPI();
    api.cancelWorkerJob = () => Promise.reject(new Error('send failed'));
    const store = new Store(api);
    const feedback = [];
    store.addEventListener('action-result', event => feedback.push(event.detail));

    assert.equal(store.cancelWorkerJob('promise-cancel'), true);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(feedback.map(detail => ({ ...detail })), [{
        action: 'cancel',
        jobId: 'promise-cancel',
        success: false,
        error: 'send failed',
        resultSummary: null
    }]);
    assert.equal(store.getJob('promise-cancel'), null);
});

test('AICodeWorkerStore exposes one shared production instance and a testable constructor', () => {
    const { Store, sharedStore } = loadStore();
    assert.ok(sharedStore instanceof Store);
    assert.notEqual(new Store(), sharedStore);
});
