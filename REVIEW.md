# Review checklist

What a maintainer checks before signing a pack version. CI has already
checked the mechanics (the zip, the pack hash, the tag and commit, and that
the source builds to the same pack). This is the human part.

The standard is the [content policy](https://github.com/omniship-labs/eyeread.in/blob/main/PACK_POLICY.md).
It applies to Verified packs only.

**Target: 2 weeks** from a green CI run to a decision.

## First version of a pack

Read all of it. Most packs are one small `main.js`.

- [ ] **Honest identity.** The name, description, author and icon say what the
      pack is and who made it. It doesn't pose as another person, company,
      product or pack, or claim to be official or made by OmniShip. _(Policy 2)_
- [ ] **Trademarks.** Other people's marks are used only to say what the pack
      works with, not to suggest they made or endorse it. The same goes for the
      eyeread.in and OmniShip names and logos. _(Policy 3)_
- [ ] **No hidden live-answer feed.** The pack doesn't listen to a
      conversation, meeting, interview, exam or call and feed generated answers
      into the prompter while it happens, and isn't built to hide that from the
      other people in it. Writing, importing or editing a script ahead of time
      is fine, with or without AI. _(Policy 1)_
- [ ] **Readable code.** You can follow everything it does. No encoded or
      encrypted payloads, no strings built up to hide URLs or API calls, and no
      code downloaded and run at runtime. _(Policy 4)_
- [ ] **Permissions fit the description.** Each permission is used, and needed
      for what the description says.
- [ ] **Network use is declared.** Every site it talks to is in its manifest,
      the description says what it sends there and why (script text counts),
      and it sends nothing more. _(Policy 5)_
- [ ] **No tracking.** No analytics, tracking, advertising or fingerprinting,
      even to a declared site, and no selling or sharing users' data. _(Policy 5)_
- [ ] **No hidden functionality.** It does what the description and manifest
      say and nothing else, and follows the terms of any service it connects
      to. _(Policy 6)_
- [ ] **Paid features, if any.** The description says what's free, what's paid
      and where to buy. Any license or payment check is readable code in the
      pack, and any server it calls is a declared site. _(Policy 7)_
- [ ] **Nothing illegal or harmful**, and nothing that breaks the
      [Terms of Use](https://github.com/omniship-labs/eyeread.in/blob/main/TERMS.md).
- [ ] **Bundles:** every included pack passes this list too.

## Updates to a Verified pack

Review the diff CI posts and the linked source diff, not the whole pack.

- [ ] Every **new permission** and **new network site** is justified by the
      description, and the description is updated to match.
- [ ] Changed manifest fields (name, author, description, pricing, settings)
      still pass the identity, trademark and paid-feature checks above.
- [ ] Changed and added code passes the readable-code, network, tracking and
      hidden-functionality checks above.

## Deciding

- **Changes needed:** say what and why on the pull request, citing the policy
  section. The creator pushes a fix, or opens a new release and updates the
  entry.
- **Approved:** approve the pull request, then sign on the signing machine and
  commit `files.json.minisig` next to the entry. Signing never happens in CI.
  See the app's [docs/PACKS.md](https://github.com/omniship-labs/eyeread.in/blob/main/docs/PACKS.md#verified-packs-maintainers).
- **Rejected:** close the pull request with the reason. The creator can still
  share the pack as a Community pack.
