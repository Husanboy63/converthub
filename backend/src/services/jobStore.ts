import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { paths } from '../config.js';
import type { Job, JobFile, JobSummary, LegacyJobFile, ProcessOptions } from '../types.js';
import { toRelativeFromAbsolute } from '../utils/paths.js';
import { processImage } from './imageProcessor.js';
import { processingQueue } from './queue.js';

const jobs = new Map<string, Job>();

let logger: FastifyBaseLogger | null = null;

export function setJobStoreLogger(log: FastifyBaseLogger): void {
  logger = log;
}

function logInfo(message: string, data?: Record<string, unknown>): void {
  if (logger) {
    logger.info(data ?? {}, message);
  }
}

async function ensureDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(paths.uploads, { recursive: true }),
    fs.mkdir(paths.converted, { recursive: true }),
    fs.mkdir(paths.jobs, { recursive: true }),
  ]);
}

function jobMetaPath(jobId: string): string {
  return path.join(paths.jobs, `${jobId}.json`);
}

async function persistJob(job: Job): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(jobMetaPath(job.id), JSON.stringify(job, null, 2), 'utf-8');
}

function migrateLegacyFile(file: LegacyJobFile): JobFile | null {
  let inputRelPath = file.inputRelPath;
  let outputRelPath = file.outputRelPath ?? null;

  if (!inputRelPath && file.inputPath) {
    inputRelPath = toRelativeFromAbsolute(file.inputPath) ?? undefined;
  }

  if (!outputRelPath && file.outputPath) {
    outputRelPath = toRelativeFromAbsolute(file.outputPath);
  }

  if (!inputRelPath) {
    return null;
  }

  return {
    id: file.id,
    originalName: file.originalName,
    inputRelPath,
    outputRelPath,
    sizeBefore: file.sizeBefore,
    sizeAfter: file.sizeAfter,
    status: file.status,
    error: file.error,
  };
}

function finalizeJobStatus(job: Job): void {
  const hasFailures = job.files.some((f) => f.status === 'failed');
  const allFailed = job.files.every((f) => f.status === 'failed');

  if (allFailed) {
    job.status = 'failed';
    job.error = 'Не удалось обработать ни один файл';
  } else if (hasFailures) {
    job.status = 'done';
    job.error = 'Некоторые файлы не удалось обработать';
  } else {
    job.status = 'done';
    job.error = null;
  }
}

export function toJobSummary(job: Job): JobSummary {
  const processed = job.files.filter((f) => f.status === 'done' || f.status === 'failed').length;

  return {
    id: job.id,
    status: job.status,
    total: job.files.length,
    processed,
    files: job.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      sizeBefore: f.sizeBefore,
      sizeAfter: f.sizeAfter,
      status: f.status,
      error: f.error,
    })),
    error: job.error,
  };
}

async function processFile(jobId: string, fileId: string): Promise<void> {
  const currentJob = jobs.get(jobId);
  if (!currentJob) return;

  const currentFile = currentJob.files.find((f) => f.id === fileId);
  if (!currentFile || currentFile.status === 'done') return;

  currentFile.status = 'processing';
  await persistJob(currentJob);

  try {
    const result = await processImage({
      inputRelPath: currentFile.inputRelPath,
      jobId,
      originalName: currentFile.originalName,
      fileId: currentFile.id,
      options: currentJob.options,
    });

    currentFile.outputRelPath = result.outputRelPath;
    currentFile.sizeAfter = result.sizeAfter;
    currentFile.status = 'done';
    currentFile.error = null;
  } catch (err) {
    currentFile.status = 'failed';
    currentFile.error = err instanceof Error ? err.message : 'Ошибка обработки';
  }

  await persistJob(currentJob);
}

