# INMOJCO — Conciliación del historial de migraciones (bloqueo #104)

Fecha de auditoría: 2026-11-02. Fuente de datos: repositorio `main` y `Supabase.list_migrations` del proyecto `cuitgyqrjibgwuniapmk`. **Todas las consultas realizadas fueron de solo lectura.**

## Diagnóstico cuantificado

| Señal | Resultado |
| --- | ---: |
| Archivos SQL en `supabase/migrations/` | 109 |
| Versiones de 14 dígitos distintas en el repositorio | 76 |
| Migraciones registradas como aplicadas en Supabase | 99 |
| Versiones coincidentes exactamente | **1** |
| Versiones locales fechadas sin coincidencia en el ledger | **75** |
| Archivos del repositorio con el mismo nombre funcional que un registro aplicado | 61 |
| Prefijos duplicados preexistentes en repo | `20261013040000` (2 archivos) |

Los nombres coincidentes sirven únicamente para **identificar candidatos a equivalencia**, no para acreditar que el DDL o sus permisos son iguales. La carpeta también contiene 32 archivos con prefijos antiguos de cuatro dígitos que no deben subirse automáticamente.

En el bloque financiero `20261012120000`–`20261012150000`, los cinco identificadores locales no aparecen en el historial. En origen constan las migraciones consolidadas `20261012070133` y `20261012071309`. Una verificación read-only de catálogo confirmó **32/32 objetos** de ese bloque presentes: 2 tablas, 6 funciones, 11 restricciones, 9 políticas, 2 índices y 2 disparadores. **No acredita equivalencia de definiciones ni de grants.**

## Preflight de seguridad incorporado

```bash
# Sin conexión ni credenciales; comprueba versiones duplicadas nuevas y fija las
# cinco migraciones históricas para que no cambien sin revisión:
node scripts/ops/finance-migration-gate.mjs

# Con un JSON de versiones realmente aplicadas, revisa todo el historial local:
# Se admite ["2026..."] o {"migrations":[{"version":"2026..."}]}.
node scripts/ops/finance-migration-gate.mjs --ledger ruta/al/ledger.json
```

**Resultado esperado con el ledger comprobado el 2-nov:** código de salida 2 / NO-GO. Un resultado positivo de esta herramienta **no autoriza por sí solo** `supabase db push`, pues no compara definiciones de producción, RLS, ACL ni datos.

## Camino mínimo al cierre sin repetir DDL

1. Revisar objeto por objeto los **15 archivos fechados sin coincidencia exacta de nombre funcional** y el conjunto histórico de cuatro dígitos. Mapear cada operación a un objeto/efecto existente; no deducir equivalencia a partir del nombre.
2. Para los archivos con mismo nombre y fecha distinta, comparar funciones `pg_get_functiondef`, políticas `pg_policies`, restricciones `pg_get_constraintdef`, disparadores, ACL, índices y efectos de migraciones posteriores; documentar equivalencia o diferencia real.
3. En una base aislada restaurada a partir del respaldo **ya certificado** (no en producción), ensayar la conciliación de versiones sin ejecutar DDL histórico sobre datos reales.
4. Solo cuando el mapa esté firmado y las pruebas sean satisfactorias, aplicar el mecanismo **oficial** de reparación del historial de migraciones, sin escribir versiones directamente en las tablas ni repetir `CREATE TABLE`/`ALTER TABLE`. Confirmar `supabase migration list` y volver a ejecutar el preflight antes de aprobar un despliegue.
5. Mantener Wompi sandbox, RLS y producción sin cambios hasta pasar los controles de lanzamiento #203.

La rama de respaldo de código permanece protegida; la incidencia #214 de recuperación ya se cerró. No se necesitan nuevas exportaciones, cifrado, USB ni migraciones por duplicado.

## Evidencia puntual adicional de versiones sin coincidencia de nombre (2-nov-2026)

Inspección **solo lectura** en Supabase `cuitgyqrjibgwuniapmk`, comparada con los archivos de `main`. Se eligieron tres de las migraciones fechadas clasificadas como `unmatched-name` en el mapa; estas comprobaciones **no** cambian sus versiones ni demuestran qué migración se ejecutó originalmente.

| Archivo local no registrado con su versión | Evidencia efectiva en producción | Alcance de la conclusión |
| --- | --- | --- |
| `20261013051500_fix_archive_reason.sql` | `pg_get_functiondef('public.archive_rectified_commission(uuid,uuid,text)'::regprocedure)`: cuerpo PL/pgSQL idéntico al bloque `AS $func$ ... $func$` del archivo, **1646 caracteres en ambos**. `anon EXECUTE=false`, `authenticated EXECUTE=true`. | El cuerpo de la función está presente; falta rastrear procedencia histórica, grants completos y posibles efectos de otras migraciones. |
| `20261015081500_basic_pro_functional_parity.sql` | Los planes activos `BASIC` y `PRO`, mensuales en COP, tienen **47** `permission:%` habilitados cada uno; la diferencia de conjuntos en ambas direcciones es **0**; catálogo global: **47** permisos. | La paridad funcional observada coincide con el objetivo del script, **no prueba que su transacción se aplicara**, ni equivalencia de cuotas, precios o historial. |
| `20261020222000_revoke_anonymous_crm_access.sql` | `public.contacts` y `public.leads`: RLS activo, `anon` sin SELECT/INSERT/UPDATE/DELETE efectivos; sin privilegios explícitos concedidos a `PUBLIC` en ACL. | La restricción anónima de lectura/escritura observada coincide con el efecto buscado, no prueba equivalencia histórica ni seguridad completa de RPCs. |

