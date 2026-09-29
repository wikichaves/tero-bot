# Integration resilience rollout

Status: code validated locally; not deployed. No live WhatsApp or email was sent for testing.

## Changes

- Central free-text/image guard requires a recent customer message using the provider event timestamp, not webhook arrival time. Unknown windows fail closed; sending a template does not reopen the window.
- Task assignments use `staff_task_assigned_v2` (es). Task status and energy reports use the new templates below.
- WhatsApp POSTs time out after 15 seconds. Only explicit Meta error 132001 permits language fallback. A successful HTTP response without a message ID is uncertain, not delivered. Accepted messages still require delivery webhooks.
- Unexpected inbound email processing failures return 503, not a false success. Audit rows distinguish received from completed, allowing interrupted processing to retry.
- Failed bill writes/uploads and partial bill batches remain retryable. Existing domain deduplication is preserved.
- The existing inbound-purge cron retains unfinished Airbnb audit records and alerts through its existing wrapper on unfinished email processing older than one hour. This is a daily watchdog, not immediate recovery.

## Activation order — required before merging/deploying

1. Obtain owner review: these integrations and schema are protected by repository CODEOWNERS. Do not auto-merge.
2. Using authenticated production administration, submit only the two new ES template definitions from `src/lib/whatsapp/templates.ts`: `staff_task_status_update_v1` and `daily_energy_report_v1`. Verify both are APPROVED and verify the existing `staff_task_assigned_v2` ES template and its five parameters. The bulk `--update` script would resubmit existing templates for approval; do not use it for this rollout. Production credentials/approval were not verified during this change; redacted environment exports are not credentials.
3. Apply only the incremental schema section against the verified target database:

   ```sh
   npm run db:apply -- --section "Inbound processing completion"
   ```

   Verify `processing_completed_at` exists in both inbound tables. Historical rows retain completed semantics; new handlers explicitly insert NULL until successful processing. Never replay all historical financial/cancellation emails blindly.
4. Verify on a real isolated database (no mocked DB): one repeated MessageID creates no duplicate bill/reservation/payout; an interrupted write and a partially completed multi-PDF batch can be retried; unavailable storage/database produces non-2xx; completed emails remain deduplicated. Concurrent retries are not a transactional exactly-once guarantee; review domain uniqueness before enabling bulk replay.
5. Deploy after review and prerequisites. Check authenticated cron responses and delivery webhooks. A real WhatsApp delivery test requires an explicitly authorized recipient/message; no test message was sent here. Verify both a closed service window template and an inbound reply within the window.
6. Reconcile any uncertain timeout or missing-message-ID result with provider logs before resending. A persistence failure after provider acceptance is also uncertain. This patch does not add a durable outbound outbox or exactly-once delivery.

Rollback: revert application commit if needed; leave the additive schema columns in place. Do not delete inbound audit records or blindly resend accepted messages. Investigate any unfinished audit rows before marking complete.

## Google access (verified 2026-09-27)

- Personal Calendar: target `wikichaves@gmail.com`, authenticate as `hola@casabosquemontoya.com`, client `default`. Calendar listing verified writer permission.
- Casa Bosque Gmail: labels listing succeeded.
- Personal Gmail: `invalid_grant`; requires the owner to reauthorize through Google. Casa Bosque Calendar delegation does not grant access to personal Gmail.
- After login, check the personal OAuth consent application's publishing status and scopes; Testing-mode external apps with Gmail scopes may expire refresh tokens after seven days. Publishing status was not verified. Request only needed scopes and verify refresh plus a read after authorization. Tokens may still be revoked; do not promise permanent connectivity.
- Do not collect secrets in chat. Do not replace the working Calendar account route while repairing personal Gmail.

## Validation

- 16 tests pass: WhatsApp send policy plus existing Airbnb payout parser tests.
- ESLint and full Next.js production build pass.
- No live database migration, Meta template submission/approval, deployment, OAuth repair or end-to-end delivery test performed.
