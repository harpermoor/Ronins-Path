'use strict';

/** Display the latest nonempty section from the shared, plain-bullet changelog. */
(async () => {
    const status = document.getElementById('changelog-status');
    const list = document.getElementById('changelog-entries');
    try {
        const response = await fetch('CHANGELOG.md', { cache: 'no-store' });
        if (!response.ok) throw new Error('Changelog request failed: HTTP ' + response.status);
        const markdown = await response.text();
        const entries = [];
        let inSection = false;
        for (const line of markdown.split(/\r?\n/)) {
            if (/^##\s+/.test(line)) {
                if (entries.length) break;
                inSection = true;
            } else if (inSection && /^-\s+/.test(line)) {
                entries.push(line.replace(/^-\s+/, '').trim());
            }
        }
        if (!entries.length) throw new Error('Changelog contains no update entries');
        const items = entries.map(entry => {
            const item = document.createElement('li');
            item.textContent = entry;
            return item;
        });
        list.replaceChildren(...items);
        list.hidden = false;
        status.hidden = true;
    } catch (error) {
        console.error('Unable to load recent updates:', error);
        status.textContent = 'Recent updates could not be loaded. Open the full changelog below.';
        status.hidden = false;
    }
})();
