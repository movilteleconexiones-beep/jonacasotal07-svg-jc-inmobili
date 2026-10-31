# Protección del plan y estado comercial de INMOJCO

## Hallazgo verificado (30 de octubre de 2026)

El proyecto Supabase activo `cuitgyqrjibgwuniapmk` tenía
`UPDATE` **a nivel de tabla** concedido a `authenticated` y `anon`
sobre `public.organizations`. La política RLS
`organizations_update_settings_admin` exigía correctamente
`settings.edit`, pero RLS filtra **filas, no columnas**.

Por tanto, un usuario de una inmobiliaria con permiso legítimo para
personalizar su portal podía enviar una petición de API de datos para
modificar **`plan_id`** o **`status`** en *su propia organización*,
sin pasar por la suscripción y la función administrativa de pagos.

**No hay evidencia de explotación**. La revisión de estado agregado mostró
dos organizaciones y ninguna con exceso de cupo.

## Corrección

La migración
`supabase/migrations/20261030222000_restrict_organization_commercial_updates.sql`:

1. Revoca el `UPDATE` global de `anon` y `authenticated` en
   `public.organizations`.
2. Revoca expresamente permisos directos sobre `id`, `created_at`,
   `plan_id`, `status` y `slug`.
3. Concede `UPDATE` **solo** a `authenticated` sobre los datos
   operativos del portal: `name`, `legal_name`, `tax_id`,
   `email`, `phone`, `whatsapp`, `logo_url` y `updated_at`.
4. Mantiene el cambio de URL pública exclusivamente por la RPC
   `set_organization_public_slug`, que exige propietario activo,
   valida nombres reservados y deja auditoría.
5. Mantiene las políticas RLS que limitan la actualización a una
   inmobiliaria administrada por el usuario con `settings.edit`.
6. Conserva el permiso de `service_role` y los procedimientos privilegiados
   de facturación para actualizar `plan_id` o `status`.

La interfaz operativa del administrador utiliza
`UPDATE organizations SET name, updated_at` y permanece funcional.
SuperAdmin usa `billing_admin_action` para suspender o aprobar
inmobiliarias: esta función `SECURITY DEFINER` sigue ejecutándose
bajo su propietario autorizado, no bajo los permisos de la API pública.

## Verificaciones

El ensayo PostgreSQL 17 utiliza dos organizaciones ficticias con RLS.
Primero **demuestra** que un administrador legítimo podía alterar el
estado o plan con el permiso antiguo y luego aplica la migración:

- La misma cuenta puede seguir actualizando nombre y logo **solo** en
  su inmobiliaria.
- `plan_id`, `status`, `slug`, `id` y `created_at` dejan de ser editables
  directamente por `authenticated`.
- El propietario conserva el cambio de URL mediante la RPC auditada;
  ningún administrador puede saltarse su validación con un UPDATE directo.
- `anon` no puede modificar datos de organizaciones.
- La otra inmobiliaria no es editable (se conserva RLS por tenant).
- Las funciones administrativas propietarias y `service_role`
  mantienen sus privilegios.

La barrera reutilizable de solo lectura se encuentra en
`security/reviews/organization_commercial_columns_acl_gate.sql`.

### Alcance y límites

La corrección **no modifica** planes comerciales, suscripciones, órdenes
Wompi, contratos, integrantes de las inmobiliarias ni datos existentes.

El cambio evita manipulación directa de columnas comerciales a través
del Data API; **no sustituye** una revisión individual de todas las RPC
privilegiadas que pueden modificar licencias, ni evita que una reducción
autorizada del plan supere el uso actual. Esa validación de downgrade se
debe tratar por separado para no perder registros de pagos aprobados.

Documentación técnica: https://supabase.com/docs/guides/database/postgres/row-level-security
