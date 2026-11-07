# #104 — Conciliação de versiones sin ejecutar migraciones

**Fecha de lectura del catálogo: 6 de noviembre de 2026.** Base activa: Supabase `cuitgyqrjibgwuniapmk`. Este documento no autoriza escrituras.

## Resultado verificable

El inventario de `main` contiene 109 archivos `.sql` en `supabase/migrations`: 32 ficheros antiguos de cuatro dígitos y 77 fechados de catorce dígitos (76 versiones únicas por un duplicado histórico ya conocido). La base registra 99 migraciones. Solo una versión fechada coincide entre ambos inventarios.

Entre los **76 archivos fechados sin versión equivalente**, 73 están referenciados como fuente de alguno de los **99 cuerpos originales** acreditados por `migration-source-parity-2026-11-06.json`. Esto demuestra procedencia del texto histórico, **NO** que se puedan marcar esas 73 versiones como aplicadas: faltan reconciliación de orden, objetos, dependencias, RLS y permisos finales.

**Tres fuentes sin correspondencia directa** con los 99 cuerpos:

| Archivo candidato | Riesgo que requiere verificación independiente |
|---|---|
| `20261010212630_property_consignment_intake.sql` | Contiene `CREATE TABLE`, índices, RLS y funciones públicas. Los objetos físicos de consignación fueron cotejados contra producción en el PR #302, pero no está acreditado qué ejecución originó esas definiciones. |
| `20261010214633_fix_property_portal_rls_recursion.sql` | Contiene la función de lectura privada y políticas RLS recursivas corregidas. La restauración local verificó la presencia de la función, sin certificar la cronología de esta versión. |
| `20261010222700_commercial_plan_permissions.sql` | **Divergencia comercial material**: intenta establecer BASIC a **104.900 COP**, PRO a **194.900 COP**, crear planes anuales y habilitar un conjunto antiguo de permisos. El catálogo REAL, leído sin modificar datos el 06-nov, registra BASIC **129.900 COP** (5 usuarios, 200 inmuebles, 47 permisos), PRO **299.900 COP** (25 usuarios, 2.000 inmuebles, 47 permisos), sin códigos anuales. Reejecutar este SQL cambiaría condiciones comerciales. |

`migration-version-risk-map.mjs` verifica estas tres huellas Git y bloquea cambios silenciosos, sin conectarse a producción. Es una **clasificación NO-GO**: nunca genera instrucciones para `migration repair` o `db push`.

## Secuencia segura pendiente

1. Ensayar la **cronología de las 99 migraciones originales** sobre una restauración auténtica aislada o un servicio PG17 con esquemas gestionados; contrastar funciones, ACL, triggers, RLS y objetos actuales, no solo nombres de archivos.
2. Reconstruir en ensayo la procedencia física de las dos migraciones de consignación; no volver a crear tablas/funciones existentes en producción.
3. Mantener el catálogo comercial vigente. Decidir explícitamente qué versiones son históricas y cuáles son cambios de negocio nuevos; **no** marcar como aplicados los tres archivos solo por compartir resultado parcial.
4. Preparar un árbol de migraciones limpio en una **rama aislada**, probar una restauración de la misma copia y un `supabase db push --dry-run` exclusivamente tras reconciliar el historial. El comando `migration repair` modifica el ledger aunque no ejecute SQL.
5. Conservar #104 abierto y la barrera de CI hasta demostrar GO con rollback probado.

**Reglas:** no reexportar ni recifrar el respaldo auténtico del 1 de noviembre; no alterar Supabase/Railway/Wompi real ni activar el PR #307, el CRM #281 o el cobro live bajo este diagnóstico.

## Actualización verificada: 06-nov-2026, SELECT-only sobre Supabase activo

Se ejecutó **sin escrituras** `security/checks/consignment_restore_shape_fingerprint.sql` contra `cuitgyqrjibgwuniapmk`, con **14/14 resultados OK**: ACL, identidad, columnas, restricciones, índices, RLS y triggers de las dos tablas de consignación. Estos controles corroboran el esquema **actual**, sin atribuir el CREATE original a una migración específica.

Se ejecutó asimismo `security/checks/unmatched_three_current_live_preflight.sql`, con **10/10 resultados OK**: 
- función privada `private.can_read_portal_property(uuid,uuid)`, definición SHA256 `99043c5260c8396e41f115576b87659646310d4a78057a2b9617a80e001b8609`, SEC DEF, STABLE, `search_path=''`, EXECUTE anónimo denegado y autenticado permitido;
- función `public.has_portal_property(uuid)`, SHA256 `cff460f7627973317147be83d814527fb7792a03f7d0dabb36ab7fedf4688555`, mismas restricciones; la función privada *delega* actualmente en ella, a diferencia del SQL histórico original. Recuperar ese SQL mediante CREATE FUNCTION eliminaría verificaciones actuales sobre contratos y accesos.
- políticas de solo lectura `properties_select_portal_related` y `ownerships_select_portal_owner`: RLS activo, rol exactamente `authenticated`, predicados SHA256 fijados y sin `WITH CHECK`;
- catálogo BASIC 129.900 COP (5/200 y 47 permisos), PRO 299.900 COP (25/2000 y 47 permisos), LIFETIME aún 0 USD / sin cupos ni permisos; ningún plan anual configurado; 99 versiones aplicadas, ninguna de las tres candidatas.

**Entrega reproducible:** resultados de las 24 filas sin datos personales en `docs/ops/snapshots/unmatched-three-live-baseline-2026-11-06.json`; prueba offline adversarial y SQL de catálogo específico. El SQL no requiere credenciales en el repositorio. **Si el catálogo cambia legítimamente, reauditar y actualizar la línea base antes de aceptar nuevas migraciones**.

**Restricciones que permanecen:** 24/24 describe el estado consultado y su seguridad de catálogo, no es prueba E2E con JWT de usuarios de inmobiliarias diferentes ni garantiza qué commit/migración creó los objetos. El SQL histórico de portal y el catálogo comercial **no deben ejecutarse** para reparar números de versión. No equivale a restauración PG17 auténtica ni a la capacidad de declarar GO para #104.
