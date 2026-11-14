# Línea base de Storage — 2026-11-01

Fuente: lectura de `storage.objects` en Supabase producción `cuitgyqrjibgwuniapmk` durante auditoría. **Metadatos solamente, no copia de archivos.**

| Bucket | Objetos | Suma bytes metadatos |
| --- | ---: | ---: |
| jco-inventory-private | 4 | 740557 |
| organization-documents | 2 | 192183 |
| **Total** | **6** | **932740** |

La ausencia de objetos en otros buckets no demuestra que estén correctamente respaldados. El manifest definitivo requiere enumerar todos los buckets relevantes, exportar el **contenido binario** de cada objeto y calcular hash SHA-256 sobre sus bytes. Comparar conteo, rutas, tamaños y hashes con la restauración aislada.

Consulta de control (solo lectura):

```sql
SELECT bucket_id, count(*) AS object_count,
       coalesce(sum((metadata->>'size')::bigint),0) AS bytes_metadata
FROM storage.objects
GROUP BY bucket_id
ORDER BY bucket_id;
```

**NO-GO:** los 6 registros y 932740 bytes no significan que ya exista un backup. No publicar archivos privados ni tokens de acceso en GitHub.

## G18 — verificación binaria completa del respaldo restaurado (sin PII pública)

Se añadió `scripts/ops/verify-restored-storage-binaries.mjs` para
comparar **cada archivo del respaldo privado local** con los bytes descargados
desde el **clon restaurado**, usando SHA-256 de ambos lados.

**Precondiciones:** los archivos auténticos del backup original y el
`storage-manifest.json` creados por el exportador se encuentran en una
carpeta absoluta, privada (permisos 0700) y fuera de GitHub. Deben existir
`storage/<bucket>/<path>` con permisos privados 0600. Se requiere un terminal
protegido con la clave de servicio **solo del clon**, nunca de producción.

```bash
export JCO_STORAGE_VERIFY_CLONE=1
export JCO_STORAGE_CLONE_URL='https://zjgstfgiirgjssnihaam.supabase.co'
# Configurar JCO_STORAGE_SECRET_KEY mediante gestor de secretos local
node scripts/ops/verify-restored-storage-binaries.mjs /ruta/absoluta/backup-privado
```

El programa verifica:
- URL exacta del clon QA y opt-in; rechaza Supabase producción.
- El conjunto **completo** de buckets/objetos del clon: detecta archivos
  añadidos, faltantes, duplicados o rutas alteradas frente al manifiesto.
- Tamaño y hash SHA-256 de cada archivo físico local del respaldo.
- Tamaño y hash SHA-256 de cada objeto privado real descargado del clon
  autenticado por HTTPS; no acepta redirecciones a terceros.
- Rutas seguras, sin symlinks, sin traversal y sin revelar nombres o bytes en
  logs. Un error es **FAIL / NO-GO**.

La CI solo prueba este validador con objetos inventados; **no tiene credenciales
ni archivos reales**. Un PASS sintético no cierra G18. Para certificar la copia
histórica de seis objetos se necesita ejecutarlo de verdad desde un terminal
que pueda acceder simultáneamente al backup original y al Storage del clon.
No subir llaves, manifiestos privados, imágenes o PDFs a GitHub.
