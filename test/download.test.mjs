import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadZip, MAX_ZIP_BYTES } from '../scripts/lib/download.mjs';

const okUrl = async () => [];
function respond(map) {
  return async (url) => {
    const r = map[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return new Response(r.body ?? null, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
}

test('follows redirects and returns the bytes', async () => {
  const fetch = respond({
    'https://a.example/x.zip': {
      status: 302,
      headers: { location: 'https://cdn.example/x.zip' },
    },
    'https://cdn.example/x.zip': {
      body: 'PK zip',
      headers: { 'content-type': 'application/zip' },
    },
  });
  const bytes = await downloadZip('https://a.example/x.zip', { fetch, checkUrl: okUrl });
  assert.equal(bytes.toString(), 'PK zip');
});

test('checks every redirect hop against the URL rules', async () => {
  const fetch = respond({
    'https://a.example/x.zip': {
      status: 302,
      headers: { location: 'http://cdn.example/x.zip' },
    },
  });
  const checkUrl = async (u) => (u.startsWith('http:') ? ['must use https://'] : []);
  await assert.rejects(
    downloadZip('https://a.example/x.zip', { fetch, checkUrl }),
    /redirect to http:\/\/cdn.example\/x.zip must use https/
  );
});

test('rejects web pages, errors and oversized files', async () => {
  const fetch = respond({
    'https://a.example/page': {
      body: '<html>',
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
    'https://a.example/404': { status: 404 },
    'https://a.example/big': { body: new Uint8Array(MAX_ZIP_BYTES + 1) },
  });
  const deps = { fetch, checkUrl: okUrl };
  await assert.rejects(downloadZip('https://a.example/page', deps), /web page/);
  await assert.rejects(downloadZip('https://a.example/404', deps), /HTTP 404/);
  await assert.rejects(downloadZip('https://a.example/big', deps), /20 MiB/);
});
