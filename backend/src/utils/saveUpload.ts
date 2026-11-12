import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { getMaxFileSizeBytes } from '../config.js';

export class FileSizeLimitError extends Error {
  constructor(maxBytes: number) {
    super(`Файл превышает лимит ${Math.round(maxBytes / 1024 / 1024)} МБ`);
    this.name = 'FileSizeLimitError';
  }
}

function createSizeLimitStream(maxBytes: number): Transform {
  let totalSize = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        callback(new FileSizeLimitError(maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function saveUploadStream(
  stream: Readable,
  destPath: string,
  maxBytes: number = getMaxFileSizeBytes(),
): Promise<number> {
  await fsPromises.mkdir(path.dirname(destPath), { recursive: true });

  const writeStream = fs.createWriteStream(destPath);
  const limitStream = createSizeLimitStream(maxBytes);

  try {
    await pipeline(stream, limitStream, writeStream);
    const stat = await fsPromises.stat(destPath);
    return stat.size;
  } catch (err) {
    await fsPromises.rm(destPath, { force: true });
    throw err;
  }
}
