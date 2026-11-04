# INMOJCO — Puerta de recuperación antes de migrar producción

**Estado: RESPALDO AUTÉNTICO CREADO Y VERIFICADO LOCALMENTE; GO de
publicación aún NO APROBADO.** Este documento no contiene el respaldo.
Ver [evidencia consolidada del 1–2 nov](authentic-backup-evidence-2026-11-04.md):
PostgreSQL cifrado/USB, recuperación estructural local Auth/Storage SQL,
seis objetos Storage y 932.740 bytes con 6/6 hashes contra manifiesto,
y ruleset GitHub `backup/**` activo. No rehacer esas operaciones.
Proyecto Supabase de producción: `cuitgyqrjibgwuniapmk`.
Incidencia de seguimiento: #214.

## Alcance de lo ya acreditado frente a lo pendiente

La documentación de #214 del 1–2 nov **sí registra un backup auténtico**
del 01-nov, copia USB, extracción y seis hashes Storage. También registra
una restauración **local estructural** de 27 tablas Auth, ocho Storage,
sus FKs/RLS y dos usuarios. La presencia de esa evidencia debe impedir
que se pida de nuevo un export o que se marque «backup inexistente».

La fase 2 de copia **independiente de código fuente** en USB quedó sin
salida final acreditada. Las pruebas de **login y servicios Auth/Storage
aislados** deben efectuarse como requisito funcional de lanzamiento
(#203), no confundirse con la integridad ya comprobada de la copia
local del 01-nov.

La regla GitHub `backup/**` #26351160 está **activa**, sin bypass,
con backup histórico SHA intacto. **No protege `main`**: falta la
configuración real de protección de publicación y
`source.checkSuites=true` en Railway (PR #286 aún borrador).

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

- Para un respaldo diferente al ya acreditado de 01-nov,
  existen solo listados de archivos o recuentos SQL, pero faltan bytes.
- Se pretende acreditar un RESTORE INTEGRAL de servicios Auth/Storage solo
  por haber restaurado tablas PostgreSQL o verificado bytes de un 7z.
- La restauración utiliza producción o servicios externos reales.
- No están cifrados y protegidos los datos personales.
- La historia de migraciones sigue ambigua (#104).

## Plan gratuito

La API conectada permite consultar SQL y Storage según las capacidades disponibles, pero no ofrece por sí sola un artefacto de backup nativo/restaurable ni una rama de Supabase gratuita. No interpretar un inventario de objetos como respaldo. Mientras falte infraestructura aislada, usar pruebas simuladas en PostgreSQL 17 CI y bloquear escrituras destructivas en producción.

## Criterio de salida

La evidencia (1) de exportación auténtica PostgreSQL y (2) de
recuperabilidad local de los seis bytes Storage **ya figura en #214**.
Falta acreditar el cierre de la fase 2 USB de **código fuente**,
más el alcance restante de servicio integrado/aislamiento y el gate
de publicación #203, sin duplicar la exportación o sus pruebas
criptográficas. Nunca asumir que la ejecución CI con fixtures sustituye
al respaldo del propietario.
