# Acme Rentals — Admin

Panel de administración interno: dashboard de check-ins/check-outs, gestión de
usuarios y reservas, e (próximamente) integración con WhatsApp para huéspedes
y personal de limpieza/mantenimiento.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind v4 + shadcn/ui
- Supabase (Auth + Postgres + RLS)
- Hosting: Vercel → `admin.example.com`

## Setup local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Crear proyecto en [supabase.com](https://supabase.com) y, en el SQL editor,
   ejecutar `supabase/schema.sql`.
3. Copiar `.env.example` a `.env.local` y completar con las keys del proyecto
   Supabase (Project Settings → API).
4. Crear el primer admin desde el dashboard de Supabase
   (Authentication → Users → Add user) y, en la tabla `profiles`, setear
   `role = 'admin'` para ese usuario.
5. Levantar dev server:
   ```bash
   npm run dev
   ```

## Roles

- **admin**: gestiona usuarios, propiedades, reservas y tareas.
- **gestor**: gestiona reservas y tareas. No crea usuarios.
- **limpieza** / **mantenimiento**: ven y actualizan sus tareas; reportan
  problemas/insumos vía WhatsApp.

## Estructura

```
src/
  app/
    login/         # autenticación (email + password)
    dashboard/     # vista protegida con check-ins/check-outs
  lib/
    supabase/      # clients (server / browser / middleware)
    types.ts
  components/ui/   # shadcn
supabase/
  schema.sql       # tablas, enums, triggers y políticas RLS
```
