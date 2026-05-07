# Plantillas de WhatsApp — Acme Rentals

Referencia para submitir las 4 plantillas iniciales a Meta vía Kapso cuando
volvamos a producción (ver [WIK-27](https://linear.app/example/issue/WIK-27)).
Las definiciones canónicas en código están en
[`src/lib/whatsapp/templates.ts`](../src/lib/whatsapp/templates.ts) — el código
es la fuente de verdad; este doc es una vista renderizada.

## Cómo submitir

1. Ir al dashboard de Kapso → **Templates** (o **Plantillas de mensajes**)
2. Crear una nueva por cada entrada de abajo, copiando:
   - **Nombre** (snake_case, exacto)
   - **Idioma** = `Spanish` / `es`
   - **Categoría** = la que indica cada plantilla (todas son `UTILITY` salvo que se aclare)
   - **Body** (texto exacto, las variables se ingresan como `{{1}}`, `{{2}}`...)
   - **Footer** (si aplica)
3. Guardar y enviar a aprobación de Meta. **Aprobación toma 1-2 días.**
4. Una vez aprobada, queda referenciable por su `name` desde
   `sendKapsoTemplate(name, language, components)` (función a implementar
   en WIK-29).

---

## 1. `guest_checkin_code`

**Categoría:** UTILITY · **Idioma:** es

**Variables:**
- `{{1}}` nombre del huésped
- `{{2}}` propiedad (ej. "Acme Rentals")
- `{{3}}` fecha de check-in (texto formateado, ej. "viernes 15 de mayo")
- `{{4}}` código de cerradura (7-10 dígitos)
- `{{5}}` hora de check-in (ej. "15:00")

**Body:**

```
¡Hola {{1}}! 🌲

Tu reserva en *{{2}}* está confirmada para el {{3}}.

Tu código de acceso a la puerta principal es: *{{4}}*

El código se activa a partir de las {{5}} de tu día de check-in y vence en el momento del check-out.

Cualquier consulta nos escribís por acá.

— Acme Rentals
```

**Footer:** `Acme Rentals`

**Ejemplo renderizado para review de Meta:**

```
¡Hola Juan! 🌲

Tu reserva en Acme Rentals está confirmada para el viernes 15 de mayo.

Tu código de acceso a la puerta principal es: 8472193

El código se activa a partir de las 15:00 de tu día de check-in y vence en el momento del check-out.

Cualquier consulta nos escribís por acá.

— Acme Rentals
```

---

## 2. `guest_checkout_reminder`

**Categoría:** UTILITY · **Idioma:** es

**Variables:**
- `{{1}}` nombre del huésped
- `{{2}}` fecha de check-out (ej. "domingo 17 de mayo")
- `{{3}}` hora de check-out (ej. "10:00")

**Body:**

```
¡Hola {{1}}! Esperamos que estés disfrutando tu estadía. 🌲

Te recordamos que el check-out es mañana {{2}} a las {{3}}.

Antes de salir, te pedimos:
✓ Cerrar las ventanas y puertas
✓ Apagar el aire / calefacción
✓ Dejar las llaves donde las encontraste

¡Gracias por elegirnos! Cualquier feedback nos ayuda muchísimo.

— Acme Rentals
```

**Footer:** `Acme Rentals`

---

## 3. `staff_task_assigned`

**Categoría:** UTILITY · **Idioma:** es

**Variables:**
- `{{1}}` título de la tarea (ej. "Limpieza salida huésped")
- `{{2}}` propiedad
- `{{3}}` tipo (limpieza / mantenimiento / insumos)
- `{{4}}` cuándo (texto, ej. "viernes 15 a las 11:00")
- `{{5}}` descripción (puede ser largo)

**Body:**

```
Nueva tarea asignada:

*{{1}}*
Propiedad: {{2}}
Tipo: {{3}}
Cuándo: {{4}}

Detalles: {{5}}

Confirmá con un "OK" cuando puedas. Cuando termines, escribí "LISTO".
```

**Footer:** `Acme Rentals · Operaciones`

---

## 4. `staff_supply_request_received`

**Categoría:** UTILITY · **Idioma:** es

**Variables:**
- `{{1}}` resumen del reporte recibido

**Body:**

```
Recibimos tu reporte:

"{{1}}"

Lo registramos como tarea pendiente. Te avisamos cuando esté resuelto. ¡Gracias!
```

**Footer:** `Acme Rentals · Operaciones`

---

## Notas para Meta review

- Las 4 son `UTILITY` (no marketing): notificaciones operativas, no
  promocionales. Meta aprueba `UTILITY` más rápido que `MARKETING`.
- El emoji 🌲 está dentro de body normal — Meta lo permite.
- Asteriscos (`*texto*`) renderizan como **negrita** en WhatsApp.
- No incluyen botones (Quick Reply / URL) en esta v1 para mantener simple.
  Podemos sumar botones tipo "Confirmar llegada" en una iteración futura
  (cada cambio requiere re-aprobación).
