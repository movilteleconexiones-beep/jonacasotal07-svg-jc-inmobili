# INMOJCO — ensayo integral de restauración de paquete cifrado

**Fecha: 04-nov-2026 · Entorno de prueba: PostgreSQL 17 desechable · Producción: NO-GO.**

## Qué valida el ensayo

El proyecto ya contaba con pruebas independientes de:
1. Un `pg_dump` sintético que se cifra y recupera mediante
   `pg_restore` en otra base local.
2. Un paquete cifrado sintético de PostgreSQL y Storage cuyos bytes se
   pueden verificar y extraer.
3. Una verificación estricta del manifiesto y de su cobertura declarada.

El ensayo
[`tests/inmojco-backup-package-restore-e2e.test.mjs`](../../tests/inmojco-backup-package-restore-e2e.test.mjs)
**une esos tres controles en un solo flujo de extremo a extremo**, a
partir de la misma copia de datos ficticios:

1. Obtiene un `pg_dump --format=custom` real de PostgreSQL 17 del fixture
   `jco_backup_drill_source`, con dos organizaciones sintéticas,
   comprobantes inventados, FKs, índices y una política RLS de prueba.
2. Construye un paquete AES-256-GCM que incluye el dump, un PDF y una
   fotografía **ficticios**, su mapa de buckets/rutas y un manifiesto
   autenticado. No incluye documentos de clientes ni credenciales reales.
3. Inspecciona el catálogo PostgreSQL cifrado usando el comando
   `inspect` del programa de respaldo.
4. Introduce una alteración de un ciphertext privado y exige que
   `extract` falle, elimine cualquier extracción parcial y no deje
   `database.dump` ni `restore-map.json` en claro.
5. Recupera los bytes originales del fixture, ejecuta `verify` y
   `extract` y coteja los SHA-256 y bytes exactos del PDF, la
   fotografía y el dump con los archivos fuente del ensayo.
6. Crea una base **nueva y vacía** `jco_backup_package_restored` en
   el PostgreSQL desechable de CI. Nunca sobrescribe una existente.
   Ejecuta `pg_restore --single-transaction --exit-on-error`.
7. Comprueba en la base aislada los datos ficticios, dos
   organizaciones, FKs, RLS, políticas e índices. **Además, actúa
   bajo `SET LOCAL ROLE jco_restore_fixture_reader` (rol no dueño
   ni superusuario), y verifica que el `SELECT` restaurado conserve
   su `GRANT`, que con `app.organization_id=org-a` vea solo DOC-A,
   con `org-b` solo DOC-B y con un identificador ausente ningún
   documento**. Comprueba estos resultados también en el origen.
   Confirma que la base de origen no fue modificada y elimina el
   destino de prueba.

**Cambio con impacto de restauración:** el ensayo integral deja de
usar `pg_restore --no-privileges` para que la copia de los privilegios
y las políticas se pruebe, en lugar de dar por buena su existencia.
El rol ficticio de lectura se crea de forma explícita en el clúster
desechable de CI; esto **no** acredita que los roles de un proyecto
Supabase real sean portables a otro entorno sin preparación previa.

Todos los comandos PostgreSQL llevan explícitamente
`--host=localhost --username=postgres` con una contraseña fija
**únicamente para CI**. La prueba no toma la URL ni las claves del
Supabase productivo y nunca conecta contra PostgreSQL remoto.

La integración se exige en el paso existente de CI
`Encrypted INMOJCO database and private Storage offline backup verification`,
que continúa probando la criptografía y los fixtures previos.

## Lo que NO demuestra

**Una CI verde no demuestra que existe un backup auténtico restaurable
de INMOJCO.** El paquete, los archivos y los usuarios usados por esta
prueba son ficticios. La política RLS del fixture ahora prueba **acceso efectivo por
organización** de una cuenta ficticia tras restaurar, no solo presencia
de políticas en el catálogo; **sigue sin sustituir la validación de
aislamiento multi-inmobiliaria con el modelo auténtico de producción**.

Tampoco prueba una copia íntegra de Storage con sus permisos originales,
coherencia temporal entre las operaciones de PostgreSQL y Storage,
configuración de Auth y Railway, DNS, secretos externos, o que
`pg_dump` incluya todos los roles necesarios para el restore
en un Supabase remoto administrado.

Para cerrar #214 sigue siendo obligatorio obtener **una copia privada
real y cifrada fuera de GitHub**, restaurar PostgreSQL y todos los
objetos privados en un staging recuperable, cotejar cantidades y hashes,
probar roles y flujos de negocio, y registrar evidencia verificable.
Los bloqueos #104 y #203 también siguen abiertos; no ejecutar
`supabase db push` ni `migration repair` en producción.

**No fusionar el PR #285, desplegar Railway, activar Wompi real ni
contratar servicios adicionales por la aprobación de esta prueba.**
