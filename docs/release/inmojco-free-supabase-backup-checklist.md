# INMOJCO — respaldo gratuito y ensayo de recuperación (Windows)

**Estado: procedimiento preparado, NO ejecutado sobre el equipo del usuario.**
Este documento NO certifica existencia ni recuperación de un backup. No aplicar
migraciones de facturación reales hasta comprobar una restauración independiente.

Fuentes oficiales:
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/reference/cli/supabase-db-dump

## 1. Riesgos y alcance

- El plan Free no incluye el mismo sistema de copias automáticas que Pro.
- Un `supabase db dump` sin opciones exporta ESQUEMA (no todos los datos).
- La exportación de datos estándar de CLI excluye contenido de algunas tablas
  administradas por Supabase (`auth`, `storage`) y **no** incluye los archivos
  de Storage (fotografías, contratos firmados ni comprobantes).
- Tampoco respalda automáticamente secretos de Edge Functions, ajustes de Auth,
  certificados o DNS. Requieren inventario y recuperación independiente.
- Estas copias contendrán información personal y financiera. Nunca subir a
  GitHub, chats, servicios públicos o carpetas sincronizadas sin cifrado.
- Una exportación exitosa NO prueba que pueda restaurarse. La restauración debe
  ejecutarse contra **un destino vacío y aislado**, nunca el proyecto de producción.

## 2. Preparación en computador autorizado

1. Instalar Supabase CLI y Docker Desktop según documentación oficial.
2. Crear una carpeta local cifrada/restringida fuera del repositorio Git.
3. Acceder de forma local a la CLI: `supabase login`.
4. Abrir el repositorio local de INMOJCO y vincular el proyecto:
   `supabase link --project-ref cuitgyqrjibgwuniapmk`.
   Cuando la CLI solicite autenticación/contraseña, escribirla SOLO en esa consola
   local. Nunca enviarla al chat o incluirla dentro de un archivo de Git.
5. Revisar que `supabase db dump --help` incluya los parámetros
   `--linked`, `--role-only`, `--data-only` y `--use-copy`.

## Opción simplificada: script de respaldo preparado

Antes de usarlo, confirma que la copia será guardada en un disco **cifrado y privado**, fuera del repositorio Git y fuera de carpetas sincronizadas (OneDrive, Dropbox o Descargas).

Desde PowerShell abierto dentro del repositorio, después de instalar Supabase CLI, Docker y ejecutar `supabase link --project-ref cuitgyqrjibgwuniapmk`, se podrá lanzar:

```powershell
.\scripts\backup-inmojco-free.ps1 -Destination 'D:\RespaldosCifrados\INMOJCO' -ConfirmEncryptedDestination
```

El script rechazará un proyecto Supabase distinto del esperado, comprobará la presencia de Docker y generará una carpeta privada con `roles.sql`, `schema.sql`, `data.sql` y `SHA256SUMS.txt`. No borra, restaura ni migra datos; no guarda contraseñas en la línea de comandos. Si una etapa falla, la copia se marca como incompleta. **Debe restaurarse en un destino aislado y complementarse con los archivos Storage y la configuración de Auth antes de considerarse un respaldo completo.**

## 3. Tres copias lógicas mínimas (PowerShell local)

Desde el repositorio, con la vinculación autorizada y Docker funcionando,
escribir los siguientes comandos **en PowerShell del equipo**, cambiando solo
`D:\\RespaldosCifrados\\INMOJCO` por una carpeta cifrada bajo control del dueño:

```powershell
$ErrorActionPreference = "Stop"
$dest = "D:\RespaldosCifrados\INMOJCO"
New-Item -ItemType Directory -Path $dest -Force | Out-Null
supabase db dump --linked --role-only --file "$dest\roles.sql"
if ($LASTEXITCODE -ne 0) { throw "Fallo la copia de roles" }
supabase db dump --linked --file "$dest\schema.sql"
if ($LASTEXITCODE -ne 0) { throw "Fallo la copia de esquema" }
supabase db dump --linked --data-only --use-copy --exclude "storage.buckets_vectors" --exclude "storage.vector_indexes" --file "$dest\data.sql"
if ($LASTEXITCODE -ne 0) { throw "Fallo la copia de datos" }
Get-Item "$dest\roles.sql","$dest\schema.sql","$dest\data.sql" |
    Select-Object Name,Length,LastWriteTime
Get-FileHash "$dest\roles.sql","$dest\schema.sql","$dest\data.sql" -Algorithm SHA256 |
    Select-Object Path,Hash
```

Escribir las huellas de los archivos en una bitácora privada de recuperación.
No entregar los datos exportados ni sus huellas completas a chats públicos.

## 4. Restauración aislada obligatoria

1. Preparar un PostgreSQL compatible o un proyecto Supabase de prueba independiente;
   no usar jamás `cuitgyqrjibgwuniapmk` como destino de restauración.
2. Seguir el orden de la guía oficial: roles → esquema → datos, con
   `psql --single-transaction --set ON_ERROR_STOP=1` cuando proceda.
3. Registrar y solucionar errores de permisos y extensiones. Examinar
   las diferencias de objetos administrados por `auth`/`storage`.
4. Comprobar al menos los recuentos y restricciones de:
   `organizations`, `payment_orders`, `payment_events`, `subscriptions`,
   `organization_licenses`, `organization_billing_access` y `audit_log`.
   Revisar también RLS, permisos y funciones `SECURITY DEFINER` con roles
   ficticios de diferentes inmobiliarias.
5. Comprobar recuperación de **archivos reales** desde una copia de Storage
   separada y segura; SQL restaura metadatos, no el contenido de objetos.
6. Ensayar `20261017090000_verified_trial_to_paid_reconciliation.sql`
   y `security/rollback/wompi_trial_to_paid_20261017.sql` en el destino aislado.
7. Documentar fecha, alcance, errores, resultado de recuperación y localización
   privada de las copias. Un único error de restauración sin resolver bloquea
   la publicación.

## 5. Condición para publicar

Hasta que el backup sea **recuperable en la práctica** y las pruebas de
seguridad pasen, mantener PR #186 en borrador, `production_enabled=false`,
y conservar el pago aprobado como `REVIEW_REQUIRED`. No realizar otro pago:
la futura conciliación consumirá la orden Sandbox ya aprobada.

Nota: este respaldo lógico es el mínimo inicial y NO es una imagen integral de
la plataforma. El plan de continuidad final debe incluir Auth, Storage,
Edge Functions, secretos, DNS y procedimientos de mantenimiento.
