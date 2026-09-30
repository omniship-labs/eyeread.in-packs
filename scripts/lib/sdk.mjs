// The SDK's validate/build code, loaded from a checkout of
// omniship-labs/eyeread.in-packs-sdk (SDK_DIR). CI pins it to one commit in
// .github/actions/setup-sdk; switch to the npm package once it's published.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let loaded;

export async function loadSdk() {
  if (loaded) return loaded;
  const dir = process.env.SDK_DIR;
  if (!dir) throw new Error('SDK_DIR must point at a checkout of eyeread.in-packs-sdk');
  const src = resolve(dir, 'packages/eyeread.in-packs/src');
  const mod = (name) => import(pathToFileURL(resolve(src, name)).href);
  const [validate, build, errors] = await Promise.all([
    mod('validate.js'),
    mod('build.js'),
    mod('errors.js'),
  ]);
  loaded = {
    validateZipBuffer: validate.validateZipBuffer,
    buildPack: build.buildPack,
    PackError: errors.PackError,
  };
  return loaded;
}

/** A validated bundle as plain data: every pack's id, version, hash, manifest and files. */
export function describeBundle(bundle) {
  return bundle.all().map((pack) => ({
    id: pack.manifest.id,
    version: pack.manifest.version,
    packHash: pack.packHash,
    manifest: pack.manifest,
    files: pack.files.files,
  }));
}
