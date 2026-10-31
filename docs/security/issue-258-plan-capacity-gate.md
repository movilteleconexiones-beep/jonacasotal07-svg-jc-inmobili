# #258 — Protección de capacidad al modificar planes (diseño de implementación)

Estado: análisis de las funciones existentes en Supabase de producción (solo lectura). **Este documento no implementa aún la migración ni autoriza su publicación.**

## Puntos de entrada verificados
- `public.billing_admin_action(..., 'APPROVE', ..., target_plan)`: actualiza `organization_billing_access` y `organizations.plan_id`.
- `public.platform_set_subscription(...)`: actualiza `subscriptions`, `organization_licenses` y `organizations.plan_id`.
- `public.process_verified_payment_event(...)`: registra `payment_events`, `payment_orders` y, según su `reason`, activa suscripción o establece `REVIEW_REQUIRED`.
- `jco_private.enforce_internal_seat_limit`: cuenta `organization_members` activos, excluyendo `jco_private.is_external_only_member`.
- `jco_private.enforce_plan_limit`: en propiedades cuenta **todas** las propiedades de la organización.
- No existe trigger de UPDATE de `plan_id` sobre `organizations` en el esquema inspeccionado.

## Regla de capacidad propuesta
Dentro de una transacción, tomar bloqueo `FOR UPDATE` sobre la organización, leer el plan de destino y verificar:
- `used_seats = count(*)` de `organization_members` con `status='ACTIVE'` y no exclusivamente externos.
- `used_properties = count(*)` de **todas** las filas de `public.properties` de esa organización.
- Rechazar cambios administrativos que excedan límites no nulos con error y sin modificar suscripción/licencia.
- En pagos Wompi aprobados, agregar `plan_capacity_review` al cálculo existente de `reason`, **antes** de registrar el evento financiero. El webhook debe finalizar correctamente, registrar el pago y dejar `fulfillment_status='REVIEW_REQUIRED'` sin cambiar la licencia ni el plan.
- Respetar `review_reason` existentes con prioridad de motivos adecuada; nunca sobrescribir eventos de pago ya registrados.
- No introducir un trigger que revierta una transacción Wompi aprobada antes de adaptar y probar el flujo de revisión.
- Validar que activaciones y cambios de plan no se salten la comprobación mediante accesos alternativos de service_role; evaluar protección de columna/trigger solo después de cubrir el webhook.

## Pruebas obligatorias previas a fusionar
1. PRO -> BASIC con 6 usuarios internos: bloqueado, sin cambios de estado.
2. PRO -> BASIC con 201 inmuebles: bloqueado, sin pérdida de datos.
3. 5 usuarios internos + usuarios solo CLIENT: permitir si hay <=200 inmuebles.
4. Usuario con rol CLIENT y rol interno: cuenta como asiento interno.
5. Pago Wompi sandbox aprobado y plan incompatible: se registra evento y orden aprobada, `REVIEW_REQUIRED` con `plan_capacity_review`; no se modifica suscripción.
6. Evento Wompi repetido: idempotencia (duplicate).
7. Concurrencia con inserción de miembro/inmueble y cambio de plan: bloqueo serializado por organización.
8. Modo prueba, planes ilimitados y límites NULL.
9. Excepción histórica #254: conservar acceso sin revocación.
10. Verificar RLS, grants, `search_path`, auditoría y que no se habiliten pagos de producción.

## Requisito de despliegue
Implementar migración versionada y pruebas en PostgreSQL 17 aislado. Aplicar cambios de código del repositorio y base de datos solo después de revisar resultados y confirmar un plan de reversión; sin editar datos de las inmobiliarias.
