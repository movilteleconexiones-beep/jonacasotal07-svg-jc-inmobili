# Auditoría de permisos de RPC privilegiadas — INMOJCO

## Alcance

Revisión **de solo lectura** del proyecto activo de Supabase
`cuitgyqrjibgwuniapmk` (30 de octubre de 2026). No se descargaron datos
personales ni se alteraron cuentas, contratos, cobros o autorizaciones.

### Resultados obtenidos con `pg_catalog`

| Comprobación | Resultado |
| --- | ---: |
| Funciones `SECURITY DEFINER` del esquema `public` | 83 |
| Ejecutables por `anon` (sin iniciar sesión) | 4 |
| Ejecutables por `authenticated` | 62 |
| Funciones elevadas sin `search_path` configurado | 0 |
| Funciones elevadas con `EXECUTE` implícito a `PUBLIC` | 0 |
| `anon` con permiso `CREATE` en `public` | No |
| `authenticated` con permiso `CREATE` en `public` | No |

Las únicas cuatro RPC públicas intencionales, y sus firmas permitidas,
son las relacionadas con las portadas y formularios:

- `get_public_property_intake_site(text)`: consulta del micrositio de consignación.
- `submit_property_consignment(text,uuid,jsonb)`: envío público de consignación.
- `submit_public_website_lead(text,text,text,text,text,text,boolean,text)`:
  contacto desde una portada pública, con consentimiento.
- `tenant_public_catalog(text)`: catálogo y marca de cada inmobiliaria.

**No revocar automáticamente `EXECUTE` de estas cuatro RPC**: son entradas
públicas intencionales y hacerlo rompería las consultas y formularios.

La función `create_organization_with_owner(text,text)` también se ejecuta
con privilegios elevados desde `authenticated`, pero delega al procedimiento
de tres argumentos, que verifica `auth.uid()`. Por tanto, no debe tratarse
como vulnerabilidad solo porque el wrapper no contiene un chequeo directo.

Los 62 procedimientos accesibles a usuarios autenticados requieren revisión
continua de **autorización interna** (`auth.uid()`, rol, tenant y permiso
específico) por operación; un ACL correcto por sí solo no prueba que sus
acciones estén totalmente aisladas.

### Barrera de regresión para nuevas RPC

`security/reviews/public_rpc_exposure_gate.sql` ejecuta un control
**exclusivamente de lectura** sobre el catálogo PostgreSQL. Rechaza:

1. Cualquier RPC adicional `SECURITY DEFINER` accesible por `anon`,
   incluida una sobrecarga no autorizada de un nombre existente.
2. `EXECUTE` a `PUBLIC` por defecto, incluso en las cuatro RPC permitidas;
   el acceso anónimo debe ser explícito.
3. `SECURITY DEFINER` en `public` sin `search_path` configurado.
4. Permisos `CREATE` concedidos a `anon` o `authenticated` en `public`.
5. Desaparición o incremento inesperado de las cuatro entradas anónimas.

La CI ejecuta el control en una **base PostgreSQL 17 efímera con datos
ficticios** y prueba intencionalmente cuatro variantes de escalada de
privilegios, que deben fallar. La CI no se conecta a Supabase de producción.

Para verificar los permisos reales desde un cliente autorizado, el operador
puede ejecutar este SQL de revisión desde el panel SQL de Supabase o un
cliente con acceso de lectura. No contiene DDL, DML ni revocaciones.

### Pendiente de verificación funcional

Los cuatro avisos `rls_enabled_no_policy` en tablas privadas pueden ser
deliberados. No crear políticas permisivas para silenciar el advisor.

El aviso de Supabase Auth sobre contraseñas filtradas también queda pendiente
de revisión del plan y configuración **sin contratar servicios adicionales**.
No borrar índices solo por el aviso `unused_index`: incluir cargas reales
y consultas de FK en la evaluación.

- [Supabase Advisors](https://supabase.com/docs/guides/observability/advisors)
- [RPC y privilegios PostgreSQL](https://supabase.com/docs/guides/database/postgres/row-level-security)
