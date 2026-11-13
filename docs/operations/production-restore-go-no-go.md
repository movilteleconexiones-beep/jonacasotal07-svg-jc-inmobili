# INMOJCO — puerta de seguridad para cambios de producción

Estado al 31 de octubre de 2026: **NO-GO** para migraciones financieras y activación de Wompi real mientras no se demuestre una restauración auténtica. Relacionado con #214, #203 y #104.

## Evidencia requerida (sin publicar secretos ni datos personales)

1. **Código:** verificar protección del branch `backup/**`, confirmar SHA de referencia, conservar una segunda copia independiente.
2. **PostgreSQL:** obtener un respaldo real cifrado de `cuitgyqrjibgwuniapmk` mediante herramientas oficiales y operador autorizado; registrar hora, tamaño, SHA-256 y ubicación privada en un manifiesto, sin subirlo a GitHub.
3. **Restauración:** restaurar **ese mismo respaldo** en PostgreSQL 17 aislado; registrar pruebas de tablas, funciones, políticas RLS, roles, claves foráneas y conteos (sin divulgar contenido privado). Un esquema vacío o fixture CI no sirve como evidencia.
4. **Storage:** copiar bytes auténticos de los buckets privados `jco-consignment-photos`, `jco-inventory-private`, `jco-rent-receipts-private` y `organization-documents`. Comparar tamaños y SHA-256 de origen y destino; verificar que otra inmobiliaria no pueda leerlos.
5. **Migraciones:** resolver el historial divergente del issue #104 y las migraciones de 2026-10-21 antes de ejecutar `supabase db push`. No marcar versiones manualmente como aplicadas sin confirmar cada efecto real.
6. **Recuperación:** ensayar restauración y reversión de despliegue en entorno aislado; documentar tiempo de recuperación y responsables.
7. **Lanzamiento:** requerir CI aprobada del commit exacto, pruebas de webhook, idempotencia, derechos por rol, consentimiento de datos y funcionamiento end-to-end.

## Reglas de intervención

- **NO** guardar backups, tokens o archivos de Storage privados en PR, issues o logs públicos.
- **NO** ejecutar migraciones de producción, limpiar tablas, eliminar blobs ni habilitar Wompi comercial mientras falte cualquiera de los puntos anteriores.
- **NO** interpretar un workflow verde con fixtures como restauración auténtica de producción.
- Confirmar permisos y costos de un entorno aislado antes de crearlo.
- Una vez acreditados los respaldos, realizar publicación pequeña y reversible, con verificación posdespliegue y rollback documentado.

## Registro de pruebas

La persona operadora debe mantener en ubicación privada el manifiesto de respaldo, SHA-256, evidencia de restauración y resultados de comprobación de accesos. En GitHub publicar solamente un resumen sin secretos ni información de clientes.

**Estado:** preflight documental preparado; el backup y la restauración reales siguen pendientes.
