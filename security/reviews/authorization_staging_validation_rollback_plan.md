# Plan de validación y reversión: permisos de roles y RLS

**Estado:** preparación de staging, no ejecución. **Producción oficial:** `nqzopzhmhqdssgpljypu`; prohibido aplicar estos cambios allí sin aprobación expresa.

## Precondiciones

1. Verificar proyecto y rama de staging independientes; confirmar identidad y permisos del conector antes de cualquier DDL.
2. Confirmar respaldo recuperable y punto de restauración, ventana de pruebas, responsables y procedimiento de parada.
3. Capturar en staging la definición exacta actual de `public.has_org_permission(uuid,text)`, las políticas `member_roles_manage_admin`, sus GRANT/REVOKE y dependencias. Guardar SQL de restauración generado **desde staging**, no reconstruido por memoria.
4. Ejecutar consultas de diagnóstico: roles globales, roles inactivos, asignaciones cruzadas, overrides duplicados, permisos y membresías activas.
5. Validar que las pruebas aisladas y GitHub Actions pasen en el commit exacto que se evaluará. No desplegar un commit con CI fallido.

## Ensayo de staging (requiere aprobación separada)

1. Aplicar en una transacción la función revisada y la política RLS revisada; comprobar sintaxis, propietario, permisos EXECUTE, dependencias y ausencia de recursión.
2. Con dos usuarios de prueba de organizaciones distintas, verificar SELECT/INSERT/UPDATE/DELETE de asignaciones, rol inactivo, rol cruzado y rol válido.
3. Verificar `has_org_permission`: rol correcto, rol ajeno, rol inactivo, miembro inactivo, clave inexistente, ALLOW, DENY y ALLOW+DENY.
4. Probar flujos reales de administración de usuarios y roles, acceso al panel, aislamiento de organización y publicación de inmuebles (cuando exista permiso `properties.publish`).
5. Guardar evidencias de cada escenario y revisar errores en registros sin exponer tokens ni datos personales.

## Condiciones de interrupción y reversión

- **Detener** si hay acceso entre organizaciones, permisos inesperados, pérdida de acceso legítimo, errores de función o regresión RLS.
- Si los cambios aún no se han confirmado, hacer `ROLLBACK` de la transacción.
- Si ya se confirmaron, ejecutar un script de restauración específico preparado con las definiciones **reales capturadas en staging**. Restaurar función y políticas, verificar propietarios y permisos; volver a correr pruebas de aislamiento y flujos críticos.
- Si la restauración no es verificable, suspender despliegues y recuperar desde respaldo según el procedimiento aprobado.

## Puerta de aprobación

No avanzar a producción sin CI aprobado, evidencias de staging, revisión de seguridad, plan de reversión probado y autorización explícita. No activar pagos reales durante este proceso.
