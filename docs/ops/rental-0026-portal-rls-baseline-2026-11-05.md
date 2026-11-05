# INMOJCO #104 — 0026 arrendamientos y políticas portal (05-nov-2026)

## Observación de producción, exclusivamente SELECT

Proyecto Supabase: `cuitgyqrjibgwuniapmk` (PostgreSQL 17). La migración auténtica `20261005153559 / 0026_rental_management_core` tiene **un cuerpo SQL registrado de 4.876 caracteres** y SHA-256 `9c2777306c2e44673d69cf5138afafab01d5eaca72284df11df72c6b6f825eb2`. Esta migración **no** es el archivo histórico local `0026_payment_orders_wompi_sandbox.sql`.

Antes de corregir el control, `security/checks/rental_0026_baseline_contract_live.sql` en el borrador #285 devolvía 3 `DRIFT` de 4 tablas, porque trataba **cualquier** política `PERMISSIVE` adicional como inesperada, incluyendo las cuatro lecturas externas aprobadas y añadidas mediante migraciones posteriores. No hay prueba de que esos tres avisos representaran explotación ni pérdida de integridad. Las **47 columnas originales**, cuatro índices, cuatro políticas originales de staff y RLS continuaban presentes.

## Cambio en el verificador (solo lectura)

La consulta ahora fija **cuatro excepciones explícitas y únicas**, observadas en `pg_policy` el 05-nov:

| Tabla | Política adicional | Hash SHA-256 de `pg_get_expr(polqual,polrelid)` |
| --- | --- | --- |
| `leases` | `leases_owner_portal_select` | `8edc2a7a4a9fe194979395b5fda9012a62d778604ee87553abbb7e2f0a5f876d` |
| `leases` | `leases_tenant_portal_select` | `1c83a68d500060fa11e84286173c954e3fdf606ac088d423efd262d3a72f99b6` |
| `owner_statements` | `owner_statements_external_issued` | `6f9fa81441bd18f3e1cff94e1eadcd888cfb6810504f66bc0300058ede6cac84` |
| `rent_payments` | `rent_payments_external_personal` | `3cbbecfd27ecc63fc035c57d390f3a6fd446f01150ad9845d09d892cc925ef12` |

Una política adicional **solo se permite** si el hash del predicado es idéntico, su rol es **exactamente** `authenticated`, es `PERMISSIVE`, su comando es exclusivamente `SELECT` (`polcmd='r'`) y no contiene `WITH CHECK`. Si alguna falta, cambia, o aparece otra permisiva desconocida, el informe devuelve **DRIFT**.

Las políticas originales de personal siguen requiriendo la misma guarda estricta para `USING` y `WITH CHECK`, así como los índices originales y las 47 columnas con tipo y nulabilidad exactos. No se aplicaron `CREATE POLICY`, `ALTER POLICY` ni `GRANT`.

**Comprobación nueva contra Supabase real:** 4/4 filas `BASELINE_COMPATIBLE`, 47/47 columnas originales, 4/4 índices, 4/4 políticas iniciales, 4/4 excepciones aprobadas, cero permisivas desconocidas. Las siete columnas añadidas a `leases` y `owner_statements` permanecen intactas.

## Pruebas y límites

La prueba offline `tests/rental-0026-baseline-contract.test.mjs` bloquea alteraciones del `SELECT` de catálogo y mutaciones sintéticas de los cuatro permisos/huellas. Se ejecuta desde el mismo paso CI `Finance history guard and intentional migration NO-GO (#104)`. Ejecutarla no requiere conexión a Supabase ni modificar sus filas.

```bash
node --test tests/rental-0026-baseline-contract.test.mjs
```

**NO-GO:** la compatibilidad de catálogo es **metadato del estado actual**, no equivalencia completa de los 99 cuerpos SQL aplicados, prueba de accesos reales mediante JWT distintos, restauración end-to-end ni procedencia histórica de las tablas de consignación. #104 sigue abierta. Prohibido `db push`, `migration repair`, DDL/DML productivo o activar Wompi real basándose en esta evidencia.
