# Citec Store — Frontend (Fase 4)

Next.js (App Router) leyendo únicamente la vista `catalog_search` de Supabase.

## Desarrollo local

1. `cd web`
2. `npm install`
3. Copiar `.env.example` a `.env.local` y completar `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave `anon`/publishable del proyecto `rqrbgjzdcvieqbpexgen` — ver Supabase → Settings → API).
4. `npm run dev` — http://localhost:3000
5. `npm test` — corre los tests de `lib/*.test.js`

## Despliegue

Proyecto Vercel del equipo `CITEC` (ya existe). Al crear el proyecto en Vercel:
- Root Directory: `web`
- Variables de entorno: las mismas de `.env.example`, con los valores reales de producción.
- Framework preset: Next.js (autodetectado).
