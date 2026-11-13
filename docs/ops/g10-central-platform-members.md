# G10 — gestión central de miembros (preparación controlada)

**Objetivo.** En el panel SuperAdmin, listar miembros, roles y estados por inmobiliaria; suspender o reactivar sin borrar identidades, contratos, auditorías o cobros.

**Despliegue verificado 13-nov-2026:** (1) SQL instalado en clon dentro de BEGIN/ROLLBACK; prueba de cuenta ficticia y auditoría PASS, guardia último propietario PASS, sin residuos Auth; (2) CI #43499806403 SUCCESS; (3) aplicada exclusivamente migración 20261113201924 en Supabase oficial; (4) verificado el RPC desde sesión autenticada simulada en producción con transacción READ ONLY, sin modificar membresías. (5) UI pendiente de merge/despliegue y verificación con sesión real. NO usar `supabase db push` hasta reconciliar #104.

**Controles:**
- Las RPC exigen `public.is_platform_admin()` en PostgreSQL y `auth.uid()` válido. Cero EXECUTE anónimo.
- Consulta paginada (máximo 100 por página), exclusivamente para la organización solicitada; nombre visible y roles, sin correo, teléfono ni datos financieros.
- Actualización de estado conserva el historial; impide modificar al SuperAdmin o al último propietario activo; serializa cambios desde la RPC.
- Cada cambio requiere motivo de 10–500 caracteres y crea evento en `audit_log` en la misma transacción. Una falla de auditoría revierte todo.
- Los límites de asientos/licencias existentes siguen sujetos al trigger `enforce_internal_seat_limit`. No se emiten licencias desde aquí.
- Las pruebas unitarias del repositorio son guardas estructurales, NO reemplazan JWT/HTTP y concurrencia reales.

**Reversión:** retirar el control de la UI mediante rollback de commit. Si fuera necesario retirar las RPC, revocar EXECUTE a `authenticated` y comprobar inexistencia de consumidores; nunca revertir datos de membresía mediante actualización masiva.

**Pendiente para certificación G10:** prueba HTTP/browser de SuperAdmin y usuario de agencia con JWT auténtico, prueba de concurrencia de dos suspensiones del último propietario y supervisión posterior de auditorías. La inmobiliaria del SuperAdmin queda fuera de todas las mutaciones de QA. La inmobiliaria del SuperAdmin queda fuera de todas las mutaciones de QA.
