#!/usr/bin/env node
// The daily reachability check: every Verified version must still download
// with the right pack hash (from its URL or any mirror), and its tag and
// commit must still exist.
//
//   node scripts/reachability.mjs [--root .] [--issues]
//
// Signing never happens in CI, so this can't withdraw anything itself. It
// keeps one issue per failing version: unreachable 3 days in a row, a wrong
// hash, or a missing tag or commit gets the `withdraw` label, for a
// maintainer to act on.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { DownloadError, downloadZip as defaultDownload } from './lib/download.mjs';
import { isVerified, listEntries } from './lib/entries.mjs';
import {
  commitExists as defaultCommitExists,
  GitError,
  resolveTag as defaultResolveTag,
} from './lib/git.mjs';
import { loadSdk } from './lib/sdk.mjs';

const run = promisify(execFile);
export const UNREACHABLE_DAYS = 3;
const REPO = process.env.GITHUB_REPOSITORY || 'omniship-labs/eyeread.in-packs';
const LABEL = 'reachability';
const WITHDRAW_LABEL = 'withdraw';

/**
 * @returns {Promise<{ status: 'ok' | 'unreachable' | 'withdraw', reasons: string[] }>}
 */
export async function checkReachable(entry, deps = {}) {
  const download = deps.downloadZip ?? defaultDownload;
  const resolveTag = deps.resolveTag ?? defaultResolveTag;
  const commitExists = deps.commitExists ?? defaultCommitExists;
  const sdk = deps.sdk ?? (await loadSdk());

  const unreachable = [];
  const withdraw = [];

  // The zip: any source serving the right pack hash is enough.
  const wrong = [];
  const failed = [];
  let served = false;
  for (const url of [entry.url, ...(entry.mirrors ?? [])]) {
    try {
      const bundle = await sdk.validateZipBuffer(await download(url), undefined);
      if (bundle.top.packHash === entry.packHash) {
        served = true;
        break;
      }
      wrong.push(`${url} now serves a different pack (hash ${bundle.top.packHash})`);
    } catch (err) {
      if (err instanceof DownloadError) failed.push(`${url}: ${err.message}`);
      else wrong.push(`${url} now serves a zip that doesn't validate (${err.message})`);
    }
  }
  if (!served) {
    if (wrong.length) withdraw.push(...wrong);
    else unreachable.push(...failed);
  }

  // The source.
  try {
    const tagged = await resolveTag(entry.repo, entry.tag);
    if (tagged === null) withdraw.push(`tag ${entry.tag} is gone from ${entry.repo}`);
    else if (tagged !== entry.commit)
      withdraw.push(`tag ${entry.tag} now points at ${tagged}, not ${entry.commit}`);
  } catch (err) {
    if (!(err instanceof GitError)) throw err;
    unreachable.push(err.message);
  }
  const has = await commitExists(entry.repo, entry.commit);
  if (has === false) withdraw.push(`commit ${entry.commit} is gone from ${entry.repo}`);
  else if (has === null) unreachable.push(`couldn't reach ${entry.repo} to check the commit`);

  if (withdraw.length) return { status: 'withdraw', reasons: withdraw };
  // A zip that downloads fine still counts as unreachable if the repo didn't answer.
  if (unreachable.length) return { status: 'unreachable', reasons: unreachable };
  return { status: 'ok', reasons: [] };
}

const STATE_RE = /<!-- reachability days=(\d+) last=(\d{4}-\d{2}-\d{2}) -->/;

export function readState(body) {
  const m = body?.match(STATE_RE);
  return m ? { days: Number(m[1]), last: m[2] } : { days: 0, last: null };
}

