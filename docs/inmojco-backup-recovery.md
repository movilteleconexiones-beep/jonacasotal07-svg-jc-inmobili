# INMOJCO — Respaldo cifrado de PostgreSQL + Storage (operación privada)

**Estado:** herramienta de exportación local disponible, NO es un respaldo real hasta ejecutarla y verificarla. No realiza restores ni cambia producción. El único proyecto autorizado es `cuitgyqrjibgwuniapmk`.

## Qué protege y qué NO

La herramienta `scripts/inmojco-backup.mjs` crea una carpeta privada con:

- `database.enc`: exportación **lógica** PostgreSQL `pg_dump --format=custom` (esquemas, tablas y datos accesibles con la cuenta usada, incluidos metadatos de Storage).
- `objects/000001.enc` ...: **bytes de los archivos** de TODOS los buckets Storage enumerados con la llave del proyecto; incluye privados. Jamás coloca nombres de propietarios/documentos en los nombres de archivo cifrado.
- `manifest.enc`: índice cifrado de nombres de bucket, rutas originales, tamaño y SHA-256 de cada archivo. El fichero no cifrado `backup-meta.json` contiene únicamente versión, proyecto, fecha, salt e información de autenticación criptográfica.
- Cifrado **AES-256-GCM** con nonce aleatorio por archivo y clave derivada usando **scrypt** + salt aleatoria. Cada archivo se autentica al verificarse; una modificación o contraseña incorrecta falla.

La herramienta ejecuta `verify` y valida el catálogo de PostgreSQL mediante `pg_restore --list` antes de anunciar éxito. No copia **secretos de Railway, contraseñas de roles de base de datos, configuración del dashboard Supabase, variables de funciones Edge, reglas de DNS ni configuración externa de Wompi**. No sustituye los backups oficiales de Supabase, ni garantiza una instantánea perfectamente sincronizada entre PostgreSQL y Storage cuando hay operaciones simultáneas.

**No se puede afirmar todavía que existe un respaldo integral recuperable o un ensayo real de restauración.** Hace falta completar una exportación y un restore en un proyecto **aislado**, con autorización para ese entorno; nunca ensayar restaurando encima de producción.

## Preparación (PC o servidor controlado por el propietario)

- Node.js reciente (mínimo Node 20) y `npm ci` en un clon privado local del código.
- PostgreSQL **17** `pg_dump` instalado y disponible en PATH.
- Carpeta privada y **fuera del repositorio** (por ejemplo `D:\\INMOJCO-Respaldos`), con acceso restringido y suficiente espacio.
- Conexión de **solo lectura** a la base si es posible: `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` y `PGSSLMODE=require`. Confirmar que el host o usuario contienen el identificador del proyecto activo; la herramienta rechaza el proyecto antiguo.
- `SUPABASE_URL=https://cuitgyqrjibgwuniapmk.supabase.co` y **`SUPABASE_SERVICE_ROLE_KEY`**, únicamente en el equipo privado que crea la copia, para leer Storage. La llave nunca va en archivos versionados, un chat, logs ni variables `VITE_*`.
- `INMOJCO_BACKUP_PASSPHRASE` de **16 caracteres o más**, guardada en un gestor de contraseñas independiente del equipo de respaldo. Sin ella no se puede recuperar el contenido.

**No copies las claves en este chat ni en GitHub Actions.** No almacenes los archivos ni los secretos en `public/`, `src/`, `dist/`, `scripts/`, un repositorio Git o un artifact público de CI.

### Ejemplo PowerShell (los secretos se introducen localmente)

```powershell
$env:PGHOST = 'db.cuitgyqrjibgwuniapmk.supabase.co'
$env:PGDATABASE = 'postgres'
$env:PGUSER = 'postgres'
$env:PGSSLMODE = 'require'
$env:SUPABASE_URL = 'https://cuitgyqrjibgwuniapmk.supabase.co'
$env:INMOJCO_BACKUP_DIR = 'D:\INMOJCO-Respaldos'
# Cree antes la carpeta de destino y limite sus permisos de Windows.
# Introduzca los secretos por métodos seguros en la consola local; no los
# escriba literalmente en scripts, capturas, historial ni Git.
$env:PGPASSWORD = [pscredential]::new('u',(Read-Host 'PG password' -AsSecureString)).GetNetworkCredential().Password
$env:SUPABASE_SERVICE_ROLE_KEY = [pscredential]::new('u',(Read-Host 'Storage service role key' -AsSecureString)).GetNetworkCredential().Password
$env:INMOJCO_BACKUP_PASSPHRASE = [pscredential]::new('u',(Read-Host 'Encryption passphrase' -AsSecureString)).GetNetworkCredential().Password
node scripts/inmojco-backup.mjs backup
```

Si la conexión de Supabase requiere un pooler, sus campos PGHOST/PGUSER son diferentes. Verifique la cadena **Session pooler o Direct** en Supabase > Connect; no use el pooler de transacciones para `pg_dump`.

La herramienta crea una carpeta con fecha, y solo muestra **totales**, no nombres de documentos. Si alguna descarga o `pg_dump` falla, aborta y elimina la carpeta incompleta; no informa éxito.

