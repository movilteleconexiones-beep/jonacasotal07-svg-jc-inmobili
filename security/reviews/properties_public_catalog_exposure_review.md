# Revisión de seguridad: catálogo público de propiedades (NO APLICAR)

Fecha: 2026-10-10. Proyecto oficial: nqzopzhmhqdssgpljypu.

## Hallazgo confirmado (consultas SELECT exclusivamente)
- public.properties tiene RLS habilitado.
- La política "Permitir lectura publica de propiedades" es SELECT TO public USING (true).
- Los roles anon y authenticated tienen privilegio SELECT sobre public.properties.
- La tabla contiene columnas privadas (address, assigned_agent_id, created_by, import_job_id, external_reference) junto a campos de catálogo.
- En la inspección, la tabla no contenía registros.
- Los estados permitidos son DRAFT, AVAILABLE, RESERVED, NEGOTIATION, SOLD, RENTED e INACTIVE.

## Riesgo
Una consulta de la API con credenciales anon puede leer cualquier fila de properties, incluidos futuros borradores y datos internos. Las políticas permisivas se combinan con OR; añadir otra política restrictiva de SELECT sin eliminar la política USING(true) no resuelve el problema.

## Decisión pendiente
Acordar el contrato público: qué propiedades se publican, qué columnas se exponen, y cómo se vincula cada catálogo a su inmobiliaria. El estado AVAILABLE por sí solo no es necesariamente consentimiento de publicación.

## Plan propuesto (revisión, sin migración)
1. Inventariar consumidores públicos actuales de properties y sus columnas.
2. Definir explícitamente publicación (p. ej. published_at o is_public) y visibilidad por organización.
3. Crear una proyección pública de columnas permitidas y probarla con usuarios anon y authenticated de dos organizaciones.
4. Eliminar la política pública USING(true) y restringir/revocar el acceso directo anon a la tabla base; validar compatibilidad con la API antes de activar.
5. Añadir pruebas automatizadas de filas DRAFT, INACTIVE, AVAILABLE no publicadas y publicadas, así como protección de columnas internas.
6. Ejecutar pruebas en staging y revisar plan de reversión antes de autorizar cambios en producción.

No se ejecutó DDL/DML ni se desplegó este plan.

## Verificación adicional del flujo de creación
- El módulo src/modules/properties/PropertiesModule.tsx crea propiedades con status: 'AVAILABLE' de manera predeterminada.
- La tabla properties no tiene columna de publicación independiente; AVAILABLE representa disponibilidad comercial, no autorización de difusión.
- organization_settings.enable_public_website existe, pero no está presente como condición en la política pública actual de properties.
- Por lo tanto, filtrar únicamente status = 'AVAILABLE' no evita publicación accidental. Requerir consentimiento explícito por propiedad y una proyección de columnas públicas.
- No cambiar el estado de creación ni añadir migraciones hasta inventariar consumidores y acordar compatibilidad con el catálogo.
