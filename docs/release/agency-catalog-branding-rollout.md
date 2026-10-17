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

**Conexión corregida el 16/oct/2026:** el complemento Supabase de ChatGPT
tiene ahora acceso al proyecto de producción correcto `cuitgyqrjibgwuniapmk`
(región `us-west-2`, PostgreSQL 17.11, `ACTIVE_HEALTHY`). Se verificó el
historial de migraciones y se realizaron consultas de preflight **solo lectura**.
El acceso administrativo a la base es un prerrequisito, no una autorización de
publicación: persisten las puertas de seguridad de respaldo y pruebas reales.
**Nunca apuntar las migraciones de INMOJCO al proyecto diferente
`nqzopzhmhqdssgpljypu`.**

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


## 8. Preflight real de Supabase — 16/oct/2026 (solo lectura)

- Instancia consultada: `cuitgyqrjibgwuniapmk`, PostgreSQL 17.11, estado saludable.
- Inventario: 2 inmobiliarias activas, 2 inmuebles privados; 1 inmueble `AVAILABLE`.
- Identidad: 1 cuenta de superadministrador activa (solo cardinalidad, sin divulgar usuario).
- Catálogo: `private.property_intake_sites` existe; 1 sitio activo. Aún **no existen** `public.property_publications` ni `public.agency_custom_domains`.
- Los RPC del nuevo catálogo, los dominios y `jco_private.can_read_authorized_external_property` todavía no existen, como corresponde antes de las migraciones de integración.
- `public.properties` tiene RLS activado; no se encontró policy de `SELECT` para `anon`, pero **`anon` conserva GRANT SELECT** en la tabla. La migración `20261015195500_strict_private_property_read_boundary.sql` contiene `REVOKE SELECT`. Verificar la revocación y las políticas efectivas tras aplicarla; no asumir exposición real de datos solo por el GRANT.
- Las policies de `properties` para miembros autenticados incluyen reglas permisivas de acceso por agencia y relaciones personales; el nuevo guard `AS RESTRICTIVE` debe comprobarse con cuentas reales A/B y perfiles CLIENT, propietario, inquilino y personal operativo.
- Tablas reales `properties`, `organizations`, `portal_access_links`, `property_owners`, `property_ownerships`, `leases` y `organization_settings` incluyen las columnas utilizadas por el SQL propuesto.
- Los buckets `jco-consignment-photos` y `jco-inventory-private` siguen privados. No se ha creado aún `jco-agency-logos`.
- El asesor de seguridad indica 2 funciones públicas `SECURITY DEFINER` intencionadas para consignación y un conjunto de funciones autenticadas `SECURITY DEFINER`. Auditoría de sus guardas de permisos necesaria; **no revocar masivamente** sus ejecuciones, pues rompería funcionalidades existentes.

### Bloqueos antes de cualquier DDL en producción

1. Comprobar respaldo recuperable y restauración ensayada en un entorno separado compatible; GitHub CI no sustituye esa evidencia.
2. Ejecutar pruebas de RLS e intersección de políticas con dos identidades autenticadas de inmobiliarias distintas (incluida cuenta con roles mixtos).
3. Aplicar migraciones ordenadas y verificadas: primero `20261015195500` de aislamiento; después `20261015194000` de publicaciones (orden operativo por dependencias, no por nombre); finalmente `20261015201000` de branding/dominios, siguiendo los prerrequisitos del esquema y la revisión de sus scripts.
4. Repetir los controles de regresión y confirmar que `anon` no tiene `SELECT` directo sobre `public.properties`; verificar que portales personales no pierden lecturas legítimas y que todas las publicaciones iniciales siguen sin aprobarse.
5. Solo después fusionar o desplegar la interfaz correspondiente; mantener Wompi producción desactivado.

**No se aplicó ninguna migración ni se modificaron tablas de producción durante este preflight.**

## 9. Validación ampliada de producción y límite de staging — 16/oct/2026

- El `security/preflight/agency_release_read_only.sql` ampliado se ejecutó en la base real dentro de `BEGIN READ ONLY` / `ROLLBACK`, sin fallos ni mutaciones; se comprobaron 1 superadministrador, 2 inmobiliarias activas, 2 inmuebles y 1 sitio público habilitado.
- Dos actores reales distintos, uno por inmobiliaria, fueron evaluados en transacciones separadas de solo lectura con `SET LOCAL ROLE authenticated` y `request.jwt.claim.sub`. Cada uno vio 1 inmueble propio y **0** inmuebles ajenos.
- La cuenta SuperAdmin validó `is_platform_admin()=true` pero vio solo 1 inmueble de 2; el diagnóstico señala ausencia de una policy permisiva de lectura global sobre `public.properties`, pese al predicado de administrador en la política restrictiva previa. Se preparó en `20261015195500_strict_private_property_read_boundary.sql` una política de lectura específica para SuperAdmin, sin autorización adicional de escritura.
- `anon` conservaba concesiones directas `SELECT/INSERT/UPDATE/DELETE` sobre `properties`, aunque sin policy permisiva de filas. La migración ahora revoca **todos** los privilegios sobre esa tabla para `anon`; las pruebas SQL verifican todas las operaciones DML.
- GitHub CI prueba un administrador de plataforma simulado, personal de dos agencias y un vínculo `CLIENT` de otra organización, contra políticas restrictivas y permisivas combinadas. Las sesiones simuladas con credenciales reales en SQL siguen siendo **pruebas diagnósticas**, no sustituyen un ensayo de autenticación por API ni un clon de datos reales.
- La creación de rama Supabase se intentó con costo informado de USD 0,01344/h, previamente autorizado para staging; el servicio la rechazó con `Branching is supported only on the Pro plan or above`. No se creó rama ni se realizó cargo. No activar servicios pagos sin decisión expresa.
- **Bloqueo de despliegue:** sin instancia de restauración y copia de seguridad verificada, no aplicar el conjunto de migraciones `#185` a producción. Enviar a producción solo un lote migrado y probado con procedimientos de recuperación revisados.
