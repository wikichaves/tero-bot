# Spike: integración con WhatsApp para Acme Rentals

**Status:** propuesta · esperando confirmación para arrancar setup
**Ticket origen:** [WIK-15 — Admin MVP](https://linear.app/example/issue/WIK-15/admin-mvp)
**Fecha:** mayo 2026

## 1. Contexto y casos de uso

Acme Rentals alquila propiedades vía Airbnb / Booking. Tres
audiencias distintas, mismo canal:

| Audiencia | Mensajes outbound (admin → ellos) | Mensajes inbound (ellos → admin) |
|---|---|---|
| **Huéspedes** | Bienvenida + check-in (con código de cerradura), recordatorio de check-out, follow-up post-estadía | Consultas, problemas, agradecimientos |
| **Personal de limpieza** | Asignación de tarea ("limpiar Casa 1, viernes 10am") | Confirmación, reporte de daños/insumos |
| **Personal de mantenimiento** | Asignación de tarea de reparación | Confirmación, fotos del problema |

Volumen estimado: muy bajo. Probablemente <100 mensajes/mes en total.

## 2. Decisión 1 — un número vs dos números

### Opción A: un solo número compartido

Mismo `+598XXX XXXXXX` para huéspedes y personal interno.

**Pros**
- Setup simple: una sola WABA, una sola verificación, una sola línea de plan
- Costos mínimos
- El admin gestiona todo desde un único inbox

**Contras**
- Tono de comunicación mezclado (formal a huéspedes vs casual al staff)
- Si crece el volumen, el inbox se hace caótico
- El "branding" se pierde — un huésped que ve mensajes corporativos al staff puede percibir falta de profesionalismo (en la práctica, no se cruzan, pero el riesgo existe si se equivoca el destinatario)

### Opción B: dos números separados

`+598AAA` para huéspedes (público), `+598BBB` para staff (interno).

**Pros**
- Separación limpia de tono y workflow
- Cada inbox enfocado a su audiencia
- Permite distintas templates aprobadas con voicing distinto
- Permite distintos horarios de respuesta

**Contras**
- 2× la fricción de setup (cada WABA requiere su propio proceso de Meta)
- 2× plan telefónico físico (si los números son de la operadora; pueden ser solo SIPs/virtuales)
- 2× templates a crear y mantener aprobadas
- Necesitás una cuenta Meta Business que soporte múltiples WABAs (gratis, pero más config)

### Recomendación: **un solo número** (Opción A) para el MVP

Justificaciones:
1. Volumen bajo — el inbox no se va a saturar
2. Velocidad de salida — pasar de 0 a 1 lleva semanas; pasar a 2 es un múltiplo
3. Reversibilidad — podés agregar el segundo número en cualquier momento si crece el volumen
4. Costos — el ahorro real durante el primer año es marginal pero el costo cognitivo de gestionar 2 WABAs no lo es

Para mitigar la mezcla de tonos, en el código separamos las conversaciones
por `audience` (`guest` vs `staff`) y las mostramos en pestañas distintas
del admin, aunque vengan al mismo número.

## 3. Decisión 2 — Meta Cloud API directo vs Twilio (u otro BSP)

WhatsApp Business API tiene dos caminos:

### Opción A: Meta WhatsApp Business Cloud API (directo)

Cliente directo contra `graph.facebook.com`. La WABA y los números viven
en Meta Business Suite.

**Pros**
- **Más barato** — Meta cobra solo por conversación (con free tier de 1000 service conversations/mes)
- Un layer menos en la stack (menos cosas que pueden fallar)
- Webhooks directos de Meta
- Control total

**Contras**
- Más curva de aprendizaje (firma de webhooks, manejo de tokens, etc.)
- No hay UI built-in para inbox / atención al cliente — todo lo armás vos
- Soporte sólo vía documentación

### Opción B: Twilio WhatsApp API

Twilio actúa como BSP (Business Solution Provider) por arriba de Meta.

**Pros**
- Setup más guiado, mejor onboarding
- Twilio Studio (UI no-code para flujos), Messaging Insights, etc.
- Soporte de un humano si rompe algo
- SDK pulido (`twilio` npm package)

**Contras**
- **Más caro:** sobre el costo de Meta + ~$0.005 por mensaje + ~$1/mes por número de plan + complejidad de pricing
- Doble dependencia (Meta + Twilio)
- Vendor lock-in mayor

### Costos estimados para Casa Bosque (~50-100 conversaciones/mes)

| Concepto | Meta directo | Twilio |
|---|---|---|
| Service conversations (≤1000/mes) | **$0** (free tier) | ~$0.005/msg ≈ $0.50/mes |
| Utility template messages (UY/AR) | ~$0.04 c/u × 30 = $1.20/mes | ~$0.04 + $0.005 = ~$1.30/mes |
| Plan mensual del número | $0 | $1 |
| **Total estimado/mes** | **~$1-2** | **~$3-5** |

Diferencia anual: ~$30. Marginal. Pero arquitectónicamente Meta directo
es más limpio.

### Recomendación: **Meta Cloud API directo** (Opción A)

Justificaciones:
1. Volumen bajo — no nos beneficia el extra de Twilio
2. Ya tenemos un admin custom — no necesitamos el inbox de Twilio
3. La firma de webhooks Meta es bien documentada y la implementamos una vez
4. Menos vendor lock-in — si crece el negocio, podemos considerar Twilio Verify, Conversations o Sendgrid después sin repercutir en el resto

## 4. Templates necesarios para el MVP

WhatsApp **fuera de la ventana de 24 horas** (después de la última respuesta del usuario) requiere mensajes con **template aprobado**. Los borradores los presentamos a Meta y ellos los aprueban en 1-2 días.

Templates iniciales propuestos:

### `guest_checkin_code` (categoría: utility)

```
¡Hola {{1}}! 🌲

Tu reserva en Acme Rentals está confirmada para el {{2}}.

Tu código de acceso a la puerta principal es: *{{3}}*

Va a estar activo desde las {{4}} de tu día de check-in y hasta el check-out.

Si tenés cualquier consulta, escribinos por acá.

— Acme Rentals
```

Variables: `1=nombre`, `2=fecha check-in`, `3=código 7 dígitos`, `4=hora`.

### `guest_checkout_reminder` (utility)

```
¡Hola {{1}}! Esperamos que estés disfrutando.

Te recordamos que el check-out es mañana {{2}} a las {{3}}.

Por favor:
✓ Dejar las llaves donde las encontraste
✓ Apagar el aire/calefacción al salir
✓ Cerrar las ventanas

Cualquier cosa, escribinos.

— Acme Rentals
```

### `staff_task_assigned` (utility)

```
Nueva tarea: {{1}}

Propiedad: {{2}}
Tipo: {{3}}
Cuándo: {{4}}

Detalles: {{5}}

Confirmá cuando puedas con un "Ok".
```

### `staff_supply_request_received` (utility · auto-respuesta)

```
Recibimos tu reporte:

"{{1}}"

Lo registramos como tarea pendiente y te avisamos cuando esté.
```

## 5. Comandos para staff (entrada vía WhatsApp)

El personal de limpieza/mantenimiento reporta vía mensajes simples; nosotros parseamos comandos:

| Mensaje del staff | Acción del admin |
|---|---|
| `OK` (en respuesta a una tarea) | Marca la tarea como acknowledged |
| `LISTO` o `DONE` | Marca la tarea como `done` |
| `INSUMO papel higiénico` | Crea tarea kind=`insumos` con descripción |
| `DAÑO ventana cocina` | Crea tarea kind=`mantenimiento` |
| Foto + caption | Adjunta a la última tarea reportada |

Sin slash commands, en lenguaje natural. El parsing es ad hoc al principio
(palabras clave); más adelante se puede sumar un LLM si hace falta.

## 6. Plan de implementación

### Fase 1 — setup Meta (1-2 días, mayormente esperando aprobación de Meta)

**Acciones del usuario:**
1. Crear / loguearse en [business.facebook.com](https://business.facebook.com) con cuenta personal (recomiendo no la cuenta donde tenés la app de Tuya/Smart Life, para aislar)
2. Verificar la business (puede tomar varios días) — opcional para arrancar pero requerido para producción más adelante
3. Crear una WhatsApp Business Account (WABA) dentro de la business
4. Agregar un **número de teléfono que NO esté en la app WhatsApp regular** (importante — Meta lo migra). Verificar por SMS o llamada.
5. Crear una **System User** con role admin y generar un **permanent access token** (no expira)
6. Anotar `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_BUSINESS_ACCOUNT_ID`

**Acciones mías:**
1. Mientras esperás a Meta, escribo el cliente Node:
   - `src/lib/whatsapp/client.ts` — `sendTemplateMessage`, `sendText`, `markAsRead`
   - `src/lib/whatsapp/webhook.ts` — verificación de firma (X-Hub-Signature-256)
   - `src/app/api/whatsapp/webhook/route.ts` — POST receiver + GET verification challenge
2. Esquema en Supabase:
   - Nueva tabla `whatsapp_messages` (audit log de todos los mensajes inbound/outbound)
   - Nueva tabla `whatsapp_conversations` (estado por contacto)
3. UI en el admin:
   - `/admin/whatsapp` — inbox simple con conversaciones
   - Botón en cada reserva: "Enviar código por WhatsApp"
   - Botón en cada tarea: "Asignar por WhatsApp"

### Fase 2 — submitir templates (1-2 días, esperando aprobación)

Yo armo los borradores en código + JSON; vos los pegás en Meta Business Suite → WhatsApp → Templates → Create. Cada template tarda 1-2 días en aprobar.

### Fase 3 — webhook + producción

Una vez aprobados los templates:
1. Configurar el webhook URL en Kapso apuntando a `https://admin.example.com/api/whatsapp`
2. Suscribirse al campo `messages`
3. Probar con un mensaje real
4. Fin del setup

## 7. Costos / cuentas / env vars

Env vars que vamos a necesitar (todas en Vercel + `.env.local`):

```
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_ACCESS_TOKEN=...                  # permanent system user token (Sensitive)
WHATSAPP_VERIFY_TOKEN=<random hex 32>      # secret nuestro para verificar Meta webhook
WHATSAPP_APP_SECRET=...                    # de la app Meta, para validar firmas (Sensitive)
```

Costo recurrente esperado: ~$1-2/mes con el volumen actual.

Costo único: $0 (todas las cuentas son free tier).

## 8. Decisiones abiertas

- [ ] **¿1 o 2 números?** Recomiendo 1, podemos cambiar después.
- [ ] **¿Qué número usás?** Tiene que ser uno que NO esté en la app WhatsApp regular. ¿Tenés una SIM aparte, o un número virtual (Twilio, Telnyx, Vonage)?
- [ ] **¿Quién recibe los mensajes inbound?** Por ahora todos los admin/gestor pueden ver `/admin/whatsapp`. Más adelante: notificación push o forward a un email.
- [ ] **¿Idioma de templates?** Español. ¿Necesitamos también inglés para huéspedes extranjeros?

---

**Próximo paso si avanzamos:** confirmás 1 número + Meta directo + me decís qué número vas a usar (o si todavía no tenés). Yo arranco a escribir el cliente y el webhook handler en paralelo a tu setup de Meta.
