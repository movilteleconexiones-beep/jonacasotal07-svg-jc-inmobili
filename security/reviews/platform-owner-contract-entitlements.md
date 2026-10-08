# Administración central de JCO — contrato y privilegios

## Situación verificada (8 de octubre de 2026)

La base de datos existente contiene `platform_admins(user_id, admin_level, active, created_at)`, `plans`, `plan_features`, `subscriptions`, `organization_licenses`, `license_acceptances` y `organization_settings`. La consulta de solo lectura a `platform_admins` devolvió cero filas. No se ha asignado ninguna identidad ni cambiado producción.

## Autoridad y aislamiento

1. El propietario/desarrollador de JCO debe ser provisionado como superadministrador **fuera del registro público**, verificando primero el ID de su cuenta autenticada. Nunca se concede este privilegio mediante email introducido por el navegador, metadatos editables, o un rol de inmobiliaria.
2. La autoridad de plataforma debe verificarse **en PostgreSQL** contra `platform_admins` con `active=true` en cada operación privilegiada. La interfaz puede ocultar botones, pero no constituye autorización.
3. El administrador de una inmobiliaria solo gestiona su propia organización; no puede conceder planes, cambiar derechos comerciales, elevarse a administrador de plataforma ni editar suscripciones o licencias de otras organizaciones.
4. Toda modificación de contratos, límites, funciones y privilegios de plataforma requiere registro de auditoría (actor, organización, valores anteriores/nuevos, fecha y motivo).

## Contratos y funciones

- `plans` define los paquetes comerciales; `plan_features` sus funciones y límites.
- `subscriptions` determina la vigencia y estado de la contratación por organización.
- `organization_licenses` y `license_acceptances` determinan las condiciones jurídicas aceptadas; no sustituyen la validación del pago.
- `organization_settings` son preferencias operativas y **no deben poder ampliar** lo que autoriza el plan contratado.
- El permiso efectivo requiere simultáneamente: organización activa, suscripción válida o prueba vigente, función incluida en plan/convenio, límite disponible y permiso del usuario en su organización.
- La expiración, suspensión, cambios de plan y excepciones comerciales deben evaluarse en servidor; el frontend no puede habilitar funciones restringidas manipulando estado local.

## Implementación pendiente y pruebas

1. Confirmar el usuario de Auth del propietario y definir el nivel exacto de `platform_admins` según las restricciones reales del esquema.
2. Preparar migraciones SQL revisables, **sin aplicarlas en producción**, para políticas RLS y funciones de administración central; ensayarlas primero en PostgreSQL aislado.
3. Construir el panel del superadministrador: listado de inmobiliarias, contratos, planes, habilitación de módulos, límites, fechas, suspensiones y auditoría.
4. Incorporar verificaciones server-side de derechos comerciales y pruebas de regresión para impedir que un administrador de inmobiliaria cambie su propio contrato o consulte otra empresa.
5. Integrar Wompi sandbox con verificación de firmas y eventos idempotentes antes de habilitar cobros reales.

**Regla de despliegue:** no asignar superadministrador ni ejecutar cambios sobre Supabase de producción sin autorización explícita del propietario.

## Modalidades comerciales aprobadas como requisito funcional

- **Mensual:** licencia de uso temporal, condicionada a la vigencia de la suscripción y al conjunto de funciones contratado.
- **Anual:** licencia de uso temporal durante el período anual contratado, con idénticos controles de funciones y límites.
- **Vitalicia:** licencia de uso de duración indefinida respecto de la versión, módulos y alcance pactados expresamente. No implica por sí misma titularidad del código, cesión de derechos patrimoniales, infraestructura gratuita perpetua, actualizaciones mayores ilimitadas ni servicios de terceros gratuitos.
- El dueño de cada inmobiliaria tiene administración completa de su propio entorno **dentro del alcance contractual**; no es superadministrador de la plataforma.
- Por defecto, todas las modalidades prohíben **reventa, sublicenciamiento, redistribución y cesión del software o código** sin autorización expresa por escrito del titular. La marca blanca o distribución requiere convenio independiente.
- Los campos existentes `organization_licenses.copyright_transferred`, `resale_allowed`, `sublicensing_allowed`, `redistribution_allowed` y `white_label_allowed` deben tratarse como excepciones jurídicas controladas exclusivamente por administración central, nunca como opciones editables por el cliente.
- El sistema debe distinguir **derecho de uso vitalicio** de **suscripción recurrente**, sin convertir automáticamente una licencia vitalicia en una suscripción vencida. Debe existir un criterio contractual explícito para soporte, alojamiento y servicios continuos.
- El texto definitivo de licencia y las políticas de derecho de autor deben ser revisados jurídicamente para los países donde se comercialice JCO.
