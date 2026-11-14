# G16 — 5 sesiones reales de navegador privado, sin credenciales de producción

**Estado:** **IMPLEMENTADO Y BLOQUEADO HASTA SU EJECUCIÓN REAL**. La existencia de esta batería o su CI de contrato NO acredita que los cinco navegadores hayan pasado. Estado comercial #203: NO-GO.

## Procedimiento sin reaprovisionar históricos ni tocar producción

Recicla el runner existente `scripts/qa/finance96-run-auth.mjs` que ya ha sido ejecutado para 5 Auth/JWT y 2 PDF genuinos privados en el clon PG17. Necesita exclusivamente las claves protegidas del **clon** `zjgstfgiirgjssnihaam`, nunca las claves de INMOJCO productivo `cuitgyqrjibgwuniapmk`. No registrar valores de claves o contraseñas en GitHub o en el chat.

Solo en un terminal QA privado, con `npm ci`, `npm install --no-save playwright@1.56.1`, `npx playwright install chromium`, y las variables privadas del clon referidas en `docs/ops/finance-96-real-auth-storage-certification.md`:

```bash
JCO_QA96_PROVISION=1 \
JCO_QA96_AUTO_FIXTURES=1 \
JCO_QA96_RUN_BROWSER=1 \
node scripts/qa/finance96-run-auth.mjs
```

La clave de servicio del clon se exige SOLO por el aprovisionador, no por la compilación Vite. El helper `scripts/qa/finance96-browser-runtime.mjs` construye **una app local QA** apuntando al clon con solo la clave publicable (las demás variables secretas son descartadas), abre `vite preview --host 127.0.0.1 --port 4173 --strictPort` y ejecuta cinco contextos Chromium independientes. No abre `www.inmojco.com` con identidades QA, no envía leads/consignaciones, no hace compras, pagos ni giros. Al salir, incluso cuando falla, cierra el proceso local y ejecuta la limpieza del runner principal (PDFs QA, periodos, inmuebles, Auth users).

La batería `tests/g16-private-five-role-browser-qa.test.mjs` prueba:
- Inicio de sesión con **credenciales reales Auth** distintas por ORGANIZATION_OWNER, ADMIN, MANAGER, AGENT, CLIENT.
- Titular/Admin/Coordinador/Asesor: sidebar habilitada, navegación a Propiedades, Clientes, Agenda, Negocios, Propietarios y Documentos.
- Solo Titular/Admin: Usuarios y Nueva vinculación; Coordinador/Asesor no ven Nueva vinculación ni tienen derecho de asignar roles o girar fondos (autorización de fondo confirmada separadamente mediante 25/25 RPC reales #96).
- CLIENT: únicamente vista de portal privado, **nunca** sidebar operativa.
- Acceso a la portada pública de **otra inmobiliaria** sin mostrar sidebar propia ni heredar branding privado.
- Eventos críticos: denegar cualquier referencia Supabase de producción y llamadas a RPC de dinero/Wompi/Storage; navegador no descarga comprobantes ni captura PII real.

La prueba por defecto se marca **SKIP, no PASS** si el operador no usa `JCO_QA96_RUN_BROWSER=1`. La CI ordinaria ejecuta solo el contrato estático `tests/g16-five-role-browser-release-contract.test.mjs`, para prevenir desactivación del guard: no dispone de ningún secreto de QA y no ejecuta los navegadores.

## Criterio de certificación posterior

1. Registro de ejecución real `G16_REAL_AUTH ... PASS` por cada uno de los cinco roles, sin password, token, email ni PII en logs.
2. Resultado QA96 real Auth / 25 RPC + dos PDF privados. Deben ser hechos con las mismas identidades temporales antes de limpiar.
3. Postflight clon: cero cuentas QA, periodos/recibos/soportes creados, archivos, giros, auditorías falsas; entorno oficial intacto.
4. Si UI o API falla, no bajar asserts ni falsear permisos: abrir incidencia por rol y corregir; repetir con una nueva ejecución aislada.
5. No incluir `JCO_QA96_SECRET_KEY` en GitHub Actions público, Railway producción, Vite frontend o capturas.

**Dependencia actual:** herramienta conectada Supabase permite SQL y claves publicables, **no** entrega un secreto de administración del clon ni un entorno de navegador privado con autorización para ejecutar ese script. Hasta que exista esa ejecución, registrar el bloque como `PENDIENTE VERIFICACIÓN REAL`; no declararlo completado.
