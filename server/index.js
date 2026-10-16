// Load settings from the project-root .env if present (real environment
// variables win). Must run before the routes are required.
try { process.loadEnvFile(require('path').join(__dirname, '..', '.env')); } catch (e) {}

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { scrapeAllTeams } = require('./scrapers/run');
const { getDb, closeDb, seedGlobalAdmin } = require('./db/schema');
const { getAllTeams } = require('./db/queries');
const SqliteSessionStore = require('./db/sessionStore');

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// A signed-session secret is mandatory in production — refuse to start with the
// known dev fallback so cookies can't be forged with a public secret.
const SESSION_SECRET = process.env.SESSION_SECRET || (isProd ? null : 'bleacherbox-dev-secret');
if (!SESSION_SECRET) {
  console.error('[server] SESSION_SECRET must be set in production. Refusing to start.');
  process.exit(1);
}

// CORS: restrict to an explicit allowlist in production; reflect localhost in dev.
// Set ALLOWED_ORIGINS to a comma-separated list of front-end origins.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const corsOptions = {
  credentials: true,
  origin(origin, cb) {
    // Same-origin / non-browser requests send no Origin header — allow them.
    if (!origin) return cb(null, true);
    if (!isProd) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Session
app.use(session({
  store: new SqliteSessionStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Serve uploaded walkup audio files
app.use('/walkups', express.static(path.join(__dirname, '..', 'data', 'walkups')));

// Serve baseball card images
app.use('/cards', express.static(path.join(__dirname, '..', 'data', 'cards')));

// Serve static frontend (production)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// Error handler — turn multer/upload and other route errors into clean JSON
// instead of Express's default HTML 500. Must be last (4-arg signature).
const { MulterError } = require('multer');
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof MulterError) {
    // e.g. LIMIT_FILE_SIZE — a client error, not a server fault.
    return res.status(400).json({ error: err.message, code: err.code });
  }
  // fileFilter rejections are plain Errors thrown from multer middleware.
  if (/allowed/i.test(err?.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: err.message });
  }
  console.error('[server] Unhandled route error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Last-resort process handlers so a stray rejection/exception is logged rather
// than crashing silently (or, under modern Node defaults, taking down the app).
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err);
});

// Initialize DB and start server
async function start() {
  await getDb();
  await seedGlobalAdmin();
  console.log('[db] Database initialized');

  app.listen(PORT, () => {
    console.log(`[server] BleacherBox running on http://localhost:${PORT}`);
  });

  // Cron: scrape all registered teams every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('[cron] Starting scheduled scrape for all teams...');
    try {
      await scrapeAllTeams();
    } catch (err) {
      console.error('[cron] Scrape failed:', err.message);
    }
  });

  // Run initial scrape if no registered teams have data
  const teams = await getAllTeams();
  if (teams.length === 0) {
    console.log('[server] No registered teams found. Add teams via POST /api/teams');
  } else {
    console.log(`[server] ${teams.length} registered team(s): ${teams.map(t => t.slug).join(', ')}`);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

start().catch(err => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
