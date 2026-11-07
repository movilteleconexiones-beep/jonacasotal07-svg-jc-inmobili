# #104 — Primera reproducción cronológica ejecutada en PostgreSQL 17

**Evidencia: 6 de noviembre de 2026.** Esta prueba no autoriza aplicar migraciones en Supabase de producción.

## Dos resultados distintos — no confundir

1. **Replay de cuerpos registrados sin inyecciones:** en una base PostgreSQL 17 de GitHub Actions, con esquema Auth/Storage **ficticio y vacío**, pasan **27/99** cuerpos SQL originales en orden. El original aplicado **#28** (`20261010232928_property_consignment_intake`) se detiene con el error `Incomplete consignment migration`. Este es un **preflight DO** que verifica tablas/RPC previamente existentes, sin crearlas. Un replay puramente cronológico de los 99 cuerpos es **insuficiente**.
2. **Reconstrucción asistida, solo en la base desechable:** antes del preflight #28 se inyecta el archivo local `20261010212630_property_consignment_intake.sql`, SHA Git `e4b252f022cf76f5ad773060ff86d33c29ef564c`; antes de #29 se inyecta `20261010214633_fix_property_portal_rls_recursion.sql`, SHA Git `e6cb9a3923328158a42c86644fb4a591df25eba9`. Estas fuentes **NO forman parte de las 99 versiones aplicadas y NO se registran como migraciones**. Con esas dos dependencias más simulación de componentes administrados por Supabase (roles, Auth, Storage, extensión `pgcrypto`, ACL y ledger temporal), se ejecutan **99/99** cuerpos SQL originales por SHA en orden. La prueba no inserta clientes, cuentas, propiedades ni contratos reales.

La consulta final ejecutada en el PG17 desechable contrasta **14/14 controles de consignación** y **10/10 controles de portal/comercial/historial** contra las definiciones/fingerprints leídas de Supabase activo el 6 de noviembre: **24/24 compatibles**. Esta comparación solo cubre el catálogo de objetos definido en esas consultas; **no es una equivalencia integral del esquema o datos**.

## Seguridad de la ejecución

- `security/tests/chronological_pg17_first_26.sh`: prueba positiva de las primeras 26 migraciones sin inyecciones.
- `security/tests/chronological_pg17_probe_99.sh`: prueba negativa determinista; debe fallar en la versión 28 **después de 27**, con el error esperado.
- `security/tests/chronological_pg17_bridge_probe.sh`: prueba asistida con exactamente dos fuentes adicionales verificadas por hash antes de sus preflights. Inserta versiones en un ledger **ficticio de la base temporal** solo después de que el SQL ejecutado terminó bien. La comparación 24/24 **falla la CI** ante DRIFT/MISSING.
- `security/tests/chronological_pg17_auth_stub.sql`: roles `NOLOGIN`, Auth/Storage mínimos, permisos iniciales administrados para `service_role` y `pgcrypto` en `extensions`; no es una copia auténtica de la infraestructura Supabase.
- `.github/workflows/migration104-replay.yml`: job rápido e independiente sin secretos, con PostgreSQL 17 local, base y roles inexistentes antes del arranque, limpieza al salir y alcance estrictamente GitHub Actions.

## Lo que aún bloquea cerrar #104

**Se ha demostrado** la ejecutabilidad del esquema inicial con dos DDL fuera del historial y la compatibilidad de 24 comprobaciones de catálogo. **No se ha demostrado** qué ejecución aplicó originalmente esos dos DDL, ni la restauración del backup binario auténtico con Auth/Storage completos, ni el aislamiento funcional con cuentas independientes, ni rollback o estado de registros, ni que `supabase migration repair` / `db push` sean seguros.

El archivo local `20261010222700_commercial_plan_permissions.sql` **no se ejecuta**; pretende precios antiguos y la referencia comercial vigente se preserva. El proyecto sigue en `NO-GO` para DDL/migration repair en producción; licenciamiento PR #307 y CRM #281 no se activaron en este trabajo.
