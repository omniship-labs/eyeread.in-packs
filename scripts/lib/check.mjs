// Check one submitted version: the zip downloads and validates, its pack hash
// matches the entry, the tag points at the commit, and building the pack
// folder at that commit gives the same pack hashes. Then compare it with the
// last Verified version for the reviewer.
import { downloadZip as defaultDownload } from './download.mjs';
import { exportCommit as defaultExport, resolveTag as defaultResolveTag } from './git.mjs';
import { describeBundle, loadSdk } from './sdk.mjs';

/**
 * @param {object} args
 * @param {string} args.id folder id
 * @param {string} args.version folder version
 * @param {object} args.entry parsed entry.json
 * @param {object | null} args.previous the last Verified entry of this pack, from listEntries
 * @param {object} [deps] overrides for tests: downloadZip, resolveTag, exportCommit, sdk
 */
export async function checkSubmission({ id, version, entry, previous }, deps = {}) {
  const download = deps.downloadZip ?? defaultDownload;
  const resolveTag = deps.resolveTag ?? defaultResolveTag;
  const exportCommit = deps.exportCommit ?? defaultExport;
  const sdk = deps.sdk ?? (await loadSdk());

  const problems = [];
  const result = { id, version, entry, problems, packs: null, previous: null, diff: null };

  // 1. The zip: downloads under the rules, validates like the installer, matches the entry.
  let zipPacks;
  try {
    zipPacks = await validateZip(sdk, await download(entry.url));
  } catch (err) {
    problems.push(`Zip at ${entry.url}: ${err.message}`);
  }
  if (zipPacks) {
    result.packs = zipPacks;
    const top = zipPacks[0];
    if (top.id !== id || top.version !== version)
      problems.push(
        `The zip is ${top.id}@${top.version}, but the entry is in packs/${id}/${version}/.`
      );
    if (top.packHash !== entry.packHash)
      problems.push(
        `The zip's pack hash is ${top.packHash}, but entry.json says ${entry.packHash}.`
      );
  }
  for (const mirror of entry.mirrors) {
    try {
      const packs = await validateZip(sdk, await download(mirror));
      if (zipPacks && !samePacks(packs, zipPacks))
        problems.push(`Mirror ${mirror} serves a different pack than ${entry.url}.`);
    } catch (err) {
      problems.push(`Mirror ${mirror}: ${err.message}`);
    }
  }

  // 2. The source: the tag is this commit, and the folder at it builds to the same packs.
  try {
    const tagged = await resolveTag(entry.repo, entry.tag);
    if (tagged === null) problems.push(`${entry.repo} has no tag ${entry.tag}.`);
    else if (tagged !== entry.commit)
      problems.push(
        `Tag ${entry.tag} points at ${tagged}, but entry.json says ${entry.commit}.`
      );
  } catch (err) {
    problems.push(err.message);
  }
  let exported;
  try {
    exported = await exportCommit(entry.repo, entry.commit, entry.path);
    const { bundle } = await sdk.buildPack(exported.dir, undefined);
    const built = describeBundle(bundle);
    if (zipPacks && !samePacks(built, zipPacks)) {
      problems.push(
        `Building "${entry.path}" at ${entry.commit.slice(0, 12)} doesn't give the same pack as the zip:\n` +
          packList(built, 'built') +
          '\n' +
          packList(zipPacks, 'zip')
      );
    }
  } catch (err) {
    const what =
      err instanceof sdk.PackError ? `Building the source failed: ${err}` : err.message;
    problems.push(what);
  } finally {
    await exported?.cleanup();
  }

  // 3. What changed since the last Verified version, for a diff-only review.
  if (previous && zipPacks) {
    result.previous = previous;
    try {
      const prevPacks = await validateZip(sdk, await download(previous.entry.url));
      result.diff = diffPacks(prevPacks[0], zipPacks[0]);
    } catch (err) {
      result.diffError = `Couldn't load ${id}@${previous.version} to compare (${err.message}).`;
    }
  }

  result.ok = problems.length === 0;
  return result;
}

async function validateZip(sdk, bytes) {
  return describeBundle(await sdk.validateZipBuffer(bytes, undefined));
}

function samePacks(a, b) {
  const key = (packs) =>
    packs
      .map((p) => `${p.id}@${p.version}:${p.packHash}`)
      .sort()
      .join('\n');
  return key(a) === key(b);
}

function packList(packs, label) {
  return packs.map((p) => `  ${label}: ${p.id}@${p.version} ${p.packHash}`).join('\n');
}

function sites(permissions) {
  return new Set(Object.values(permissions).flatMap((p) => p.network ?? []));
}

const setDiff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/**
 * The reviewer's view of what changed between two versions of a pack:
 * permissions and network sites first, then any other manifest field, then files.
 */
export function diffPacks(prev, next) {
  const prevPerms = new Set(Object.keys(prev.manifest.permissions));
  const nextPerms = new Set(Object.keys(next.manifest.permissions));
  const prevSites = sites(prev.manifest.permissions);
  const nextSites = sites(next.manifest.permissions);

  const skip = new Set(['version', 'permissions']);
  const fields = [...new Set([...Object.keys(prev.manifest), ...Object.keys(next.manifest)])]
    .filter((k) => !skip.has(k))
    .filter((k) => JSON.stringify(prev.manifest[k]) !== JSON.stringify(next.manifest[k]))
    .sort();

  const paths = [...new Set([...Object.keys(prev.files), ...Object.keys(next.files)])].sort();
  const files = { added: [], removed: [], changed: [] };
  for (const p of paths) {
    if (!(p in prev.files)) files.added.push(p);
    else if (!(p in next.files)) files.removed.push(p);
    else if (prev.files[p] !== next.files[p]) files.changed.push(p);
  }

  return {
    permissions: {
      added: setDiff(nextPerms, prevPerms),
      removed: setDiff(prevPerms, nextPerms),
    },
    sites: { added: setDiff(nextSites, prevSites), removed: setDiff(prevSites, nextSites) },
    fields: fields.map((k) => ({ field: k, from: prev.manifest[k], to: next.manifest[k] })),
    files,
  };
}
