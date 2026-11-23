# G24/G25 — RUT no responsable de IVA y conciliación de precios LIVE

Fecha de inspección técnica: **22 de noviembre de 2026** (Colombia).

## 1. Responsabilidad IVA del vendedor SaaS — comprobada

El RUT actualizado del vendedor persona natural, expedido el **20/11/2026**, muestra responsabilidad **49: no responsable del IVA**. Este código se registra como evidencia fiscal privada; **no subir el RUT, su imagen, número de formulario ni datos privados a GitHub**.

- En la comunicación comercial correspondiente a 2026 se informa la condición tributaria vigente del vendedor.
- **No adicionar IVA** ni mostrar un desglose ficticio del 19 % a los precios mientras la condición 49 sea aplicable.
- El total presentado debe coincidir exactamente con el valor total de la orden generada por el backend; el navegador no determina importes ni tarifas.
- **No responsable de IVA NO demuestra por sí solo que esté exceptuado de expedir factura**. La DIAN establece condiciones independientes para esta obligación: véase su concepto de 2026 https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_8208_2026.htm y requisitos https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx.
- Si la situación tributaria cambia, revisar código, precios, comunicaciones y facturación antes de hacer nuevos cobros. A partir de 2027 el módulo de precios exige configuración tributaria explícita; no inventar IVA.

## 2. Hallazgo real de divergencia de catálogo (G25)

La comparación *read-only* de `public.plans` del proyecto Supabase productivo `cuitgyqrjibgwuniapmk`, efectuada el 22/11/2026, frente a `JCO_APPROVED_PRICES_COP` y `security/tests/pricing_catalog_assertions.sql` del repositorio, arrojó:

| Código | Precio de referencia en código | Precio/ciclo/currency **real** en Supabase | Hallazgo |
|---|---:|---|---|
| BASIC | COP 104.900 mensual | **COP 129.900 mensual** | Diferencia COP 25.000 |
| PRO | COP 194.900 mensual | **COP 299.900 mensual** | Diferencia COP 105.000 |
| ENTERPRISE | COP 389.900 mensual | USD 0 / CUSTOM | No es el mismo producto/precio |
| LIFETIME | COP 6.490.000 una vez | USD 0 / ONE_TIME | No cobrar esta modalidad desde este registro; el SuperAdmin conserva facultad manual independiente |
| BASIC_ANNUAL, PRO_ANNUAL, ENTERPRISE_ANNUAL | Precios anuales de referencia | **No figuran como planes activos en Supabase** | Requiere decisión comercial explícita |

**La diferencia NO es IVA**. No se ha inferido qué conjunto de cifras está aprobado hoy, ni se modificaron planes, pagos, periodos, licencias o el saldo de nadie. El checkout obtiene el precio de Supabase y no debe sobrescribirse con importes de referencia.

## 3. Puerta de lanzamiento G25 — fail closed

Antes de activar Wompi LIVE, el revisor autorizado debe:
1. Determinar **qué catálogo es el vigente y aprobado por el SuperAdmin**, incluidos alcance, capacidad y periodicidad. La existencia de constantes históricas no constituye aprobación actual.
2. Obtener del catálogo real de producción un listado read-only de `code, billing_cycle, currency, price, active`, y comparar cada fila con el catálogo autorizado, incluyendo ausencia/presencia de planes.
3. Canonizar ambos listados con exactamente el mismo esquema y calcular SHA-256 independiente de cada uno. Los dos hashes deben ser idénticos, junto con aprobación humana y comprobación del precio final de checkout.
4. Registrar en expediente privado `commercial.pricing_catalog` con `project_ref`, `commit_sha`, `verified_at` (24 h), `approved_catalog_sha256`, `live_catalog_sha256`, `superadmin_catalog_approval_verified=true`, `checkout_prices_checked_against_live=true`.
5. **No configurar estas banderas como verdaderas sin pruebas documentales auténticas**. Un hash escrito a mano o un unit test sintético NO equivale a comprobación de producción.

El script `scripts/release-readiness.mjs` rechaza lanzamiento comercial si falta cualquiera de estos controles. El repositorio no almacena capturas sensibles ni datos de cobros reales. No cambia el bloqueo de los demás controles G07/G12/G16/G18/G24.

## 4. Verificación en producción sin escritura

Consultar `public.plans` de forma read-only con la API autorizada, nunca con credenciales expuestas al frontend. El catálogo de referencia es solo un punto para la comparación, **no una instrucción para actualizar la base de datos**:

```sql
SELECT code, billing_cycle, currency, price, active
FROM public.plans
ORDER BY code, billing_cycle, currency;
```

El operador debe conservar registro del commit, fecha, método de extracción y revisión de checkout Wompi. Mantener cobros reales cerrados si los valores no coinciden.
