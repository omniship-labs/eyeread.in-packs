import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  listEntries,
  locationProblems,
  parseEntry,
  previousVerified,
} from '../scripts/lib/entries.mjs';
import { classifyChanges, parseNameStatus } from '../scripts/check-submission.mjs';

export const ENTRY = {
  repo: 'https://github.com/ada/hello',
  tag: 'v1.0.0',
  commit: 'a'.repeat(40),
  path: '.',
  url: 'https://github.com/ada/hello/releases/download/v1.0.0/com.example.hello-1.0.0.zip',
  packHash: 'b'.repeat(64),
};

test('parseEntry accepts the README example shape and defaults mirrors', () => {
  const { entry, problems } = parseEntry(JSON.stringify(ENTRY));
  assert.deepEqual(problems, []);
  assert.deepEqual(entry.mirrors, []);
});

test('parseEntry rejects bad fields', () => {
  const bad = (patch) => parseEntry(JSON.stringify({ ...ENTRY, ...patch })).problems;
  assert.ok(bad({ commit: 'abc' }).length);
  assert.ok(bad({ url: 'http://example.com/a.zip' }).length);
  assert.ok(bad({ path: '../x' }).length);
  assert.ok(bad({ path: '/abs' }).length);
  assert.ok(bad({ extra: 1 }).length);
  assert.ok(parseEntry('{').problems[0].includes('valid JSON'));
});

test('locationProblems checks the folder id and version', () => {
  assert.deepEqual(locationProblems('com.example.hello', '1.2.0-beta.1'), []);
  assert.equal(locationProblems('Hello', '1.0').length, 2);
  assert.equal(locationProblems('com.example.hello', '1.0.0+build').length, 1);
});

test('previousVerified picks the highest signed, non-withdrawn lower version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'entries-'));
  const add = async (version, { signed = false, withdrawn } = {}) => {
    const dir = join(root, 'packs', 'com.example.hello', version);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'entry.json'),
      JSON.stringify({ ...ENTRY, ...(withdrawn ? { withdrawn } : {}) })
    );
    if (signed) await writeFile(join(dir, 'files.json.minisig'), 'sig');
  };
  await add('1.0.0', { signed: true });
  await add('1.1.0', { signed: true, withdrawn: { date: '2026-01-01', reason: 'gone' } });
  await add('1.2.0');
  await add('2.0.0', { signed: true });
  const all = await listEntries(root);
  assert.equal(all.length, 4);
  assert.equal(previousVerified(all, 'com.example.hello', '1.3.0').version, '1.0.0');
  assert.equal(previousVerified(all, 'com.example.hello', '3.0.0').version, '2.0.0');
  assert.equal(previousVerified(all, 'com.example.hello', '1.0.0'), null);
});

test('classifyChanges: new entries are submissions, everything else is noted or rejected', () => {
  const changes = parseNameStatus(
    [
      'A\tpacks/com.example.hello/1.0.0/entry.json',
      'A\tpacks/com.example.hello/0.9.0/files.json.minisig',
      'M\tpacks/com.example.hello/0.9.0/entry.json',
      'A\tpacks/com.example.hello/1.0.0/main.js',
      'A\tpacks/stray.json',
      'M\tREADME.md',
      'R100\tpacks/com.example.hello/0.8.0/entry.json\tpacks/com.example.hello/0.8.1/entry.json',
    ].join('\n')
  );
  const { submissions, notes, problems } = classifyChanges(changes);
  assert.deepEqual(
    submissions.map((s) => s.version),
    ['1.0.0', '0.8.1']
  );
  assert.equal(notes.length, 3);
  assert.equal(problems.length, 2);
});
