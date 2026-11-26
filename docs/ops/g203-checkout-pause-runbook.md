# G203 — Pausa comercial independiente (candidato, NO aplicado)

## Alcance
- `production_checkout_paused` es un control de emisión de nuevas órdenes. Valor inicial false; no cambia el acceso de clientes.
- Mantener `production_enabled=true`, `activation_mode=VERIFIED_PAYMENT` y el webhook vigente para conservar la aplicación normal de pagos en tránsito.
- No usar el interruptor global ni MANUAL como pausa selectiva.
- Una URL Wompi emitida antes de la pausa puede seguir siendo válida hasta el vencimiento de su orden. No prometer la cancelación retroactiva.
- La Edge Function vigente traduce errores de orden no reconocidos a HTTP 409 checkout_unavailable, aunque el RPC devuelve PT503. No afirmar que el gateway responde 503.

## Evidencia previa
`docs/ops/qa/g203_checkout_pause_clone_rollback.sql` conserva el ensayo real ejecutado el 26-nov UTC: proyecto clon autorizado, BEGIN/ROLLBACK, orden sintética previa, pausa selectiva, rechazo de nueva orden, evento aprobado aplicado una sola vez, reintento duplicado, licencia SaaS activa y licencia permanente protegida. Claims SQL simulados. Sin Wompi ni dinero real.

## Operación después de aprobación e instalación (no ejecutar mientras sea candidato)
Solo operador privilegiado, con registro de incidente y hora UTC; verificar previamente el valor vigente y disponibilidad del webhook. Cambiar únicamente la columna de pausa mediante transacción corta. Confirmar estado en lectura independiente. No conceder UPDATE a authenticated o anon ni implementar un endpoint de mutación sin autorización.

La reapertura requiere identificar las órdenes APPROVED con fulfillment_status distinto de APPLIED, cotejar importe, referencia, transacción y evento verificado; escalar cualquier discrepancia. No crear pagos adicionales ni restaurar DB sobre operaciones posteriores. Mantener el monitor horario.

## GO técnico de la pausa
CI verde, SQL exacto verificado en clon, prueba de reversión del esquema, paridad de definición y permisos, configuración inicial false en producción y recuento de pagos pendientes. La UI actual conserva rechazo del backend; se puede mejorar el mensaje visible mediante un cambio coordinado posterior sin relajar el servidor. No se dispone aún de certificación HTTP concurrente de la pausa ni del proceso de conciliación LIVE manual.
