# G07/#370 — Bloqueo de ACL de recepción pública antes de firmas

## Riesgo y corrección temporal

En producción, ambas recepciones `private.property_intake_sites.enabled=false` impedían generar consignaciones, pero `get_public_property_intake_site` y `submit_property_consignment` todavía concedían EXECUTE a `anon` y `authenticated`. Una reactivación accidental del sitio podía habilitar la captación de nombre/teléfono sin PDF, versión y firma aprobados.

`security/ops/g07_freeze_public_consignment_until_approved.sql` suspende exclusivamente las dos RPC públicas para `anon` y `authenticated`. Conserva el catálogo público, el acceso `service_role` para integraciones internas y todos los registros de inmobiliarias, consignaciones, fotos, contratos, licencias y finanzas. La consulta web del formulario queda inaccesible incluso si alguien cambia `enabled` por error. El modal existente muestra el mensaje de recepción no disponible y no captura PII.

La revocación es temporal y **NO equivale al esquema definitivo G07**. Las reglas completas de política por agencia, hash, versión, recibo inmutable y control de fotos están preparadas en `security/candidates/g07_consignment_private_approval_consent_REVIEW_ONLY.sql` y **no se habilitarán hasta políticas auténticas**.

## Evidencia obligatoria / liberación

1. Ejecutar esta revocación en clon dentro de transacción y `ROLLBACK`; comprobar anónimo y autenticado bloqueados, servicio y catálogo intactos.
2. CI de rama y verificación de que el formulario permanece cerrado ante RPC no disponible.
3. Aplicar como migración individual y controlada en Supabase, sin `supabase db push` por #104.
4. Verificar permisos efectivos de las cuatro funciones y los conteos de datos reales; recalcular el Security Advisor.
5. Verificar HTTP público de ambas inmobiliarias y catálogo; dejar comentario verificable en #203 y #370.

## Reapertura

**Nunca ejecutar un GRANT simple para reabrir.** Publicar PDFs y actas firmadas con hash SHA-256 auténtico, aplicar la migración de aprobaciones/recibos G07 con SQL + Edge verificados y solo entonces restituir los permisos públicos mediante revisión con dos tenants, JWT y rechazo de política revocada. No producir consentimientos sintéticos en producción.

La venta Wompi LIVE es otra puerta de lanzamiento independiente. 
