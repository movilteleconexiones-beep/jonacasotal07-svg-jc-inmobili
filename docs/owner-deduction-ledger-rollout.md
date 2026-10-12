# INMOJCO — Detalle de deducciones por propietario (STAGING)

## Contrato de negocio

Esta entrega prepara el registro individual de **gastos de cada liquidación de propietario** sin alterar los valores existentes ni simular transferencias.

- Cada renglón pertenece a una **inmobiliaria**, una **liquidación de propietario**, una fecha y un concepto.
- Conceptos: agua, energía, gas, aseo, administración, mantenimiento, reparaciones, seguros, impuestos, comisión inmobiliaria y otros.
- El responsable financiero se marca explícitamente: **OWNER**, **TENANT** o **AGENCY**. Solo las líneas aprobadas a cargo del OWNER afectan su conciliación. Un gasto que corresponde al inquilino nunca se deduce automáticamente del propietario.
- El monto debe ser positivo; las líneas empiezan como `DRAFT`; pueden aprobarse o anularse. Nadie puede sobrescribir un monto previamente creado, incluso en borrador: corrección mediante anulación justificada y creación de una nueva línea. Se conservan autor, fecha, aprobador, anulación y motivo.
- La tabla usa FK compuesta `(organization_id, statement_id)` y RLS con `owner_statements.view` y `owner_statements.create`; sin permisos DELETE para usuarios autenticados.
- Una liquidación `GENERATED` o `PAID` **no** recibe nuevas deducciones. Las mutaciones toman bloqueo de la liquidación padre para serializar el cambio con su finalización.
- Las comisiones y los impuestos ya figuran en `owner_statements.commission_amount` y `tax_amount`. Aunque tengan renglones de detalle, **no** se vuelven a restar dentro de `other_deductions`.
- Los importes se calculan por centavos de forma verificable. Se indican explícitamente situaciones `NO_DETAILS`, `PENDING`, `MISMATCH` y `RECONCILED`. Ninguno de estos estados acredita por sí solo un giro bancario.
- Para auditoría, `support_reference` identifica un soporte documental **sin crear un bucket público** ni exponer documentos de terceros. Queda pendiente conectar el flujo de documentos de la organización con acceso temporal.
- Los valores monetarios siempre deben utilizar una única moneda de contrato para el período. Hasta que el esquema registre la moneda del extracto, no deben agregarse extractos en monedas diferentes.
- Las distribuciones entre múltiples propietarios según `property_ownerships` requieren reglas de prorrateo y validación independientes. Esta entrega no modifica porcentajes ni liquida de oficio.

## Límite de la entrega

La migración **no está aplicada en producción**. Se valida primero con fixtures de PostgreSQL 17 aislados, datos cruzados entre dos inmobiliarias, permisos, estados, sellos de auditoría y borrado restringido.

La versión siguiente tendrá que ofrecer: interfaz para crear renglones con soporte, aprobación con autorización clara, conciliación explícita contra el resumen de la liquidación, captura del bruto realmente recaudado y eventual registro del pago a propietario con comprobante (no ejecución automática).

No se habilita Wompi para rentas, servicios públicos o giros: Wompi permanece reservado exclusivamente al cobro **centralizado de licencias INMOJCO**. Ningún permiso para revender software se concede por usar esta funcionalidad.

## Revisión obligatoria antes de producción

1. Confirmar que `owner_statements` y `organization_members` mantienen roles y RLS correctos en staging y en la versión efectiva de Supabase.
2. Ensayar compatibilidad con las consultas anidadas de Supabase/PostgREST y validar el impacto del índice único compuesto y los bloqueos.
3. Verificar la transición concurrente entre aprobación de deducciones y cambio de estado de la liquidación.
4. Comprobar tipos numéricos, cálculo en centavos y reporte de descuadres; nunca editar `net_amount` silenciosamente.
5. Desarrollar las operaciones de escritura con permisos exclusivos del módulo, vista previa y confirmación. Todas las mutaciones deben tener auditoría.
6. No fusionar esta migración hasta verificar también las relaciones comerciales pendientes de PR #90, para evitar cambios del esquema superpuestos sin control.
7. Proteger los dos accesos existentes: Panel inmobiliario + SuperAdmin en la misma sesión.
