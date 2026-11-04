# INMOJCO #104 — Huellas estructurales de tablas de consignación (sin DDL de origen)

**Fecha de captura:** 03-nov-2026 · **Estado:** EVIDENCIA DE SOLO LECTURA; **NO-GO** para recuperación/publicación.

## Por qué es necesaria esta evidencia

Las tablas `private.property_intake_sites` y `public.property_consignments`
están presentes en el Supabase activo. Sin embargo, el examen de las
**99 versiones aplicadas** no encontró sentencias **directas**
`CREATE TABLE` para esas dos tablas; las versiones aplicadas de
`property_consignment_intake` y `fix_property_portal_rls_recursion`
contienen preflight `DO`, no el DDL de los archivos locales.

**No está demostrado que su creación fuese manual**: la búsqueda no
descarta SQL dinámico ni una ruta histórica no registrada. Para avanzar
en restauraciones seguras hace falta capturar el estado observable sin
simular ni falsear versiones de migraciones.

## Contrato reproducible

[`security/checks/consignment_restore_shape_fingerprint.sql`](../../security/checks/consignment_restore_shape_fingerprint.sql)
es un SELECT sobre `pg_catalog` que fija los SHA-256 del catálogo en
PostgreSQL 17. No lee datos de clientes ni almacena DDL completo.

Verifica **7 categorías por tabla, 14 comprobaciones en total**:
identidad/owner y RLS, columnas y defaults, restricciones y validez,
índices y definiciones, políticas RLS con roles y condiciones, triggers
y privilegios (ACL real y acceso efectivo de roles API).

| Estructura activa | Columnas | Restricciones | Índices | Políticas RLS | Triggers | RLS |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `private.property_intake_sites` | 5 | 6 | 2 | 0 | 0 | Activo |
| `public.property_consignments` | 15 | 15 | 9 | 2 | 0 | Activo |

**Ejecución real contra Supabase:** **14/14 `OK`**.
Los datos son únicamente tamaños y huellas estructurales, no
inventarios de consignaciones ni registros del propietario.

Control de límites de acceso: para `private.property_intake_sites`,
`anon`, `authenticated` y `service_role` no tienen SELECT directo
efectivo a la tabla. Para `public.property_consignments`, `anon`
no tiene SELECT/INSERT directo, `authenticated` tiene SELECT pero
no INSERT, y `service_role` tiene SELECT. Es una observación
del estado actual, **no** una propuesta de GRANT.

## Prueba automatizada de seguridad del auditor

[`tests/consignment-restore-shape-contract.test.mjs`](../../tests/consignment-restore-shape-contract.test.mjs)
se ejecuta en CI junto a la auditoría histórica. Confirma que la
consulta se limite a `pg_catalog`, rechaza instrucciones mutadoras
y lecturas de filas de tablas del negocio, exige las dos identidades
y las siete categorías, fija los SHA-256 y prueba que la aceptación
exige exactamente **14 respuestas `OK`**, sin faltar ni duplicar.

Una CI verde **solo valida la prueba y el contrato SQL versionado**.
Para comprobar el estado activo, se debe **volver a ejecutar** el
SELECT contra el entorno real o de recuperación: si algo no coincide,
la salida muestra `DRIFT`/ `MISSING`. Es esperable que las
actualizaciones legítimas de esquema modifiquen huellas; no se deben
restaurar ni revertir objetos automáticamente por esa diferencia.

## Límite de esta evidencia

Los hashes del catálogo **no constituyen un respaldo**: no contienen
sentencias completas de `CREATE TABLE`, datos, dependencias exteriores
a las tablas, configuración de Auth o archivos Storage. Tampoco revelan
la secuencia temporal en que se crearon o cambiaron los objetos.

Para validar recuperación real faltan (1) backup auténtico, cifrado y
restaurable de estructura, datos autorizados y Storage; (2) ensayo
de restauración en staging aislado con costes controlados; (3) reproducir
SELECT y verificar 14/14 `OK`; (4) probar funciones, RLS por dos
inmobiliarias, formulario de consignación, fotos privadas y portal;
(5) reconciliar las otras migraciones #104 y obtener autorización
de publicación #203.

**No ejecutar `supabase db push`, `migration repair` o DDL de
producción para «arreglar» un hash. Wompi sigue en sandbox.**
