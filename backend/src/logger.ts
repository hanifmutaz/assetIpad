import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { cfg } from './config.js';

export const logger = pino({
  level: cfg.LOG_LEVEL,
  redact: { paths: ['req.headers.cookie', 'req.headers["x-csrf-token"]', '*.password', '*.value', '*.token'], censor: '[disensor]' },
});
export const httpLogger = pinoHttp({
  logger,
  autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/assets/') },
  serializers: {
    req: (r: { method: string; url: string; remoteAddress?: string }) => ({ method: r.method, url: r.url.split('?')[0], ip: r.remoteAddress }),
    res: (r: { statusCode: number }) => ({ statusCode: r.statusCode }),
  },
});
