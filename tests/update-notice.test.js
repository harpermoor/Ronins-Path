'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const buttons = {};
const listeners = {};
const dialog = {
    open: false,
    addEventListener(type, callback) { listeners['dialog:' + type] = callback; },
    showModal() { this.open = true; },
    close() { this.open = false; },
};
const versions = ['## Unreleased\n\n- Current version.\n', '## Unreleased\n\n- New version.\n',
    '## Unreleased\n\n- New version.\n', '## Unreleased\n\n- Newer version.\n'];
let intervalCallback, saves = 0, replacedUrl = null;
const context = vm.createContext({
    console: { error(...args) { throw new Error(args.join(' ')); } },
    document: {
        getElementById(id) { return id === 'update-dialog' ? dialog : buttons[id]; },
    },
    fetch: async (_url, options) => {
        assert.equal(options.cache, 'no-store');
        const body = versions.shift();
        return { ok: true, text: async () => body };
    },
    location: { href: 'https://game.example/?seed=123&join=ABCDEFGH&relay=wss%3A%2F%2Frelay.example',
        replace(url) { replacedUrl = url; } },
    setInterval(callback, delay) {
        assert.equal(delay, 60_000);
        intervalCallback = callback;
        return 1;
    },
    URL,
});
for (const id of ['update-refresh', 'update-stay']) {
    buttons[id] = { addEventListener(type, callback) { listeners[id + ':' + type] = callback; }, focus() {} };
}
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'update-notice.js'), 'utf8'), context);
const game = {
    paused: false,
    saveNow() { saves++; },
};
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
    vm.runInContext('GameUpdateNotice.watch(game)', vm.createContext({ GameUpdateNotice:
        vm.runInContext('GameUpdateNotice', context), game }));
    await flush();
    assert.equal(game.paused, false, 'initial version check does not pause the session');

    await intervalCallback();
    await flush();
    assert.equal(dialog.open, true, 'a changed version opens the notice');
    assert.equal(game.paused, true);
    assert.equal(game.updateNoticeOpen, true);
    assert.equal(saves, 1, 'progress is saved before prompting');

    listeners['update-stay:click']();
    assert.equal(dialog.open, false);
    assert.equal(game.paused, false, 'staying resumes the previous pause state');
    assert.equal(game.updateNoticeOpen, false);
    await intervalCallback();
    await flush();
    assert.equal(dialog.open, false, 'the same available version is not repeatedly announced');

    await intervalCallback();
    await flush();
    assert.equal(dialog.open, true, 'a later version is announced after staying on an update');
    listeners['update-refresh:click']();
    assert.equal(saves, 3, 'refresh saves progress before navigation');
    const refreshed = new URL(replacedUrl);
    assert.equal(refreshed.searchParams.get('seed'), '123');
    assert.equal(refreshed.searchParams.has('join'), false, 'refresh does not auto-rejoin an invite room');
    assert.equal(refreshed.searchParams.has('relay'), false);
    const cancel = { preventDefault() { this.prevented = true; } };
    listeners['dialog:cancel'](cancel);
    assert.equal(cancel.prevented, true, 'escape cannot dismiss the notice without choosing an option');
    console.log('Game update notice checks passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
