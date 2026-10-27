# Production Environment

Reference for deploying NexAgent/CADocs as a real (non-demo) practice system.
Variable names are documented here; **values must live in the hosting
provider's secret store** (Vercel project env, Sites → Secrets, or the
equivalent) — never in chat, code or the repository.

## Mandatory for any real deployment

| Variable | Meaning | Failure mode if wrong |
| --- | --- | --- |
| `CA_DATA_DIR` | Absolute path to a **persistent volume** holding `ca-suite.db`, keys, uploads. | Process refuses to boot when it would otherwise be ephemeral. |
| `SESSION_SECRET` | ≥ 32-char random string; HMAC key for the auth cookie. Recommended in production so sessions survive re-provisioning and identical across instances. | falls back to a generated key file in `CA_DATA_DIR` (persistent, but per-volume). |
| `FIELD_ENCRYPTION_KEY` | ≥ 32-char random string; AES-256-GCM key for PAN/GSTIN/TAN columns. Same recommendation. | falls back to the key file; rotating wrongly makes old ciphertext unreadable — reversing a rotation without re-encryption is the exact "do not rotate without a procedure" case. |
| `CRON_SECRET` | Bearer token for the automation sweep. | cron unauthenticated (it still only runs enabled rules). |

Generating a key (run locally, paste into the provider's secret UI):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Storage topology rules (enforced at boot)

- On serverless hosts (Vercel et al. — `VERCEL` set), a *persistent*
  `CA_DATA_DIR` is mandatory. If the path resolves under `/tmp` (or any
  ephemeral location) and `CA_ALLOW_EPHEMERAL` is not `1`, startup throws with
  an actionable message — this is deliberate: the system must never silently
  write client records where cold starts wipe them.
- Demo installs: set `CA_ALLOW_EPHEMERAL=1` and accept that data resets on
  cold start and isn't shared between instances. Health reports
  `storage_config: demo-ephemeral`.
- `CA_DEMO_SEED=1` seeds a synthetic practice database in an empty persistent
  production store. It should stay unset for real deployments; development
  machines seed automatically.
- `CA_STORAGE_PROVIDER=local` (default) keeps uploads on the volume under the
  data dir. `CA_STORAGE_PROVIDER=r2` stores uploads in Cloudflare R2 and
  additionally requires `CA_R2_ACCOUNT_ID`, `CA_R2_ACCESS_KEY_ID`,
  `CA_R2_SECRET_ACCESS_KEY`, `CA_R2_BUCKET` — all four are validated at boot.
  Until provider accounts for R2 are provisioned, use `local` on a
  volume-backed process.

## Runtime assumptions

- Node.js ≥ 24 (`node:sqlite` is part of the runtime; the platform must not be
  an edge-only runtime for tool-bearing routes).
- One long-lived process (or single-writer) owns the SQLite file. Multiple
  *read-only* replicas of the same volume are safe; concurrent writers across
  machines are not a supported topology for SQLite — that's the declared
  boundary where Postgres becomes the correct engine (see
  [DATABASE.md](../architecture/DATABASE.md)).
- The data directory must allow 0600 files and be excluded from code deploys
  (it is: `.data/` is build-ignored; a mounted volume never ships in the
  bundle).

## Safe configuration self-checks

`GET /api/health` (unauthenticated) reports booleans only:

- `components.database.ok` — SQLite reachable and settings readable;
- `components.storage_config` — `persistent` vs
  `demo-ephemeral (CA_ALLOW_EPHEMERAL=1)`;
- `components.object_storage.ok` — provider reachable (read probe);
- `components.migrations` — applied ledger versions + pending count;
- `components.background_jobs` — pending/running/dead counts.

Any `503` during a real deployment must be fixed before client traffic.
Status `degraded` never discloses credentials, absolute paths, SQL errors or
client data.

## Scheduler

Cron must hit `GET /api/cron/automation` with `Authorization: Bearer
$CRON_SECRET` on the deployment's schedule (sample cadence is documented in
the automation docs). Vercel Cron markers are accepted when configured
through the host's cron feature.
