# G10 — gestión central de miembros (preparación controlada)

**Objetivo.** En el panel SuperAdmin, listar miembros, roles y estados por inmobiliaria; suspender o reactivar sin borrar identidades, contratos, auditorías o cobros.

**Orden obligatorio de despliegue:** (1) validar SQL en el clon con ROLLBACK y roles simulados; (2) validar CI de frontend; (3) instalar SOLO el SQL revisado con migración controlada e inspección de privilegios; (4) comprobar RPC en producción sin mutar datos; (5) publicar UI y verificar con sesión real. NO usar `supabase db push` hasta reconciliar #104.

**Controles:**
- Las RPC exigen `public.is_platform_admin()` en PostgreSQL y `auth.uid()` válido. Cero EXECUTE anónimo.
- Consulta paginada (máximo 100 por página), exclusivamente para la organización solicitada; nombre visible y roles, sin correo, teléfono ni datos financieros.
- Actualización de estado conserva el historial; impide modificar al SuperAdmin o al último propietario activo; serializa cambios desde la RPC.
- Cada cambio requiere motivo de 10–500 caracteres y crea evento en `audit_log` en la misma transacción. Una falla de auditoría revierte todo.
- Los límites de asientos/licencias existentes siguen sujetos al trigger `enforce_internal_seat_limit`. No se emiten licencias desde aquí.
- Las pruebas unitarias del repositorio son guardas estructurales, NO reemplazan JWT/HTTP y concurrencia reales.

**Reversión:** retirar el control de la UI mediante rollback de commit. Si fuera necesario retirar las RPC, revocar EXECUTE a `authenticated` y comprobar inexistencia de consumidores; nunca revertir datos de membresía mediante actualización masiva.

**Pendiente para certificación G10:** prueba con cinco sesiones reales en dos inmobiliarias, concurrente de dos suspensiones del último propietario, restauración/rollback y supervisión de auditores. La inmobiliaria del SuperAdmin queda fuera de todas las mutaciones de QA.
