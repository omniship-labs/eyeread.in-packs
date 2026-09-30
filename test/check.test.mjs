// End to end against real git repos and SDK builds (needs SDK_DIR).
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { checkSubmission } from '../scripts/lib/check.mjs';
import { renderReport } from '../scripts/lib/summary.mjs';
import {
  checkReachable,
  planIssue,
  readState,
  UNREACHABLE_DAYS,
} from '../scripts/reachability.mjs';
import { DownloadError } from '../scripts/lib/download.mjs';
import { buildZip, hasSdk, makeRepo, manifest, packFiles } from './helpers.mjs';

const ZIP = 'https://example.com/hello-1.0.0.zip';
const serve = (map) => async (url) => {
  if (!(url in map)) throw new DownloadError('HTTP 404');
  return map[url];
};

describe('checkSubmission', { skip: !hasSdk && 'set SDK_DIR to run' }, async () => {
  const repo = await makeRepo({ sub: 'pack', files: packFiles() });
  after(() => repo.cleanup());
  const { bytes, packHash } = await buildZip(repo);
  const entry = {
    repo: repo.url,
    tag: 'v1.0.0',
    commit: repo.commit,
    path: 'pack',
    url: ZIP,
    mirrors: [],
    packHash,
  };
  const args = { id: 'com.example.hello', version: '1.0.0', entry, previous: null };

  test('passes when the zip, hash, tag and source all agree', async () => {
    const r = await checkSubmission(args, { downloadZip: serve({ [ZIP]: bytes }) });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.match(
      renderReport({ results: [r], notes: [], problems: [] }).markdown,
      /First version/
    );
  });

  test('catches a wrong pack hash, a moved tag and a mismatched folder', async () => {
    const r = await checkSubmission(
      {
        ...args,
        version: '1.0.1',
        entry: { ...entry, packHash: '0'.repeat(64), commit: 'f'.repeat(40) },
      },
      { downloadZip: serve({ [ZIP]: bytes }) }
    );
    assert.equal(r.ok, false);
    const all = r.problems.join('\n');
    assert.match(all, /packs\/com.example.hello\/1.0.1/);
    assert.match(all, /pack hash is/);
    assert.match(all, /Tag v1.0.0 points at/);
    assert.match(all, /isn't in|couldn't reach/);
  });

  test("catches a zip that wasn't built from the commit", async () => {
    const other = await makeRepo({ files: packFiles(manifest(), 'eyeread.log("changed");\n') });
    after(() => other.cleanup());
    const { bytes: otherBytes, packHash: otherHash } = await buildZip(other);
    const r = await checkSubmission(
      { ...args, entry: { ...entry, packHash: otherHash } },
      { downloadZip: serve({ [ZIP]: otherBytes }) }
    );
    assert.match(r.problems.join('\n'), /doesn't give the same pack as the zip/);
  });

  test('reports a download failure and a bad mirror', async () => {
    const mirror = 'https://mirror.example/hello.zip';
    const r = await checkSubmission(
      { ...args, entry: { ...entry, mirrors: [mirror] } },
      { downloadZip: serve({ [ZIP]: bytes, [mirror]: Buffer.from('nope') }) }
    );
    assert.match(r.problems.join('\n'), /Mirror https:\/\/mirror.example\/hello.zip/);
  });

  test('summarises changes since the last Verified version', async () => {
    const next = manifest({
      version: '1.1.0',
      permissions: { 'scripts:write': { network: ['https://api.example.com'] } },
      description: 'Says hello, and more.',
    });
    const sha = await repo.commitMore(packFiles(next, 'eyeread.log("hello 2");\n'), 'v1.1.0');
    const { bytes: nextBytes, packHash: nextHash } = await buildZip(repo);
    const NEXT = 'https://example.com/hello-1.1.0.zip';
    const r = await checkSubmission(
      {
        id: 'com.example.hello',
        version: '1.1.0',
        entry: { ...entry, tag: 'v1.1.0', commit: sha, url: NEXT, packHash: nextHash },
        previous: { version: '1.0.0', entry },
      },
      { downloadZip: serve({ [ZIP]: bytes, [NEXT]: nextBytes }) }
    );
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.diff.permissions.added, ['scripts:write']);
    assert.deepEqual(r.diff.sites.added, ['https://api.example.com']);
    assert.deepEqual(
      r.diff.fields.map((f) => f.field),
      ['description']
    );
    assert.deepEqual(r.diff.files.changed, ['main.js', 'pack.json']);
    const md = renderReport({ results: [r], notes: [], problems: [] }).markdown;
    assert.match(md, /⚠️ \*\*New permissions:\*\* `scripts:write`/);
    assert.match(md, /⚠️ \*\*New network sites:\*\* `https:\/\/api.example.com`/);
  });
});

