# INMOJCO — Integridad referencial del respaldo cifrado

**04-nov-2026 | Candidato verificado únicamente con datos sintéticos.**

## Riesgo que se corrige

Un AES-256-GCM correctamente verificado demuestra que los bytes
descifrados corresponden a los bytes cifrados con la misma clave.
**No demuestra** por sí solo que el manifiesto contenga todas las
referencias esperadas para restaurar Storage, ni que sus rutas y
asociaciones sean coherentes. Antes de esta corrección,
`scripts/inmojco-backup.mjs` verificaba las etiquetas criptográficas,
el formato del archivo numerado y los nombres de fichero repetidos,
pero **no rechazaba explícitamente**:

- Referencias de objeto a un bucket que no aparece en el manifiesto.
- Claves `bucket/path` repetidas con distinto nombre de fichero.
- IDs de bucket repetidos o atributos de visibilidad inválidos.
- Números discontinuos o alterados en los ficheros cifrados.
- Claves de objeto con segmentos `..`, `.`, rutas vacías o absolutas.
- Declaraciones de cobertura `storageCoverage` incoherentes con los
  recuentos reales del manifiesto.

Esta situación no constituye evidencia de un respaldo productivo
afectado: **no se ha restaurado ni inspeccionado ningún archivo real
de clientes para esta prueba**.

## Cambios realizados

[`scripts/lib/inmojco-backup-manifest.mjs`](../../scripts/lib/inmojco-backup-manifest.mjs)
implementa `validateBackupManifest` como frontera de integridad
estructural del manifiesto ya autenticado. Las comprobaciones se
ejecutan **antes de crear carpetas de extracción en texto plano**.
Conserva la compatibilidad de lectura de paquetes anteriores que
no incluyen `storageCoverage`, pero informa
`metadataCoverageRecorded: false` para que nadie interprete el
éxito criptográfico como cobertura de objetos demostrada.

Los paquetes nuevos emitidos por `backup` sí incluyen la huella
`storageCoverage` del inventario SQL leído antes y después.
El validador comprueba que los recuentos de buckets y objetos
declarados coincidan con el manifiesto. **No puede comprobar desde
un archivo offline que el inventario real actual era completo**:
eso se controla separadamente en el momento de exportar.

La prueba
[`tests/inmojco-backup-manifest.test.mjs`](../../tests/inmojco-backup-manifest.test.mjs)
cubre una matriz adversarial de rutas, buckets, duplicados,
sellos, numeración, cobertura y proyecto equivocado. Un caso
integral cifra datos completamente ficticios, construye un
manifiesto con una ruta de traversal *autenticada con la clave
de prueba*, ejecuta `verify` y `extract`, y exige rechazo
**sin dejar archivos extraídos**. Se añadió al job de CI
`Encrypted INMOJCO database and private Storage offline backup verification`.

## Límites y salida NO-GO

- La prueba local no ejecuta `pg_restore` de un backup real de
  Supabase, ni restaura los bytes de los buckets en otro proyecto real.
- El volcado `pg_dump` y Storage se capturan en momentos distintos;
  el control de inventario reduce el riesgo de cambios concurrentes,
  pero **no ofrece consistencia transaccional de ambos servicios**.
- Validar que un manifiesto es legible y sus referencias son coherentes
  **no demuestra** que un archivo auténtico esté preservado fuera
  del equipo y tenga llave recuperable.
- Mantener los bloqueos #104, #203 y #214 hasta la primera exportación
  privada real, restauración aislada completa, comparación de hashes,
  auditoría de RLS con dos inmobiliarias y activación de branch
  protection / Railway check suites.

**Nunca guardar clientes, SQL productivo en claro, claves AES,
service role o contraseñas en GitHub. No ejecutar DDL/DML de producción
ni cambiar Wompi de sandbox.**
