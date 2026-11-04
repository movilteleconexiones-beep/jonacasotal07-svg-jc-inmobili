# INMOJCO #104 — Conciliación de cuerpos SQL auténticos (03-nov-2026)

**Estado: NO-GO para `supabase db push` o `migration repair`.** Este
informe no ordena ni autoriza ejecutar SQL, cambiar RLS ni modificar el
historial. Reúne exclusivamente huellas de archivos y del catálogo de
migraciones leídas de producción.

## Fuente y procedimiento reproducible

- Proyecto Supabase activo: consulta **SELECT** a
  `supabase_migrations.schema_migrations(version,name,statements)`,
  PostgreSQL 17. Había **99 filas**, todas con una sentencia SQL guardada
  (total: 493.804 caracteres). No se extrajeron secretos ni se guardaron
  cuerpos SQL de producción en GitHub.
- `docs/ops/snapshots/supabase-migration-sql-fingerprints-2026-11-03.json`
  conserva, para cada una de esas 99 filas, el nombre, la versión, la
  longitud, SHA-256 del cuerpo y el Git-blob SHA-1 calculado con el formato
  `blob <bytes>\\0<sql>`. Las huellas auxiliares normalizan espacios o
  comentarios completos de línea: **solo sirven para investigar**, NO
  equivalen a demostrar que los scripts ejecutan exactamente lo mismo.
- `scripts/ops/migration-body-fingerprint-audit.mjs` y
  `tests/migration-body-fingerprint-audit.test.mjs` comparan los archivos
  locales con las huellas auténticas, también cuando la versión/nombre
  registrado no coincide con el archivo. El script de auditoría termina
  con **exit status 2 (NO-GO)** por diseño, aun cuando se encuentre una
  coincidencia exacta.

## Resultado: 99 filas aplicadas y 109 archivos del repositorio

| Clasificación | Cantidad |
| --- | ---: |
| SQL aplicado con archivo local idéntico, mismo nombre lógico | 80 |
| SQL aplicado idéntico, pero archivo local retitulado | 11 |
| **Total de sentencias aplicadas con SQL local idéntico byte a byte** | **91** |
| Nombre coincidente, diferencia solo de espacios iniciales/finales | 2 |
| Nombre coincidente, diferencia de comentarios o formato (diagnóstico) | 2 |
| Nombre coincidente, contenido no equivalente por normalización simple | 2 |
| SQL aplicado sin ningún archivo local byte-idéntico | 8 |
| Archivos locales sin nombre lógico aplicado | 23 |
| Migraciones aplicadas sin nombre lógico local | 13 |

Los últimos tres renglones **se superponen con las otras clases** y no
deben sumarse entre sí. De los 23 archivos sin nombre lógico registrado,
11 tienen **SQL idéntico** con distinto nombre y 12 no tienen emparejamiento
lógico ni cuerpo exacto. Los 7 borradores `0026–0032` de Wompi permanecen
**sin aplicar**, no confundirlos con la migración aplicada
`0026_rental_management_core`.

### Seis diferencias por nombre que no deben volver a aplicarse

- **Solo espacios de borde:** `0022_enable_invitation_rls.sql`
  (salto inicial) y
  `20261011000300_independent_owner_trial_entitlements.sql`
  (salto final). La versión aplicada coincide tras quitar espacios en
  los extremos; conservar los originales.
- **Comentarios/formato:** `20261012150000_finance_approval_and_audit_timestamp_hardening.sql`
  y `20261029171601_revoke_disabled_trial_authorization_rpc.sql`.
  Su normalización diagnóstica coincide, no sustituye la comparación
  ejecutable de cuerpo SQL.
- **Contenido materialmente distinto:**
  `20261010212630_property_consignment_intake.sql` y
  `20261010214633_fix_property_portal_rls_recursion.sql`.
  Los registros aplicados en `20261010232928` y `20261010232930`
  contienen bloques **DO de preflight que verifican objetos/permisos y
  recargan esquema**, mientras los archivos locales contienen la
  **definición DDL** de tablas, funciones, políticas e índices. La
  existencia de objetos está parcialmente verificada por otras auditorías,
  pero **esos preflight no prueban cuándo ni con qué definición nacieron
  los objetos**. NO simular una conciliación cambiando versiones.

