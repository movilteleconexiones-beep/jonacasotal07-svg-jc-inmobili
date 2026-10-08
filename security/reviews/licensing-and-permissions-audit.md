# Revisión de seguridad JCO (2026-10-08)

**Estado:** diagnóstico y migración propuesta, no aplicada en Supabase.

## Hallazgos confirmados en la base oficial

1. La política `platform_admins` llamada «Permitir lectura a usuarios autenticados» usa `USING (true)`, y por tanto expone filas de administradores a cualquier sesión autenticada. Existe otra política más limitada (`platform_admins_self_read`), pero las políticas SELECT permisivas se combinan mediante OR.
2. `create_custom_role(target_org, role_name, role_description, permission_keys)` es SECURITY DEFINER y permite asignar cualquier clave de `permissions` después de verificar únicamente `roles.create`. No comprueba que el creador pueda delegar cada permiso.
3. `role_permissions_manage_admin` tiene comando ALL y permite gestión si el actor tiene `roles.edit`; requiere endurecimiento adicional para evitar que una persona agregue permisos privilegiados directamente.
4. `platform_set_subscription` valida superadministrador, pero recibe `billing_mode` y `status` del llamante y actualiza el estado de la organización. No verifica confirmación de Wompi ni escribe una auditoría de cobro; no debe usarse como sustituto del webhook.
5. No se encontraron tablas públicas con nombres que incluyan payment, order, wompi o transaction. Antes de crear nuevas tablas, revisar el esquema completo y las migraciones del repositorio.

## Plan seguro

- Revisar los permisos de ejecución de funciones y grants a `anon`, `authenticated` y `PUBLIC`.
- Restringir la política de lectura de `platform_admins` preservando el acceso del propio administrador.
- Definir una lista explícita de permisos delegables para agencias, evitando depender únicamente de patrones de nombres. Limitar tanto `create_custom_role` como inserciones/actualizaciones directas a `role_permissions`.
- Crear pruebas negativas entre dos organizaciones y pruebas de permisos para propietarios, empleados y superadministrador.
- Revisar funciones SECURITY DEFINER para búsqueda de esquemas, auditoría y acceso entre tenants.
- Preparar tablas y Edge Function/servidor para pagos Wompi sandbox con validación de firma, estado, monto, moneda, idempotencia y registros de auditoría.
- Aplicar migraciones únicamente después de revisión de dependencias, backup y autorización explícita.

## Archivo asociado

`security/reviews/platform-admin-and-custom-role-hardening.sql` es un **borrador** de migración y no debe ejecutarse sin revisar y corregir la ruta de asignación directa de permisos. No declara el sistema listo para producción.
