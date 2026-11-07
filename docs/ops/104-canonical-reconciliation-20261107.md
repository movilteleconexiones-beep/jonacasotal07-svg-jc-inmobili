# #104 — Conciliación del historial real: 99 versiones, no 109 nombres

## Hallazgo verificado 7-nov-2026 (read-only)

El catálogo del directorio `supabase/migrations/` en GitHub tiene **109** archivos SQL; Supabase `cuitgyqrjibgwuniapmk` registra **99** migraciones. La comparación estricta de versiones demuestra:

| Indicador | Resultado |
|---|---:|
| Archivos SQL locales | 109 |
| Versiones aplicadas en Supabase | 99 |
| Archivos con versión exactamente coincidente | **1** |
| SQL locales sin esa versión remota | **108** |
| Versiones remotas sin el nombre/versionado local | **98** |
| Identificador de migración local duplicado | `20261013040000` |

La mayoría de los cambios se aplicó con versiones remotas diferentes de las que conservan sus archivos fuente locales. **No son 108 pendientes de ejecutar**. Una reparación masiva de historial o un `supabase db push` sobre los 109 SQL es insegura. Algunas fuentes son antiguas, incluido el archivo comercial con precios obsoletos `20261010222700`, que **NO** consta como aplicado.

La captura de ledger original de GitHub `docs/ops/snapshots/supabase-migration-ledger-2026-11-02.json` sigue siendo idéntica, registro por registro, a las **99 versiones y nombres actuales**, consultados a Supabase mediante su conector.

## Ruta de conciliación que no altera producción

PR #314 recuperó cuerpos SQL originales, **99/99 y 493.999 bytes**, con sus hashes Git Blob exactos. El helper offline:

```bash
node scripts/ops/migration104-canonical-workspace.mjs
node --test tests/migration104-canonical-workspace.test.mjs
```

verifica, sin usar credenciales, los 99 pares `version/name`, hashes de cuerpos originales y todos los conteos de discrepancia. Puede materializar una copia de esos 99 SQL **solo para inspección temporal**:

```bash
node scripts/ops/migration104-canonical-workspace.mjs --temporary-no-push
```

La carpeta temporal `inmojco-104-NO-PUSH-*` incluye `supabase/migrations` con los **99 nombres exactamente registrados**, no los 109 nombres problemáticos. Tiene `NO-PUSH-MANIFEST.json` y se encuentra fuera del repositorio. El código no conecta a Supabase ni ejecuta SQL. **No correr `db push`, `db reset`, `migration repair` ni `db pull` desde allí**; generar una comparación no concede autorización de escritura.

Esto permite escoger correctamente cómo migrar la estructura fuente sin destruir los archivos históricos. La estructura permanente de migraciones futuras y los alias deben revisarse antes de habilitar el pipeline de migraciones.

## Evidencia auténtica previa: no repetir respaldos

El usuario ya realizó en su equipo una recuperación del dump de PostgreSQL del **1-nov-2026**, con referencia `%USERPROFILE%\INMOJCO-RESPALDOS\inmojco_2026-11-01.dump`, SHA-256 documentado en sus scripts privados; existe asimismo un archivo cifrado `INMOJCO-STORAGE-2026-11-01.7z` con seis objetos. La restauración de PostgreSQL anterior utilizó el servidor local `127.0.0.1:5433` y base `inmojco_restore_test_3` (informes históricos y scripts del propietario). **No** se ha accedido desde este PR a su PC, su USB ni a los datos del dump, y esos hechos anteriores no prueban que el catálogo actual de GitHub haya sido comparado contra esa restauración real.

Se debe usar esa evidencia existente **en el equipo del propietario**, sin subir archivos, contraseñas ni documentos privados a GitHub/CI. El control del PR #316 puede inspeccionar un dump aparte y consultar una restauración, siempre con base de pruebas identificada y sin redirecciones a producción.

## Verificación de la restauración ya hecha (solo en el PC del propietario)

No repetir el respaldo ni modificar la restauración: el issue #214 certifica una restauración auténtica local de noviembre de 2026. Tras descargar el repositorio del PR, en PowerShell de Windows y **con el servidor local PG17 ya encendido**, ejecutar:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops\inmojco104-verify-existing-restore.ps1
```

El verificador apunta exclusivamente a `127.0.0.1:5433/inmojco_restore_test_3`, solicita la contraseña **local** (no la de Supabase), fija transacciones de solo lectura, compara las 99 parejas versión/nombre contra el ledger archivado y cuenta únicamente tablas/Auth/Storage/FK. Se niega a continuar si el servidor/versión/base/dirección no son los esperados. No lee emails, nombres, inmuebles, rutas de Storage o contenidos, ni usa `pg_restore`.

Solo guarda `%USERPROFILE%\INMOJCO-RESPALDOS\RESULTADO-104-CATALOGO-LOCAL.json`. **Ese JSON resumido, no los .dump/.7z ni contraseñas, es el resultado que se puede aportar para finalizar esta comprobación.** El ensayo de login real, Storage API y aislamiento operativo corresponde al issue #203 y no se simula con este script.

## Diagnóstico real sobre la restauración local (7-nov-2026)

El operador ejecutó el comprobador contra `127.0.0.1:5433/inmojco_restore_test_3`, PostgreSQL 17, y confirmó la conexión de solo lectura. La primera versión del comprobador rechazaba erróneamente la dirección/puerto **internos** del contenedor Docker. Una segunda ejecución llegó a la consulta del ledger, pero PostgreSQL informó que **no existe** `supabase_migrations.schema_migrations` en esa restauración.

La tabla de migraciones puede no formar parte del backup restaurado. Su ausencia no debe ocultar los resultados Auth/Storage ni motivar la creación artificial de una tabla. El comprobador actualizado ejecuta `to_regclass` antes de cualquier SELECT del ledger, lo clasifica como `UNAVAILABLE_LOCAL` cuando falta y sigue verificando los recuentos de Auth/Storage y relaciones. En ningún caso autoriza `migration repair` o `db push`. El historial remoto de 99 versiones está inventariado y reconstruido con hashes por separado (PR #319).

**Pendiente:** recibir el JSON de ejecución local con los recuentos y determinar por inspección de TOC del backup si el ledger faltaba ya en el dump o quedó fuera en la restauración. El verificador V3 autónomo entregado al operador ejecuta además esa inspección de TOC, sin restaurar datos.

## Puertas de cierre verificables

1. Correlacionar la copia auténtica existente y restauración local con la base actual mediante pruebas read-only, incluyendo inventario de Auth/Storage y rollback. No exigir duplicar copias innecesarias.
2. Comprobar en aislamiento multiinmobiliaria RLS, Auth y acceso privado a archivos.
3. Definir repositorio canónico estable con las 99 versiones remotas, preservando los 109 archivos fuente antiguos sin cambiar su contenido y actualizando referencias de pruebas. No asumir que los 99 SQL reconstruidos son un proyecto Supabase autocontenido: PR #315 documenta dos DDL fuera del ledger necesarios para la creación desde cero.
4. Contrastar `supabase migration list` desde un proyecto local seguro y DESVINCULADO de producción. Si se necesita una acción sobre el historial remoto, usar únicamente el mecanismo oficial y después de revisar cada versión.
5. Validar preflight de migración sin escritura, rollback y autorización de la primera migración comercial. **Hasta entonces #104 sigue NO-GO**.

Los controles del repositorio no ejecutan migraciones ni recopilan secretos o datos reales.
