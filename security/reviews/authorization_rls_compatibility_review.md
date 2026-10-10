# Revisión de compatibilidad RLS y autorización por inmobiliaria

**Alcance:** observación de solo lectura sobre Supabase oficial `nqzopzhmhqdssgpljypu` (2026-10-10). Documento de revisión, sin cambios de producción.

## Evidencia del esquema productivo

- `member_roles_manage_admin` aplica a todas las operaciones, con `USING` y `WITH CHECK` que verifican `has_org_permission(m.organization_id, 'roles.assign')` a partir del miembro, pero no verifican `roles.organization_id` ni `roles.active`.
- `member_roles_select_org` permite ver asignaciones por pertenencia a la organización del miembro.
- `role_permissions_manage_admin` exige `roles.edit` para la organización del rol y que `roles.organization_id IS NOT NULL`.
- `roles_select_org` y `role_permissions_select_org` contemplan roles globales con `organization_id IS NULL`; la propuesta de función que exige rol de la misma organización los excluiría de autorizaciones heredadas. **Revisar si hay roles globales legítimos antes de desplegar.**
- `member_permissions_manage_admin` usa `roles.assign` para gestionar overrides; la función revisada mantiene prioridad DENY.
- `organization_members` emplea `users.create`, `users.edit` e `is_org_member` para gestionar membresías.

## Compatibilidad obligatoria antes de staging

1. Inventariar con SELECT los roles globales, asignaciones cruzadas, roles inactivos asignados y permisos derivados; evitar exponer identificadores personales en reportes.
2. Acordar explícitamente si los roles globales deben otorgar permisos y bajo qué límites. La propuesta actual **los deniega**. No aplicar una modificación que silenciosamente retire acceso legítimo.
3. Probar en PostgreSQL aislado `has_org_permission` con DENY, ALLOW, rol válido, rol ajeno, rol inactivo, membresía inactiva y rol global.
4. Revisar política RLS `member_roles` para `INSERT` y `UPDATE`: miembro y rol deben pertenecer a la misma organización y el rol debe estar activo; mantener controles de permiso `roles.assign`.
5. Verificar dependencias de SECURITY DEFINER, privilegios EXECUTE, esquema `auth.uid()`, RLS y política de revocación; probar que la función no produzca recursión.
6. Ensayar reversión y verificar flujos reales en staging. No migrar ni fusionar hasta contar con autorización expresa.

## Hallazgo y límite

La política permite conceptualmente asignaciones de rol inconsistentes si el actor ya cuenta con `roles.assign`; **no se ha probado que existan asignaciones cruzadas ni explotación real en producción**. La corrección propuesta de `has_org_permission` protege la concesión heredada ante ese estado inconsistente, pero no sustituye la corrección de RLS.
