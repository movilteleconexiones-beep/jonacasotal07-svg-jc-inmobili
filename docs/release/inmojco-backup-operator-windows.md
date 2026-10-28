# INMOJCO — Copia privada real de Storage y PostgreSQL (operador Windows)

**Protocolo de operador, NO ejecutado contra producción.** Los complementos
conectados en este chat permiten leer metadatos, pero **no** proporcionan
el contexto para descargar de forma privada todas las fotos/documentos y
restaurarlos fuera de Supabase. Ningún token ni contraseña se debe comunicar
en un chat, GitHub Issue, PR, un script compartido o un archivo público.

## Antes de ejecutar

1. Usar un equipo bajo control del propietario y un disco privado con
   cifrado de almacenamiento habilitado, capacidad suficiente y acceso
   restringido. Un directorio de respaldo **nuevo y exclusivo** debe
   permanecer fuera del repositorio Git (p. ej. `D:\INMOJCO-Privado\Copia-001`).
2. Preparar una copia privada de código en la versión exacta de esta herramienta
   y ejecutar `npm ci`. Usar Node compatible con las dependencias del proyecto.
3. Desde Supabase Dashboard de la cuenta administradora autorizada, obtener
   la URL del proyecto `https://cuitgyqrjibgwuniapmk.supabase.co` y una
   clave de acceso de servicio solo en **la máquina local**. Las claves de
   servicio evitan RLS: no usarlas nunca en el navegador o frontend ni
   guardarlas en GitHub. El operador debe eliminar variables de entorno
   cuando termine.
4. Abrir PowerShell, preparar las variables **solo en la sesión local**:
   `$env:INMOJCO_SUPABASE_URL = 'https://cuitgyqrjibgwuniapmk.supabase.co'`
   y asignar `INMOJCO_SERVICE_ROLE_KEY` localmente mediante un gestor seguro
   de secretos (nunca pegarla en esta conversación).

## Descargar realmente los archivos privados de Storage

Desde la carpeta de código, ejecutar:

```powershell
node scripts/recovery/download-private-storage.mjs --download-private-storage "D:\INMOJCO-Privado\Copia-001"
```

La herramienta utiliza exclusivamente `storage.list()` y
`storage.download()` para los cuatro buckets privados
`jco-consignment-photos`, `jco-inventory-private`,
`jco-rent-receipts-private` y `organization-documents`.
Reconstruye las rutas de carpetas, descarga **bytes de los objetos**
y calcula su SHA-256 local. Crea un resumen privado
`storage-download-audit.local.json` y cuatro directorios, incluso
los buckets vacíos. Si ocurre un error, deja
`STORAGE-COPIA-INCOMPLETA.txt` y **no genera evidencia de éxito**.

No se puede reutilizar un directorio de destino existente. No se suben
archivos, no se emiten claves ni nombres de archivos en la salida estándar
y no se modifica ningún objeto remoto. Una copia parcial debe descartarse.

La herramienta depende del contrato `storage.list()` de la versión
`@supabase/supabase-js` instalada en este repositorio. Probar primero
en un bucket aislado con credenciales apropiadas antes de confiar en ella
para recuperación; la CI usa solo archivos y API ficticios.

## Comprobar el inventario remoto de forma independiente

Ejecutar dos veces (antes y después de la descarga) el SQL de solo lectura
`security/diagnostics/recovery_storage_inventory_json_readonly.sql`
y conservar sus dos respuestas JSON privadas. Si cambia el conteo o la
huella `object_keys_sha256`, **NO** declarar completa la copia.
La huella compara rutas, no bytes remotos ni versiones de un objeto.
Evitar escrituras/remociones de Storage durante el proceso o utilizar
una ventana de mantenimiento aprobada.

