'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');

const NET_VERSION = 13;
const MAX_CONNECTIONS_PER_ROOM = 8;
const MAX_PAYLOAD = 1024 * 1024;
const ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_ROOMS = 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOT = path.resolve(__dirname, '..');
const rooms = new Map();

function reply(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function fail(ws, code, message) {
    reply(ws, { sys: 'error', code, message });
}

function newRoomCode() {
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes, value => CODE_CHARS[value & 31]).join('');
}

function safeRoomCode(value) {
    return typeof value === 'string' && /^[A-Z2-9]{8}$/.test(value) ? value : '';
}

function closeGuest(room, id, code = 1000, reason = 'Room closed') {
    const guest = room.guests.get(id);
    if (!guest) return;
    room.guests.delete(id);
    reply(room.host, { sys: 'peer-close', id });
    if (guest.readyState === WebSocket.OPEN) guest.close(code, reason);
}

function clearRoom(room, reason) {
    clearTimeout(room.expiry);
    rooms.delete(room.code);
    for (const guest of room.guests.values()) {
        reply(guest, { sys: 'host-closed' });
        if (guest.readyState === WebSocket.OPEN) guest.close(1001, reason);
    }
    room.guests.clear();
}

function parseMessage(raw) {
    try {
        const message = JSON.parse(raw.toString());
        return message && typeof message === 'object' && !Array.isArray(message) ? message : null;
    } catch (e) {
        return null;
    }
}

function createRoom(ws, msg) {
    if (msg.v !== NET_VERSION) return fail(ws, 'version-mismatch', 'This game version is not supported by the relay.');
    if (typeof msg.coop !== 'boolean') return fail(ws, 'invalid-request', 'Missing room mode.');
    if (rooms.size >= MAX_ROOMS) return fail(ws, 'relay-full', 'The relay is busy. Try again later.');
    let code;
    do { code = newRoomCode(); } while (rooms.has(code));
    const room = { code, host: ws, coop: msg.coop, guests: new Map(), started: false, touched: Date.now(), expiry: null };
    rooms.set(code, room);
    ws.role = 'host';
    ws.room = room;
    reply(ws, { sys: 'created', code });
}

function joinRoom(ws, msg) {
    const code = safeRoomCode(msg.code);
    const room = code && rooms.get(code);
    if (msg.v !== NET_VERSION) return fail(ws, 'version-mismatch', 'This game version is not supported by the relay.');
    if (!room) return fail(ws, 'room-not-found', 'No room found with that ID.');
    if (msg.coop !== room.coop) return fail(ws, 'mode-mismatch', 'That room is for a different multiplayer mode.');
    if (room.started || room.guests.size >= MAX_CONNECTIONS_PER_ROOM) return fail(ws, 'room-full', 'That room is full or has already started.');
    const id = crypto.randomBytes(8).toString('hex');
    ws.role = 'guest';
    ws.room = room;
    ws.peerId = id;
    room.guests.set(id, ws);
    room.touched = Date.now();
    reply(ws, { sys: 'joined', code, id });
    reply(room.host, { sys: 'peer-open', id });
}

function routeMessage(ws, msg) {
    const room = ws.room;
    if (!room || !msg.data || typeof msg.data !== 'object' || Array.isArray(msg.data)
        || typeof msg.data.t !== 'string' || msg.data.t.length > 40) {
        return fail(ws, 'invalid-request', 'Invalid multiplayer message.');
    }
    room.touched = Date.now();
    if (ws.role === 'guest') {
        if (msg.data.t === 'start') return fail(ws, 'invalid-request', 'Only the host can start a room.');
        reply(room.host, { sys: 'data', from: ws.peerId, data: msg.data });
        return;
    }
    if (msg.data.t === 'start') room.started = true;
    for (const [id, guest] of room.guests) reply(guest, { sys: 'data', from: 'host', data: msg.data });
}

