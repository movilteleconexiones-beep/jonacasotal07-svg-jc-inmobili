# Recuperación controlada de la membresía del propietario JCO

## Situación comprobada previamente

- Proyecto Supabase oficial: `nqzopzhmhqdssgpljypu`.
- Cuenta: `jonacasotal@hotmail.com`, usuario `af0d9a13-c844-4da8-ac90-8420040b1a90`.
- Inmobiliaria existente: `Inmobiliaria Principal`, organización `0e271eb4-cb35-4deb-8f9c-c44107a5d795`, estado `ACTIVE`.
- La membresía del usuario figuraba como `INVITED` en la última consulta exitosa.
- El acceso `SUPER_ADMIN` ya está registrado de forma independiente en `public.platform_admins`.

**Precaución:** esta guía no se ha ejecutado en producción. Antes de cualquier escritura se debe revisar el estado actual. No crear una segunda inmobiliaria ni un segundo usuario. Esta corrección no sustituye la integración de la rama de desarrollo en `main`.

## Paso 1: comprobar el registro exacto (solo lectura)

Ejecutar en el editor SQL del proyecto oficial:

```sql
SELECT
  om.id AS membership_id,
  om.organization_id,
  o.name AS organization_name,
  o.status AS organization_status,
  om.user_id,
  u.email,
  om.status AS membership_status
FROM public.organization_members om
JOIN public.organizations o ON o.id = om.organization_id
JOIN auth.users u ON u.id = om.user_id
WHERE om.organization_id = '0e271eb4-cb35-4deb-8f9c-c44107a5d795'::uuid
  AND om.user_id = 'af0d9a13-c844-4da8-ac90-8420040b1a90'::uuid;
```

Detenerse si devuelve cero o más de una fila, si el correo o la inmobiliaria no coinciden, o si la membresía ya está `ACTIVE`. Verificar también roles asociados, restricciones y reglas de aceptación de invitaciones antes de modificar datos.

## Paso 2: actualización restringida (solo tras la verificación)

**Operación pendiente de ejecutar por una persona autorizada en Supabase.** Esta instrucción solo cambia una membresía si aún figura como invitada y coinciden usuario, organización y correo:

```sql
BEGIN;

UPDATE public.organization_members AS om
SET status = 'ACTIVE'
FROM public.organizations AS o, auth.users AS u
WHERE om.organization_id = o.id
  AND om.user_id = u.id
  AND om.organization_id = '0e271eb4-cb35-4deb-8f9c-c44107a5d795'::uuid
  AND om.user_id = 'af0d9a13-c844-4da8-ac90-8420040b1a90'::uuid
  AND lower(u.email) = 'jonacasotal@hotmail.com'
  AND o.name = 'Inmobiliaria Principal'
  AND o.status = 'ACTIVE'
  AND om.status = 'INVITED'
RETURNING om.id, om.organization_id, om.user_id, om.status;

COMMIT;
```

El resultado esperado de `RETURNING` es **exactamente una fila** con `status = ACTIVE`. Si no hay una fila, investigar en lugar de ejecutar cambios más amplios. Para poder abortar si el resultado es inesperado, ejecutar `BEGIN`, `UPDATE ... RETURNING` y `COMMIT` por separado, y usar `ROLLBACK` en lugar de `COMMIT` si corresponde.

## Paso 3: verificar acceso

Volver a ejecutar la consulta del paso 1 y comprobar `membership_status = ACTIVE`. Cerrar sesión y volver a ingresar en una versión de la aplicación que incluya la rama corregida. Verificar por separado:

1. Administración central JCO visible solo para SUPER_ADMIN.
2. Inmobiliaria Principal accesible como membresía activa.
3. Roles de la inmobiliaria y permisos del usuario correctos.
4. Ninguna inmobiliaria duplicada ni cambios visuales al portal público.

**Estado:** pendiente de ejecución y verificación de producción. No declarar activada la membresía hasta obtener confirmación del resultado SQL.
