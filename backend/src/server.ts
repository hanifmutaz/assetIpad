import './types.js';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { cfg } from './config.js';
import { pool } from './db.js';
import { logger, httpLogger } from './logger.js';
import { loadUser, requireAuth, requirePwChanged, csrf } from './middleware/auth.js';
import { errorHandler, notFoundApi } from './middleware/error.js';
import { router as authRouter } from './routes/auth.js';
import { router as apiRouter } from './routes/index.js';

const DIST = path.resolve(process.cwd(), '../frontend/dist');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', cfg.TRUST_PROXY);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'], 'connect-src': ["'self'"], 'frame-ancestors': ["'none'"],
      'form-action': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"],
      'upgrade-insecure-requests': cfg.useHttps ? [] : null,
    },
  },
  hsts: cfg.useHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
  referrerPolicy: { policy: 'same-origin' },
}));
app.use((_req, res, next) => { res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()'); next(); });
app.use(httpLogger);

app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'session', pruneSessionInterval: 15 * 60 }),
  name: cfg.cookieName,
  secret: cfg.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  proxy: true,
  cookie: { httpOnly: true, secure: cfg.useHttps, sameSite: 'strict', path: '/', maxAge: cfg.SESSION_IDLE_MIN * 60e3 },
}));
app.use(loadUser);

const apiLimiter = rateLimit({ windowMs: 60e3, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'x' });
app.use('/api', apiLimiter, express.json({ limit: '300kb' }), (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/auth', csrf, authRouter);
app.use('/api', requireAuth, csrf, (req, res, next) => (req.path === '/me' ? next() : requirePwChanged(req, res, next)), apiRouter);
app.use('/api', notFoundApi);

if (fs.existsSync(DIST)) {
  app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(DIST, 'index.html')); });
} else {
  logger.warn(`Build frontend tidak ditemukan (${DIST}). Jalankan "npm run build" di folder frontend.`);
}
app.use(errorHandler);

const server = app.listen(cfg.PORT, cfg.HOST, () => logger.info(`iPad Asset API v2 di http://${cfg.HOST}:${cfg.PORT} (${cfg.NODE_ENV})`));
server.headersTimeout = 65e3;
server.requestTimeout = 60e3;
const shutdown = (sig: string) => {
  logger.info(`${sig} diterima, menutup server…`);
  server.close(() => { void pool.end().then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10e3).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => logger.error(e, 'unhandledRejection'));
