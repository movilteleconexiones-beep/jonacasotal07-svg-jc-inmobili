# Contrato de autorización para publicar propiedades — revisión de producción

Fecha: 2026-10-10. Documento de revisión; no ejecuta migraciones.

## Evidencia comprobada (Supabase oficial nqzopzhmhqdssgpljypu)
Consulta SELECT a public.permissions: existen properties.create, properties.delete, properties.edit y properties.view; no existe properties.publish.

public.has_org_permission(target_org uuid, permission_key text) comprueba organization_members.ACTIVE con auth.uid(), DENY explícito, ALLOW explícito y permisos heredados por roles. Es SECURITY DEFINER, STABLE y usa search_path public. La implementación de publicación debe revisar los privilegios EXECUTE de esta función y el endurecimiento de su search_path.

## Contrato propuesto para staging
1. Crear permiso específico `properties.publish` sin asignarlo por defecto a todos los usuarios con `properties.edit`.
2. El endpoint/RPC que cambie `is_published` debe comprobar `auth.uid()`, membresía activa, `public.has_org_permission(property.organization_id,'properties.publish')` y bloquear la fila antes de modificarla.
3. No confiar en `organization_id` proporcionado por el cliente; derivarlo de la propiedad existente bajo bloqueo.
4. Revalidar autorización en cada llamada, incluida la revocación de consentimiento.
5. Auditoría obligatoria: actor, organización, inmueble, acción y resultado. Rechazar operaciones anónimas.
6. Mantener SELECT anónimo sobre una proyección mínima; nunca sobre la tabla privada de propiedades.
7. Si se utiliza SECURITY DEFINER, fijar search_path seguro y calificar esquemas, revocar EXECUTE a PUBLIC y conceder solo a roles previstos.

## Riesgo concreto observado en la función productiva (solo lectura)
La definición actual de `has_org_permission` une `member_roles` con `role_permissions` sin unir `roles` ni comprobar `roles.organization_id = organization_members.organization_id` o `roles.active = true`. Por ello, una asignación inconsistente de un rol de otra organización o desactivado podría conceder permisos heredados. No se ha demostrado explotación real ni se han modificado filas de producción.

La corrección propuesta debe filtrar explícitamente los roles activos y pertenecientes a la organización del miembro, conservar prioridad DENY y comprobar que las políticas RLS de asignación de roles impidan referencias cruzadas. Preparar y probar la función corregida en PostgreSQL aislado antes de staging.

## Riesgos y pruebas necesarias
- La función actual no verifica de forma explícita el estado/organización del rol unido en role_grant; revisar coherencia con las políticas member_roles y roles antes de reutilizarla para publicación.
- Probar DENY sobre ALLOW, usuario inactivo, permisos de otra organización, revocación inmediata y concurrencia.
- Probar cambios de organización de propiedad, despublicación, suspensión del sitio y rollback en PostgreSQL 17 aislado y staging.
- Verificar el uso actual del catálogo estático del frontend antes de habilitar uno dinámico.

No aplicar este contrato ni cambiar producción sin revisión, migración reversible y autorización explícita.
