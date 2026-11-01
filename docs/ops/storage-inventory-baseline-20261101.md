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
