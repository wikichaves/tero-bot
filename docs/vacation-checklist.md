# Vacation checklist

> Last verified: 2026-05-27 — branch protection + cron alerts + 1Password backup en su lugar.

Corré este checklist antes de cualquier ausencia larga (>2 semanas). El objetivo: que el bot siga sirviendo a los huéspedes y el `claude-worker` corra contenido durante tu absencia, sin que algo expire silenciosamente.

## 1. Credenciales que pueden expirar

| Credencial | Dónde mirar | Qué chequear | Cómo renovar |
|---|---|---|---|
| **Tuya IoT cloud project** | [iot.tuya.com](https://iot.tuya.com) → Cloud → Development → proyecto | Subscription end date. Trial gratis dura **1 año** — si vence, snapshots de energía/sensores fallan en cascada | "Renew" / upgrade a plan pago |
| **Dominio `tero.bot`** | Tu registrar (Cloudflare/Namecheap/etc) | Auto-renew **ON** + expiration > 4 meses | Activar auto-renew, payment method al día |
| **Meta WhatsApp Business token** (vía Kapso) | [kapso.ai](https://kapso.ai) → Connections | Que la conexión a Meta diga "Active" | Re-auth desde Kapso |
| **Vercel billing** | [vercel.com/account/billing](https://vercel.com/account/billing) | Payment method válido + plan vigente | Update card |
| **Supabase billing** | Project → Billing | Payment method válido (Pro+) | Update card |
| **Linear API token** (en GH Secrets) | [linear.app](https://linear.app)/wikichaves/settings/api | Si tiene "Expires at" seteado, fecha > 4 meses | Regenerar + actualizar GH secret `LINEAR_API_TOKEN` |
| **Anthropic API key** (en GH Secrets) | [console.anthropic.com](https://console.anthropic.com) → API Keys + Billing | Saldo / credit card al día | Recargar |

## 2. Credenciales que NO expiran (referencia)

Si querés rotar igual antes de irte, está bien — pero ninguna de estas se cae por su cuenta:

- `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWTs sin expiración salvo que rotes el JWT secret del proyecto)
- `TELEGRAM_BOT_TOKEN` (permanente hasta `revokeToken` en @BotFather)
- `POSTMARK_INBOUND_USER` / `_PASSWORD`
- `DATABASE_URL`

## 3. Backup de secrets

Antes de irte, asegurate de tener el backup actualizado en 1Password:

```bash
npm run op:backup-env -- --include-vercel
```

Crea/actualiza dos Secure Notes en tu vault:
- `tero-bot — .env.local (dev)`
- `tero-bot — Vercel production env`

Si todavía no está configurada la CLI de 1Password: abrir la app → Settings → Developer → tildar "Integrate with 1Password CLI". Después `op signin` (o nada — la integración con la app lo resuelve solo).

## 4. Verificar que las alertas funcionan

Los crons (`src/app/api/cron/*`) están wrappeados con `withCronAlerts` (ver [src/lib/util/cron-alert.ts](../src/lib/util/cron-alert.ts)) y mandan un mensaje a tu Telegram personal si fallan.

Confirmar que `TELEGRAM_ADMIN_CHAT_ID` está seteado en **Vercel production env** (no solo en local). Si no está, los alerts no se mandan pero los crons siguen corriendo igual.

## 5. Mental note del worker autónomo

`claude-worker.yml` corre todos los días a las 14:00 UTC (11:00 AR). Levanta el siguiente ticket con label `claude:autonomous`, escribe código y abre un PR — **no auto-mergea**. Si querés pausarlo del todo durante las vacaciones, comentá el bloque `schedule` en `.github/workflows/claude-worker.yml` (o sacá la label `claude:autonomous` de todos los tickets en Todo).

Las reglas para el worker durante vacaciones están en [CLAUDE.md](../CLAUDE.md) sección "Vacation mode".

## 6. Branch protection en `main`

Verificar que esté activa antes de irte (instrucciones en el header de [.github/workflows/ci.yml](../.github/workflows/ci.yml)). Sin esto, un PR del worker puede ir directo a `main` sin pasar por CI.

## Quick run

Pre-vacaciones, en orden:

- [ ] Tuya: subscription > 4 meses
- [ ] Dominio: auto-renew ON, expiration > 4 meses
- [ ] Kapso: conexión a Meta "Active"
- [ ] Vercel: payment method al día
- [ ] Supabase: payment method al día (si Pro+)
- [ ] Linear PAT: expiration > 4 meses (o no seteado)
- [ ] Anthropic: saldo > $50
- [ ] `npm run op:backup-env -- --include-vercel`
- [ ] `TELEGRAM_ADMIN_CHAT_ID` seteado en Vercel prod
- [ ] Branch protection en `main` ON
- [ ] (Opcional) Pausar `claude-worker` schedule
