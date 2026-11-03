# INMOJCO — Solicitudes de mantenimiento y propiedad de la inmobiliaria

**03-nov-2026 · candidato sin desplegar · #104/#203 NO-GO**

## Hallazgo verificado (Supabase producción, solo SELECT)

`public.maintenance_requests` incluye `organization_id` y
`property_id`; pero el FK aplicado
`maintenance_requests_property_id_fkey` referencia exclusivamente
`public.properties(id)` (`ON DELETE CASCADE`). RLS protege las
filas propias de una organización, **no obliga** a que `property_id`
pertenezca a esa misma organización: un usuario con permisos de escritura
podría pasar RLS con `maintenance_requests.organization_id=A` y señalar
una propiedad existente de B. El FK de una columna no lo rechazaría.

El catálogo real confirma que la tabla padre **ya tiene**
`financial_properties_tenant_id_unique UNIQUE (organization_id,id)`,
que posibilita introducir una FK compuesta sin alterar el identificador
de los inmuebles.

Auditoría agregada en producción: **0** filas actuales en
`maintenance_requests`, **0** referencias cruzadas y **0** referencias
huérfanas. No se consultaron valores personales, UUID de clientes ni
registros detallados. El hallazgo identifica un defecto de integridad
potencial, **no una filtración confirmada**.

## Propuesta técnica

La candidata independiente
[`security/candidates/maintenance_requests_property_tenant_fk.sql`](../../security/candidates/maintenance_requests_property_tenant_fk.sql)
crea, en **transacción única y con bloqueo de tiempo limitado**:

`FOREIGN KEY (organization_id,property_id) REFERENCES
public.properties(organization_id,id) ON DELETE CASCADE`

La clave original de una columna se conserva inicialmente para reducir
el riesgo de alterar dependencias; una eliminación posterior de esa
redundancia requeriría revisión aparte. La nueva FK se añade como
`NOT VALID` y se valida en la misma transacción, por lo que un dato
existente que incumpla el aislamiento aborta toda la operación.

La candidata exige propietario legítimo `postgres`, RLS activo y
`UNIQUE` compuesto existente, la FK original con cascada, inexistencia
de vínculos cruzados/huérfanos, y contrato de FK compuesta esperada si
ya se ejecutó antes. Conserva permisos SQL de roles autenticados y
`service_role`, y se puede repetir. **No corrige MAINTAIN ni grants
de CRUD anónimos**, tratados por candidatos distintos.

## Prueba CI con datos falsos

`security/tests/maintenance_property_tenant_fk_pg17.sh` usa una base
PostgreSQL 17 desechable: dos inmobiliarias y dos propiedades sintéticas.

- **Antes de la candidata:** demuestra que RLS permite insertar la
  solicitud con organización A, pero referencia a propiedad B, porque
  el FK antiguo solo comprueba `id` (la prueba hace rollback).
- Introduce una relación incorrecta solo en la base descartable y
  confirma que el preflight aborta **sin dejar una FK parcial**.
- Comprueba que una sesión no autorizada no instala el constraint.
- Aplica la candidata dos veces para verificar idempotencia.
- Confirma que la FK rechaza el cruce incluso para el propietario SQL,
  mantiene solicitudes válidas por agencia y respeta RLS.
- Comprueba `service_role`, registros existentes y la cascada
  `ON DELETE CASCADE` de la relación original.

## Condiciones para publicarla

No ejecutar la candidata en producción hasta: (1) reconciliar #104;
(2) proteger `main` y activar comprobaciones de CI antes de desplegar
en Railway; (3) garantizar respaldo recuperable de Supabase/Storage;
(4) correr fixture y prueba de la app en un staging aislado, incluyendo
contratos, edición de mantenimiento e inventario de dos inmobiliarias;
(5) disponer de plan de rollback y mantenimiento para el bloqueo DDL.

**Estado esperado:** CI de PostgreSQL 17 valida el candidato, pero
el producto sigue **NO-GO** para publicar o cobrar licencias reales.
