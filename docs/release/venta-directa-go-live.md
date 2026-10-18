# INMOJCO — puerta de lanzamiento comercial (GO/NO-GO)

Esta herramienta es **solo lectura**. Nunca cambia datos ni pagos, ni publica software.
Evalúa la evidencia local firmada/revisada de una liberación concreta mediante
`node scripts/release-readiness.mjs release-evidence.local.json commercial`.

El archivo de evidencia debe quedar **fuera del repositorio público** (y se excluye
por .gitignore si se prepara dentro del entorno de desarrollo). No incluir tokens,
secrets, contraseñas, números de tarjeta, datos personales, eventos firmados ni referencias
de pago individuales en logs de CI o PRs.

## Requisitos para marcar apto para vender

- CI verde **del commit exacto** candidato y migraciones revisadas.
- Copia privada PostgreSQL reciente, SHA-256, restauración aislada de esa
  **misma copia**, con fotos y PDF reales restaurados y comprobados.
- Aislamiento RLS A/B, roles de personal y clientes, acceso de SuperAdmin
  exclusivo y portales de propietario/inquilino.
- Flujos contables completos: contrato, cobro, abonos, deducciones, liquidación.
- Invitaciones/correos y recuperación de contraseña.
- Wompi Sandbox: evento firmado e idempotencia (sirve solo como simulación).
- Wompi **producción**: orden real APPROVED y APPLIED, conciliación contra
  proveedor, suscripción y licencia activadas para el comprador, webhooks
  duplicados idempotentes, renovación y suspensión ensayadas.
- Configuración y autorización comercial explícita del propietario del SaaS
  y rollback revisado.

**No confundir la orden Sandbox APPROVED/REVIEW_REQUIRED del 17/10/2026 con
una venta comercial.** No conciliarla como si fuese producción. Wompi comercial
continúa deshabilitado en INMOJCO hasta prueba real controlada.

La evidencia declarativa no sustituye inspección independiente. Nunca establecer
valores `true` para simular una prueba inexistente. La salida PASS solo indica
que la lista fue completada, no que todas las operaciones están demostradas.
