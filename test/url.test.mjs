import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUrl, isPrivateAddress, urlProblems } from '../scripts/lib/url.mjs';

test('accepts a GitHub release asset', () => {
  assert.deepEqual(
    urlProblems(
      'https://github.com/ada/hello/releases/download/v1.0.0/com.example.hello-1.0.0.zip'
    ),
    []
  );
});

test('rejects http, credentials, IPs, localhost and "latest"', () => {
  const one = (url) => urlProblems(url)[0];
  assert.match(one('http://example.com/a.zip'), /https/);
  assert.match(one('https://u:p@example.com/a.zip'), /username/);
  assert.match(one('https://93.184.216.34/a.zip'), /IP address/);
  assert.match(one('https://[::1]/a.zip'), /IP address/);
  assert.match(one('https://localhost/a.zip'), /public host/);
  assert.match(one('https://intranet/a.zip'), /public host/);
  assert.match(one('https://github.com/a/b/releases/latest/download/a.zip'), /latest/);
  assert.match(one('not a url'), /valid URL/);
});

test('private and reserved addresses', () => {
  for (const a of [
    '10.1.2.3',
    '127.0.0.1',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])
    assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['93.184.216.34', '140.82.112.3', '2606:4700::1111', '172.32.0.1'])
    assert.equal(isPrivateAddress(a), false, a);
});

test('checkUrl rejects a host that resolves to a private address', async () => {
  const resolve = async () => [{ address: '10.0.0.5', family: 4 }];
  assert.match(
    (await checkUrl('https://sneaky.example.com/a.zip', resolve))[0],
    /private network/
  );
  const ok = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.deepEqual(await checkUrl('https://example.com/a.zip', ok), []);
});
