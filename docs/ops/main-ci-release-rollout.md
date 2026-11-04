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

## Secuencia segura para activar el control

1. Verificar el CI verde del PR mínimo que contiene este documento y el
   nuevo trigger. No mezclar en él migrations, propuestas financieras ni
   cambios a `src`. Mantener separado del PR de seguridad #285.
2. Antes de mezclar a main, **proteger la rama** en GitHub: impedir push
   directo y requerir la comprobación `Verify JCO application / validate`
   para PR; exigir rama actualizada y evitar bypass de administradores.
   Confirmar el nombre real del status con un PR verde.
3. Preparar un rollback del commit actual `main` y **usar la
   evidencia del respaldo auténtico ya acreditada en #214**; revisar
   únicamente la custodia/acceso del respaldo existente, sin volver a
   exportar ni volver a cifrar. En Railway, revisar ambos servicios y
   establecer `source.checkSuites=true` mediante cambio controlado, con
   comprobación de efectos y sin desplegar migraciones. No aplicar cambios
   staged adicionales ni cambios de variables en el mismo bloque.
4. Una vez verificados los pasos 2 y 3, fusionar **solo el PR mínimo de
   CI** y confirmar que el evento `push` de GitHub ejecuta el job
   `validate` sobre el SHA fusionado. Comprobar que el despliegue usa ese
   mismo SHA y espera su resultado. No asumir que la ejecución PR valida
   el SHA posterior al merge.
5. Prueba negativa en una **rama de pruebas sin afectar producción**:
   un fallo intencional del check no debe pasar a deployment. Validar
   las reglas de branch protection y el checkSuite de Railway mediante
   una comprobación verificable. Restaurar el cambio sintético.
6. Solo después, realizar un smoke test de portal y Wompi sandbox:
   navegación, roles, separación de inmobiliarias y webhook firmado de
   prueba. Para lanzar licencias reales siguen abiertos #104 y #203.

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
