# Contrato propuesto para catálogo público de inmuebles — SOLO REVISIÓN

Fecha: 2026-10-10. Proyecto verificado: nqzopzhmhqdssgpljypu.
No aplicar este documento directamente a producción.

## Contrato funcional
- El estado comercial `AVAILABLE` no autoriza la publicación. Crear un consentimiento explícito por inmueble, inicialmente desactivado.
- La organización debe tener `organization_settings.enable_public_website = true`.
- El catálogo se debe resolver para una organización concreta mediante un identificador público validado; no aceptar un organization_id arbitrario sin validar el contexto de sitio.
- No exponer inmuebles DRAFT, INACTIVE, RESERVED, NEGOTIATION, SOLD ni RENTED en el catálogo inicial, salvo decisión de producto documentada.
- El conjunto de campos públicos debe ser cerrado: identificador público, título, tipo, operación, precio, moneda, ciudad, barrio, dormitorios, baños, parqueaderos, áreas y fotografía autorizada cuando exista.
- Excluir address, latitude/longitude de precisión, created_by, assigned_agent_id, import_job_id, external_reference, datos de propietario y cualquier referencia interna.

## Alternativas de arquitectura
A. Tabla/proyección pública separada, actualizada solo por proceso autorizado; anon puede leer únicamente los campos permitidos. Requiere sincronización transaccional, pruebas de borrado y auditoría de publicación.
B. Función RPC de lectura controlada con privilegios limitados y salida tipada de columnas públicas; la función comprueba publicación y organización. Si se usa SECURITY DEFINER: propietario dedicado sin BYPASSRLS, search_path fijo, identificadores cualificados, sin SQL dinámico, permisos EXECUTE explícitos, revisión de seguridad y tests contra abuso. Una función SECURITY DEFINER mal diseñada puede saltarse RLS.
C. Vista con security_invoker: hereda los permisos y RLS del invocador, pero por sí sola NO resuelve la exposición si anon mantiene SELECT directo a public.properties.

## Cambios de permisos que deberán coordinarse en staging
1. Crear marca de publicación con DEFAULT false y mecanismo de aprobación; definir responsable, auditoría y reversión.
2. Construir la interfaz pública de lectura y probar los campos devueltos.
3. Retirar la política SELECT TO public USING(true) y revocar SELECT de anon sobre public.properties cuando la interfaz pública alternativa esté operativa.
4. Mantener las políticas privadas de autenticados y portal, verificando la combinación OR de políticas permisivas y privilegios efectivos.
5. Probar tanto anon como authenticated: ninguna consulta directa debe devolver filas de otra inmobiliaria o borradores; las consultas al catálogo deben respetar el consentimiento y la organización.
6. Desplegar primero en staging, ejecutar pruebas de regresión y obtener autorización explícita antes de producción.

## Criterios de aceptación
- Una propiedad recién creada con status AVAILABLE no aparece públicamente.
- La despublicación se refleja en la API sin dejar datos en caché.
- Un usuario de organización A no puede leer información privada de B.
- El rol anon no puede recuperar address ni IDs internos mediante select=* o consultas directas a la tabla base.
- Las consultas públicas nunca publican inmuebles de organizaciones con web pública desactivada.
- La portada existente (datos de muestra en src/data/properties.ts) continúa funcionando durante la transición.
- Pruebas automatizadas ejecutadas con las credenciales reales de anon y authenticated en staging; sin credenciales service_role en el cliente.

## Riesgos abiertos
- Identificar integraciones externas que consultan public.properties directamente.
- Decidir cómo publicar fotos, URL pública por organización y consentimiento de ubicación.
- Definir auditoría, permisos para publicar y política de retención.
