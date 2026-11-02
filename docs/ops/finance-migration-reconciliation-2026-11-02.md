# INMOJCO — Conciliación del historial de migraciones (bloqueo #104)

Fecha de auditoría: 2026-11-02. Fuente de datos: repositorio `main` y `Supabase.list_migrations` del proyecto `cuitgyqrjibgwuniapmk`. **Todas las consultas realizadas fueron de solo lectura.**

## Diagnóstico cuantificado

| Señal | Resultado |
| --- | ---: |
| Archivos SQL en `supabase/migrations/` | 109 |
| Versiones de 14 dígitos distintas en el repositorio | 76 |
| Migraciones registradas como aplicadas en Supabase | 99 |
| Versiones coincidentes exactamente | **1** |
| Versiones locales fechadas sin coincidencia en el ledger | **75** |
| Archivos del repositorio con el mismo nombre funcional que un registro aplicado | 61 |
| Prefijos duplicados preexistentes en repo | `20261013040000` (2 archivos) |

Los nombres coincidentes sirven únicamente para **identificar candidatos a equivalencia**, no para acreditar que el DDL o sus permisos son iguales. La carpeta también contiene 32 archivos con prefijos antiguos de cuatro dígitos que no deben subirse automáticamente.

En el bloque financiero `20261012120000`–`20261012150000`, los cinco identificadores locales no aparecen en el historial. En origen constan las migraciones consolidadas `20261012070133` y `20261012071309`. Una verificación read-only de catálogo confirmó **32/32 objetos** de ese bloque presentes: 2 tablas, 6 funciones, 11 restricciones, 9 políticas, 2 índices y 2 disparadores. **No acredita equivalencia de definiciones ni de grants.**

## Preflight de seguridad incorporado

```bash
# Sin conexión ni credenciales; comprueba versiones duplicadas nuevas y fija las
# cinco migraciones históricas para que no cambien sin revisión:
node scripts/ops/finance-migration-gate.mjs

# Con un JSON de versiones realmente aplicadas, revisa todo el historial local:
# Se admite ["2026..."] o {"migrations":[{"version":"2026..."}]}.
node scripts/ops/finance-migration-gate.mjs --ledger ruta/al/ledger.json
```

**Resultado esperado con el ledger comprobado el 2-nov:** código de salida 2 / NO-GO. Un resultado positivo de esta herramienta **no autoriza por sí solo** `supabase db push`, pues no compara definiciones de producción, RLS, ACL ni datos.

## Camino mínimo al cierre sin repetir DDL

1. Revisar objeto por objeto los **15 archivos fechados sin coincidencia exacta de nombre funcional** y el conjunto histórico de cuatro dígitos. Mapear cada operación a un objeto/efecto existente; no deducir equivalencia a partir del nombre.
2. Para los archivos con mismo nombre y fecha distinta, comparar funciones `pg_get_functiondef`, políticas `pg_policies`, restricciones `pg_get_constraintdef`, disparadores, ACL, índices y efectos de migraciones posteriores; documentar equivalencia o diferencia real.
3. En una base aislada restaurada a partir del respaldo **ya certificado** (no en producción), ensayar la conciliación de versiones sin ejecutar DDL histórico sobre datos reales.
4. Solo cuando el mapa esté firmado y las pruebas sean satisfactorias, aplicar el mecanismo **oficial** de reparación del historial de migraciones, sin escribir versiones directamente en las tablas ni repetir `CREATE TABLE`/`ALTER TABLE`. Confirmar `supabase migration list` y volver a ejecutar el preflight antes de aprobar un despliegue.
5. Mantener Wompi sandbox, RLS y producción sin cambios hasta pasar los controles de lanzamiento #203.

La rama de respaldo de código permanece protegida; la incidencia #214 de recuperación ya se cerró. No se necesitan nuevas exportaciones, cifrado, USB ni migraciones por duplicado.
