# INMOJCO — Privilegios anónimos de mantenimiento inmobiliario

**Fecha:** 03-nov-2026. **Estado: candidato sin desplegar / NO-GO #104 y #203.**

## Evidencia de Supabase producción (lectura del catálogo, sin DML/DDL)

La tabla `public.maintenance_requests` está en `public`, pertenece a
`postgres` y tiene RLS habilitado. Su ACL efectiva contiene concesiones
directas de `postgres` a `anon` para `SELECT, INSERT, UPDATE, DELETE,
MAINTAIN`. Los mismos cinco privilegios están concedidos a
`authenticated`; `service_role` conserva sus privilegios operativos.

Existen exactamente **dos** políticas RLS, ambas para
`authenticated` y para todas las operaciones:

- `maintenance_org_access`: PERMISSIVE; exige pertenencia interna a la
  inmobiliaria o administración de plataforma.
- `jco_commercial_access`: RESTRICTIVE; además exige acceso comercial
  operativo a la inmobiliaria.

El catálogo examinado no presenta una política `TO anon`. El grant SQL
anónimo no prueba que se pueda leer/escribir alguna fila, porque RLS
sigue aplicándose. `MAINTAIN` **no depende de RLS**, y su retirada
completa, incluso los privilegios predeterminados de nuevos objetos,
requiere el candidato separado de dos propietarios PostgreSQL (ver
`docs/ops/public-api-maintain-two-phase-2026-11-03.md`).

## Corrección acotada bajo revisión

`security/candidates/revoke_maintenance_requests_anon_crud.sql` revoca
**solo** `SELECT/INSERT/UPDATE/DELETE` a `anon` sobre esta tabla;
no altera permisos de `authenticated`, `service_role`, RLS, triggers,
la estructura de la base de datos ni datos existentes.

La operación queda dentro de una transacción que falla sin cambios ante
un ejecutor distinto de `postgres`, propietario inesperado, RLS
desactivado, políticas adicionales/distintas, o un grant `PUBLIC`
que haría inefectiva la revocación selectiva. Comprueba que el resultado
mantiene el acceso SQL de personal autenticado y `service_role`.
Es idempotente. **No está en `supabase/migrations/` y no debe
ejecutarse como migración automática.**

El candidato NO revoca `MAINTAIN`; retirar únicamente CRUD no solventa
ese riesgo. No ejecutar el candidato por separado como sustituto de la
estrategia global. Antes de una aplicación real, volver a consultar las
ACL/políticas, validar el ejecutor, repetir pruebas de acceso contra la
app con identidades ficticias en staging, preservar rollback y exigir
protección de ramas y despliegues.

## Pruebas aisladas

`security/tests/maintenance_anon_crud_pg17.sh`, integrado en GitHub
Actions, crea una base desechable PostgreSQL 17 con dos inmobiliarias
ficticias y los grants observados. Verifica:

1. El grant anónimo inicial está presente, pero la RLS
   `TO authenticated` impide leer registros.
2. Ejecutores no autorizados, cambios de políticas y concesiones a
   `PUBLIC` bloquean la corrección **antes** de cualquier REVOKE.
3. Dos ejecuciones autorizadas retiran únicamente los cuatro permisos
   anónimos; el permiso MAINTAIN sigue explícitamente fuera de alcance.
4. Personal autenticado puede leer y editar solo su propia inmobiliaria;
   la otra permanece invisible, y `service_role` conserva sus grants.
5. No se alteran los datos de prueba; se eliminan la base y los roles
   efímeros al concluir.

**No equivale a ejecución productiva ni a prueba E2E** del portal,
arrendamientos o Storage. Mantener #104/#203 en NO-GO. No aplicar
`migration repair`, `db push`, `REVOKE` ni Wompi real sobre producción
hasta que se cumplan todos los criterios de lanzamiento.
