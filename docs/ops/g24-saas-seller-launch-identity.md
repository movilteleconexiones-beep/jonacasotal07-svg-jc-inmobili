# G24 — Puerta de identidad jurídica y facturación del vendedor SaaS

**Situación: NO-GO** hasta recibir identidad real del titular, comprobar su publicación en el sitio y certificar el mecanismo de facturación aplicable. El nombre comercial **Sistema Inmobiliario JCO** y el dominio `https://www.inmojco.com/` no sustituyen el nombre/NIT del vendedor.

La función `evaluateReleaseReadiness(...,{phase:'commercial'})` exige `legal.saas_seller` **además de** las dos políticas de las inmobiliarias, las pruebas G16/G18, la venta Wompi LIVE G12 y los demás controles. El cambio **no** activa cobros, ni modifica la base de datos, ni publica datos legales.

## Modalidad comercial confirmada — persona natural

La persona responsable comercial del SaaS confirmó que venderá **como persona natural colombiana**, no a nombre de una sociedad constituida. La puerta G24 exige `legal.saas_seller.taxpayer_type='NATURAL_PERSON'` y mantiene `NO-GO` hasta verificar los datos auténticos de identidad, RUT/NIT según documentación, dirección de notificación y contacto al comprador. **No sustituir el nombre real por la marca Sistema Inmobiliario JCO ni usar la razón social de una inmobiliaria cliente**. No mostrar número de cédula/identificadores desde un archivo privado hasta revisar qué datos jurídicos deben hacerse públicos.

La calidad de persona natural **no determina por sí sola** si hay obligación de facturar electrónicamente o responsabilidad IVA. Revisar RUT, actividad, régimen, topes y realidad tributaria; sin la valoración documentada de contador/DIAN no marcar `dian_obligation_reviewed`. Para el flujo de facturación electrónico cuando corresponda, DIAN cuenta con `Facturación Gratuita DIAN` sin imponer contratar un tercero.

Fuentes: [DIAN — ¿debe facturar electrónicamente?](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/debes-facturar-electronicamente/), [DIAN — requerimientos facturación](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/requerimientos-para-ser-facturador-electronico/), [SIC — enlace obligatorio](https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/titulo-obligacion-de-incluir-enlace-la-superindustria-en-plataformas-de-comercio-electronico).

## Evidencia privada requerida

La evidencia G24 se completa **solo después** de contrastar documentos auténticos del responsable (sin subir cédulas, RUT o datos tributarios privados al repositorio):

- `taxpayer_type`: `NATURAL_PERSON` (confirmado por titular); no se permite `LEGAL_ENTITY` en este lanzamiento.
- `legal_name`: nombres y apellidos auténticos de la persona natural vendedora del software; no confundir con nombres de las inmobiliarias clientes.
- `identification_type`: `NIT`, `CC` o `CE`; `identification_number` debe coincidir con la documentación legal.
- `business_address` y `pqr_email`: domicilio y canal verdadero para atención, quejas, reclamaciones y hábeas data.
- `identity_documents_verified=true` e `identity_verified_at` reciente (<= 168 horas) tras revisión manual; no son una verificación automatizada en RUES o DIAN.
- `homepage_identity_verified=true`: nombre/NIT, domicilio y contacto legibles en la portada de `www.inmojco.com`, sin datos falsos.
- `checkout_identity_verified=true`: vendedor identificable antes de pagar; duración, precio final, renovación, retracto/reversión aplicables y PQR visibles.
- `consumer_rights_link_verified=true`: acceso visible al sitio oficial SIC.
- `buyer_information_verified=true`: condiciones de compra y aceptación informada probadas en móvil/escritorio.
- `dian_obligation_reviewed=true`: revisión tributaria del responsable por asesor fiscal/contador competente.
- `invoice_mode`: `ELECTRONIC_INVOICE` exige `electronic_invoicing_tested=true` en el flujo aplicable; `DOCUMENTED_EXCEPTION` exige `exception_documented=true` con sustento real. **Wompi no emite por sí sola la factura exigida**.

No registrar documentos tributarios, claves, contraseñas ni identidades privadas de terceros en evidencias públicas. No confundir bandera `true` con prueba auténtica: el revisor debe conservar respaldo verificable en archivo privado y contrastar la información con lo mostrado antes del primer cobro.

## Fallo seguro

Falta de cualquier grupo independiente (identidad, publicación, facturación) genera error G24 y mantiene el estado comercial `NO-GO`; G24 nunca reemplaza los demás controles de `#203`. El script de release no despliega ni habilita Wompi LIVE por sí mismo.

Referencias: [#410](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/410), [#203](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/203), [DIAN — facturador electrónico](https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx).
