# G09 / #96 — liquidación de arriendo entre copropietarios · 13-nov-2026

## Alcance

La función existente `create_owner_draft_statement_by_percentage` creaba una sola liquidación por contrato, atribuyendo el 100 % del ingreso al propietario principal. En propiedades con varias participaciones eso sería un riesgo de **sobreatribución contable**. La nueva entrega implementa la ruta propia de **dos o más propietarios** sin modificar la ruta habitual de propietario único.

- `security/candidates/g09_shared_owner_financial_drafts_REVIEW_ONLY.sql` instala:
  - Función privada `jco_private.allocate_owner_amount(property, total)` con distribución de céntimos por **mayores restos** y desempate estable por UUID. La suma de partes siempre coincide con el total original cuando las participaciones suman 100 %.
  - Guard de tabla `owner_statements_shared_cap`: si el inmueble tiene varios propietarios, rechaza un borrador (incluida la RPC antigua) que asigne a un propietario más de su cuota o supere el ingreso mensual cobrado. Opera en DB, no solo en frontend.
  - RPC `create_owner_shared_drafts` con comisión expresada en **porcentaje (0–100, máximo dos decimales)**; el importe se calcula en PostgreSQL sobre el canon realmente cobrado y bloqueado, evitando confiar en cálculos del navegador. Limitada a roles autorizados de Administrador/Propietario inmobiliaria con permisos `owner_statements.create` y `rent_payments.view`. Verifica participación **exactamente del 100 %**, un único dueño principal alineado al contrato, mismos tenant/FKs, contrato activo, ingreso registrado mayor que cero, comisiones + impuestos dentro del cobro, duplicados de cualquier propietario para ese mes y bloqueos concurrentes. Crea **un borrador por dueño** y audita sus importes, sin transferencia.
  - `reconcile_owner_draft_statement` conserva el ingreso prorrateado en cada borrador. Antes lo sustituía por **todo el canon cobrado**, lo que invalidaría las liquidaciones múltiples. Mantiene el comportamiento anterior para propietario único.
  - `GRANT EXECUTE` solo a `authenticated` sobre RPC, con validación en base; ni ejecución anónima ni acceso directo a asignadores internos.
- `src/modules/finance/OwnerSettlementEntry.tsx` lee participantes con RLS en Supabase. Muestra participación, avisa inconsistencia y llama a RPC múltiple cuando corresponde. En propietario único continúa usando la RPC habitual de comisión porcentual. No edita contratos ni órdenes existentes.

## Pruebas realmente ejecutadas en clon `zjgstfgiirgjssnihaam`

Los dos scripts se aplicaron **solo dentro de un único BEGIN/ROLLBACK** en el clon:

1. `security/candidates/g09_shared_owner_financial_drafts_REVIEW_ONLY.sql` quitando únicamente su `COMMIT` final y agregando `security/tests/g09_shared_owner_clone_rollback.sql`.
2. Resultado `PASS: two owners 60/40 exact cents, isolated drafts, reconciliation, duplicate/tenant/repartition denied, payout audit, ALL ROLLED BACK`.
3. Fixture **100,01 COP** cobrados; distribución **60,01 / 40,00** exactos, comisión **10,01**, retención **2,02**, neto **87,98**. Bloqueos: antigua RPC de un solo propietario, segundo intento del mismo mes, cuotas 90 %, tenant ajeno. Emisión y abonos ficticios por cada extracto comprobados y revertidos.
4. Con la misma definición temporal en clon se ejecutó el ensayo vigente `security/tests/finance_test_tenant_rollback_payout_e2e_96.sql` de propietario único. **PASS**: emisión, abonos y revisión previa, sin regresión.
5. Las identidades en esta prueba SQL están **simuladas por SET LOCAL ROLE/JWT**, no representan cinco sesiones Auth reales. Las 25 decisiones JWT/PDF de la QA96 anterior no certifican automáticamente esta RPC recién creada.

## Requisitos de implantación

- Comprobar `main` CI SUCCESS; validar snapshot/restore Supabase y ausencia de estados inesperados; confirmar cero propiedades actualmente compartidas con ingresos emitidos que requieran migración histórica.
- Comparar la definición de `reconcile_owner_draft_statement` en producción frente a la versión examinada antes de aplicar; no sobrescribir cambios externos. `CREATE OR REPLACE` conserva firma y privilegios existentes.
- Aplicar archivo completo exclusivamente al proyecto oficial `cuitgyqrjibgwuniapmk` por administrador confiable, en transacción. **No ejecutar fixture QA en producción**.
- Postflight: RPC callable por authenticated, denied anon, trigger activo, RLS y permisos, conteos de historial, aplicaciones Railway SUCCESS.
- Inmobiliaria SuperAdmin conserva su única propiedad tal cual; no modificar valores de arriendo, dueños, comisiones ni facturas existentes.
- Para declarar **UI/browser E2E completa** aún se necesitan dos propietarios reales de prueba con Auth y ensayo de recibo privado; no se puede declarar 100 % por SQL simulado.

### Contabilidad colombiana

Es un reparto interno de efectivo **registrado** en la aplicación; no efectúa transferencias, no crea facturas DIAN, ni determina por sí mismo retenciones/impuestos legalmente aplicables. Las retenciones deben introducirse según contrato y asesoría tributaria, con comprobante auditable.


## Plan de reversión auténtico

Se versionó `security/ops/g09_shared_owner_revert_only_if_unused.sql` con la definición original **exacta** de `reconcile_owner_draft_statement` recuperada por `pg_get_functiondef` de Supabase producción ANTES de G09 (MD5 `c3e1ce9d703bc89c940db384cfc7d405`). No es un script para borrar giros ni modificar comisiones.

En el clon se simuló **instalación G09 seguida de su rollback exacto dentro de un único BEGIN/ROLLBACK**, resultado:
`PASS: G09 exact pre-change reconciliation rollback tested, no DDL persisted`.
El script de reversión **rechaza** ejecutarse si existe una liquidación de varios propietarios o un registro de auditoría `shared_draft_created`; en ese caso debe efectuarse una migración contable explícita, jamás eliminar históricos.

La prueba de porcentajes y centavos se repitió después de cambiar el parámetro de comisión a porcentaje calculado en el servidor: **PASS 60/40**, total exacto y cero residuos. El comportamiento de propietaria única fue revalidado con el procedimiento financiero existente, también PASS.
