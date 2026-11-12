import fs from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_MIME_TYPES } from '../types.js';

const MIN_BYTES_FOR_DETECTION = 4100;

async function validateSample(sample: Buffer): Promise<{ valid: true; mime: string } | { valid: false; reason: string }> {
  if (sample.length === 0) {
    return { valid: false, reason: 'Пустой файл' };
  }

  const detected = await fileTypeFromBuffer(sample);

  if (!detected) {
    return { valid: false, reason: 'Не удалось определить тип файла' };
  }

  if (!ALLOWED_MIME_TYPES.has(detected.mime)) {
    return { valid: false, reason: `Неподдерживаемый формат: ${detected.mime}` };
  }

  return { valid: true, mime: detected.mime };
}

export async function validateImageBuffer(buffer: Buffer): Promise<{ valid: true; mime: string } | { valid: false; reason: string }> {
  const sample = buffer.subarray(0, Math.min(buffer.length, MIN_BYTES_FOR_DETECTION));
  return validateSample(sample);
}

export async function validateImageFile(filePath: string): Promise<{ valid: true; mime: string } | { valid: false; reason: string }> {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(MIN_BYTES_FOR_DETECTION);
    const { bytesRead } = await handle.read(buffer, 0, MIN_BYTES_FOR_DETECTION, 0);
    return validateSample(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
