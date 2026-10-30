# INMOJCO — corrección de avisos npm de octubre de 2026

## Diagnóstico reproducible

La instalación local `npm ci` comunicó **dos avisos**: uno alto y uno
moderado. La CI consultó `npm audit --json` y confirmó:

| Paquete indirecto | Antes | Corregido | Seguridad |
| --- | --- | --- | --- |
| `body-parser` | 1.20.8 | **1.20.9** | GHSA-27r3-jxmh-p828 (denegación de servicio por cuerpo HTTP comprimido) |
| `qs` | 6.16.0 | **6.16.1** | GHSA-6pq8-jhm2-2vcw (TypeError no capturado al serializar arrays) |

Ambos paquetes llegan por `express@4.22.3` y usan rangos compatibles:
`body-parser@~1.20.5` y `qs@~6.16.0`. Se conservaron **Express 4**
y sus rutas, así como el resto de las dependencias del frontend y Wompi.

La corrección cambia **solo `package-lock.json`** para resolver exactamente
los parches oficiales y su integridad SHA-512. `package.json` no cambia,
y los siguientes `npm ci` instalan las versiones parcheadas.

## Protección continua

GitHub Actions ahora:

1. Ejecuta `npm ci` respetando el archivo lock.
2. Consulta `npm audit --json` y **falla si detecta alguna alerta**, incluso
   moderada, o si la consulta del registro de seguridad falla.
3. Comprueba las versiones realmente instaladas y que el lock no contiene
   copias adicionales vulnerables de `body-parser` ni `qs`.
4. Ejecuta la validación TypeScript, las pruebas de seguridad SQL,
   la compilación y las demás pruebas de regresión del proyecto.

No se ejecutó `npm audit fix --force`, no se elevó la versión principal de
Express y no se modificaron tablas, credenciales ni registros de usuarios.

**Nota:** `npm audit` refleja solo los avisos reportados por npm para
las dependencias del registro. No sustituye pruebas dinámicas de seguridad,
revisión de acceso RLS ni auditoría de paquetes descargados desde otras fuentes,
como SheetJS (CDN oficial).

## Referencias

- https://github.com/advisories/GHSA-27r3-jxmh-p828
- https://github.com/advisories/GHSA-6pq8-jhm2-2vcw
