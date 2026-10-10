# Diseño transaccional de publicación de inmuebles — REVISIÓN

Fecha: 2026-10-10. No aplicar a producción.

## Invariantes de seguridad
1. La tabla base `properties` nunca debe ser consultable directamente por `anon`.
2. El catálogo público expone exclusivamente columnas aprobadas y propiedades con consentimiento vigente.
3. La retirada de consentimiento, suspensión del sitio de la organización, eliminación o cambio de estado debe retirar la publicación en la misma transacción que modifica el origen.
4. Un error de sincronización revierte toda la transacción; no se permite un catálogo público desactualizado por fallo parcial.
5. Solo un rol de backend con permisos explícitos puede publicar; la clave service_role nunca se entrega al navegador.

## Opción recomendada para staging
Usar una tabla de publicación pública separada con un conjunto cerrado de columnas. Un trigger o función de base de datos, revisado y probado, sincroniza INSERT/UPDATE/DELETE de properties y cambios de enable_public_website en organization_settings dentro de la transacción original.

El diseño requiere una marca `is_published` (DEFAULT false) y reglas explícitas para estados permitidos. El procedimiento de publicación debe comprobar pertenencia, permisos y auditoría; no basta con aceptar un booleano del frontend.

## Pruebas obligatorias
- Nueva propiedad AVAILABLE sin consentimiento: invisible.
- Consentimiento concedido por rol autorizado: visible solo para la organización correcta.
- Retirada de consentimiento: desaparece dentro de la misma transacción.
- Cambio AVAILABLE -> INACTIVE y borrado: desaparece.
- enable_public_website true -> false: desaparecen todas las publicaciones de esa organización.
- Fallo forzado en sincronización: se revierte tanto el cambio privado como la proyección pública.
- Escritura no autorizada sobre proyección pública: denegada.
- Dos operaciones concurrentes de publicar/despublicar: sin duplicados ni filas obsoletas.
- SELECT anon directo a properties y lectura de address, created_by o assigned_agent_id: denegados.
- Integraciones existentes y portada estática: compatibles.

## Advertencia de implementación
El fixture `security/tests/public_catalog_contract_fixture.sql` demuestra elegibilidad, columnas públicas y retirada manual; **no** demuestra atomicidad ni autorización de publicación. Antes de un cambio productivo deben implementarse triggers/funciones y pruebas de transacciones reales en staging.

## Puerta de despliegue
Revisar SQL con control de SECURITY DEFINER/search_path, verificar políticas RLS permisivas existentes, revocar permisos antiguos, realizar migración y reversión ensayadas en staging, y obtener autorización explícita para producción.
