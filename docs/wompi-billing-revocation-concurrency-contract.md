# INMOJCO — Autorización concurrente de órdenes Wompi sandbox

**Estado: candidato probado en PostgreSQL 17 desechable, SIN aplicar a Supabase.** La migración histórica `0032_atomic_sandbox_payment_order_draft.sql` sigue sin desplegarse y la autorización para Wompi real continúa bloqueada. La conciliación de versiones #104 y los controles comerciales #203 siguen siendo obligatorios.

## Modelo de serialización (candidato PR #284)

`security/candidates/billing_authorization_serialization.sql` utiliza un **bloqueo advisory transaccional global** de autorización, adquirido por el RPC de orden sandbox **antes** de leer organizaciones, permisos o miembros. Un disparador **BEFORE STATEMENT** adquiere exactamente el mismo bloqueo en `organizations`, `organization_members`, `member_permissions`, `member_roles`, `roles` y `role_permissions` para INSERT/UPDATE/DELETE. Esto protege también los escritores privilegiados que realizan DML sobre esas tablas mediante SQL o RPC.

El enfoque global evita que un rol compartido cambie permisos en dos inmobiliarias mientras se autorizan órdenes. **Compromiso:** serializa todas las escrituras a esas seis tablas y la creación de órdenes entre todas las organizaciones; no es una arquitectura escalable ilimitadamente. Revisar tiempos reales de espera, carga y un eventual diseño de bloqueo previo por tenant antes de incrementar volumen.

No confundir este candidato con la función productiva existente `jco_private.serialize_billing_authorization()`: usa disparadores de fila solo en tres tablas y NO constituye la solución completa a la carrera con `billing.manage`. Antes de cualquier despliegue, revisar migraciones, orden de disparadores, RLS y autores privilegiados.

## Evidencia reproducible en GitHub Actions (todos datos ficticios)

La suite reutiliza una base PostgreSQL 17 llamada `jco_billing_serialization_test`. Los scripts se niegan a ejecutar operaciones fuera de ese nombre. Ejecutar únicamente desde CI con fixture desechable; no copiar estas órdenes o usuarios a producción.

1. `security/tests/billing_order_serialization_fixture.sql` crea dos inmobiliarias ficticias, perfiles y precios COP controlados.
2. `security/tests/billing_order_serialization_assertions.sql` comprueba permisos de RPC, protección del catálogo y triggers a nivel **BEFORE STATEMENT**.
3. `security/tests/billing_order_revocation_concurrency.sh` valida `DENY`, revocaciones de roles, suspensión de usuarios/organizaciones, referencia única y orden transaccional entre compra/revocación.
4. `security/tests/billing_shared_role_concurrency.sh` simula un rol usado en dos inmobiliarias, revocación y compras simultáneas; ambas organizaciones deben dejar de autorizar nuevas órdenes.
5. `security/tests/billing_lock_timeout_and_load.sh` verifica error `55P03` con tiempo máximo, ausencia de inserción tras fallar, reintento con la misma referencia, rechazo del duplicado `23505` y 16 órdenes simultáneas en lotes de cuatro.

**Resultado comprobado:** commit `d61a5a68ebb707de338feda0df1a0e460877cf51`; `Verify JCO application` run **41431485666**, **completed/success, 173/173 pasos**; `Coordinator finance permissions isolated SQL` run **41431485607**, **completed/success**.

## Política requerida para el cliente de pagos

- Cada intento lógico de compra usa una **referencia única y estable**, generada por el servidor o validada en el servidor. Si un cliente recibe `55P03`, `40P01` o `40001` y se sabe que la transacción abortó, podrá reintentar la operación completa con la **misma** referencia, con retroceso aleatorio y un máximo pequeño de intentos.
- Ante un timeout HTTP, desconexión u otra respuesta de resultado **desconocido**, NO crear automáticamente otra orden ni generar otra referencia: consultar el estado de la referencia en un endpoint autenticado y limitado a la misma inmobiliaria, o informar que está pendiente de verificación.
- No repetir operaciones sin límites; una denegación `42501` no es reintentable automáticamente. Un duplicado `23505` exige recuperar/consultar la orden de esa referencia y verificar organización y datos antes de reutilizarla; jamás tratar el error como autorización de pago.
- Una orden en estado `PENDING`, un retorno del navegador o un número de transacción **no prueban pago**. Solo el backend confiable puede verificar notificación, firma e importe y activar licencias.
- Todo error final debe conservar trazabilidad del intento y no almacenar credenciales o payloads privados en logs.

## Controles aún NO-GO para publicar

Validar en una **rama Supabase staging auténtica** y con un usuario de cada rol; auditar flujos de ejecución de RPCs antiguos, operaciones de varios pasos que obtengan otros bloqueos antes de entrar al disparador, uso de `TRUNCATE`/migraciones administrativas, reintentos y latencia bajo tráfico real; revisar cambios de esquema y RLS/ACL contra #104. La solución candidata NO se fusiona, no habilita checkout público y no sustituye estos controles.
