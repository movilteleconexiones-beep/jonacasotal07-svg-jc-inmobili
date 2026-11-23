# G07 — Publicación legal segura en `www.inmojco.com`

**Estado actual: NO-GO jurídico.** Esta infraestructura no publica políticas ni certifica adopciones legales. Su finalidad es impedir que un PDF de borrador, ajeno a la inmobiliaria o distinto del documento aprobado, se sirva como una política oficial.

## Rutas públicas reservadas

- Política del operador INMOJCO (responsable de licencias y encargado de agencias): `https://www.inmojco.com/politicas/operador-inmojco.pdf`
- Términos y condiciones SaaS JCO: `https://www.inmojco.com/politicas/terminos-saas-jco.pdf`
- Documento histórico de la inmobiliaria actualmente vinculada a `movilteleconexiones`: `https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf`. **Su PDF v1.2 publicado no acredita al futuro titular, representante ni nombre de esta inmobiliaria; no presentarlo como política vigente de la futura entidad.**
- Política prevista de la inmobiliaria personal del SuperAdmin (`jonacasotal`), JCO InmoDigital Global: `https://www.inmojco.com/politicas/jco-inmodigital-global.pdf` (**reservada hasta aprobación y publicación específica de su titular**).

Las dos primeras rutas identifican al **vendedor de licencias SaaS**. Cada agencia que recopile datos personales debe mostrar y registrar su política **propia** adoptada por su responsable real. El documento `sistema-inmobiliario-jco.pdf` y su acta forman parte del expediente histórico publicado el 21-nov-2026, pero no autorizan a la inmobiliaria externa con otro propietario y otro nombre a captar datos. La marca comercial del SaaS sigue siendo **Sistema Inmobiliario JCO**, independientemente del nombre de cada inmobiliaria.

**Control 22-nov-2026:** la inmobiliaria `jco-inmodigital-global` es la personal del SuperAdmin; `sistema-inmobiliario-jco` corresponde a una cuenta separada y tendrá nuevo responsable. Véase `docs/ops/g07-tenant-controller-ownership-correction-20261122.md`.

El servidor **no permite el fallback SPA** en `/politicas` y `/politicas/*`. Si no existe el PDF, devuelve **HTTP 404 real**, no `index.html` falsamente marcado 200. Cada ruta debe permanecer 404 mientras no exista para ese PDF un acta de adopción auténtica, SHA-256 y manifest aprobados.

## Puertas antes de subir cada política

1. Verificar el titular **real** de cada inmobiliaria: persona natural/jurídica, nombre/razón social, NIT/ID, domicilio, contacto hábeas data, responsable designado y representante con facultades. Si las dos marcas pertenecen a un mismo responsable, documentar esa relación expresamente. **No insertar secretos ni copias de RUT/cédulas en GitHub**.
2. Verificar y adaptar normativa aplicable al servicio realmente ofrecido: Ley 1581/2012, Decreto 1074/2015 y SIC; RNBD conforme a sujeto y activos; Ley 1266/2008/2157/2021 si se consultan o reportan datos crediticios; Ley 2300/2023 si se realizan cobros o publicidad; Ley 820/2003 y reglamentos locales si administra/arriendo de vivienda; Ley 675/2001 cuando aplica propiedad horizontal; Ley 1480/2011 y deberes de información; Ley 527/1999 y normas sobre autorización/probanza electrónica. Documentar cuadro de retención, proveedores, transmisiones/transferencias internacionales y procedimientos de consultas y reclamos.
3. Revisar el PDF **definitivo**: sin pie «BORRADOR», corchetes sin completar ni notas de auditoría internas; verificar contenido, legibilidad, identidad, canales vigentes, fecha/versión, accesibilidad y ausencia de datos privados innecesarios.
4. Adoptar **individualmente** la política mediante acta auténtica firmada por quien tenga facultades. Guardar el acta firmada **en un repositorio privado del titular**, no en `public/`, GitHub ni logs.
5. Calcular los SHA-256 **finales** del PDF público y del acta firmada. Son archivos diferentes y sus digests deben ser distintos. **La firma y la autoridad del firmante se verifican manualmente**; un SHA-256 demuestra correspondencia de bytes, no legalidad ni validez de firma.
6. Colocar **solo** cada PDF aprobado (política de datos o términos SaaS) en `public/politicas/<slug>.pdf` y crear, **en la misma PR**, `security/legal/approved-policy-publication.json`. Ejemplo **NO COPIAR COMO APROBACIÓN**:

