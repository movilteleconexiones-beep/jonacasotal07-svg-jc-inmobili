# G07 — cierre temporal de captación pública de datos, 13 noviembre 2026

## Problema real confirmado antes del lanzamiento

En Supabase **productivo** `cuitgyqrjibgwuniapmk`, el asesor marca cuatro RPC públicas como `SECURITY DEFINER`. La RPC `public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)` está abierta a `anon` y `authenticated`, crea `public.contacts` + `public.leads` + recibo privado de consentimiento, pero su única condición documental es un campo `privacyPolicyUrl` que empiece por `https://`, **sin exigir un PDF de política aprobado ni hash de acta**.

La inspección de solo lectura halló una agencia activa con web habilitada y URL de privacidad HTTPS, pero sin PDF canónico aprobado. El propietario manifestó que aportará las políticas finales **posteriormente**, por lo que no corresponde captar datos personales nuevos antes de verificar las aprobaciones. Las dos consignaciones públicas `private.property_intake_sites.enabled=false` ya permanecen correctamente cerradas.

## Remediación reversible sin tocar inmobiliarias

Archivo SQL `security/ops/g07_freeze_unapproved_public_crm_acl.sql`:
- `REVOKE EXECUTE` **solo** para `anon` y `authenticated` sobre la RPC de consulta CRM pública.
- No modifica empresas, perfiles, clientes existentes, leads, documentos, planes, fotos ni licencias. No modifica `tenant_public_catalog` ni la portada pública.
- `BEGIN/COMMIT`, preflight limitado a `postgres`, niega repetición o aplicación si ya existe el registro de aprobaciones legales G07 y comprueba que anónimo conserva el catálogo.
- Se ejecutó simulación en **clon** `zjgstfgiirgjssnihaam`: idéntica revocación con ajuste exclusivo del preflight porque ese clon ya contiene una tabla de aprobación de ensayo, **ROLLBACK** íntegro, PASS. Comprobación posterior confirmó permisos originales intactos en el clon.
- La versión productiva del archivo exige que el registro de aprobaciones todavía no exista. En caso contrario no se ejecuta, porque sería necesaria una revisión de procedencia.

## Publicación final después de políticas firmadas (NO reabrir por solo configurar HTTPS)

1. Comprobar auténticamente titular/representante, domicilio, NIT o identificación, responsable del tratamiento, contacto de derechos del titular, versión, fecha y firma. No introducir datos de un responsable en otra organización.
2. Ejecutar `node scripts/legal/verify-approved-policies.mjs` con **PDF finales + manifiesto de SHA-256 por cada inmobiliaria**; conservar las actas firmadas fuera del repositorio público. El PDF y el acta deben coincidir con hashes verificables y URL `https://www.inmojco.com/politicas/<slug>.pdf`.
3. Aplicar la **migración G07** específica de aprobación y recibos, con restauración previa, CI PG17/HTTP y `private.consignment_policy_approvals` con fuente documental válida, sin fabricar firmas ni consentimiento.
4. **Antes de restaurar EXECUTE del CRM**, actualizar su función `submit_public_website_lead_once` para validar en cada envío un registro `private.consignment_policy_approvals` vigente que coincida con el PDF publicado y huella SHA256, guardar en recibo inmutable la versión y el digest, y revocar/rechazar si la política cambia o se anula. Una URL HTTPS por sí sola es insuficiente. Probar cinco JWT/anon y aislamiento de tenant en clon + CI.
5. Solo después, autorizar restauración controlada de `EXECUTE` anónimo y autenticado, revalidar por HTTP los formularios y Storage, registrar publicación en #370 y evidencia en #203.
6. Cobros Wompi LIVE se revisan por separado: una política de **captación pública por inmobiliaria** no prueba que el webhook del comercio central esté configurado ni que exista un pago real.

**La congelación es intencional y deja el sitio web/catálogo visibles.** Los formularios de contacto mostrarán error temporal hasta que se publique y apruebe la política correspondiente.
