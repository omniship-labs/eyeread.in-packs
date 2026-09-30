<!--
Submitting a pack version? Add only packs/<id>/<version>/entry.json, one
version per pull request. See README.md for the format and the zip URL rules.
-->

## Pack

- **Pack:** <!-- id@version, e.g. com.example.notion-sync@1.2.0 -->
- **What it does:** <!-- one or two sentences -->
- **Update to a Verified pack?** <!-- yes/no. If yes, what changed and why -->

## Before you submit

- [ ] `npx @omniship-labs/eyeread.in-packs validate` passes on the pack folder.
- [ ] The zip is attached to a release for the tag, from
      `npx @omniship-labs/eyeread.in-packs build` at the commit in `entry.json`.
- [ ] `packHash` is the hash `build` printed.
- [ ] The zip URL downloads directly, is `https://`, and will never change.
- [ ] I've read the [content policy](https://github.com/omniship-labs/eyeread.in/blob/main/PACK_POLICY.md),
      and the description says every site the pack sends data to, what it sends and why.
- [ ] If anything is paid, the description says what's free, what's paid and where to buy.

<!--
Reviewers: work through REVIEW.md. CI has already checked the zip, the pack
hash, and that the source at the commit builds to the same pack.
-->
