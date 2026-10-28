# INMOJCO — Procedimiento de operación piloto (versión candidata)

**Estado del documento:** preparación de lanzamiento. Ningún paso de producción se
considera aprobado solo porque la CI sea verde. No usar las órdenes de prueba
como ingresos ni habilitar Wompi real sin revisar comercio, impuestos y respaldo.

## 1. Alcance controlado y secuencia

**Primera entrega candidata:** PR #223, exclusivamente UI y validaciones
TypeScript para catálogo colombiano, consentimiento/CRM, consignación, oferta
Básico/Profesional y separación de historial por inmobiliaria. Incluye
las mejoras de #215, #216, #219, #220, #221 y #222. No aplicar dos veces
esos PRs.

**Segunda entrega:** autorización individual de inmuebles (#217, etapa 1)
y después el corte protegido de catálogo (#218, etapa 2), únicamente tras
preaprobación de los anuncios actuales y restauración probada. Las dos
migraciones deben permanecer separadas.

**Tercera entrega:** cobros comerciales reales y activación de permisos
tras confirmación auténtica de Wompi. No habilitar producción con una
compra sandbox ni modificar las suscripciones TRIAL heredadas sin revisión.

## 2. Estado real que se debe confirmar nuevamente antes de publicar

- Producción Railway: SHA observado del 21/oct/2026
  `a614edab544c311d6fbf4c0c01a662f8e38de58a`.
- `main` desde entonces contiene otros **cuatro commits** relacionados con
  facturación y migraciones. Un merge a `main` puede desplegar esos cuatro
  además del PR #223: **revisar el diff completo, no solamente el PR**.
- Supabase `cuitgyqrjibgwuniapmk`: 58/58 tablas públicas con RLS,
  cuatro buckets privados, Wompi sandbox habilitado y cobro de producción
  deshabilitado (lectura de 28/oct/2026).
- Dos versiones de migración en Git pero ausentes del historial remoto:
  `20261021114500` (contratos de checkout), `20261021152000`
  (índices tenant). Los **cinco índices** esperados existen, están válidos
  y coinciden en nombre, tabla y columnas. La función real incluye los
  controles de cambio de plan, período, idempotencia y bloqueo tributario
  del 01/ene/2027. Eso es evidencia **parcial** de efectos, no garantiza
  identidad completa del SQL ni autoriza reparar el historial a ciegas.
- Existen dos suscripciones históricas TRIAL; una permanece vigente.
  Los límites contratables son BASIC = 5 usuarios/200 inmuebles/$129.900
  y PRO = 25 usuarios/2.000 inmuebles/$299.900 mensuales COP.

## 3. Bloqueos obligatorios antes de un despliegue comercial

1. Conservar copia auténtica de PostgreSQL **y archivos reales de Storage**
   fuera de los servicios originales; cifrarla, registrar SHA-256 y
   **restaurarla en un ambiente aislado autorizado**. Comparar esquema,
   datos y bytes restaurados. Un inventario SQL o un backup solo de código
   NO cumple esta condición.
2. Proteger en GitHub las referencias `backup/**` frente a modificación
   y borrado. Verificar la regla efectiva con la interfaz administrativa.
3. Conciliar migraciones sin ejecutar `db push` ni DDL por sorpresa.
   Primero confirmar los objetos y cuerpo de cada función; luego, con
   respaldo probado, seguir la documentación oficial de Supabase
   `supabase migration list` y **solo si los efectos completos coinciden**
   `supabase migration repair --status applied <versión>`.
   `repair` modifica el historial; nunca ejecutarlo durante la auditoría
   de solo lectura. Cotejar después el historial nuevamente.
4. Confirmar que Railway permita volver a un despliegue sano y que exista
   registro de la configuración efectiva previa. Verificar exactamente
   el commit destinado a `main` y la configuración del build.
5. Ejecutar GitHub Actions en el **SHA final** del candidato. No dar por
   válida una ejecución anterior si cambió un archivo después.

## 4. Secuencia de validación tras publicar el código (sin migraciones)

- Iniciar sesión como SuperAdmin y como administrador inmobiliario;
  comprobar separación de paneles, permisos y datos.
- Cambiar de inmobiliaria, departamento, municipio y operación en el
  catálogo: no debe arrastrarse un filtro del portal anterior.
- Enviar **consultas ficticias autorizadas**, con consentimiento, desde
  dos portales de prueba: cada una solo debe aparecer en su CRM.
  Al cambiar de portal, nombre, teléfono, correo y consentimiento deben
  limpiarse; no deben aparecer confirmaciones de la solicitud anterior.
- Abrir/cerrar consignación ficticia con fotos de prueba; la apertura
  siguiente y otro tenant no deben mostrar los datos previos.
- Facturación: únicamente BASIC y PRO mensuales COP deben ofrecerse;
  las órdenes sandbox deben marcarse como pruebas. Historial de A
  nunca visible mientras B está seleccionado.
- Confirmar que Wompi **production_enabled=false**. No modificar licencia
  real, contratos o estado de pagos por pruebas exploratorias.
- Comprobar sitio propio `www.inmojco.com`, HTTPS, acceso, consola,
  errores HTTP 5xx y flujo de carga móvil/escritorio. Registrar hora,
  commit, observaciones y capturas sin datos personales.

## 5. Reversión y decisión de lanzamiento

Si aparecen errores de sesión, aislamiento, portales o facturación:
detener nuevas incorporaciones de clientes; **revertir exclusivamente el
despliegue de aplicación** a la versión Railway previamente verificada.
No revertir bases de datos ni borrar Storage a ciegas.

Si se ejecutó una migración en otro lanzamiento, **una reversión de la
aplicación no revierte el esquema**: usar un plan SQL compatible y un
procedimiento de recuperación aislado previamente probado.

Registrar PASS/FAIL para cada control con evidencia. Declarar **NO-GO**
si no hay restauración real, reglas `backup/**`, migraciones conciliadas,
pruebas exactas verdes o validación del piloto. No presentar un porcentaje
de avance como garantía operativa.

## 6. Límites de autoridad

No publicar un inmueble sin autorización de su inmobiliaria; no activar
Wompi de producción ni contratar servicios adicionales sin decisión
comercial correspondiente; no extraer secretos o documentos de clientes
a GitHub/ChatGPT. Los permisos de conectores no sustituyen estas barreras.


## 7. Conciliación SQL exacta y fuentes de precios

El diagnóstico `security/diagnostics/exact_two_migrations_readonly.sql`
verifica contra Supabase **sin modificar datos** el hash del cuerpo real de
`billing_create_order`, su firma, `SECURITY DEFINER`, el `search_path`
restringido y los cinco índices (tipo, columnas ordenadas, validez,
expresiones, predicado y columnas incluidas). Las pruebas en
`tests/exact-two-migrations-preflight.test.mjs` garantizan que la huella
procede del archivo de migración correcto y que la consulta es de
**solo lectura**.

Resultado del 28/oct/2026: **todos los objetos corresponden** a los
efectos previstos y **ambas versiones aún faltan en el historial remoto**.
No ejecutar `supabase db push`, `migration repair` ni repetir DDL sin
copias auténticas de PostgreSQL+Storage restauradas y revisión previa.
La huella MD5 se usa para detectar divergencias de versión; no es una
firma criptográfica de respaldo. La comparación byte por byte se verificó
independientemente en una transacción de solo lectura.

`src/core/jco-pricing-tax-policy.ts` y
`server/wompi-sandbox-order-quote.ts` conservan **tarifas históricas de
prototipo**. No son el catálogo comercial vigente: los planes reales
BASIC y PRO proceden de `public.plans` con $129.900 COP y $299.900 COP
mensuales. El pago de producción se deriva del precio de la fila del
plan **en el RPC `billing_create_order`** y no puede utilizar ese
prototipo. La prueba `tests/live-checkout-does-not-trust-legacy-quotes.test.mjs`
bloquea regresiones que reconecten el prototipo al checkout real.
No declarar ingresos por órdenes sandbox.
