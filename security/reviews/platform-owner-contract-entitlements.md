# Administración central de JCO — contrato y privilegios

## Situación verificada (8 de octubre de 2026)

La base de datos existente contiene `platform_admins(user_id, admin_level, active, created_at)`, `plans`, `plan_features`, `subscriptions`, `organization_licenses`, `license_acceptances` y `organization_settings`. La consulta de solo lectura a `platform_admins` devolvió cero filas. No se ha asignado ninguna identidad ni cambiado producción.

## Autoridad y aislamiento

1. El propietario/desarrollador de JCO debe ser provisionado como superadministrador **fuera del registro público**, verificando primero el ID de su cuenta autenticada. Nunca se concede este privilegio mediante email introducido por el navegador, metadatos editables, o un rol de inmobiliaria.
2. La autoridad de plataforma debe verificarse **en PostgreSQL** contra `platform_admins` con `active=true` en cada operación privilegiada. La interfaz puede ocultar botones, pero no constituye autorización.
3. El administrador de una inmobiliaria solo gestiona su propia organización; no puede conceder planes, cambiar derechos comerciales, elevarse a administrador de plataforma ni editar suscripciones o licencias de otras organizaciones.
4. Toda modificación de contratos, límites, funciones y privilegios de plataforma requiere registro de auditoría (actor, organización, valores anteriores/nuevos, fecha y motivo).

## Contratos y funciones

- `plans` define los paquetes comerciales; `plan_features` sus funciones y límites.
- `subscriptions` determina la vigencia y estado de la contratación por organización.
- `organization_licenses` y `license_acceptances` determinan las condiciones jurídicas aceptadas; no sustituyen la validación del pago.
- `organization_settings` son preferencias operativas y **no deben poder ampliar** lo que autoriza el plan contratado.
- El permiso efectivo requiere simultáneamente: organización activa, suscripción válida o prueba vigente, función incluida en plan/convenio, límite disponible y permiso del usuario en su organización.
- La expiración, suspensión, cambios de plan y excepciones comerciales deben evaluarse en servidor; el frontend no puede habilitar funciones restringidas manipulando estado local.

## Implementación pendiente y pruebas

1. Confirmar el usuario de Auth del propietario y definir el nivel exacto de `platform_admins` según las restricciones reales del esquema.
2. Preparar migraciones SQL revisables, **sin aplicarlas en producción**, para políticas RLS y funciones de administración central; ensayarlas primero en PostgreSQL aislado.
3. Construir el panel del superadministrador: listado de inmobiliarias, contratos, planes, habilitación de módulos, límites, fechas, suspensiones y auditoría.
4. Incorporar verificaciones server-side de derechos comerciales y pruebas de regresión para impedir que un administrador de inmobiliaria cambie su propio contrato o consulte otra empresa.
5. Integrar Wompi sandbox con verificación de firmas y eventos idempotentes antes de habilitar cobros reales.

**Regla de despliegue:** no asignar superadministrador ni ejecutar cambios sobre Supabase de producción sin autorización explícita del propietario.
