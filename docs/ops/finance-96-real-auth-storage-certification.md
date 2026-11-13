# #96 — Certificación real Auth/JWT y comprobantes financieros privados

**Estado: PREPARADO, NO EJECUTADO con cinco sesiones Auth reales.** No utilizar la CI ordinaria para declarar certificación. Mantener #96 abierto y #203 NO-GO.

## Alcance y barreras
- Únicamente Supabase restaurado `zjgstfgiirgjssnihaam`, **nunca** producción `cuitgyqrjibgwuniapmk`.
- Script `tests/finance-real-auth-96.test.mjs`: 5 usuarios únicos, 5 JWT genuinos, auditoría en lectura de roles exclusivos y ausencia de SuperAdmin, 25 decisiones RPC de PostgREST, lectura de PDF real privado por propietario/administrador, rechazo a coordinador/asesor/cliente y a otro tenant, rechazo anónimo.
- RPC se llaman con UUID reservados inexistentes. Las llamadas autorizadas deben devolver `P0002` (o `23514` para recibos), no generan abonos, estados ni giros. Las no autorizadas deben devolver `42501`.
- La prueba no fabrica usuarios, no escribe SQL, no sube comprobantes y no hace pagos. Necesita fixtures externos genuinos, además de pruebas de interfaz separadas.

