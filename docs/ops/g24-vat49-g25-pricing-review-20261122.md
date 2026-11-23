# G24/G25 — RUT no responsable de IVA y conciliación de precios LIVE

Fecha de inspección técnica: **22 de noviembre de 2026** (Colombia).

## 1. Responsabilidad IVA del vendedor SaaS — comprobada

El RUT actualizado del vendedor persona natural, expedido el **20/11/2026**, muestra responsabilidad **49: no responsable del IVA**. Este código se registra como evidencia fiscal privada; **no subir el RUT, su imagen, número de formulario ni datos privados a GitHub**.

- En la comunicación comercial correspondiente a 2026 se informa la condición tributaria vigente del vendedor.
- **No adicionar IVA** ni mostrar un desglose ficticio del 19 % a los precios mientras la condición 49 sea aplicable.
- El total presentado debe coincidir exactamente con el valor total de la orden generada por el backend; el navegador no determina importes ni tarifas.
- **No responsable de IVA NO demuestra por sí solo que esté exceptuado de expedir factura**. La DIAN establece condiciones independientes para esta obligación: véase su concepto de 2026 https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_8208_2026.htm y requisitos https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx.
- Si la situación tributaria cambia, revisar código, precios, comunicaciones y facturación antes de hacer nuevos cobros. A partir de 2027 el módulo de precios exige configuración tributaria explícita; no inventar IVA.

## 2. Catálogo mensual aprobado y conciliado (G25)

Tras recuperar el historial de aprobaciones del propietario, se confirmó una decisión expresa del **15-oct-2026** que sustituyó para los dos planes mensuales los importes anteriores del **9-oct-2026**:

| Plan de venta SaaS | Precio mensual más reciente autorizado | Supabase PROD (22-nov-2026) | Capacidad | Resultado |
|---|---:|---:|---|---|
| BÁSICO | COP **129.900** | COP **129.900** / MONTHLY | 5 usuarios, 200 inmuebles | Coincide |
| PROFESIONAL | COP **299.900** | COP **299.900** / MONTHLY | 25 usuarios, 2.000 inmuebles | Coincide |

Se probó en Sandbox la compra de BÁSICO por COP 129.900 durante octubre de 2026. La consulta *read-only* actual del proyecto Supabase productivo `cuitgyqrjibgwuniapmk` confirmó los valores y cupos. El 22-nov se calcularon independientemente el mismo digest SHA-256 del catálogo **exclusivamente vendible en checkout** (activo, `MONTHLY` o `ANNUAL`, divisa `COP`).

El texto UTF-8 exacto, **sin salto de línea final**, de las filas ordenadas por `code, billing_cycle` es:

```text
BASIC|MONTHLY|COP|129900.00|5|200|true
PRO|MONTHLY|COP|299900.00|25|2000|true
```

Hash SHA-256 de ambas fuentes (historial de aprobación y consulta de Supabase): `81136f80baaae6d757740a1349fabb3bf5c609498a7cedadf0a267af48d4b208`.

Otros registros de Supabase: `ENTERPRISE` en modalidad CUSTOM/USD 0 y `LIFETIME` en ONE_TIME/USD 0 **no aparecen en el checkout mensual/anual COP**. Las cifras antiguas de referencia para Enterprise, planes anuales y licencia vitalicia **NO autorizan ventas nuevas**. Las licencias vitalicias siguen siendo asignadas exclusivamente y manualmente por el SuperAdmin, sin Wompi. No cambiar esos registros ni abrir el checkout de otras modalidades.

**Hallazgo resuelto para BASIC y PRO:** la fuente TypeScript y el fixture de precios se actualizan al último importe aprobado sin alterar la base de datos. La puerta G25 sigue exigiendo una nueva conciliación reciente y comprobación visual del checkout antes del primer pago real.

## 3. Puerta de lanzamiento G25 — fail closed

Antes de activar Wompi LIVE, el revisor autorizado debe:
1. Usar el último catálogo mensual autorizado **15-oct-2026** (BASIC 129.900, PRO 299.900); si aparecen nuevos planes vendibles o se modifica el precio, exigir nueva aprobación explícita.
2. Obtener el catálogo efectivamente vendible en la interfaz (planes activos `MONTHLY`/`ANNUAL` en COP): `code, billing_cycle, currency, price, max_users, max_properties, active`. Rechazar planes vendibles inesperados, importes o cupos distintos.
3. Canonizar ambas fuentes en líneas `code|billing_cycle|currency|price.00|max_users|max_properties|active`, ordenadas por `code,billing_cycle`, unidas con `\\n` (sin salto final), y calcular SHA-256 independiente. El digest vigente es `81136f80...`; se debe recalcular en cada liberación. La revisión de importes de checkout real por navegador es un control independiente.
4. Registrar en expediente privado `commercial.pricing_catalog` con `project_ref`, `commit_sha`, `verified_at` (24 h), `approved_catalog_sha256`, `live_catalog_sha256`, `superadmin_catalog_approval_verified=true`, `checkout_prices_checked_against_live=true`.
5. **No configurar estas banderas como verdaderas sin pruebas documentales auténticas**. Un hash escrito a mano o un unit test sintético NO equivale a comprobación de producción.

El script `scripts/release-readiness.mjs` rechaza lanzamiento comercial si falta cualquiera de estos controles. El repositorio no almacena capturas sensibles ni datos de cobros reales. No cambia el bloqueo de los demás controles G07/G12/G16/G18/G24.

## 4. Verificación en producción sin escritura

Consultar `public.plans` de forma read-only con la API autorizada, nunca con credenciales expuestas al frontend. La comparación se restringe a los planes de compra pública: **no es una instrucción para actualizar la base de datos**:

```sql
SELECT code, billing_cycle, currency, price, max_users, max_properties, active
FROM public.plans
WHERE active = true AND billing_cycle IN ('MONTHLY', 'ANNUAL') AND currency = 'COP'
ORDER BY code, billing_cycle;
```

El operador debe conservar registro del commit, fecha, método de extracción y revisión de checkout Wompi. Mantener cobros reales cerrados si los valores no coinciden.