### Cuatro divergencias históricas delimitadas a formato (03-nov, solo lectura)

Se consultó de nuevo `(statements)[1]` de las cuatro migraciones de
Supabase productivo, **exclusivamente mediante SELECT**, y se compararon
con el contenido de los archivos locales. No se publicaron los cuerpos
SQL, registros personales ni credenciales.

| Versión aplicada | Archivo local | Evidencia |
| --- | --- | --- |
| `20261005053050` / `0022_enable_invitation_rls` | `0022_enable_invitation_rls.sql` | Diferencia de **un salto de línea inicial en el cuerpo aplicado**; texto íntegro idéntico después de recortar whitespace de borde. |
| `20261011002448` / `independent_owner_trial_entitlements` | `20261011000300_independent_owner_trial_entitlements.sql` | Diferencia de **un salto de línea final adicional en el archivo local**; texto íntegro idéntico tras recortar whitespace de borde. |
| `20261012071309` / `finance_approval_and_audit_timestamp_hardening` | `20261012150000_finance_approval_and_audit_timestamp_hardening.sql` | El archivo local suma **cinco comentarios de línea completa**, tres antes de `BEGIN` y dos antes de `CREATE FUNCTION`; están fuera del cuerpo `$`. Las **24 líneas SQL no vacías** resultan idénticas al aplicarlas sin comentarios ni indentación. |
| `20261029171601` / `revoke_disabled_trial_authorization_rpc` | `20261029171601_revoke_disabled_trial_authorization_rpc.sql` | Ambos archivos ejecutan los mismos dos `REVOKE EXECUTE`. El cuerpo aplicado tiene **tres comentarios iniciales** y el local **cuatro**, sin cambiar las seis líneas SQL activas. |

La verificación se inmovilizó mediante
[`tests/migration-format-differences-reconciliation.test.mjs`](../../tests/migration-format-differences-reconciliation.test.mjs):
contra los **SHA-256 auténticos** del snapshot se comprueban los dos
recortes de borde, y los dos cuerpos ejecutables restantes se comparan
con SHA-256 de SQL normalizado **calculado de los cuerpos productivos**
(identificadores, longitudes y huellas solamente). La prueba rechaza
comentarios no revisados y los que estén dentro de `$`, así como
adiciones de SQL ejecutable. Se ejecuta en CI junto a la auditoría
histórica existente.

**Balance más preciso:** de las **8** migraciones sin SQL local
byte-idéntico, **4** ya tienen evidencia de diferencia limitada a
comentarios o whitespace exterior; permanecen **4 con divergencia
histórica sustantiva o sin archivo local** (dos preflight aplicados
frente a DDL local, más `0026_rental_management_core` y el
consolidado financiero de `20261012070133`).

**No cambia la clasificación SHA histórica:** siguen siendo
**91/99** cuerpos byte a byte idénticos, y siguen existiendo **8**
cuerpos sin copia exacta local. Aunque las cuatro variantes de
formato no alteren las instrucciones SQL identificadas, las
diferencias de versiones y secuencia requieren reconciliación y
`migration repair` **no queda autorizado**. Este proceso no verifica
en general equivalencia semántica del resto de SQL ni estado
histórico exacto del catálogo.

### Dos filas productivas sin SQL local idéntico ni nombre lógico local

1. `20261005153559 / 0026_rental_management_core` — cuerpo aplicado
   registrado de unas 4,9 KB; crea 4 tablas y 4 políticas. No corresponde
   al archivo `0026_payment_orders_wompi_sandbox.sql` (borrador
   distinto y no aplicado). Requiere comparar relaciones y RLS reales.
2. `20261012070133 /
   audited_rent_receipts_owner_deductions_finance_permissions` — cuerpo
   consolidado de unas 28 KB; crea 2 tablas, 5 funciones, 9 políticas y
   un disparador, además de otras reglas. Su contenido no es el de un
   archivo único: las cinco migraciones financieras históricas locales
   tienen otros IDs. Ya se comprobaron **46 objetos, 20 controles
   funcionales/de permisos, 24 restricciones completas y 9 políticas
   financieras** en las auditorías del PR #285, pero la equivalencia
   histórica global sigue sin probarse.

