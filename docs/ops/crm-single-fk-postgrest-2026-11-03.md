# INMOJCO — CRM multi-inmobiliaria sin FKs paralelas

**03-nov-2026 · corrección de candidata NO desplegada · #104/#203 NO-GO**

## Defecto de diseño detectado antes de publicar

La versión previa de
[`security/candidates/crm_tenant_links_composite_fk.sql`](../../security/candidates/crm_tenant_links_composite_fk.sql)
añadía **cinco claves foráneas nuevas** para garantizar el aislamiento
de organizaciones entre `leads`, `contacts`, `properties` y
`property_consignments`, sin eliminar las claves simples existentes.

Aunque las cinco FKs compuestas sí impedían datos cruzados en PostgreSQL,
al crear múltiples relaciones entre las mismas tablas podrían afectar
consultas con recursos incrustados de PostgREST (`PGRST201`: relación
ambigua). La seguridad referencial no basta si rompe la navegación y
la operación del portal/CRM.

## Corrección preparada

La candidata ahora **reemplaza las cinco FKs existentes por versiones
compuestas**, **con los mismos nombres**, para mantener exactamente
una ruta a cada tabla padre:

| Tabla hija → padre | FK original conservada (nombre) | Nueva referencia |
| --- | --- | --- |
| `leads` → `contacts` | `leads_contact_id_fkey` | `(organization_id, contact_id)` → `(organization_id,id)` |
| `leads` → `properties` | `leads_property_id_fkey` | `(organization_id, property_id)` → `(organization_id,id)` |
| `property_consignments` → `contacts` | `property_consignments_contact_id_fkey` | `(organization_id,contact_id)` → `(organization_id,id)` |
| `property_consignments` → `properties` | `property_consignments_property_id_fkey` | `(organization_id,property_id)` → `(organization_id,id)` |
| `property_consignments` → `leads` | `property_consignments_lead_id_fkey` | `(organization_id,lead_id,contact_id)` → `(organization_id,id,contact_id)` |

Conserva el índice único necesario de los prospectos sobre
`(organization_id,id,contact_id)` y el `CHECK` que exige contacto
al vincular un prospecto: una FK compuesta ordinaria permite valores
`NULL` si falta una columna de referencia (`MATCH SIMPLE`).

El preflight exige ejecutar como `postgres`, que las cuatro tablas
mantengan sus propietarios y RLS, que existan índices únicos en contactos
e inmuebles, que haya una sola FK por par hija-padre y que **no existan
referencias cruzadas**. La corrección corre en transacción con bloqueo
limitado y valida las nuevas restricciones. En un fallo revierte todo.

Se notifica `pgrst` para actualizar el esquema REST. Se mantiene una
sola ruta por tabla padre, nombre de FK original y derechos de rol
existentes. Las FKs originales no tenían `ON DELETE CASCADE`; las
nuevas conservan el comportamiento predeterminado `NO ACTION`.

## Cobertura aislada de CI

La prueba `security/tests/crm_tenant_links_fixture.sql` simula
dos inmobiliarias ficticias, con RLS para las cuatro tablas.
`crm_tenant_links_preflight.sql` demuestra un vínculo inválido que
el FK simple previo permite; `crm_tenant_links_cleanup.sql` remueve
los datos falsos inválidos antes de ensayar la candidata.

El paso de GitHub Actions:

- exige que la candidata bloquee el vínculo cruzado preexistente;
- introduce temporalmente una segunda FK en el fixture y verifica
  que la candidata lo rechace antes de modificar el esquema;
- ejecuta la candidata dos veces y comprueba su idempotencia;
- verifica que hay cinco FKs compuestas validadas con **nombres
  originales** y **exactamente una relación por par hija-padre**;
- valida operaciones legítimas y bloqueo de cruces bajo rol autenticado,
  además de la protección por `NULL`.

No ejecutar esta candidata en producción por aprobar la CI. Antes se
requieren: reconciliación histórica #104, copia restaurable, staging
compatible con la versión real de PostgREST, ensayo E2E con enlaces
`select` incrustados del CRM y la portada, control de locks, revisión
de dependencias y reversión documentada, protección de `main` y
activación de checks en Railway.

**Ningún DDL/DML se ejecutó contra Supabase productivo, ni se modificó
el historial SQL; Wompi sigue en sandbox.**
