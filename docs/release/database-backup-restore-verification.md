# INMOJCO — respaldo, restauración y publicación segura

**Estado: procedimiento definido; copia/restauración de la base de producción todavía NO realizadas ni comprobadas.** La CI de PostgreSQL aislado no sustituye una restauración del proyecto real cuitgyqrjibgwuniapmk.

Prohibido subir respaldos, contraseñas, claves service_role, JWT, datos de clientes o ficheros .env a GitHub, ChatGPT, comentarios de PR o logs.

## 1. Trabajo posible sin compras nuevas

- Mantener PR #185 como borrador y no fusionarlo con main antes del ensayo de recuperación.
- Mantener INMOJCO en Railway sin publicar código que requiera migraciones pendientes.
- Ejecutar pruebas de CI y el preflight SQL de solo lectura security/preflight/agency_release_read_only.sql.
- Usar node --test tests/release-readiness-gates.test.mjs para comprobar que la puerta de publicación se bloquea si falta evidencia.
- No crear recursos de pago ni activar Wompi real.

## 2. Respaldo privado de PostgreSQL cuando exista staging

Requiere cliente PostgreSQL 17, conexión administrativa segura (TLS), destino cifrado privado fuera del repositorio y capacidad de restaurar una copia en una base DESCARTABLE. El plan Pro se contratará en la fase final, tras confirmar su precio y la ventana de ensayo.

Conectar PostgreSQL sin contraseñas visibles en comandos:

1. Configurar un servicio local inmojco_production en ~/.pg_service.conf con host, puerto, base de datos, usuario y TLS verify-full con CA válida.
2. Almacenar credenciales en ~/.pgpass o PGPASSFILE con permisos privados; no incrustar contraseñas en la URL o argumentos.
3. Preparar almacenamiento privado cifrado fuera de GitHub.

Ejemplo Linux/macOS; en Windows 10 se puede ejecutar pg_dump.exe y pg_restore.exe de PostgreSQL 17, y calcular la huella mediante PowerShell Get-FileHash -Algorithm SHA256.

~~~bash
umask 077
mkdir -p "$HOME/inmojco-private-backups"
pg_dump --dbname="service=inmojco_production" \
  --format=custom --no-owner --no-acl \
  --file="$HOME/inmojco-private-backups/inmojco-pre-pr185.backup"
sha256sum "$HOME/inmojco-private-backups/inmojco-pre-pr185.backup"
pg_restore --list "$HOME/inmojco-private-backups/inmojco-pre-pr185.backup" > /dev/null
~~~

Un archivo que abre correctamente NO es prueba de restauración: el respaldo debe restaurarse y comprobarse en una instancia separada. Revisar cuidadosamente compatibilidad de roles, extensiones y esquemas de Auth gestionados por Supabase. Los errores de restauración no deben ignorarse.

### Archivos Supabase Storage

pg_dump preserva referencias y metadatos de storage.objects, pero **NO copia los bytes reales de las imágenes y documentos**. Preparar una exportación aparte y cifrada de buckets (contratos, soportes, inventario privado, logos) mediante API administrativa y verificar SHA-256 de archivos restaurados. La configuración externa — SMTP, dominios, Edge Functions, secretos, variables de Railway y DNS — también necesita inventario independiente, sin publicar secretos.

## 3. Ensayo de recuperación en destino aislado

**Jamás usar pg_restore --clean sobre la instancia de producción.**

1. Crear un proyecto de staging/clon expresamente descartable. Comprobar dos veces destino e identificador: no debe ser cuitgyqrjibgwuniapmk.
2. Deshabilitar o sustituir emails externos, webhooks, cobros, tareas programadas y conexiones de producción en el clon.
3. Restaurar el respaldo en destino vacío con pg_restore --exit-on-error --no-owner --no-acl. Investigar incompatibilidades de Auth, extensiones y esquemas administrados.
4. Restaurar también objetos privados de Storage; comparar sus checksums con la exportación privada.
5. Comparar conteos y restricciones de las tablas clave sin difundir PII, y repetir RLS con dos inmobiliarias y cinco perfiles: administrador, asesor, CLIENT, propietario e inquilino; comprobar la cuenta SuperAdmin.
6. Registrar fuera del repositorio hash, fecha UTC, responsable y resultado del ensayo.
7. Documentar despliegue y reversión de Railway. Revertir frontend NO revierte tablas ni políticas SQL: las migraciones requieren procedimiento específico de recuperación ensayado. Nunca desactivar RLS ni conceder permisos amplios a anon como reparación rápida.

## 4. Puerta de seguridad (GO / NO-GO)

El siguiente comando **solo evalúa una lista de condiciones**, no ejecuta migraciones, restauraciones ni deploys:

~~~bash
node scripts/release-readiness.mjs release-evidence.local.json pr185
~~~

Si no existe evidencia válida y reciente, devuelve NO APTO. El archivo local se ignora en .gitignore y debe permanecer privado. No colocar en él emails, cuentas, direcciones, JWT ni claves.

Campos a verificar en el archivo de evidencia local:

- project_ref: ID exacto Supabase producción.
- commit_sha, ci.commit_sha y ci.passed: mismo commit GitHub y CI aprobada.
- database.migrations_reviewed, database.backup_sha256 (hexadecimal SHA-256), database.backup_created_at (máximo 24 horas), database.backup_restored_isolated, database.restore_verified_at (máximo 7 días y posterior al respaldo).
- security.agency_a_b_isolation, security.client_and_staff_permissions, security.platform_admin_exclusive, security.external_owner_tenant.
- deployment.rollback_reviewed, deployment.window_confirmed y deployment.wompi_mode = sandbox.

La revisión humana debe inspeccionar los artefactos y confirmar que estas declaraciones son auténticas; esta herramienta no puede certificar una copia sin intentar recuperarla.

Para el lanzamiento comercial existe el perfil commercial, con pruebas adicionales de contabilidad, SMTP, conciliación e idempotencia Wompi, licenciamiento exclusivo y autorización expresa para pagos reales. Esto no significa que el modo real esté autorizado ahora.

**Recordatorio:** opción A aprobada; no contratar Supabase Pro anticipadamente. Solicitarlo solo al llegar al ensayo y lanzamiento comercial final, y confirmar el precio vigente antes de contratar.
