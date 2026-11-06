# INMOJCO #104 — Ensayo aislado de estructura física de consignaciones (05-nov-2026)

## Contexto verificado sin escrituras en Supabase

Proyecto activo: `cuitgyqrjibgwuniapmk`. En lectura de catálogo el 05-nov, las siguientes tablas existen y tienen **14/14 componentes OK** (7 por tabla) contra el baseline del 03-nov: `private.property_intake_sites`, `public.property_consignments`. La consulta `security/checks/consignment_restore_shape_fingerprint.sql` mide identidad/propietario/RLS, columnas, restricciones, índices, políticas, triggers y ACL. Estos componentes están actualizados a hoy, no al instante histórico de creación.

En el historial auténtico hay 99 versiones aplicadas. Una búsqueda de patrones `CREATE TABLE` **directos** para esos dos nombres devuelve 0; sin embargo existen menciones desde `20261010232928` y ambas tablas están presentes. Esta búsqueda no puede descartar ejecución dinámica, DDL efectuado fuera del historial, cambios en la política de registro ni transformaciones históricas; **no permite afirmar que se crearon manualmente**. El archivo de código local `supabase/migrations/20261010212630_property_consignment_intake.sql` sí contiene un bloque físico inicial para ambas tablas y sus restricciones e índices.

## Prueba PG17 incorporada a GitHub Actions (sin costo de staging)

El paso CI `Reconstruct original consignment tables in disposable PostgreSQL 17 (#104)` usa exclusivamente la instancia `postgres:17` del propio job GitHub, una base efímera `jco_consignment_ddl_replay_test` y las tres identidades de prueba `anon`, `authenticated`, `service_role`. Se niega a ejecutar si la base o roles ya existen, o si no está en GitHub Actions.

1. Crear únicamente las tablas padre, esquema y roles vacíos del fixture `security/tests/consignment_local_ddl_replay_fixture.sql`.
2. Extraer del SQL local **solo** el bloque inicial `CREATE TABLE` de ambas tablas, índices, RLS y política histórica hasta el comentario exacto `-- This old policy exposed`. Finalizar esa transacción. **Nunca ejecutar las RPC sensibles ni `DROP POLICY` posteriores.**
3. Consultar `security/checks/consignment_restore_shape_fingerprint.sql` en la base efímera y exigir coincidencia de **6/6** controles físicos: columnas, restricciones e índices para ambas tablas contra el catálogo vivo fijado.
4. Modificar deliberadamente la **base efímera** agregando `unexpected_historical_drift` y exigir que el control de columnas marque `DRIFT`. Es una prueba negativa de sensibilidad, no un cambio productivo.
5. Borrar la base y roles que creó el job incluso cuando falla; abandonar si encuentra recursos ya existentes.

También se valida el procedimiento de replay y sus límites con `tests/consignment-pg17-disposable-replay.test.mjs`, ejecutado antes del ensayo de base.

### Límites de esta evidencia

- La comparación reproduce **el DDL físico local** de creación de estas dos tablas y comprueba igualdad con el catálogo actual **solo de columnas, restricciones e índices**. Las políticas RLS y ACL fueron endurecidas después: no se deben reponer los antiguos privilegios.
- Una reconstrucción de dos tablas y dependencias mínimas **no es una restauración integral**, ni acredita la procedencia de la DDL histórica originalmente aplicada; no sustituye una restauración completa PG17 de una copia auténtica de Supabase, un ensayo de JWT por inmobiliaria ni la reconciliación de las 99 migraciones frente a 109 archivos SQL locales.
- El archivo de baseline está intencionalmente guardado bajo `security/checks/`. Debe revisarse si cambia el esquema legítimamente; un cambio inesperado debe dar `DRIFT`, no habilitar automáticamente nuevas migraciones.
- **NO-GO:** sigue prohibido `db push`, `migration repair`, ejecutar el SQL original como una migración nueva, modificar producción o activar Wompi real hasta resolver #104 y pruebas de seguridad finales.

La evidencia de ejecución se obtiene de GitHub Actions por SHA; una CI verde demuestra aislamiento y forma física, no la operación E2E desde navegador.