Estas evidencias reducen incertidumbre sobre **tres efectos concretos** dentro del grupo sin coincidencia de nombre; **no se reclasifican como versiones equivalentes ni se reduce el contador de 75 desajustes**. No ejecutar `migration repair`, `db push` ni DDL histórico basándose en esta tabla. La verificación E2E/RLS y la conciliación de definiciones restantes siguen pendientes.


## Segundo corte automatizado: 109 SQL vs. 99 migraciones aplicadas

El generador **sin red y sin escritura** `scripts/ops/migration-lineage-audit.mjs` cruza el repositorio con el listado real de versiones/nombres recopilado por `Supabase.list_migrations` y guardado en `docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json`. La prueba `tests/migration-lineage-audit.test.mjs` impide presentar como aplicados archivos que no se correlacionan, y reconoce la colisión preexistente `20261013040000`.

| Clasificación local | Archivos | Interpretación |
| --- | ---: | --- |
| Nombre Y versión coincidentes | **1** | Solo coincidencia de metadatos; DDL no comprobado |
| Mismo nombre pero versión diferente | **60** | Posible reversionado; DDL no comprobado |
| Archivo antiguo (4 dígitos) con nombre coincidente | **25** | Posible ejecución con nueva versión; DDL no comprobado |
| Archivo antiguo sin nombre aplicado | **7** | **Borradores no desplegados `0026_payment_orders_wompi_sandbox` a `0032_atomic_sandbox_payment_order_draft`** |
| Archivo fechado sin nombre aplicado | **16** | Requiere estudio de alias, consolidación u omisión |
| Registro aplicado sin nombre local exacto | **13** | Requiere relación con archivos locales o restauración del DDL histórico |
| Versiones locales duplicadas | **1** | Dos archivos con prefijo `20261013040000` |

**Punto importante:** la migración aplicada `0026_rental_management_core` no corresponde al archivo local `0026_payment_orders_wompi_sandbox.sql`. Coinciden por número `0026` pero **son operaciones distintas**. Los siete borradores de facturación no pueden considerarse ejecutados ni publicarse automáticamente.

### Clasificación de los 16 archivos fechados sin nombre aplicado

- **11 candidatos de nombre renombrado**: `fix_archive_reason` ↔ `fix_commission_archive_reason_ambiguity`; `basic_pro_functional_parity` ↔ `basic_pro_equal_functionality_20261015`; `direct_paid_onboarding` ↔ `direct_paid_onboarding_explicit_20261018`; `tenant_public_catalog` ↔ `public_tenant_catalog_readonly_20261018`; `strict_private_property_read_boundary` ↔ `strict_private_property_read_boundary_20261018`; `tenant_public_website_brand_and_services` ↔ `tenant_public_brand_services_20261019`; `editable_public_portal_sections` ↔ `editable_public_portal_sections_20261020`; `owner_organization_public_slug` ↔ `owner_organization_public_slug_20261020`; `owner_slug_strict_execute_acl` ↔ `owner_slug_strict_execute_acl_20261020`; `public_website_leads` ↔ `public_website_leads_20261020`; `revoke_anonymous_crm_access` ↔ `revoke_anonymous_crm_access_20261020`.
- **4 del bloque financiero consolidado**: `owner_statement_deduction_lines`, `rent_receipts_and_owner_drafts`, `reconcile_owner_deductions`, `finance_rls_and_tenant_links`. Candidato de consolidación **únicamente por temática**, no por equivalencia SQL, con el registro aplicado `20261012070133_audited_rent_receipts_owner_deductions_finance_permissions`.
- **1 sin candidato exacto reconocido**: `commercial_plan_permissions`. Comparar privilegios, políticas y registros realmente presentes antes de asignarle procedencia.

Los **13 registros aplicados sin nombre local exacto** contienen los once candidatos anteriores y, además, `0026_rental_management_core` y el agregado financiero `audited_rent_receipts_owner_deductions_finance_permissions`. Las relaciones indicadas son hipótesis para revisión; **ninguna autoriza `migration repair`**.

### Ejecutar la auditoría offline

```bash
node --test tests/migration-lineage-audit.test.mjs
node scripts/ops/migration-lineage-audit.mjs --ledger docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json
# Para obtener cada fila en JSON reproducible:
node scripts/ops/migration-lineage-audit.mjs --ledger docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json --json
```

**NO-GO sigue vigente**: falta comparar SQL/DDL real, historial de efectos, ACL/RLS y dependencia entre migraciones. Las listas son una fotografía del 02-nov-2026, no una lectura actualizada automáticamente de Supabase ni una autorización de `db push`. La conciliación solo debe ensayarse en una base aislada con el respaldo auténtico existente.
