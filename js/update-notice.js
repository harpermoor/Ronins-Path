'use strict';

const GAME_UPDATE_CHECK_INTERVAL = 60_000;

const GameUpdateNotice = (() => {
    const dialog = document.getElementById('update-dialog');
    const refreshButton = document.getElementById('update-refresh');
    const stayButton = document.getElementById('update-stay');
    let game = null, version = null, polling = false, timer = null;

    async function check() {
        if (polling) return;
        polling = true;
        try {
            const response = await fetch('CHANGELOG.md', { cache: 'no-store' });
            if (!response.ok) throw new Error('Version check failed: HTTP ' + response.status);
            const latest = await response.text();
            if (version === null) version = latest;
            else if (latest !== version) {
                version = latest;
                if (game && !dialog.open) show();
            }
        } catch (error) {
            console.error('Unable to check for game updates:', error);
        } finally {
            polling = false;
        }
    }

    function show() {
        game.updatePausedBeforeNotice = game.paused;
        game.paused = true;
        game.updateNoticeOpen = true;
        game.saveNow(false);
        dialog.showModal();
        refreshButton.focus();
    }

    function watch(session) {
        game = session;
        if (timer !== null) return;
        check();
        timer = setInterval(check, GAME_UPDATE_CHECK_INTERVAL);
    }

    refreshButton.addEventListener('click', () => {
        if (game) game.saveNow(false);
        const url = new URL(location.href);
        url.searchParams.delete('join');
        url.searchParams.delete('coop');
        url.searchParams.delete('relay');
        url.searchParams.delete('_refresh');
        location.replace(url.href);
    });

    stayButton.addEventListener('click', () => {
        dialog.close();
        game.updateNoticeOpen = false;
        game.paused = game.updatePausedBeforeNotice;
    });

    dialog.addEventListener('cancel', event => event.preventDefault());

    return { watch };
})();
