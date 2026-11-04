# INMOJCO — CI obligatorio en main y publicación condicionada

**Estado al 3 de noviembre de 2026: NO-GO para publicación comercial.**

Este cambio únicamente prepara las verificaciones en GitHub; **NO activa** la
publicación automática segura por sí solo, ni repara el historial de Supabase.

## Evidencia de los controles actuales (lectura de conectores)

- Repositorio `movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili`:
  la rama **main no está protegida** (GitHub indica `protected=false`).
- Los servicios Railway `jonacasotal07-svg-jc-inmobili` y
  `inmojco-wompi-sandbox` siguen `source.branch=main` y
  `source.checkSuites=false`; la configuración activa no tiene un
  bloqueo de desplegar por fallo de CI.
- La suite `Verify JCO application / validate` anteriormente solo se
  iniciaba para PR a main o `workflow_dispatch`; este PR independiente
  añade `push: branches: [main]` para validar **también** el SHA real de
  un merge o commit directo. **No confundir ejecución con obligatoriedad**.
- **No confundir reglas GitHub:** el ruleset de respaldo histórico
  `#26351160` está **activo**, cubre `backup/*` y `backup/**/*`,
  impide update/deletion/force-push sin bypass y la rama
  `backup/inmojco-2026-10-27-verificado` sigue protegida con SHA
  `28c6b1377359852f76ea2f8c53f58b3bfac568b2`
  (verificado por GitHub API 04-nov). **Eso no protege `main`**,
  cuya consulta `protected=false` es independiente.
- **Respaldo real ya existe:** #214 documenta
  `inmojco_2026-11-01.dump`, copia cifrada a USB, restauración
  estructural local Auth/Storage SQL y extracción de 6/6 objetos privados
  (932.740 bytes, SHA-256 iguales al manifiesto). No repetir
  exportación/cifrado/USB. La **fase 2 de copia independiente del
  código** también quedó completada el 02-nov (ZIP `main` 532
  archivos y ZIP histórico 438 archivos, guardados/leídos en USB).
  GitHub registra el issue **#214 CLOSED/completed**. Las pruebas de
  servicio Auth/Storage aislado siguen como parte funcional #203,
  no como una nueva tarea de respaldo.
- La reconciliación histórica de migraciones **#104** sigue abierta, de
  modo que no ejecutar `supabase db push`, `supabase migration repair`,
  ni introducir DDL de producción por este ajuste.
- Wompi debe permanecer en **sandbox**; no habilitar cobro real durante
  estas pruebas, ni crear recursos con costo.

## Secuencia segura para activar el control (Railway, documentación oficial)

**DEPENDENCIA QUE NO DEBE OMITIRSE:** Railway únicamente ofrece
`Wait for CI` cuando el repositorio ya tiene un workflow en la
rama conectada que escucha `on: push: branches: [main]`.
Actualmente el workflow de `main` solo escucha PR / ejecución manual;
la condición `push` está preparada **únicamente en este PR #286**.
Por eso es posible que el interruptor **no aparezca todavía** en
los dos servicios Railway. No intentar remediarlo reconectando el
repositorio: `connect-service-source` puede construir/desplegar
inmediatamente. Fuente: https://docs.railway.com/deployments/github-autodeploys

Orden obligatorio **sin ventanas de despliegue sin CI**:

1. **Aprobar CI mínima:** este PR #286 solo modifica tres archivos de
   CI/contrato/runbook. Comprobar `validate` verde emitido por la app
   `github-actions`; no mezclarlo con el PR #285 ni con migraciones.
2. **GitHub ADMIN — proteger `main` antes de fusionar:**
   `Settings → Rules → Rulesets` (o Branches/Branch protection).
   Aplicar a `main`, exigir PR y status `validate` de GitHub Actions,
   bloquear force-push y borrado, exigir rama actualizada, no permitir
   bypass. La UI muestra `Verify JCO application / validate`; el
   contexto de API es `validate` de `github-actions` (`app.id=15368`).
   Verificar por GitHub API que `main.protected=true` y check requerido.
