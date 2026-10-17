# Contributing

Thanks for helping. A few rules keep the lab easy to trust:

- **Measure drawing changes.** Save a baseline first (`npm run characterlab -- score --save=out/base.json`), make the change,
  then `npm run characterlab -- score --compare=out/base.json`. Say in the pull request which variants moved and by how much. A
  change to the engine that is not meant to change any drawing should show `0 changed`.
- **Run the tests.** `npm test` runs the engine's tests and every pack's own tests; it must pass.
- **The engine names no character.** Anything specific to one character belongs in its pack (`packs/<id>/`); shared
  looks go in a materials pack. New renderer features are opt-in: an op without the new field draws exactly as before.
- **Packs carry their own tests** (at least `checkPack`, see `packs/README.md`) and their own license. Reference sheets
  must be yours to publish: say where they come from in the pack.
- **Small pull requests**, one concern each, with a short description of what changed and why.

Bugs and ideas: open an issue with the page, the variant id and what you saw (a screenshot from
`npm run characterlab -- shot` helps).

By contributing you agree that your contribution is licensed under the project's MIT license (packs under the license
their `pack.json` names).
