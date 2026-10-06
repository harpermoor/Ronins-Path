'use strict';

/** WebSocket room relay. All peers make outbound connections; room IDs are relay-side port identifiers. */
const NET_VERSION = 11;
const NET_URL_KEY = 'roninsPath.relayUrl.v1';
const NET_PING_EVERY_MS = 1000;

class NetConn {
    constructor(link, id) {
        this.link = link;
        this.id = id;
        this.idx = -1;
        this.look = null;
        this.open = true;
        this.rtt = 0;
    }

    get isOpen() { return this.open && !this.link.closed; }
    ping() { return this.rtt; }
    send(obj) { if (this.isOpen) this.link.target(this, obj); }
}

class DuelLink {
    constructor(coop = false, endpoint = '') {
        this.coop = !!coop;
        this.endpoint = DuelLink.cleanEndpoint(endpoint) || DuelLink.defaultEndpoint();
        this.socket = null;
        this.conns = [];
        this.role = null;
        this.handlers = new Map();
        this.heartbeat = 0;
        this.closed = false;
        this.opened = false;
        this.roomCode = '';
        this.lastHeard = performance.now();
        this.serverRtt = 0;
        this.onOpen = null;
        this.onClose = null;
        this.onRelayClose = null;
        this.onPeerOpen = null;
        this.onPeerClose = null;
        this.accept = () => true;
    }

    static available() { return typeof WebSocket !== 'undefined'; }

    static defaultEndpoint() {
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        return scheme + '//' + location.host + '/ws';
    }

