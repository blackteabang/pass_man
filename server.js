/**
 * 나만의패스워드관리 - Zero-Dependency Server
 * Local mode: 127.0.0.1 only, browser heartbeat can shut the process down.
 * Web mode (`node server.js --web`): stays up and accepts browser clients.
 * The vault stays encrypted. Web mode also requires an access key before
 * any vault read or write. The master password never reaches this server.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const WEB_MODE = !process.versions.electron && (process.argv.includes('--web') || process.env.PASSMANAGE_WEB === '1');
const PORT = Number(process.env.PORT) || (WEB_MODE ? 3080 : 3000);
const HOST = process.env.PASSMANAGE_HOST || (WEB_MODE ? '0.0.0.0' : '127.0.0.1');
const VAULT_FILE_NAME = 'vault.json.enc';
const ACCESS_KEY_FILE = 'web-access.key';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const PUBLIC_FILES = new Set([
    '/index.html',
    '/styles.css',
    '/style_v2.css',
    '/app.js',
    '/crypto.js',
    '/tech_bg.png'
]);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif'
};

let vaultFileDir = process.env.PASSMANAGE_VAULT_DIR || __dirname;
if (!process.env.PASSMANAGE_VAULT_DIR && process.versions.electron) {
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        vaultFileDir = process.env.PORTABLE_EXECUTABLE_DIR;
    } else {
        vaultFileDir = path.join(os.homedir(), 'Documents', 'PassManage');
    }
}

if (!fs.existsSync(vaultFileDir)) {
    try {
        fs.mkdirSync(vaultFileDir, { recursive: true });
    } catch (err) {
        console.error('Failed to create vault directory:', err);
    }
}

const VAULT_FILE_PATH = path.join(vaultFileDir, VAULT_FILE_NAME);
const ACCESS_KEY_PATH = path.join(vaultFileDir, ACCESS_KEY_FILE);
const TRANSPORT_KEY_PATH = path.join(vaultFileDir, 'web-transport.pem');
const TRANSPORT_SALT = Buffer.from('passmanage-transport-v1');
const TRANSPORT_TTL_MS = 5 * 60 * 1000;

let transportPrivateKey = null;
let transportPublicKeyB64 = '';
let transportFingerprint = '';
const seenEnvelopes = new Map();

const sessions = new Map();
const loginAttempts = new Map();
let lastHeartbeatTime = Date.now();
const startUptime = Date.now();
let webAccessKey = '';
let secureCookie = false;

function readAccessKeyFile() {
    const raw = fs.readFileSync(ACCESS_KEY_PATH, 'utf8').replace(/^\uFEFF/, '');
    const line = raw.split(/\r?\n/).map((item) => item.trim()).find((item) => item.length > 0);
    return line || '';
}

function currentWebAccessKey() {
    if (process.env.PASSMANAGE_WEB_TOKEN) {
        return String(process.env.PASSMANAGE_WEB_TOKEN).replace(/^\uFEFF/, '').trim();
    }
    try {
        const fromFile = readAccessKeyFile();
        if (fromFile) return fromFile;
    } catch (err) {
        console.error('웹 접속 키 파일을 읽지 못했습니다:', err.message);
    }
    return webAccessKey;
}

function loadWebAccessKey() {
    if (process.env.PASSMANAGE_WEB_TOKEN) {
        webAccessKey = String(process.env.PASSMANAGE_WEB_TOKEN).replace(/^\uFEFF/, '').trim();
        return 'env';
    }
    if (fs.existsSync(ACCESS_KEY_PATH)) {
        webAccessKey = readAccessKeyFile();
        if (webAccessKey) return 'file';
    }
    webAccessKey = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(ACCESS_KEY_PATH, webAccessKey + '\n', { encoding: 'utf8', flag: 'w' });
    return 'created';
}

function loadTransportIdentity() {
    if (fs.existsSync(TRANSPORT_KEY_PATH)) {
        transportPrivateKey = crypto.createPrivateKey(fs.readFileSync(TRANSPORT_KEY_PATH, 'utf8'));
    } else {
        const generated = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        transportPrivateKey = generated.privateKey;
        fs.writeFileSync(TRANSPORT_KEY_PATH, generated.privateKey.export({ type: 'pkcs8', format: 'pem' }), { encoding: 'utf8', flag: 'w' });
    }
    const spki = crypto.createPublicKey(transportPrivateKey).export({ type: 'spki', format: 'der' });
    transportPublicKeyB64 = spki.toString('base64');
    const hex = crypto.createHash('sha256').update(spki).digest('hex').slice(0, 32).toUpperCase();
    transportFingerprint = hex.match(/.{1,4}/g).join(' ');
}

function transportAesKey(clientPublicB64) {
    const clientPublic = crypto.createPublicKey({
        key: Buffer.from(clientPublicB64, 'base64'),
        format: 'der',
        type: 'spki'
    });
    const shared = crypto.diffieHellman({
        privateKey: transportPrivateKey,
        publicKey: clientPublic
    });
    return Buffer.from(crypto.hkdfSync(
        'sha256',
        shared,
        TRANSPORT_SALT,
        Buffer.from(clientPublicB64, 'base64'),
        32
    ));
}

function rememberEnvelope(ciphertext) {
    const digest = crypto.createHash('sha256').update(ciphertext).digest('hex');
    const now = Date.now();
    for (const [key, expires] of seenEnvelopes) {
        if (expires < now) seenEnvelopes.delete(key);
    }
    if (seenEnvelopes.has(digest)) return false;
    if (seenEnvelopes.size >= 500) {
        const oldest = seenEnvelopes.keys().next().value;
        seenEnvelopes.delete(oldest);
    }
    seenEnvelopes.set(digest, now + TRANSPORT_TTL_MS);
    return true;
}

function assertFresh(message) {
    const ts = message && message.ts;
    if (typeof ts !== 'number' || Math.abs(Date.now() - ts) > TRANSPORT_TTL_MS) {
        throw Object.assign(new Error('암호화된 요청 시간이 맞지 않습니다. 컴퓨터 시각을 확인해 주세요.'), { statusCode: 400 });
    }
}

function openTransport(envelope) {
    if (!envelope || envelope.v !== 1 || !envelope.ephemeralPublicKey || !envelope.iv || !envelope.ciphertext) {
        throw Object.assign(new Error('웹에서는 접속 키와 금고를 암호화해서 보내야 합니다.'), { statusCode: 400 });
    }
    let parsed;
    try {
        const aesKey = transportAesKey(envelope.ephemeralPublicKey);
        const iv = Buffer.from(envelope.iv, 'base64');
        const data = Buffer.from(envelope.ciphertext, 'base64');
        if (iv.length !== 12 || data.length < 17) {
            throw new Error('bad envelope');
        }
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
        decipher.setAuthTag(data.subarray(data.length - 16));
        const plaintext = Buffer.concat([
            decipher.update(data.subarray(0, data.length - 16)),
            decipher.final()
        ]).toString('utf8');
        parsed = JSON.parse(plaintext);
    } catch (err) {
        if (err.statusCode) throw err;
        throw Object.assign(new Error('전송 암호를 풀지 못했습니다.'), { statusCode: 400 });
    }
    assertFresh(parsed);
    if (!rememberEnvelope(envelope.ciphertext)) {
        throw Object.assign(new Error('이미 사용된 암호화 요청입니다.'), { statusCode: 400 });
    }
    return parsed;
}

function sealForClient(plaintext, clientPublicB64) {
    const aesKey = transportAesKey(clientPublicB64);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const packed = Buffer.concat([encrypted, cipher.getAuthTag()]);
    return {
        v: 1,
        iv: iv.toString('base64'),
        ciphertext: packed.toString('base64')
    };
}

function transportError(err) {
    const status = err.statusCode || 400;
    return {
        status,
        message: err.statusCode ? err.message : '요청 본문이 올바른 JSON 형식이 아닙니다.'
    };
}

function tokensMatch(input, expected) {
    const a = crypto.createHash('sha256').update(String(input), 'utf8').digest();
    const b = crypto.createHash('sha256').update(String(expected), 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

function clientAddress(req) {
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function tooManyLogins(ip) {
    const entry = loginAttempts.get(ip);
    return !!(entry && entry.resetAt > Date.now() && entry.count >= LOGIN_LIMIT);
}

function recordLoginFailure(ip) {
    const now = Date.now();
    let entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    }
    entry.count += 1;
    loginAttempts.set(ip, entry);
}

function clearLoginFailures(ip) {
    loginAttempts.delete(ip);
}

function readCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return '';
    const parts = header.split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        if (key === name) {
            try {
                return decodeURIComponent(part.slice(idx + 1).trim());
            } catch (err) {
                return '';
            }
        }
    }
    return '';
}

function isAuthenticated(req) {
    if (!WEB_MODE) return true;
    const sid = readCookie(req, 'pm_web_session');
    if (!sid) return false;
    const session = sessions.get(sid);
    if (!session) return false;
    if (session.expires < Date.now()) {
        sessions.delete(sid);
        return false;
    }
    return true;
}

function pruneSessions() {
    const now = Date.now();
    for (const [sid, session] of sessions) {
        if (session.expires < now) sessions.delete(sid);
    }
    while (sessions.size > 50) {
        const oldest = sessions.keys().next().value;
        sessions.delete(oldest);
    }
}

function sessionCookie(sid, maxAge) {
    const parts = [
        `pm_web_session=${encodeURIComponent(sid)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAge}`
    ];
    if (secureCookie) parts.push('Secure');
    return parts.join('; ');
}

function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers.host;
    try {
        return new URL(origin).host === host;
    } catch (err) {
        return false;
    }
}

function securityHeaders(contentType, extra) {
    return Object.assign({
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
    }, extra || {});
}

function sendJson(res, status, obj, extra) {
    const body = JSON.stringify(obj);
    res.writeHead(status, securityHeaders('application/json; charset=utf-8', extra));
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('요청이 너무 큽니다.'), { statusCode: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function publicPath(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch (err) {
        return null;
    }
    if (decoded.includes('\0')) return null;
    const normalized = path.posix.normalize(decoded);
    if (normalized === '/') return '/index.html';
    if (!normalized.startsWith('/') || normalized.includes('..')) return null;
    return normalized;
}

function requireAuth(req, res) {
    if (isAuthenticated(req)) return true;
    sendJson(res, 401, { error: '웹 접속 키가 필요합니다.' });
    return false;
}

function listListenUrls(protocol) {
    const urls = [];
    const push = (host) => {
        const shownHost = host.includes(':') ? `[${host}]` : host;
        urls.push(`${protocol}://${shownHost}:${PORT}`);
    };
    if (HOST === '0.0.0.0' || HOST === '::') {
        push('127.0.0.1');
        const nets = os.networkInterfaces();
        for (const list of Object.values(nets)) {
            for (const net of list || []) {
                if (net.family === 'IPv4' && !net.internal) push(net.address);
            }
        }
    } else {
        push(HOST);
    }
    return urls;
}

if (!process.versions.electron) {
    setInterval(() => {
        if (WEB_MODE) return;
        const now = Date.now();
        if (now - startUptime < 15000) return;
        if (now - lastHeartbeatTime > 7000) {
            console.log(`\n[${new Date().toLocaleTimeString()}] No active browser clients detected (Heartbeat Timeout). Shutting down 나만의패스워드관리 server...`);
            process.exit(0);
        }
    }, 3000);
}

const requestHandler = async (req, res) => {
    let url;
    try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (err) {
        sendJson(res, 400, { error: '잘못된 요청 주소입니다.' });
        return;
    }

    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${url.pathname}`);

    const mutating = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
    if (mutating && !sameOrigin(req)) {
        sendJson(res, 403, { error: '허용되지 않은 출처의 요청입니다.' });
        return;
    }

    if (url.pathname === '/api/web-status' && req.method === 'GET') {
        sendJson(res, 200, { web: WEB_MODE, authenticated: isAuthenticated(req) });
        return;
    }

    if (url.pathname === '/api/transport-key' && req.method === 'GET') {
        if (!WEB_MODE) {
            sendJson(res, 200, { enabled: false });
            return;
        }
        sendJson(res, 200, {
            enabled: true,
            publicKey: transportPublicKeyB64,
            fingerprint: transportFingerprint
        });
        return;
    }

    if (url.pathname === '/api/web-login' && req.method === 'POST') {
        if (!WEB_MODE) {
            sendJson(res, 200, { status: 'local' });
            return;
        }
        const ip = clientAddress(req);
        if (tooManyLogins(ip)) {
            sendJson(res, 429, { error: '접속 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
            return;
        }
        try {
            const envelope = JSON.parse(await readBody(req) || '{}');
            if (envelope.token) {
                sendJson(res, 400, { error: '웹에서는 접속 키를 암호화해서 보내야 합니다.' });
                return;
            }
            const parsed = openTransport(envelope);
            const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
            if (!token || !tokensMatch(token, currentWebAccessKey())) {
                recordLoginFailure(ip);
                sendJson(res, 401, { error: '웹 접속 키가 올바르지 않습니다.' });
                return;
            }
            clearLoginFailures(ip);
            pruneSessions();
            const sid = crypto.randomBytes(32).toString('hex');
            sessions.set(sid, { expires: Date.now() + SESSION_TTL_MS });
            sendJson(res, 200, { status: 'ok' }, {
                'Set-Cookie': sessionCookie(sid, Math.floor(SESSION_TTL_MS / 1000))
            });
        } catch (err) {
            const failure = transportError(err);
            sendJson(res, failure.status, { error: failure.message });
        }
        return;
    }

    if (url.pathname === '/api/web-logout' && req.method === 'POST') {
        const sid = readCookie(req, 'pm_web_session');
        if (sid) sessions.delete(sid);
        sendJson(res, 200, { status: 'ok' }, {
            'Set-Cookie': sessionCookie('', 0)
        });
        return;
    }

    if (url.pathname === '/api/heartbeat' && req.method === 'POST') {
        lastHeartbeatTime = Date.now();
        sendJson(res, 200, { status: 'ok', web: WEB_MODE });
        return;
    }

    if (url.pathname === '/api/vault-path' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;
        if (WEB_MODE) {
            sendJson(res, 200, { web: true, path: '' });
            return;
        }
        sendJson(res, 200, { web: false, path: VAULT_FILE_PATH });
        return;
    }

    if (url.pathname === '/api/open-vault-folder' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;
        if (WEB_MODE) {
            sendJson(res, 403, { error: '웹 모드에서는 서버 탐색기를 열 수 없습니다.' });
            return;
        }
        const { exec } = require('child_process');
        exec(`explorer.exe /select,"${VAULT_FILE_PATH}"`, (err) => {
            if (err) {
                console.error('Failed to open explorer:', err);
                sendJson(res, 500, { error: '탐색기를 여는 도중 오류가 발생했습니다.' });
                return;
            }
            sendJson(res, 200, { status: 'success' });
        });
        return;
    }

    if (url.pathname === '/api/vault' && req.method === 'GET') {
        if (!requireAuth(req, res)) return;
        if (!fs.existsSync(VAULT_FILE_PATH)) {
            sendJson(res, 404, { status: 'empty', message: '금고 파일이 존재하지 않습니다.' });
            return;
        }
        fs.readFile(VAULT_FILE_PATH, 'utf8', (err, data) => {
            if (err) {
                sendJson(res, 500, { error: '파일을 읽는 도중 오류가 발생했습니다.' });
                return;
            }
            if (!WEB_MODE) {
                res.writeHead(200, securityHeaders('application/json; charset=utf-8'));
                res.end(data);
                return;
            }
            const clientKey = req.headers['x-pm-client-key'];
            if (!clientKey) {
                sendJson(res, 400, { error: '금고를 받으려면 브라우저 암호화 키가 필요합니다.' });
                return;
            }
            try {
                sendJson(res, 200, sealForClient(data, clientKey));
            } catch (sealErr) {
                const failure = transportError(sealErr);
                sendJson(res, failure.status, { error: '금고 응답을 암호화하지 못했습니다.' });
            }
        });
        return;
    }

    if (url.pathname === '/api/vault' && req.method === 'DELETE') {
        if (!requireAuth(req, res)) return;
        fs.unlink(VAULT_FILE_PATH, (err) => {
            if (err && err.code !== 'ENOENT') {
                sendJson(res, 500, { error: '금고 파일을 삭제하지 못했습니다.' });
                return;
            }
            sendJson(res, 200, { status: 'deleted' });
        });
        return;
    }

    if (url.pathname === '/api/vault' && req.method === 'POST') {
        if (!requireAuth(req, res)) return;
        try {
            const body = await readBody(req);
            const incoming = JSON.parse(body);
            let stored;
            if (WEB_MODE) {
                if (incoming.v !== 1) {
                    sendJson(res, 400, { error: '웹에서는 금고를 암호화해서 보내야 합니다.' });
                    return;
                }
                const opened = openTransport(incoming);
                const payload = opened.payload;
                if (!payload || !payload.ciphertext || !payload.salt || !payload.iv) {
                    sendJson(res, 400, { error: '잘못된 암호화 데이터 포맷입니다.' });
                    return;
                }
                stored = JSON.stringify(payload);
            } else {
                if (!incoming.ciphertext || !incoming.salt || !incoming.iv) {
                    sendJson(res, 400, { error: '잘못된 암호화 데이터 포맷입니다.' });
                    return;
                }
                stored = body;
            }
            fs.writeFile(VAULT_FILE_PATH, stored, 'utf8', (err) => {
                if (err) {
                    sendJson(res, 500, { error: '파일을 쓰는 도중 오류가 발생했습니다.' });
                    return;
                }
                sendJson(res, 200, { status: 'saved', filename: VAULT_FILE_NAME });
            });
        } catch (err) {
            const failure = transportError(err);
            sendJson(res, failure.status, { error: failure.message });
        }
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: '요청한 API를 찾을 수 없습니다.' });
        return;
    }

    const safePath = publicPath(url.pathname);
    if (!safePath || !PUBLIC_FILES.has(safePath)) {
        res.writeHead(404, securityHeaders('text/html; charset=utf-8'));
        res.end('<h2>페이지를 찾을 수 없습니다. (404)</h2>');
        return;
    }

    const filePath = path.join(__dirname, safePath.slice(1));
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, securityHeaders('text/html; charset=utf-8'));
            res.end('<h2>페이지를 찾을 수 없습니다. (404)</h2>');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, securityHeaders(contentType));
        fs.createReadStream(filePath).pipe(res);
    });
};

function onListenError(err) {
    if (err.code === 'EADDRINUSE') {
        console.error(`포트 ${PORT}가 이미 사용 중입니다. PORT 환경 변수로 다른 포트를 지정하세요.`);
    } else {
        console.error('서버를 시작하지 못했습니다:', err);
    }
    process.exit(1);
}

function startServer() {
    let keySource = '';
    if (WEB_MODE) {
        try {
            keySource = loadWebAccessKey();
            loadTransportIdentity();
        } catch (err) {
            console.error('웹 접속 키를 준비하지 못했습니다:', err);
            process.exit(1);
        }
    }

    const certPath = process.env.PASSMANAGE_TLS_CERT;
    const keyPath = process.env.PASSMANAGE_TLS_KEY;
    const useTls = WEB_MODE && certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath);
    secureCookie = !!useTls;

    const server = useTls
        ? https.createServer({
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
        }, (req, res) => {
            requestHandler(req, res).catch((err) => {
                console.error(err);
                if (!res.headersSent) sendJson(res, 500, { error: '서버 처리 중 오류가 발생했습니다.' });
            });
        })
        : http.createServer((req, res) => {
            requestHandler(req, res).catch((err) => {
                console.error(err);
                if (!res.headersSent) sendJson(res, 500, { error: '서버 처리 중 오류가 발생했습니다.' });
            });
        });

    server.on('error', onListenError);
    server.listen(PORT, HOST, () => {
        const protocol = useTls ? 'https' : 'http';
        console.log('====================================================');
        if (WEB_MODE) {
            console.log('나만의패스워드관리 웹 서비스가 구동되었습니다.');
            console.log('브라우저 주소:');
            for (const item of listListenUrls(protocol)) {
                console.log(`  ${item}`);
            }
            console.log(`데이터 보관 경로: ${VAULT_FILE_PATH}`);
            if (keySource === 'created') {
                console.log('새 웹 접속 키를 만들었습니다. 이 키는 화면에 다시 표시하지 않습니다.');
                console.log(`웹 접속 키: ${webAccessKey}`);
                console.log(`키 파일: ${ACCESS_KEY_PATH}`);
            } else if (keySource === 'file') {
                console.log(`웹 접속 키 파일: ${ACCESS_KEY_PATH}`);
            } else {
                console.log('웹 접속 키는 환경 변수 PASSMANAGE_WEB_TOKEN 을 사용합니다.');
            }
            console.log(`전송 암호화 지문: ${transportFingerprint}`);
            console.log('접속 키와 금고는 브라우저에서 암호화된 뒤에만 받습니다.');
            console.log('이 창을 닫기 전까지 웹 서비스가 유지됩니다.');
        } else {
            console.log('나만의패스워드관리 로컬 보안 서버가 구동되었습니다.');
            console.log(`주소: http://127.0.0.1:${PORT}`);
            console.log(`데이터 보관 경로: ${VAULT_FILE_PATH}`);
            console.log('(이 터미널 창을 닫으면 프로그램 연결이 해제됩니다.)');
        }
        console.log('====================================================');
    });
}

if (require.main === module || process.versions.electron) {
    startServer();
}
