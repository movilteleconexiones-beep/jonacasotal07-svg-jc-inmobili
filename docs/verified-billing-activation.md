# Activación comercial de INMOJCO

El código se mantiene en `movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili`, con publicación desde `main`. El dominio oficial es `https://www.inmojco.com/`.

## Comportamiento

- Las inmobiliarias existentes conservan su acceso; las nuevas nacen en `TRIAL` con licencia SaaS pendiente. `TRIAL` indica registro pendiente y no concede operación comercial.
- La membresía, el rol operativo, la suscripción y la licencia son controles distintos. El comprador nunca recibe privilegios de plataforma.
- La modalidad elegida por el titular es `VERIFIED_PAYMENT`: los pagos aprobados activan el plan sin una aprobación individual del superadministrador. La modalidad `MANUAL` exige revisión.
- El servidor valida firma de Wompi y consulta la transacción en el API del ambiente correspondiente. Compara identidad, referencia, monto, moneda y estado. El regreso del navegador desde Wompi no es evidencia de pago.
- Pago, suscripción, licencia, permisos contratados y auditoría se guardan en la misma transacción. Las renovaciones del mismo plan conservan el inicio de la vigencia actual y agregan el período pagado. Cambiar un plan vigente requiere revisión; no se inventa prorrateo.
- Una suspensión administrativa no se revierte por pagar. Pagos tardíos y contratos especiales quedan en `REVIEW_REQUIRED`, conservando el pago recibido sin conceder acceso.
- Las solicitudes de checkout y los eventos repetidos no duplican activaciones. El identificador de evento deriva del estado de transacción; `payload_sha256` conserva el hash del cuerpo recibido, separado de ese identificador.
- Solo los permisos incluidos en el plan y en el rol del usuario quedan efectivos. Los límites de usuarios e inmuebles se comprueban bajo bloqueo del tenant.
- Sandbox requiere una inmobiliaria de prueba expresamente marcada por el superadministrador. No activa inmobiliarias comerciales. La inmobiliaria principal existente no puede marcarse como prueba.
- El superadministrador puede autorizar una prueba completa de propietario por 1–30 días con un plan Profesional o Empresarial mensual. La RPC comprueba correo confirmado, rol Propietario activo, cuenta separada del administrador central y ausencia de un contrato pagado o suspendido. Registra la prueba, su vencimiento y el motivo; no registra un pago ni habilita el comercio Wompi.
- El menú de propietarios conserva los 15 módulos y el orden de la referencia: Inicio, Propiedades, Clientes, Leads / CRM, Agenda, Negocios, Propietarios, Documentos, Comisiones, Reportes, Mi Portal, Usuarios, Importar datos, Configuración y Licencia. Consignaciones está dentro de Propiedades y Plan y activación dentro de Licencia. El acceso central SuperAdmin aparece en la cabecera solo para administradores de plataforma activos.
- El panel central incluye todas las inmobiliarias, filtros por estado, contrato, mes de registro y prueba/comercial, vigencia, miembros e inmuebles. Los rangos de 6, 12 o 24 meses cuentan altas según `America/Bogota`, incluyen meses sin registros y muestran el estado actual de cada cohorte; no presentan esos estados como una reconstrucción histórica.
- Los archivos usan una ruta cuyo primer segmento es el ID de la inmobiliaria. Los permisos de Storage usan el nombre del objeto; se retiran las reglas antiguas de escritura global de imágenes.
- Licencias perpetuas, dedicadas y acuerdos personalizados mantienen un proceso contractual separado. No se habilita checkout automático de esos contratos.

## Despliegue

Migraciones: `20261010222342_verified_tenant_billing.sql` y `20261010222700_commercial_plan_permissions.sql`. Sustituyen el recorrido de pagos preliminar; no ejecutar además los borradores `0026`–`0032` sobre este esquema. La función Edge `billing` es el recorrido operativo; el runtime Node y sus documentos anteriores corresponden al prototipo y no son la configuración de producción de esta entrega.

La base encontrada en la compilación del dominio oficial es `cuitgyqrjibgwuniapmk` (Sistema Inmobiliario JCO). Contiene las cuentas existentes del titular y del propietario de prueba. El servicio conectado usaba anteriormente `nqzopzhmhqdssgpljypu`; se conservan sus datos y se alinea el frontend publicado con la base oficial, sin copiar ni recrear usuarios.

