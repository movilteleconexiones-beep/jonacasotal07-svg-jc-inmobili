# G07 — Comercio SaaS con una inmobiliaria externa legalmente cerrada

## Objetivo
La venta de **licencias SaaS** por el titular del software no exige, por sí sola, abrir la captación pública de datos de una inmobiliaria externa de pruebas. El contrato y tratamiento de datos de los compradores de licencias deben cumplir **por separado** las puertas del operador SaaS (G24, términos, aceptación, facturación) y Wompi real (G12).

## Titularidad (declaración del propietario, verificada por cuenta y rol)
- `jco-inmodigital-global`: cuenta `jonacasotal`, SuperAdmin de la plataforma y su inmobiliaria personal. Se requiere **su política propia** en `/politicas/jco-inmodigital-global.pdf` con su representante verificado, acta, fecha, versión, SHA-256 y consentimiento.
- `sistema-inmobiliario-jco`: cuenta independiente `movilteleconexiones`, sin SuperAdmin. Tendrá **otro titular, representante y nombre**. Su política histórica v1.2 no se puede reutilizar como si hubiera sido adoptada por el futuro responsable.

## Puerta comercial corregida

En `scripts/release-readiness.mjs` se exige siempre la política personal y se admiten dos estados **excluyentes** de la otra inmobiliaria:

1. Política definitiva nueva, aprobada por su representante legal verdadero, con nombre confirmado, PDF verificable y adopción independiente (NO la versión histórica 1.2 publicada bajo el responsable anterior).
2. Inmobiliaria **no recolectora**: sin política propia todavía, pero con *evidencia humana verificada recientemente* (últimas 24 h) de que todos sus formularios y RPC anónimas están cerrados en producción. En tal caso el software puede vender licencias sin que esta inmobiliaria atienda visitantes y recoja información personal.

### Evidencia negativa requerida de la inmobiliaria externa

`legal.noncollecting_external_agency` en **expediente privado** de la revisión de lanzamiento:

- `slug` = `sistema-inmobiliario-jco` exacto; `project_ref` = Supabase prod; `commit_sha` = commit candidato; `verified_at` = fecha reciente ISO con zona.
- `property_intake_disabled_db`: desactivación de consignación comprobada directamente en PostgreSQL oficial.
- `crm_anon_rpc_denied`: intento anónimo de CRM rechazado en base/HTTP.
- `consignment_anon_rpc_denied`: intento anónimo de consignación rechazado en base/HTTP.
- `public_forms_closed_browser`: comprobación pública Chromium de ambas rutas, sin captura de PII.
- `legacy_policy_not_advertised`: la política histórica **no aparece** presentada como política actual del representante futuro.
- `actual_controller_not_onboarded`: comprobación humana de que el nuevo responsable aún no ha adoptado política ni habilitado captación.

Un `true` en JSON no es evidencia suficiente por sí solo. El revisor debe conservar enlaces a ejecución CI/navegador, lecturas SQL (sin exponer datos), commit, identidad de la revisión y fecha. Cualquier falta de evidencia implica **NO-GO**, no apertura de la agencia.

## Protección adicional
- Nada de `UPDATE property_intake_sites.enabled=true` por este cambio; sin migración G07 y pruebas E2E completas, no habilitar CRM ni consignaciones públicas de ninguna agencia.
- Las bases PostgreSQL, Storage y Roles deben restaurarse y probarse en aislamiento antes de migraciones productivas.
- El contrato Wompi y la prueba LIVE pertenecen exclusivamente al vendedor del SaaS y no dependen del nombre comercial de otra inmobiliaria sin captación.
- Cuando la inmobiliaria externa defina su nuevo propietario y nombre, crear **nuevo** documento/aprobación/URL correctos; revisar el catálogo de tenant y actualizar esta puerta antes de admitir recopilación de PII.
- No eliminar ni alterar PDFs/actas históricas para encubrir la trazabilidad; sí retirar de la interfaz los enlaces a documentos históricos que ya no representen al responsable actual.
