# Lista de precios de Deltron (manual)

Deltron no tiene una forma confiable de automatizar la descarga de su lista
de precios (ver `docs/superpowers/specs/2026-08-13-deltron-sync-design.md`
para el detalle técnico de por qué). Mientras eso no se resuelva, el proceso
es manual:

1. Entra a `deltron.com.pe`, inicia sesión, ve a **Productos → Lista de
   precios** (o el botón equivalente en el portal).
2. En el formulario "Lista de Precios y Stock", marca los almacenes que
   correspondan (Lima Principal, Chiclayo, Trujillo) y haz clic en el botón
   **CSV**.
3. Guarda el archivo descargado en esta carpeta como `lista_precios.csv`
   (sobrescribiendo el anterior).
4. Corre `node sync_deltron.js` (con `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` como variables de entorno) para sincronizarlo.

Los archivos `.csv` de esta carpeta están en `.gitignore` — son información
de precios mayoristas propietaria de Deltron, nunca se suben al repo.