describe('checkReachable', { skip: !hasSdk && 'set SDK_DIR to run' }, async () => {
  const repo = await makeRepo({ files: packFiles() });
  after(() => repo.cleanup());
  const { bytes, packHash } = await buildZip(repo);
  const entry = {
    repo: repo.url,
    tag: 'v1.0.0',
    commit: repo.commit,
    path: '.',
    url: ZIP,
    mirrors: [],
    packHash,
  };

  test('ok when the zip and source are there', async () => {
    assert.deepEqual(await checkReachable(entry, { downloadZip: serve({ [ZIP]: bytes }) }), {
      status: 'ok',
      reasons: [],
    });
  });

  test('a working mirror is enough', async () => {
    const m = 'https://mirror.example/h.zip';
    const r = await checkReachable(
      { ...entry, mirrors: [m] },
      { downloadZip: serve({ [m]: bytes }) }
    );
    assert.equal(r.status, 'ok');
  });

  test('unreachable when the zip fails to download', async () => {
    const r = await checkReachable(entry, { downloadZip: serve({}) });
    assert.equal(r.status, 'unreachable');
  });

  test('withdraw when the zip changed or the tag is gone', async () => {
    const other = await makeRepo({ files: packFiles(manifest(), 'eyeread.log("x");\n') });
    after(() => other.cleanup());
    const { bytes: changed } = await buildZip(other);
    assert.equal(
      (await checkReachable(entry, { downloadZip: serve({ [ZIP]: changed }) })).status,
      'withdraw'
    );
    const r = await checkReachable(
      { ...entry, tag: 'v9.9.9' },
      { downloadZip: serve({ [ZIP]: bytes }) }
    );
    assert.equal(r.status, 'withdraw');
    assert.match(r.reasons[0], /tag v9.9.9 is gone/);
  });
});

test('planIssue counts unreachable days and flags withdrawal on day 3', () => {
  const item = {
    id: 'com.example.hello',
    version: '1.0.0',
    entry: { repo: 'https://x', tag: 'v1', packHash: 'h' },
  };
  const down = { status: 'unreachable', reasons: ['HTTP 404'] };
  let plan = planIssue(item, down, null, '2026-10-01');
  assert.equal(plan.action, 'open');
  assert.equal(plan.withdraw, false);
  let issue = { number: 1, body: plan.body, labels: ['reachability'] };
  assert.deepEqual(readState(issue.body), { days: 1, last: '2026-10-01' });

  // A second run on the same day doesn't count twice.
  plan = planIssue(item, down, issue, '2026-10-01');
  assert.equal(readState(plan.body).days, 1);

  for (const [day, n] of [
    ['2026-10-02', 2],
    ['2026-10-03', UNREACHABLE_DAYS],
  ]) {
    plan = planIssue(item, down, issue, day);
    issue = { ...issue, body: plan.body };
    assert.equal(readState(plan.body).days, n);
  }
  assert.equal(plan.withdraw, true);

  assert.equal(
    planIssue(
      item,
      { status: 'ok', reasons: [] },
      { ...issue, labels: ['reachability'] },
      '2026-10-04'
    ).action,
    'close'
  );
  assert.equal(
    planIssue(
      item,
      { status: 'ok', reasons: [] },
      { ...issue, labels: ['reachability', 'withdraw'] },
      '2026-10-04'
    ).action,
    'none'
  );
  assert.equal(
    planIssue(item, { status: 'withdraw', reasons: ['changed'] }, null, '2026-10-04').withdraw,
    true
  );
});
