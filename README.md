# eyeread.in packs

The list of reviewed pack versions for [eyeread.in](https://github.com/omniship-labs/eyeread.in),
and OmniShip's signature for each one. A signed version shows in the app as
**✓ Verified by eyeread.in**.

Packs stay in their creator's own repository, under any license the creator
chooses. This repo stores only a reference to each reviewed version and the
signature for it (about 400 bytes). None of the creator's code is hosted here.

Anyone can still share a pack without this repo. Unreviewed packs install as
Community packs: users see a warning and have to accept the risk first.

## Layout

One folder per version:

```
packs/
└── com.example.notion-sync/
    ├── 1.1.0/
    │   ├── entry.json            where the source and zip are
    │   └── files.json.minisig    OmniShip's signature, added after approval
    └── 1.2.0/
        └── entry.json            waiting for review
```

### `entry.json`

```json
{
  "$schema": "../../../schema/entry.schema.json",
  "repo": "https://github.com/ada/notion-sync",
  "tag": "v1.2.0",
  "commit": "3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  "path": ".",
  "url": "https://github.com/ada/notion-sync/releases/download/v1.2.0/com.example.notion-sync-1.2.0.zip",
  "mirrors": [],
  "packHash": "9b1f…64 hex characters…"
}
```

| Field       | Required | What it is                                                                                  |
| ----------- | -------- | ------------------------------------------------------------------------------------------- |
| `repo`      | yes      | The pack's public git repository, as an `https://` URL.                                     |
| `tag`       | yes      | The release tag for this version, for example `v1.2.0`.                                     |
| `commit`    | yes      | The full 40-character commit SHA the tag points to.                                         |
| `path`      | yes      | The pack folder in the repo: `.` for the root, or a relative path like `packs/notion-sync`. |
| `url`       | yes      | Where the app downloads the zip. See the rules below.                                       |
| `mirrors`   | no       | Up to 4 more URLs serving the same zip, under the same rules.                               |
| `packHash`  | yes      | The pack hash `eyeread.in-packs build` prints.                                              |
| `withdrawn` | no       | `{ "date", "reason" }`. Set by maintainers only.                                            |

The full schema is [`schema/entry.schema.json`](schema/entry.schema.json). The
folder names must match the pack's `id` and `version` in `pack.json`.

### Rules for the zip URL

- `https://`, public, with no login, cookies or "click to download" page. It
  returns the zip directly. Redirects are fine.
- One URL per version that never changes. No `/releases/latest/…`.
- At most 20 MiB. No IP addresses, `localhost` or private networks.
- Any host is fine. The app checks the pack hash and signature, so a host
  serving the wrong file only causes a failed install.

A GitHub release asset
(`https://github.com/<you>/<repo>/releases/download/<tag>/<file>.zip`) meets
all of these.

## Submitting a pack

1. **Build and release.** In your pack's repo, run

   ```bash
   npx @omniship-labs/eyeread.in-packs validate
   npx @omniship-labs/eyeread.in-packs build
   ```

   Publish a release for the version's tag and attach the zip `build` wrote.
   Note the pack hash `build` printed.

2. **Open a pull request** here adding
   `packs/<id>/<version>/entry.json`. One version per pull request. Don't add
   `files.json.minisig`; maintainers add that.

3. **CI checks it** (below) and comments on the pull request. Fix anything it
   reports by pushing to the same pull request.

4. **A maintainer reviews it** against the [review checklist](REVIEW.md) and
   the [content policy](https://github.com/omniship-labs/eyeread.in/blob/main/PACK_POLICY.md).
   We aim to finish within **2 weeks**. Updates to a Verified pack get a
   diff-only review.

5. **After approval** the maintainer signs the same zip on an offline machine
   and commits `files.json.minisig` next to your entry. Signing never happens
   in CI.

6. **Optionally**, add that signature to your zip as `files.json.minisig` and
   re-upload it, so copies people install by hand also show as Verified. The
   pack hash doesn't change.

## What CI checks

On every pull request that adds a version:

- `entry.json` matches the schema, and its folder is a valid pack id and version.
- The zip downloads under the URL rules, validates exactly as the app's
  installer would, and its pack hash matches `packHash`. So does every mirror.
- The tag points at `commit`, and building `path` at that commit gives the same
  pack hash. `build` produces the same zip every time from the same source, so
  the zip is exactly what the source says.
- A summary of what the pack asks for. For an update, it also lists what changed since the last
  Verified version: new permissions, new network sites and other manifest
  changes are highlighted, with the changed files and a link to the source diff.

CI never runs the pack's code, and nothing from the creator's repo is executed.

## Staying Verified

A daily job downloads every Verified version and checks its pack hash. Any
mirror serving the right hash counts. It also checks that the tag and commit
still exist.

| What happens                                    | Result            |
| ----------------------------------------------- | ----------------- |
| Unreachable for 3 days in a row                 | Withdrawn         |
| The tag or commit is gone, or the tag has moved | Withdrawn         |
| The zip serves a different pack hash            | Withdrawn at once |

Failures are tracked as issues labelled `reachability`. A version to withdraw
also gets the `withdraw` label, and a maintainer withdraws it: they mark the
entry `withdrawn` and add an "unverify" entry to the app's signed revocation
list. The pack leaves the catalog, and installed copies show as Community with
the reason ("Source no longer available"). They aren't blocked.

To keep your pack Verified, don't delete or re-tag its releases.

## Working on this repo

```bash
npm install
git clone https://github.com/omniship-labs/eyeread.in-packs-sdk ../eyeread.in-packs-sdk
(cd ../eyeread.in-packs-sdk && npm ci)
export SDK_DIR=../eyeread.in-packs-sdk

npm test                     # unit tests
npm run format:check         # Prettier; CI fails on formatting
node scripts/check-submission.mjs --pr . --base origin/main   # check this branch's new versions
node scripts/reachability.mjs                                 # dry run, no issues touched
```

CI pins the SDK to one commit in
[`.github/actions/setup-sdk`](.github/actions/setup-sdk/action.yml).
