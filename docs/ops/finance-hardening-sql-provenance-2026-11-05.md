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

## Alcance estricto y bloqueos

- Solo el **segundo registro consolidado** `20261012071309` coincide íntegramente en cuerpo con el archivo local `20261012150000`, tras remover documentación no ejecutable.
- **NO demuestra** que el primer consolidado `20261012070133` equivalga a los cuatro archivos financieros locales anteriores, ni la procedencia original de las tablas de consignación o la reconstrucción auténtica de `0026_rental_management_core`.
- Siguen sin resolverse las **cuatro divergencias sustantivas** catalogadas en #104, las 75 versiones locales no alineadas y los siete borradores Wompi no desplegados.
- **NO-GO**: no ejecutar `migration repair`, `db push`, SQL histórico, borrados, modificación de permisos o nuevas migraciones productivas. El test no concede autorización operativa, y no requiere credenciales, conexión a producción ni gasto de staging.

El siguiente estudio deberá reconstruir el cuerpo del primer consolidado en PostgreSQL 17 aislado y comparar cada definición efectiva y su evolución posterior antes de proponer reparación oficial.
