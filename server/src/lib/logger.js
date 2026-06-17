import pino from 'pino';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info');

export const logger = pino({
  level,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export default logger;
