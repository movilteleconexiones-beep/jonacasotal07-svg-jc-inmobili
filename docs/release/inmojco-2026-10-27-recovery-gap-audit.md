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


## Verificación offline de integridad SHA-256 (sin conexión)

Una vez que un operador autorizado cree y almacene fuera de Git un respaldo cifrado y el contenido de Storage,
la herramienta del repositorio **solo verifica los bytes listados**. No crea copias ni ejecuta restauraciones.

Comando: `node scripts/recovery/verify-backup-integrity.mjs <manifiesto-privado.json> <directorio-privado-de-respaldo>`

Estructura esperada del directorio de respaldo:

- `postgres.dump.enc` (nombre ilustrativo; **el archivo real no se incluye en Git**).
- `storage/<bucket>/<ruta-interna>` (bytes originales, preservando la jerarquía de Storage).

Ejemplo de **esquema**, con hashes y rutas **ficticios** (no constituye respaldo):

```json
{
  "version": 1,
  "project_ref": "cuitgyqrjibgwuniapmk",
  "created_at_utc": "2026-10-27T17:45:00Z",
  "database": {"file": "postgres.dump.enc", "sha256": "<sha256-real-64-caracteres>"},
  "buckets": [{"id": "jco-inventory-private", "object_count": 1}],
  "objects": [{"bucket": "jco-inventory-private", "path": "org/archivo-ficticio.jpg", "sha256": "<sha256-real-64-caracteres>"}]
}
```

Antes de afirmar cobertura, el operador debe comparar el inventario de buckets y objetos del momento de la copia
con un inventario autorizado de producción. El manifiesto también debe mantenerse privado, por contener rutas reales.
Una coincidencia SHA-256 **no** prueba que el dump sea descifrable, que PostgreSQL arranque, que los esquemas y roles
se reconstruyan, ni que los archivos sean servidos bajo RLS correcto. El ensayo real de restauración aislada es
obligatorio y separado. CI solo usa contenido ficticio y rechaza hashes erróneos, duplicados, enlaces simbólicos,
rutas que escapen del directorio y proyecto de origen incorrecto.

### Completitud local del paquete de archivos

El verificador comprueba ahora que los directorios de buckets enumerados en el manifiesto estén realmente
presentes, que no existan buckets adicionales en la copia local y que **todos los archivos físicos**
bajo `storage/` estén enumerados en el manifiesto. También rechaza enlaces simbólicos y evita
usar un archivo de Storage como supuesto dump de PostgreSQL.

Esto reduce el riesgo de aceptar un paquete local con archivos no inventariados, **pero no
demuestra que la captura desde Supabase incluya todos los objetos remotos** ni garantiza
la restauración. El operador debe comparar los resultados contra un inventario independiente,
tomado en el momento de exportación, y completar una restauración aislada.

## Reconciliación SQL y bloqueos de publicación verificados

El diagnóstico `security/diagnostics/migration_reconciliation_readonly.sql` fue ejecutado
contra el Supabase de producción el 27/oct/2026 dentro de una transacción `READ ONLY`.
En ambos casos el historial no registra la migración, aunque los efectos revisados sí coinciden:

| Versión | Estado de historial | Efecto |
| --- | --- | --- |
| `20261021114500` | Sin registrar | Cuerpo normalizado de `billing_create_order` coincide con GitHub |
| `20261021152000` | Sin registrar | Los 5 índices tienen la definición esperada y `indisvalid/indisready/indislive=true` |

**Limitación del diagnóstico:** para el cuerpo SQL se compara una huella MD5 sobre el
texto ignorando espacios; sirve para detectar discrepancias evidentes, pero la comparación
no equivale a una auditoría semántica o criptográfica ni debe habilitar automáticamente
una reparación. No ejecutar de nuevo DDL ni escribir artificialmente el historial hasta
contar con respaldo/restauración reales y análisis específico de dependencias.

El control local `scripts/release-readiness.mjs` ahora requiere expresamente evidencia
de `database.migration_history_reconciled=true` y de
`security.backup_branch_protected=true` además de los respaldos restaurados y la CI.
En el estado real observado **ambas condiciones siguen siendo falsas**.
Los tests usan solo evidencia ficticia positiva o negativa; ningún paso publica cambios.


## Preparación local de manifiesto privado (sin introducir credenciales en ChatGPT)

Estas herramientas preparan evidencias para respaldos **obtenidos previamente por un operador autorizado**.
No descargan archivos, no crean respaldos reales, no comprueban el cifrado y no restauran producción.
No guardar ningún volcado, manifiesto ni secretos dentro del repositorio Git.

1. Exportar PostgreSQL desde un equipo del propietario mediante la documentación oficial
   de Supabase (comandos CLI de exportación vigentes), y cifrar localmente el resultado
   con una herramienta fiable antes de conservarlo fuera de Supabase y GitHub.
   La extensión .age/.gpg/.enc es solo una comprobación de nombre: **no prueba que
   el contenido realmente esté cifrado**. Verificar cifrado y capacidad de descifrado
   por separado, sin subir contraseñas ni claves a GitHub ni a esta conversación.
2. Descargar de forma autorizada **los bytes reales** de los objetos privados,
   conservando cuatro directorios incluso cuando no contienen archivos.
   La estructura local es: directorio_privado/storage/<bucket>/<ruta-original>.
3. Al momento de la exportación, ejecutar la consulta de solo lectura
   security/diagnostics/recovery_storage_inventory_json_readonly.sql en el proyecto
   cuitgyqrjibgwuniapmk. Guardar ÚNICAMENTE el objeto JSON retornado (sin
   envoltorios del SQL Editor) en source-inventory.local.json, fuera del repositorio.
   La consulta no devuelve rutas ni nombres de los archivos y no modifica datos.
4. Desde la carpeta de código (sin mover datos privados allí) ejecutar:

    node scripts/recovery/create-offline-manifest.mjs "D:\INMOJCO-Privado\Copia" postgres.dump.age "D:\INMOJCO-Privado\Copia\source-inventory.local.json"

5. El comando anterior genera backup-manifest.local.json con rutas relativas y
   SHA-256, siempre dentro del directorio privado. Rechaza conteos distintos,
   buckets incompletos, inventario de más de 24 horas y reescritura de manifiestos.
   Comprobarlo nuevamente desde el código con:

    node scripts/recovery/verify-backup-integrity.mjs "D:\INMOJCO-Privado\Copia\backup-manifest.local.json" "D:\INMOJCO-Privado\Copia"

6. Guardar el manifiesto cifrado junto al respaldo fuera de producción, protegendo
   datos personales incluidos en rutas internas. Verificar la identidad de cada
   archivo remoto y la consistencia del snapshot de manera independiente.
7. Restaurar PostgreSQL **y los objetos Storage** en infraestructura aislada, sin
   usar credenciales de producción durante la restauración. Comparar huellas, permisos,
   funciones, restricciones, datos y flujos multiinmobiliaria; registrar evidencia privada.

**Advertencias:** comparar conteos no garantiza que se hayan descargado los objetos
correctos: faltas y duplicaciones pueden compensarse. El generador no verifica
que PostgreSQL sea restaurable ni que el cifrado funcione; ninguna confirmación
de sus comandos permite declarar un respaldo integral. La protección de ramas Git
y la reconciliación del historial de migraciones siguen siendo puertas independientes
del lanzamiento.

Referencias oficiales: https://supabase.com/docs/guides/platform/backups y
https://supabase.com/docs/guides/storage/management/download-objects
