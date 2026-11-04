# INMOJCO #203 — RPC privilegiadas: auditoría de exposición y privilegios (04-nov-2026)

**Estado:** catálogo productivo revisado mediante SQL exclusivamente `SELECT`.
**NO-GO comercial** aún vigente; este cambio no ejecuta ninguna revocación ni DDL.

## Hallazgo comprobado

El asesor de seguridad Supabase informó cuatro RPC `SECURITY DEFINER`
ejecutables por `anon` y 62 por `authenticated`. Un aviso del asesor
**no constituye por sí solo una vulnerabilidad confirmada**.
La superficie pública intencional es:

| RPC anónima | Uso autorizado |
| --- | --- |
| `get_public_property_intake_site(p_slug text)` | Configuración de la captación pública |
| `submit_property_consignment(p_site_slug text, p_request_id uuid, p_payload jsonb)` | Solicitud pública de consignación |
| `submit_public_website_lead(p_slug text, p_name text, p_email text, p_phone text, p_service text, p_message text, p_consent boolean, p_trap text)` | Consulta comercial y consentimiento |
| `tenant_public_catalog(tenant_slug text)` | Catálogo filtrado de inmuebles |

**Lectura real de `pg_catalog` (04-nov-2026):** cuatro RPC anónimas
coinciden exactamente con sus firmas aprobadas, cada una utiliza una
única asignación de `search_path=""`, y no hay otras RPC
`SECURITY DEFINER` ejecutables por `anon` en `public`.
Los roles `anon` y `authenticated` tienen `USAGE`, pero
**no `CREATE`** sobre el esquema `public`.

También se observaron 83 funciones `SECURITY DEFINER` en `public`
(62 ejecutables por `authenticated`); varias tienen rutas
`search_path=public` o `pg_catalog, public, auth`. **No concluir
explotación** por la ruta sin revisar cada cuerpo, permisos y contexto.
La siguiente auditoría debe priorizar las funciones expuestas con
`search_path=public`, sin alterar indiscriminadamente las 62 RPC.

## Protección añadida en la rama, no desplegada

- `security/checks/public_definer_exposure_preflight.sql`: consulta
  agregada de **6 comprobaciones** (identidades, faltantes, funciones
  anónimas adicionales, configuración de búsqueda, `CREATE` de esquema,
  y rutas de búsqueda duplicadas o ausentes). Solo `pg_catalog`.
- **Resultado real:** 6/6 `OK`; no existe modificación de roles,
  políticas, funciones o registros.
- `tests/public-definer-exposure-preflight.test.mjs`: prueba de contrato
  estática, incluidas mutaciones negativas del archivo SQL. No sustituye
  Auth/PostgREST E2E ni prueba que las cuatro RPC sean seguras por dentro.
- Integración en CI del PR #285 con
  `node --test tests/public-definer-exposure-preflight.test.mjs`.

## Reglas para publicación y seguimiento

1. Mantener las cuatro RPC públicas necesarias para el portal. No aplicar
   `REVOKE EXECUTE` global: rompería captación y catálogo.
2. Antes de cualquier cambio de `search_path`, inspeccionar funciones
   con SQL no cualificado y probarlas con usuarios ficticios en staging.
3. Comprobar que `anon`/`authenticated` no ganen `CREATE` en
   `public`, y que una nueva RPC privilegiada requiera revisión expresa.
4. Conservar el estado **NO-GO** de #104/#203 y no hacer
   `migration repair`, `db push`, merge, deploy ni activar pagos reales.

El asesor Supabase ofrece referencias de remediación para
[SECURITY DEFINER anónimo](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
y [SECURITY DEFINER autenticado](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
