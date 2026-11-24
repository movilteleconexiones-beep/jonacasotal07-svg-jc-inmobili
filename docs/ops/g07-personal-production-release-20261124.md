# G07 — publicación controlada de consentimientos de JCO InmoDigital Global

**Ejecución comprobada:** 24 noviembre 2026 (UTC/Colombia).  
**Proyecto de producción:** `cuitgyqrjibgwuniapmk`. **Clon de QA:** `zjgstfgiirgjssnihaam`.  
**Alcance:** únicamente la inmobiliaria del SuperAdmin `jco-inmodigital-global`. La otra inmobiliaria `sistema-inmobiliario-jco` **no está aprobada ni recolecta datos**.

## Puerta previa G18

Respaldo auténtico del 23 nov: PostgreSQL 17 + 4 buckets Storage (6 archivos, 932.740 bytes) cifrado con 7-Zip AES; prueba de extracción y recuperación PostgreSQL 17.11 local; seis GET HTTP 200 y SHA-256 6/6 en clon. Evidence: incidencia #203, G18. No publicar copia privada ni contraseña en GitHub.

## Política exacta, legalmente adoptada y publicada

- Agencia aprobada: `97c570d3-200d-4ae7-af96-f22f69563e29`.
- Política personal v1.0: `https://www.inmojco.com/politicas/jco-inmodigital-global.pdf`.
- SHA256 PDF: `df30b71f6c564e9b06f26847d1fe450fce3fcfca0b6305420e719b9c5ffbf384`.
- Acta privada de autorización/facsímil SHA256: `e4365af30f9e56696ffe5a6dcb53def876a8523ee0046826e1feb5ed4f3ff810`.
- Aprobación: `G07-INMODIGITAL-ADOPCION-20261122`; fecha registrada `2026-11-23T03:05:43Z`.
- Fuente pública aprobada: `security/legal/approved-policy-publication.json`. El acta, firma y RUT originales se guardan fuera de este repositorio.

## Esquema G07 ejecutado realmente en Supabase producción

1. **`20261124054538_g07_private_approvals_and_immutable_consignments_20261124`**: derivado de `security/candidates/g07_consignment_private_approval_consent_REVIEW_ONLY.sql`, con preflight/postflight adaptados para **preservar las ACL anónimas revocadas** hasta completar pruebas. Crea registros privados de aprobación y recibos de consignación, RLS activa, FKs de retención restrictiva, trigger UPDATE/DELETE inmutable y RPCs de consulta/envío con cotejo de aprobación. No abrió captación al aplicar el DDL.
2. **`20261124054553_g07_approved_public_crm_receipt_guard_20261124`**: contenido íntegro de `security/candidates/g07_verified_public_crm_consent_receipt_REVIEW_ONLY.sql`. Campos de versión y huella aprobada para nuevos consentimientos; trigger privado obligatorio. Recibos históricos quedan intactos.
3. **Registro personal**: transacción revisada `security/candidates/g07_register_own_inmodigital_v1_0_REVIEW_ONLY.sql` con verificación de SuperAdmin, licencia LIFETIME, URL/sha/ref, una única aprobación y ninguna aprobación externa.
4. **Apertura limitada, transaccional y verificada**: únicamente `private.property_intake_sites.enabled=true` para `jco-inmodigital-global`; `GRANT EXECUTE` a `anon, authenticated` en `public.get_public_property_intake_site`, `public.submit_property_consignment` y `public.submit_public_website_lead_once`. Los tres RPC verifican tenant y política; ninguna función privada recibe permisos externos. `public.resolve_consignment_photo_submission` permanece limitada al servicio.

## Evidencias de pruebas

- Antes de producción: clon `BEGIN/ROLLBACK` con aprobación personal, versión y SHA; una consignación sintética anónima y un lead sintético generan sus recibos correctos; la inmobiliaria externa no presenta política ni recibe un intake. **ROLLBACK** elimina datos ficticios.
- Postproducción: consulta SQL independiente: una aprobación, un intake activo propio, external `enabled=false`, política v1.0 hash exacto y licencia vitalicia intacta. Sin consignaciones ni recibos artificiales nuevos.
- `SET LOCAL ROLE anon` + `get_public_property_intake_site('jco-inmodigital-global')` devuelve alias, marca, país COP y **URL/versión aprobadas**; la misma consulta de la externa devuelve `NULL`.
- Los privilegios `anon` para tablas privadas de aprobaciones y recibos siguen **false**, la API de fotos sólo servicio. Wompi LIVE sigue `false`.
- Seguridad: advisor Supabase mantiene avisos informativos de tablas RLS sin políticas (bloqueo deliberado) y avisos de RPC públicas `SECURITY DEFINER` (las tres rutas G07 se usan intencionalmente con guardas de aprobación/tenant, validación e idempotencia). No revocar indiscriminadamente.

## Conservar prueba funcional en navegador alojado

La prueba `tests/g07-hosted-intake-policy-browser.test.mjs` exige portal propio con política aprobada, vínculo correcto, checkbox sin marcar y formulario habilitado; portal externo sin PII ni envío. Es **sólo lectura**: no envía consultas/fotos/PII.

## Reversión de emergencia, exclusivamente si aparece un defecto

Requiere operación privilegiada aprobada por el propietario. No eliminar tablas ni recibos legales.

```sql
BEGIN;
SET LOCAL lock_timeout='3s';
UPDATE private.property_intake_sites SET enabled=false
 WHERE organization_id='97c570d3-200d-4ae7-af96-f22f69563e29'
   AND enabled=true;
REVOKE EXECUTE ON FUNCTION public.get_public_property_intake_site(text)
 FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_property_consignment(text,uuid,jsonb)
 FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_public_website_lead_once(text,text,text,text,text,text,boolean,text,uuid)
 FROM PUBLIC,anon,authenticated;
COMMIT;
```

## Alcance del GO

**G07 de captación propia:** operativa sólo bajo aprobación registrada y consentimiento, sujeta a prueba HTTP/Chromium de cierre. **No certifica** que la inmobiliaria externa tenga política propia: debe continuar no recolectora hasta adopción de su responsable verdadero. **No activa el lanzamiento completo**: G16 (cinco sesiones Auth), G12 (primer pago auténtico Wompi LIVE) y G24 tributario siguen sus puertas independientes.
