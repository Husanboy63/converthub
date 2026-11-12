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

export interface JobFileSummary {
  id: string;
  originalName: string;
  sizeBefore: number;
  sizeAfter: number | null;
  status: FileStatus;
  error: string | null;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  files: JobFileSummary[];
  error: string | null;
}

export interface SelectedFile {
  file: File;
  id: string;
}
