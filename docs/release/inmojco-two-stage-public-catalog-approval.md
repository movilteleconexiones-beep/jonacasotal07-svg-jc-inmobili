# INMOJCO — transición segura a anuncios autorizados

**Estado:** plan de dos etapas; NO desplegado. Se prohíben cambios de producción
sin copia auténtica de PostgreSQL y Storage, restauración aislada y aprobación
de la ventana de publicación. Wompi conserva el modo sandbox.

## Situación verificada (Supabase, 28 de octubre de 2026)

- Dos inmobiliarias con portal público habilitado.
- Una inmobiliaria tiene un anuncio visible; el inventario contiene un inmueble
  disponible. El esquema de autorizaciones todavía no está instalado.
- Pasar directamente a un catálogo que exige autorizaciones dejaría ese anuncio
  temporalmente fuera de la web. No se debe migrar ocultando ese efecto.

## Etapa 1 — preparar aprobaciones sin interrumpir portales (PR #217)

La migración `20261028172000_property_publication_approval_stage1.sql` crea
`public.property_publications`, RLS por inmobiliaria, controles contra
alteraciones cruzadas y retiro de autorizaciones al cambiar el estado de
un inmueble a no disponible. El formulario de Propiedades incorpora una
autorización manual que solo pueden editar usuarios con el permiso necesario.

**No se modifica la función `public.tenant_public_catalog`**, el lector
público de anuncios. Un inmueble que ya aparece en la web continuará
visible bajo las reglas antiguas mientras se preparan las aprobaciones.

El operador debe comprobar los permisos y pedir a cada inmobiliaria que
apruebe únicamente los anuncios cuya información, fotografías y derechos
de publicación estén revisados. Ninguna aprobación se fabrica a partir de
`AVAILABLE` ni se copia en bloque sin consentimiento.

## Etapa 2 — activar catálogo por autorización (PR apilado)

El segundo cambio reemplaza `tenant_public_catalog` en una transacción
solo después de comprobar, **bajo bloqueo transaccional corto**, que
**todos los anuncios actualmente visibles** en cada portal habilitado
disponen de aprobación explícita en su organización.

Si falta una aprobación, la migración debe FALLAR y revertirse por completo.
En ese caso el catálogo antiguo permanece intacto. La barrera no obliga a
aprobar todos los inmuebles disponibles: solo los que ya están publicados.

Después del cambio, solo se muestran proyecciones públicas aprobadas.
Un anuncio retirado, vendido o arrendado deja de verse y nunca se vuelve a
publicar automáticamente al regresar a `AVAILABLE`.

## Requisitos previos a cualquier despliegue

1. Reglas GitHub `backup/**` activas, copia de PostgreSQL cifrada y bytes de
   Storage guardados fuera del proveedor; restauración aislada y SHA-256 real.
2. Historial de migraciones conciliado sin reejecutar ciegamente DDL.
3. Aprobar etapa 1 primero; verificar su compatibilidad en entorno aislado.
4. Revisar autorizaciones de cada anuncio visible con el administrador de
   la inmobiliaria correspondiente. Sin acceso autorizado no se presume el
   consentimiento de la inmobiliaria ni del propietario.
5. Validar CI exacta de la segunda etapa y confirmar una ventana de mantenimiento.
6. Comparar listado público antes/después, verificar branding, RLS, fotos, estado
   de propiedades, y tener rollback aprobado.

**Límites:** el guardado de la aprobación no implica que la portada se haya
actualizado hasta completar la segunda etapa. La validación SQL de estado
no sustituye un respaldo real ni una prueba de restauración.

No permitir publicaciones automáticas ni vaciar el catálogo deliberadamente
para eludir el control de continuidad.
