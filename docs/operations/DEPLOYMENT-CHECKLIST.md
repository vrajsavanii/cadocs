# Deployment Checklist

Go-live / release gates for a production (non-demo) CADocs/NexAgent
deployment. Every unchecked box is a launch blocker unless the firm
explicitly accepts the documented risk in writing.

## 1. Code & build

- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes (persistence, storage, config, jobs, backup suites).
- [ ] `npm run build` succeeds on the deployed build pipeline.

## 2. Environment configuration (secret store — never in code/chat)

- [ ] `CA_DATA_DIR` — absolute path to a persistent volume mounted at runtime.
- [ ] `SESSION_SECRET` — ≥ 32 random chars (recommended; else the key file must
      persist on the volume).
- [ ] `FIELD_ENCRYPTION_KEY` — ≥ 32 random chars, set from day one. ⚠️ Setting
      this *after* client data exists requires the documented re-encryption
      procedure; never rotate without it.
- [ ] `CRON_SECRET` — random string; the scheduler must send it as a Bearer
      token.
- [ ] `CA_STORAGE_PROVIDER` — `local` (default) or `r2`.
- [ ] If `r2`: `CA_R2_ACCOUNT_ID`, `CA_R2_ACCESS_KEY_ID`,
      `CA_R2_SECRET_ACCESS_KEY`, `CA_R2_BUCKET` all set; bucket versioning
      enabled; private (no public object ACL).
- [ ] `CA_ALLOW_EPHEMERAL` **unset** on any real deployment.
- [ ] `CA_DEMO_SEED` unset (no synthetic practice data in real deployments).

## 3. Migrations & first boot

- [ ] First boot of the release ran with the real `CA_DATA_DIR`; boot did not
      throw a configuration error.
- [ ] `GET /api/health` → 200 with `storage_config: persistent`,
      `object_storage.ok: true`, `migrations.pending: 0`.

## 4. Storage

- [ ] Upload a test document through the UI (every role that needs it);
      confirm it downloads intact and appears in `file_versions`.
- [ ] Replace the document: previous version still present in the ledger.
- [ ] Delete the test document: object + all versions gone; document back to
      `Pending` (audit entry recorded).
- [ ] Upload of a disallowed extension and an oversized file are rejected.

## 5. Auth & roles

- [ ] Login works; every protected page/API redirects or 401s signed-out.
- [ ] Article-role session cannot reach partner/manager-only actions
      (filing, deletion of records with financial effect).

## 6. Scheduler

- [ ] Cron hits `/api/cron/automation` with the Bearer secret; unauthenticated
      calls are 401.
- [ ] The sweep's run history (automation_runs) updates on each scheduled run.

## 7. Backups — the gate most often skipped

- [ ] Scheduled backup configured on the volume host; first run produced a
      manifest with `files` ≥ current uploads.
- [ ] `npm run backup:verify -- --backup <dir>` **PASSed** on the latest
      snapshot (integrity ok, foreign keys ok, counts match, checksums ok).
- [ ] Scheduled alerting on backup failure/staleness configured.
- [ ] Backup bundle encryption + off-site copy location agreed and recorded.

## 8. Data migration (when moving an existing practice)

- [ ] [DATA-MIGRATION-RUNBOOK](./DATA-MIGRATION-RUNBOOK.md) steps executed;
      row counts and file hashes verified.
- [ ] Cutover authorised by the operator; health check repeated on the new
      volume.

## 9. Post-release monitoring

- [ ] `/api/health` monitored externally (alert on 503/degraded).
- [ ] A "get paid" smoke note: verify an invoice created + recorded payment in
      the first week reconciles to expectations.

## 10. Records hygiene

- [ ] No real client data in the repository, tests, or logs; `.data/` and
      `.backups/` are git-ignored.
- [ ] Any test/demo content is clearly synthetic.