    static cleanEndpoint(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const url = new URL(value.trim(), location.href);
            if (url.protocol === 'https:') url.protocol = 'wss:';
            else if (url.protocol === 'http:') url.protocol = 'ws:';
            if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password
                || url.search || url.hash || !url.hostname) return '';
            if (url.pathname === '/') url.pathname = '/ws';
            return url.toString().replace(/\/$/, '');
        } catch (e) {
            return '';
        }
    }

    static cleanCode(value) {
        return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    }

    static errorText(e) {
        if (e && typeof e.message === 'string') return e.message;
        if (e && e.code === 'room-not-found') return 'No room found with that ID. Check it and try again.';
        if (e && e.code === 'room-full') return 'That room is full or has already started.';
        if (e && e.code === 'mode-mismatch') return 'That room is for a different multiplayer mode.';
        return 'Could not connect to the multiplayer relay. Check the relay URL and your internet connection.';
    }

    get conn() { return this.socket; }
    get connected() { return this.opened && this.socket !== null && this.socket.readyState === WebSocket.OPEN; }

    get lastHeard() {
        return this._lastHeard || 0;
    }

    set lastHeard(value) { this._lastHeard = value; }

    ping() {
        let result = 0;
        for (const c of this.conns) result = Math.max(result, c.ping());
        return Math.max(result, this.serverRtt);
    }

    on(type, fn) { this.handlers.set(type, fn); }

    host(onCode, onErr) {
        this.role = 'host';
        this.connect(() => this.sendSystem({ op: 'create', v: NET_VERSION, coop: this.coop }), onErr, data => {
            if (data.sys === 'created' && typeof data.code === 'string') {
                this.roomCode = data.code;
                if (onCode) onCode(data.code);
            }
        });
    }

    join(code, onErr) {
        this.role = 'client';
        const id = DuelLink.cleanCode(code);
        this.connect(() => this.sendSystem({ op: 'join', code: id, v: NET_VERSION, coop: this.coop }), onErr);
    }

    connect(onReady, onErr, onSystem) {
        if (!DuelLink.available()) {
            if (onErr) onErr(new Error('This browser does not support WebSockets.'));
            return;
        }
        let errorReported = false;
        const reportError = error => {
            if (errorReported) return;
            errorReported = true;
            if (onErr) onErr(error);
        };
        let socket;
        try {
            socket = new WebSocket(this.endpoint);
        } catch (e) {
            reportError(e);
            return;
        }
        this.socket = socket;
        socket.addEventListener('open', () => {
            if (this.closed) return socket.close();
            this.opened = true;
            this.lastHeard = performance.now();
            this.heartbeat = setInterval(() => this.pingRelay(), NET_PING_EVERY_MS);
            if (onReady) onReady();
        });
        socket.addEventListener('message', event => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            if (!data || typeof data !== 'object') return;
            this.lastHeard = performance.now();
            if (data.sys === 'pong') return this.receivePong(data);
            if (data.sys === 'error') {
                reportError({ code: data.code, message: data.message });
                return;
            }
            if (data.sys) {
                if (data.sys === 'joined') {
                    this.roomCode = data.code;
                    if (this.onOpen) this.onOpen();
                } else if (data.sys === 'peer-open') {
                    this.openPeer(data.id);
                } else if (data.sys === 'peer-close') {
                    this.closePeer(data.id);
                } else if (data.sys === 'data') {
                    this.receiveData(data);
                } else if (data.sys === 'host-closed') {
                    this.closePeers();
                    if (this.onClose) this.onClose();
                }
                if (onSystem) onSystem(data);
                return;
            }
        });
        socket.addEventListener('error', () => {
            if (!this.opened) reportError(new Error('The relay connection failed.'));
        });
        socket.addEventListener('close', () => {
            clearInterval(this.heartbeat);
            const wasOpened = this.opened;
            this.opened = false;
            this.closePeers();
            if (!this.closed && !wasOpened) reportError(new Error('The relay closed the connection.'));
            else if (!this.closed && wasOpened) {
                if (this.onClose) this.onClose();
                if (this.onRelayClose) this.onRelayClose();
            }
        });
    }

    sendSystem(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify(message));
    }

    send(obj) {
        if (this.closed) return;
        this.sendSystem({ op: 'send', data: obj });
    }

    target(conn, obj) {
        if (this.closed) return;
        this.sendSystem({ op: 'target', id: conn.id, data: obj });
    }

    relay(obj, from) {
        if (this.closed) return;
        this.sendSystem({ op: 'relay', except: from ? from.id : null, data: obj });
    }

    pingRelay() {
        if (!this.connected) return;
        const ts = performance.now();
        this.sendSystem({ op: 'ping', ts });
        for (const c of this.conns) {
            this.target(c, { t: 'net-ping', ts });
        }
    }

    receivePong(data) {
        if (!Number.isFinite(data.ts)) return;
        const elapsed = performance.now() - data.ts;
        if (elapsed < 0 || elapsed > 60000) return;
        const c = data.id ? this.conns.find(peer => peer.id === data.id) : null;
        if (c) c.rtt = c.rtt ? c.rtt * 0.75 + elapsed * 0.25 : elapsed;
        else this.serverRtt = this.serverRtt ? this.serverRtt * 0.75 + elapsed * 0.25 : elapsed;
    }

    openPeer(id) {
        if (typeof id !== 'string' || this.conns.some(c => c.id === id)) return;
        const peer = new NetConn(this, id);
        this.conns.push(peer);
        if (this.onPeerOpen) this.onPeerOpen(peer);
        if (!this.accept(this.conns.length - 1)) {
            peer.send({ t: 'full' });
            this.drop(peer);
        }
    }

    closePeer(id, notify = true) {
        const peer = this.conns.find(c => c.id === id);
        if (!peer) return;
        peer.open = false;
        this.conns = this.conns.filter(c => c !== peer);
        if (notify && this.onPeerClose) this.onPeerClose(peer);
        if (notify && this.conns.length === 0 && this.role === 'host' && this.onClose) this.onClose();
    }

    closePeers(notify = true) {
        for (const peer of this.conns.slice()) this.closePeer(peer.id, notify);
    }

    receiveData(packet) {
        const peer = packet.from === 'host' ? null : this.conns.find(c => c.id === packet.from) || null;
        const data = packet.data;
        if (!data || typeof data !== 'object' || typeof data.t !== 'string') return;
        if (data.t === 'net-ping' && this.role === 'client' && Number.isFinite(data.ts)) {
            this.sendSystem({ op: 'client-pong', ts: data.ts });
            return;
        }
        if (data.t === 'net-pong' && Number.isFinite(data.ts)) {
            const elapsed = performance.now() - data.ts;
            if (peer && elapsed >= 0 && elapsed < 60000) peer.rtt = peer.rtt ? peer.rtt * 0.75 + elapsed * 0.25 : elapsed;
            return;
        }
        const handler = this.handlers.get(data.t);
        if (handler) handler(data, peer);
    }

    drop(peer) {
        if (!peer || !this.conns.includes(peer)) return;
        this.sendSystem({ op: 'drop', id: peer.id });
        this.closePeer(peer.id);
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.heartbeat);
        if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close(1000, 'Left room');
        this.closePeers(false);
    }
}
