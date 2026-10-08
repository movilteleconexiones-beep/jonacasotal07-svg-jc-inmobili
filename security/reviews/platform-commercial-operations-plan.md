# Diseño de operaciones comerciales protegidas — JCO

Proyecto oficial: `nqzopzhmhqdssgpljypu`. Documento de revisión; **no ejecuta cambios de producción**.

## Estado verificado
- `platform_list_organizations()` comprueba `is_platform_admin()` y devuelve organización, plan, facturación y métricas.
- `platform_set_subscription(target_org, target_plan_code, target_billing_mode, target_status)` comprueba `is_platform_admin()`, pero **no valida** listas permitidas para `target_billing_mode` y `target_status`, no verifica correspondencia entre `LIFETIME` y `PERPETUAL`, y no registra evento en `audit_log`.
- `organization_licenses.license_type` admite `SAAS`, `PERPETUAL`, `DEDICATED`, `WHITE_LABEL`; no es equivalente a `subscriptions.billing_mode`.
- El esquema `audit_log` permite registrar `organization_id`, `actor_user_id`, `action`, `entity_type`, `entity_id` y `metadata`.

## Requisitos antes de habilitar botones que modifiquen datos
1. RPC específica `platform_change_organization_status` con validación `auth.uid()` y administrador activo, estado permitido y transición explícita; prohibir actualizaciones directas de estado por personal de inmobiliarias.
2. RPC `platform_assign_contract` que compruebe plan existente, modo de facturación válido, duración y consistencia con la licencia. Evitar la función actual sin validaciones adicionales.
3. Toda modificación comercial debe registrar `audit_log` en la misma transacción con estado anterior y nuevo, actor, fecha y organización.
4. En la licencia `PERPETUAL`, establecer `copyright_transferred=false`, `resale_allowed=false`, `sublicensing_allowed=false`, `redistribution_allowed=false` salvo autorización contractual explícita; no confundir uso indefinido con propiedad intelectual.
5. Restringir RLS para impedir que `profiles.can_create_organization` o una suscripción permitan crear inmobiliarias al margen de aprobación central.
6. Pruebas negativas con usuario anónimo, autenticado común, propietario de inmobiliaria y superadministrador suspendido; pruebas positivas con superadministrador activo.
7. Solo después de pruebas en entorno aislado y autorización explícita, desplegar migración y habilitar controles de escritura en interfaz.

## Orden de entrega
- Lectura central (implementada en rama).
- Contratos y estado en modo consulta (siguiente).
- RPC endurecidas + auditoría en migración revisable.
- Pruebas aisladas y autorización de despliegue.
- Acciones comerciales habilitadas para Superadministrador.
