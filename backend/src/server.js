import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.js';
import { pool } from './db.js';
import { logger, httpLogger } from './logger.js';
import { loadUser, requireAuth, csrf } from './middleware/auth.js';
import { errorHandler, notFoundApi } from './middleware/error.js';
import { router as authRouter } from './auth/routes.js';
import { router as apiRouter } from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../../frontend/dist');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', cfg.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'upgrade-insecure-requests': cfg.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: cfg.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'same-origin' },
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  next();
});
app.use(httpLogger);

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'session', pruneSessionInterval: 15 * 60 }),
  name: cfg.isProd ? '__Host-ipad.sid' : 'ipad.sid',
  secret: cfg.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: { httpOnly: true, secure: cfg.isProd, sameSite: 'lax', path: '/', maxAge: cfg.SESSION_IDLE_MIN * 60e3 },
}));
app.use(loadUser);

app.use('/auth', authRouter);

const apiLimiter = rateLimit({ windowMs: 60e3, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => req.user?.id || req.ip });
app.use('/api', apiLimiter, express.json({ limit: '300kb' }), (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
}, requireAuth, csrf, apiRouter);
app.use('/api', notFoundApi);

// ---- Frontend (React build) disajikan dari origin yang sama → tanpa CORS
if (fs.existsSync(DIST)) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  logger.warn(`Folder build frontend tidak ditemukan (${DIST}). Jalankan "npm run build" di folder frontend.`);
}

app.use(errorHandler);

const server = app.listen(cfg.PORT, cfg.HOST, () => logger.info(`iPad Asset API jalan di http://${cfg.HOST}:${cfg.PORT} (${cfg.NODE_ENV})`));
server.headersTimeout = 65e3;
server.requestTimeout = 60e3;

const shutdown = (sig) => {
  logger.info(`${sig} diterima, menutup server…`);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10e3).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => logger.error(e, 'unhandledRejection'));
