# INMOJCO #104 — Cuerpos SQL auténticos de los dos preflights de consignación

**Fuente:** proyecto Supabase activo `cuitgyqrjibgwuniapmk`, `supabase_migrations.schema_migrations.statements[1]`, lectura SELECT el 05-nov-2026. No hay datos de clientes, contraseñas ni claves en las dos instantáneas.

| Versión aplicada | Nombre | Bytes UTF-8 | SHA-256 |
| --- | --- | ---: | --- |
| `20261010232928` | `property_consignment_intake` | 1530 | `bc214b1e2916dfc03b6a3b5e473fe95783ec8467b2d066038779b344c461cfe4` |
| `20261010232930` | `fix_property_portal_rls_recursion` | 630 | `a32ec2b778504318231c2ae7920183eb3be94d7f5b08601e105d78c39d3430ce` |

Los originales se encuentran sin normalizar en `docs/ops/snapshots/` con sufijo `.applied-preflight.sql`. Son **evidencia de lo registrado**, no migraciones nuevas ejecutables. CI `tests/consignment-applied-preflight-provenance.test.mjs` fija bytes, SHA256 y las condiciones originales.

## Interpretación comprobable

La versión `20261010232928` ejecutó un bloque `DO $$ BEGIN` que exigía previamente **ambas tablas** (`private.property_intake_sites`, `public.property_consignments`), los tres RPC de admisión y revisión, RLS, controles de privilegios de anónimos, la política de revisión y los seis índices de consignación. Finaliza con notificación de recarga de esquema `NOTIFY pgrst`.

La versión `20261010232930` también es un bloque `DO`: exige la función `private.can_read_portal_property(uuid,uuid)`, la política `properties_select_portal_related`, la política `ownerships_select_portal_owner` y que `anon` no tenga permiso `EXECUTE` sobre esa función. También notifica recarga de esquema.

**Ninguno de los cuerpos originales contiene `CREATE TABLE` ni `CREATE FUNCTION`.** Los dos son verificadores de prerrequisitos: confirman que los objetos existían cuando la comprobación terminó satisfactoriamente, pero no prueban quién ejecutó ni bajo qué migración se creó cada objeto. La existencia actual y la equivalencia física local fueron verificadas por el PR #302 en una base PostgreSQL 17 efímera, no en una restauración histórica integral.

## NO-GO mantenido

Una migración de preflight y un DDL local idéntico a la forma física NO equivalen a la cronología exacta de las 99 versiones aplicadas ni autorizan `migration repair`, `db push`, restaurar políticas históricas, conceder permisos adicionales o activar pagos reales. Quedan pendientes la conciliación general del historial y un ensayo de restauración integral PostgreSQL 17 con respaldo auténtico.

**Consulta de reproducibilidad, solo lectura:**

```sql
SELECT version, name, octet_length(statements[1]) AS bytes,
  encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') AS sha256,
  statements[1] AS sql_body
FROM supabase_migrations.schema_migrations
WHERE version IN ('20261010232928', '20261010232930')
ORDER BY version;
```
