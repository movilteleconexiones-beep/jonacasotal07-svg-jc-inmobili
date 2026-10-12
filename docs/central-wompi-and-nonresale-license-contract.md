# INMOJCO — Comercio Wompi central y licencia de uso no revendible

## Regla permanente del propietario de la plataforma

**INMOJCO es el software del propietario de la plataforma.** Las inmobiliarias son organizaciones usuarias que contratan un derecho de uso de INMOJCO para gestionar su propio negocio inmobiliario; **no** son revendedoras, franquiciadas, distribuidoras ni titulares del software.

1. **Un solo comercio de Wompi para INMOJCO.** Los cobros por licencias, renovaciones y suscripciones de INMOJCO pertenecen al comercio central del titular de la plataforma. No existe marketplace de licencias, cuenta comerciante Wompi por inmobiliaria, reparto automático de ingresos a inmobiliarias ni subcomercio de la aplicación.
2. **Quién paga y quién cobra son distintos.** Un representante con autorización `billing.manage` puede **pagar** el plan de su organización; esto no le autoriza a **cobrar** suscripciones del software a terceros. El control de credenciales, comercio, conciliación y activación comercial central corresponde a la plataforma bajo los permisos administrativos existentes.
3. **Ningún plan concede reventa** (tampoco planes empresariales): `resale_allowed`, `sublicensing_allowed`, `redistribution_allowed`, `white_label_allowed` y `copyright_transferred` deben ser `false` en toda licencia de inmobiliaria. Una organización no puede transferir titularidad del código, entregar copias, comercializar acceso de terceras inmobiliarias ni otorgar derechos a una red de distribuidores.
4. **El permiso de gestión inmobiliaria no concede administración comercial de INMOJCO.** La inmobiliaria puede usar sus módulos operativos y administrar usuarios autorizados de su organización; no puede configurar claves Wompi de la plataforma, cambiar reglas de licenciamiento global ni administrar organizaciones ajenas.
5. **Diferenciar pagos de software de servicios inmobiliarios:** esta prohibición se refiere a cobrar o revender **INMOJCO**; las inmobiliarias continúan siendo responsables de sus propios negocios, honorarios, arrendamientos y servicios. La pasarela Wompi central de INMOJCO **no** cobra esos servicios en nombre de ellas.
6. **Sin claves de comercio por tenant:** `WOMPI_PUBLIC_KEY`, `WOMPI_EVENTS_SECRET`, `WOMPI_INTEGRITY_SECRET` y las claves privadas, si llegan a ser necesarias, deben permanecer en secretos del backend controlados centralmente. Jamás extraerlas de columnas o solicitudes enviadas por una inmobiliaria, ni exponer secretos en Vite, GitHub o el navegador.
7. **Alcance del SuperAdmin y del Panel:** conservar acceso independiente a ambos paneles para el usuario autorizado sin cerrar sesión (véase `docs/dual-panel-protection-contract.md`). Esta regla **no** justifica alterar membresías, roles ni permisos de otras inmobiliarias.
8. **Pagos no habilitados todavía.** Antes de activar Sandbox o producción, auditar titularidad real del comercio Wompi, credenciales correctas, conciliación, segregación de organizaciones, funciones RPC, permisos y revocación concurrente. Mantener las compuertas de seguridad descritas en `docs/wompi-billing-revocation-concurrency-contract.md`.

## Evidencia de base de datos (revisión solo lectura del 11/oct/2026)

En el proyecto Supabase de producción asociado a Railway se observaron **2 licencias SAAS**, ambas con reventa, sublicencia, redistribución, marca blanca y transferencia de copyright desactivadas. Las políticas RLS visibles de `organization_licenses` permiten lectura a miembros de su organización y escritura a SuperAdmin; no implican que un miembro pueda modificar los derechos.

**La existencia de las variables Wompi del servidor no demuestra por sí sola la identidad del beneficiario de los pagos.** Verificar el comercio receptor directamente en Wompi antes de habilitar cobros. No publicar ninguna credencial durante esa comprobación.

## Criterios mínimos de regresión

- Ninguna interfaz comercial afirma que una inmobiliaria pueda revender, sublicenciar o redistribuir INMOJCO.
- La página de Licencia muestra explícitamente que no se transfieren derechos de propiedad intelectual y que el uso es interno.
- El checkout utiliza exclusivamente la clave pública recibida de la configuración central del servidor, ignorando campos de comercio aportados por la inmobiliaria.
- Cada orden sigue vinculada a su `organizationId` para facturarla, sin que esto cree un comercio receptor por tenant.
- No activar Sandbox ni pagos reales por añadir este documento o sus pruebas. El alcance de implementación pendiente se revisará en staging y en los contratos legales vigentes.
