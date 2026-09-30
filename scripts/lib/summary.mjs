// The PR comment: pass/fail per submitted version, what the pack asks for,
// and what changed since the last Verified version.

const REPO = process.env.GITHUB_REPOSITORY || 'omniship-labs/eyeread.in-packs';
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const json = (v) => (v === undefined ? '_(none)_' : code(JSON.stringify(v)));

function githubCompare(repo, from, to) {
  const m = repo.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/compare/${from}...${to}` : null;
}

function requests(pack) {
  const perms = Object.entries(pack.manifest.permissions);
  if (perms.length === 0) return ['- Permissions: none'];
  return [
    '- Permissions:',
    ...perms.map(([name, p]) => {
      const net = p.network?.length ? ` → internet: ${p.network.map(code).join(', ')}` : '';
      return `  - ${code(name)}${net}`;
    }),
  ];
}

function diffLines(result) {
  const { diff, previous, entry } = result;
  if (!previous) return ['**First version of this pack:** full review.'];
  if (!diff) return [`**Compared with ${previous.version}:** ${result.diffError}`];

  const lines = [`**Changes since ${previous.version}** (the last Verified version):`, ''];
  const flag = (label, { added, removed }) => {
    if (added.length) lines.push(`- ⚠️ **New ${label}:** ${added.map(code).join(', ')}`);
    if (removed.length) lines.push(`- Removed ${label}: ${removed.map(code).join(', ')}`);
  };
  flag('permissions', diff.permissions);
  flag('network sites', diff.sites);
  for (const f of diff.fields) {
    const warn = f.field === 'pricing' ? '⚠️ ' : '';
    lines.push(`- ${warn}${code(f.field)}: ${json(f.from)} → ${json(f.to)}`);
  }
  const { added, removed, changed } = diff.files;
  if (added.length + removed.length + changed.length === 0) lines.push('- Files: unchanged');
  else {
    lines.push(
      `- Files: ${changed.length} changed, ${added.length} added, ${removed.length} removed`
    );
    for (const p of added) lines.push(`  - added ${code(p)}`);
    for (const p of removed) lines.push(`  - removed ${code(p)}`);
    for (const p of changed) lines.push(`  - changed ${code(p)}`);
  }
  const compare = githubCompare(entry.repo, previous.entry.commit, entry.commit);
  if (compare) lines.push('', `Source diff: ${compare}`);
  return lines;
}

export function renderResult(result) {
  const { id, version, entry, problems } = result;
  const lines = [`### ${result.ok ? '✅' : '❌'} ${code(`${id}@${version}`)}`, ''];
  if (problems.length) {
    lines.push('**Problems** (fix these and push again):', '');
    for (const p of problems) {
      const [first, ...rest] = p.split('\n');
      lines.push(`- ${first}`);
      if (rest.length) lines.push('  ```', ...rest.map((r) => `  ${r}`), '  ```');
    }
    lines.push('');
  }
  lines.push(
    `- Source: ${entry.repo} at ${code(entry.tag)} (${code(entry.commit.slice(0, 12))}), folder ${code(entry.path)}`
  );
  lines.push(`- Zip: ${entry.url}`);
  lines.push(`- Pack hash: ${code(entry.packHash)}`);
  if (result.packs) {
    const top = result.packs[0];
    lines.push(
      `- Name: ${top.manifest.name} — by ${top.manifest.author.name}, ${code(top.manifest.license)}`
    );
    if (top.manifest.description) lines.push(`- Description: ${top.manifest.description}`);
    lines.push(...requests(top));
    for (const inc of result.packs.slice(1)) {
      lines.push(`- Includes ${code(`${inc.id}@${inc.version}`)} (${code(inc.packHash)})`);
    }
    lines.push('', ...diffLines(result));
  }
  return lines.join('\n');
}

/**
 * @param {{ results: object[], notes: string[], problems: string[] }} report
 */
export function renderReport({ results, notes, problems }) {
  const ok = problems.length === 0 && results.every((r) => r.ok);
  const lines = ['## Pack submission check', ''];
  if (results.length === 0 && problems.length === 0) {
    lines.push('No new pack versions in this pull request.');
  } else {
    lines.push(
      ok
        ? `Automated checks passed. A maintainer will now review it against the [review checklist](https://github.com/${REPO}/blob/main/REVIEW.md).`
        : 'Automated checks failed. See below.'
    );
  }
  for (const p of problems) lines.push('', `- ❌ ${p}`);
  for (const r of results) lines.push('', renderResult(r));
  if (notes.length)
    lines.push('', '**Notes for maintainers:**', '', ...notes.map((n) => `- ${n}`));
  return { ok, markdown: lines.join('\n') + '\n' };
}
