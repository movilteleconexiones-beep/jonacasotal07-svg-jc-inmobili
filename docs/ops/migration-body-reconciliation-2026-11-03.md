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