## Verificar una copia ya creada

Desde el mismo equipo, con la frase de cifrado cargada en `INMOJCO_BACKUP_PASSPHRASE`:

```powershell
$env:INMOJCO_BACKUP_ARCHIVE = 'D:\INMOJCO-Respaldos\inmojco-FECHA-IDENTIFICADOR'
node scripts/inmojco-backup.mjs verify
```

Se comprueban todas las etiquetas de autenticación AES-GCM, las longitudes y los SHA-256 de la base y de **cada objeto**. Un error en cualquiera de ellos impide marcar la copia como válida.

## Inspección del archivo PostgreSQL sin recuperar datos en producción

Además de la validación criptográfica, desde la versión actual el comando `backup`
exige que `pg_restore --list` reconozca el archivo PostgreSQL y sus entradas de
tablas. Si el volcado resulta ilegible, se considera un **respaldo fallido**,
aunque AES-GCM y SHA-256 sean correctos. La comprobación no se conecta
a ninguna base de datos y **no crea archivos SQL descifrados en disco**.

Para volver a comprobar una copia histórica en su equipo:

```powershell
$env:INMOJCO_BACKUP_ARCHIVE = 'D:\INMOJCO-Respaldos\inmojco-FECHA-IDENTIFICADOR'
node scripts/inmojco-backup.mjs inspect
```

El comando muestra solo **cantidades de entradas y tablas**; nunca imprime
nombres de propietarios, contratos, tablas ni metadatos privados. Requiere
`pg_restore` de PostgreSQL 17 en el PATH. El chequeo del catálogo mejora la
confianza en el formato de la copia, **pero no prueba que restaurar y arrancar
toda la aplicación en una instancia nueva funcione**. Esa prueba real en un
ambiente aislado sigue siendo obligatoria antes de certificar recuperación.

## Ensayo de restauración automatizado con datos ficticios

Las pruebas de GitHub Actions incluyen un ensayo real con dos bases temporales
PostgreSQL 17 independientes. Crean dos inmobiliarias **ficticias**, sus
documentos **ficticios**, una clave foránea, un índice y una política RLS;
generan `pg_dump --format=custom`, cifran la copia con una clave solo de CI,
la descifran y ejecutan `pg_restore --exit-on-error --single-transaction`
**únicamente en otra base temporal vacía**, nunca en Supabase ni Railway.

El ensayo verifica los registros recuperados, sus importes, la clave foránea,
el índice y la política RLS, además de confirmar que la base de origen quedó
sin modificaciones. La prueba de integridad rechaza un archivo cifrado
alterado antes de intentar ninguna recuperación.

Esta prueba certifica **el flujo con datos de laboratorio**, no el respaldo
real del proyecto: restaurar una exportación auténtica requiere revisar
dependencias, extensiones, cuentas de servicio, permisos, Auth, Storage y
configuración del entorno receptor. No se habilita un comando de restauración
automática de bases de producción.

## Preparar material para restauración (NUNCA sobre producción)

```powershell
$env:INMOJCO_EXTRACT_DIR = 'D:\INMOJCO-Recuperacion-Aislada'
node scripts/inmojco-backup.mjs extract
```

El directorio debe ser **nuevo**. Produce `database.dump`, ficheros numerados en `objects/` y `restore-map.json` con las rutas de Storage. **Todo queda descifrado**: restringe el acceso, evita sincronizadores públicos y destruye la extracción temporal cuando concluya la validación. Un error durante la extracción elimina los archivos parciales.

Inspeccione el backup con `pg_restore --list database.dump`. Solo un administrador de base de datos debe planear el `pg_restore` sobre un **proyecto nuevo y aislado**, considerando roles/propietarios administrados por Supabase, extensiones, políticas RLS y conexiones; luego cargue los objetos Storage por la API autenticada con la correspondencia de `restore-map.json`. Valide conteos, documentos PDF e imágenes por hash y pruebas de aplicación. Esta herramienta **no ejecuta el restore**, deliberadamente.

## Automatización de 12 horas y alcance real

La tarea existente **«Respaldo INMOJCO por inactividad»** consulta GitHub, Railway y Supabase cada hora, y crea una rama `backup/` con el SHA de `main` cuando detecta >=12 horas sin actividad. **Solo resguarda el código/versionado**: no crea `database.dump` ni almacena los bytes de Storage.

Para automatizar también este exportador hace falta un **destino privado de almacenamiento**, un **ejecutor controlado** y secretos de la base/Storage/clave de cifrado cargados de forma segura fuera del repositorio. Ni un branch Git ni el estado `SUCCESS` de Railway cumplen ese requisito. No provisionar infraestructura nueva ni iniciar costos sin autorización expresa.

El respaldo recomendado combina: GitHub + archivo cifrado de PostgreSQL + objetos Storage + inventario privado de configuraciones operativas (Supabase Auth/Edge/keys, Railway, Wompi, DNS, que deben exportarse por canales seguros) + prueba periódica de restauración en aislamiento.

Referencias oficiales: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups), [Supabase Download Objects](https://supabase.com/docs/guides/storage/management/download-objects), [Supabase Backup and Restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
