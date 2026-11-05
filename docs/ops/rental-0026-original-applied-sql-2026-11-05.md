# #104 — Copia auténtica e inmutable del SQL aplicado `0026_rental_management_core`

**Fecha de extracción:** 05-nov-2026. **Origen:** `supabase_migrations.schema_migrations` en el proyecto Supabase activo `cuitgyqrjibgwuniapmk`. Consulta ejecutada con `SELECT`, sin acceso a filas comerciales ni escrituras.

## Fuente reproducible

```sql
SELECT version, name, octet_length(statements[1]) AS bytes,
       encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') AS sha256,
       statements[1] AS sql_body
FROM supabase_migrations.schema_migrations
WHERE version = '20261005153559'
  AND name = '0026_rental_management_core';
```

El cuerpo original se conserva **sin agregar, quitar o normalizar bytes** en [`snapshots/0026_rental_management_core.applied-20261005153559.sql`](snapshots/0026_rental_management_core.applied-20261005153559.sql), fuera de `supabase/migrations/`.

| Atributo | Resultado original |
| --- | --- |
| Versión aplicada | `20261005153559` |
| Nombre aplicado | `0026_rental_management_core` |
| Tamaño UTF-8 | **4.878 bytes** |
| Número de caracteres JS | 4.876 |
| SHA-256 | `9c2777306c2e44673d69cf5138afafab01d5eaca72284df11df72c6b6f825eb2` |
| Tablas `CREATE TABLE IF NOT EXISTS` | 4: `leases`, `rent_payments`, `owner_statements`, `maintenance_requests` |
| Índices originales | 4 |
| Activaciones `ROW LEVEL SECURITY` | 4 |
| Políticas originales | 4 |
| Permisos de catálogo insertados | 10 |

**Prueba de regresión exigida por CI:** `tests/rental-0026-baseline-contract.test.mjs` lee los bytes exactos con `readFileSync`, comprueba longitud UTF-8 y SHA-256, y exige los elementos históricos descritos. Protege contra refactor accidental, cambios de caracteres acentuados o sustitución de la fuente.

### Interpretación y alcance

1. **Recuperación exacta del cuerpo SQL de 0026: acreditada.** Era una de las piezas históricas aplicadas sin copia local autenticada. La nueva instantánea se creó desde la fila real y no desde un borrador local con nombre coincidente.
2. **Compatibilidad del esquema actual:** el control de catálogo separado `security/checks/rental_0026_baseline_contract_live.sql` verificó 47/47 columnas originales, cuatro índices y cuatro políticas vigentes endurecidas, más las cuatro excepciones de lectura portal autorizadas. Las políticas originales de 0026 usan `public.is_org_member`; **las actuales no deben revertirse** a ese estado inicial.
3. **Este archivo contiene DDL y DML histórico.** Se almacena deliberadamente en `docs/ops/snapshots/`, no se invoca con `psql -f` en producción, no debe renombrarse a migración ni agregarse automáticamente al directorio `supabase/migrations`. No supone consentimiento para mutar estructura ni permiso.
4. **NO-GO continúa:** la coincidencia exacta de una versión no reconstruye cronológicamente las 99 migraciones aplicadas frente a los 109 SQL locales, ni los dos orígenes ausentes de tablas de consignación, ni prueba la reproducción de un backup completo en PostgreSQL 17. Mantener bloqueados `supabase migration repair`, `db push`, pagos reales y staging con costo hasta ensayo aislado y revisión de diferencias restantes.

No se alteraron datos de prueba ni reales; solo se archivó evidencia histórica en el repositorio.
