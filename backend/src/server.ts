import fs from 'node:fs';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { config, paths } from './config.js';
import { jobsRoutes } from './routes/jobs.js';
import { setCleanupLogger, startCleanupScheduler } from './services/cleanup.js';
import { recoverJobsOnStartup, setJobStoreLogger } from './services/jobStore.js';
import { getQueueStats, waitForQueueIdle } from './services/queue.js';
import { markShuttingDown } from './shutdown.js';

async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.promises.mkdir(paths.uploads, { recursive: true }),
    fs.promises.mkdir(paths.converted, { recursive: true }),
    fs.promises.mkdir(paths.jobs, { recursive: true }),
  ]);
}

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        config.nodeEnv !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    bodyLimit: config.maxFileSizeMb * 1024 * 1024 * config.maxFilesPerJob,
  });

  setJobStoreLogger(app.log);
  setCleanupLogger(app.log);

  await app.register(fastifyRateLimit, {
    max: config.rateLimitPerMin,
    timeWindow: '1 minute',
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
      files: config.maxFilesPerJob,
    },
  });

  await app.register(jobsRoutes);

  if (fs.existsSync(config.publicDir)) {
    await app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }

      reply.sendFile('index.html');
    });
  }

  app.get('/api/health', async () => {
    const queue = getQueueStats();
    return {
      status: 'ok',
      queuePending: queue.pending,
      queueSize: queue.size,
    };
  });

  return app;
}

function registerGracefulShutdown(app: FastifyInstance): void {
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutdown initiated');
    markShuttingDown();

    try {
      await app.close();
      app.log.info('HTTP server closed');

      const drained = await waitForQueueIdle(30_000);
      if (drained) {
        app.log.info('Processing queue drained');
        process.exit(0);
      } else {
        app.log.warn('Processing queue drain timeout');
        process.exit(1);
      }
    } catch (err) {
      app.log.error(err, 'Shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function start() {
  await ensureDataDirs();
  await recoverJobsOnStartup();

  const app = await buildServer();
  registerGracefulShutdown(app);
  startCleanupScheduler();

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
