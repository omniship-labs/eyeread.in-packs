#!/usr/bin/env node
// CI for a pull request: find the pack versions it adds and check each one.
//
//   node scripts/check-submission.mjs --pr <checkout of the PR> --base <base commit> [--out comment.md]
//
// The scripts run from the base branch, so a pull request can't change the
// checks it's judged by; only the PR's packs/ files are read.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { checkSubmission } from './lib/check.mjs';
import {
  ENTRY_FILE,
  SIGNATURE_FILE,
  listEntries,
  locationProblems,
  parseEntry,
  parseEntryPath,
  previousVerified,
} from './lib/entries.mjs';
import { renderReport } from './lib/summary.mjs';

const run = promisify(execFile);

/**
 * Sort a PR's changed files into submissions to check, maintainer changes to
 * note, and changes a submission isn't allowed to make.
 * @param {{ status: string, path: string }[]} changes from `git diff --name-status`
 */
export function classifyChanges(changes) {
  const submissions = [];
  const notes = [];
  const problems = [];
  for (const { status, path } of changes) {
    const loc = parseEntryPath(path);
    if (!loc) {
      if (path.startsWith('packs/'))
        problems.push(`${path}: packs/ only holds packs/<id>/<version>/${ENTRY_FILE}.`);
      else notes.push(`Changes ${path} (not a submission).`);
      continue;
    }
    if (loc.file === ENTRY_FILE && status === 'A') {
      submissions.push(loc);
    } else if (loc.file === ENTRY_FILE && status === 'M') {
      notes.push(
        `Edits ${path}. Only maintainers change an entry after it's added (to withdraw it); a new release needs a new version folder.`
      );
    } else if (loc.file === SIGNATURE_FILE) {
      notes.push(
        `Adds or changes the signature for ${loc.id}@${loc.version} (maintainers only).`
      );
    } else if (status === 'D') {
      notes.push(`Deletes ${path}.`);
    } else {
      problems.push(
        `${path}: a version folder holds only ${ENTRY_FILE} (and, from maintainers, ${SIGNATURE_FILE}).`
      );
    }
  }
  return { submissions, notes, problems };
}

export function parseNameStatus(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t');
      // Renames and copies list old and new paths; treat them as the new path being added.
      return {
        status: status[0] === 'R' || status[0] === 'C' ? 'A' : status[0],
        path: paths.at(-1),
      };
    });
}

async function main() {
  const { values } = parseArgs({
    options: { pr: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' } },
  });
  if (!values.pr || !values.base) {
    console.error('usage: check-submission.mjs --pr <dir> --base <commit> [--out file.md]');
    process.exit(2);
  }
  const { stdout } = await run(
    'git',
    ['diff', '--name-status', '-M', `${values.base}...HEAD`],
    {
      cwd: values.pr,
    }
  );
  const { submissions, notes, problems } = classifyChanges(parseNameStatus(stdout));

  const all = await listEntries(values.pr);
  const results = [];
  for (const { id, version } of submissions) {
    const text = await readFile(join(values.pr, 'packs', id, version, ENTRY_FILE), 'utf8');
    const where = locationProblems(id, version);
    const { entry, problems: entryProblems } = parseEntry(text);
    if (where.length || entryProblems.length) {
      problems.push(...[...where, ...entryProblems].map((p) => `packs/${id}/${version}: ${p}`));
      continue;
    }
    console.log(`Checking ${id}@${version}…`);
    results.push(
      await checkSubmission({
        id,
        version,
        entry,
        previous: previousVerified(all, id, version),
      })
    );
  }

  const { ok, markdown } = renderReport({ results, notes, problems });
  console.log(markdown);
  if (values.out) await writeFile(values.out, markdown);
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: 'a' });
  process.exitCode = ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
