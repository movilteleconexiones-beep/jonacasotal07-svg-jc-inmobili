# Permisos financieros por rol — INMOJCO
Regla autorizada: AGENT (Asesor) no registra ni corrige pagos. MANAGER (Coordinador) y superiores pueden registrar cobros ordinarios si tienen permiso específico. Rectificaciones sensibles solo ADMIN / ORGANIZATION_OWNER, con auditoría.

## Verificado en producción por consulta de solo lectura
- AGENT: sin rent_payments.create (correcto).
- MANAGER: sin rent_payments.create ni rent_payments.view (brecha funcional).
- ADMIN / ORGANIZATION_OWNER: con ambos permisos.
- La RPC record_tenant_rent_receipt exige has_org_permission(org, rent_payments.create).

## Criterios de aceptación
- En staging restaurado, conceder rent_payments.create y rent_payments.view solo a MANAGER de su propia organización, manteniendo aislamiento.
- No conceder permisos a AGENT.
- Probar con sesiones AGENT (denegado), MANAGER (admitido), MANAGER de otra organización (denegado), ADMIN (admitido).
- Probar importes > saldo, claves idempotentes y auditoría; requerir autorización administrativa para rectificaciones.
- No aplicar SQL a producción hasta recuperación auténtica #214 e historial de migraciones reconciliado #104.

Documento de diseño únicamente; ninguna migración aplicada.