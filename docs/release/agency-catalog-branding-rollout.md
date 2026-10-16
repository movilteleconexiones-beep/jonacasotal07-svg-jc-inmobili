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
| D | Dominio `www.inmojco.com` | Esperar liberación por Railway, verificar DNS TXT de propiedad y HTTPS antes de cambiar CNAME; no cambiar correos ni aprovisionar pagos |
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

El conector Supabase de ChatGPT responde `You do not have permission to perform this action`.
Eso impide comprobar/aplicar migraciones y requiere reconectar permisos correctos o
realizar revisión SQL con acceso autorizado. Railway está a la espera de liberar el dominio
`www.inmojco.com` de otra cuenta (solicitud de soporte ya presentada por el titular).
No presentar las migraciones como publicadas hasta evidencias verificables.
