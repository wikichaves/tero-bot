# Telegram expense intake

Ops bot only; the dev bot is unchanged. Existing sender-profile authorization
(admin/gestor) runs before any download or write.

- `gasto Ferretería UYU 1500` or `/gasto Ancap USD 120`.
- Caption the receipt with the same command; JPEG, PNG and PDF up to 10 MB.
- A receipt alone in a private chat creates a draft. No OCR.
- In groups, an explicit expense command is required. Mention syntax is accepted.
- `Subir gasto` or `/gasto` without details returns instructions, not an empty row.
- Country defaults to UY, like WhatsApp; select the property/country in the web UI.
- Edited messages do not create expenses. Unique `telegram:<chat>:<message>` IDs
  deduplicate webhook retries and concurrent inserts.
- Receipts live in a private bucket, served via an authenticated short-lived URL.
  Telegram token-bearing URLs are never persisted.

## Rollout (manual owner review required by AGENTS.md/CODEOWNERS)

1. Review the PR, especially webhook, schema and receipt access.
2. Apply only the **Telegram expense receipts** section of `supabase/schema.sql`
   to the verified target database, before deploying. Use a transaction. It expands
   `expenses_source_check` and creates the private `expense-receipts` bucket.
   Never replay the full schema as part of this change.
3. Merge/deploy and verify the production deployment's commit and readiness.
4. As a registered admin/gestor, send a text expense, then a receipt with caption.
   Verify the amount, source=telegram, sender, review state and receipt access.
   Repeat the identical webhook update: verify exactly one row. Editing the
   Telegram message must not create another row. Test an unauthorized sender.
5. Remove only explicitly identified test expenses/receipts after verification.

## Verification

- `npx tsx --test tests/telegram-expenses.test.ts`
- `npm run lint`
- `npm run build`

Local tests cover parsing/routing only, not live DB/storage or Telegram delivery.
No DB mocks. A production expense has not been created by these tests.

## Failed inserts after upload

The deterministic object key is retained when a DB write fails, so a retry can
recover it safely. Do not delete immediately on a failed insert: a concurrent
delivery may have committed a row referencing it. If an update is permanently
abandoned, an operator should remove its unreferenced object after checking
`expenses.source_message_id`. Automatic orphan cleanup is not implemented.
