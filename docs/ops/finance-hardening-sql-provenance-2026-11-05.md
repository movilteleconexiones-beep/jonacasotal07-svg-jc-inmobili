# INMOJCO #104 — Equivalencia del cuerpo SQL de endurecimiento financiero (05-nov-2026)

## Evidencia del origen

Se consultó **solo el metadato de migración**, sin leer filas de negocios ni ejecutar DDL/DML, en Supabase `cuitgyqrjibgwuniapmk`:

```sql
SELECT version, name, cardinality(statements) AS statement_count,
       length(statements[1]) AS sql_length,
       encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') AS recorded_sql_sha256
FROM supabase_migrations.schema_migrations
WHERE version = '20261012071309';
```

Resultado: nombre `finance_approval_and_audit_timestamp_hardening`, **un elemento SQL** de **889 caracteres/bytes ASCII**; SHA-256 `4eab5a0e05dd5a4b5b6ad5bbf13bb9191e47f319bad8aa12ffd97afd8f1012c4`.

Archivo local: `supabase/migrations/20261012150000_finance_approval_and_audit_timestamp_hardening.sql`, **1.282 caracteres** incluyendo anotaciones. Al quitar **únicamente líneas completas de comentarios `--` y líneas vacías**, el cuerpo queda en **889 bytes, 24 líneas**, idéntico byte a byte al cuerpo almacenado en `statements[1]` (comparación directa sobre ambos textos). No se cambia indentación ni contenido SQL restante.

Esta equivalencia puntual confirma que **la diferencia de versión de este archivo es documental**, *respecto al cuerpo SQL originalmente registrado*. No afirma que las políticas, triggers, ACL o funciones estén hoy en el mismo estado: existen migraciones posteriores y también se deben inspeccionar sus efectos.

## Prueba reproducible

```bash
node scripts/ops/finance-hardening-provenance.mjs
node --test tests/finance-migration-gate.test.mjs
```

El script compara SHA-256/longitud/líneas fijados contra el archivo histórico. La prueba de regresión modifica artificialmente el estado de contrato `DRAFT`, los permisos `REVOKE`, la definición del trigger y agrega DDL/SQL extra; todos deben dar `matchesRecordedSql=false`. Los comentarios adicionales no afectan el cuerpo ejecutable. El test está dentro de `tests/finance-migration-gate.test.mjs`, ya invocado por la CI protegida de `main`.

## Primer consolidado financiero — comparación completa de cuerpos

**Registro aplicado auténtico:** `20261012070133_audited_rent_receipts_owner_deductions_finance_permissions` (`statements[1]`, 28.005 caracteres incluyendo comentarios), comparado con los cuatro archivos locales originales:

1. `20261012120000_owner_statement_deduction_lines.sql`
2. `20261012130000_rent_receipts_and_owner_drafts.sql`
3. `20261012140000_reconcile_owner_deductions.sql`
4. `20261012143000_finance_rls_and_tenant_links.sql`

Se compararon las secuencias **línea a línea** sin ejecutar SQL. En las fuentes locales se quitaron únicamente líneas de comentario completas y vacías y se reemplazaron sus cuatro envolturas `BEGIN;/COMMIT;` por la única envoltura histórica aplicada. La envoltura registrada adicional contiene exactamente:

```sql
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- [cuerpos de los cuatro SQL locales originales, en orden]
NOTIFY pgrst, 'reload schema';
```

El test reconstruye esa envoltura explícita y verifica **484 de 484 líneas idénticas**, **24.924 bytes ASCII**, SHA-256 del texto aplicado sin comentarios ni líneas vacías `6953822bed1cd6b52a84afa5a2f97c7a2fa7dc5b28f34efbce51daf0c597d5b9`.

Lectura de metadatos (no se consultaron datos comerciales):

```sql
WITH src AS (
  SELECT statements[1] AS body FROM supabase_migrations.schema_migrations
  WHERE version = '20261012070133'
), kept AS (
  SELECT ord, rtrim(line) AS line
  FROM src, regexp_split_to_table(replace(body, E'\\r\\n', E'\\n'), E'\\n')
     WITH ORDINALITY AS t(line,ord)
  WHERE btrim(line)<>'' AND ltrim(line) NOT LIKE '--%'
), assembled AS (
  SELECT string_agg(line,E'\\n' ORDER BY ord) AS body FROM kept
)
SELECT octet_length(body), encode(sha256(convert_to(body,'UTF8')),'hex')
FROM assembled;
```

La diferencia física anterior se reduce a **tres instrucciones operativas explícitas** del consolidado (dos `SET LOCAL`, un `NOTIFY`) y **tres pares `COMMIT/BEGIN`** adicionales que aparecen solo cuando los cuatro archivos se ejecutan por separado. El **cuerpo DDL/DML original restante** coincide byte a byte. No se renombra, reejecuta ni marca como aplicada ninguna migración; este análisis no reconstruye el estado actual tras todas las migraciones posteriores.

La rutina `verifyAppliedConsolidation` en el script y sus tests adversariales comprueban modificaciones de contenido, orden de archivos y límites de transacción. Se ejecutan en el mismo paso CI del historial financiero.

## Alcance estricto y bloqueos

- El **segundo registro consolidado** `20261012071309` coincide íntegramente en cuerpo con el archivo local `20261012150000`, tras remover documentación no ejecutable.
- El **primer consolidado** `20261012070133` reproduce íntegramente la secuencia de instrucciones de los cuatro SQL originales al utilizar la envoltura registrada; la ejecución como una sola transacción con límites de tiempo también forma parte de la diferencia documentada. No demuestra identidad de efectos actuales ni la procedencia original de las tablas de consignación o la reconstrucción auténtica de `0026_rental_management_core`.
- Se acreditan ahora ambos **cuerpos SQL históricos del bloque financiero**; sigue pendiente demostrar que la secuencia completa de migraciones, sus efectos actuales y las otras discrepancias históricas sean compatibles. Se mantienen 75 versiones locales no alineadas y siete borradores Wompi no desplegados.
- **NO-GO**: no ejecutar `migration repair`, `db push`, SQL histórico, borrados, modificación de permisos o nuevas migraciones productivas. El test no concede autorización operativa, y no requiere credenciales, conexión a producción ni gasto de staging.

El siguiente estudio deberá **ejecutar en PostgreSQL 17 aislado** la reconstrucción del primer consolidado, comprobar los efectos de las migraciones posteriores y reconciliar los objetos históricos de 0026 y consignación antes de proponer reparación oficial.