async function startProcessing(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const pendingFiles = job.files.filter((f) => f.status === 'pending' || f.status === 'processing');

  if (pendingFiles.length === 0) {
    finalizeJobStatus(job);
    await persistJob(job);
    return;
  }

  job.status = 'processing';
  job.error = null;

  for (const file of pendingFiles) {
    if (file.status === 'processing') {
      file.status = 'pending';
    }
  }

  await persistJob(job);

  const tasks = pendingFiles.map((file) =>
    processingQueue.add(() => processFile(jobId, file.id)),
  );

  await Promise.all(tasks);

  const finalJob = jobs.get(jobId);
  if (!finalJob) return;

  finalizeJobStatus(finalJob);
  await persistJob(finalJob);
  logInfo('Job completed', { jobId, status: finalJob.status });
}

export async function createJob(
  jobId: string,
  options: ProcessOptions,
  files: Array<{ id: string; originalName: string; inputRelPath: string; sizeBefore: number }>,
): Promise<Job> {
  await ensureDirs();

  const now = new Date().toISOString();

  const job: Job = {
    id: jobId,
    status: 'pending',
    options,
    files: files.map(
      (f): JobFile => ({
        id: f.id,
        originalName: f.originalName,
        inputRelPath: f.inputRelPath,
        outputRelPath: null,
        sizeBefore: f.sizeBefore,
        sizeAfter: null,
        status: 'pending',
        error: null,
      }),
    ),
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  jobs.set(jobId, job);
  await persistJob(job);
  logInfo('Job created', { jobId, files: job.files.length });

  void startProcessing(jobId);

  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export async function loadJobFromDisk(jobId: string): Promise<Job | undefined> {
  if (jobs.has(jobId)) {
    return jobs.get(jobId);
  }

  try {
    const raw = await fs.readFile(jobMetaPath(jobId), 'utf-8');
    const parsed = JSON.parse(raw) as Job & { files: LegacyJobFile[] };

    const files: JobFile[] = [];
    for (const file of parsed.files) {
      const migrated = migrateLegacyFile(file);
      if (!migrated) {
        parsed.status = 'failed';
        parsed.error = 'Не удалось мигрировать метаданные файла';
        break;
      }
      files.push(migrated);
    }

    const job: Job = {
      ...parsed,
      files,
    };

    jobs.set(jobId, job);
    return job;
  } catch {
    return undefined;
  }
}

export async function getJobOrLoad(jobId: string): Promise<Job | undefined> {
  return jobs.get(jobId) ?? (await loadJobFromDisk(jobId));
}

export function getAllJobs(): Job[] {
  return Array.from(jobs.values());
}

export async function deleteJob(jobId: string): Promise<void> {
  jobs.delete(jobId);

  const uploadDir = path.join(paths.uploads, jobId);
  const convertedDir = path.join(paths.converted, jobId);
  const metaFile = jobMetaPath(jobId);

  await Promise.allSettled([
    fs.rm(uploadDir, { recursive: true, force: true }),
    fs.rm(convertedDir, { recursive: true, force: true }),
    fs.rm(metaFile, { force: true }),
  ]);
}

export async function loadAllJobsFromDisk(): Promise<void> {
  await ensureDirs();

  try {
    const files = await fs.readdir(paths.jobs);
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map((f) => loadJobFromDisk(path.basename(f, '.json'))),
    );
  } catch {
    // jobs dir may not exist yet
  }
}

export async function recoverJobsOnStartup(): Promise<void> {
  await loadAllJobsFromDisk();

  const recoverable = getAllJobs().filter((job) => {
    if (job.status === 'done' || job.status === 'failed') {
      return false;
    }
    return job.files.some((f) => f.status === 'pending' || f.status === 'processing');
  });

  for (const job of recoverable) {
    logInfo('Recovering job', { jobId: job.id, status: job.status });
    void startProcessing(job.id);
  }

  const staleDone = getAllJobs().filter((job) => {
    if (job.status !== 'processing' && job.status !== 'pending') {
      return false;
    }
    return job.files.every((f) => f.status === 'done' || f.status === 'failed');
  });

  for (const job of staleDone) {
    finalizeJobStatus(job);
    await persistJob(job);
    logInfo('Finalized stale job', { jobId: job.id, status: job.status });
  }

  if (recoverable.length > 0 || staleDone.length > 0) {
    logInfo('Startup recovery complete', {
      recovered: recoverable.length,
      finalized: staleDone.length,
    });
  }
}
