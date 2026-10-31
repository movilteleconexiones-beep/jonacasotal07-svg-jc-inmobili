# Invitaciones verificadas y cupos comerciales de INMOJCO

## Revisión de producción (solo lectura, 30/10/2026)

El proyecto Supabase activo `cuitgyqrjibgwuniapmk` conserva:

| Plan mensual | Cupo de personal operativo | Cupo de inmuebles |
| --- | ---: | ---: |
| BASIC | 5 | 200 |
| PRO | 25 | 2.000 |

La revisión agregada no encontró inmobiliarias comerciales por encima de
su cupo. Existe una organización con `requires_payment=false` por una
excepción histórica de acceso manual, ya registrada en la incidencia #254;
**no modificarla de forma automática**.

Los usuarios con rol exclusivamente `CLIENT` no consumen asientos operativos.
Los roles mixtos (por ejemplo `CLIENT` + `ADMIN`) sí consumen un asiento.
La cuota es validada mediante tres activadores diferidos que verifican
`organization_members`, `member_roles` y `member_permissions` al final
de cada operación; el bloqueo por organización impide superar el cupo en
transacciones simultáneas. La CI ya contiene pruebas para estas reglas
(`security/tests/external_portal_staff_seats_assertions.sql`).

## Refuerzo de las invitaciones

Antes de esta corrección `public.claim_my_invitations()` se basaba en la
dirección `email` que figuraba en el JWT de la sesión, sin comprobar
explícitamente la fecha de confirmación en `auth.users`. Si un mecanismo de
registro no confirmara el correo, esa decisión podría permitir reclamar una
invitación enviada a un tercero.

La nueva función:

1. Exige un `auth.uid()` válido **y** `auth.users.email_confirmed_at`.
2. Obtiene el email desde la tabla interna autenticada, no desde el JWT;
   así, el cambio del correo no permite reutilizar un token antiguo.
3. Reclama solo invitaciones `PENDING` sin vencer, con bloqueo de fila
   `FOR UPDATE` para evitar dobles aceptaciones.
4. Solo vincula roles **activos** pertenecientes a la misma inmobiliaria.
5. Ignora invitaciones sin roles válidos y mantiene idempotencia de
   miembros y permisos.
6. Conserva las validaciones existentes de cupos, incluido el disparador
   diferido que impide activar personal por encima del plan.

No se modifican las cuentas, invitaciones o membresías existentes al
ejecutar esta migración. Tampoco se cambia el modelo de precios, la
facturación de Wompi ni las credenciales.

## Pruebas que deben aprobarse

La suite PostgreSQL 17 aislada comprueba que un usuario con correo sin
confirmar, una sesión con email suplantado o un token antiguo tras un cambio
de email **no** puedan aceptar invitaciones de otra persona. También prueba
la aceptación normal de una invitación válida, su idempotencia, los roles
de otra inmobiliaria, los roles deshabilitados y las invitaciones vencidas.

**Límite:** estos ensayos prueban la lógica de aceptación de invitaciones,
pero no sustituyen una auditoría exhaustiva de Supabase Auth ni una prueba
de usuario real en el navegador tras aplicar la migración.

Referencia oficial de Supabase: https://supabase.com/docs/guides/auth/users
