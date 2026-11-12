export type OutputFormat = 'webp' | 'jpeg' | 'png' | 'avif' | null;

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type FileStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface ProcessOptions {
  format: OutputFormat;
  quality: number;
  maxWidth: number | null;
  maxHeight: number | null;
  stripMetadata: boolean;
}

export interface JobFile {
  id: string;
  originalName: string;
  inputRelPath: string;
  outputRelPath: string | null;
  sizeBefore: number;
  sizeAfter: number | null;
  status: FileStatus;
  error: string | null;
}

/** @deprecated Legacy job file shape for migration */
export interface LegacyJobFile extends Omit<JobFile, 'inputRelPath' | 'outputRelPath'> {
  inputPath?: string;
  outputPath?: string | null;
  inputRelPath?: string;
  outputRelPath?: string | null;
}

export interface Job {
  id: string;
  status: JobStatus;
  options: ProcessOptions;
  files: JobFile[];
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  files: Array<{
    id: string;
    originalName: string;
    sizeBefore: number;
    sizeAfter: number | null;
    status: FileStatus;
    error: string | null;
  }>;
  error: string | null;
}

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
  'image/heic',
  'image/heif',
]);

export const DEFAULT_OPTIONS: ProcessOptions = {
  format: 'webp',
  quality: 80,
  maxWidth: null,
  maxHeight: null,
  stripMetadata: true,
};
