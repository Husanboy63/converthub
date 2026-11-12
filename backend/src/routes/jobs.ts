import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { config, paths } from '../config.js';
import { createJob, getJobOrLoad, toJobSummary } from '../services/jobStore.js';
import { DEFAULT_OPTIONS, type ProcessOptions } from '../types.js';
import {
  resolveDataPath,
  sanitizeFilename,
  toAbsoluteFromStored,
  toUploadRelPath,
} from '../utils/paths.js';
import { FileSizeLimitError, saveUploadStream } from '../utils/saveUpload.js';
import { validateImageFile } from '../utils/validateFile.js';
import { isShuttingDown } from '../shutdown.js';

function parseOptions(raw: string | undefined): ProcessOptions {
  if (!raw) return { ...DEFAULT_OPTIONS };

  try {
    const parsed = JSON.parse(raw) as Partial<ProcessOptions>;
    return {
      format: parsed.format !== undefined ? parsed.format : DEFAULT_OPTIONS.format,
      quality: clamp(Number(parsed.quality ?? DEFAULT_OPTIONS.quality), 1, 100),
      maxWidth: parsed.maxWidth ? Number(parsed.maxWidth) : null,
      maxHeight: parsed.maxHeight ? Number(parsed.maxHeight) : null,
      stripMetadata: parsed.stripMetadata ?? DEFAULT_OPTIONS.stripMetadata,
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export async function jobsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/jobs', async (request, reply) => {
    if (isShuttingDown()) {
      reply.code(503);
      return { error: 'Сервер перезапускается, попробуйте через несколько секунд' };
    }

    const parts = request.parts();
    const files: Array<{ id: string; originalName: string; inputRelPath: string; sizeBefore: number }> = [];
    let options: ProcessOptions = { ...DEFAULT_OPTIONS };
    const jobId = uuidv4();
    const uploadDir = path.join(paths.uploads, jobId);

    await fs.promises.mkdir(uploadDir, { recursive: true });

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'options') {
        const value = part.value;
        options = parseOptions(typeof value === 'string' ? value : String(value));
        continue;
      }

      if (part.type !== 'file') continue;

      if (files.length >= config.maxFilesPerJob) {
        reply.code(400);
        return { error: `Максимум ${config.maxFilesPerJob} файлов за раз` };
      }

      const fileId = uuidv4();
      const safeName = sanitizeFilename(part.filename ?? 'image');
      const inputRelPath = toUploadRelPath(jobId, fileId, safeName);
      const inputPath = resolveDataPath(inputRelPath);

      let sizeBefore: number;

      try {
        sizeBefore = await saveUploadStream(part.file, inputPath);
      } catch (err) {
        if (err instanceof FileSizeLimitError) {
          reply.code(400);
          return { error: err.message };
        }
        throw err;
      }

      const validation = await validateImageFile(inputPath);

      if (!validation.valid) {
        await fs.promises.rm(inputPath, { force: true });
        reply.code(400);
        return { error: `${safeName}: ${validation.reason}` };
      }

      files.push({
        id: fileId,
        originalName: safeName,
        inputRelPath,
        sizeBefore,
      });
    }

    if (files.length === 0) {
      reply.code(400);
      return { error: 'Не загружено ни одного файла' };
    }

    const job = await createJob(jobId, options, files);

    reply.code(201);
    return { jobId: job.id };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = await getJobOrLoad(request.params.id);

    if (!job) {
      reply.code(404);
      return { error: 'Задача не найдена' };
    }

    return toJobSummary(job);
  });

  app.get<{ Params: { id: string; fileId: string } }>(
    '/api/jobs/:id/files/:fileId',
    async (request, reply) => {
      const job = await getJobOrLoad(request.params.id);

      if (!job) {
        reply.code(404);
        return { error: 'Задача не найдена' };
      }

      const file = job.files.find((f) => f.id === request.params.fileId);

      if (!file || file.status !== 'done' || !file.outputRelPath) {
        reply.code(404);
        return { error: 'Файл не найден или ещё не готов' };
      }

      const outputPath = toAbsoluteFromStored(file.outputRelPath);
      const downloadName = path.basename(outputPath);

      return reply
        .header('Content-Disposition', `attachment; filename="${downloadName}"`)
        .type('application/octet-stream')
        .send(fs.createReadStream(outputPath));
    },
  );

  app.get<{ Params: { id: string } }>('/api/jobs/:id/download', async (request, reply) => {
    const job = await getJobOrLoad(request.params.id);

    if (!job) {
      reply.code(404);
      return { error: 'Задача не найдена' };
    }

    const readyFiles = job.files.filter((f) => f.status === 'done' && f.outputRelPath);

    if (readyFiles.length === 0) {
      reply.code(404);
      return { error: 'Нет готовых файлов для скачивания' };
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="converted-${job.id.slice(0, 8)}.zip"`);

    archive.on('error', (err) => {
      request.log.error(err);
      if (!reply.sent) {
        reply.code(500).send({ error: 'Ошибка создания архива' });
      }
    });

    reply.send(archive);

    for (const file of readyFiles) {
      if (file.outputRelPath) {
        const outputPath = toAbsoluteFromStored(file.outputRelPath);
        archive.file(outputPath, { name: path.basename(outputPath) });
      }
    }

    await archive.finalize();
  });
}
