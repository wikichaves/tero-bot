# UI/UX refactor — qué se hizo

Refactor de presentación ejecutado el 2026-09-13 en 8 PRs (#166 a #173), uno por
tanda, cada uno con `lint` + `build` en verde y CI aprobado antes de mergear.

Lo ejecutó un agente (WIKIBOT / Codex) contra un spec escrito a partir de un
audit del código. Este documento es el **registro de lo que efectivamente pasó**,
incluidas las partes donde el plan original estaba equivocado. El spec previo,
que describía cuatro fases a futuro, quedó obsoleto y se reemplazó por esto.

## Resultado

| Métrica | Antes | Después |
|---|---|---|
| Colores hardcodeados | 82 en 15 archivos | 3 (deliberados, ver abajo) |
| Tokens semánticos de estado | ninguno | 5 familias, claro + oscuro |
| Variantes `dark:` de color a mano | 23 | 0 |
| Destinos en la barra de navegación | 16 | 7 |
| Claves i18n (es/en, en paridad) | 881 | 1004 |
| Primitivos en `src/components/ui/` | 11 | 14 |

## Las tandas

| PR | Qué |
|---|---|
| #166 | Tokens semánticos de estado + primitivos Sheet/Tabs/Select |
| #167 | Anchos y footers de los 16 diálogos |
| #168 | Bottom sheet en mobile para formularios largos |
| #169 | Navegación: 16 destinos → 7, página `/admin` |
| #170 | Consistencia de encabezados de página |
| #171 | i18n de `/earnings` |
| #172 | i18n de los diálogos de gastos y leads |
| #173 | La restricción de Base UI documentada en `AGENTS.md` |

## Decisiones y por qué

**Tokens de estado, no colores de paleta.** Había 82 utilities hardcodeadas con
semántica clara pero implícita: amber para alarma, emerald para ok, red para
falla, orange para degradado, blue/sky para info. Se reemplazaron por
`--status-warning` / `-ok` / `-critical` / `-degraded` / `-info` en
`globals.css`, cada una con su `-foreground` y su valor de dark mode. Las 23
variantes `dark:` escritas a mano desaparecieron: el token cambia solo.

La paleta se eligió apagada a propósito, para convivir con los accents neutros
de WIK-196 y el fondo cream de WIK-199. Se verificó contraste WCAG contra los
cuatro fondos reales (`background` y `card`, en ambos modos): el peor caso es
5.59:1, por encima del 4.5:1 que pide AA. También se verificó separación
perceptual (ΔE) entre los pares que conviven en pantalla: warning vs degraded
da 26.9, y critical vs `destructive` da 38.1 — importante, porque son conceptos
distintos (`destructive` es una acción del usuario, `critical` es un estado del
sistema) y colapsarlos haría que la UI mienta.

**Los 3 colores que quedaron.** `src/app/admin/properties/[id]/floor-plan.tsx`
usa `sky-950/800/200` en el chip del plano. No son semántica de estado sino la
paleta del dibujo, así que migrarlos habría roto la visualización.

**Bottom sheet sobre Dialog, no sobre Sheet.** El `Dialog` ya resuelve foco,
scroll interno, Escape y un centrado inmune a `backdrop-filter` que costó dos
tickets (WIK-170, WIK-337). Un bottom sheet no es otro componente: es el mismo
con otra posición abajo de `sm`. Se implementó como prop opt-in `mobileSheet`,
con el camino por defecto idéntico byte a byte al anterior, para no mover los
diálogos que deben seguir centrados. El primitivo `Sheet` quedó para su
consumidor real, que es el nav mobile.

**Anchos por contenido, no por historia.** El criterio nuevo es ≤4 campos →
default (`sm:max-w-md`), ≥5 → `sm:max-w-2xl`. Antes no correlacionaba:
`new-lead-dialog` (4 campos) era ancho y `task-form-dialog` (10) era angosto.

**El menú, de 16 destinos a 7.** "Configuración" era un cajón de sastre de 8
items que mezclaba vistas operativas en vivo (Cámaras, WhatsApp Inbox — ahí se
trabaja, no se configura), superficies de acción sobre hardware (Cerraduras) y
configuración real. Quedó:

- Leaves: `/tasks` `/rooms` `/reservations` `/cameras`
- Grupo Dinero: `/energy` `/bills` `/expenses` `/earnings`
- Grupo Comercial: `/leads` `/whatsapp`
- Admin: link a `/admin`, página índice nueva con tarjetas descriptivas

Cámaras subió a leaf por ser una vista operativa, y como efecto lateral el rol
gestor dejó de tener un dropdown de un solo item. Los 6 destinos de
administración pasaron a una página porque un dropdown no puede explicar la
diferencia entre "Dispositivos Tuya" y "Cerraduras"; una tarjeta con una línea
de descripción sí. En mobile, la lista plana de 16 items en un `DropdownMenu` se
reemplazó por `Sheet` con secciones.

Se preservaron la lógica de badges de WIK-109 (el badge cuenta solo tareas
asignadas a uno) y el orden por frecuencia de uso de WIK-162.

## Dónde el plan estaba equivocado

**La Fase 4 no existía.** El spec original decía "25 páginas en batches de 3-4,
foco en jerarquía visual y densidad". Al medir para armar el primer batch, las
páginas ya eran consistentes: 21 de 27 con el mismo `<h1 className="text-4xl">`
y los 13 layouts con el mismo shell (`mx-auto w-full max-w-6xl p-4 sm:p-6`). No
había desprolijidad estructural que arreglar. Quedaron 4 outliers, y tres de
ellos eran de secciones agregadas después de que la convención se estableciera
— el mismo patrón de acumulación que se vio en el nav.

**`my-tasks` no necesitaba encabezado.** Se lo marcó como "página sin `h1`", pero
es un redirect puro a `/tasks` (WIK-109, para bookmarks viejos) que no renderiza
UI. El agente rechazó el cambio con esa justificación, correctamente.

**Los overrides de heading estaban de más.** Los `h1` que se corrigieron traían
`font-semibold tracking-tight`, que peleaban contra el sistema de headings de
`globals.css` (WIK-131/199/200: Times New Roman, color bronce). El canónico es
`text-4xl` a secas, heredando la base.

## Deuda saldada de paso

Tres superficies estaban fuera del sistema de i18n, violando la regla de
`AGENTS.md`: `/earnings` (9 strings, cero llamadas a `getTranslations`),
`new-expense-dialog` y `new-lead-dialog` (12 strings cada uno). Se migraron en
#171 y #172.

En el `<select>` de categorías de gastos hubo que separar etiqueta de valor: las
opciones (`combustible`, `ferreteria`, …) se guardan en la base. Se tradujo solo
el label y se fijaron los `value` originales explícitamente. Traducirlos habría
partido las agrupaciones por categoría en silencio, sin romper el build ni el
lint.

## Pendiente

**El pase de densidad.** Seis páginas con tablas esconden entre 4 y 6 columnas
en mobile (`hidden sm:table-cell`); habría que evaluar si esconder datos es la
respuesta correcta o si conviene una vista de tarjetas. Y el tier `md`
(768–1024px) está flaco: 40 usos de `md:` contra 173 de `sm:`, justo donde el
nav cambia de mobile a desktop.

No se hizo porque es criterio, no corrección: no hay forma de verificar si quedó
mejor. Requiere una decisión de quien mantiene el producto.
