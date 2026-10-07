'use strict';

const PREFERENCES_KEY = 'ronins-path-preferences';
const CONTROL_DEFS = {
    moveUp: ['Move up', 'Movement', ['KeyW', 'ArrowUp']],
    moveDown: ['Move down', 'Movement', ['KeyS', 'ArrowDown']],
    moveLeft: ['Move left', 'Movement', ['KeyA', 'ArrowLeft']],
    moveRight: ['Move right', 'Movement', ['KeyD', 'ArrowRight']],
    attack: ['Attack (tap) / heavy strike (hold)', 'Combat', ['Mouse0']],
    quickAttack: ['Immediate light attack', 'Combat', ['KeyJ']],
    guard: ['Deflect (tap) / block (hold)', 'Combat', ['Mouse2', 'KeyK']],
    dodge: ['Dodge (tap) / sprint (hold)', 'Combat', ['Space', 'KeyL']],
    lockOn: ['Toggle lock-on', 'Combat', ['KeyC', 'Mouse1']],
    heal: ['Healing gourd', 'Combat', ['KeyQ']],
    iai: ['Iai Flash', 'Combat', ['KeyF']],
    art: ['Combat art', 'Combat', ['KeyR']],
    dragon: ['Dragon Flash', 'Combat', ['KeyG']],
    throw: ['Throw weapon', 'Combat', ['KeyT']],
    interact: ['Shrine / revive / resurrect', 'Journey', ['KeyE']],
    equipment: ['Open / close equipment', 'Journey', ['Tab', 'KeyI']],
    pause: ['Pause / back / leave duel (twice)', 'Journey', ['Escape']],
    settings: ['Open settings', 'Journey', ['F10']],
    ready: ['Duel rematch / cancel / return', 'Duel', ['Enter', 'NumpadEnter']],
    menuUp: ['Menu up', 'Menus', ['KeyW', 'ArrowUp']],
    menuDown: ['Menu down', 'Menus', ['KeyS', 'ArrowDown']],
    menuLeft: ['Menu left', 'Menus', ['KeyA', 'ArrowLeft']],
    menuRight: ['Menu right', 'Menus', ['KeyD', 'ArrowRight']],
    listPrevious: ['Previous shrine / pause option', 'Menus', ['ArrowUp', 'ArrowLeft']],
    listNext: ['Next shrine / pause option', 'Menus', ['ArrowDown', 'ArrowRight']],
    listConfirm: ['Confirm shrine / pause option', 'Menus', ['Enter', 'NumpadEnter']],
    confirm: ['Menu confirm / equip / learn', 'Menus', ['Enter', 'NumpadEnter', 'Space']],
    previousTab: ['Previous equipment tab', 'Menus', ['KeyQ']],
    nextTab: ['Next equipment tab', 'Menus', ['KeyE']],
    save: ['Save journey', 'Pause shortcuts', ['KeyS']],
    export: ['Export save', 'Pause shortcuts', ['KeyX']],
    import: ['Import save', 'Pause shortcuts', ['KeyL']],
    mainMenu: ['Return to main menu', 'Pause shortcuts', ['KeyQ']],
    resetMap: ['Reset map', 'Pause shortcuts', ['KeyM']],
    newGame: ['Start new game', 'Pause shortcuts', ['KeyN']],
    friendlyFire: ['Toggle friendly fire', 'Co-op host shortcuts', ['KeyO']],
    enemyDown: ['Decrease enemy strength', 'Co-op host shortcuts', ['BracketLeft']],
    enemyUp: ['Increase enemy strength', 'Co-op host shortcuts', ['BracketRight']],
    countDown: ['Decrease enemy numbers', 'Co-op host shortcuts', ['Semicolon']],
    countUp: ['Increase enemy numbers', 'Co-op host shortcuts', ['Quote']],
};

function validBinding(code) {
    return typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-9]|2[0-4])|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Meta(Left|Right)|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Pause|PrintScreen|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|IntlRo|IntlYen|Semicolon|Quote|Comma|Period|Slash|ContextMenu|Mouse[0-4])$/.test(code);
}

function defaultPreferences() {
    const bindings = {};
    for (const [id, def] of Object.entries(CONTROL_DEFS)) bindings[id] = def[2].slice();
    return { volume: 100, muted: false, particles: true, petals: true, shake: 100,
        flashes: true, vignette: true, bindings };
}

function sanitizePreferences(raw) {
    const result = defaultPreferences();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
    for (const key of ['volume', 'shake']) {
        if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) result[key] = Math.max(0, Math.min(100, raw[key]));
    }
    for (const key of ['muted', 'particles', 'petals', 'flashes', 'vignette']) {
        if (typeof raw[key] === 'boolean') result[key] = raw[key];
    }
    if (raw.bindings && typeof raw.bindings === 'object') {
        for (const id of Object.keys(CONTROL_DEFS)) {
            const list = raw.bindings[id];
            if (Array.isArray(list) && list.length <= 3 && list.every(validBinding)) {
                result.bindings[id] = [...new Set(list)];
            }
        }
    }
    return result;
}

function bindingLabel(code) {
    if (!code) return 'Unbound';
    const mouse = ['Left mouse', 'Middle mouse', 'Right mouse', 'Mouse 4', 'Mouse 5'];
    if (code.startsWith('Mouse')) return mouse[Number(code.slice(5))];
    return code.replace(/^Key|^Digit/, '').replace(/^Arrow/, '').replace(/^Numpad/, 'Num ')
        .replace(/(Left|Right)$/, ' $1');
}

const Preferences = {
    value: defaultPreferences(),
    listeners: new Set(),
    open: false,
    read() {
        try {
            this.value = sanitizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY)));
        } catch (error) {
            console.warn('Settings could not be loaded:', error);
            this.value = defaultPreferences();
            return false;
        }
        return true;
    },
    save() {
        this.value = sanitizePreferences(this.value);
        for (const listener of this.listeners) listener(this.value);
        try {
            localStorage.setItem(PREFERENCES_KEY, JSON.stringify(this.value));
            return true;
        } catch (error) {
            console.warn('Settings could not be saved:', error);
            return false;
        }
    },
    bindings(action) { return this.value.bindings[action] || [action]; },
    label(action) { return this.bindings(action).map(bindingLabel).join(' / ') || 'Unbound'; },
};
