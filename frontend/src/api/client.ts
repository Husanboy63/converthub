import type { JobSummary, ProcessOptions } from './types';

export async function createJob(files: File[], options: ProcessOptions): Promise<{ jobId: string }> {
  const formData = new FormData();

  for (const file of files) {
    formData.append('files', file);
  }

  formData.append('options', JSON.stringify(options));

  const response = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Ошибка загрузки (${response.status})`);
  }

  return response.json() as Promise<{ jobId: string }>;
}

export async function getJob(jobId: string): Promise<JobSummary> {
  const response = await fetch(`/api/jobs/${jobId}`);

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Ошибка получения статуса (${response.status})`);
  }

  return response.json() as Promise<JobSummary>;
}

export function getFileDownloadUrl(jobId: string, fileId: string): string {
  return `/api/jobs/${jobId}/files/${fileId}`;
}

export function getZipDownloadUrl(jobId: string): string {
  return `/api/jobs/${jobId}/download`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function savingsPercent(before: number, after: number | null): string {
  if (!after || before === 0) return '—';
  const pct = ((before - after) / before) * 100;
  return `${pct.toFixed(1)}%`;
}
