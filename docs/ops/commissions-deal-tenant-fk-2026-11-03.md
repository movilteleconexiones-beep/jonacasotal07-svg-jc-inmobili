# INMOJCO — Integridad multi-inmobiliaria de comisiones y negocios

**Fecha:** 03-nov-2026. **Estado: candidato de revisión; NO-GO #104/#203.**

## Evidencia real (solo SELECT, Supabase activo)

- `public.commissions` tiene `organization_id` y `deal_id` obligatorios,
  y RLS activo. `public.deals` también tiene `organization_id` obligatorio,
  RLS activo, y ambas tablas son propiedad de `postgres`.
- FK original: `commissions_deal_id_fkey FOREIGN KEY (deal_id)
  REFERENCES deals(id) ON DELETE CASCADE`. No existe FK compuesta
  que compare organizaciones en esta relación.
- Se examinaron únicamente **agregados**: 6 comisiones asociadas a 6
  negocios existentes; **0 asociaciones entre inmobiliarias distintas**.
  No se consultaron valores de comisiones, datos de clientes ni UUID.
- La ausencia de una FK compuesta no demuestra explotación real ni
  acceso a filas ajenas. Sí permite un enlace inconsistente desde una
  escritura que respete la organización de la comisión, si conoce un
  `deal_id` ajeno y no hay otra defensa de escritura.

## Corrección candidata: una sola relación PostgREST

[`security/candidates/commissions_deal_tenant_fk.sql`](../../security/candidates/commissions_deal_tenant_fk.sql)

Dentro de una transacción y con `lock_timeout=5s`:

1. Exige ejecución como `postgres`, RLS y propiedad intactas, una
   sola FK de comisiones a negocios, cláusula `ON DELETE CASCADE`
   vigente, ningún dato huérfano/cruzado y nombre de la nueva restricción
   libre de conflictos.
2. Añade en `deals` la unicidad `UNIQUE(organization_id,id)`, sin
   modificar el PK `deals(id)` ni valores de negocios existentes.
3. **Sustituye la FK anterior conservando el mismo nombre**
   `commissions_deal_id_fkey`: `FOREIGN KEY (organization_id,deal_id)
   REFERENCES deals(organization_id,id) ON DELETE CASCADE`.
4. Valida la FK, comprueba que solo existe **una** relación de
   `commissions` a `deals`, y conserva RLS y concesiones API.
5. Solicita recarga del esquema PostgREST mediante `NOTIFY pgrst`
   para evitar referencias de relación obsoletas.

**Por qué se sustituye:** sumar una FK compuesta sin retirar la de
`deal_id` podría introducir dos rutas de unión y errores
`PGRST201` en consultas REST incrustadas. El nombre de la FK anterior
se conserva para compatibilidad de referencias `!commissions_deal_id_fkey`.

## Prueba aislada y reversión

[`security/tests/commissions_deal_tenant_fk_pg17.sh`](../../security/tests/commissions_deal_tenant_fk_pg17.sh)
usa PostgreSQL 17, con dos inmobiliarias y comisiones ficticias.
Demuestra antes del cambio un enlace incorrecto permitido por el FK
simple, hace `ROLLBACK` y verifica que el preflight rechaza filas
incorrectas preexistentes, sin crear unicidad parcial.
Rechaza ejecutores no autorizados, admite doble ejecución y comprueba:

- Solo **una** FK entre comisiones y negocios tras el reemplazo.
- Una comisión de A no puede referenciar el negocio de B, incluso con
  un ejecutor PostgreSQL privilegiado.
- RLS sigue aislando las comisiones entre las dos inmobiliarias, con
  escrituras válidas permitidas para cada organización.
- Persisten `ON DELETE CASCADE`, permisos de `authenticated` y
  `service_role`, y los registros de prueba originales.

**Reversión planificada (no ejecutada):** en staging, respaldar
estructura/ACL previamente; si la aplicación no reconoce la FK
compuesta, bajo transacción sustituir `commissions_deal_id_fkey` por la
definición anterior `FOREIGN KEY(deal_id) REFERENCES deals(id) ON
DELETE CASCADE`, validar y notificar recarga de esquema. No retirar
automáticamente la unicidad nueva si aparece otra dependencia.

## Condiciones pendientes

La unicidad del padre y la sustitución de FK pueden bloquear escrituras
y exigir actualizar consultas PostgREST. Antes del despliegue real se
necesitan pruebas de clientes reales/ficticios en **staging**, permisos
de roles, operaciones de negocio-comisiones-anulación y eliminación,
copia restaurable verificada, disponibilidad de rollback, cierre de
reconciliación #104, protección de `main` y verificación CI/Railway.
Se debe preservar el aislamiento multi-tenant y Wompi en sandbox.

**No ejecutar este SQL contra producción, no incluirlo en migraciones
automáticas y no habilitar pagos reales por esta evidencia.**