## Preparación obligatoria en el clon, mediante Auth Admin y entorno seguro
1. Confirmar antes de crear identidades que el proyecto objetivo es el **clon** y que la agencia `sistema-inmobiliario-jco` tiene `organization_billing_access.is_test=true`.
2. Crear **cinco cuentas Auth diferentes** con `auth.admin.createUser` ejecutado **solo en servidor** usando clave secreta exclusivamente del clon. Nunca crear identidades mediante INSERT directo en `auth.users`. Usar direcciones de ensayo y contraseñas únicas fuertes; no compartirlas en commits, issues, capturas o logs.
3. Vincular cada Auth UID a `organization_members` bajo la agencia de prueba: `ACTIVE`, una sola fila y **un único** `member_roles` por usuario. Los roles exactos son `ORGANIZATION_OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `CLIENT`. Verificar que ninguno esté en `platform_admins` ni tenga roles de otra agencia. No reutilizar las dos cuentas históricas de roles múltiples.
4. Registrar la identidad `CLIENT` de QA sin enlace adicional `portal_access_links`. Cualquier permiso externo adicional invalida las expectativas del perfil exclusivamente CLIENT.
5. Preparar en el clon **dos comprobantes PDF verdaderos y no vacíos**, de datos completamente ficticios: uno en la agencia de prueba y otro en **una segunda agencia también marcada `is_test=true`**, cada uno vinculado a un `rent_payments` propio y guardado en el bucket privado `jco-rent-receipts-private` con ruta `{organization_uuid}/{rent_payment_uuid}/{uploader_auth_uuid}/{upload_uuid}/comprobante.pdf`. Validar además los dos registros `rent_receipt_supports`, MIME `application/pdf`, tamaño positivo y FK `rent_payments` del mismo tenant, junto con la existencia física y contenido con acceso administrativo de ensayo antes de ejecutar el test. No usar documentos reales de clientes ni placeholders con extensión PDF.
6. Confirmar que el propietario y administrador de QA tienen `rent_payments.view`, mientras `MANAGER`, `AGENT` y `CLIENT` carecen de dicho permiso para esta matriz. No modificar permisos productivos para acomodar la prueba.

## Variables privadas exigidas por el test
Configurarlas en un entorno local seguro o Secrets de un entorno QA protegido; jamás en `.env` versionado ni GitHub Issues.

```dotenv
JCO_QA96_RUN_REAL_AUTH=1
JCO_QA96_SUPABASE_URL=https://zjgstfgiirgjssnihaam.supabase.co
JCO_QA96_PUBLISHABLE_KEY=<clave publicable DEL CLON>
JCO_QA96_SECRET_KEY=<clave secreta SOLO DEL CLON; únicamente proceso Node servidor>
JCO_QA96_TEST_ORG_ID=<uuid agencia QA>
JCO_QA96_OTHER_ORG_ID=<uuid segunda agencia QA>
JCO_QA96_PRIVATE_PDF_PATH=<org>/<rent_payment>/<uploader>/<upload>/comprobante.pdf
JCO_QA96_OTHER_PRIVATE_PDF_PATH=<other-org>/<rent_payment>/<uploader>/<upload>/comprobante.pdf
JCO_QA96_OWNER_EMAIL=<qa-email>
JCO_QA96_OWNER_PASSWORD=<secreto>
JCO_QA96_ADMIN_EMAIL=<qa-email>
JCO_QA96_ADMIN_PASSWORD=<secreto>
JCO_QA96_MANAGER_EMAIL=<qa-email>
JCO_QA96_MANAGER_PASSWORD=<secreto>
JCO_QA96_AGENT_EMAIL=<qa-email>
JCO_QA96_AGENT_PASSWORD=<secreto>
JCO_QA96_CLIENT_EMAIL=<qa-email>
JCO_QA96_CLIENT_PASSWORD=<secreto>
```

En un entorno con las dependencias del repositorio instaladas:

```sh
node --test tests/finance-real-auth-96.test.mjs
```

Sin el indicador `JCO_QA96_RUN_REAL_AUTH=1`, la prueba **SKIP**, nunca PASS real. Las entradas faltantes provocan FAIL explícito cuando está habilitada.

## Evidencias mínimas para cerrar el subcontrol
- Cinco IDs de Auth distintos y hashes o identificadores **no reversibles** de sesión (nunca el JWT ni contraseña). Registro de **un único rol** y ausencia de SuperAdmin en cada cuenta.
- Resultado HTTP PostgREST con SQLSTATE por operación: 25/25 decisiones; no declarar éxito con solo SQL `SET LOCAL ROLE`.
- Para los dos PDFs QA: `%PDF-` confirmado, acceso por propietario/admin al propio, rechazo a roles sin permiso, rechazo cross-tenant y anónimo.
- Recorridos reales de interfaz en **cinco contextos de navegador separados**, apuntando explícitamente a un build de QA conectado al clon. Capturas sin PII, validación de controles, mensajes en español, subida/descarga y exportación.
- Postflight de objetos, recibos, revisiones, permisos y auditorías. Tras la certificación, limpiar **solo** los usuarios y objetos identificados como QA, por Admin API y mecanismo de archivo correspondiente. Conservar evidencias en #96, sin arriesgar cuentas existentes.

## Fuera de alcance: todavía pendiente
- UI/navegador completo con cinco cuentas; prorrateo de copropietarios, reversos/concurrencia, tratamiento contable y comisión histórica #118.
- GO jurídico G07 #370, primer pago auténtico Wompi G12 y venta comercial #203.
- **Wompi LIVE permanece desactivado**. Ningún giro simulado debe presentarse como transferencia bancaria.

## Aprovisionamiento automático sin tocar cuentas existentes (PR siguiente)

El comando `node scripts/qa/finance96-run-auth.mjs` puede crear **solo durante la ejecución** cinco cuentas reales Auth en el clon restaurado, con contraseñas aleatorias que permanecen en memoria, asignar un único rol por cuenta, ejecutar la prueba `finance-real-auth-96.test.mjs` y eliminar exclusivamente las cinco identidades de ese ensayo al terminar, incluso si la prueba falla. Nunca se crean ni se eliminan cuentas en la inmobiliaria del SuperAdmin.

**Bloqueado por defecto:** necesita `JCO_QA96_PROVISION=1`, URL exacta del clon, clave de servicio del clon en entorno seguro, publishable key del clon y las rutas de dos PDFs privados ficticios **ya cargados y enlazados** con `rent_receipt_supports`. Si falta cualquier soporte, la prevalidación falla ANTES de crear usuarios.

La segunda agencia QA `qa-finance-96-foreign-20261113` es un tenant **ficticio, no facturable y sin miembros**, creado únicamente en el clon el 13-nov-2026. Está marcado `is_test=true`, `requires_payment=false`, con estado `INACTIVE`. No es la inmobiliaria original del SuperAdmin, cuya información se preserva sin ninguna escritura.

No almacenar los secretos en GitHub. El runner jamás debe lanzarse desde la web pública; solo en un equipo o workflow protegido con secretos del clon y control de acceso al operador. Si la limpieza automática reporta fallos, inspeccionar el clon por `app_metadata.qa_suite=finance96` y no eliminar usuarios ajenos. **El script aún no constituye prueba aprobada hasta su ejecución real**.


## Flujo autónomo de PDFs privados QA — preparación de certificación

El runner `scripts/qa/finance96-run-auth.mjs` admite ahora dos modos, siempre **solo en el clon restaurado**:

- **Automático recomendado**: `JCO_QA96_AUTO_FIXTURES=1`. Con `JCO_QA96_PROVISION=1` y las dos claves **del clon** disponibles en entorno seguro, crea cinco cuentas de rol + una identidad temporal de autor QA para el segundo tenant, genera dos PDF reales de una página rotulados `QA ONLY - NO REAL RECEIPT`, crea solo propiedades, contratos `DRAFT`, períodos/recibos ficticios y sus metadatos privados, ejecuta las pruebas JWT y elimina los registros/archivos y cuentas generados en `finally`. No requiere rutas de PDFs ingresadas manualmente.
- **Manual anterior**: sin `JCO_QA96_AUTO_FIXTURES=1`, exige `JCO_QA96_PRIVATE_PDF_PATH` y `JCO_QA96_OTHER_PRIVATE_PDF_PATH`, verifica los archivos existentes **antes** de crear cuentas y no los elimina (porque no los creó).

El modo automático **no se ejecuta desde la CI común**. Solo debe ejecutarse dentro de un runtime privado con la clave secreta del **clon**. Nunca introducir esa clave en GitHub, el chat, capturas ni código frontend.

Los documentos generados son objetos Storage reales en `jco-rent-receipts-private` y llevan relaciones reales a `rent_receipts`, `rent_payments`, `leases` y `properties`, siempre bajo los dos tenants `is_test=true`. No prueban un giro bancario ni convierten una operación ficticia en un comprobante contable. Un error de limpieza produce estado FAIL y requiere inspección del clon; no borrar datos ajenos a los IDs del ensayo.

**Estado:** código de automatización entregado a CI; la certificación con cuentas Auth reales sigue pendiente hasta ejecutarse con credenciales secretas exclusivas del clon.