function issueBody({ id, version, entry }, check, days, today) {
  const withdraw = check.status === 'withdraw' || days >= UNREACHABLE_DAYS;
  const lines = [
    `<!-- reachability days=${days} last=${today} -->`,
    `**${id}@${version}** failed the daily reachability check` +
      (check.status === 'unreachable'
        ? ` (${days} day${days === 1 ? '' : 's'} in a row).`
        : '.'),
    '',
    ...check.reasons.map((r) => `- ${r}`),
    '',
    `Entry: [\`packs/${id}/${version}/entry.json\`](https://github.com/${REPO}/blob/main/packs/${id}/${version}/entry.json) · source ${entry.repo} at \`${entry.tag}\``,
    '',
  ];
  if (withdraw) {
    lines.push(
      '**Withdraw this version.** On the signing machine:',
      '',
      `1. Add \`"withdrawn": { "date": "${today}", "reason": "Source no longer available" }\` to its entry.json.`,
      `2. Add an "unverify" entry for pack hash \`${entry.packHash}\` to the app's revocation list and sign it (see the app's docs/PACKS.md), so installed copies show as Community with the reason.`,
      '3. Merge both, then close this issue.'
    );
  } else {
    lines.push(
      `If it's still failing after ${UNREACHABLE_DAYS} days in a row, this issue gets the \`${WITHDRAW_LABEL}\` label. It closes by itself if the pack is reachable again.`
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * What to do with this version's issue, given today's result.
 * @param {{ number: number, body: string, labels: string[] } | null} issue the open issue, if any
 * @returns {{ action: 'none' } | { action: 'close', comment: string } |
 *   { action: 'open' | 'update', body: string, withdraw: boolean }}
 */
export function planIssue(item, check, issue, today) {
  if (check.status === 'ok') {
    if (!issue || issue.labels.includes(WITHDRAW_LABEL)) return { action: 'none' };
    return { action: 'close', comment: `Reachable again on ${today}.` };
  }
  const prev = readState(issue?.body);
  const days =
    check.status === 'withdraw' ? prev.days : prev.last === today ? prev.days : prev.days + 1;
  const withdraw = check.status === 'withdraw' || days >= UNREACHABLE_DAYS;
  const body = issueBody(item, check, days, today);
  return { action: issue ? 'update' : 'open', body, withdraw };
}

export const issueTitle = ({ id, version }) => `Reachability: ${id}@${version}`;

async function gh(args) {
  const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function openIssues() {
  const out = await gh([
    'issue',
    'list',
    '--label',
    LABEL,
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,title,body,labels',
  ]);
  return new Map(
    JSON.parse(out).map((i) => [i.title, { ...i, labels: i.labels.map((l) => l.name) }])
  );
}

async function applyPlan(item, plan, issue) {
  const title = issueTitle(item);
  if (plan.action === 'close') {
    await gh(['issue', 'close', String(issue.number), '--comment', plan.comment]);
  } else if (plan.action === 'open') {
    const labels = [LABEL, ...(plan.withdraw ? [WITHDRAW_LABEL] : [])].join(',');
    await gh(['issue', 'create', '--title', title, '--body', plan.body, '--label', labels]);
  } else if (plan.action === 'update') {
    const args = ['issue', 'edit', String(issue.number), '--body', plan.body];
    if (plan.withdraw && !issue.labels.includes(WITHDRAW_LABEL)) {
      args.push('--add-label', WITHDRAW_LABEL);
      await gh(args);
      await gh([
        'issue',
        'comment',
        String(issue.number),
        '--body',
        'This version should now be withdrawn; see the steps above.',
      ]);
      return;
    }
    await gh(args);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: '.' },
      issues: { type: 'boolean', default: false },
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  const verified = (await listEntries(values.root)).filter(isVerified);
  const issues = values.issues ? await openIssues() : new Map();

  const rows = [];
  for (const item of verified) {
    const check = await checkReachable(item.entry);
    const label = `${item.id}@${item.version}`;
    rows.push(`| ${label} | ${check.status} | ${check.reasons.join('<br>')} |`);
    console.log(
      `${check.status.padEnd(11)} ${label}${check.reasons.length ? `\n  ${check.reasons.join('\n  ')}` : ''}`
    );
    if (values.issues) {
      const issue = issues.get(issueTitle(item)) ?? null;
      await applyPlan(item, planIssue(item, check, issue, today), issue);
    }
  }
  const summary = [
    `## Reachability check, ${today}`,
    '',
    `${verified.length} Verified version${verified.length === 1 ? '' : 's'} checked.`,
    '',
    ...(rows.length ? ['| Version | Status | Details |', '| --- | --- | --- |', ...rows] : []),
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY)
    await writeFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n', { flag: 'a' });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
