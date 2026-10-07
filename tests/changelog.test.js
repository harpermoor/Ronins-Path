'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js', 'changelog.js'), 'utf8');

async function load(markdown, options = {}) {
    const status = { textContent: 'Loading recent updates...', hidden: false };
    const list = { hidden: true, items: [], replaceChildren(...items) { this.items = items; } };
    const requests = [], errors = [];
    const context = vm.createContext({
        console: { error(...args) { errors.push(args); } },
        document: {
            getElementById: id => id === 'changelog-status' ? status : list,
            createElement: tag => ({ tag, textContent: '' }),
        },
        fetch: async (url, settings) => {
            requests.push({ url, cache: settings.cache });
            if (options.networkError) throw new Error('Network unavailable');
            return { ok: !options.httpError, status: options.httpError || 200, text: async () => markdown };
        },
    });
    await vm.runInContext(script, context);
    return { status, list, requests, errors, entries: list.items.map(item => item.textContent) };
}

(async () => {
    const markdown = '# Changelog\n\n## Unreleased\n\n- New shrine menu.\n- <script>not executable</script>\n\n## Older\n\n- Old update.';
    const latest = await load(markdown);
    assert.deepEqual(latest.entries, ['New shrine menu.', '<script>not executable</script>']);
    assert(latest.list.items.every(item => item.tag === 'li'), 'entries use textContent, never executable HTML');
    assert.equal(latest.status.hidden, true);
    assert.equal(latest.list.hidden, false);
    assert.deepEqual(latest.requests, [{ url: 'CHANGELOG.md', cache: 'no-store' }]);
    assert.equal(latest.errors.length, 0);

    const emptyUnreleased = await load('# Changelog\r\n\r\n## Unreleased\r\n\r\n## 2026-10-07\r\n- Latest release.\r\n\r\n## Older\r\n- Old release.');
    assert.deepEqual(emptyUnreleased.entries, ['Latest release.'], 'empty Unreleased falls through to the latest release');

    const changed = await load(markdown.replace('New shrine menu.', 'Changed since the last visit.'));
    assert.equal(changed.entries[0], 'Changed since the last visit.', 'loading again reads the updated source');

    for (const options of [{ httpError: 404 }, { networkError: true }, {}]) {
        const failed = await load('# Changelog\n\n## Unreleased\n', options);
        assert.equal(failed.status.hidden, false);
        assert.match(failed.status.textContent, /could not be loaded/);
        assert.equal(failed.list.hidden, true);
        assert.equal(failed.errors.length, 1, 'load failures are logged explicitly');
    }

    const actual = await load(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
    assert(actual.entries.some(entry => entry.includes('Colton')));
    assert(actual.entries.some(entry => entry.includes('shrine menu')));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /id="changelog-entries"/);
    assert.match(html, /src="js\/changelog\.js"/);
    assert.match(html, /href="CHANGELOG\.md"/);
    assert(fs.existsSync(path.join(root, '.nojekyll')), 'GitHub Pages must serve the Markdown source unchanged');
    assert(!html.includes('Multiplayer rooms now use hosted relay IDs'), 'the stale duplicated list is removed');
    console.log('Changelog loading and error handling checks passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
