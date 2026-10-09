# Tarifario aprobado JCO — preparación de despliegue

Tarifas COP aprobadas: Básico mensual 104900 / anual 1039000; Profesional mensual 194900 / anual 1949000; Empresarial mensual 389900 / anual 3899000; Vitalicio pago único 6490000.

Migración propuesta: `supabase/migrations/0029_approved_jco_cop_pricing_draft.sql`. **No ejecutada en Supabase oficial.** Conserva IDs existentes BASIC, PRO, ENTERPRISE, LIFETIME y crea tres códigos anuales; no toca suscripciones ni licencias. Usa `plans_code_key` (índice único confirmado en proyecto oficial).

## Bloqueos antes de habilitar checkout

1. **Política comercial aprobada, sujeta a revisión tributaria y contractual:** hasta el 31 de diciembre de 2026 los precios publicados son importes finales con IVA incluido cuando corresponda. Desde el 1 de enero de 2027 la intención es conservar esos importes como precios base y adicionar al cliente el IVA legalmente aplicable. El cambio NO significa exención de IVA en 2026: debe liquidarse y facturarse correctamente en cada período. Antes de implementar el cambio se debe validar con asesor tributario el tratamiento de cada operación, revisar condiciones de suscripciones vigentes, comunicar previamente a clientes y configurar el cálculo de impuestos en el checkout y facturación. No modificar cobros existentes ni activar un recargo automático solo por esta documentación.
2. Revisar las capacidades y límites de cada plan contra funcionalidades realmente disponibles.
3. Verificar migraciones 0026–0028 en staging, ejecutar 0029 allí y probar Wompi Sandbox con monto exacto en centavos (por ejemplo 10490000 para Básico mensual).
4. Validar las transiciones de renovación y la asociación correcta de cada plan anual. Vitalicio siempre requiere aceptación legal y activación manual.
5. Aprobar explícitamente la migración de precios en producción tras comprobar suscripciones existentes, impacto comercial y rollback.

La migración no se ejecuta desde GitHub automáticamente y no constituye publicación del tarifario en la web.