### Verificación puntual de `0026_rental_management_core` (03-nov, solo lectura)

Se contrastó la sentencia SQL histórica auténtica de la versión
`20261005153559` (4.878 bytes) con el catálogo vivo de Supabase.
La consulta reproducible, **SELECT únicamente**, quedó en
[`security/checks/rental_core_0026_live_catalog.sql`](../../security/checks/rental_core_0026_live_catalog.sql).
**Resultado ejecutado y comprobado**:

| Tabla del SQL aplicado | Existe | RLS | Índice inicial | Política inicial `TO authenticated` | Grants anon SELECT/INSERT/UPDATE/DELETE/MAINTAIN |
| --- | --- | --- | --- | --- | --- |
| `leases` | Sí | Sí | Sí | Sí | No/No/No/No/No |
| `rent_payments` | Sí | Sí | Sí | Sí | No/No/No/No/No |
| `owner_statements` | Sí | Sí | Sí | Sí | No/No/No/No/No |
| `maintenance_requests` | Sí | Sí | Sí | Sí | **Sí/Sí/Sí/Sí/Sí** |

También están las **10 claves funcionales** originales de permisos.
Las cuatro tablas tienen las restricciones y columnas actuales; otras
migraciones posteriores han añadido/modificado controles, por lo que el
catálogo actual **no puede declararse idéntico al estado histórico** ni
restablecerse a partir del SQL antiguo.

**Detalle de riesgo:** las dos políticas actuales de
`maintenance_requests` se dirigen a `authenticated`, una PERMISSIVE
(`maintenance_org_access`) y otra RESTRICTIVE
(`jco_commercial_access`) con guardas de acceso operacional por agencia.
Por tanto, los grants anónimos de CRUD **no demuestran** lectura/escritura
indebida de filas; sí crean privilegios SQL innecesarios, y el grant
`MAINTAIN` **no está gobernado por RLS**. Esta consulta no hizo `SET ROLE`
ni intentó acceder a datos de otra inmobiliaria.

**Siguiente aceptación para este caso:** en PostgreSQL 17 aislado
comprobar la revocación de grants anónimos innecesarios sin afectar el
acceso autorizado del equipo, el portal público ni `service_role`; auditar
la definición completa y el orden de las migraciones posteriores sobre
tablas, FK y políticas. No ejecutar la revocación ni `migration repair`
en producción mientras #104/#203 sigan abiertos. Esta prueba cierra
**presencia de objetos base, no equivalencia histórica completa**.

**Candidato adicional no desplegado (03-nov):** tras revisar los grants
reales de `maintenance_requests` se preparó
[`security/candidates/revoke_maintenance_requests_anon_crud.sql`](../../security/candidates/revoke_maintenance_requests_anon_crud.sql).
Su prueba PostgreSQL 17 aislada
(`security/tests/maintenance_anon_crud_pg17.sh`) comprueba revocación
de CRUD anónimo, bloqueo por cambios de rol/políticas/grants `PUBLIC`,
idempotencia, conservación de los derechos de personal y `service_role`,
y aislamiento entre dos inmobiliarias ficticias. Ver
[`docs/ops/maintenance-anon-crud-hardening-2026-11-03.md`](maintenance-anon-crud-hardening-2026-11-03.md).
**No retira MAINTAIN**, cuya remediación global continúa separada en
dos fases por propietario. Ninguno de los candidatos se ejecutó sobre
producción, y las ocho diferencias históricas siguen sin equivalencia
completa probada.

