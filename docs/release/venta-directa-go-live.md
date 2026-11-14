# INMOJCO — puerta de lanzamiento comercial (GO/NO-GO)

Esta herramienta es **solo lectura**. Nunca cambia datos ni pagos, ni publica software.
Evalúa la evidencia local firmada/revisada de una liberación concreta mediante
`node scripts/release-readiness.mjs release-evidence.local.json commercial`.

El archivo de evidencia debe quedar **fuera del repositorio público** (y se excluye
por .gitignore si se prepara dentro del entorno de desarrollo). No incluir tokens,
secrets, contraseñas, números de tarjeta, datos personales, eventos firmados ni referencias
de pago individuales en logs de CI o PRs.

## Requisitos para marcar apto para vender

- CI verde **del commit exacto** candidato y migraciones revisadas.
- Copia privada PostgreSQL reciente, SHA-256, restauración aislada de esa
  **misma copia**, con fotos y PDF reales restaurados y comprobados.
- Aislamiento RLS A/B, roles de personal y clientes, acceso de SuperAdmin
  exclusivo y portales de propietario/inquilino.
- Flujos contables completos: contrato, cobro, abonos, deducciones, liquidación.
- Invitaciones/correos y recuperación de contraseña.
- Wompi Sandbox: evento firmado e idempotencia (sirve solo como simulación).
- Wompi **producción**: orden real APPROVED y APPLIED, conciliación contra
  proveedor, suscripción y licencia activadas para el comprador, webhooks
  duplicados idempotentes, renovación y suspensión ensayadas.
- **G16 verdadero**, cinco sesiones privadas Auth/JWT independientes ejecutadas con
  cuenta/claves **solo del clon**, rutas operativas y prohibiciones por perfil.
  CI del test o `SKIP` no son evidencia.
- **Storage recuperado**: descarga real de los binarios privados y comparación de
  SHA-256 contra el backup; igualdad de metadatos no basta.
- **#96/#122/#118**: flujos privados de corrección/reversión, copropiedad y
  liquidaciones, con conciliación documental de la comisión histórica #118.
- **G07/#370/#70**: políticas particulares firmadas de las dos inmobiliarias;
  PDFs verificados por URL pública HTTPS y hash; captación/CRM/consignación/fotos
  comprobadas sin compartir información entre inmobiliarias; consentimiento
  individual auténtico y backend aprobado antes de reabrir formularios.
- Configuración y autorización comercial explícita del propietario del SaaS
  y rollback revisado.

**No confundir la orden Sandbox APPROVED/REVIEW_REQUIRED del 17/10/2026 con
una venta comercial.** No conciliarla como si fuese producción. Wompi comercial
continúa deshabilitado en INMOJCO hasta prueba real controlada.

La evidencia declarativa no sustituye inspección independiente. Nunca establecer
valores `true` para simular una prueba inexistente. La salida PASS solo indica
que la lista fue completada, no que todas las operaciones están demostradas.

## G17 — manifiesto documental de aceptación (sin datos personales)

El evaluador comercial exige `legal.consumer_terms_approved=true`,
`legal.buyer_acceptance_verified=true` y **exactamente dos** elementos en
`legal.policies`, uno por cada slug actual. Ejemplo estructural — NO evidencia:

```json
{
  "legal": {
    "consumer_terms_approved": false,
    "buyer_acceptance_verified": false,
    "policies": [
      {
        "slug": "sistema-inmobiliario-jco",
        "url": "https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf",
        "version": "PENDIENTE",
        "sha256": "",
        "signed_adoption_act": false,
        "pdf_sha256_matches_published_bytes": false,
        "pdf_verified_at": "",
        "approved_at": ""
      },
      {
        "slug": "jco-inmodigital-global",
        "url": "https://www.inmojco.com/politicas/jco-inmodigital-global.pdf",
        "version": "PENDIENTE",
        "sha256": "",
        "signed_adoption_act": false,
        "pdf_sha256_matches_published_bytes": false,
        "pdf_verified_at": "",
        "approved_at": ""
      }
    ]
  }
}
```

No usar los valores del ejemplo para marcar PASS. Los dos documentos deben estar
aprobados individualmente, sin marcas de borrador, con acta auténtica y checksum
del **PDF publicado**. Las URLs deben abrir un PDF válido, no el HTML SPA,
ser verificadas dentro de los últimos 7 días y corresponder al SHA declarado.
Los campos `approved_at` y `pdf_verified_at` requieren marcas de tiempo con
zona horaria (recomendado ISO 8601 `Z`). Este manifiesto no almacena NIT,
cédulas, firmas, contraseñas ni referencias bancarias.

Además, la fase `commercial` exige expresamente estos valores booleanos
respaldados por evidencia genuina, **nunca pruebas simuladas ni casillas
marcadas a mano sin comprobar**:

```text
security.real_auth_five_role_browser
security.financial_rpc_authorization_reviewed
database.storage_binary_sha256_verified
commercial.private_financial_browser_e2e
commercial.shared_owner_financial_browser_e2e
commercial.commission_118_documented
commercial.public_crm_consent_e2e
commercial.consignment_private_photo_e2e
deployment.production_smoke_verified
deployment.rollback_rehearsed
```

Conservar el expediente privado de soporte y los enlaces a ejecuciones de
pruebas, sin datos sensibles públicos. El comando `release-readiness` es solo
una comprobación declarativa; no autentica firmas legales ni consulta Wompi por
sí mismo. Sus respuestas favorables requieren revisión independiente.

**Apertura del 14-nov-2026:** G17 queda preparado para rechazar la ausencia de
evidencia. No significa que las políticas, los cinco navegadores ni los
archivos Storage ya estén certificados; no iniciar cobros reales antes de G07 y
G12.
