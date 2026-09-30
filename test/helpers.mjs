// Fixture packs in real git repos, built with the SDK, for the end-to-end tests.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportCommit } from '../scripts/lib/git.mjs';
import { loadSdk } from '../scripts/lib/sdk.mjs';

process.env.PACKS_TEST_ALLOW_FILE = '1';

export const hasSdk = Boolean(process.env.SDK_DIR);

export function manifest(overrides = {}) {
  return {
    apiVersion: 1,
    id: 'com.example.hello',
    name: 'Hello',
    version: '1.0.0',
    description: 'Says hello.',
    author: { name: 'Ada Example' },
    license: 'MIT',
    main: 'main.js',
    ...overrides,
  };
}

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();

/**
 * A git repo with the pack at `sub` (default: the root), committed and tagged.
 * Returns the repo as a file:// URL, the commit, and helpers to commit more.
 */
export async function makeRepo({ sub = '.', files }) {
  const root = await mkdtemp(join(tmpdir(), 'eyeread-fixture-'));
  git(root, 'init', '--quiet', '-b', 'main');
  const packDir = join(root, sub);
  await mkdir(packDir, { recursive: true });
  const commit = async (fileMap, tag) => {
    for (const [name, content] of Object.entries(fileMap)) {
      await writeFile(join(packDir, name), content);
    }
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', 'pack');
    if (tag) git(root, 'tag', '-a', tag, '-m', tag);
    return git(root, 'rev-parse', 'HEAD');
  };
  const sha = await commit(files, 'v1.0.0');
  return {
    root,
    sub,
    packDir,
    head: () => git(root, 'rev-parse', 'HEAD'),
    url: pathToFileURL(root).href,
    commit: sha,
    commitMore: commit,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function packFiles(m = manifest(), main = 'eyeread.log("hello");\n') {
  return { 'pack.json': JSON.stringify(m, null, 2) + '\n', 'main.js': main };
}

/**
 * Build the pack at a commit with the SDK: the zip bytes and the top pack hash.
 * Built from an export, since the SDK can't build a folder that holds .git.
 */
export async function buildZip(repo, commit = repo.head(), path = repo.sub) {
  const sdk = await loadSdk();
  const exported = await exportCommit(repo.url, commit, path);
  try {
    const { bytes, bundle } = await sdk.buildPack(exported.dir, undefined);
    return { bytes, packHash: bundle.top.packHash };
  } finally {
    await exported.cleanup();
  }
}
