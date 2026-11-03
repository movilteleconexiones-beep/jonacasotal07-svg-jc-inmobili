# INMOJCO — integridad entre agencia, cliente y propietario en accesos al portal

**Fecha:** 03-nov-2026 · **Estado:** candidato para revisión, NO-GO #104/#203.
**Nunca se ha aplicado este cambio al Supabase productivo.**

## Evidencia actual (consulta de catálogo y agregados, solo SELECT)

La tabla `public.portal_access_links` vincula un usuario de Auth a **un
contacto o un propietario** (`portal_access_links_check`). Tiene `organization_id`
obligatorio, RLS habilitado y dos claves foráneas iniciales de una columna:

- `portal_access_links_contact_id_fkey`: `contact_id -> contacts(id)`,
  `ON DELETE CASCADE`.
- `portal_access_links_owner_id_fkey`: `owner_id -> property_owners(id)`,
  `ON DELETE CASCADE`.

Los padres ya disponen de unicidad
`UNIQUE (organization_id,id)` (`financial_contacts_tenant_id_unique` y
`financial_property_owners_tenant_id_unique`). Las políticas RLS de
inserción **ya comprueban que un contacto o propietario vinculado pertenezca
a la misma inmobiliaria**, además de exigir personal autorizado. Esta es
una defensa importante: la falta de una FK compuesta **no constituye por
sí sola una exposición de datos a usuarios del portal**.

Resultados agregados comprobados en la base activa: **3** vínculos en total,
**2** de contacto y **1** de propietario; **0 referencias cruzadas**.
No se extrajeron datos personales ni identificadores de usuarios.

## Defensa adicional a nivel de integridad

Archivo de revisión
[`security/candidates/portal_links_tenant_composite_fks.sql`](../../security/candidates/portal_links_tenant_composite_fks.sql)

La candidata reemplaza **las dos FKs existentes y conserva sus nombres**,
`ON DELETE CASCADE`, comprobaciones de exclusividad, RLS y permisos API:

```sql
FOREIGN KEY (organization_id, contact_id)
  REFERENCES public.contacts(organization_id,id) ON DELETE CASCADE;

FOREIGN KEY (organization_id, owner_id)
  REFERENCES public.property_owners(organization_id,id) ON DELETE CASCADE;
```

Con ello PostgreSQL impide persistir una vinculación entre diferentes
inmobiliarias incluso si una función privilegiada crea registros omitiendo
los controles de RLS. **Reemplazar**, en lugar de duplicar, evita rutas de
unión ambiguas en PostgREST; conservar los nombres protege consultas
explícitas con `!portal_access_links_contact_id_fkey` o
`!portal_access_links_owner_id_fkey`. La candidata solicita recarga del
esquema de PostgREST mediante `NOTIFY pgrst`.

Preflight transaccional `fail-closed`: ejecutor `postgres`, propietario y
RLS de las tres tablas, índices únicos de los padres, CHECK de
exclusividad, una sola FK por padre, semántica CASCADE y ausencia de
vínculos huérfanos o entre organizaciones distintas. Bloquea las tablas
con `lock_timeout=5s`, valida los nuevos constraints y comprueba que
los permisos de servicio y personal autenticado se preserven.

## Validación aislada y publicación

[`security/tests/portal_links_tenant_composite_fks_pg17.sh`](../../security/tests/portal_links_tenant_composite_fks_pg17.sh)
usa PostgreSQL 17 desechable y cuentas ficticias:
demuestra que el FK simple previo deja pasar cruces bajo un escritor SQL
privilegiado; mantiene la política RLS de personal autorizado; rechaza
datos preexistentes inconsistentes, doble ejecución, intentos de vincular
contacto/propietario ajeno, duplicación de FK y pérdida de eliminación
`ON DELETE CASCADE`.

**No autoriza despliegue.** Quedan pendientes: reconciliar #104, proteger
GitHub main/Railway check suites, confirmar backups restaurables, ejecutar
en staging la prueba E2E con perfiles cliente/propietario y cambio de
inmobiliaria, revisar tiempos de bloqueo SQL y disponer de rollback.

Para rollback de prueba, restaurar la definición histórica de una columna
de cada FK bajo transacción y recargar PostgREST; la vuelta atrás **no**
debe producirse si hay datos que quedarían mal asociados. No automatizar
estas operaciones en producción.

Ninguna migración nueva se incorporó a `supabase/migrations`. Wompi debe
continuar en sandbox.
