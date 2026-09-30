// Read a creator's repo without running anything from it: resolve the tag,
// fetch the one commit, and export the pack folder as plain files (no .git).
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
// No credential prompts, hooks, or local config from the environment.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };

export class GitError extends Error {}

// Only https remotes. Tests serve fixture repos from disk, so they opt in to file://.
function gitConfig() {
  const protocols = process.env.PACKS_TEST_ALLOW_FILE === '1' ? ['https', 'file'] : ['https'];
  return [
    ['core.hooksPath', '/dev/null'],
    ['protocol.allow', 'never'],
    ...protocols.map((p) => [`protocol.${p}.allow`, 'always']),
  ].flatMap(([k, v]) => ['-c', `${k}=${v}`]);
}

function git(args, cwd) {
  return run('git', [...gitConfig(), ...args], {
    cwd,
    env: GIT_ENV,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * The commit a tag points to, or null if the repo has no such tag. Throws
 * GitError if the repo can't be reached at all.
 */
export async function resolveTag(repo, tag) {
  let stdout;
  try {
    ({ stdout } = await git([
      'ls-remote',
      '--tags',
      repo,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]));
  } catch (err) {
    throw new GitError(`couldn't reach ${repo} (${err.stderr?.trim() || err.message})`);
  }
  const refs = new Map(
    stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split('\t');
        return [ref, sha];
      })
  );
  // An annotated tag lists the tag object and, peeled, the commit it points to.
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

async function fetchCommit(repo, commit, gitDir, extra = []) {
  await git(['init', '--quiet', '--bare', gitDir]);
  try {
    await git(['fetch', '--quiet', '--depth=1', '--no-tags', ...extra, repo, commit], gitDir);
  } catch (err) {
    const detail = err.stderr?.trim() || err.message;
    const missing =
      /not our ref|couldn't find remote ref|unadvertised object|no such remote ref/i.test(
        detail
      );
    throw new GitError(
      missing ? `commit ${commit} isn't in ${repo}` : `couldn't reach ${repo} (${detail})`,
      { cause: missing ? 'missing' : 'unreachable' }
    );
  }
}

/**
 * Fetch one commit and export `path` from it into a new temp folder.
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
export async function exportCommit(repo, commit, path) {
  const work = await mkdtemp(join(tmpdir(), 'eyeread-pack-'));
  const cleanup = () => rm(work, { recursive: true, force: true });
  try {
    const gitDir = join(work, 'repo');
    const out = join(work, 'pack');
    await mkdir(out);
    await fetchCommit(repo, commit, gitDir);
    const tree = path === '.' ? commit : `${commit}:${path}`;
    try {
      await git(['cat-file', '-e', tree], gitDir);
    } catch {
      throw new GitError(`path "${path}" doesn't exist at commit ${commit}`);
    }
    // `git archive` then `tar -x`: plain files only, and symlinks stay symlinks
    // so the SDK's reader rejects them as it would on the creator's disk.
    const tarball = join(work, 'pack.tar');
    await git(['archive', '--format=tar', '-o', tarball, tree], gitDir);
    await run('tar', ['-xf', tarball, '-C', out], { timeout: GIT_TIMEOUT_MS });
    return { dir: out, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

/** Does the repo still have this commit? Null if the repo can't be reached. */
export async function commitExists(repo, commit) {
  const work = await mkdtemp(join(tmpdir(), 'eyeread-commit-'));
  try {
    await fetchCommit(repo, commit, join(work, 'repo'), ['--filter=tree:0']);
    return true;
  } catch (err) {
    if (err instanceof GitError) return err.cause === 'missing' ? false : null;
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
