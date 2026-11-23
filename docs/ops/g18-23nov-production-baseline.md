# G18 — punto de control de respaldo de INMOJCO, 23-nov-2026

> **NO-GO:** este documento es un inventario de SOLO LECTURA, no el respaldo de PostgreSQL ni los archivos de Storage. No certifica recuperación. No modifica producción ni habilita G07/Wompi.

- Proyecto Supabase: `cuitgyqrjibgwuniapmk` (PG 17.11, Pro).
- Inventario SQL: **2026-11-23T18:05:25Z**; respuesta de herramienta conectada read-only.
- 99 tablas base en `public`, `private`, `jco_private`, `auth`, `storage`.
- 2 organizaciones; 2 usuarios Auth; 2 inmuebles; 2 documentos; 2 suscripciones; 8 órdenes de pago históricas; 1 evento de pago; 2 licencias.
- 4 buckets privados; **6 objetos**, total declarado por metadatos **932.740 bytes**.
- Buckets (sin exponer nombres/rutas de objetos): `jco-consignment-photos` 0, `jco-inventory-private` 4 (740.557 bytes), `jco-rent-receipts-private` 0, `organization-documents` 2 (192.183 bytes).
- Wompi LIVE: `production_enabled = false`.

La cifra de archivos/bytes es una **línea base puntual**. Debe reconfirmarse justo antes de la descarga; cualquier cambio exige inventario nuevo. Los cuatro buckets deben figurar en el manifiesto del backup, incluso los dos vacíos.

## Requisitos para completar respaldo auténtico

1. Ejecutar desde un **ejecutor privado con red** y PostgreSQL **17** (`pg_dump` y `pg_restore`), `age`, Python 3 y acceso a gestor de secretos. `DATABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan en el entorno: nunca los revelar en GitHub, consola compartida ni chat.
2. Verificar URL exacta `https://cuitgyqrjibgwuniapmk.supabase.co` y `EXPECTED_SUPABASE_PROJECT_REF=cuitgyqrjibgwuniapmk`. No emplear usuario anónimo ni credenciales de otra inmobiliaria.
3. Crear un directorio POSIX 0700, absoluto y vacío en un volumen confiable con capacidad suficiente. Ejecutar `scripts/backup/export_private_backup.sh`. Obtendrá `.dump` de esquema+datos y bytes Storage para TODOS los buckets, no solo tabla `storage.objects`. La marca `EXPORT_COMPLETE.json` solo se genera si ambos exportadores y sus hashes pasan.
4. Ejecutar `scripts/backup/verify_private_export.py` con contadores **reconfirmados** del mismo día; actualmente `--expected-objects 6 --expected-bytes 932740 --expected-buckets 4`. Este verificador no restaura y seguirá mostrando `restore_verified=false`.
5. Cifrar únicamente con clave **pública** `age1...` fuera de GitHub mediante `scripts/backup/encrypt_completed_export.sh`. Confirmar checksum externo de `.age` y guardar identidad privada de descifrado en bóveda separada. No añadir `.dump`, `.age`, `.7z`, manifest privado ni logs con datos a GitHub Actions/artifacts.
6. **Descifrar en un entorno aislado** (PG17 compatible con Supabase) y ejecutar `pg_restore --exit-on-error` hacia una base desechable nunca enlazada a producción; verificar restauración de tablas, filas, integridad FK, permisos RLS, Auth y eventos. Replicar los seis archivos al Storage de un clon aislado y comparar los SHA contra los archivos de la exportación y el inventario; para el clon `zjgstfgiirgjssnihaam` existe `scripts/ops/verify-restored-storage-binaries.mjs`, pero **solo** después de que los archivos sean efectivamente restaurados y con URL/credenciales del clon.
7. Registrar los hashes del paquete cifrado, fecha, versión, objeto de almacenamiento externo, ejecución de recuperación aislada, pruebas y usuario responsable en la incidencia #214 y relacionar #203. **Sin el paso 6 comprobado, el estado sigue NO-GO**.

### Comandos de referencia (terminal privada, nunca GitHub Actions público)

```bash
# Usar valores obtenidos del gestor de secretos del ejecutor. NO pegar
# valores sensibles en el chat ni versionar archivos .env con ellos.
export SUPABASE_URL='https://cuitgyqrjibgwuniapmk.supabase.co'
export EXPECTED_SUPABASE_PROJECT_REF='cuitgyqrjibgwuniapmk'
# DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_AGE_RECIPIENT -> bóveda local.
export BACKUP_OUTPUT_DIR="/secure/inmojco/backup-20261123-$(date -u +%H%M%S)"
bash scripts/backup/export_private_backup.sh
python3 scripts/backup/verify_private_export.py \
  --directory "$BACKUP_OUTPUT_DIR" --expected-objects 6 \
  --expected-bytes 932740 --expected-buckets 4
export BACKUP_ENCRYPTED_OUTPUT="/secure/inmojco/encrypted/inmojco-20261123.age"
bash scripts/backup/encrypt_completed_export.sh
sha256sum -c "$BACKUP_ENCRYPTED_OUTPUT.sha256"
# NO CONFUNDIR sha256sum -c con una restauración completa.
```

La URL de conexión de PostgreSQL puede tener contraseña y aparece en argumentos de procesos si se entrega de forma insegura; preferir `PGSERVICE` + archivo de contraseñas con permisos `0600` cuando el entorno lo permita. Revisar controles de logs/red y eliminar el directorio temporal sin cifrar mediante un procedimiento seguro **después** de verificar una recuperación aislada.