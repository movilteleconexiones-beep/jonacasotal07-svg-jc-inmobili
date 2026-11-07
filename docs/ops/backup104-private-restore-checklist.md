# INMOJCO #104 — Comprobación privada del respaldo (NO-GO para producción)

**Estado:** herramienta preparada, pero NO se ha recuperado ningún backup auténtico en GitHub/CI. Un resultado favorable del control no permite ejecutar cambios de migraciones en producción.

## Antecedente

El PR #315 ejecutó los 99 SQL históricos en PostgreSQL 17 con dos DDL adicionales fuera del historial. **No recuperó datos de producción, servicios Auth/Storage ni archivos privados.** La incidencia #104 sigue abierta.

Referencias oficiales:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

Un backup de base de datos contiene metadatos de Storage, pero **no** los bytes de imágenes/PDF; éstos requieren el respaldo separado. No colocar copias, credenciales, datos de clientes o claves en GitHub, CI, Railway o comentarios.

## Puerta previa: procedencia del respaldo durante la exportación

El exportador local `scripts/inmojco-backup.mjs backup` ahora aplica **la misma comprobación de destino** que `preflight` antes de consultar Storage, usar PostgreSQL o crear el archivo: URL exacta del Supabase activo, pareja válida de `PGHOST` y `PGUSER` (directo o pooler), base `postgres` y TLS obligatorio. Se rechaza expresamente una conexión a otro proyecto cuyo usuario contenga el identificador de INMOJCO; una coincidencia parcial ya no es prueba de procedencia.

Esta comprobación evita una selección accidental de proyecto, **pero no demuestra** la identidad criptográfica del servidor de Supabase ni la integridad del backup auténtico. No desactivar TLS ni introducir credenciales en GitHub, logs o capturas.

## Paso 1. Inventariar un dump privado sin restaurarlo

Con pg_restore instalado en una estación local de confianza y el archivo **fuera del checkout Git**:

~~~bash
node scripts/ops/backup104-restore-gate.mjs --archive /ruta/privada/INMOJCO.dump
~~~

Solo ejecuta pg_restore --list, calcula SHA-256 y comprueba definiciones y entradas de datos para auth.users, storage.objects, supabase_migrations.schema_migrations y public.properties. No extrae filas ni envía información. Rechaza rutas relativas, enlaces simbólicos y respaldos dentro del repositorio.

Una salida complete:true acredita **solo el índice del archivo**, no integridad, origen, historial, recuperabilidad o funcionamiento de Auth/Storage. Una exportación repartida en roles.sql + schema.sql + data.sql exige inspeccionar la trilogía con un procedimiento adaptado. Un backup físico requiere el mecanismo propio de restauración; pg_restore -l no lo valida.

## Paso 2. Restauración auténtica, nunca contra producción

Restaurar únicamente en una instancia PostgreSQL 17 aislada, compatible con componentes y extensiones de Supabase, en una base llamada jco_backup_104_restore_test. Este PR no implementa un comando automático de restauración: sin el archivo auténtico y el entorno compatible sería inseguro.

No usar túneles hacia Supabase ni suprimir errores de restauración, desactivar RLS o alterar manualmente la tabla de versiones. Registrar localmente checksum, origen, fecha, modo de exportación, resultados y rollback. Ante errores: NO-GO.

## Paso 3. Diagnóstico read-only de la base restaurada

Con psql y autenticación del laboratorio configurados localmente:

~~~bash
node scripts/ops/backup104-restore-gate.mjs --verify-local-db
node scripts/ops/backup104-restore-gate.mjs --verify-local-db --port 5433
~~~

El controlador fija 127.0.0.1, usuario postgres, base de prueba exacta, PostgreSQL 17, default_transaction_read_only=on y timeout. Verifica cuatro tablas físicas, 99 versiones aplicadas, presencia de usuarios Auth **sin leer sus datos** y los 24 fingerprints de catálogo ya usados en PR #315 (14 consignación y 10 portal/comercial/historial).

**Verificación de identidad reforzada:** exige los 24 pares exactos `objeto/componente`, una sola vez cada uno, y resultado `OK` para todos. Un total de 24 filas verdes con una fila duplicada u otra comprobación omitida es **NO-GO**. La CI crea también un `.dump` real con `pg_dump` en PostgreSQL 17 y tablas enteramente ficticias para verificar que su TOC sea legible; esto no sustituye un backup de producción.

**Advertencia de fecha:** las referencias representan el catálogo del 6 de noviembre de 2026. Un respaldo antiguo puede diferir legítimamente y exigir cotejo con la referencia histórica del mismo momento. Nunca alterar el backup ni relajar controles para obtener verde.

## Qué falta antes de cerrar #104

1. Restauración completa del backup auténtico, cadena de custodia y ensayo de recuperación/rollback.
2. Auth/JWT de laboratorio, aislamiento con dos inmobiliarias y Storage privada con su respaldo de objetos.
3. Conciliación de toda la divergencia de versiones y origen de los dos DDL auxiliares: los 24 checks no la prueban.
4. Revisión de un procedimiento por versión, rollback y autorización antes de tocar producción.

Mientras falten esos puntos, **#104 sigue OPEN/NO-GO para db push, migration repair, DDL nuevos y activación comercial dependiente de migraciones**.

La CI solo prueba este validador con datos ficticios y que rechace un archivo ausente; nunca recibe dumps ni secretos.