En instalaciones antiguas, aplicar primero `20261010231042_compatible_licensing_records.sql`, antes de `verified_tenant_billing`. Conserva fecha, usuario, versión y licencia de cada aceptación, completa el snapshot desde la versión aceptada y adapta el bootstrap para conservar una sola licencia pendiente y evitar una suscripción gratuita. Después instalar, en este orden, `20261010212630_property_consignment_intake.sql`, `20261010214633_fix_property_portal_rls_recursion.sql`, `20261010222342_verified_tenant_billing.sql`, `20261010222700_commercial_plan_permissions.sql` y `20261010231048_owner_trials_and_platform_overview.sql`. Esta última aporta la autorización de pruebas, el resumen mensual privado y la restricción comercial de tablas de arrendamientos antiguas. En la instalación que ya tiene consignaciones y billing, solo hacen falta las dos migraciones nuevas de compatibilidad y pruebas/resumen. No sustituir la migración antigua de arrendamientos `0026_rental_management_core` del proyecto oficial por los borradores de pagos numerados del repositorio.

La función se despliega con `verify_jwt=false` porque Wompi no envía JWT Supabase. Su endpoint `/checkout` verifica el usuario con `auth.getUser` y usa un cliente bajo ese JWT; `/events` verifica la firma del comercio y reconcilia el API antes de ejecutar la RPC privilegiada.

Secretos de la función Edge, exclusivamente en el servidor:

| Variable | Uso |
| --- | --- |
| `WOMPI_ENV` | `sandbox` durante pruebas; producción requiere una habilitación separada |
| `WOMPI_PUBLIC_KEY` | Llave `pub_test_…` o `pub_prod_…` del ambiente elegido |
| `WOMPI_INTEGRITY_SECRET` | Firma del checkout |
| `WOMPI_EVENTS_SECRET` | Autenticación de notificaciones |
| `APP_URL` | URL canónica de regreso al dominio oficial |

Supabase aporta las variables de su proyecto y del rol de servicio a la función. No se copian esas claves al frontend ni al repositorio.

Endpoint de notificaciones de la base oficial: `https://cuitgyqrjibgwuniapmk.supabase.co/functions/v1/billing/events`. Configurarlo en el dashboard Wompi del ambiente de prueba. El endpoint responde 503 si el comercio no tiene secretos configurados, y no procesa pagos.

`billing_activation_settings.sandbox_enabled` y `production_enabled` parten en `false`; las credenciales por sí solas no habilitan cobros. No habilitar pagos reales como parte de una prueba. Antes de habilitar producción se debe verificar el ciclo Sandbox completo, la configuración tributaria/facturación y la atención de conciliaciones. Esta entrega no realiza cobros recurrentes automáticos ni emite facturas; activa o renueva por cada pago confirmado.

Se reutiliza el tarifario aprobado del proyecto para 2026. El checkout se detiene a partir de 2027 hasta tener configurado el tratamiento de impuestos; no agrega una tasa asumida. La escritura de catálogo no cambia suscripciones previas.

## Dominio oficial

En la revisión del 10 de octubre, `www.inmojco.com` seguía mostrando la compilación `index-CISRi866.js`, anterior al envío persistente de consignaciones. Su CNAME público apunta a `9c9te4rl.up.railway.app`, un servicio distinto al conectado. El servicio Railway conectado despliega `main` pero solo tiene el dominio generado de Railway. Railway rechazó agregar `www.inmojco.com` en dos intentos. No se modificó DNS ni se declaró sincronizado el dominio. Para resolverlo se necesita acceso al servicio Railway que actualmente tiene asociado ese dominio, y conectar ese servicio a este repositorio y a `main`, o transferir el dominio al servicio validado.

## Validación

- TypeScript y compilación de producción.
- Pruebas de firma, conciliación contra el API, autenticación, CORS, límites de cuerpo y fallo por secretos ausentes.
- Pruebas SQL de acceso pendiente, permisos del plan, reintentos, renovación, aislamiento Sandbox, suspensión, control administrativo y reversión ante falla de auditoría.
- Prueba de entrega concurrente en PostgreSQL de GitHub Actions.
- Ensayo contra el esquema oficial dentro de una transacción revertida antes de aplicar la migración.
- Pruebas de preservación de aceptaciones antiguas, bootstrap pendiente, autorización limitada de propietario, separación del superadministrador, vencimiento, bloqueo de arrendamientos, reversión por fallo de auditoría y conciliación de totales mensuales, incluido el límite UTC/Colombia.
