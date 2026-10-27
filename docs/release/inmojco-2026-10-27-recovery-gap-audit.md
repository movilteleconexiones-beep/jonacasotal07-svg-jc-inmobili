# INMOJCO — Inventario verificable y brechas de recuperación (2026-10-27 UTC)

> **Estado: NO existe evidencia de respaldo integral ni restauración probada.**
> Documento operativo, sin secretos, datos de clientes ni rutas individuales de Storage.
> No autoriza despliegues, fusiones, migraciones ni cambios en producción.

## Referencias verificadas

- Repositorio: `movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili`.
- Supabase producción: `cuitgyqrjibgwuniapmk` (PostgreSQL 17.11, proyecto ACTIVE_HEALTHY).
- Railway producción: `c10633f5-6d42-41ea-93d8-2ab66e7072c8`.
- `main` al momento de la inspección: `28c6b1377359852f76ea2f8c53f58b3bfac568b2`.
- Último despliegue exitoso de los dos servicios: `a614edab544c311d6fbf4c0c01a662f8e38de58a`, 2026-10-21 03:40 UTC.
- Diferencia comprobada: `main` tiene cuatro commits posteriores y once archivos modificados respecto al despliegue.
- Rama de referencia de código: `backup/inmojco-2026-10-27-verificado`, idéntica al SHA de `main` observado. **No inmutable**: 0 rulesets GitHub encontrados.
- Inventario PostgreSQL: tamaño aproximado **17 MB**, **58 tablas públicas**.
- Storage: **4 buckets privados**, **5 objetos registrados** en total (4 inventario privado, 1 documentos de organización, 0 consignaciones, 0 soportes de arrendamiento).
- Dos migraciones de 2026-10-21 no están registradas en `supabase_migrations.schema_migrations`; el control de incompatibilidad de checkout y los cinco índices esperados sí existen. **Reconciliar historial antes de reaplicar.**

## Cobertura real (verificado frente a pendiente)

| Elemento | Comprobación actual | Recuperación |
| --- | --- | --- |
| Código Git | Rama apunta al commit observado | Falta proteger contra actualización/borrado y copia fuera del repositorio |
| PostgreSQL | Servicio responde y metadatos consultados | **Sin dump completo verificable ni restauración aislada** |
| Supabase Storage | Buckets privados, 5 objetos registrados | **Sin copia de bytes ni comparación de hashes** |
| Auth, roles y extensiones | Incluidos en la instancia activa | **Restauración real no ensayada** |
| Wompi y secretos | No se copiaron ni consultaron | **Reconfiguración segura pendiente** |
| Railway, DNS y otros servicios | Inventario de despliegues disponible | **Sin recuperación de configuración ensayada** |

## Pasos para cerrar el bloqueo sin afectar producción

1. **Proteger referencias Git**: en GitHub Settings → Rules → Rulesets → New branch ruleset, seleccionar ramas `backup/**` y habilitar restricciones de actualización y eliminación sin excepciones operativas. Verificar después la regla activa mediante `GET /repos/{owner}/{repo}/rulesets`. La referencia Git SHA es evidencia de código, **no** de base de datos ni de Storage.
2. **Crear exportación cifrada y fuera de Git**: desde un entorno confiable, ejecutar el procedimiento oficial de Supabase de exportación `db dump`/`pg_dump` con conexión temporal administrada por el operador; no registrar URI, claves ni archivos en el repositorio o en logs. Verificar el código de salida y calcular SHA-256 localmente. La exportación debe cubrir esquemas relevantes, datos, identidades y roles conforme al método elegido.
3. **Copiar bytes de Storage**: exportar los objetos privados con autorización restringida y temporal mediante la API oficial, preservando bucket, ruta, tamaño y SHA-256 **en manifiesto cifrado privado**. No guardar rutas ni contenidos en un informe público. Validar que 5 objetos (línea base de la inspección) y sus hashes coincidan al momento del respaldo; el número real puede cambiar.
4. **Ensayo de restauración aislada**: restaurar el mismo archivo cuyo hash fue calculado a un PostgreSQL 17 compatible o a un proyecto de prueba **distinto de producción**; verificar tablas, restricciones, funciones, datos, RLS, roles y dependencias. Restaurar también archivos privados a Storage del entorno de ensayo; volver a calcular los hashes. Registrar versión, fecha UTC, destino y resultados.
5. **Confirmar evidencia antes de publicar**: utilizar `scripts/release-readiness.mjs`, que exige SHA del respaldo, SHA del archivo realmente restaurado, destino local/staging y comprobaciones financieras, RLS y de despliegue. Nunca forzar indicadores `true` sin pruebas reales.
6. **Revisar historial de migraciones y CI**: no aplicar dos veces migraciones cuyos efectos ya existen. Ejecutar la batería CI sobre el commit exacto candidato, comprobar los controles de acceso multiinmobiliaria, no usar Wompi real en las pruebas.
7. **Conservar recuperación externa**: guardar archivos cifrados, claves de descifrado custodiadas por el propietario (separadas del backup) y manifiesto fuera de GitHub/Supabase. Ensayar restauración periódicamente y evitar exposición pública de datos personales.

### Diagnóstico repetible no destructivo

`security/diagnostics/recovery_inventory_readonly.sql` realiza solo lecturas de metadatos y conteos en una transacción `READ ONLY`; no exporta información de clientes ni los nombres individuales de archivos. No sustituye un respaldo.

### Evidencia mínima privada para una restauración aprobada

- Fecha UTC, proyecto fuente, SHA de commit y origen real del backup.
- Archivo de PostgreSQL cifrado y su SHA-256, con almacenamiento fuera de producción.
- Manifiesto cifrado de Storage, conteo y hashes de bytes.
- Destino de restauración aislado, SHA de archivo restaurado (igual al respaldado), comprobación de lectura, conteos y permisos.
- Validación de CRM, cobros, abonos, deducciones, liquidaciones, acceso SuperAdmin y dos organizaciones independientes.
- Fecha de revisión y aprobación humana para publicar.

### Fuentes operativas oficiales

- Supabase: https://supabase.com/docs/guides/platform/backups
- Supabase: https://supabase.com/docs/guides/platform/clone-project
- GitHub: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository

**Nota:** Supabase indica que los backups de la base **no contienen los bytes de Storage**. No activar PITR, crear proyectos ni asumir costos sin autorización específica.
