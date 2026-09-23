# Final Files patch: independent-context review and Linux check

**Scope:** Workbench `960079f` (owned Files); pinned PI WEB fork `e7ab4e57` (descriptor-pinned reads/listing). This supplements, but does not rewrite, the [earlier cross-family security review](owned-files-security-review-2026-09-23.md), which examined older revisions.

## Fresh read-only review

A fresh reviewer Pi (`openai-codex/gpt-6-luna`, investigation/reviewer profile) read the final file read/list services, path-policy/safety helpers, their tests, and Workbench `files.mjs`/tests without editing. The authoring lead used `openai-codex/gpt-6-sol`: this review has **separate context, not a different model family**. The reviewer ran `node --test apps/workbench-web/files.test.mjs` (6 passed); it did not run the PI WEB tests. Two attempted fresh Anthropic reviews did **not** produce a substantive result (one subagent completed without text; a direct read-only Pi CLI call timed out at 300 seconds with zero output). Do not call either attempt a security sign-off.

The substantive reviewer found no confirmed post-fix path escape, read availability, versioning or draft-loss defect in the examined paths. **One low-severity discovery limitation remains:** `../pi-web/src/server/workspaces/fileTreeService.ts:39-44` stops after the first 1,001 entries returned by `os.scandir`, then sorts (`:61-65`). In a directory with more than 1,000 entries, a subdirectory outside that initial enumeration is not reachable through the Files tree; the response explicitly marks the list truncated and the owned UI reports that entries are missing. This is not a confinement escape. Project-defined external-root access is still the owner's pending policy decision; the reviewer did not approve widening it.

## Author's additional verification (not independent review)

```sh
cd ../pi-web
npm test -- src/server/workspaces/fileTreeService.test.ts src/server/workspaces/fileContentService.read.test.ts src/server/workspaces/fileContentService.write.test.ts src/server/workspaces/projectPiWebConfig.test.ts
npm run typecheck
```

Result: four test files, **59/59 passing**, and TypeScript check passing. The broader owned client check at Workbench `23994dd` passed **73/73** Node tests and **64/64** isolated browser assertions; the latter covered real Files read, versioned save, conflict, confinement and inert text. This does not prove a concurrent race cannot occur or replace installed Files acceptance.

For Linux portability, the author extracted the actual `listFromDescriptor` Python source with:

```sh
../pi-web/node_modules/.bin/tsx -e 'import { listFromDescriptor } from "./../pi-web/src/server/workspaces/fileTreeService.ts"; import { writeFileSync } from "node:fs"; writeFileSync("/tmp/pi-owned-list-linux.py", listFromDescriptor)'
```

SHA-256 of that generated source: `9cfdc210d49444417a00801b7d5e3e99f7c6ead3ce0c4b36b940d6bcffab0362`. It was mounted read-only into a `--rm --network none --read-only --cap-drop=ALL --security-opt=no-new-privileges` Docker container (`localstack/localstack:3.0`, image ID `sha256:5288c3f97042b291afcf455644dc53fca835c3a4c2a4140567b4accdc673934b`; Python 3.11.6), with a 16 MiB writable `/tmp` tmpfs. A Python subprocess invoked `/mnt/list.py /tmp/workspace nested` after creating a regular file and a symlink: `os.scandir(fd)` returned the file and identified the symlink without following it. Replacing `nested` with a symlink to `/etc` caused `NotADirectoryError` (no redirected listing). After creating 1,002 further files, the script emitted exactly **1,001** rows (the backend trims to 1,000 and marks truncation). No network, host workspace write or live daemon was used.

**Still required before daily use:** Thomas's external-root policy decision, attended installed/native Files interactions and explicit daily-use acceptance. The Linux check covers descriptor listing on one Python/runtime image, not every Linux distribution or full API route. The same-family fresh review does not constitute cross-family post-fix sign-off.
