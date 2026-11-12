# G08 — Despliegue transaccional de 16 FK y relación propietario-inmueble

**Revisión:** 2026-11-12 (Colombia) · Incidencias [#91](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/91) y [#203](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/203).

**Estado operativo: NO-GO para ejecutar SQL en producción.** Este documento no declara una copia reciente ni autoriza cambios. `Supabase` oficial: `cuitgyqrjibgwuniapmk`. No crear ramas facturables ni modificar Wompi real para este proceso.

## Evidencia ya obtenida (no repetir ni asumir más alcance)

1. Copia auténtica, cifrada y revisada de PostgreSQL + 6 archivos Storage del **01-nov-2026** (#214); la copia histórica sigue válida pero **no cubre por sí sola** cambios posteriores.
2. Con fecha 12-nov, preflight real `security/tests/g08_production_read_only_preflight.sql` en transacción de solo lectura: **16 claves externas originales validadas**, 13 referencias activas examinadas, 0 cruces, 2 participaciones inmueble/propietario sin cruce, 0 triggers nuevos.
3. Casos PostgreSQL 17, PostgREST 14 y JWT/Chromium de staging ya aprobados (#356/#357). El staging desechable fue retirado y no debe mantenerse pagando.
4. Dos SQL preexistentes, guardados **fuera** de `supabase/migrations/`:
   - `security/candidates/g08_scoped_16_relationships_REVIEW_ONLY.sql`: dos `UNIQUE` y 16 FK compuestas conservando nombres y acciones `ON DELETE`.
   - `security/candidates/g08_ownership_link_tenant_guard_REVIEW_ONLY.sql`: tres triggers, dos funciones privadas, bloqueo `SHARE ROW EXCLUSIVE` **antes** del control cruzado para impedir escrituras concurrentes entre verificación e instalación.
5. Los tests adicionales de la presente rama ejecutan **ambos SQL juntos bajo una sola transacción aislada** y comprueban rechazo por enlaces foráneos, bloqueo por concurrencia, ausencia de DDL parcial ante fallo en el segundo SQL y `ROLLBACK`.

## Puertas previas obligatorias: no ejecutar SQL mientras falte alguna

- [ ] **Backup actualizado real** de PostgreSQL, Auth y metadatos Storage, producido *después* de la última mutación relevante. Registrar fecha UTC, proveedor, nombre del archivo privado, hash SHA-256, tipo/dump, commit y número de migraciones; sin datos ni secretos en GitHub/ChatGPT.
- [ ] **Bytes de Storage** correspondientes a todos los objetos del corte, recuentos y hashes SHA-256 cotejados con inventario: la prueba sobre metadatos SQL no sustituye los archivos.
- [ ] **Restauración aislada** de esa copia actual, con verificación SQL, RLS/roles, dos inmobiliarias, funciones, índices, referencias y archivos binarios. Prueba de restauración trazable y recuperable por el propietario.
- [ ] Revisión funcional de cuentas independientes, rol Asesor/Coordinador, JWT real, contratos, comisiones, liquidaciones y enlaces PostgREST contra ese esquema.
- [ ] Ventana de cambio de baja actividad y aprobación del responsable; plan de recuperación con duración/RTO real probado, monitoreo y punto de corte. Deshabilitar procesos de escritura concurrentes durante la ventana cuando corresponda.
- [ ] Reconcilación de la lista de migraciones y hashes del SQL exacto aprobado. La última revisión detectó 106 migraciones; reevaluar antes de cualquier ejecución y abortar ante cambios inesperados. **Nunca usar `supabase db push` indiscriminado de la historia archivada (#104)**.
- [ ] Reejecutar `security/tests/g08_production_read_only_preflight.sql` directamente contra producción. Debe decir `SCHEMA_READY_BACKUP_NOT_CERTIFIED` con 16 FK, 0 cruces y 0 triggers previos; el estado literal recuerda que el backup es una puerta **externa** no verificable con SQL.

## Procedimiento de ejecución, reservado para después del GO

1. Hacer una copia del registro de evidencias en un destino privado y un punto de recuperación comprobado; nunca poner archivos `.dump`, `.7z`, contraseñas ni datos reales en el repositorio.
2. Fijar las dos versiones **exactas** del SQL ya revisado y sus SHA-256. No editar/mezclar scripts de último minuto. Verificar usuario PostgreSQL con privilegios autorizados.
3. Ejecutar **ambos SQL en la misma conexión y en una única transacción** con `ON_ERROR_STOP`. El runner aislado utiliza `psql -X --single-transaction -v ON_ERROR_STOP=1 -f <candidato-16> -f <candidato-propietarios>`, pero este ejemplo NO es una autorización de despliegue, ni debe dirigirse al proyecto productivo antes de cumplir todas las puertas.
4. El SQL mantiene `lock_timeout='3s'` y `statement_timeout` corto: si el servidor está ocupado, **abortar el intento completo** y revisar la causa, nunca ampliar bloqueos sin revisión.
5. Ambos scripts deben concluir y confirmar 16 FK validadas, tres triggers activos, dos `UNIQUE` compuestos nuevos en leads/deals; verificar acciones `ON DELETE`, recuentos y errores PostgREST/HTTP/JWT antes de reanudar escrituras.
6. Registrar hora, SHA, postflight real, estado de Railway, incidentes y prueba de navegación. Marcar GO G08 **solo con esa evidencia**.

### Recuperación / reversión

**Antes del COMMIT:** cualquier error de integridad, bloqueo o ejecución de un candidato **hace ROLLBACK de ambos**. Las pruebas aisladas reproducen tanto la reversión voluntaria de una transacción sana como la reversión forzosa de un error después de instalar temporalmente las 16 FK.

**Después del COMMIT:** ya no existe `ROLLBACK` transaccional. No borrar automáticamente los triggers/FK para volver a restricciones débiles. Ante un incidente grave, mantener el servicio seguro, suspender el flujo afectado y usar el plan de recuperación o una reversión de esquema revisada y probada sobre el **respaldo real actualizado**. El retorno de datos puede revertir operaciones recientes: requiere decisión explícita del responsable.

**Alcance de las pruebas CI:** PostgreSQL 17 de GitHub Actions usa **datos sintéticos**. Su éxito no acredita la existencia de una copia restaurable posterior al 01-nov, ni la aprobación jurídica de las políticas, ni Wompi LIVE.
