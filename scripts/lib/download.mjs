// Download a pack zip the way the rules say it must be served: directly, over
// https, at most 20 MiB, following redirects only to hosts that pass the
// same URL rules.
import { checkUrl } from './url.mjs';

export const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 60_000;

export class DownloadError extends Error {}

/**
 * @param {string} url
 * @param {{ fetch?: typeof fetch, checkUrl?: typeof checkUrl }} [deps]
 * @returns {Promise<Buffer>}
 */
export async function downloadZip(url, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const check = deps.checkUrl ?? checkUrl;
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problems = await check(current);
    if (problems.length > 0) {
      const where = hop === 0 ? 'URL' : `redirect to ${current}`;
      throw new DownloadError(`${where} ${problems.join('; ')}`);
    }
    let res;
    try {
      res = await doFetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'eyeread.in-packs-ci', accept: 'application/zip, */*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new DownloadError(`couldn't download (${err.cause?.code ?? err.message})`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new DownloadError(`HTTP ${res.status} without a Location header`);
      current = new URL(location, current).href;
      continue;
    }
    if (res.status !== 200) throw new DownloadError(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type))
      throw new DownloadError('served a web page, not the zip (it must download directly)');
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_ZIP_BYTES) throw new DownloadError('is larger than 20 MiB');
    return await readCapped(res);
  }
  throw new DownloadError(`more than ${MAX_REDIRECTS} redirects`);
}

async function readCapped(res) {
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > MAX_ZIP_BYTES) throw new DownloadError('is larger than 20 MiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
