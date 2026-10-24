'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../modules/uiManager.js'), 'utf8');

for (const mode of ['absent', 'partial', 'complete']) {
    test(`optional legacy clock: ${mode}`, async () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://fixture.invalid/',
            runScripts: 'outside-only',
        });
        const errors = [];
        const timers = [];
        const { window } = dom;
        window.console.error = (...args) => errors.push(args.join(' '));
        window.console.log = () => {};
        const element = id => {
            const node = window.document.createElement('div');
            node.id = id;
            window.document.body.appendChild(node);
            return node;
        };
        const clock = mode === 'absent' ? null : element('digitalClock');
        const date = mode === 'complete' ? element('dateDisplay') : null;
        const title = mode === 'complete' ? element('notificationTitle') : null;
        let manager;
        try {
            window.eval(source);
            manager = window.uiManager;
            await manager.init({
                electronAPI: {
                    setTheme() {},
                    onThemeUpdated() { return () => {}; },
                    getCurrentTheme: async () => 'light',
                    saveSettings: async () => ({ success: true }),
                },
                refs: { globalSettingsRef: { get: () => ({ currentThemeMode: 'light' }), set() {} } },
                listenerOwner: {
                    capture: () => () => {},
                    timeout(callback, delay) { timers.push({ callback, delay }); return null; },
                },
                elements: {
                    leftSidebar: null, rightNotificationsSidebar: null,
                    resizerLeft: null, resizerRight: null,
                    digitalClockElement: clock, dateDisplayElement: date,
                    notificationTitleElement: title,
                    sidebarTabButtons: [], sidebarTabContents: [],
                },
            });
            if (mode === 'partial') {
                assert.deepEqual(errors, ['Digital clock, notification title, or date display element not found.']);
                assert.equal(timers.length, 0);
            } else {
                assert.deepEqual(errors, []);
                if (mode === 'absent') {
                    assert.equal(timers.length, 0, 'removed clock must not schedule work');
                } else {
                    assert.equal(title.style.display, 'none');
                    assert.match(clock.textContent, /^\d{2}:\d{2}$/);
                    assert.match(date.textContent, /^\d{2}-\d{2} 周[日一二三四五六]$/);
                    assert.equal(timers.length, 1);
                    assert.equal(timers[0].delay, 60000);
                    assert.equal(typeof timers[0].callback, 'function');
                }
            }
        } finally {
            await manager?.dispose();
            window.close();
        }
    });
}