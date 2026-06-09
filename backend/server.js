require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const UPLOAD_DIR = path.join(__dirname, 'temp-uploads');
const BOTS_DIR = path.join(__dirname, 'bots');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cypherx-secret-key-change-in-production';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';

const db = new Database(path.join(__dirname, 'cypherx.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email TEXT,
  coins INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'stopped',
  port INTEGER,
  pid INTEGER,
  repoUrl TEXT,
  nodeVersion TEXT DEFAULT '20',
  processType TEXT DEFAULT 'web',
  startScript TEXT DEFAULT 'npm start',
  envVars TEXT DEFAULT '{}',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS verified_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  displayName TEXT NOT NULL,
  description TEXT,
  author TEXT,
  githubUrl TEXT,
  stars INTEGER DEFAULT 0,
  downloads INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  processType TEXT DEFAULT 'web',
  isActive INTEGER DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  coins INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  paystackStatus TEXT,
  metadata TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  type TEXT DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL UNIQUE,
  key TEXT UNIQUE NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  lastUsed DATETIME,
  FOREIGN KEY (userId) REFERENCES users(id)
);
`);

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.paystack.co https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self' https://api.paystack.co;");
  next();
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cookieParser());
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });

app.use('/uploads', express.static(BOTS_DIR));
app.use('/css', express.static(path.join(__dirname, '..', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'js')));
app.use('/icons', express.static(path.join(__dirname, '..', 'icons')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const authRequired = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

const getUser = (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username);
const getUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

const seedVerifiedBots = () => {
  const count = db.prepare('SELECT COUNT(*) as c FROM verified_bots').get().c;
  if (count > 0) return;
  const insert = db.prepare('INSERT INTO verified_bots (displayName, description, author, githubUrl, stars, downloads, tags, processType) VALUES (?,?,?,?,?,?,?,?)');
  const samples = [
    ['Discord Ticket Bot', 'A feature-rich ticket system for Discord servers with auto-responses and logging.', 'BotHub', 'https://github.com/example/ticket-bot', 1240, 5600, '["discord","tickets"]', 'web'],
    ['Ecommerce API', 'RESTful API template with auth, payments, and inventory management.', 'DevTools', 'https://github.com/example/ecommerce-api', 890, 3200, '["api","node"]', 'web'],
    ['Telegram Group Manager', 'Automates moderation, welcome messages, and anti-spam for Telegram.', 'TeleCraft', 'https://github.com/example/telegram-bot', 2100, 7800, '["telegram","moderation"]', 'cli'],
    ['Portfolio CMS', 'Headless CMS for personal portfolios with markdown support.', 'IndieDev', 'https://github.com/example/portfolio-cms', 340, 1200, '["cms","website"]', 'web'],
    ['AI Chatbot Starter', 'Integrates OpenAI API with a simple web chat interface.', 'OpenTool', 'https://github.com/example/ai-chatbot', 1560, 6400, '["ai","chatbot"]', 'web']
  ];
  const tx = db.transaction(() => { for (const s of samples) insert.run(...s); });
  tx();
};
seedVerifiedBots();

function ensureUser(req) {
  if (req.user && req.user.id) return getUserById(req.user.id);
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return getUserById(decoded.id) || null;
  } catch (err) {
    return null;
  }
}

async function paystackAxios(config) {
  return axios({
    ...config,
    baseURL: PAYSTACK_BASE_URL,
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' }
  });
}

function generateApiKey() {
  const chars = 'abcdef0123456789';
  let key = 'cyx_';
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

const frontendRoot = path.join(__dirname, '..');

const frontendFiles = [
  { route: '/', file: 'login.html' },
  { route: '/login', file: 'login.html' },
  { route: '/register', file: 'register.html' },
  { route: '/dashboard', file: 'dashboard.html' },
  { route: '/settings', file: 'settings.html' },
  { route: '/request', file: 'request.html' },
  { route: '/delete-account', file: 'delete-account.html' },
  { route: '/varified-bot', file: 'varified-bot.html' }
];

frontendFiles.forEach(({ route, file }) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(frontendRoot, file));
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/', limiter);

// AUTH
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Missing credentials' });
  const user = getUser(username);
  if (!user) return res.status(401).json({ success: false, error: 'Invalid username or password' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ success: false, error: 'Invalid username or password' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, coins: user.coins } });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
  const exists = getUser(username);
  if (exists) return res.status(409).json({ success: false, error: 'Username already taken' });
  const hashed = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password, email) VALUES (?,?,?)').run(username, hashed, email || null);
  const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '7d' });
  return res.status(201).json({ success: true, token, user: { id: result.lastInsertRowid, username, email: email || '', coins: 0 } });
});

app.post('/api/auth/session', (req, res) => {
  const { username, password } = req.body;
  const user = getUser(username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  req.session.user = { id: user.id, username: user.username };
  return res.json({ success: true, user: { id: user.id, username: user.username, email: user.email, coins: user.coins } });
});

app.post('/api/auth/change-password', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  const { currentPassword, newPassword } = req.body;
  if (!bcrypt.compareSync(currentPassword, getUserById(user.id).password)) return res.status(400).json({ success: false, error: 'Current password incorrect' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  return res.json({ success: true });
});

// DASHBOARD
app.get('/api/dashboard/stats', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  return res.json({ success: true, stats: { coins: user.coins, botCount: 5, cpuUsage: 34, uptime: '2d 4h' } });
});

app.get('/api/dashboard/notifications', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const rows = db.prepare('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC').all(user.id);
  return res.json({ success: true, notifications: rows });
});

app.post('/api/dashboard/notifications/:id/read', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND userId = ?').run(req.params.id, user.id);
  return res.json({ success: true });
});

app.post('/api/dashboard/notifications/read-all', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  db.prepare('UPDATE notifications SET read = 1 WHERE userId = ?').run(user.id);
  return res.json({ success: true });
});

app.post('/api/dashboard/notifications/:id/toggle-read', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ? AND userId = ?').get(req.params.id, user.id);
  if (!notif) return res.status(404).json({ success: false, error: 'Not found' });
  db.prepare('UPDATE notifications SET read = ? WHERE id = ?').run(notif.read ? 0 : 1, req.params.id);
  return res.json({ success: true });
});

app.delete('/api/dashboard/notifications/:id', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  db.prepare('DELETE FROM notifications WHERE id = ? AND userId = ?').run(req.params.id, user.id);
  return res.json({ success: true });
});

app.get('/api/dashboard/api-key/status', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  const row = db.prepare('SELECT * FROM api_keys WHERE userId = ?').get(user.id);
  return res.json({ success: true, hasApiKey: !!row, createdAt: row?.createdAt || null, lastUsed: row?.lastUsed || null });
});

app.post('/api/dashboard/api-key/generate', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  const key = generateApiKey();
  db.prepare('INSERT OR REPLACE INTO api_keys (userId, key) VALUES (?,?)').run(user.id, key);
  return res.json({ success: true, apiKey: key });
});

app.get('/api/dashboard/guide/:type', authRequired, async (req, res) => {
  const guides = {
    'getting-started': { title: 'Getting Started', content: '<h3>Welcome to CypherX</h3><p>Follow these steps to get started.</p>' },
    'deployment': { title: 'Bot Deployment Guide', content: '<h3>Deploying Your Bot</h3><p>Details here.</p>' },
    'configuration': { title: 'Bot Configuration', content: '<h3>Environment Configuration</h3><p>Details here.</p>' },
    'troubleshooting': { title: 'Troubleshooting', content: '<h3>Common Issues</h3><p>Details here.</p>' },
    'api': { title: 'API Reference', content: '<h3>API Endpoints</h3><p>Details here.</p>' }
  };
  const guide = guides[req.params.type];
  if (!guide) return res.status(404).json({ success: false, error: 'Guide not found' });
  return res.json({ success: true, ...guide });
});

app.get('/api/dashboard/bots', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const bots = db.prepare('SELECT * FROM bots WHERE userId = ? ORDER BY createdAt DESC').all(user.id);
  return res.json({ success: true, bots });
});

app.post('/api/dashboard/bots/:id/restart', authRequired, async (req, res) => {
  db.prepare('UPDATE bots SET status = "running", updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

app.post('/api/dashboard/bots/:id/stop', authRequired, (req, res) => {
  db.prepare('UPDATE bots SET status = "stopped", updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

app.post('/api/dashboard/bots/:id/start', authRequired, (req, res) => {
  db.prepare('UPDATE bots SET status = "running", updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});

app.post('/api/dashboard/bots/:id/delete', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  db.prepare('DELETE FROM bots WHERE id = ? AND userId = ?').run(req.params.id, user.id);
  return res.json({ success: true });
});

app.get('/api/dashboard/settings', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  return res.json({ success: true, settings: { theme: 'dark', notifications: true, email: user.email || '' } });
});

app.post('/api/dashboard/settings', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  const { email } = req.body;
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, user.id);
  return res.json({ success: true });
});

app.get('/api/dashboard/bot/:id/files', authRequired, async (req, res) => {
  return res.json({ success: true, files: [{ name: 'index.js', path: '/', type: 'file' }, { name: 'package.json', path: '/', type: 'file' }] });
});

// BOTS / DEPLOY
app.get('/api/node-usage', authRequired, (req, res) => res.json({ success: true, cpu: 42, memory: 128 }));
app.get('/api/process-usage', authRequired, (req, res) => res.json({ success: true, bots: [] }));
app.get('/api/deploy/:id', authRequired, async (req, res) => {
  const bot = db.prepare('SELECT * FROM bots WHERE id = ?').get(req.params.id);
  if (!bot) return res.status(404).json({ success: false, error: 'Bot not found' });
  return res.json({ success: true, bot });
});
app.get('/api/deploy/:id/logs', authRequired, (req, res) => res.json({ success: true, logs: 'No logs available yet.' }));
app.get('/api/deploy/:id/logs/stream', authRequired, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('data: {"type":"ping"}\n\n');
  const interval = setInterval(() => res.write('data: {"type":"ping"}\n\n'), 30000);
  req.on('close', () => clearInterval(interval));
});
app.get('/api/dashboard/bot/:id/logs', authRequired, (req, res) => res.json({ success: true, logs: '' }));
app.get('/api/deploy/list', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const bots = db.prepare('SELECT * FROM bots WHERE userId = ?').all(user.id);
  return res.json({ success: true, bots });
});
app.post('/api/deploy/:id/restart', authRequired, async (req, res) => {
  db.prepare('UPDATE bots SET status = "running", updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});
app.post('/api/deploy/:id/stop', authRequired, (req, res) => {
  db.prepare('UPDATE bots SET status = "stopped", updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  return res.json({ success: true });
});
app.get('/api/deploy/progress/:deploymentId', authRequired, (req, res) => {
  return res.json({
    success: true,
    progress: {
      progress: 100,
      status: 'completed',
      message: 'Deployment completed',
      logs: [{ timestamp: Date.now(), message: 'Bot deployed successfully' }]
    }
  });
});

app.get('/api/deploy/verified-bots', (req, res) => {
  const bots = db.prepare('SELECT * FROM verified_bots WHERE isActive = 1').all();
  return res.json({ success: true, bots });
});

app.post('/api/deploy/scan-github', authRequired, async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl) return res.status(400).json({ success: false, error: 'Repo URL required' });
  const config = [
    { key: 'BOT_TOKEN', description: 'Discord bot token', required: true, type: 'string' },
    { key: 'PORT', description: 'Port to run on', required: false, type: 'string', value: '3000' }
  ];
  return res.json({ success: true, config });
});

app.post('/api/deploy/scan-upload', authRequired, upload.single('botFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'File required' });
  const config = [
    { key: 'BOT_TOKEN', description: 'Bot token', required: true, type: 'string' },
    { key: 'PORT', description: 'Port', required: false, type: 'string', value: '3000' }
  ];
  return res.json({ success: true, config, tempPath: req.file.path });
});

app.post('/api/deploy/scan-verified', authRequired, async (req, res) => {
  const { verifiedBotId } = req.body;
  const bot = db.prepare('SELECT * FROM verified_bots WHERE id = ?').get(verifiedBotId);
  if (!bot) return res.status(404).json({ success: false, error: 'Verified bot not found' });
  const config = [
    { key: 'BOT_TOKEN', description: bot.description || 'Bot token', required: true, type: 'string' }
  ];
  return res.json({ success: true, config });
});

app.post('/api/deploy/github', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if ((user.coins || 0) < 10) return res.status(400).json({ success: false, error: 'Insufficient coins. You need 10 coins to deploy.' });
  const { repoUrl, botName, description, config = [], nodeVersion = '20' } = req.body;
  const assignedPort = 3000 + Math.floor(Math.random() * 5000);
  const insert = db.prepare('INSERT INTO bots (userId, name, description, status, port, nodeVersion, processType, startScript, repoUrl) VALUES (?,?,?,?,?,?,?,?,?)');
  const result = insert.run(user.id, botName || 'GitHub Bot', description || '', 'running', assignedPort, nodeVersion, 'web', 'npm start', repoUrl);
  db.prepare('UPDATE users SET coins = coins - 10 WHERE id = ?').run(user.id);
  const deploymentId = uuidv4();
  return res.json({ success: true, deploymentId, botId: result.lastInsertRowid, port: assignedPort });
});

app.post('/api/deploy/upload', authRequired, upload.single('botFile'), async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if ((user.coins || 0) < 10) return res.status(400).json({ success: false, error: 'Insufficient coins. You need 10 coins to deploy.' });
  const { botName, description, config = [], nodeVersion = '20' } = req.body;
  const assignedPort = 3000 + Math.floor(Math.random() * 5000);
  const insert = db.prepare('INSERT INTO bots (userId, name, description, status, port, nodeVersion, processType, startScript) VALUES (?,?,?,?,?,?,?,?)');
  const result = insert.run(user.id, botName || 'Uploaded Bot', description || '', 'running', assignedPort, nodeVersion, 'web', 'npm start');
  db.prepare('UPDATE users SET coins = coins - 10 WHERE id = ?').run(user.id);
  const deploymentId = uuidv4();
  return res.json({ success: true, deploymentId, botId: result.lastInsertRowid, port: assignedPort });
});

app.post('/api/deploy/verified', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if ((user.coins || 0) < 10) return res.status(400).json({ success: false, error: 'Insufficient coins. You need 10 coins to deploy.' });
  const { verifiedBotId, botName, description, config = [], nodeVersion = '20' } = req.body;
  const bot = db.prepare('SELECT * FROM verified_bots WHERE id = ?').get(verifiedBotId);
  if (!bot) return res.status(404).json({ success: false, error: 'Verified bot not found' });
  const assignedPort = 3000 + Math.floor(Math.random() * 5000);
  const insert = db.prepare('INSERT INTO bots (userId, name, description, status, port, nodeVersion, processType, startScript) VALUES (?,?,?,?,?,?,?,?)');
  const result = insert.run(user.id, botName || bot.displayName, description || bot.description, 'running', assignedPort, nodeVersion, bot.processType || 'web', 'npm start');
  db.prepare('UPDATE users SET coins = coins - 10 WHERE id = ?').run(user.id);
  const deploymentId = uuidv4();
  return res.json({ success: true, deploymentId, botId: result.lastInsertRowid, port: assignedPort });
});

// PAYMENTS
app.get('/api/payments/packages', (req, res) => {
  const country = req.query.country || 'kenya';
  const packages = {
    kenya: [
      { coins: 500, name: 'Starter', price: 100, currency: 'KES', displayPrice: 'KSh 100', savings: 0, popular: false },
      { coins: 1000, name: 'Basic', price: 180, currency: 'KES', displayPrice: 'KSh 180', savings: 10, popular: true },
      { coins: 2000, name: 'Premium', price: 300, currency: 'KES', displayPrice: 'KSh 300', savings: 25, popular: false }
    ],
    ghana: [
      { coins: 500, name: 'Starter', price: 2, currency: 'GHS', displayPrice: 'GHS 2', savings: 0, popular: false },
      { coins: 1000, name: 'Basic', price: 4, currency: 'GHS', displayPrice: 'GHS 4', savings: 10, popular: true },
      { coins: 2000, name: 'Premium', price: 6, currency: 'GHS', displayPrice: 'GHS 6', savings: 25, popular: false }
    ],
    nigeria: [
      { coins: 500, name: 'Starter', price: 160, currency: 'NGN', displayPrice: '₦160', savings: 0, popular: false },
      { coins: 1000, name: 'Basic', price: 280, currency: 'NGN', displayPrice: '₦280', savings: 12, popular: true },
      { coins: 2000, name: 'Premium', price: 450, currency: 'NGN', displayPrice: '₦450', savings: 28, popular: false }
    ]
  };
  return res.json({ success: true, packages: packages[country] || packages['kenya'] });
});

app.post('/api/payments/calculate-coins', (req, res) => {
  const { amount, currency } = req.body;
  const rates = { KES: { base: 100, coins: 500 }, GHS: { base: 2, coins: 500 }, NGN: { base: 160, coins: 500 } };
  const rate = rates[currency] || rates['KES'];
  const coins = Math.floor((amount / rate.base) * rate.coins);
  return res.json({ success: true, coins: Math.max(coins, 1), amount, currency });
});

app.post('/api/payments/paystack-initiate', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { email, amount, currency, reference, metadata = {} } = req.body;
  try {
    const response = await paystackAxios({
      method: 'POST',
      url: '/transaction/initialize',
      data: {
        email,
        amount: Math.round(amount * 100),
        currency,
        reference,
        metadata
      }
    });
    const data = response.data;
    if (data.status) {
      const coinRate = { KES: 5, GHS: 250, NGN: 1.6 };
      const coins = Math.round((data.data.amount / 100) * (coinRate[currency] || 5));
      db.prepare('INSERT INTO payments (userId, reference, amount, currency, coins, status, metadata) VALUES (?,?,?,?,?,?,?)')
        .run(user.id, reference, amount, currency, coins, 'pending', JSON.stringify(metadata));
      return res.json({
        success: true,
        reference: data.data.reference,
        access_code: data.data.access_code,
        amount: data.data.amount / 100,
        currency: data.data.currency,
        coins
      });
    }
    return res.status(400).json({ success: false, error: data.message || 'Failed to initialize payment' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/payments/paystack-verify', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { reference } = req.body;
  try {
    const response = await paystackAxios({ method: 'GET', url: `/transaction/verify/${reference}` });
    const data = response.data;
    if (data.status && data.data.status === 'success') {
      const payment = db.prepare('SELECT * FROM payments WHERE reference = ? AND userId = ?').get(reference, user.id);
      if (payment && payment.status === 'pending') {
        db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(payment.coins, user.id);
        db.prepare('UPDATE payments SET status = "success", paystackStatus = ? WHERE id = ?').run(data.data.status, payment.id);
      }
      return res.json({ success: true, reference, coins: payment?.coins || 0 });
    }
    db.prepare('UPDATE payments SET status = "failed", paystackStatus = ? WHERE reference = ?').run(data.data.status, reference);
    return res.json({ success: false, error: 'Payment not completed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/payments/paystack-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = require('crypto').createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);
  const event = req.body;
  if (event.event === 'charge.success') {
    const reference = event.data.reference;
    const payment = db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference);
    if (payment && payment.status === 'pending') {
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(payment.coins, payment.userId);
      db.prepare('UPDATE payments SET status = "success", paystackStatus = ? WHERE reference = ?').run(event.data.status, reference);
    }
  }
  res.sendStatus(200);
});

app.get('/dashboard/admin/bots', authRequired, async (req, res) => {
  const user = await ensureUser(req);
  if (user.username !== 'admin') return res.status(403).json({ success: false, error: 'Forbidden' });
  const bots = db.prepare('SELECT bots.*, users.username FROM bots JOIN users ON bots.userId = users.id').all();
  return res.json({ success: true, bots });
});

app.use('/api/billing/request', express.static(path.join(frontendRoot, 'request.html')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  res.sendFile(path.join(frontendRoot, 'login.html'));
});

app.listen(PORT, () => console.log(`CypherX backend running on http://localhost:${PORT}`));