**Integridad adicional detectada (03-nov):** el FK original de
`maintenance_requests.property_id` referencia solamente `properties.id`,
sin verificar que ambas filas tengan el mismo `organization_id`.
En producción hay cero solicitudes registradas y cero vínculos
cruzados, pero las escrituras futuras quedarían expuestas a un vínculo
incorrecto aun con RLS. Se preparó la candidata
[`security/candidates/maintenance_requests_property_tenant_fk.sql`](../../security/candidates/maintenance_requests_property_tenant_fk.sql)
para **sustituir en la misma transacción la FK existente** por una
FK compuesta, manteniendo su nombre
`maintenance_requests_property_id_fkey` y `ON DELETE CASCADE`,
sin duplicar rutas `maintenance_requests -> properties` de PostgREST.
La primera versión de la candidata sumaba una FK paralela que podía
generar ambigüedad de embeds (`PGRST201`); se corrigió antes de cualquier
despliegue. El fixture PostgreSQL 17 de dos organizaciones comprueba
la vulnerabilidad original, el rechazo después de la candidata, la
idempotencia y la existencia de **una sola** relación FK por padre.
[Análisis, preflight y plan de staging](maintenance-property-tenant-integrity-2026-11-03.md).
**No desplegada ni autorizada para producción.**

### Contrato original de `0026_rental_management_core` validado (04-nov, solo lectura)

Una comprobación adicional contra las **47 definiciones originales de columnas**
del cuerpo aplicado `20261005153559` verificó
nombre, tipo PostgreSQL y nulabilidad, y la presencia de los cuatro
índices originales válidos, cuatro políticas iniciales `FOR ALL TO authenticated`
y RLS activo. Resultado de Supabase: **4/4 tablas
`BASELINE_COMPATIBLE`, 47/47 columnas originales**.

| Tabla | Compatibles | Columnas añadidas por evolución |
| --- | ---: | ---: |
| `leases` | 15/15 | 5 |
| `rent_payments` | 10/10 | 0 |
| `owner_statements` | 12/12 | 2 |
| `maintenance_requests` | 10/10 | 0 |

[SELECT reproducible](../../security/checks/rental_0026_baseline_contract_live.sql),
[prueba estática fail-closed](../../tests/rental-0026-baseline-contract.test.mjs),
[alcance y límites](rental-0026-historic-baseline-2026-11-04.md).

El esquema actual **amplía** el de 2026-10-05. Este resultado
refuerza la capacidad de reconstrucción de las tablas históricas,
pero no acredita equivalencia completa de checks, FKs, funciones ni
definiciones de RLS posteriores, ni la procedencia de su SQL aplicado
dentro de Git. El caso histórico `0026` **sigue en los cuatro
divergentes sustantivos #104** hasta recreación íntegra y autorizada
en staging; no ejecutar DDL ni reparar el historial productivo.

### Preflight de consignación y recursión (03-nov, solo lectura)

Se consultó el SQL **auténticamente registrado** en Supabase para las
versiones `20261010232928 / property_consignment_intake` y
`20261010232930 / fix_property_portal_rls_recursion`.
Ambas contienen **bloques `DO` de preflight y `NOTIFY` de recarga**,
no las definiciones de objetos presentes en los dos archivos DDL locales.
No intentar conciliarlos con renombrado automático ni repetir el DDL.

La consulta de catálogo segura y reproducible
[`security/checks/consignment_portal_20261010_preflight_live_catalog.sql`](../../security/checks/consignment_portal_20261010_preflight_live_catalog.sql)
se ejecutó mediante SELECT en producción. Resultado: **16/16
comprobaciones `OK`, ninguna `DRIFT`**:

- **12 comprobaciones de consignación:** tablas `private.property_intake_sites`
  y `public.property_consignments` presentes; sus RLS activas; tres RPC
  presentes; sin SELECT anónimo a la tabla privada ni INSERT autenticado
  a la cola; RPC anónima de envío concedida; política de lectura de la
  cola y los seis índices originales presentes.
- **4 comprobaciones de recursión:** helper
  `private.can_read_portal_property(uuid,uuid)` presente; política de
  propiedades lo referencia; política de propietarios vinculados presente;
  `anon` sin permiso EXECUTE sobre el helper.

Se agregó prueba offline
`tests/historic-consignment-portal-preflight.test.mjs` para asegurar que
este preflight se mantiene como SELECT, conserva los 16 identificadores
y rechaza cambios mutadores u omisiones; añadida al job CI existente
`Authentic applied SQL body fingerprints, all migrations NO-GO (#104)`.

