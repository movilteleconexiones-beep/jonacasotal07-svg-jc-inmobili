# Frontera de privilegios: propietario de inmobiliaria y SUPER_ADMIN

**Revisión, no migración aplicada.** Proyecto Supabase oficial `nqzopzhmhqdssgpljypu`.

## Regla comercial
- `SUPER_ADMIN` de plataforma: reservado a JCO; no se crea ni asigna desde las pantallas de una inmobiliaria.
- `ORGANIZATION_OWNER`: administra únicamente la inmobiliaria asignada. Puede gestionar administradores, coordinadores, asesores y clientes, y roles personalizados operativos, sin ascender a `SUPER_ADMIN`.
- Los administradores de inmobiliaria nunca pueden leer ni modificar otras inmobiliarias, contratos globales o la tabla de administradores de plataforma.

## Hallazgo de revisión SQL
La función `public.create_custom_role(target_org, role_name, role_description, permission_keys)` es `SECURITY DEFINER` y comprueba `has_org_permission(target_org,'roles.create')`, pero después asigna **cualquier clave** de `public.permissions` incluida en `permission_keys` sin lista permitida. Esto requiere endurecimiento del servidor antes de considerar garantizada la separación de privilegios. La interfaz por sí sola no es una barrera suficiente.

## Trabajo requerido (sin ejecutar producción)
1. Definir catálogo de permisos estrictamente operativos asignables a roles personalizados; prohibir expresamente permisos globales, administración de licencias, creación de inmobiliarias y delegación de propietarios.
2. Reemplazar la RPC por una versión que valide **todas** las claves solicitadas antes de insertar, compruebe organización y actor autenticado, y rechace nombres reservados o confusamente similares a roles globales.
3. Verificar políticas RLS y triggers de `roles`, `role_permissions`, `member_roles`, `member_permissions`, `organization_invitations` e `invitation_roles` contra escalada de privilegios y manipulación cruzada de organizaciones.
4. Proteger al propietario principal contra suspensión o eliminación por usuarios de nivel inferior; exigir procedimiento central para transferir titularidad.
5. Revisar lectura de `platform_admins` y restringir enumeración a actor propio o administradores autorizados.
6. Probar como propietario, administrador, asesor, usuario externo y SUPER_ADMIN, incluyendo peticiones directas a PostgREST que evadan la interfaz.
7. Preparar migración revisable y aplicar solo tras aprobación explícita del dueño de JCO.

## Estado de interfaz
Se ocultan roles reservados del selector de roles de la inmobiliaria y se comprueban permisos antes de crear roles o invitaciones. **Esto no corrige todavía la RPC ni sustituye RLS.**
