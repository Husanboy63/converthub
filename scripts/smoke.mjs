import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  signal: AbortSignal.timeout(15_000),
});

async function json(path, options) {
  const response = await request(path, options);
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${await response.clone().text()}`);
  return response.json();
}

for (let attempt = 0; ; attempt++) {
  try {
    assert.equal((await json('/api/health')).status, 'ok');
    break;
  } catch (error) {
    if (attempt >= 29) throw error;
    await sleep(1000);
  }
}

async function verifyJob(id, format) {
  const job = await json(`/api/jobs/${id}`);
  assert.equal(job.status, 'done', JSON.stringify(job));
  assert.equal(job.files[0].status, 'done', JSON.stringify(job));
  const file = await request(`/api/jobs/${id}/files/${job.files[0].id}`);
  assert.equal(file.status, 200);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.ok(bytes.length > 0);
  if (format === 'webp') assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  if (format === 'jpeg') assert.equal(bytes.readUInt16BE(0), 0xffd8);
  if (format === 'png') assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
  if (format === 'avif') assert.ok(bytes.subarray(0, 40).includes(Buffer.from('avif')));
  const zip = await request(`/api/jobs/${id}/download`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(0), 0x04034b50);
}

if (process.env.SMOKE_JOB_ID) {
  await verifyJob(process.env.SMOKE_JOB_ID, 'webp');
  console.log('PASS: job and download survive container restart');
} else {
  const page = await request('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<div id="app"><\/div>/);
  const asset = html.match(/src="([^\"]+\.js)"/);
  assert.ok(asset, 'Built frontend JavaScript is referenced');
  const script = await request(asset[1]);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);

  // A real PNG fixture; no image libraries are required to run this check.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (const format of ['webp', 'jpeg', 'png', 'avif']) {
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'smoke.png');
    form.append('options', JSON.stringify({ format, quality: 75, maxWidth: 1, stripMetadata: true }));
    const { jobId } = await json('/api/jobs', { method: 'POST', body: form });
    assert.ok(jobId);
    for (let attempt = 0; ; attempt++) {
      const job = await json(`/api/jobs/${jobId}`);
      if (job.status === 'done') break;
      assert.notEqual(job.status, 'failed', JSON.stringify(job));
      assert.ok(attempt < 29, 'Conversion timed out');
      await sleep(1000);
    }
    await verifyJob(jobId, format);
    if (format === 'webp' && process.env.SMOKE_RESULT_FILE) {
      await fs.writeFile(process.env.SMOKE_RESULT_FILE, jobId);
    }
    console.log(`PASS: PNG -> ${format}, file download and ZIP`);
  }
  assert.equal((await request('/api/jobs/not-a-real-job')).status, 404);
  console.log('PASS: production frontend and health endpoint');
}
