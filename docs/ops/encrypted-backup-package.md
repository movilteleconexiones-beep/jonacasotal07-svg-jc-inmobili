# Cifrado del respaldo completo (sin contratar servicios)

**No contiene credenciales ni crea un respaldo por sí solo.**

Después de ejecutar `export_private_backup.sh` y comprobar `EXPORT_COMPLETE.json`, utilice `encrypt_completed_export.sh` con `BACKUP_AGE_RECIPIENT` (clave pública `age1...`) y `BACKUP_ENCRYPTED_OUTPUT` (ruta de archivo privado fuera del repositorio). La **clave privada** debe conservarse fuera de GitHub y de Railway, en un almacén seguro. No copiar archivos exportados en GitHub Actions ni publicarlos como artifacts.

El script deja la copia temporal sin cifrar intacta: debe gestionarse su eliminación segura según la política de retención una vez verificada una restauración aislada. La existencia de un archivo `.age` y su SHA-256 no prueban que pueda restaurarse; verificar descifrado y recuperación real antes de permitir cambios de esquema. Usar únicamente en equipo o ejecutor bajo control, en almacenamiento privado.
