# G12 — activación controlada de cobros Wompi LIVE · 13-nov-2026

**Autorización del propietario recibida:** avanzar para habilitar pagos reales de licencias en Sistema Inmobiliario JCO, con dominio canónico `https://www.inmojco.com/`. La autorización **no prueba un pago ni suple el consentimiento del comprador, el contrato o los documentos de tratamiento de datos**.

## Evidencia actual (consultas independientes, sin modificaciones)

- Supabase **oficial**: `cuitgyqrjibgwuniapmk` (NO utilizar el clon `zjgstfgiirgjssnihaam` para transacciones reales).
- `billing_activation_settings`: `production_enabled=false`, `sandbox_enabled=true`, `activation_mode=VERIFIED_PAYMENT`.
- Edge Functions `billing` (Sandbox) y `billing-production` **ACTIVE**. El servicio Railway de Wompi es Sandbox; el gateway LIVE está aislado en **Supabase Edge**, no hay que convertir ni eliminar el Sandbox.
- Ruta webhook oficial **LIVE** prevista por código:
  `https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/billing-production/events`.
- Prefijos correctos de cuatro secretos LIVE presentes en función Edge de producción según evidencia anterior, pero **no se ha certificado que correspondan al mismo comercio**. No escribirlos en este archivo, el navegador, GitHub o capturas.
- Función `process_verified_payment_event` existe y solo `service_role` tiene `EXECUTE`; `anon` está bloqueado.
- Catálogo comercial actual: BASIC `129900 COP/MONTHLY` (5 usuarios), PRO `299900 COP/MONTHLY` (25 usuarios); `LIFETIME` y ENTERPRISE quedan fuera del checkout de planes mensuales.
- Dos organizaciones actuales: `sistema-inmobiliario-jco` tiene `is_test=true` (Sandbox exclusivo). `jco-inmodigital-global` pertenece al propietario SuperAdmin, `is_test=false`, pero ya tiene suscripción **LIFETIME**. **No cargar una nueva cuota al SuperAdmin ni inventar un comprador.**
- Ordenes existentes: 8 en Sandbox (1 APPROVED/APPLIED), **0 en producción**. Ninguna venta real ha sido demostrada.
- El archivo `security/legal/approved-policy-publication.json` y los PDF oficiales en `public/politicas/` **no están presentes** en `main` al ejecutar la auditoría. Los borradores y actas con placeholders **no son autorización legal**. La puerta G07 #370 sigue abierta.

El SQL `security/reviews/g12_wompi_live_readiness_readonly.sql` se ejecutó en producción en transacción `BEGIN READ ONLY/ROLLBACK`: **6 PASS, 3 FAIL y 3 NOT_VERIFIED**. La calificación NO es una autorización de venta.

## Orden de cierre seguro: sin cobro prematuro

1. **Adopción jurídica auténtica**: titular legal de la plataforma y de cada inmobiliaria, NIT/ID, domicilio, canal hábeas data, representante firmante, políticas completas sin marcadores de borrador, actas firmadas y PDF HTTPS verificable. Registrar hash y versión. No atribuir automáticamente a una marca los datos fiscales de otra actividad. La obligación de política y consentimiento informado surge de Ley 1581/2012 y Decreto 1074/2015, conforme a SIC; no se requiere una certificación previa de la SIC.
2. **Comercio Wompi LIVE**: confirmar que las cuatro claves LIVE pertenecen al MISMO comercio y que el Dashboard **PROD** tiene registrada como URL de eventos exactamente `https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/billing-production/events`. Mantener URL distinta para Sandbox. Validar rechazo de firmas incorrectas y estado de transacción servidor→Wompi por llave privada; nunca activar licencias por retorno del navegador.
3. **Comprador piloto real, independiente del SuperAdmin**: dar de alta una inmobiliaria real con titular y consentimiento válidos; NO reutilizar la inmobiliaria vitalicia ni la de Sandbox. Confirmar el plan y el importe completo a pagar antes de que el comprador inicie Wompi; no crear datos falsos para una transacción bancaria.
4. **Activación de piloto**: después de respaldos comprobables y las verificaciones precedentes, registrar la autorización en #203; habilitar `billing_activation_settings.production_enabled=true` mediante cambio puntual auditado y postflight. **No ejecutarlo antes**: la bandera es GLOBAL y cualquier agencia apta podría cobrar de inmediato. De ser necesario, implementar un alcance piloto en backend antes de habilitar la bandera global; un toggle frontend no es una barrera de seguridad.
5. **Pago verdadero controlado**: el comprador realiza la transacción por Wompi, con consentimiento y precio explícitos. Comprobar en base de datos y con Wompi el mismo `id/reference/amount_in_cents/currency/status`. Exigir `environment=production`, orden `APPROVED`, `fulfillment_status=APPLIED`, licencia/suscripción activa y acceso correcto.
6. **Idempotencia y regresión**: reenviar evento firmado legítimo de forma controlada; 0 órdenes o licencias duplicadas, mismo período y sin corrupción. Probar rechazados, inconsistencias y revisión manual. Confirmar cancelación, suspensión, recuperación, notificación al comprador, monitoreo y rollback.
7. **Apertura general**: solo después de certificado piloto, aceptación legal y GO firmado de #203; validar de nuevo con SQL, portal público y navegador. Mantener G07 consignación/CRM cerrada donde no haya política propia, incluso si se habilita cobro central de licencias.

Fuentes oficiales:
- Wompi: https://docs.wompi.co/docs/colombia/eventos/ (URL de eventos distinta por entorno, checksum SHA256)
- Wompi: https://docs.wompi.co/docs/colombia/transacciones/ (consulta con llave privada, estado aprobado)
- SIC: https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/politicas-de-tratamiento-de-datos-personales

**Nunca declarar 100 % ni cerrar #203 solo por habilitar `production_enabled`.** 

## Prueba reversible adicional de todo el ciclo SQL LIVE (sin dinero real)

Se ejecutó `security/tests/g12_clone_only_live_billing_rollback.sql` en `zjgstfgiirgjssnihaam` y obtuvo:

`PASS: simulated LIVE billing RPC, one order, idempotent event, active license, SuperAdmin protected; ALL SQL WRITES ROLLED BACK (NO MONEY CHARGED)`

**Alcance real de la prueba:** bajo JWT/roles **simulados por SQL**, tomó temporalmente la agencia QA ya existente, la convirtió en compradora no-test exclusivamente dentro de `BEGIN/ROLLBACK`, activó el flag LIVE solo en esa transacción y llamó a la RPC real `billing_create_order` con el plan Básico. Confirmó orden pendiente `production` e importe correcto, reintento idempotente de orden, invocó `process_verified_payment_event` desde `service_role` con un evento **sintético**, verificó orden `APPROVED/APPLIED`, un evento, período ampliado y licencia SAAS activa; segundo evento obtuvo `duplicate` y la licencia `LIFETIME` SuperAdmin no cambió. **No contactó Wompi ni probó firmas o JWT reales**, por lo tanto esta simulación NO prueba una venta, pago bancario, ni el webhook externo.

**Postflight independiente de lectura en CLON y PRODUCCIÓN:** `production_enabled=false`, la agencia QA siguió `is_test=true`, 0 órdenes y eventos `production`, inmobiliaria SuperAdmin siguió con suscripción `LIFETIME`. Ninguna mutación quedó persistida. La regresión tiene contrato estático en CI para evitar ejecuciones sin `ROLLBACK`.
