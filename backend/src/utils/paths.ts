import path from 'node:path';
import { config } from '../config.js';

export function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^\w.\-() ]+/g, '_');
}

export function getOutputExtension(format: string | null, inputName: string): string {
  if (format) {
    return format === 'jpeg' ? 'jpg' : format;
  }
  const ext = path.extname(inputName).slice(1).toLowerCase();
  return ext || 'jpg';
}

export function buildOutputFilename(originalName: string, format: string | null, fileId: string): string {
  const base = path.basename(originalName, path.extname(originalName));
  const ext = getOutputExtension(format, originalName);
  return `${base}-${fileId.slice(0, 8)}.${ext}`;
}

export function resolveDataPath(relPath: string): string {
  return path.join(config.dataDir, relPath);
}

export function toUploadRelPath(jobId: string, fileId: string, filename: string): string {
  return path.join('uploads', jobId, `${fileId}-${filename}`).replace(/\\/g, '/');
}

export function toConvertedRelPath(jobId: string, filename: string): string {
  return path.join('converted', jobId, filename).replace(/\\/g, '/');
}

export function toAbsoluteFromStored(storedPath: string): string {
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }
  return resolveDataPath(storedPath);
}

export function toRelativeFromAbsolute(absPath: string): string | null {
  const relative = path.relative(config.dataDir, absPath).replace(/\\/g, '/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}