**Interpretación limitada:** el resultado 16/16 demuestra que el
preflight histórico seguiría encontrando los objetos esperados con las
restricciones listadas; **no** acredita equivalencia byte a byte entre
el cuerpo SQL aplicado y los archivos DDL locales, ni prueba que el
helper elimine toda recursión, ni la seguridad E2E con sesiones reales.
Los dos casos **siguen clasificados como diferencias sustantivas
históricas** para #104. No ejecutar DDL, `db push` ni
`migration repair` en producción por este resultado.

### Compatibilidad CRM y PostgREST: cinco rutas FK sin duplicación (03-nov)

La primera candidata `security/candidates/crm_tenant_links_composite_fk.sql`
añadía cinco FKs compuestas **en paralelo** a las FKs simples
existentes de prospectos y consignaciones. Aunque su prueba acreditaba
aislamiento de filas, ello podía romper las relaciones embebidas de
PostgREST por caminos de unión ambiguos.

**Corregido antes de despliegue:** las cinco FKs se **sustituyen** en
lugar de duplicarse, conservando sus nombres originales y el
comportamiento `NO ACTION`. Su prueba aislada exige ahora una
sola relación por cada par hija-padre, rechaza una ruta paralela
inyectada y repite la ejecución para confirmar idempotencia, además
de los rechazos de referencias cruzadas ya existentes.
Ver [contrato y requisitos de staging](crm-single-fk-postgrest-2026-11-03.md).

Como en mantenimiento, no está autorizado ejecutar esta candidata en
producción ni inferir de sus pruebas una reparación histórica.

### Comisiones → negocios: FK sin alcance de inmobiliaria (03-nov, revisión adicional)

En el catálogo productivo `commissions.deal_id` usa FK simple hacia
`deals.id`; no obliga que ambas tablas coincidan en `organization_id`.
En una consulta de agregados, **6 comisiones existentes y 0 cruces entre
inmobiliarias**. El candidato
[`security/candidates/commissions_deal_tenant_fk.sql`](../../security/candidates/commissions_deal_tenant_fk.sql)
construye `UNIQUE(deals.organization_id,deals.id)` y **reemplaza** la FK
original por una compuesta, preservando su nombre y `ON DELETE CASCADE`.
Se evita tener simultáneamente dos FKs hacia `deals`, que generaría
ambigüedad de relaciones de PostgREST. La prueba aislada
`security/tests/commissions_deal_tenant_fk_pg17.sh` demuestra el vínculo
cruzado previo, su rechazo posterior, validación de datos antiguos,
RLS entre dos inmobiliarias, permisos e idempotencia.

[Análisis y condiciones de ejecución](commissions-deal-tenant-fk-2026-11-03.md).
**Este candidato no se ha ejecutado en Supabase real ni se incorpora al
historial de migraciones.** La corrección requiere staging, backup
restaurable, compatibilidad PostgREST, control de locks y NO-GO #104/#203.

### Portal externo: vínculos entre cliente, propietario y organización (03-nov)

Se confirmó por catálogo que `portal_access_links` conserva FKs simples
hacia `contacts(id)` y `property_owners(id)`. **Su política RLS de
inserción ya exige pertenencia a la misma organización**, y una
consulta agregada sobre los 3 vínculos existentes (2 de contacto, 1
de propietario) devolvió **0 cruces**. No hay evidencia de una fuga
activa; se busca reforzar también las operaciones privilegiadas
que no dependen de RLS.

Se preparó, **sin aplicar**,
[`security/candidates/portal_links_tenant_composite_fks.sql`](../../security/candidates/portal_links_tenant_composite_fks.sql)
y un fixture `security/tests/portal_links_tenant_composite_fks_pg17.sh`
de dos organizaciones sintéticas. La candidata sustituye las FKs
por versiones con `(organization_id,contact_id)` y
`(organization_id,owner_id)`, conservando nombres y ON DELETE CASCADE,
sin introducir un segundo camino de unión PostgREST.
[Análisis y criterios de aceptación](portal-links-tenant-fk-2026-11-03.md).

Estas defensas quedan como candidatas, no migraciones aplicadas ni
autorización de `db push` / `migration repair`.

### Origen de DDL de consignación: prueba de procedencia (03-nov, SELECT)

