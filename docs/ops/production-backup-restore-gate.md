# INMOJCO — Puerta de recuperación antes de migrar producción

**Estado: NO VERIFICADO. Este documento no constituye un respaldo.**
Proyecto Supabase de producción: `cuitgyqrjibgwuniapmk`.
Incidencia de seguimiento: #214.

## Condiciones obligatorias de GO

1. Identificar un destino externo, privado, cifrado y con acceso restringido. No alojar respaldos de datos reales ni credenciales en GitHub.
2. Obtener una exportación consistente de PostgreSQL **con datos y esquema**, incluyendo las relaciones de roles/organizaciones, migraciones, funciones, políticas RLS, triggers y extensiones relevantes.
3. Exportar los **bytes** de los objetos de todos los buckets Storage relevantes (no solo rutas/metadatos SQL), registrar identificador de bucket y ruta de cada objeto.
4. Generar manifiesto de fecha/hora UTC, versión PostgreSQL, project ref, commit Git, hashes SHA-256, recuento de objetos/bytes y ubicación del respaldo. Guardar el manifiesto sin secretos.
5. Restaurar PostgreSQL y objetos en infraestructura **aislada**, nunca sobre producción. Verificar esquemas, integridad referencial, RLS, permisos, recuentos de tablas y hashes de Storage contra el manifiesto.
6. Ejecutar smoke tests con cuentas de prueba: aislamiento entre tenants, contratos, cobros, idempotencia, adjuntos y auditoría; comprobar que no se enviaron correos/webhooks/pagos reales.
7. Registrar identificadores verificables del respaldo, restauración y resultados CI en #214; obtener revisión antes de `supabase db push`, `migration repair` o migraciones financieras.

## Control adicional: integridad del manifiesto cifrado (04-nov-2026)

Se reforzó el verificador local de respaldos con una frontera
[`validateBackupManifest`](../../scripts/lib/inmojco-backup-manifest.mjs):
antes de descifrar archivos o crear un destino de extracción comprueba
que los buckets, claves de objetos, nombres numerados, sellos cifrados y
recuentos de cobertura sean coherentes. Se prueba con material
sintético y rutas adversariales en
[`tests/inmojco-backup-manifest.test.mjs`](../../tests/inmojco-backup-manifest.test.mjs).
Ver [detalles y limitaciones](backup-manifest-integrity-2026-11-04.md).

**Esto no convierte un respaldo de prueba en backup auténtico.**
Los paquetes heredados sin `storageCoverage` pueden verificarse
criptográficamente, pero se reportan con
`metadataCoverageRecorded: false`; no deben aprobar el GO de
cobertura completa con ese resultado. Todavía se exige extracción
real, restauración en entorno aislado y cotejo de bytes con el origen.

## NO-GO

- Solo existen listados de archivos o recuentos SQL, pero faltan bytes del Storage.
- Existe una exportación que nunca se restauró.
- La restauración utiliza producción o servicios externos reales.
- No están cifrados y protegidos los datos personales.
- La historia de migraciones sigue ambigua (#104).

## Plan gratuito

La API conectada permite consultar SQL y Storage según las capacidades disponibles, pero no ofrece por sí sola un artefacto de backup nativo/restaurable ni una rama de Supabase gratuita. No interpretar un inventario de objetos como respaldo. Mientras falte infraestructura aislada, usar pruebas simuladas en PostgreSQL 17 CI y bloquear escrituras destructivas en producción.

## Criterio de salida

La persona responsable adjunta evidencia verificable de (1) exportación completa, (2) copia de bytes Storage, (3) restauración fuera de producción y (4) pruebas de integridad. Solo entonces cambiar el estado de recuperación a GO.
