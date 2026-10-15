import pino from 'pino';
import pinoHttp from 'pino-http';
import { cfg } from './config.js';

export const logger = pino({
  level: cfg.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', '*.value', '*.password', '*.secret', 'res.headers["set-cookie"]'],
    censor: '[disensor]',
  },
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url.startsWith('/assets/') },
  customProps: (req) => ({ user: req.user?.email }),
  serializers: {
    req: (r) => ({ method: r.method, url: r.url.split('?')[0], ip: r.remoteAddress }),
    res: (r) => ({ statusCode: r.statusCode }),
  },
});
