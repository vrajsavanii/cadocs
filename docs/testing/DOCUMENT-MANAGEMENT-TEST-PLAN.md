# Document Management Test Plan

**Status:** implemented and executed for Prompt 6. Runner: `npx vitest run`
(see [package.json](../../package.json)); test files live in [`tests/`](../../tests).

## Suites covering Prompt 6

| File | What it covers |
|---|---|
| `tests/documents.test.ts` | version-ledger upload/replace flow, review permissions (article forbidden, manager allowed), rejection reason enforcement, verify-before-received guard, checksum-verified legacy migration, migration idempotency/skips, need-classification flag, soft-archive + restore, queries/pagination, purge-bytes behaviour |
| `tests/storage.test.ts` | storage adapter round-trip, unique opaque keys, `objectKeyIsSafe` path-traversal rejection, delete |
| `tests/backup.test.ts` | backup integrity including `file_versions` ledger cross-check |
| `tests/persistence.test.ts` | DB rows survive re-open (documents table included) |
| `tests/recurrence.test.ts` | (Prompt 5) compliance tasks & checklists → keep passing |

## Cases from the roadmap and where they live

- **Storage**: upload success / storage failure / orphan cleanup — `documents.test.ts`,
  `storage.test.ts`. Integrity check on download — `documents.test.ts`.
- **Security**: unauthorized upload (`article` gets 403), rejection reason required,
  verify-before-received 409, `objectKeyIsSafe` traversal rejection,
  version-summary without object keys, audit records — `documents.test.ts`,
  `storage.test.ts`.
- **Organization**: FY label validation (`FY_LABEL` in classifyDocument), needs-
  classification flag, filtered + paginated queries, migration snapshot debate —
  `documents.test.ts`.
- **Versioning & review**: supersede-previous-version keeps history, a fresh upload
  resets review state, history rows are append-only, soft-delete + restore —
  `documents.test.ts`.
- **Migration & reliability**: legacy file missing on disk → `failed` without
  destroying the row; retry after migration is a `skipped`; checksum verification —
  `documents.test.ts`.

## Running

```bash
npx vitest run
```

Latest run: **10 files, 61 tests, all passing** (see [REPORT.md](../../REPORT.md)).

## Known gaps

- No automated test drives the browser UI (Next.js server components + DOM mutations
  are covered only indirectly through the route handlers).
- No test exercises the AI-assisted "suggest name & type" classifier against a real
  model — it is stubbed in tests.
