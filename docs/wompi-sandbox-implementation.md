# Wompi Sandbox: contrato técnico y límites de confianza

**Estado:** preparación de código. No hay checkout ni webhook operativo.

El archivo `src/core/billing-contract.ts` define los modos comerciales `SAAS_MONTHLY`, `SAAS_ANNUAL`, `LIFETIME`, estados de notificación y validadores de estructura para COP en centavos. **Estos validadores no prueban la autenticidad de un pago** y nunca deben activar una suscripción por sí mismos.

## Implementación de servidor pendiente

1. Autenticar a quien solicita checkout y comprobar que administra la `organization_id` correspondiente.
2. Leer plan, moneda, precio y vigencia desde la base de datos; nunca aceptar el importe del navegador como fuente de verdad.
3. Persistir una orden PENDING con referencia única y monto inmutable. Diseñar tablas y RLS mediante migración revisada.
4. Crear sesión/checkout de Wompi sandbox con credenciales adecuadas y firma de integridad calculada exclusivamente en el servidor.
5. Recibir eventos Wompi en endpoint de servidor con verificación criptográfica según la especificación vigente del proveedor; confirmar estado, referencia, monto, moneda y transacción con Wompi cuando corresponda.
6. Evitar reprocesar eventos repetidos (idempotencia y bloqueo transaccional). Activar suscripción solo cuando exista confirmación auténtica APPROVED para la orden correspondiente.
7. Registrar auditoría y eventos rechazados sin incluir secretos ni datos de tarjeta.
8. Probar redirecciones falsificadas, firmas inválidas, importes diferentes, eventos duplicados, transacciones fuera de orden y acceso entre agencias.

## Variables de entorno

- Frontend: únicamente clave pública de sandbox si el proveedor y la integración la requieren.
- Backend/Edge Function: claves privadas, secretos de integridad y eventos; nunca prefijo `VITE_` para secretos.
- Separar por completo sandbox y producción. No habilitar producción hasta completar revisión y autorización.

## Nota de seguridad

No usar `platform_set_subscription` como webhook de pagos: actualmente permite a un superadministrador modificar el estado de una suscripción sin prueba de transacción. Debe quedar fuera del flujo de cobros automáticos hasta ser endurecida.

No se ha modificado Supabase ni el sitio público.
