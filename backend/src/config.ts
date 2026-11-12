import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(rootDir, 'data'),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 50),
  maxFilesPerJob: Number(process.env.MAX_FILES_PER_JOB ?? 50),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY ?? 3),
  fileTtlHours: Number(process.env.FILE_TTL_HOURS ?? 2),
  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 30),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  publicDir: path.join(rootDir, 'public'),
};

export const paths = {
  uploads: path.join(config.dataDir, 'uploads'),
  converted: path.join(config.dataDir, 'converted'),
  jobs: path.join(config.dataDir, 'jobs'),
};

export function getMaxFileSizeBytes(): number {
  return config.maxFileSizeMb * 1024 * 1024;
}
