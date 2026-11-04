# INMOJCO — La salida al mercado no puede depender solo de CI verde

**Fecha:** 04-nov-2026. **Estado actual: NO-GO.**
Este registro corresponde al PR #285 DRAFT; no autoriza fusionar la rama
ni cambiar Railway/Supabase. PR #286 conserva por separado el trigger
`push: main` y su procedimiento de activación.

## Defecto corregido en el evaluador offline

`scripts/release-readiness.mjs` podía emitir
`LISTA DE CONTROL COMPLETA PARA REVISIÓN HUMANA` usando evidencia
sintética de CI/backup/roles, aunque las fuentes externas tuvieran
`main.protected=false` y los dos servicios Railway en
`source.checkSuites=false`. Asimismo, `migrations_reviewed=true`
no demostraba la conciliación del SQL histórico faltante de #104.

Se agregó una exigencia de seis acreditaciones explícitas:

| Clave de evidencia privada | Obligación real |
| --- | --- |
| `ci.main_branch_protected` | `main` protegida ante cambios sin revisión |
| `ci.required_status_check_enforced` | GitHub requiere `Verify JCO application / validate` |
| `deployment.railway_app_waits_for_ci` | Servicio de portal exige CI aprobada |
| `deployment.railway_wompi_waits_for_ci` | Servicio Wompi sandbox exige CI aprobada |
| `database.applied_migration_bodies_reconciled` | #104: diferencias reales de cuerpos SQL resueltas |
| `security.leaked_password_protection_enabled` | Supabase Auth rechaza contraseñas filtradas (fase comercial) |

También se exigen `ci.required_check_name='Verify JCO application / validate'`,
`ci.branch_protection_verified_at` y
`deployment.railway_ci_verified_at` con fecha/zona horaria y
antigüedad máxima de 24 horas al momento del chequeo.
Las cinco primeras acreditaciones se requieren incluso en la fase
`integration`; la opción de Auth es adicional para `commercial`.

**Requisitos de prueba:** `tests/release-readiness-gates.test.mjs`
incluye registros ficticios exclusivamente; comprueba escenarios de
check inexistente/incorrecto, rama sin protección, ambos servicios sin
CI, conciliación histórica faltante, fechas vencidas y contraseñas
filtradas sin protección. La prueba sintética positiva **no equivale
a un GO real**.

## Estado externo que debe reflejar el archivo de evidencia

Inspecciones por conectores:

- GitHub `main.protected=false` y sin status requerido.
- Railway producción, portal `a1d375e9-e457-4d23-bfdf-11f175f5db75`:
  rama `main` con `source.checkSuites=false`.
- Railway producción, Wompi sandbox `43835f59-e9a7-4bb6-a487-e8a409f689bc`:
  rama `main` con `source.checkSuites=false`.
- Supabase Auth: `auth_leaked_password_protection` nivel WARN,
  configuración todavía desactivada.
- Migraciones: 91/99 cuerpos SQL exactos identificados (incluidos 11
  con otros nombres); cuatro diferencias sustantivas siguen sin cierre.
- Respaldo auténtico #214 **ya cerrado**, no repetir exportaciones
  o trabajo en USB como sustituto de la prueba de recuperación aislada.

Los booleanos **nunca deben rellenarse a `true` por conveniencia**.
Antes de certificar un GO, el operador debe contrastarlos con los estados
ACTIVOS de GitHub y Railway, guardar prueba privada de la observación
y volver a ejecutar el evaluador con el SHA exacto del candidato.
El archivo de evidencia es una **declaración**, no una lectura en vivo:
este script no autentica llamadas a Railway/GitHub ni garantiza que el
entorno no cambie entre revisión y despliegue.

## Secuencia de activación segura

1. Terminar y validar PR #286 por separado del desarrollo financiero;
   proteger `main` y exigir su check real.
2. Exigir CI antes del deployment en **ambos** servicios Railway y
   demostrar una prueba negativa sin afectar producción.
3. Conciliar las cuatro diferencias sustantivas de SQL aplicado.
4. Ejecutar pruebas funcionales Auth/Storage/roles con dos inmobiliarias
   ficticias en entorno independiente recuperable.
5. Para la fase comercial activar protección de contraseñas filtradas,
   verificar firma/webhooks Wompi y disponer de aprobación explícita
   para pagos reales.

**NO-GO se mantiene** mientras cualquiera de estos controles falte.
No hubo `supabase db push`, `migration repair`, cambios RLS reales,
fusión, alteración Railway, Wompi real ni costos adicionales.
