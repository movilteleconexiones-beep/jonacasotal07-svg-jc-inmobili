# Auditoría urgente de permisos del proyecto oficial

Proyecto: `nqzopzhmhqdssgpljypu`. Inspección de solo lectura; no se aplicó ninguna política nueva.

## Hallazgos

1. La función `create_organization_with_owner` (ambas firmas) ya devuelve `false` para el rol `authenticated`. No obstante, esto **no prueba** que las inserciones directas o funciones alternativas estén bloqueadas.
2. La tabla `public.organizations` tiene **dos políticas INSERT**: `Solo SuperAdmins pueden crear organizaciones` y `Solo usuarios autorizados pueden crear organizaciones`. Es necesario revisar sus expresiones `WITH CHECK` antes de concluir que solo el superadministrador puede crear organizaciones.
3. `public.organizations` tiene una política `ALL` que utiliza `profiles.is_super_admin`, mientras que el control oficial de plataforma se registra en `platform_admins`. Se deben unificar los criterios y validar quién puede editar estados y contratos.
4. `public.platform_admins` tiene una política SELECT `Permitir lectura a usuarios autenticados` con `USING (true)`. Esto puede permitir a cualquier usuario autenticado enumerar los administradores; debe revisarse y restringirse.
5. `platform_admins_self_read` ya contempla lectura propia y función `is_platform_admin()`, pero la política permisiva anterior reduce su eficacia.

## Acciones propuestas antes del lanzamiento

- Auditar las expresiones `WITH CHECK`, permisos GRANT y las funciones SECURITY DEFINER que escriben en `organizations`.
- Endurecer RLS de `platform_admins` para lectura propia y administración privilegiada; probar con roles autenticado, anónimo, propietario de inmobiliaria y superadmin.
- Crear endpoints/RPC específicos para aprobar, suspender y reactivar organizaciones, con validación de `auth.uid()` en `platform_admins`, auditoría y control contractual.
- Crear interfaz de Superadministrador sin utilizar la dirección de correo como sustituto de la autorización del servidor.
- Ejecutar las pruebas en un entorno aislado y pedir autorización separada para desplegar nuevas políticas en producción.
