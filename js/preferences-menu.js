'use strict';

const PreferencesMenu = (() => {
    const $ = id => document.getElementById(id);
    const dialog = $('preferences-dialog'), status = $('preferences-status'), list = $('keybind-list');
    const fields = ['volume', 'muted', 'particles', 'petals', 'shake', 'flashes', 'vignette'];
    let capture = null, runtime = null, returnFocus = null, suppressClick = false, storageOk = true;
    const report = message => { status.textContent = message; };
    const refreshHints = () => {
        for (const node of document.querySelectorAll('[data-control]')) {
            node.textContent = Preferences.label(node.dataset.control);
        }
    };
    const save = message => {
        const ok = Preferences.save();
        storageOk = ok;
        refreshHints();
        report(ok ? message : 'Settings work for this session, but browser storage is unavailable. They could not be saved.');
    };
    const cancelCapture = () => {
        if (!capture) return;
        const button = capture.button;
        capture = null;
        $('cancel-binding').hidden = true;
        button.textContent = bindingLabel(Preferences.value.bindings[button.dataset.action][Number(button.dataset.slot)]);
    };
    const renderBindings = () => {
        cancelCapture();
        list.replaceChildren();
        let group = '';
        for (const [action, [label, category]] of Object.entries(CONTROL_DEFS)) {
            if (category !== group) {
                const heading = document.createElement('h4');
                heading.textContent = group = category;
                list.append(heading);
            }
            const row = document.createElement('div'), name = document.createElement('span');
            row.className = 'binding-row';
            name.textContent = label;
            row.append(name);
            for (let slot = 0; slot < 3; slot++) {
                const cell = document.createElement('div'), button = document.createElement('button');
                button.type = 'button';
                button.dataset.action = action;
                button.dataset.slot = slot;
                button.textContent = bindingLabel(Preferences.value.bindings[action][slot]);
                button.setAttribute('aria-label', label + ', binding ' + (slot + 1));
                button.onclick = () => {
                    cancelCapture();
                    capture = { action, slot, button };
                    button.textContent = 'Press key / mouse';
                    $('cancel-binding').hidden = false;
                    report('Press any key or mouse button (including Escape). Use Cancel binding to stop.');
                };
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'clear-binding';
                clear.textContent = 'Clear';
                clear.setAttribute('aria-label', 'Clear ' + label + ', binding ' + (slot + 1));
                clear.onclick = () => {
                    cancelCapture();
                    Preferences.value.bindings[action].splice(slot, 1);
                    save('Binding cleared.');
                    renderBindings();
                };
                cell.append(button, clear);
                row.append(cell);
            }
            list.append(row);
        }
    };
    const fill = () => {
        for (const key of fields) {
            const field = $('pref-' + key);
            if (field.type === 'checkbox') field.checked = Preferences.value[key];
            else field.value = Preferences.value[key];
        }
        $('volume-value').textContent = Preferences.value.volume + '%';
        $('shake-value').textContent = Preferences.value.shake + '%';
        renderBindings();
    };
    const bind = code => {
        if (!validBinding(code)) {
            report('That key is not supported by this browser. Choose another key.');
            return;
        }
        const { action, slot } = capture, bindings = Preferences.value.bindings[action];
        const next = bindings.slice();
        next[Math.min(slot, next.length)] = code;
        Preferences.value.bindings[action] = [...new Set(next)];
        const overlaps = Object.keys(CONTROL_DEFS).filter(id => id !== action && Preferences.value.bindings[id].includes(code));
        save(bindingLabel(code) + ' assigned.' + (overlaps.length
            ? ' Also used by: ' + overlaps.map(id => CONTROL_DEFS[id][0]).join(', ') + '. Shared bindings trigger both actions when active.' : ''));
        renderBindings();
    };
    window.addEventListener('keydown', event => {
        if (!capture) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) bind(event.code);
    }, true);
    window.addEventListener('mousedown', event => {
        if (!capture || event.target.closest('#cancel-binding, .clear-binding, #close-preferences')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = true;
        bind('Mouse' + event.button);
    }, true);
    window.addEventListener('click', event => {
        if (!suppressClick) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
    window.addEventListener('mouseup', () => {
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 0);
    }, true);
    dialog.addEventListener('contextmenu', event => event.preventDefault());
    const resetInput = () => {
        if (!runtime) return;
        runtime.input.releaseAll();
        runtime.mouseAttackPending = false;
        if (runtime.player) runtime.player.mouseAttackPending = false;
    };
    const close = () => {
        cancelCapture();
        Preferences.open = false;
        resetInput();
        if (returnFocus) returnFocus.focus();
    };
    dialog.addEventListener('close', close);
    dialog.addEventListener('cancel', event => {
        if (capture) {
            event.preventDefault();
            cancelCapture();
        }
    });
    $('close-preferences').onclick = () => dialog.close();
    $('cancel-binding').onclick = () => { cancelCapture(); report('Binding cancelled.'); };
    for (const key of fields) $('pref-' + key).oninput = () => {
        const field = $('pref-' + key);
        Preferences.value[key] = field.type === 'checkbox' ? field.checked : Number(field.value);
        $('volume-value').textContent = Preferences.value.volume + '%';
        $('shake-value').textContent = Preferences.value.shake + '%';
        save('Settings saved.');
    };
    $('reset-keybinds').onclick = () => {
        Preferences.value.bindings = defaultPreferences().bindings;
        save('Default keybinds restored.');
        renderBindings();
    };
    $('reset-preferences').onclick = () => {
        Preferences.value = defaultPreferences();
        save('Default settings restored.');
        fill();
    };
    const open = () => {
        if (Preferences.open) return;
        returnFocus = runtime ? runtime.canvas : document.activeElement;
        Preferences.open = true;
        resetInput();
        fill();
        report(!storageOk ? 'Settings could not be loaded or saved. Current settings apply for this session; changes will attempt to save again.'
            : runtime && (runtime.coop || runtime.players)
            ? 'Online play continues while settings are open. Your movement and combat inputs are released.'
            : 'Changes apply immediately and are saved in this browser.');
        dialog.showModal();
        $('close-preferences').focus();
    };
    $('btn-preferences').onclick = open;
    $('play-preferences').onclick = open;
    storageOk = Preferences.read();
    refreshHints();
    if (!storageOk) report('Saved settings could not be loaded. Defaults are in use.');
    return {
        open,
        attach(game) {
            runtime = game;
            $('play-preferences').hidden = false;
        },
    };
})();
