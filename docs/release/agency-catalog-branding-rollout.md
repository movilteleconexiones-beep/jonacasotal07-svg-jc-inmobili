# INMOJCO — despliegue escalonado de seguridad, catálogos y marca

Estado: **NO autorizado para producción** hasta completar comprobaciones de Supabase real.
Los tests CI prueban PostgreSQL aislado y el código, no los permisos ni el estado de producción.

## 1. Requisitos obligatorios

- Mantener `jonacasotal@hotmail.com` como **único Superadministrador** (comprobar privilegios en servidor).
- Cuenta de pruebas `movilteleconexiones@gmail.com`: miembro `INACTIVE` de la agencia principal y `ORGANIZATION_OWNER` de la agencia de pruebas. Comprobar nuevamente con sesión real.
- Inmueble `0001` (inmobiliaria principal) debe devolver **cero** para el usuario de pruebas; propiedad `1088` pertenece solamente a la inmobiliaria de pruebas.
- No divulgar imágenes privadas, datos financieros, documentos ni enlaces firmados. Inventario privado siempre filtrado por `organization_id` y RLS.
- Preparar copia de seguridad recuperable y procedimiento de restauración ensayado en una base clonada.
- No ejecutar operaciones de pago Wompi en producción. Comprobar primero flujos sandbox y firmas de webhooks.

## 2. Preflight Supabase (sin mutaciones)

Abrir **Supabase SQL Editor** del proyecto correcto. Ejecutar íntegramente
`security/preflight/agency_release_read_only.sql`. Guardar resultado
para revisión de esquemas y RLS. Nunca compartir llaves de `service_role`,
secrets de Wompi ni tokens JWT en comentarios de GitHub.

**BLOQUEAR** si:
- `properties` permite lectura anónima directa o aparece una policy `SELECT` amplia no justificada.
- Una membresía CLIENT sin vínculo personal puede leer propiedades privadas.
- Una cuenta con permisos de agencia puede acceder a otra organización.
- No existen los prerequisitos del catálogo `private.property_intake_sites` y la organización/slug válidos.
- No se puede comprobar RLS como `authenticated` mediante identidades de dos inmobiliarias.

## 3. Orden de entrega propuesto

| Fase | Entrega | Criterio de salida |
|---|---|---|
| A | [PR #182](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/pull/182) | Revisar en clon las intersecciones de policies SELECT, preservar acceso personal del propietario/inquilino, dos agencias aisladas |
| B | [PR #181](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/pull/181) | Antes de desplegar frontend, aplicar SQL `20261015194000_isolated_real_property_publications.sql`; comprobar RPC público anónimo, páginas 24, fotos; **0 anuncios publicados inicialmente** |
| C | [PR #183](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/pull/183) | Revisar políticas del bucket `jco-agency-logos`; verificar carga solo por staff de su empresa; dominios solo `PENDING_DNS` |
| D | Dominio `www.inmojco.com` | **COMPLETADO**: registrado en Railway, propiedad DNS validada, certificado HTTPS válido y sesión de administración revisada visualmente; aún falta unificar `inmojco.com` sin `www` y las URL de retorno de Wompi |
| E | Wompi | Sandbox firmado con callbacks validados, idempotencia, conciliación y solo entonces planificación comercial del modo real |

**No fusionar en bloque**: cambios de RLS y tablas son prerequisitos para UI. Preparar
la rama de integración sobre la punta actual de `main` y ejecutar todas las pruebas
sobre ese árbol integrado: cada CI histórico por separado no prueba la combinación.

## 4. Matriz mínima de aceptación real

1. **Superadministrador central:** única cuenta autorizada; no confundir Superadmin con titular común.
2. **Titular de agencia A:** accede a A, cambia logo A y crea borrador A; no administra B.
3. **Titular de agencia B:** ve inventario propio; búsqueda de `0001` de A devuelve cero.
4. **Asesor B:** únicamente módulos autorizados; sin acceso admin central ni catálogos privados de A.
5. **Cliente/prospecto sin cuenta operativa:** ve catálogo publicado y consignación; no consume cupos internos.
6. **Propietario e inquilino externos:** solo sus inmuebles/contratos y pagos emitidos, sin CRM interno.
7. **Anónimo:** solo RPC público, empresa activa, sitio habilitado e inmuebles `AVAILABLE` marcados manualmente `published=true`.
8. **Vinculación cruzada dual:** ADMIN en B + CLIENT en A jamás extiende privilegios de B hacia A.
9. **Paginación:** páginas sucesivas sin saltos/duplicados, orden determinista, límite máximo 48 por llamada.
10. **Anuncios públicos:** fotografía explícitamente aprobada, nunca `jco-inventory-private`, `token=` o URL firmada.
11. **Dominios:** hostname solicitado no implica acceso; verificación TXT, asociación SSL y enrutamiento por host verificado antes de activación.

## 5. Recuperación y comprobación posterior

- Registrar commit/migración exactos, fecha, resultado SQL y última versión Railway exitosa.
- Si falla frontend: revertir solo el despliegue frontend, sin inventar que la BD también se revierte.
- Si falla RLS: detener publicación, restaurar policies de un respaldo/migración reversa **revisada previamente**. No aplicar `DISABLE ROW LEVEL SECURITY`, `GRANT SELECT TO anon`, ni editar registros de pagos como remedio.
- Si falla DNS: mantener disponibles los dominios técnicos `up.railway.app` y no retirar otro acceso sin comprobar alternativa.
- Confirmar al final las consultas RLS con sesiones autenticadas reales y mostrar inventarios correctos en el panel.

## 6. Bloqueos actuales

La conexión Supabase de ChatGPT solo tiene acceso administrativo a `nqzopzhmhqdssgpljypu`.
La instancia objetivo de INMOJCO es `cuitgyqrjibgwuniapmk` y devuelve
`You do not have permission to perform this action`: **nunca ejecutar migraciones
de INMOJCO en la base visible pero diferente**. Requiere conectar la organización
autorizada correcta, y luego preflight SQL, respaldo y validación real de RLS.

El dominio `www.inmojco.com` **ya funciona en producción** con HTTPS válido
en Railway; `inmojco.com` sin www mantiene un CNAME @ independiente en
Namecheap. No cambiar `@` a CNAME hacia www: puede romper la recepción de
correo. Una redirección 301 en Namecheap para `@` es una posibilidad, pero
no garantizará HTTPS del origen sin un certificado para `inmojco.com`.
Diseñar y verificar TLS del origen antes de mover `@` o quitar los registros
TXT existentes. El CNAME obsoleto `app` tampoco debe aceptarse como un
segundo endpoint de login sin certificar su estado.
No presentar las migraciones como publicadas hasta evidencias verificables.


## 7. Autorización del catálogo ligada al ciclo de vida

El estado **publicado** es un consentimiento comercial explícito, no una
consecuencia automática de `AVAILABLE`. El trigger
`private.revoke_unavailable_property_publication` elimina la aprobación
al cambiar a cualquier estado no disponible. Volver después a `AVAILABLE`
NO restaura `published=true`: el personal autorizado debe aprobarlo otra vez.
La función que valida la publicación impide además publicar un borrador,
un inmueble arrendado o vendido, aunque la llamada provenga de un servicio
interno. CI lo comprueba con PostgreSQL aislado; **validar en una copia de
la base real antes de aplicar**.

Los formularios de publicación y personalización invalidan respuestas tardías
al cambiar de inmueble o de inmobiliaria, para no mezclar nombres, colores,
licencias o descripciones entre tenants durante navegación rápida.
