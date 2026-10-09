# Tarifario aprobado JCO — preparación de despliegue

Tarifas COP aprobadas: Básico mensual 104900 / anual 1039000; Profesional mensual 194900 / anual 1949000; Empresarial mensual 389900 / anual 3899000; Vitalicio pago único 6490000.

Migración propuesta: `supabase/migrations/0029_approved_jco_cop_pricing_draft.sql`. **No ejecutada en Supabase oficial.** Conserva IDs existentes BASIC, PRO, ENTERPRISE, LIFETIME y crea tres códigos anuales; no toca suscripciones ni licencias. Usa `plans_code_key` (índice único confirmado en proyecto oficial).

## Bloqueos antes de habilitar checkout

1. **Decisión comercial aprobada:** los precios publicados son importes finales al cliente, con IVA incluido cuando corresponda; nunca sumar IVA por encima de estos valores. Determinar con asesoría tributaria la tarifa y tratamiento aplicables, y discriminar los impuestos correctamente en la factura. No asumir que todas las operaciones están gravadas al mismo tipo.
2. Revisar las capacidades y límites de cada plan contra funcionalidades realmente disponibles.
3. Verificar migraciones 0026–0028 en staging, ejecutar 0029 allí y probar Wompi Sandbox con monto exacto en centavos (por ejemplo 10490000 para Básico mensual).
4. Validar las transiciones de renovación y la asociación correcta de cada plan anual. Vitalicio siempre requiere aceptación legal y activación manual.
5. Aprobar explícitamente la migración de precios en producción tras comprobar suscripciones existentes, impacto comercial y rollback.

La migración no se ejecuta desde GitHub automáticamente y no constituye publicación del tarifario en la web.
