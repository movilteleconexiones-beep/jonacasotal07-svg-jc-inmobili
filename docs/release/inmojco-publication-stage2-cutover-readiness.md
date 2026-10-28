# INMOJCO — Etapa 2 de publicación autorizada

**No desplegado.** Esta etapa depende de la etapa 1 (#217) y de la
aprobación individual, por cada inmobiliaria, de los anuncios ya visibles.
No se debe fusionar ni activar por el resultado de estas pruebas ficticias.

## Comportamiento de la migración

- Bloquea brevemente y en una transacción las propiedades, aprobaciones,
  organizaciones y configuración de portales. Si no consigue el bloqueo en
  cinco segundos, falla sin sustituir el catálogo.
- Consulta la **salida pública actual** de cada inmobiliaria habilitada:
  únicamente esos anuncios ya visibles deben tener
  `property_publications.published=true` y pertenecer a su organización.
- Si falta una autorización, **aborta** y conserva la función actual.
  Los inmuebles privados que solo están en inventario no necesitan aprobarse.
- Si todos los anuncios visibles están autorizados, sustituye atómicamente
  el RPC `tenant_public_catalog` por una versión que solo devuelve
  la descripción y fotografía pública revisadas.
- Las propiedades que pasan a RENTED, SOLD u otro estado distinto de
  AVAILABLE pierden su autorización; regresar a AVAILABLE **no** las republica.
- Conserva todos los campos de portada y marca existentes.

## Ensayo aislado obligatorio antes de la transición real

En la base PostgreSQL 17 ficticia, CI debe comprobar de forma diferenciada:

1. Abortar con **cero** aprobaciones para anuncios actualmente visibles.
2. Abortar con aprobación **parcial** de los anuncios existentes.
3. Ejecutar con **todas** las aprobaciones de los anuncios existentes.
4. Mantener aislamiento entre dos inmobiliarias, no mostrar notas internas,
   no permitir acceso anónimo directo a aprobaciones.
5. No publicar inventario nuevo solo por estar AVAILABLE y no republicar
   automáticamente un inmueble después de RENTED → AVAILABLE.

La prueba de CI no acredita una recuperación real ni el consentimiento de
ninguna inmobiliaria en producción. El corte solo debe ejecutarse una vez
instalado y verificado el esquema de etapa 1, reconciliadas las migraciones,
protegidas las ramas Git y verificada una copia restaurada de PostgreSQL
y de Storage, con procedimiento de reversión y ventana autorizada.

**Datos reales observados el 28/oct/2026:** dos portales públicos habilitados,
un anuncio visible y una inmobiliaria afectada. Antes de aprobar etapa 2,
validar nuevamente el número y la autorización de anuncios; los datos
pueden cambiar.
