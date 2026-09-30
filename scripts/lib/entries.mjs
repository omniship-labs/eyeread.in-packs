// Reading the entries in packs/<id>/<version>/.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import semver from 'semver';

export const ENTRY_FILE = 'entry.json';
export const SIGNATURE_FILE = 'files.json.minisig';

// The same rules as pack.json's `id` and `version` (the SDK's pack.schema.json).
const ID_RE =
  /^(?=.{3,100}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const ENTRY_PATH_RE = /^packs\/([^/]+)\/([^/]+)\/([^/]+)$/;

const schema = JSON.parse(
  await readFile(new URL('../../schema/entry.schema.json', import.meta.url), 'utf8')
);
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/** Split `packs/<id>/<version>/<file>`, or null if a path isn't in that shape. */
export function parseEntryPath(path) {
  const m = path.match(ENTRY_PATH_RE);
  return m ? { id: m[1], version: m[2], file: m[3] } : null;
}

/** Problems with where an entry lives: the folder names must be a valid id and version. */
export function locationProblems(id, version) {
  const problems = [];
  if (!ID_RE.test(id)) problems.push(`"${id}" isn't a valid pack id`);
  if (semver.valid(version) !== version || version.includes('+') || version.length > 64)
    problems.push(`"${version}" isn't a valid pack version`);
  return problems;
}

/** Parse and schema-check an entry.json's text. */
export function parseEntry(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { problems: [`entry.json isn't valid JSON (${err.message})`] };
  }
  if (!validateSchema(value)) {
    return {
      problems: validateSchema.errors.map(
        (e) => `entry.json${e.instancePath ? ` ${e.instancePath}` : ''} ${e.message}`
      ),
    };
  }
  return { entry: { mirrors: [], ...value }, problems: [] };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every version of every pack under `root/packs`, with whether it's signed.
 * Entries that fail to parse are returned with their problems.
 */
export async function listEntries(root) {
  const packsDir = join(root, 'packs');
  const out = [];
  let ids = [];
  try {
    ids = await readdir(packsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const idDir of ids
    .filter((d) => d.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const versions = await readdir(join(packsDir, idDir.name), { withFileTypes: true });
    for (const vDir of versions.filter((d) => d.isDirectory())) {
      const dir = join(packsDir, idDir.name, vDir.name);
      const entryPath = join(dir, ENTRY_FILE);
      if (!(await exists(entryPath))) continue;
      const { entry, problems } = parseEntry(await readFile(entryPath, 'utf8'));
      out.push({
        id: idDir.name,
        version: vDir.name,
        entry,
        problems,
        signed: await exists(join(dir, SIGNATURE_FILE)),
      });
    }
  }
  return out;
}

/** Verified = signed and not withdrawn. */
export function isVerified(e) {
  return e.signed && e.entry && !e.entry.withdrawn;
}

/** The highest Verified version of `id` below `version`, or null. */
export function previousVerified(all, id, version) {
  const candidates = all
    .filter((e) => e.id === id && isVerified(e) && semver.valid(e.version))
    .filter((e) => semver.lt(e.version, version))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  return candidates[0] ?? null;
}
