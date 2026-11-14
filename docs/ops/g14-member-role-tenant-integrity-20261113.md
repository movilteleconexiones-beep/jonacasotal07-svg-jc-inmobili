# G14 — Aislamiento de los roles por inmobiliaria (13-nov-2026)

## Hallazgo reproducido

El 13-nov-2026 se examinó `public.member_roles`: contenía únicamente dos FK independientes `organization_member_id → organization_members(id)` y `role_id → roles(id)`, sin vínculo que garantizase `roles.organization_id=organization_members.organization_id`. La política RLS `member_roles_manage_admin` comprobaba que el actor tuviera `roles.assign` en la **inmobiliaria de la membresía**, pero no validaba el **tenant del rol concedido**.

Un ensayo únicamente en el clon PG17 restaurado `zjgstfgiirgjssnihaam`, con `SET LOCAL ROLE authenticated`, Auth UID de un propietario QA y autorización real `roles.assign`, logró hacer `INSERT` de un rol `ADMIN` de otra organización sin el nuevo guard. El ensayo lanzó una excepción explícita para abortar; **no se persistió**. Dos consultas de solo lectura hallaron **0 asignaciones cruzadas preexistentes**, tanto en clon como en producción `cuitgyqrjibgwuniapmk`.

No se acreditó una escalada de privilegios efectiva; sí una violación real de integridad entre tenants y un riesgo de futuras rutas de permiso/contabilidad.

## Corrección

`security/ops/g14_member_role_tenant_boundary.sql`: función trigger interna `jco_private.guard_member_role_same_tenant` con `SECURITY DEFINER SET search_path=''`, revocación de EXECUTE público y gatillo `y_jco_member_role_tenant_guard` `BEFORE INSERT OR UPDATE` sobre `public.member_roles`. Exige que el rol pertenezca a la **misma inmobiliaria** que la membresía. Conserva RLS, los permisos de `ADMIN`/asesor, el orden de `jco_billing_auth_lock` (antes) y `z_jco_last_owner_roles_guard` (después).

La instalación aborta si ya hubiera asignaciones cruzadas, si falta el serializador o si el ejecutor no es `postgres`. `lock_timeout=3s`, `statement_timeout=30s`, postflight y COMMIT atómico.

## Ensayo SQL de clon realizado

La función y los triggers G13 existentes en producción fueron recreados temporalmente junto al G14 en una sola transacción. El SQL `security/tests/g14_member_role_tenant_clone_rollback.sql` ejecutó con `SET LOCAL ROLE authenticated`:
- Inserción válida del rol `ADMIN` del mismo tenant: funciona
- Eliminación de esa asignación QA: funciona
- Inserción de rol de otra inmobiliaria: `23514` y mensaje inequívoco
- Actualización de una asignación existente hacia rol de otra inmobiliaria: `23514`
- Confirmación de que no se alteraron las asignaciones originales ni hay vínculos cruzados

**5/5 PASS**, después `ROLLBACK`, sin residuos QA. Esta prueba simula contexto JWT en PostgreSQL; no sustituye una sesión Auth con navegador.

## Puerta de publicación

1. Verificar rama CI, revisión, merge y CI de `main`.
2. Verificar en producción 0 vínculos cruzados antes de instalar.
3. Instalar el SQL exacto fuera de `supabase/migrations`, que mantiene historia inmóvil (#104).
4. Confirmar gatillo habilitado, `authenticated` sin EXECUTE directo de función, 0 relaciones cruzadas y conteos financieros/membresías idénticos.
5. Confirmar Railway SHA publicado y repetir smoke móvil sin PII.
6. #203 continúa NO-GO: G07/G12 y recorridos completos.

**Reversión de emergencia:** `security/ops/g14_emergency_revert_NOT_AUTOMATIC.sql`, no ejecutarla sin plan de recuperación. Suprimir el trigger reabriría la brecha.
