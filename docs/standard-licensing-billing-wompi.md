# Estándar JCO: licencias, suscripciones y cobros

**Estado:** especificación de implementación; no autoriza cobros, migraciones ni despliegues.

## Estructura comprobada en Supabase (2026-10-08)

- `plans`: `code`, `name`, `billing_cycle`, `price`, `currency`, límites de usuarios, inmuebles, almacenamiento y créditos IA, `active`. Planes observados: BASIC (MONTHLY), PRO (MONTHLY), ENTERPRISE (CUSTOM), LIFETIME (ONE_TIME).
- `subscriptions`: `organization_id`, `plan_id`, `status`, `billing_mode`, períodos, fechas de cancelación y referencias externas.
- `organization_licenses`: `organization_id`, `license_type`, `status`, vigencia y derechos contractuales (white-label, código fuente, redistribución, sublicencia, etc.).
- `license_acceptances`: aceptación de términos por versión, fecha, responsable y texto de los términos.
- Restricciones existentes: `plans.billing_cycle` admite MONTHLY, ANNUAL, ONE_TIME, CUSTOM; `subscriptions.billing_mode` admite SAAS_MONTHLY, SAAS_ANNUAL, LIFETIME, DEDICATED, CUSTOM; `subscriptions.status` admite TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, LIFETIME; `organization_licenses.license_type` admite SAAS, PERPETUAL, DEDICATED, WHITE_LABEL.

## Reglas de negocio

1. **Identidad:** el SUPER_ADMIN de plataforma se verifica independientemente de cualquier organización o licencia; el propietario de una inmobiliaria no adquiere privilegios de plataforma.
2. **Tenant:** cada suscripción y licencia pertenece a una sola `organization_id`; el servidor comprueba acceso y autorización en cada lectura/escritura. Nunca confiar solo en filtros del navegador.
3. **Modalidades:** mensual = `SAAS_MONTHLY`; anual = `SAAS_ANNUAL`; vitalicia = `LIFETIME`. Los planes del catálogo pueden ofrecer diferentes ciclos; no inferir el ciclo únicamente del nombre BASIC/PRO.
4. **Vitalicia:** pago único, sin renovación periódica de licencia; no implica transferencia de derechos de autor, código fuente, sublicencias, hosting, dominios o servicios externos. Los derechos se determinan por contrato y `organization_licenses`, nunca por `billing_mode` solamente.
5. **Estado efectivo:** una inmobiliaria `INACTIVE` o `SUSPENDED` no obtiene acceso operativo por tener suscripción activa. Un pago pendiente o rechazado nunca activa la licencia. Los períodos vencidos requieren política explícita de gracia y renovación.
6. **Contrato:** mostrar y registrar aceptación de versión de términos antes de activar derechos contractuales; guardar instantánea inmutable y responsable de aceptación.
7. **Precios:** guardar montos, moneda (COP cuando corresponda), impuestos, descuentos y vigencia de oferta del lado servidor; el cliente no determina el valor cobrado.
8. **Trazabilidad:** toda alta, cambio, suspensión, reactivación y pago confirmado debe registrar actor, organización, fecha y motivo; las operaciones sensibles deben ser idempotentes.
9. **Pagos Wompi:** iniciar únicamente en sandbox. Crear referencia única por pedido en servidor; nunca publicar claves privadas ni secretos de integridad. Verificar firma, monto, moneda, referencia, estado y unicidad de eventos recibidos; consultar/confirmar estado con proveedor cuando proceda. Solo el servidor cambia la suscripción después de confirmación válida; no confiar en la página de retorno del navegador.
10. **Ambientes:** separar credenciales, URL de retorno, webhooks y datos de sandbox y producción. No habilitar pagos reales sin pruebas integrales y autorización explícita.
11. **Compatibilidad:** no alterar el diseño público de `www.inmojco.com`; la administración comercial es un módulo privado. No modificar la estructura de producción sin migración revisada y copia de seguridad.

## Flujo previsto

1. SUPER_ADMIN publica oferta de plan y condiciones comerciales.
2. Agencia selecciona modalidad y acepta términos aplicables.
3. Servidor crea orden PENDING con precio/moneda fijados, identificador único y fecha de vencimiento.
4. Cliente completa checkout Wompi sandbox.
5. Webhook autenticado y verificación servidor-servidor confirman resultado.
6. Una transacción idempotente registra pago, suscripción, licencia y auditoría; fallo o pendiente no conceden acceso.
7. Renovación, suspensión, cancelación y reembolso se manejan como eventos auditables y no como cambios manuales sin control.

## Pendientes obligatorios antes de implementar

- Revisar RLS, SECURITY DEFINER, funciones `platform_set_subscription` y `create_custom_role`, políticas de acceso a `platform_admins`, y endurecer permisos.
- Diseñar tablas de órdenes, pagos, eventos Wompi y auditoría si no existen; verificar antes el esquema real.
- Definir catálogo comercial (precio, moneda, impuestos, período de gracia y prestaciones), aceptación legal y política de reembolsos.
- Implementar pruebas: separación entre agencias, usuario no autorizado, pago duplicado, firma inválida, importe distinto, callback falso, reintentos, pago tardío, reembolso y cambio de plan.
- Validar la integración de punta a punta en sandbox y solicitar aprobación antes de producción.

## Criterio de aceptación

No se considerará listo el módulo hasta que una prueba automatizada y una prueba funcional demuestren: alta y renovación correcta, aislamiento por organización, validación de webhook, idempotencia, revocación de acceso por estado y ausencia de exposición de secretos.
