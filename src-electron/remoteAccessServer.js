const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const GLOBAL_LOGIN_FAILURE_LIMIT = 30;

function getLanAddress() {
    const nets = os.networkInterfaces();
    for (const net of Object.values(nets)) {
        for (const addr of net || []) {
            if (addr.family === 'IPv4' && !addr.internal) {
                return addr.address;
            }
        }
    }
    return '127.0.0.1';
}

function contentType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.png')) return 'image/png';
    if (filePath.endsWith('.ico')) return 'image/x-icon';
    if (filePath.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
}

function isPathInside(root, target) {
    const relative = path.relative(root, target);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_REQUEST_BODY_BYTES) {
                reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
                req.destroy();
                return;
            }
            data += chunk;
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function verifyPassword(password, encoded) {
    try {
        const parts = String(encoded || '').split(':');
        if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
            return false;
        }
        const iterations = Number(parts[1]);
        if (!Number.isFinite(iterations) || iterations <= 0) {
            return false;
        }
        const salt = Buffer.from(parts[2], 'base64');
        const expected = Buffer.from(parts[3], 'base64');
        const actual = crypto.pbkdf2Sync(
            password,
            salt,
            iterations,
            expected.length,
            'sha256'
        );
        if (actual.length !== expected.length) {
            return false;
        }
        return crypto.timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function createWsFrame(payload) {
    const data = Buffer.from(payload);
    if (data.length < 126) {
        return Buffer.concat([Buffer.from([0x81, data.length]), data]);
    }
    if (data.length < 65536) {
        const header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(data.length, 2);
        return Buffer.concat([header, data]);
    }
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
    return Buffer.concat([header, data]);
}

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

class RemoteAccessServer {
    constructor({ rootDir, storage, getMainWindow }) {
        this.rootDir = rootDir;
        this.storage = storage;
        this.getMainWindow = getMainWindow;
        this.server = null;
        this.port = 23580;
        this.privacyMode = false;
        this.error = '';
        this.tokens = new Map();
        this.sockets = new Set();
        this.loginFailures = new Map();
        this.globalFailureCount = 0;
        this.globalWindowStartedAt = Date.now();
        this.broadcastTimer = null;
    }

    status() {
        return {
            running: !!this.server,
            port: this.port,
            url: this.server ? `http://${getLanAddress()}:${this.port}/` : '',
            error: this.error,
            localOnly: false,
            lanAccessReady: this.hasFirewallRule(this.port),
            lanAddress: getLanAddress()
        };
    }

    repairLanAccess(port) {
        this.port = port;
        this.error = '';
        if (process.platform !== 'win32') {
            return this.status();
        }
        if (!this.hasFirewallRule(port) && !this.addFirewallRule(port, true)) {
            this.error = 'Failed to repair LAN firewall permission.';
        }
        return this.status();
    }

    hasFirewallRule(port) {
        if (process.platform !== 'win32') {
            return true;
        }
        const result = spawnSync('netsh', [
            'advfirewall',
            'firewall',
            'show',
            'rule',
            `name=VRCX-Luo Remote Access ${port}`
        ]);
        return result.status === 0;
    }

    addFirewallRule(port, elevated) {
        if (process.platform !== 'win32') {
            return true;
        }
        const args = [
            'advfirewall',
            'firewall',
            'add',
            'rule',
            `name=VRCX-Luo Remote Access ${port}`,
            'dir=in',
            'action=allow',
            'protocol=TCP',
            `localport=${port}`,
            // Restrict the inbound rule to the local subnet so the port is not
            // opened to the WAN when the host has a public address.
            'remoteip=localsubnet'
        ];
        if (!elevated) {
            return spawnSync('netsh', args).status === 0;
        }
        const command = `Start-Process netsh -Verb runAs -WindowStyle Normal -ArgumentList ${JSON.stringify(args.join(' '))}`;
        const result = spawnSync('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            command
        ]);
        return result.status === 0;
    }

    start(port, privacyMode) {
        this.stop();
        this.port = port;
        this.privacyMode = !!privacyMode;
        this.error = '';
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
        this.server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket));
        this.server.on('error', (err) => {
            this.error = err.message;
            this.stop();
        });
        // Resolve only once listen has actually succeeded (or failed), so the
        // renderer sees the real running state instead of a premature "running".
        return new Promise((resolve) => {
            this.server.once('listening', () => {
                this.error = '';
                this.broadcastTimer = setInterval(() => {
                    if (this.sockets.size === 0) {
                        return;
                    }
                    this.broadcastTick().catch((err) => {
                        this.error = err?.message || String(err);
                    });
                }, 2000);
                resolve(this.status());
            });
            this.server.once('error', (err) => {
                this.error = err.message;
                resolve(this.status());
            });
            this.server.listen(this.port, '0.0.0.0');
        });
    }

    async broadcastTick() {
        const dirty = await this.isSnapshotDirty();
        if (dirty !== 'true') {
            return;
        }
        await this.broadcastSnapshot();
    }

    stop() {
        for (const socket of this.sockets) {
            try {
                socket.destroy();
            } catch {
                // Socket may already be closed by the client.
            }
        }
        this.sockets.clear();
        this.tokens.clear(); // Changing the password or stopping the server revokes every session.
        if (this.broadcastTimer) {
            clearInterval(this.broadcastTimer);
            this.broadcastTimer = null;
        }
        if (this.server) {
            try {
                this.server.close();
            } catch {
                // Server may already be closing after an async listen error.
            }
        }
        this.server = null;
    }

    async evaluate(expression) {
        const win = this.getMainWindow();
        if (!win || win.isDestroyed()) {
            throw new Error('VRCX main window is not available');
        }
        const script = `Promise.resolve(${expression}).then(JSON.stringify).catch(e=>JSON.stringify({error:e.message,code:e.code}))`;
        return win.webContents.executeJavaScript(script, true);
    }

    async snapshot() {
        const options = JSON.stringify({ privacyMode: this.privacyMode });
        return this.evaluate(`window.$remoteBridge.getRemoteSnapshot(${options})`);
    }

    async action(body) {
        const encoded = JSON.stringify(JSON.stringify(body));
        return this.evaluate(`(async()=>{const x=JSON.parse(${encoded});return await window.$remoteBridge.executeRemoteAction(x.type,x.payload||{});})()`);
    }

    isAuthorized(req) {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        return this.validateToken(token);
    }

    validateToken(token) {
        const entry = this.tokens.get(token);
        if (!entry) {
            return false;
        }
        const now = Date.now();
        if (entry.expiresAt < now || entry.lastUsedAt + TOKEN_IDLE_TIMEOUT_MS < now) {
            this.tokens.delete(token);
            return false;
        }
        entry.lastUsedAt = now;
        return true;
    }

    async handleRequest(req, res) {
        try {
            const url = new URL(req.url, `http://localhost:${this.port}`);
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/remote.html')) {
                this.sendFile(res, 'remote.html');
                return;
            }
            if (req.method === 'GET' && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/'))) {
                this.sendFile(res, url.pathname.slice(1));
                return;
            }
            if (url.pathname === '/api/auth/login' && req.method === 'POST') {
                const clientKey = req.socket.remoteAddress || 'unknown';
                if (this.isLoginRateLimited(clientKey)) {
                    sendJson(res, 429, {
                        error: 'Too many login attempts, please wait.'
                    });
                    return;
                }
                const body = await readJson(req);
                if (!verifyPassword(body.password || '', this.storage.Get('VRCX_remoteAccessPasswordHash'))) {
                    this.registerLoginFailure(clientKey);
                    sendJson(res, 401, { error: 'Invalid password' });
                    return;
                }
                this.loginFailures.delete(clientKey);
                const token = crypto.randomBytes(32).toString('base64url');
                this.tokens.set(token, {
                    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
                    lastUsedAt: Date.now()
                });
                sendJson(res, 200, { token });
                return;
            }
            if (!this.isAuthorized(req)) {
                sendJson(res, 401, { error: 'Unauthorized' });
                return;
            }
            if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
                const token = (req.headers.authorization || '').replace(/^Bearer /, '');
                this.tokens.delete(token);
                sendJson(res, 200, { ok: true });
                return;
            }
            if (url.pathname === '/api/session') {
                sendJson(res, 200, { ok: true, status: this.status() });
                return;
            }
            if (url.pathname === '/api/snapshot') {
                const snapshot = await this.snapshot();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(snapshot);
                return;
            }
            if (url.pathname === '/api/action' && req.method === 'POST') {
                const body = await readJson(req);
                const result = await this.action(body);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(result);
                if (body.requestId) {
                    this.broadcastActionResult(body.requestId, result);
                }
                this.broadcastSnapshot().catch((err) => {
                    this.error = err?.message || String(err);
                });
                return;
            }
            sendJson(res, 404, { error: 'Not found' });
        } catch (err) {
            // Do not echo internal exception details to unauthenticated peers.
            const status = err?.statusCode === 413 ? 413 : 500;
            sendJson(res, status, {
                error: status === 413 ? 'Request body too large' : 'Internal server error'
            });
        }
    }

    sendFile(res, relativePath) {
        const root = path.join(this.rootDir, 'build/html');
        const fullPath = path.resolve(root, relativePath);
        if (!isPathInside(root, fullPath) || !fs.existsSync(fullPath)) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }
        res.writeHead(200, {
            'Content-Type': contentType(fullPath),
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy':
                "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:"
        });
        fs.createReadStream(fullPath).pipe(res);
    }

    async handleUpgrade(req, socket) {
        const url = new URL(req.url, `http://localhost:${this.port}`);
        if (url.pathname !== '/ws' || !this.validateToken(url.searchParams.get('token') || '')) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }
        const key = req.headers['sec-websocket-key'];
        const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        this.sockets.add(socket);
        socket.on('close', () => this.sockets.delete(socket));
        socket.on('error', () => this.sockets.delete(socket));
        socket.on('data', (data) => {
            if (data[0] === 0x88) {
                socket.destroy();
            }
        });
        this.sendSnapshot(socket).catch(() => {
            socket.destroy();
        });
    }

    async sendSnapshot(socket) {
        const snapshot = await this.snapshot();
        socket.write(createWsFrame(`{"type":"snapshot","data":${snapshot}}`));
    }

    async broadcastSnapshot() {
        // Evaluate the snapshot exactly once per tick; per-socket evaluation
        // would multiply renderer blocking by the number of connected clients.
        const snapshot = await this.snapshot();
        const frame = createWsFrame(`{"type":"snapshot","data":${snapshot}}`);
        for (const socket of [...this.sockets]) {
            if (!socket.destroyed) {
                try {
                    socket.write(frame);
                } catch {
                    socket.destroy();
                }
            }
        }
    }

    async isSnapshotDirty() {
        return this.evaluate('window.$remoteBridge?.isSnapshotDirty() ?? true');
    }

    broadcastActionResult(requestId, resultJson) {
        let result = {};
        try {
            result = JSON.parse(resultJson);
        } catch {
            result = { error: 'Invalid action result' };
        }
        this.broadcastRaw(
            JSON.stringify({
                type: 'action-result',
                requestId,
                ok: !result.error,
                error: result.error || ''
            })
        );
    }

    broadcastRaw(payload) {
        const frame = createWsFrame(payload);
        for (const socket of [...this.sockets]) {
            if (!socket.destroyed) {
                socket.write(frame);
            }
        }
    }

    isLoginRateLimited(clientKey) {
        if (this.isGloballyRateLimited()) {
            return true;
        }
        const failure = this.loginFailures.get(clientKey);
        if (!failure) {
            return false;
        }
        if (Date.now() - failure.windowStartedAt > 60 * 1000) {
            this.loginFailures.delete(clientKey);
            return false;
        }
        return failure.count >= 6;
    }

    isGloballyRateLimited() {
        const now = Date.now();
        if (now - this.globalWindowStartedAt > 60 * 1000) {
            this.globalWindowStartedAt = now;
            this.globalFailureCount = 0;
            return false;
        }
        return this.globalFailureCount >= GLOBAL_LOGIN_FAILURE_LIMIT;
    }

    registerLoginFailure(clientKey) {
        const now = Date.now();
        const failure = this.loginFailures.get(clientKey);
        if (!failure || now - failure.windowStartedAt > 60 * 1000) {
            this.loginFailures.set(clientKey, {
                count: 1,
                windowStartedAt: now
            });
        } else {
            failure.count += 1;
        }
        this.globalFailureCount += 1;
    }
}

module.exports = RemoteAccessServer;
