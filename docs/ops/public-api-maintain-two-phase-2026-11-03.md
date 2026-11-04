# INMOJCO — Retiro escalonado de MAINTAIN de los roles de API (propuesta)

**Estado: NO-GO.** Documentación y scripts de candidatos para revisión; nada
de este informe autoriza `db push`, `migration repair`, desplegar, modificar
RLS productivo, ejecutar SQL sobre Supabase productivo o habilitar Wompi real.

## Evidencia de producción, consultas SELECT del 03-11-2026

- PostgreSQL 17, esquema `public`: **58 tablas**, todas de propietario
  `postgres`. MAINTAIN efectivo: `anon` en **35**, `authenticated` en
  **41**. `service_role` en **58**.
- A nivel de permisos directos, también se encontraron DELETE de `anon`
  en 28 tablas. Es otra revisión, no la finalidad de esta corrección.
- Existen **dos propietarios de default ACL**: `postgres` y
  `supabase_admin`. Ambos conceden MAINTAIN a `anon` y `authenticated`,
  cuatro grants predeterminados en total.
- El ejecutor Supabase habitual responde `current_user=postgres`;
  **no es miembro de `supabase_admin`**. No puede modificar de forma
  legítima sus privilegios predeterminados.
- RLS controla operaciones de filas, **no las acciones MAINTAIN** en
  PostgreSQL 17 (VACUUM, ANALYZE, REINDEX, etc.). No se ha demostrado
  una explotación remota; corregir grants es defensa en profundidad.

## Candidato existente (preferido cuando exista un administrador de ambos roles)

`security/candidates/revoke_public_api_maintain.sql` ejecuta en una sola
transacción `REVOKE MAINTAIN` en tablas existentes y desactiva sus
default ACL para **ambos** propietarios. Tiene preflight y múltiples
pruebas PG17. Con el ejecutor habitual de Supabase, **falla cerrado**:
no eliminar su protección ni asumir que `CREATEROLE` permite modificar
el default ACL de otro rol.

## Alternativa investigada: dos propietarios, tres ejecuciones

Se propone para un ambiente aislado donde puedan obtenerse dos sesiones
**legítimamente autorizadas** (sin simular membresía ni alterar roles
productivos). Sus scripts NO están en `supabase/migrations/`:

1. **Postgres — fase 1:**
   `security/candidates/revoke_public_api_maintain_postgres_phase.sql`.
   Preflight `current_user=postgres` y revisión de propietarios: únicamente
   `postgres` o `supabase_admin`. Revoca MAINTAIN de `anon` y
   `authenticated` **solo en las tablas de propiedad de postgres** y
   en futuros objetos creados por ese rol. **No cierra el riesgo futuro
   de `supabase_admin`**; no considerar completado.
2. **supabase_admin — fase 2:**
   `security/candidates/revoke_public_api_maintain_supabase_admin_phase.sql`.
   Solo puede ejecutarlo una sesión con `current_user=supabase_admin`;
   revoca las default ACL para tablas futuras que cree ese propietario
   **y los permisos MAINTAIN en las tablas actualmente propiedad de
   `supabase_admin`**, incluidas las creadas entre fases.
   No cambiar de rol mediante un bypass ni solicitar elevaciones de
   credenciales.
3. **Postgres — barrido final obligatorio:** repetir fase 1 para revocar
   MAINTAIN de cualquier objeto **propiedad de postgres** creado entre
   la primera y segunda fase. La fase 2 ya retiró permisos de tablas
   `supabase_admin`. Sin ese paso, la remediación puede dejar grants residuales.
   A continuación, verificar `has_table_privilege` en **todas** las
   tablas de public, ausencia de default ACL problemáticas de ambos
   propietarios, permisos `service_role`, y comportamiento de
   aislamiento entre inmobiliarias.

La secuencia real necesita coordinación que impida altas de tablas
durante la ventana; de lo contrario, otro objeto podría nacer tras el
barrido final. Si el rol supabase_admin no está disponible para
operaciones autorizadas, mantener estado NO-GO y la revisión con el
proveedor, en lugar de desplegar una corrección incompleta.

## Prueba automatizada

`security/tests/public_api_maintain_two_phase_pg17.sh` reproduce en
PostgreSQL 17 descartable dos organizaciones con filas financieras
ficticias, dos roles propietarios de default ACL y los permisos
inseguros; verifica errores de sesión incorrecta sin mutaciones,
idempotencia de cada fase, riesgo de tablas creadas durante la ventana,
barrido final, conservación del RLS y `service_role`.

**La aprobación de CI no sustituye la revisión del plan de producción,
backups auténticos, rollback, ni la reconciliación #104.**