La salida del downloader contiene el SHA-256 de los bytes descargados.
El generador `create-offline-manifest.mjs` ahora **exige** el informe original
`storage-download-audit.local.json` de esa misma descarga y verifica
rutas, hashes y tamaños contra los archivos locales. Rechaza evidencia
alterada, ausencia del informe y la marca `STORAGE-COPIA-INCOMPLETA.txt`.
También compara rutas y conteos con el inventario SQL independiente, que
debe haberse tomado a menos de una hora del informe de descarga.

Después de guardar una exportación **realmente cifrada y verificablemente
descifrable** de PostgreSQL con el nombre `postgres.dump.age` en el
mismo directorio privado, y guardar el JSON del SQL remoto como
`source-inventory.local.json`, ejecutar:

```powershell
node scripts/recovery/create-offline-manifest.mjs "D:\\INMOJCO-Privado\\Copia-001" postgres.dump.age "D:\\INMOJCO-Privado\\Copia-001\\source-inventory.local.json"
node scripts/recovery/verify-backup-integrity.mjs "D:\\INMOJCO-Privado\\Copia-001\\backup-manifest.local.json" "D:\\INMOJCO-Privado\\Copia-001"
```

El manifiesto resultante incluye también el SHA-256 del informe original
de descarga para detectar cambios posteriores. **Esto sigue siendo
evidencia local, no una firma remota ni una prueba de restauración.**
El generador no descarga PostgreSQL ni cifra archivos por sí mismo.
Si pasan más de 24 horas o cambian los objetos remotos, repetir
la exportación completa en un directorio nuevo.

## Respaldar PostgreSQL por separado

Documentación oficial Supabase sobre exportación lógica:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

En un equipo confiable, con la CLI de Supabase y Docker instalados,
ejecutar los respaldos de **roles, esquema y datos** conforme a la
documentación vigente, usando la cadena de conexión del proyecto
obtenida privadamente en Dashboard → Connect. Los comandos oficiales:

```text
supabase db dump --db-url [CONNECTION_STRING] -f roles.sql --role-only
supabase db dump --db-url [CONNECTION_STRING] -f schema.sql
supabase db dump --db-url [CONNECTION_STRING] -f data.sql --use-copy --data-only
```

Revisar los casos especiales: esquema `auth`, metadatos de `storage`,
historial `supabase_migrations`, objetos administrados y claves de
cifrado. La CLI por defecto excluye varios esquemas administrados,
por lo que **no es una copia física integral de Supabase**.
No escribir la cadena de conexión real en documentación, logs de CI
ni el historial de un terminal compartido.

Empaquetar el conjunto PostgreSQL y metadatos necesarios en un
contenedor privado, **cifrarlo de verdad** antes de guardarlo fuera
de Supabase/GitHub y comprobar que puede descifrarse. La extensión
`.age` o `.enc` por sí sola **no demuestra cifrado**.

## Comprobaciones necesarias para considerar respaldo auténtico

1. Comparar el inventario independiente Storage del inicio/final,
   cantidades por bucket, nombres exactos y huellas de archivos locales.
2. Comprobar que la copia SQL incluye tablas, políticas RLS, funciones,
   triggers, datos, roles necesarios, historial de migraciones y las
   dependencias que se vayan a restaurar.
3. Cifrar **también** las carpetas con bytes privados de Storage. Evitar
   que queden copias sin cifrar después de verificar el procedimiento.
4. Restaurar PostgreSQL y Storage en un entorno **aislado, autorizado y
   seguro**, comparar SHA-256 de los objetos recuperados y probar los
   flujos multiinmobiliaria, accesos y reportes. No conectarse a producción
   para ejecutar comandos de restauración.
5. Guardar evidencia privada de hashes, versiones y resultado de la
   restauración. Solo entonces actualizar los controles de publicación
   GO/NO-GO; sin esta evidencia, se mantiene el bloqueo.

**Seguridad:** descartar datos privados de prueba al concluir la
restauración; no enviar aquí contraseñas, claves, URLs con contraseña,
volcados reales ni documentos de clientes.