3. **Railway ADMIN — CONGELAR ambos autodeploys antes de fusionar:**
   para el portal `a1d375e9-e457-4d23-bfdf-11f175f5db75` y
   Wompi sandbox `43835f59-e9a7-4bb6-a487-e8a409f689bc`, ir a
   `Service → Settings → Source → Disable automatic deployments`.
   Verificar en ambos que un push a `main` **no puede provocar
   autodeploy**. Si uno no puede deshabilitarse o el estado es incierto,
   **DETENERSE sin hacer merge**. No desconectar fuentes, no pausar
   procesos vivos ni crear servicios adicionales.
4. **Solo con pasos 2 y 3 acreditados**, fusionar **exclusivamente**
   PR #286 (tres archivos de CI). Mantener los autodeploys apagados
   durante el cambio de `main`; comprobar CI `push: main` ejecutado
   para el nuevo SHA y resultado `validate=success`. Comprobar que
   Railway **no** haya creado despliegues nuevos durante el merge.
   Si GitHub rechaza el merge por protección legítima, revisar el
   check requerido; nunca desactivar la regla para sortearlo.
5. **Railway ADMIN — activar `Wait for CI` en AMBOS servicios:**
   tras la existencia del workflow `push: main` en `main`,
   habilitar `Service → Settings → Source → Wait for CI` y comprobar
   `source.checkSuites=true` en portal y Wompi sandbox mediante el
   conector. Aceptar permisos actualizados de la aplicación GitHub
   de Railway si el panel los requiere. Mantener autodeploy desactivado.
   **Si la opción no aparece o falla en un servicio, detenerse:
   mantener ambos autodeploys apagados.**
6. **Restablecer autodeploys solo tras la verificación doble:**
   confirmar `main.protected=true`, check requerido `validate`,
   CI verde sobre SHA real y `checkSuites=true` en ambos servicios;
   comprobar `staged=null`, último deployment sano, Wompi en sandbox.
   Habilitar de nuevo el trigger automático en ambos y observar
   cualquier deployment que la UI pudiera disparar al reactivarlo;
   este paso necesita verificación operativa y capacidad de rollback.
7. **Prueba negativa sin datos productivos:** una rama/PR ficticio con
   `validate` fallido no puede fusionarse en `main`. Para comprobar
   la espera real de Railway, usar entorno independiente o un commit
   inocuo cuya CI pase; **no introducir fallos intencionales en
   `main` del servicio en producción** ni reemplazar el Wompi sandbox
   operativo por una simulación. Verificar conclusiones `WAITING`,
   `SKIPPED` y `SUCCESS` contra el SHA exacto y documentar rollback.
8. Solo después, smoke tests de portal HTTPS, roles, aislamiento de
   dos inmobiliarias, Wompi sandbox firmado y rutas de renovación.
   #104/#203 y protección de Auth siguen pendientes: **NO-GO** para
   `supabase db push`, `migration repair`, migraciones financieras,
   activar Wompi real o vender licencias.

**Importante sobre Railway:** `Wait for CI` evalúa las conclusiones de
las **suites de GitHub Actions** del SHA, no todos los checks individuales
ni apps externas; suites fallidas bloquean, pero algunas canceladas
pueden ignorarse si hay otra exitosa. Un control crítico de ejecución
obligatoria no debe depender únicamente de `Wait for CI`:
se exige además el check `validate` obligatorio en GitHub `main`.
La primera incorporación de este workflow se hace **con autodeploy
desactivado**, precisamente para eliminar ese intervalo de riesgo.

## Política de fallo cerrado

CI verde significa que las pruebas versionadas pasaron; **NO** demuestra
por sí solo autorización para `migration repair`, `db push`, nuevas
licencias de pago, integridad del backup ni equivalencia total de RLS.
Mantener el estado global NO-GO hasta cerrar oficialmente #104/#203.

Si Railway no puede impedir que un commit no validado llegue a producción,
no mezclar cambios funcionales ni migraciones; documentar el bloqueo.
Todo cambio de protección de rama o de configuración Railway requiere
verificación independiente de que el estado activo coincide con el
solicitado; editar solo los archivos de CI no cambia esa configuración.

**Este PR no debe fusionarse hasta completar la preparación de los gates
externos de la secuencia segura.**
