# INMOJCO #104 — Reconstrucción exacta de las 99 migraciones aplicadas

**Fecha:** 6 de noviembre de 2026 · **Estado:** FUENTES HISTÓRICAS RECUPERADAS / `db push` NO-GO.

## Qué se recupera de verdad

El registro activo de Supabase `cuitgyqrjibgwuniapmk` conserva **99 versiones**, cada una con **un** cuerpo en `supabase_migrations.schema_migrations.statements[1]` (consultado exclusivamente con SELECT). El repositorio ya fija hashes Git Blob, tamaños en bytes, nombres y orden del historial mediante:

- `docs/ops/snapshots/migration-source-parity-2026-11-06.json`
- `docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json`

La utilidad `scripts/ops/reconstruct-applied-99.mjs` reconstruye **los 99 cuerpos originales byte por byte**, en el orden real del ledger. Total: **493.999 bytes**. Cada resultado se contrasta contra el SHA-1 del blob Git y el tamaño registrados en Supabase, sin contactar con producción.

### Cinco cuerpos que requerían tratamiento específico

- `20261005053050`: añadir un salto de línea inicial, demostrable por hash original.
- `20261011002448`: retirar un salto de línea final del archivo fuente, demostrable por hash original.
- `20261012070133`: ahora se conserva el **cuerpo original completo, 28.005 bytes**, sin reconstruirlo a partir de las cuatro migraciones financieras parciales.
- `20261012071309`: ahora se conserva exactamente el cuerpo original de 889 bytes.
- `20261029171601`: ahora se conserva exactamente el cuerpo original de 491 bytes.

Los tres últimos cuerpos se obtuvieron de `statements[1]` de Supabase mediante SELECT y se verificaron contra sus huellas originales. Están almacenados como **evidencia histórica** en `docs/ops/snapshots/applied-original-...`, fuera de `supabase/migrations`.

## Reproducción local / en CI

Desde el repositorio, con Node.js 22:

```bash
node --test tests/reconstruct-applied-99.test.mjs
node scripts/ops/reconstruct-applied-99.mjs
```

Para generar temporalmente 99 archivos `.sql.txt` y un `MANIFEST.json` de consulta (NO ejecutarlos):

```bash
node scripts/ops/reconstruct-applied-99.mjs --archive-temporary
```

La utilidad impone un directorio `inmojco-104-historic-sql-*` del sistema operativo, permisos de archivo `0600`, y no acepta rutas personalizadas ni URL de PostgreSQL. El directorio temporal puede eliminarse después de inspeccionar los artefactos. **No copiar estos ficheros a `supabase/migrations` ni ejecutarlos en producción.**

## Qué sigue bloqueando el lanzamiento de migraciones

Tener los **99 textos auténticos** resuelve la incertidumbre de las fuentes históricas, pero **no equivale a una base PostgreSQL restaurada**. Algunos cuerpos asumen esquemas administrados de Supabase (`auth`, `storage`), roles, funciones, extensiones y datos ya existentes. Una restauración aislada necesita su configuración real y demostrar el resultado físico final, políticas, grants, contratos y datos de referencia.

**Pendiente:** ejecutar el replay de forma controlada **solo** contra una base desechable configurada, contrastar el resultado con el catálogo productivo, validar rollback, y recién entonces elaborar una estrategia de reconciliación de versiones. No deducir que 76 archivos fechados se puedan marcar aplicados, ni ejecutar los tres SQL antiguos de consignación, portal y precios. No alterar el respaldo auténtico del 1 de noviembre.

**NO-GO #104:** `safeToPush=false`, `safeToRepair=false`, `safeToReplay=false` por defecto. Este paquete no activa CRM #281, licencias #307 ni Wompi real.
