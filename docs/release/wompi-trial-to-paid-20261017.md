# INMOJCO — Conciliación controlada de Wompi Sandbox

## Incidente comprobado

- Checkout Wompi Sandbox: Básico, COP 129.900.
- La función Supabase `billing` procesó un evento `APPROVED` de Wompi: firma válida, transacción identificada, un único evento y una sola orden aprobada.
- La orden conserva `fulfillment_status=REVIEW_REQUIRED` y `review_reason=contract_review` porque la inmobiliaria de pruebas mantenía una suscripción `TRIAL` al plan Profesional y compró Básico.
- Producción real `production_enabled=false`. No hay ventas reales activadas por este procedimiento.

## Cambios propuestos

1. El RPC `process_verified_payment_event` mantiene la revisión obligatoria de cambios entre planes *pagados vigentes*, licencias especiales y suspensiones; permite convertir un `TRIAL` válido a su primer plan pagado, conservando los días restantes y sumando la vigencia comercial comprada.
2. El RPC `billing_admin_reconcile_verified_trial_payment(uuid,text)` permite a SuperAdmin, **solo en Sandbox**, aplicar una vez el pago aprobado retenido: valida evento de Wompi firmado y procesado, referencia, importe, elegibilidad y situación del contrato. Toda acción queda auditada.
3. El panel SuperAdmin muestra una acción para órdenes de esa inmobiliaria en `APPROVED/REVIEW_REQUIRED/contract_review`; exige justificación de al menos diez caracteres.
4. El procedimiento de reversión restaura la regla anterior y elimina la nueva RPC, **sin borrar ni modificar pagos aprobados, licencias ya aplicadas ni sus eventos**.

## Pruebas

- PostgreSQL aislado de GitHub Actions: futuro TRIAL Profesional → Básico aplicado; duplicado no aplica dos veces; conciliación de orden aprobada retenida una sola vez; usuario corriente y service_role sin acceso de SuperAdmin; bloqueo de contrato pagado vigente; tenant vecino no modificado.
- UI de SuperAdmin: filtro de órdenes por organización, firma/estado/revisión, autorización y ausencia de actualizaciones directas a tablas de suscripciones desde navegador.
- Reversión ensayada en PostgreSQL aislado: restaura el comportamiento anterior y mantiene inalterado el evento aprobado original.

## Preflight de producción (READ ONLY)

Antes de cualquier despliegue, verificar que el proyecto Supabase sigue en `ACTIVE_HEALTHY`; `sandbox_enabled=true`, `production_enabled=false`, `activation_mode=VERIFIED_PAYMENT`; existe exactamente una orden en `APPROVED/REVIEW_REQUIRED/contract_review` para una cuenta `is_test` con suscripción `TRIAL` vigente. Confirmar que todos los predicados del RPC, incluida la firma del único evento Wompi, son verdaderos.

## Publicación y recuperación — BLOQUEO ACTUAL

**NO fusionar ni ejecutar la migración en producción** mientras no se disponga de:
1. Copia de respaldo consistente y restauración REAL comprobada de las tablas financieras y roles afectados (`payment_orders`, `payment_events`, `subscriptions`, `organization_licenses`, `organizations`, `organization_billing_access`, `audit_log`).
2. Ensayo sobre staging que represente el esquema real de producción y su prueba de recuperación; CI con datos ficticios es necesario pero no sustituye restauración.
3. Revisión del alcance, política de reversión y ventana controlada de publicación. Railway debe permanecer estable; no activar `production_enabled`.
4. Después de migrar, probar la visibilidad de la orden para SuperAdmin y conciliar **sin repetir el pago**, con revisión posterior del único evento Wompi, suscripción pagada, plan Básico, auditoría y tenant vecino.

Las ramas Supabase no están disponibles en el proyecto actual Free. No elevar el plan sin consentimiento informado de costos; mientras tanto mantener este PR como **DRAFT**.

### Archivos
- Migración: `supabase/migrations/20261017090000_verified_trial_to_paid_reconciliation.sql`.
- Rollback acotado: `security/rollback/wompi_trial_to_paid_20261017.sql`.
- Ensayos: `security/tests/wompi_verified_trial_conversion_assertions.sql`, `security/tests/wompi_trial_to_paid_rollback_assertions.sql`.
- UI: `src/modules/platform/BillingAdminControls.tsx`.

> Recordatorio: no enviar las claves Sandbox, `checkoutUrl` completo, firmas ni datos del pagador al chat, consola pública o PR.
