'use strict';

/** Main menu: start the single-player journey, or host / join online multiplayer. */
(() => {
    const $ = id => document.getElementById(id);
    const menu = $('menu'), canvas = $('game');
    const PANELS = ['menu-main', 'menu-host', 'menu-join'];
    let link = null;
    let joinTimer = 0;
    let coopMode = false;
    const params = new URLSearchParams(location.search);
    const relayFromUrl = params.get('relay') || '';
    const rememberedRelay = localStorage.getItem(NET_URL_KEY) || '';
    const configuredRelay = DuelLink.cleanEndpoint(relayFromUrl || rememberedRelay);
    const defaultRelay = configuredRelay || (location.hostname.endsWith('.github.io') ? '' : DuelLink.defaultEndpoint());

    const myLook = (() => {
        const lo = new Loadout();
        lo.load();
        return Object.assign({}, lo.look);
    })();
    const difficultySelect = $('journey-difficulty');
    const difficultyNote = $('difficulty-note');
    const difficultyDescriptions = {
        loser: 'Loser: enemies are much less durable and deal less damage.',
        ashigaru: 'Ashigaru: a forgiving challenge with weakened enemies.',
        kachi: 'Kachi: balanced enemy strength.',
        hatamoto: 'Hatamoto: tougher foes that hit harder.',
        daimyo: 'Daimyo: the land offers no mercy.',
        buddha: 'Buddha: extreme trial. Enemies have 12x health, 10x posture, and 8x damage. A single mistake can end your journey.',
    };
    const updateJourneyDifficulty = () => {
        const tier = sanitizeJourneyDifficulty(difficultySelect.value);
        difficultySelect.value = tier;
        difficultyNote.textContent = difficultyDescriptions[tier];
        JourneySettings.saveDifficulty(tier);
    };
    difficultySelect.value = JourneySettings.readDifficulty();
    updateJourneyDifficulty();
    difficultySelect.onchange = updateJourneyDifficulty;

    const show = id => {
        for (const p of PANELS) $(p).hidden = p !== id;
    };
    const setStatus = (id, msg, bad) => {
        $(id).textContent = msg;
        $(id).classList.toggle('bad', !!bad);
    };
    const dropLink = () => {
        clearTimeout(joinTimer);
        if (link !== null) link.close();
        link = null;
    };
    const back = () => {
        dropLink();
        $('host-relay-url').disabled = false;
        $('join-relay-url').disabled = false;
        history.replaceState(null, '', location.href.split(/[?#]/)[0]);
        show('menu-main');
    };
    const startDuel = (l, localIdx, delay, looks, settings) => {
        clearTimeout(joinTimer);
        menu.hidden = true;
        canvas.focus();
        new Duel(canvas, l, localIdx, delay, looks, settings).run();
    };
    const startCoop = (l, host, save, hostGame, settings, slot, party) => {
        clearTimeout(joinTimer);
        menu.hidden = true;
        canvas.focus();
        // guests must build the identical world, or enemy indices would not line up with the host's
        const game = hostGame || new Game(save.seed, canvas, save, { coopSettings: settings, partySize: party });
        if (!host) {
            game.guestJourney = true;
            game.player.x += 45 * Math.max(1, slot);
            game.world.resolve(game.player);
            game.camX = game.player.x;
            game.camY = game.player.y;
        }
        new Coop(game, l, host, settings, slot);
        game.note(host ? 'Your party has set out' : 'Joined host journey (guest progress is not saved)', true);
        window.addEventListener('pagehide', () => l.close(), { once: true });
        game.run();
    };
    const inviteUrl = code => {
        const url = new URL(location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set(coopMode ? 'coop' : 'join', code);
        url.searchParams.set('relay', $('host-relay-url').value);
        return url.toString();
    };
    const netMissing = () => !DuelLink.available();
    const getRelay = id => {
        const input = $(id), endpoint = DuelLink.cleanEndpoint(input.value) || (!input.value.trim() ? defaultRelay : '');
        if (!endpoint) return null;
        input.value = endpoint;
        localStorage.setItem(NET_URL_KEY, endpoint);
        return endpoint;
    };
    $('host-relay-url').value = defaultRelay;
    $('join-relay-url').value = defaultRelay;
    for (const id of ['host-relay-url', 'join-relay-url']) $(id).addEventListener('change', () => {
        const endpoint = getRelay(id);
        if (endpoint) {
            $('host-relay-url').value = endpoint;
            $('join-relay-url').value = endpoint;
        } else setStatus(id === 'host-relay-url' ? 'host-status' : 'join-status',
            'Enter a valid relay URL using ws:// or wss://.', true);
    });
    // only keep the appearance fields we know, whatever a peer sends
    const cleanLook = look => {
        const lo = new Loadout();
        lo.apply({ look }, 0);
        return Object.assign({}, lo.look);
    };

    // ---------------- settings ----------------
    const DUEL_FIELDS = { mode: 'set-mode', maxPlayers: 'set-max', rounds: 'set-rounds', hp: 'set-hp', posture: 'set-posture',
        gourds: 'set-gourds', charges: 'set-charges', speed: 'set-speed', parry: 'set-parry', arena: 'set-arena' };
    const COOP_FIELDS = { maxPlayers: 'co-max', enemyScale: 'co-enemy', countScale: 'co-count' };
    let duelSettings = MatchSettings.duel();
    let coopSettings = MatchSettings.coop();

    const fillSettings = () => {
        for (const key of Object.keys(DUEL_FIELDS)) $(DUEL_FIELDS[key]).value = duelSettings[key];
        for (const key of Object.keys(COOP_FIELDS)) $(COOP_FIELDS[key]).value = coopSettings[key];
        $('co-ff').checked = coopSettings.friendlyFire;
    };
    const readDuelSettings = () => {
        const raw = {};
        for (const key of Object.keys(DUEL_FIELDS)) raw[key] = $(DUEL_FIELDS[key]).value;
        return sanitizeDuelSettings(raw);
    };
    const readCoopSettings = () => {
        const raw = { friendlyFire: $('co-ff').checked };
        for (const key of Object.keys(COOP_FIELDS)) raw[key] = $(COOP_FIELDS[key]).value;
        return sanitizeCoopSettings(raw);
    };
    const maxPlayers = () => (coopMode ? coopSettings.maxPlayers : duelSettings.maxPlayers);

    $('btn-journey').textContent = SaveGame.read() !== null ? 'Continue Journey' : 'Begin Journey';
    $('btn-journey').onclick = () => {
        menu.hidden = true;
        canvas.focus();
        startJourney(canvas, sanitizeJourneyDifficulty(difficultySelect.value));
    };
    $('btn-tutorial').onclick = () => {
        const card = $('tutorial-card');
        card.hidden = !card.hidden;
        $('btn-tutorial').setAttribute('aria-expanded', String(!card.hidden));
    };
    for (const b of document.querySelectorAll('#menu .back')) b.onclick = back;

    // ---------------- host ----------------
    let lobby = [];
    let refreshLobby = () => {};
    const onSettingsChanged = () => {
        if (coopMode) {
            coopSettings = readCoopSettings();
            MatchSettings.saveCoop(coopSettings);
        } else {
            duelSettings = readDuelSettings();
            MatchSettings.saveDuel(duelSettings);
            $('set-max').disabled = duelSettings.mode !== 'ffa';
        }
        fillSettings();
        refreshLobby();
    };
    $('set-mode').onchange = () => {
        // a crowd needs room to move
        $('set-arena').value = $('set-mode').value === 'ffa' ? 'large' : 'medium';
        onSettingsChanged();
    };
    for (const id of ['set-max', 'set-rounds', 'set-hp', 'set-posture', 'set-gourds', 'set-charges', 'set-speed', 'set-parry', 'set-arena',
        'co-max', 'co-enemy', 'co-count', 'co-ff']) $(id).onchange = onSettingsChanged;

    const host = isCoop => {
        coopMode = isCoop;
        show('menu-host');
        $('menu-host').querySelector('h2').textContent = isCoop ? 'Host a Co-op Journey' : 'Host a Duel';
        $('duel-settings').hidden = isCoop;
        $('coop-settings').hidden = !isCoop;
        $('btn-start').textContent = isCoop ? 'Set Out Together' : 'Start Match';
        $('host-code').textContent = '--------';
        $('host-link').value = '';
        $('host-players').textContent = '';
        $('btn-copy').disabled = true;
        $('btn-start').disabled = true;
        $('host-relay-url').disabled = false;
        lobby = [];
        refreshLobby = () => {};
        fillSettings();
        $('set-max').disabled = duelSettings.mode !== 'ffa';
        const endpoint = getRelay('host-relay-url');
        if (!endpoint) {
            setStatus('host-status', 'Enter a valid relay URL using ws:// or wss://.', true);
            return;
        }
        if (netMissing()) {
            setStatus('host-status', 'This browser does not support WebSockets.', true);
            return;
        }
        setStatus('host-status', 'Creating room...');
        const l = link = new DuelLink(isCoop, endpoint);
        let open = false;
        refreshLobby = () => {
            if (link !== l || !open) return;
            const max = maxPlayers(), count = lobby.length + 1, tooMany = count > max;
            const s = isCoop ? coopSettings : duelSettings;
            $('host-players').textContent = 'Players: ' + count + ' / ' + max + '      ' + (isCoop ? describeCoopSettings(s)
                : describeDuelSettings(s));
            $('btn-start').disabled = lobby.length === 0 || tooMany;
            if (tooMany) setStatus('host-status', 'More players than these settings allow - raise the maximum or ask someone to leave.', true);
            else if (lobby.length === 0) setStatus('host-status', 'Waiting for players... send them the invite link or the room code.');
            else setStatus('host-status', 'Everyone in? Press ' + (isCoop ? 'Set Out Together' : 'Start Match') + ' when ready.');
            for (const c of lobby) c.send({ t: 'lobby', n: count, max, s });
        };
        l.accept = n => n < maxPlayers() - 1;
        l.host(code => {
            if (link !== l) return;
            open = true;
            $('host-code').textContent = code;
            $('host-link').value = inviteUrl(code);
            $('host-relay-url').disabled = true;
            $('btn-copy').disabled = false;
            refreshLobby();
        }, e => {
            if (link === l) setStatus('host-status', DuelLink.errorText(e), true);
        });
        const refuse = (c, msg) => {
            c.send(msg);
            setTimeout(() => l.drop(c), 300);
        };
        l.on('hello', (d, c) => {
            if (link !== l || lobby.includes(c)) return;
            if (d.v !== NET_VERSION || !!d.coop !== isCoop) {
                refuse(c, { t: 'reject', why: 'Version mismatch - everyone needs the same version of the game.' });
                return;
            }
            if (lobby.length + 1 >= maxPlayers()) {
                refuse(c, { t: 'full' });
                return;
            }
            c.look = cleanLook(d.look);
            lobby.push(c);
            refreshLobby();
        });
        l.onPeerClose = c => {
            if (link !== l) return;
            lobby = lobby.filter(x => x !== c);
            refreshLobby();
        };
        l.onClose = () => {
            if (link === l) refreshLobby();
        };
        l.onRelayClose = () => {
            if (link !== l) return;
            $('btn-copy').disabled = true;
            $('btn-start').disabled = true;
            setStatus('host-status', 'The relay disconnected. Go back and create a new room.', true);
        };
    };
    $('btn-host').onclick = () => host(false);
    $('btn-host-coop').onclick = () => host(true);

    $('btn-start').onclick = () => {
        const l = link;
        if (l === null || l.role !== 'host' || lobby.length === 0 || lobby.length + 1 > maxPlayers()) return;
        l.accept = () => false;
        l.onPeerClose = null;
        for (const c of l.conns.slice()) {
            if (!lobby.includes(c)) {
                c.send({ t: 'full' });
                setTimeout(() => l.drop(c), 300);
            }
        }
        lobby.forEach((c, k) => { c.idx = k + 1; });
        const party = lobby.length + 1;
        if (coopMode) {
            const s = coopSettings;
            const stored = SaveGame.read();
            const params = new URLSearchParams(location.search);
            const seed = stored ? stored.seed : params.has('seed') && Number.isFinite(Number(params.get('seed')))
                ? Number(params.get('seed')) : Math.floor(Math.random() * 2 ** 48);
            const game = new Game(seed, canvas, stored, { coopSettings: s, partySize: party });
            const save = SaveGame.serialize(game);
            for (const c of lobby) c.send({ t: 'start', coop: true, save, s, you: c.idx, party });
            link = null;
            startCoop(l, true, save, game, s, 0, party);
            return;
        }
        const s = duelSettings;
        // a relayed input crosses two links, so budget for the two slowest
        const rtts = lobby.map(c => c.ping()).sort((a, b) => b - a);
        const delay = inputDelayFor((rtts[0] || 0) + (rtts[1] || 0));
        const looks = [myLook].concat(lobby.map(c => c.look));
        for (const c of lobby) c.send({ t: 'start', delay, looks, you: c.idx, s });
        link = null;
        startDuel(l, 0, delay, looks, s);
    };

    $('btn-copy').onclick = () => {
        const url = $('host-link').value;
        if (!url) return;
        const done = () => setStatus('host-status', 'Invite link copied. Waiting for players...');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => {
            $('host-link').select();
            document.execCommand('copy');
            done();
        });
        else {
            $('host-link').select();
            document.execCommand('copy');
            done();
        }
    };

    // ---------------- join ----------------
    const join = () => {
        const code = DuelLink.cleanCode($('join-code').value);
        $('join-code').value = code;
        if (code.length !== 8) {
            setStatus('join-status', 'Enter the 8-character port ID your host gave you.', true);
            return;
        }
        if (netMissing()) {
            setStatus('join-status', 'Online play needs an internet connection to reach the relay.', true);
            return;
        }
        dropLink();
        $('join-lobby').textContent = '';
        setStatus('join-status', 'Connecting...');
        const endpoint = getRelay('join-relay-url');
        if (!endpoint) {
            setStatus('join-status', 'Enter a valid relay URL using ws:// or wss://.', true);
            return;
        }
        const l = link = new DuelLink(coopMode, endpoint);
        joinTimer = setTimeout(() => {
            if (link === l && !l.connected) {
                dropLink();
                setStatus('join-status', 'Could not reach that room. Check the code and try again.', true);
            }
        }, 15000);
        l.join(code, e => {
            if (link !== l) return;
            dropLink();
            setStatus('join-status', DuelLink.errorText(e), true);
        });
        l.onOpen = () => {
            if (link !== l) return;
            setStatus('join-status', 'Connected! Waiting for the host...');
            l.send({ t: 'hello', v: NET_VERSION, look: myLook, coop: coopMode });
        };
        l.on('full', () => {
            if (link !== l) return;
            dropLink();
            setStatus('join-status', 'That room is full or has already started.', true);
        });
        l.on('reject', d => {
            if (link !== l) return;
            dropLink();
            setStatus('join-status', typeof d.why === 'string' ? d.why.slice(0, 120) : 'The host rejected the connection.', true);
        });
        l.on('lobby', d => {
            if (link !== l) return;
            const s = coopMode ? sanitizeCoopSettings(d.s) : sanitizeDuelSettings(d.s);
            const max = Number.isInteger(d.max) ? U.clamp(d.max, 2, MAX_MATCH_PLAYERS) : s.maxPlayers;
            const n = Number.isInteger(d.n) ? U.clamp(d.n, 1, MAX_MATCH_PLAYERS) : 1;
            setStatus('join-status', 'Connected! Waiting for the host to start  (' + n + ' / ' + max + ' players)');
            $('join-lobby').textContent = coopMode ? describeCoopSettings(s) : describeDuelSettings(s);
        });
        l.on('start', d => {
            if (link !== l) return;
            const you = d.you;
            if (coopMode) {
                const party = Number.isInteger(d.party) ? U.clamp(d.party, 2, MAX_MATCH_PLAYERS) : 2;
                if (!d.coop || !SaveGame.valid(d.save) || !Number.isInteger(you) || you < 1 || you >= party) {
                    dropLink();
                    setStatus('join-status', 'Invalid journey data from host.', true);
                    return;
                }
                link = null;
                startCoop(l, false, d.save, null, sanitizeCoopSettings(d.s), you, party);
                return;
            }
            const n = Array.isArray(d.looks) ? d.looks.length : 0;
            if (n < 2 || n > MAX_MATCH_PLAYERS || !Number.isInteger(you) || you < 1 || you >= n) {
                dropLink();
                setStatus('join-status', 'The host sent an invalid match setup.', true);
                return;
            }
            link = null;
            const delay = Number.isInteger(d.delay) ? U.clamp(d.delay, 3, 10) : 4;
            const looks = d.looks.map(cleanLook);
            looks[you] = myLook;
            startDuel(l, you, delay, looks, sanitizeDuelSettings(d.s));
        });
        l.onClose = () => {
            if (link === l) {
                link = null;
                setStatus('join-status', 'The host or relay closed the connection.', true);
            }
        };
    };

    const openJoin = isCoop => {
        coopMode = isCoop;
        show('menu-join');
        $('menu-join').querySelector('h2').textContent = isCoop ? 'Join a Co-op Journey' : 'Join a Duel';
        $('join-lobby').textContent = '';
        setStatus('join-status', '');
        $('join-code').focus();
    };
    $('btn-join').onclick = () => openJoin(false);
    $('btn-join-coop').onclick = () => openJoin(true);
    $('btn-join-go').onclick = join;
    $('join-code').addEventListener('keydown', e => {
        if (e.key === 'Enter') join();
    });

    // invite links open straight into the join screen
    const invite = params.get('coop') || params.get('join');
    if (invite) {
        openJoin(params.has('coop'));
        $('join-code').value = DuelLink.cleanCode(invite);
        if (relayFromUrl) $('join-relay-url').value = DuelLink.cleanEndpoint(relayFromUrl) || defaultRelay;
        join();
    } else show('menu-main');
})();
