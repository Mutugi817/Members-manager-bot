import pino from 'pino';
export function createLogger(config) { return pino({ level: config.logLevel }); }
