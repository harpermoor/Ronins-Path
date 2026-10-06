'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { WebSocket } = require('ws');

async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

function connect(url) {
    const socket = new WebSocket(url);
    const messages = [];
    const waiters = [];
    socket.on('message', raw => {
        const message = JSON.parse(raw.toString());
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index >= 0) {
            const [waiter] = waiters.splice(index, 1);
            clearTimeout(waiter.timer);
            waiter.resolve(message);
        } else messages.push(message);
    });
    return {
        socket,
        async open() {
            await new Promise((resolve, reject) => {
                socket.once('open', resolve);
                socket.once('error', reject);
            });
        },
        send(message) { socket.send(JSON.stringify(message)); },
        waitFor(predicate) {
            const index = messages.findIndex(predicate);
            if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
            return new Promise((resolve, reject) => {
                const waiter = { predicate, resolve, timer: null };
                waiter.timer = setTimeout(() => {
                    const i = waiters.indexOf(waiter);
                    if (i >= 0) waiters.splice(i, 1);
                    reject(new Error('Timed out waiting for relay message'));
                }, 4000);
                waiters.push(waiter);
            });
        },
    };
}

async function checkBrowserClient(wsUrl, httpUrl) {
    const context = vm.createContext({
        URL,
        WebSocket,
        clearInterval,
        location: new URL(httpUrl),
        performance,
        setInterval,
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'net.js'), 'utf8'), context);
    const DuelLink = vm.runInContext('DuelLink', context);
    const host = new DuelLink('', wsUrl), guest = new DuelLink('', wsUrl);
    let resolveCode, resolvePeer, resolveLobby, resolveStart, resolveClose;
    const codeReady = new Promise(resolve => { resolveCode = resolve; });
    const peerReady = new Promise(resolve => { resolvePeer = resolve; });
    const lobbyReady = new Promise(resolve => { resolveLobby = resolve; });
    const startReady = new Promise(resolve => { resolveStart = resolve; });
    const peerClose = new Promise(resolve => { resolveClose = resolve; });
    host.onPeerOpen = resolvePeer;
    host.onPeerClose = resolveClose;
    host.on('hello', (data, conn) => {
        assert.equal(data.v, 11);
        conn.idx = 1;
        conn.send({ t: 'lobby', n: 2 });
    });
    guest.on('lobby', data => resolveLobby(data));
    guest.on('start', data => resolveStart(data));
    guest.onOpen = () => guest.send({ t: 'hello', v: 11 });
    host.host(resolveCode, error => { throw error; });
    guest.join(await codeReady, error => { throw error; });
    const [conn, lobby] = await Promise.all([peerReady, lobbyReady]);
    assert.equal(conn.idx, 1);
    assert.equal(lobby.n, 2);
    host.send({ t: 'start', coop: false });
    assert.equal((await startReady).coop, false);
    guest.close();
    assert.equal((await peerClose).id, conn.id);
    host.close();
}

async function waitForServer(url, child) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('Relay server exited before startup');
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch (e) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Relay server did not start');
}

(async () => {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
        env: Object.assign({}, process.env, { HOST: '127.0.0.1', PORT: String(port) }),
        stdio: 'ignore',
    });
    const peers = [];
    try {
        await waitForServer(origin, child);
        const page = await fetch(origin);
        assert.match(await page.text(), /Ronins-Path/);
        assert.equal((await fetch(`${origin}/package.json`)).status, 404);

        const host = connect(wsUrl);
        peers.push(host);
        await host.open();
        host.send({ op: 'create', v: 11, coop: false });
        const created = await host.waitFor(msg => msg.sys === 'created');
        assert.match(created.code, /^[A-Z2-9]{8}$/);

        const wrongMode = connect(wsUrl);
        peers.push(wrongMode);
        await wrongMode.open();
        wrongMode.send({ op: 'join', v: 11, code: created.code, coop: true });
        assert.equal((await wrongMode.waitFor(msg => msg.sys === 'error')).code, 'mode-mismatch');

        const oldVersion = connect(wsUrl);
        peers.push(oldVersion);
        await oldVersion.open();
        oldVersion.send({ op: 'join', v: 9, code: created.code, coop: false });
        assert.equal((await oldVersion.waitFor(msg => msg.sys === 'error')).code, 'version-mismatch');

        const guest1 = connect(wsUrl);
        peers.push(guest1);
        await guest1.open();
        guest1.send({ op: 'join', v: 11, code: created.code, coop: false });
        assert.equal((await guest1.waitFor(msg => msg.sys === 'joined')).code, created.code);
        const opened1 = await host.waitFor(msg => msg.sys === 'peer-open');

        const guest2 = connect(wsUrl);
        peers.push(guest2);
        await guest2.open();
        guest2.send({ op: 'join', v: 11, code: created.code, coop: false });
        await guest2.waitFor(msg => msg.sys === 'joined');
        const opened2 = await host.waitFor(msg => msg.sys === 'peer-open');

        guest1.send({ op: 'send', data: { t: 'hello', look: { hatStyle: 1 } } });
        const hello = await host.waitFor(msg => msg.sys === 'data' && msg.data.t === 'hello');
        assert.equal(hello.from, opened1.id);
        guest1.send({ op: 'send', data: { t: 'start' } });
        assert.equal((await guest1.waitFor(msg => msg.sys === 'error')).code, 'invalid-request');
        host.send({ op: 'target', id: opened1.id, data: { t: 'lobby', n: 2 } });
        assert.equal((await guest1.waitFor(msg => msg.sys === 'data')).data.t, 'lobby');

        host.send({ op: 'relay', except: opened1.id, data: { t: 'in', i: 1, f: 10, d: [] } });
        assert.equal((await guest2.waitFor(msg => msg.sys === 'data' && msg.data.t === 'in')).data.i, 1);
        assert.equal(guest1.socket.readyState, WebSocket.OPEN);
        assert.equal(opened2.id === opened1.id, false);

        host.send({ op: 'target', id: opened1.id, data: { t: 'start' } });
        await guest1.waitFor(msg => msg.sys === 'data' && msg.data.t === 'start');
        const late = connect(wsUrl);
        peers.push(late);
        await late.open();
        late.send({ op: 'join', v: 11, code: created.code, coop: false });
        assert.equal((await late.waitFor(msg => msg.sys === 'error')).code, 'room-full');

        guest2.socket.close();
        assert.equal((await host.waitFor(msg => msg.sys === 'peer-close' && msg.id === opened2.id)).id, opened2.id);
        host.socket.close();
        await guest1.waitFor(msg => msg.sys === 'host-closed');
        await checkBrowserClient(wsUrl, origin);
        console.log('WebSocket relay checks passed');
    } finally {
        for (const peer of peers) if (peer.socket.readyState < WebSocket.CLOSING) peer.socket.terminate();
        child.kill();
        await new Promise(resolve => child.once('exit', resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
