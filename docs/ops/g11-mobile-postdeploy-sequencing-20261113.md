# G11 — orden correcto de despliegue y prueba móvil estricta

Railway tiene `source.checkSuites=true` en la aplicación y en Wompi Sandbox. El commit de UI [#394](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/pull/394) SHA `20b029d8176ae43eb43e1d71ec9be4461b9e1baf` quedó en estado Railway `SKIPPED` **porque** el workflow de navegador `push/main` comprobó la web anterior aún sin desplegar, detectó el overflow histórico y reportó FAIL. Ese FAIL impidió el despliegue; no representa una regresión de la nueva compilación, que todavía no estaba viva.

## Secuencia corregida sin bajar protecciones

1. Mantener la CI normal `Verify JCO application` (required `validate`) y esperar SUCCESS en `main`.
2. Para la verificación móvil del PR usar Playwright real contra la web disponible con inyección CSS **solo PR** igual a la propuesta; mantener los asserts estáticos de fuente y tests de protección jurídica. No declarar esto como prueba del deploy.
3. Railway, configurado con `checkSuites=true`, solo después de CI verde instala el commit. Verificar `list_deployments` y `environment_status` de ambos servicios con SHA de `main` (no solo ONLINE genérico).
4. **Después de publicar la nueva versión**, ejecutar en Actions el workflow `G11 official mobile launch smoke (no PII)` con `workflow_dispatch`. El indicador `INMOJCO_PR_CSS_SIMULATION` es `0` para dispatch, por tanto debe comprobar la hoja de estilos **real**, DOM sin scroll y canonical por URL. Una alternativa equivalente es reejecutar el job estricto del push anterior `#43513423777` únicamente si GitHub permite un `rerun` posterior a despliegue, conservando registros claros.
5. Conservar prueba como guardia independiente de release; si falla, no certificar UI móvil. Nunca desactivar `checkSuites=true`, nunca usar claves LIVE ni registrar PII en logs.

Este cambio suprime el disparador `push` del **smoke dependiente del despliegue**, no elimina `validate`, ni sus controles de seguridad. La prueba se mantiene en `pull_request` y `workflow_dispatch` con todos sus asserts. La ejecución estricta es una operación posterior al despliegue, con evidencia separada.

Estado técnico #203: **NO-GO** hasta cerrar puertas jurídicas, financieras y operativas restantes.