La consulta reproducible de lectura
[`security/checks/consignment_ddl_provenance_live_catalog.sql`](../../security/checks/consignment_ddl_provenance_live_catalog.sql)
buscó **definiciones directas** `CREATE TABLE` y `CREATE FUNCTION`
sobre cinco objetos históricos en los **99 cuerpos SQL registrados**
en `supabase_migrations.schema_migrations`. Las cinco entidades
**existen actualmente** en el catálogo de Supabase.

| Objeto presente hoy | Coincidencias de DDL directo en el ledger |
| --- | --- |
| `private.property_intake_sites` | **0** sentencias `CREATE TABLE` directas |
| `public.property_consignments` | **0** sentencias `CREATE TABLE` directas |
| `private.can_read_portal_property` | 1: `20261015085250 / scope_external_owner_and_tenant_data` |
| `public.get_public_property_intake_site` | 1: `20261021032153 / gate_public_consignment_operational_access` |
| `public.submit_property_consignment` | 1: `20261021032153 / gate_public_consignment_operational_access` |

**Implicación:** los dos `DO` de preflight aplicados el
10-oct no justifican por sí mismos la creación de las dos tablas.
El historial registrado tampoco muestra instrucciones directas
`CREATE TABLE` para ellas. Las definiciones posteriores de funciones
no demuestran su fuente original previa a la prueba de precondiciones.
Esta observación **no demuestra** DDL manual: aún podrían existir
instrucciones SQL dinámicas, otras rutas de aplicación o DDL no
registrado. Se requiere identificar la procedencia original o
reconstruirla en un staging íntegramente recuperable, sin cambiar
el historial productivo a ciegas.

El SELECT de procedencia está protegido por
`tests/historic-consignment-ddl-provenance.test.mjs` y su ejecución
offline en CI. Busca firmas directas y devuelve únicamente
identificadores y versiones; **no** exporta cuerpos SQL, datos
personales ni credenciales. Tampoco prueba equivalencia histórica de
funciones o cuándo se instalaron por primera vez.

### Recuperación de la forma real de las dos tablas de consignación (03-nov)

Se añadió una referencia **de solo lectura** que permite detectar
cambios en la estructura de `private.property_intake_sites` y
`public.property_consignments`, dos tablas presentes cuyo `CREATE TABLE`
directo no se localizó en las 99 sentencias aplicadas.

[`security/checks/consignment_restore_shape_fingerprint.sql`](../../security/checks/consignment_restore_shape_fingerprint.sql)
fija 6 SHA-256 por tabla (columnas/defaults, constraints, índices,
políticas, triggers y ACL) más dueño/tipo/RLS. El SELECT en la
base real devolvió **14/14 `OK`**, sin leer datos de clientes:
`private.property_intake_sites` tiene 5 columnas, 6 constraints,
2 índices, 0 políticas y 0 triggers; `public.property_consignments`
tiene 15 columnas, 15 constraints, 9 índices, 2 políticas y
0 triggers. Se verificaron también privilegios API.

Un [test offline](../../tests/consignment-restore-shape-contract.test.mjs)
en CI comprueba que el auditor **no lee datos ni ejecuta DDL/DML**,
que las huellas están fijas y que se necesitan exactamente
14 respuestas `OK` para aprobar una captura real.
[Informe de recuperación y límites](consignment-recovery-shape-2026-11-03.md).

**Importante:** la huella no reemplaza un `pg_dump`, backup
restaurable, archivos Storage, ni establece el origen histórico de
las tablas. Es evidencia de la estructura **actual**, no autorización
para recrear objetos o reparar migraciones productivas.

## Decisión y pasos seguros

**Mantener #104 y #203 como NO-GO.** No ejecutar ni programar
`migration repair`, `db push`, `db reset` sobre producción, ni fusionar
automáticamente las 109 migraciones. No crear una rama de Supabase con
coste sin control ni autorización.

En el siguiente ciclo verificar por lectura los objetos de
`0026_rental_management_core` y el DDL que precede a los dos
preflight de consignación. Luego preparar una matriz objeto/versión/huella
para los 8 casos sin identidad byte a byte. Las PR #285 (migraciones) y
#286 (CI de `main`) deben permanecer separadas y en borrador hasta
completar los controles de lanzamiento.

**Este informe documenta evidencia, no autoriza un despliegue.**
