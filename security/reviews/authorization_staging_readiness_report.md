# Informe de preparación para staging — autorización multiempresa

**Fecha:** 2026-10-10  
**Alcance:** PR #61, rama `fix/platform-subscription-rpc-guardrails`. Este informe no autoriza despliegues.

## Evidencia automatizada

- GitHub Actions #38030042735: **success** para commit `d493cd92dadf2f9751f4b8c2a290365e5e4bc2ed`.
- Pruebas de PostgreSQL aislado: asignación válida; rechazo de rol ajeno e inactivo; actualización válida con restauración; eliminación de asignación inactiva autorizada; operaciones prohibidas entre organizaciones; coexistencia de políticas SELECT permisivas; comprobaciones de filas afectadas.
- Revisión SQL de `has_org_permission`: alcance de rol por organización y estado activo, DENY explícito prioritario, sin ejecución en producción.

## Riesgos y bloqueos

1. **Sin staging Supabase:** el intento de crear una rama devolvió `Branching is supported only on the Pro plan or above`. No se creó una rama de pruebas.
2. **Las pruebas aisladas no equivalen a pruebas de integración** con `auth.uid()` real, funciones SECURITY DEFINER, roles de PostgREST y políticas de todas las tablas de producción.
3. **Roles globales:** la propuesta deniega permisos heredados desde roles globales; se debe confirmar el contrato de producto antes de migrar.
4. **Políticas permisivas:** las reglas SELECT coexistentes se combinan por OR. Revisar el conjunto efectivo en staging, especialmente si cambian las políticas originales.
5. **Asignaciones históricas inválidas:** la propuesta permite limpiar roles inactivos de la misma organización; asignaciones cruzadas preexistentes necesitan remediación auditada.
6. **Rollback:** capturar definiciones, propietarios y GRANT reales en staging; ensayar restauración antes de cualquier cambio productivo.
7. **Catálogo público y facturación:** son frentes separados; la aprobación de estas pruebas no habilita exposición pública de propiedades, despliegue del RPC de suscripciones ni pagos reales.

## Criterios para avanzar

- Entorno de staging independiente y confirmado; autorización de costo si procede.
- CI aprobado sobre el commit exacto; revisión del diff y dependencias.
- Pruebas de integración con usuarios de dos organizaciones, permisos y RLS reales.
- Revisión de seguridad, evidencia documentada, reversión probada y autorización expresa antes de producción.

**Decisión actual: NO-GO para producción.** Mantener PR #61 sin fusionar y sin activar pagos.
