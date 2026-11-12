import PQueue from 'p-queue';
import { config } from '../config.js';

export const processingQueue = new PQueue({
  concurrency: config.queueConcurrency,
}) as PQueue;

export function getQueueStats(): { pending: number; size: number } {
  return {
    pending: processingQueue.pending,
    size: processingQueue.size,
  };
}

export async function waitForQueueIdle(timeoutMs: number): Promise<boolean> {
  if (processingQueue.pending === 0 && processingQueue.size === 0) {
    return true;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);

    void processingQueue.onIdle().then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
