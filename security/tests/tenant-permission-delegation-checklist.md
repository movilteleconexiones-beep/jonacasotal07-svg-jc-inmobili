# Matriz de comprobación: delegación de permisos JCO

**Estado:** preparación para pruebas en staging, sin cambios en producción.

| Caso | Resultado exigido |
| --- | --- |
| Usuario anónimo intenta crear un rol | Rechazado |
| Miembro sin roles.create crea un rol | Rechazado |
| Miembro con roles.create delega una capacidad que no tiene | Rechazado |
| Miembro intenta delegar roles.assign, roles.edit, settings.edit, users.disable | Rechazado |
| Miembro intenta escribir directamente role_permissions | Rechazado |
| Miembro intenta escribir directamente member_permissions | Rechazado |
| Miembro intenta escribir directamente member_roles | Rechazado |
| Usuario de agencia A modifica roles de agencia B | Rechazado |
| Usuario autenticado consulta la lista completa de platform_admins | Rechazado; solo lectura propia o SUPER_ADMIN |
| SUPER_ADMIN consulta panel central | Permitido |
| Usuario autorizado crea rol con permisos operativos que posee | Permitido |
| Usuario autorizado asigna un rol por la futura RPC auditada | Permitido únicamente después de implementar esa RPC |

## Dependencias

La migración candidata `tenant-permission-delegation-migration.sql` revoca escrituras directas en tres tablas. Esto puede afectar pantallas existentes de asignación de roles y por eso **no se debe ejecutar en producción** hasta identificar sus llamadas, crear RPC seguras y comprobar la matriz en staging.

El catálogo explícito de permisos delegables está basado en los 39 permisos consultados en Supabase. Se excluyen capacidades administrativas sensibles. Revalidar la lista si se amplía el catálogo.

El flujo de pagos Wompi debe usar funciones de servidor separadas de los roles de agencia y nunca confiar en el resultado de una redirección del navegador.
