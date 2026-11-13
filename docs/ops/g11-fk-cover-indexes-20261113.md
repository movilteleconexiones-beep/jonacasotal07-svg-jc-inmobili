# G11 — 17 índices FK multitenant para CRM, Agenda, Comisiones y Consignaciones

**Fecha:** 13-nov-2026. **Fuente:** asesor de rendimiento Supabase oficial `cuitgyqrjibgwuniapmk`, hallazgo `unindexed_foreign_keys = 17`. Verificación independiente de los 17 constraints en `pg_constraint` de producción y del clon restaurado.

## Motivo
Las relaciones compuestas `(organization_id, <referencia>)` protegen la segregación entre inmobiliarias, pero no crean automáticamente un índice en la tabla hija. Sin cobertura, las comprobaciones de FK ante actualización/eliminación de una entidad padre y las búsquedas de relaciones por tenant pueden degradarse a medida que crecen CRM y operación.

## Cambio
`security/ops/g11_cover_tenant_foreign_keys.sql` añade **17 índices B-tree no únicos**, sin modificar datos, FK, RLS, roles, precios, planes ni contratos. Incluye tres guardas: preflight de 17 FK, validación por `pg_index.indkey` de columnas y orden exacto, y rollback atómico ante error. Dos límites: `lock_timeout = 3s`, `statement_timeout = 30s`; un lock en producción aborta, no mantiene bloqueadas las escrituras indefinidamente.

No tocar el directorio histórico congelado `supabase/migrations` (#104). El archivo fuente bajo `security/ops` es el registro reproducible; anotar en #203 CI y verificación de advisor tras aplicar.

## Verificación y límites
1. Ejecutar SQL en el clon mediante `BEGIN/ROLLBACK` (sustituir únicamente el `COMMIT` final por un resultado SELECT de cobertura + `ROLLBACK`) y confirmar que no quedan índices instalados.
2. CI del repositorio y revisión de que los índices coinciden con las FK de producción.
3. Aplicar el SQL completo en el proyecto oficial y obtener postflight 17/17. Comparar el asesor `unindexed_foreign_keys` antes/después y conteos de datos financieros.
4. En tablas muy grandes, los `CREATE INDEX` ordinarios requerirían planificación distinta (`CONCURRENTLY` fuera de transacción), pero el conjunto actual está en fase de lanzamiento con tablas pequeñas; el preflight incluye timeouts.
5. `EXPLAIN` se debe valorar según cardinalidad: en tablas pequeñas el planificador puede preferir secuencias incluso con índice correcto. Que el índice exista no prueba por sí mismo mejora de latencia real bajo carga.

**Otras alertas de performance:** `multiple_permissive_policies` (22) y `unused_index` (58) no se modifican indiscriminadamente; eliminarlos/reconstruirlos sin revisar RLS y consultas reales podría provocar regresiones.
