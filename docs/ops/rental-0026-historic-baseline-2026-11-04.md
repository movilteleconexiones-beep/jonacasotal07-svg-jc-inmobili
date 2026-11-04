# INMOJCO #104 — Compatibilidad estructural de `0026_rental_management_core`

**Fecha:** 04-nov-2026. **Entorno consultado:** Supabase activo, solo SQL `SELECT`
sobre catálogo PostgreSQL 17. **No autoriza aplicar ni reparar migraciones.**

## Origen y alcance

Se revisó directamente la versión realmente aplicada
`20261005153559 / 0026_rental_management_core` en
`supabase_migrations.schema_migrations` (cuerpo de ~4,9 KB).
Esta versión no tiene archivo local de SQL byte-idéntico y **no**
corresponde a los borradores locales de Wompi con prefijo `0026`.

El cuerpo aplicado creó originalmente cuatro tablas, con 47 columnas
identificadas por **nombre, tipo PostgreSQL y propiedad `NOT NULL`**,
cuatro índices iniciales y cuatro políticas `FOR ALL TO authenticated`.
Esas definiciones y la existencia de 10 claves de permisos se comprobaron
sin consultar filas de contratos, cobros, liquidaciones ni usuarios.

La consulta de catálogo reproducible
[`security/checks/rental_0026_baseline_contract_live.sql`](../../security/checks/rental_0026_baseline_contract_live.sql)
contiene **solo** los 47 contratos de columnas extraídos del SQL
histórico aplicado y los nombres de los cuatro índices/políticas.

| Tabla | Columnas originales compatibles | Campos posteriores adicionales | Índice inicial válido | Política original / RLS |
| --- | ---: | ---: | --- | --- |
| `public.leases` | 15/15 | 5 | Sí | Sí |
| `public.rent_payments` | 10/10 | 0 | Sí | Sí |
| `public.owner_statements` | 12/12 | 2 | Sí | Sí |
| `public.maintenance_requests` | 10/10 | 0 | Sí | Sí |
| **Total** | **47/47** | **7** | **4/4** | **4/4** |

**Resultado ejecutado contra Supabase:** 4 filas con
`verdict=BASELINE_COMPATIBLE`, todas las tablas de propiedad
`postgres`, con RLS activado, índices originales válidos y
políticas iniciales aún presentes. No se alteró ninguna tabla ni se
extrajeron datos personales.

Las **cinco ampliaciones posteriores en `leases`** incluyen
terminación y entrega del inmueble. Las **dos adicionales en
`owner_statements`** corresponden a la emisión de liquidaciones.
No son errores del SQL original: son evolución deliberada y por ello
se muestran por separado, sin exigir igualdad de cantidad total
de columnas.

## Garantía de CI y límites

[`tests/rental-0026-baseline-contract.test.mjs`](../../tests/rental-0026-baseline-contract.test.mjs)
ancla las 47 filas y los cuatro pares índice/política; exige que
la consulta **solo lea metadatos `pg_catalog`**; comprueba tipos,
nulabilidad, rechazo de SQL mutador y comportamiento `DRIFT` si
faltan columnas originales, RLS, política o índice.

Un test Node en CI valida el **contrato de la consulta versionada**;
para verificar el estado real se requiere ejecutar el `SELECT`
contra Supabase y comparar las cuatro filas. La nueva evidencia
**no** valida los cuerpos de `CHECK`, las definiciones actuales
de las políticas, integridad de todas las FKs ni que los cambios
posteriores se puedan volver a aplicar cronológicamente desde cero.

### Estado inequívoco

- **Compatibilidad base de `0026`: acreditada** en 47 columnas
  con tipos/nulabilidad, cuatro índices y cuatro políticas iniciales.
- **Correspondencia del SQL original aplicado con Git:** sigue
  pendiente; no se debe inventar una versión local, copiar el
  ledger a migraciones, alterar checksums ni ejecutar
  `supabase migration repair`.
- **Reproducción de esquema completo, datos y dependencias:** requiere
  un ensayo controlado fuera de producción, además de los cuatro
  problemas sustantivos #104.
- El respaldo auténtico **#214 ya está cerrado**; no hay que
  repetir exportaciones ni trabajo de USB.

**NO-GO #104/#203:** sin merge de PR #285, DDL/DML productivo,
cambios en Railway, pagos Wompi reales ni costos adicionales.
