# INMOJCO — protección de funciones reservadas al servidor

## Revisión directa en Supabase (30 de octubre de 2026)

La consulta de catálogo PostgreSQL en el proyecto activo
`cuitgyqrjibgwuniapmk` confirmó que **11 funciones sensibles** permanecen
inaccesibles para `anon` y `authenticated`, y ejecutables por
`service_role`:

- `process_verified_payment_event`: registra la aprobación de un pago
  previamente verificado por el servidor; nunca debe ser invocable por
  un cliente web para adjudicarse suscripciones.
- `platform_set_subscription`: configuración administrativa de licencias.
- `billing_admin_authorize_trial`: RPC histórica deshabilitada; no reabrir.
- `resolve_consignment_photo_submission`: resolución privada de archivos.
- `apply_default_role_permissions`, `guard_client_portal_role_grants`,
  `guard_lease_activation_property_state`,
  `guard_property_contract_availability`, `handle_new_user`,
  `normalize_license_acceptance` y `prevent_duplicate_active_commission`:
  activadores privados del esquema.

La mayoría de las demás RPC administrativas son invocables por usuarios
autenticados **para permitir acciones con comprobaciones internas de permisos**.
No deben revocarse en masa: sus contratos, pagos y formularios dependen de
ellas. En el análisis se comprobaron los límites de delegación de
`create_organization_with_owner`, `platform_list_organizations`,
`platform_organization_overview` y `review_property_consignment`. La
revisión de cada ruta transaccional sigue siendo una tarea separada.

## Guardarraíl de regresión

`security/reviews/service_only_privileged_rpc_gate.sql` es **SQL de
inspección sin modificaciones** y verifica mediante `pg_catalog`:

1. Que las 11 firmas existen y conservan `SECURITY DEFINER`.
2. Que su `search_path` está fijado.
3. Que `anon` y `authenticated` **no** pueden ejecutarlas.
4. Que `service_role` conserva permiso de ejecución.
5. Que siete funciones de activadores siguen devolviendo `trigger`.
6. Que sobrecargas nuevas de los mismos nombres no conceden permisos
   accidentalmente a clientes web.

La CI ejecuta la inspección sobre una base PostgreSQL 17 desechable,
con procedimientos ficticios, y provoca deliberadamente accesos indebidos,
permisos públicos implícitos, bloqueo del rol de servicio, sobrecarga pública
y eliminación del `search_path`. Cada caso debe ser **rechazado**.

**No se aplican migraciones ni cambios de ACL a la base real.** La prueba
no certifica por sí sola la seguridad funcional de cada RPC administrativa;
el aislamiento por inmobiliaria se sigue comprobando mediante las pruebas
de las operaciones y las políticas RLS.

Referencias: documentación Supabase sobre [Data API](https://supabase.com/docs/guides/api/securing-your-api)
y [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
