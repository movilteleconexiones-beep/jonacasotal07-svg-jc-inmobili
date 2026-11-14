# G13 — integridad de roles y propietario final antes de lanzamiento

**Origen:** auditoría productiva 14-nov-2026 de RLS, permisos y triggers en `organization_members`, `member_roles` y `roles`. Las funciones del SuperAdmin G10 protegen al último dueño, pero RLS administrativa permite **UPDATE directo** de membresías y **ALL** en roles asignados. El trigger existente `jco_billing_auth_lock` serializa por inmobiliaria y `enforce_internal_seat_limit` controla cupos, pero ninguno valida que permanezca un dueño activo. `guard_base_role_identity` protege UPDATE de roles del sistema, no DELETE. Proteger en frontend o solo en G10 no basta.

## Cambio propuesto

`security/ops/g13_protect_last_owner_system_roles.sql`: crea función restringida `jco_private.guard_protected_membership_mutations`, con `SECURITY DEFINER` y `search_path=''`, y **3 triggers BEFORE UPDATE/DELETE** tras el serializador existente, de nombre `z_`:

1. Identidad inmutable de `organization_members`: ID, `user_id`, `organization_id` no se pueden reasignar silenciosamente.
2. Inmobiliaria nunca pierde su último propietario activo por suspensión, eliminación o borrado/cambio de asignación `ORGANIZATION_OWNER`, incluso por writes directos.
3. Membresías y roles asignados a SuperAdmin activo quedan protegidos frente a UPDATE/DELETE directos. Inserciones para concederle segundo perfil siguen posibles.
4. Prohibición de borrar roles del sistema desde `roles` (su identidad ya estaba protegida solo frente a UPDATE).
5. Se conservan ediciones inofensivas; ninguna nueva GRANT, RLS, tabla, contrato, cobro ni licencia. Para transferir propiedad se debe **asignar un segundo propietario activo primero** y después retirar al anterior. Si ya había un único dueño, no se permite dejarla huérfana.

Los locks existentes en el trigger `jco_billing_auth_lock` se ejecutan antes por orden alfabético de triggers PostgreSQL, serializando en la fila `organizations`. El script valida que existan ambos triggers previos y los tres nuevos. `lock_timeout=3s`, `statement_timeout=30s` evitan esperas indefinidas.

## QA real en clon restaurado PG17

Aplicación provisional **en la misma transacción** junto a `security/tests/g13_last_owner_membership_clone_rollback.sql` con COMMIT de SQL candidato sustituido por ROLLBACK: **8/8 PASS** (7 intentos maliciosos y 1 actualización inocua permitida). Postflight: **0 triggers G13 persistentes, 0 funciones G13 persistentes, 1 miembro QA activo y 1 SuperAdmin activo**. No tocar producción con fixture.

## Riesgos y límites

- Los dos roles con acceso a escritura directa también podrían intentar **asignar** `ORGANIZATION_OWNER` a un miembro sin autorización adicional; este guard protege contra el retiro del último dueño, no certifica integralmente la autorización de nuevas asignaciones ni la UI de edición. Revisar y limitar por separado.
- La concurrencia se serializa mediante trigger existente, pero requiere dos sesiones reales simultáneas para certificación completa; un test dentro de transacción no representa dos JWT.
- La prueba es PostgreSQL con `postgres` (seguridad contra bypass por privilegios del ejecutor), no cinco Auth/JWT reales.
- Postmerge requiere validar 3 triggers activos, los cambios contables nulos, los permisos originales y ausencia de regresiones en gestión de usuarios.
- No tocar inventario histórico `supabase/migrations/` hasta reconciliar #104. Mantener este SQL y su instalación como evidencia operativa.

**NO-GO comercial:** continúa hasta G07 políticas firmadas, primer pago Wompi verdadero y verificaciones #203 restantes.