function handleCommand(ws, msg) {
    if (typeof msg.op !== 'string') return fail(ws, 'invalid-request', 'Invalid relay request.');
    if (!ws.role) {
        if (msg.op === 'create') return createRoom(ws, msg);
        if (msg.op === 'join') return joinRoom(ws, msg);
        return fail(ws, 'invalid-request', 'Create or join a room first.');
    }
    if (msg.op === 'ping') {
        if (ws.room) ws.room.touched = Date.now();
        const rtt = Number.isFinite(msg.ts) ? Date.now() - msg.ts : 0;
        return reply(ws, { sys: 'pong', ts: msg.ts, rtt: Math.max(0, Math.min(rtt, 60000)) });
    }
    if (msg.op === 'send') return routeMessage(ws, msg);
    if (msg.op === 'target' && ws.role === 'host' && typeof msg.id === 'string') {
        if (msg.data && msg.data.t === 'start') ws.room.started = true;
        const guest = ws.room.guests.get(msg.id);
        if (guest) reply(guest, { sys: 'data', from: 'host', data: msg.data });
        return;
    }
    if (msg.op === 'relay' && ws.role === 'host') {
        const room = ws.room;
        if (!msg.data || typeof msg.data !== 'object' || typeof msg.data.t !== 'string') return;
        for (const [id, guest] of room.guests) {
            if (id !== msg.except) reply(guest, { sys: 'data', from: 'host', data: msg.data });
        }
        return;
    }
    if (msg.op === 'drop' && ws.role === 'host' && typeof msg.id === 'string') {
        return closeGuest(ws.room, msg.id, 1000, 'Removed by host');
    }
    if (msg.op === 'client-pong' && ws.role === 'guest' && Number.isFinite(msg.ts)) {
        reply(ws.room.host, { sys: 'pong', id: ws.peerId, from: ws.peerId, ts: msg.ts });
        return;
    }
    fail(ws, 'invalid-request', 'Operation is not allowed for this connection.');
}

function contentType(file) {
    return ({
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.ico': 'image/x-icon',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
    })[path.extname(file)] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/' && pathname !== '/index.html' && pathname !== '/CHANGELOG.md'
        && !/^\/js\/[A-Za-z0-9._-]+\.js$/.test(pathname)) {
        res.writeHead(404).end('Not found');
        return;
    }
    let file;
    try {
        const decoded = decodeURIComponent(pathname);
        file = path.resolve(ROOT, '.' + decoded);
    } catch (e) {
        res.writeHead(400).end('Bad request');
        return;
    }
    if (file === ROOT) file = path.join(ROOT, 'index.html');
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    fs.stat(file, (statError, stat) => {
        if (statError || !stat.isFile()) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType(file),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': file.endsWith('.html') || file.endsWith('.md') ? 'no-cache' : 'public, max-age=300',
        });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(file).pipe(res);
    });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
server.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
        pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (e) {
        socket.destroy();
        return;
    }
    if (pathname !== '/ws') {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', ws => {
    ws.on('message', raw => {
        const msg = parseMessage(raw);
        if (!msg) return fail(ws, 'invalid-json', 'Messages must be JSON objects.');
        const now = Date.now();
        if (!ws.rateStart || now - ws.rateStart >= 1000) {
            ws.rateStart = now;
            ws.rateCount = 0;
        }
        if (++ws.rateCount > 600) {
            ws.close(1008, 'Too many messages');
            return;
        }
        handleCommand(ws, msg);
    });
    ws.on('close', () => {
        const room = ws.room;
        if (!room) return;
        if (ws.role === 'host') clearRoom(room, 'Host disconnected');
        else if (ws.peerId) {
            room.guests.delete(ws.peerId);
            reply(room.host, { sys: 'peer-close', id: ws.peerId });
            room.touched = Date.now();
        }
    });
    ws.on('error', () => {});
});

setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const room of rooms.values()) {
        if (room.touched < cutoff && room.guests.size === 0) clearRoom(room, 'Room expired');
    }
}, 60000).unref();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`Ronin's Path relay listening on ${host}:${port}`));

module.exports = { server, rooms };
