# G24/G25 — RUT no responsable de IVA y conciliación de precios LIVE

Fecha de inspección técnica: **22 de noviembre de 2026** (Colombia).

## 1. Responsabilidad IVA del vendedor SaaS — comprobada

El RUT actualizado del vendedor persona natural, expedido el **20/11/2026**, muestra responsabilidad **49: no responsable del IVA**. Este código se registra como evidencia fiscal privada; **no subir el RUT, su imagen, número de formulario ni datos privados a GitHub**.

- En la comunicación comercial correspondiente a 2026 se informa la condición tributaria vigente del vendedor.
- **No adicionar IVA** ni mostrar un desglose ficticio del 19 % a los precios mientras la condición 49 sea aplicable.
- El total presentado debe coincidir exactamente con el valor total de la orden generada por el backend; el navegador no determina importes ni tarifas.
- **No responsable de IVA NO demuestra por sí solo que esté exceptuado de expedir factura**. La DIAN establece condiciones independientes para esta obligación: véase su concepto de 2026 https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_8208_2026.htm y requisitos https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx.
- Si la situación tributaria cambia, revisar código, precios, comunicaciones y facturación antes de hacer nuevos cobros. A partir de 2027 el módulo de precios exige configuración tributaria explícita; no inventar IVA.

## 2. Nueva decisión expresa del vendedor y catálogo de producción actualizado (G25)

El **22 de noviembre de 2026**, el único vendedor y SuperAdmin autorizó los nuevos importes mensuales, sustituyendo los aprobados previamente (15-oct-2026). La decisión responde a que el producto incluirá más procesos operativos. No interpretar el cambio como IVA: el titular conserva la responsabilidad 49 del RUT.

| Plan | Precio mensual aprobado **22-nov-2026** | Precio en Supabase PROD tras la actualización | Capacidad | Resultado |
|---|---:|---:|---|---|
| BÁSICO | COP **149.900** | COP **149.900** / MONTHLY | 5 usuarios, 200 inmuebles | Coincide |
| PROFESIONAL | COP **349.900** | COP **349.900** / MONTHLY | 25 usuarios, 2.000 inmuebles | Coincide |

### Aplicación controlada en Supabase PROD

La actualización transaccional directa se aplicó únicamente a dos filas de `public.plans` con coincidencia exacta de precios anteriores, capacidad, ciclo `MONTHLY`, moneda COP y estado activo. Antes de aplicar se comprobaron **0 pedidos de producción pendientes/no vencidos**; los ocho pedidos BASIC anteriores eran exclusivamente Sandbox, con importe histórico 129.900 (1 aprobado y 7 pendientes pero vencidos). Una suscripción BASIC histórica se conservó intacta. No se modificó ningún pedido, su importe ni su estado, ni las suscripciones, licencias, cupos o permisos de los planes.

Después del `COMMIT`, la consulta de las dos filas confirmó importes y capacidades exactas. Wompi LIVE permaneció desactivado durante toda la operación.

### Identidad canónica del catálogo actualmente vendible

El checkout solo ofrece planes activos `MONTHLY` o `ANNUAL` denominados en COP; en producción ahora existen dos planes con esas características. El texto UTF-8 exacto, **sin salto de línea final**, de las filas ordenadas por `code,billing_cycle` es:

```text
BASIC|MONTHLY|COP|149900.00|5|200|true
PRO|MONTHLY|COP|349900.00|25|2000|true
```

**SHA-256 calculado directamente en PostgreSQL productivo:** `51ae873f180c1a5cb05de659106771edfae0b994f85fde271d4c23441d8bee46`.

`ENTERPRISE` está configurado como CUSTOM/USD 0 y `LIFETIME` como ONE_TIME/USD 0 y **no aparecen en el checkout mensual/anual COP**; los planes anuales tampoco tienen filas activas. Los importes de referencia históricos para esos productos no autorizan un cobro nuevo. La licencia vitalicia se concede manualmente por el SuperAdmin, sin Wompi, y no se modifica por esta decisión.

**Para cerrar G25:** repetir la comparación reciente en checkout real y documentar el hash del catálogo tal como lo aprobó el SuperAdmin. La autorización de los nuevos precios está registrada en la conversación del 22-nov-2026; no se deben simular comprobaciones de navegador que todavía no se hayan ejecutado.

## 3. Puerta de lanzamiento G25 — fail closed

Antes de activar Wompi LIVE, el revisor autorizado debe:
1. Usar el último catálogo mensual autorizado **22-nov-2026** (BASIC 149.900, PRO 349.900); si aparecen nuevos planes vendibles o se modifica el precio de nuevo, exigir nueva aprobación explícita.
2. Obtener el catálogo efectivamente vendible en la interfaz (planes activos `MONTHLY`/`ANNUAL` en COP): `code, billing_cycle, currency, price, max_users, max_properties, active`. Rechazar planes vendibles inesperados, importes o cupos distintos.
3. Canonizar ambas fuentes en líneas `code|billing_cycle|currency|price.00|max_users|max_properties|active`, ordenadas por `code,billing_cycle`, unidas con `\\n` (sin salto final), y calcular SHA-256 independiente. El digest vigente es `51ae873f...`; se debe recalcular en cada liberación. La revisión de importes de checkout real por navegador es un control independiente.
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
