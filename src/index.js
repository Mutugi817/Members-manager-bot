import dotenv from 'dotenv';
import { loadConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { buildApp } from './app.js';

dotenv.config();
const config = loadConfig();
const logger = createLogger(config);
let app; let stopping = false;

async function shutdown(signal) {
  if (stopping) return; stopping = true;
  try { app?.services?.scheduler?.stopAll(); } catch (error) { logger.error({ err: error }, 'Scheduler shutdown failed'); }
  try { await app?.services?.whatsapp?.stop(); } catch (error) { logger.error({ err: error }, 'WhatsApp shutdown failed'); }
  try { await app?.close(); } catch (error) { logger.error({ err: error }, 'HTTP shutdown failed'); }
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', error => logger.error({ err: error }, 'Unhandled rejection'));
process.on('uncaughtException', error => { logger.fatal({ err: error }, 'Uncaught exception'); void shutdown('uncaughtException'); });

try {
  app = await buildApp({ config, logger });
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port }, 'Grace Encounter Members Manager started');
} catch (error) {
  logger.fatal({ err: error }, 'Startup failed');
  process.exitCode = 1;
}
