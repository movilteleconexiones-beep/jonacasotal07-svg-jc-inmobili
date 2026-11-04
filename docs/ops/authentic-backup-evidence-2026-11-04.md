# INMOJCO — Evidencia del respaldo auténtico y pendientes REALES

**Actualizado: 04-nov-2026.** Fuentes: issue
[#214](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/214)
(**CLOSED/completed 02-nov-2026 a las 08:41:45Z** por la API de GitHub)
y cierre posterior de la conversación del propietario del 2-nov
sobre FASE 2 de código en USB. Este documento consolida evidencia
histórica real **sin** sustituirla por fixtures de CI.

## Trabajos ya realizados: NO repetir

| Área | Evidencia auténtica registrada | Estado |
| --- | --- | --- |
| PostgreSQL 17.11 | `inmojco_2026-11-01.dump` (1.012.341 bytes informados), código 0 de `pg_dump` y `pg_restore --list`, SHA-256 guardado, archivo 7zAES probado, copia USB con hash coincidente | **Backup auténtico creado y probado como archivo**; no equivale a restore funcional externo |
| Restauración local de Auth | PostgreSQL `127.0.0.1:5433`; 27 tablas, 24 FK, 16 RLS, dos usuarios Auth; 35 FK originalmente bloqueadas a `auth.users` ya reparadas; 0 FK no validadas reportadas | **Recuperación local estructural reportada** |
| Restauración local de Storage SQL | Ocho tablas, cinco FK, ocho RLS, seis objetos de metadatos; 0 FK no validadas | **Recuperación local SQL reportada**, no prueba una API Storage independiente |
| Bytes de Storage | `INMOJCO-STORAGE-2026-11-01.7z`: 7-Zip `Everything is Ok`; se extrajeron seis archivos, **932.740 bytes**, 6/6 SHA-256 iguales al manifiesto interno; temporales eliminados | **Recuperabilidad local de los seis bytes documentada**, no igualdad con hashes remotos ni un restore Storage API |
| Código independiente en USB | FASE 2 completada y verificada el 02-nov: ZIP `main` 532 archivos, ZIP histórico 438 archivos, lectura comprobada, usuario confirmó cierre de respaldo y retiró USB | **COMPLETADO según evidencia del propietario; no repetir** |
| Protección del respaldo en GitHub | Ruleset **#26351160**, `enforcement=active`; patrones `backup/*` y `backup/**/*`; reglas `update`, `deletion`, `non_fast_forward`, **sin bypass** | **Revalidado mediante GitHub API 04-nov**. Rama `backup/inmojco-2026-10-27-verificado` permanece SHA `28c6b1377359852f76ea2f8c53f58b3bfac568b2` y `protected=true` |

Referencias de origen en el issue:
- [Exportación auténtica y pruebas parciales (01-nov)](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/214#issuecomment-6559011050).
- [Recuperación Auth, Storage SQL y ruleset (02-nov)](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/214#issuecomment-6572638257).
- [Extracción cifrada de los seis archivos privados (02-nov)](https://github.com/movilteleconexiones-beep/jonacasotal07-svg-jc-inmobili/issues/214#issuecomment-6572695885).

**No solicitar ni iniciar otra exportación, copia USB del respaldo
ni del código, cifrado, restauración de Auth/Storage SQL, creación de
PK o reparación de las 35 FK**. La recuperación #214 ya se cerró. Ya hay evidencia específica
de dichas operaciones; repetirlas no cierra por sí solo el GO/NO-GO.

## Pendientes diferenciados, sin falsa regresión

1. **Copia independiente de código fuente — COMPLETADA:** la primera
   captura del 2-nov detenida al empezar la fase 2 era **parcial**.
   En el cierre posterior de esa misma conversación se documentó el
   resultado: dos ZIP en USB E: descargados y leídos, **532 archivos
   del SHA `main`** y **438 archivos del histórico `backup/**`**.
   El usuario confirmó finalizar y retirar la memoria USB. Es evidencia
   de la **ejecución local reportada por el operador**, no una lectura
   directa del USB mediante los conectores. No repetir la fase 2.
2. **Recuperación funcional de sistema completo:** la estructura
   PostgreSQL Auth/Storage y los seis bytes se recuperaron localmente,
   pero sigue sin acreditarse un **ensayo integral en servicios Auth
   y Storage aislados**, inicio de sesión, acceso a archivos mediante
   API, RLS real entre dos inmobiliarias y contrato funcional completo.
   Estas son pruebas de salida a mercado **#203**, no motivo para
   repetir el respaldo cifrado ya validado.
3. **Migraciones #104:** 99 versiones aplicadas vs 109 archivos
   locales; 91 cuerpos byte-idénticos, 4 divergencias de solo formato
   con evidencia y **4 casos históricos sustantivos sin resolver**.
   No hacer `supabase db push` ni `migration repair`.
4. **Protecciones de publicación diferentes de backup/**: GitHub
   `main.protected=false` (consulta actual), los servicios Railway
   siguen con `source.checkSuites=false`; PR #286 prepara el evento
   `push: main` pero no puede asegurar el gate externo por sí solo.
   **No confundir ruleset de `backup/**` (activo) con protección de
   `main` (pendiente).**
5. **Pago:** Wompi sigue en sandbox. No usar pago real, activar
   licencias de cliente ni fusionar migraciones hasta cerrar #203/#104.

## Diferenciar evidencia por clase

- **Evidencia del propietario:** registros del 1–2 nov citados,
  además del cierre posterior de la fase 2 con 532 y 438 archivos de
  código y confirmación del usuario. Esta revisión no inspeccionó
  directamente el PC, el USB ni los archivos privados; se basa en
  pruebas/capturas registradas por el propietario.
- **Evidencia de GitHub API:** ruleset `26351160` activo,
  sin bypass, y rama de backup protegida con SHA intacto; constatado
  directamente en esta revisión.
- **Pruebas sintéticas CI (03–04 nov):** los tests PostgreSQL 17
  restauran datos inventados y verifican aislamiento del usuario
  ficticio; nunca se deben presentar como restauración del respaldo
  auténtico del propietario.

**Respaldo #214: CLOSED/completed. Lanzamiento comercial #203: NO-GO**
mientras no se cumplan las condiciones independientes de #104 y #203.
**El respaldo auténtico, los dos ZIP del código en USB y la protección
`backup/**` ya están hechos**: no degradar esos hitos a «no realizados» en futuras
actualizaciones del proyecto.