```json
{
  "schema_version": 1,
  "policies": {
    "sistema-inmobiliario-jco": {
      "policy_url": "https://www.inmojco.com/politicas/sistema-inmobiliario-jco.pdf",
      "pdf_sha256": "HASH_SHA256_REAL_DEL_PDF_APROBADO",
      "signed_acta_sha256": "HASH_SHA256_REAL_DEL_ACTA_FIRMADA",
      "approval_reference": "REFERENCIA_INTERNA_REAL",
      "policy_version": "1.0",
      "approved_at": "YYYY-MM-DDTHH:MM:SSZ"
    }
  }
}
```

Para el operador y sus términos, el manifest debe usar los ID `operador-inmojco` y `terminos-saas-jco` respectivamente, con sus documentos y acta autenticada por el titular. No copiar una aprobación de otra versión ni cargar copias privadas de la firma. El ejemplo no se almacena en la ruta operativa del manifest. Pueden aprobarse las agencias en momentos distintos; el manifest debe contener **exactamente los documentos efectivamente presentes** en `public/politicas`.

7. La CI ejecuta `node --test tests/g07-legal-publication.test.mjs` y `node scripts/legal/verify-approved-policies.mjs`. Con PDF exige manifest, SHA coincidente, acta firmada referenciada por SHA, identidad jurídica y naturaleza correcta del documento y que `pdftotext` pueda extraer el contenido sin campos editoriales; si `pdftotext` no está instalado, **FALLA Y BLOQUEA** la publicación. Esta es una puerta **técnica**, no una validación automática de la firma.
8. Tras fusionar la PR con CI verde, comprobar con `curl -I` o navegador: HTTPS **200**, `Content-Type: application/pdf`, digest del archivo descargado y documento propio de la inmobiliaria. Confirmar que URLs sin documento siguen dando **404**. No sustituir esto por un enlace a la portada.
9. **Solo entonces** revisar instalación de G07 SQL de consentimiento (hoy `security/candidates/g07_consignment_private_approval_consent_REVIEW_ONLY.sql`) con respaldo reciente/restauración y pruebas de aprobación/denegación por inmobiliaria; registrar la referencia/hash/versión aprobados en tabla privada tras validar actas auténticas. Configurar el `privacyPolicyUrl` correcto de esa inmobiliaria y probar HTTP anónimo, multi-tenant, Storage y consentimientos.
10. **No habilitar `private.property_intake_sites.enabled` hasta la verificación integral**. El interruptor manual, por sí solo, no sustituye la aprobación del documento ni controles de backend.

## Retirada o modificación

Una nueva versión exige nueva revisión, acta, SHA y despliegue. Las evidencias existentes de consentimiento anteriores se conservan conforme al régimen de conservación y supresión legalmente aprobado. No sobreescribir documentos sin nueva acta; no borrar evidencia privada por cascada. Ante una revocación, cerrar el intake en backend antes de retirar enlaces o archivos.

**Criterio de aceptación final:** actas firmadas verificadas, enlaces PDF reales y hashes correctos, G07 SQL instalado y probado con aprobación vigente por agencia, UI de consentimiento no premarcada, evidencia privada vinculada y ausencia de cruces entre inmobiliarias.

## Extensión G07 para documentos del operador y contratación v1.2

La CI permite `operador-inmojco.pdf` y `terminos-saas-jco.pdf` junto con las políticas independientes de agencias. Los términos deben declarar «Términos y Condiciones» y la política debe declarar «Política de Tratamiento». La ruta de términos **no** se sustituye por una SPA que devuelve 200.

**Orden obligatorio:** (1) titular revisa tres PDF con SHA-256 exactos y adopta acta privada; (2) guardar la firma fuera del repositorio; (3) ingresar en PR única los PDF públicos y el manifest con datos auténticos; (4) comprobar CI, despliegue y HTTP 200 con MIME PDF y SHA; (5) aceptar y persistir consentimientos separados (operador/comercio y agencia) por versión; (6) recién entonces habilitar CRM/consignación pública y, tras pruebas independientes, pagos LIVE. La CI no prueba la autenticidad jurídica del acta: esa verificación corresponde a control humano con evidencia de firma.

**No dar aprobación anticipada:** una solicitud genérica de corrección o la firma facsimilar de la versión 1.0/1.1 no convierte los PDF v1.2 en documentos jurídicamente adoptados. Requerir aprobación expresa de las huellas finales o nueva firma del acta.
