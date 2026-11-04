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

### Refuerzo de definiciones efectivas (04-nov-2026)

El control anterior verificaba la existencia de los cuatro índices y de
las cuatro políticas `FOR ALL TO authenticated`, pero un cambio de
`USING`/`WITH CHECK` a una condición permisiva podía mantener la
misma identidad y superar la comprobación.

Se reforzó **la misma consulta SELECT** para cotejar en `pg_catalog`:

- **4/4** definiciones completas de índices btree y sus flags `indisvalid`/`indisready`.
- **4/4** políticas actuales: `polcmd='*'`, `polpermissive=true`, rol
  exclusivamente `authenticated` y condiciones exactas de lectura y
  escritura `(is_platform_admin() OR jco_private.is_internal_staff(organization_id))`.
- La clasificación `BASELINE_COMPATIBLE` ahora exige ambas verificaciones
  adicionales, no solo la presencia de los nombres.

**Ejecución real, producción solo lectura:** las cuatro filas devolvieron
`original_index_definition_intact=true`,
`current_staff_guard_intact=true` y `verdict=BASELINE_COMPATIBLE`.
Los nuevos escenarios negativos de la prueba estática rechazan quitar
`WITH CHECK`, debilitar el predicado, ampliar roles o sustituir índices.
La CI del nuevo SHA debe verificarse antes de declararla aprobada.

**Alcance preciso:** se fijan las **definiciones actuales posteriores**,
no se asegura que fueran los cuerpos originales aplicados en 0026;
la consulta no ejecuta sesiones Auth ni reconstruye migraciones.
Si una migración autorizada cambia legítimamente la política o un índice,
se debe revisar y actualizar deliberadamente el contrato.

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
