# Phone login and WhatsApp password recovery

- Login requires international phone + password; no customer email required. Existing internal Supabase email identities remain unchanged.
- `/login/recover` opens WhatsApp with `recuperar contraseña`. The user sends it from their registered number. This opens the 24h service window without a new Meta template.
- The signed Kapso webhook resolves ONLY the envelope sender's profile. Recovery precedes agency/other-role routing and works even when general auto replies are disabled.
- Supabase Admin `generateLink(type: recovery)` creates a native expiring/single-use link without sending email, including for `@phone.tero.local` accounts.
- Link token is in the fragment, removed on mount, never persisted in the tero inbox. Provider/recipient still necessarily see the delivered link. Never log it.
- Form POST validates password bounds, verifies recovery proof with an isolated anon Supabase client, updates password and revokes refresh sessions. It creates no browser session; user returns to phone login. A failed password save consumes the token; UI prompts to request another.
- Maximum three attempts in ten minutes per sender, counted in existing `whatsapp_messages`. Unique synthetic external_id claims prevent replay minting; no SQL migration. Markers do not contain tokens.
- Webhook fails closed without `KAPSO_WEBHOOK_SECRET`. Recovery requires the configured `WHATSAPP_PHONE_NUMBER_ID`. Optional `WHATSAPP_RECOVERY_PHONE` defaults to `59842772169`; ensure it is the human-facing number associated with that ID.

## Verification

`npx tsx --test src/lib/auth/password-recovery-policy.test.ts src/lib/whatsapp/send-policy.test.ts`

`psql <isolated-database> -f scripts/test-password-recovery.sql` (schema preloaded; transaction rolled back)

`npm run lint`, `npx tsc --noEmit`, `npm run build`.

Before production activation, verify a designated test account end to end: WhatsApp request, link delivered, new password, old password rejected, token reuse/expiry rejected, unknown phone and duplicate webhook. No real user password may be changed as a test. This check has not yet been performed. The current local checks do not prove Kapso delivery or Supabase's configured expiry.
