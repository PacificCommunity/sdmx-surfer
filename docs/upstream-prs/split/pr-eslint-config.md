In rc.1, `npm run lint` fails before it checks any file because there is no ESLint configuration to load. This PR adds the Vite-template config and fixes the existing findings, so `npm run lint` (with `--max-warnings 0`) passes. There is no behaviour change.

Part of {{TRACKING_ISSUE}}.

**Depends on:** nothing.

Commit: 3d03973 Add an ESLint config so npm run lint runs

## Changes

- `.eslintrc.cjs` (new): `eslint:recommended`, `@typescript-eslint/recommended`, `react-hooks/recommended`, and `react-refresh/only-export-components` (warn, `allowConstantExport`). `ts-ignore` is allowed with a description, and `^_` is ignored for unused vars/args. It ignores `dist`, `node_modules` and `.github`. All plugins were already devDependencies.
- Existing findings fixed in 13 files under `lib/` and `src/`:
  - file-level `no-explicit-any` opt-outs where the code already uses `any`;
  - `let` changed to `const`;
  - an unused `className` binding renamed to `_className`;
  - descriptions added to `// @ts-ignore` on the `sdmx-json-parser` import;
  - an empty `catch (e) {}` turned into a commented `catch {}`;
  - `exhaustive-deps` opt-outs, with a comment where the omission is intentional (in `text/index.tsx`, adding the style states to the dependencies would loop).

## Behaviour changes vs rc.1

None. The edits do not change behaviour: they are declarations, comments and `const`.

## Tests

`npm test` on the branch: 2 files, **8 passed** (unchanged; no tests added). `npm run lint`: exit 0 on this branch. On rc.1 and on the branches without this config, it exits 2.

## Notes

- **Textual conflicts with siblings.** The lint edits touch `map/index.tsx`, `value/index.tsx`, `parseDataExpr.tsx` and `parseTextExpr.tsx`. Those files are also edited by {{PR:pr/no-accept-header}} (in `parseDataExpr.tsx`) and by {{PR:pr/error-contract}} and every PR built on it. Whichever lands second needs a small rebase. The other PRs were written without these lint edits ("keeps main's lint state" in their commit messages), so after this PR merges they will be rebased and re-linted. The resolved combination is on `surfer-integration` (merge 72b541f onwards), where `npm run lint` exits 0.
- Independent leaf: it can be merged first.
