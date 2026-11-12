import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { config, paths } from '../config.js';
import { deleteJob, getAllJobs, loadAllJobsFromDisk } from './jobStore.js';

let logger: FastifyBaseLogger | null = null;

export function setCleanupLogger(log: FastifyBaseLogger): void {
  logger = log;
}

async function removeExpiredJobs(): Promise<void> {
  const ttlMs = config.fileTtlHours * 60 * 60 * 1000;
  const now = Date.now();

  await loadAllJobsFromDisk();

  const expired = getAllJobs().filter((job) => {
    const created = new Date(job.createdAt).getTime();
    return now - created > ttlMs;
  });

  for (const job of expired) {
    await deleteJob(job.id);
  }

  if (expired.length > 0) {
    logger?.info({ count: expired.length }, 'Cleanup: expired jobs removed');
  }
}

async function cleanupOrphanDirs(): Promise<void> {
  const ttlMs = config.fileTtlHours * 60 * 60 * 1000;
  const now = Date.now();

  for (const baseDir of [paths.uploads, paths.converted]) {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(baseDir, entry.name);
        const stat = await fs.stat(dirPath);
        if (now - stat.mtimeMs > ttlMs) {
          await fs.rm(dirPath, { recursive: true, force: true });
        }
      }
    } catch {
      // directory may not exist
    }
  }
}

export function startCleanupScheduler(): void {
  cron.schedule('0 * * * *', () => {
    void (async () => {
      try {
        await removeExpiredJobs();
        await cleanupOrphanDirs();
      } catch (err) {
        logger?.error(err, 'Cleanup error');
      }
    })();
  });

  logger?.info({ ttlHours: config.fileTtlHours }, 'Cleanup scheduler started');
}
