# INMOJCO — auditoría de contratos y suscripciones

Fecha: 2026-10-09. Estado: **revisión técnica; no desplegar cambios de facturación todavía**.

## Hallazgos confirmados en Supabase (solo lectura)

- `public.platform_set_subscription(target_org uuid, target_plan_code text, target_billing_mode text, target_status text)` es `SECURITY DEFINER`, ejecutable por `authenticated`, y verifica `public.is_platform_admin()`.
- La función acepta un plan por código sin verificar `plans.active`; tampoco valida explícitamente compatibilidad entre plan, modalidad y estado. Las restricciones CHECK sí rechazan valores desconocidos para `subscriptions.billing_mode` y `subscriptions.status`.
- El `INSERT ... ON CONFLICT (organization_id) DO UPDATE` reinicia `current_period_start` y `current_period_end` en cada asignación, incluso cuando solo cambia un dato. Esto puede alterar derechos de acceso y fechas de vencimiento.
- La misma operación cambia `organizations.status` a `ACTIVE` o `SUSPENDED` según el estado de suscripción. Se debe definir por separado el estado comercial y el estado administrativo de la inmobiliaria.
- `subscriptions.organization_id` tiene índice UNIQUE y clave foránea a `organizations.id`. Existen políticas RLS para gestión por plataforma.
- Los planes BASIC, PRO, ENTERPRISE y LIFETIME figuran activos con precio USD 0,00; no son tarifas comerciales aprobadas.
- La función de lectura `platform_list_organizations()` incluye `subscription_status`, `billing_mode`, `plan_code` y `plan_name`.

## Cambios requeridos antes de habilitar el botón «Asignar contrato»

1. Validar `target_org` existente, `target_plan_code` activo y modalidad/estado permitidos mediante lista explícita, con errores controlados.
2. Definir matriz comercial de compatibilidad: mensual, anual, perpetua, dedicada y personalizada; prohibir asignaciones contradictorias.
3. Separar suspensión de acceso de la suspensión/cancelación de cobro. No reactivar automáticamente inmobiliarias suspendidas administrativamente.
4. Preservar fechas de períodos existentes cuando la operación no es una renovación explícita. Diseñar una operación de renovación independiente.
5. Añadir auditoría inmutable con actor, organización, valores anteriores y nuevos, fecha y motivo; nunca guardar credenciales.
6. Probar concurrencia de cambios sobre una misma organización, incluyendo rollback y condiciones de carrera.
7. Verificar permisos con usuario plataforma activo, usuario plataforma inactivo, miembro de organización y usuario ajeno.
8. Verificar que Wompi sandbox y los eventos de pago no puedan conceder acceso mediante datos enviados por el navegador.
9. Ejecutar migración y pruebas primero en entorno aislado. No utilizar el borrador de migración experimental 0033 de la rama security/billing-role-concurrency-tests.

## Casos mínimos de aceptación

| Caso | Resultado esperado |
| --- | --- |
| Usuario sin rol plataforma llama RPC | Denegado, sin cambios |
| Plan inexistente o inactivo | Denegado, sin cambios |
| Organización inexistente | Denegado, sin cambios |
| Modalidad incompatible con el plan | Denegado, sin cambios |
| Repetir asignación idéntica | No reinicia período ni duplica auditoría de cambio |
| Suspender suscripción | No modifica inadvertidamente el estado administrativo |
| Renovación anual | Fecha correcta y auditada |
| Dos solicitudes simultáneas | Resultado serializable y consistente |
| Pago rechazado o evento duplicado | Sin activación indebida |
| Cliente de otra inmobiliaria | No ve ni modifica suscripciones ajenas |

## Estado de publicación

Este documento es un plan de implementación basado en lectura de esquema y funciones; **no es una migración aplicada ni una prueba superada**. Se requiere aprobar reglas comerciales y completar pruebas en staging antes de habilitar escrituras en producción.
