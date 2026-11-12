import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { OutputFormat, ProcessOptions } from '../types.js';
import {
  buildOutputFilename,
  resolveDataPath,
  toAbsoluteFromStored,
  toConvertedRelPath,
} from '../utils/paths.js';

type SupportedFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff';

function resolveOutputFormat(format: OutputFormat, inputPath: string): SupportedFormat {
  if (format) {
    return format;
  }

  const ext = path.extname(inputPath).slice(1).toLowerCase();
  const map: Record<string, SupportedFormat> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    avif: 'avif',
    gif: 'gif',
    tiff: 'tiff',
    tif: 'tiff',
    heic: 'jpeg',
    heif: 'jpeg',
  };

  return map[ext] ?? 'jpeg';
}

export interface ProcessImageInput {
  inputRelPath: string;
  jobId: string;
  originalName: string;
  fileId: string;
  options: ProcessOptions;
}

export interface ProcessImageResult {
  outputRelPath: string;
  sizeAfter: number;
}

export async function processImage(input: ProcessImageInput): Promise<ProcessImageResult> {
  const { inputRelPath, jobId, originalName, fileId, options } = input;
  const inputPath = toAbsoluteFromStored(inputRelPath);
  const outputFormat = resolveOutputFormat(options.format, inputPath);
  const effectiveFormat = options.format ? options.format : outputFormat;
  const outputName = buildOutputFilename(originalName, effectiveFormat, fileId);
  const outputRelPath = toConvertedRelPath(jobId, outputName);
  const outputPath = resolveDataPath(outputRelPath);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let pipeline = sharp(inputPath, { failOn: 'none' }).rotate();

  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize({
      width: options.maxWidth ?? undefined,
      height: options.maxHeight ?? undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (!options.stripMetadata) {
    pipeline = pipeline.withMetadata();
  }

  switch (outputFormat) {
    case 'jpeg':
      await pipeline.jpeg({ quality: options.quality, mozjpeg: true }).toFile(outputPath);
      break;
    case 'png':
      await pipeline.png({ quality: options.quality, compressionLevel: 9 }).toFile(outputPath);
      break;
    case 'webp':
      await pipeline.webp({ quality: options.quality }).toFile(outputPath);
      break;
    case 'avif':
      await pipeline.avif({ quality: options.quality }).toFile(outputPath);
      break;
    case 'gif':
      await pipeline.gif().toFile(outputPath);
      break;
    case 'tiff':
      await pipeline.tiff({ quality: options.quality }).toFile(outputPath);
      break;
  }

  const stat = await fs.stat(outputPath);

  return {
    outputRelPath,
    sizeAfter: stat.size,
  };
}
