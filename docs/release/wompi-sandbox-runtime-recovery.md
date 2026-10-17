# Wompi Sandbox — Diagnóstico de Railway (16/oct/2026)

## Arquitectura y alcance

La aplicación web actual inicia pagos mediante `supabase.functions.invoke('billing/checkout')` y recibe eventos en la **Supabase Edge Function** `supabase/functions/billing/index.ts`. El servicio Node `inmojco-wompi-sandbox` en Railway es **otra implementación** de webhook de ensayo y no constituye por sí solo el indicador de disponibilidad del flujo Edge usado por la UI. No configurar o exponer un segundo webhook en producción sin decidir un único receptor autoritativo y probar idempotencia.

La migración de `app.inmojco.com` a `www.inmojco.com` requiere revisar en Supabase `APP_URL=https://www.inmojco.com/`, el origen permitido, la redirección de confirmación, y que `www` ya esté verificado con HTTPS. La rama de integración prepara el *fallback* pero **una variable APP_URL existente prevalece**. No cambiar APP_URL durante la espera de liberación DNS si se pretende mantener la ruta operativa.

## Diagnóstico del runtime alternativo de Railway

## Confirmado por logs del servicio

- Railway: proyecto `secure-sparkle`, servicio `inmojco-wompi-sandbox`.
- Implementación: `server/wompi-runtime.ts`, comando `npm run wompi:server`, verificación de salud `/readyz`.
- Último despliegue consultado: `3e104e82-f5f3-452f-b1d0-e2d31707abd9` (FAILED, healthcheck).
- **Causa de arranque, antes del healthcheck:** `Missing required server environment variable: WOMPI_EVENTS_SECRET`.
- El nombre aparece en Railway Variables, pero en el despliegue su valor no está disponible/no es válido. **No almacenar ni solicitar la clave en código, PR, logs o chat.**
- El servicio principal `jonacasotal07-svg-jc-inmobili` sigue ONLINE; no hay necesidad de reiniciarlo para este problema.

## Pasos de recuperación (solo Sandbox)

1. Abrir Railway → `secure-sparkle` → servicio `inmojco-wompi-sandbox` → **Variables**.
2. Comprobar que `WOMPI_ENV=sandbox` y `WOMPI_PRODUCTION_APPROVED` **no** sea `1`.
3. En la consola oficial de Wompi, copiar el **secreto de eventos del comercio en modo de pruebas** a la variable privada `WOMPI_EVENTS_SECRET`, sin exponerlo en frontend, ChatGPT o GitHub.
4. Comprobar también `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` desde la consola privada de Railway. La service role key es un secreto de servidor, nunca una variable `VITE_*`.
5. Guardar y desplegar **únicamente ese servicio sandbox** cuando se haya verificado el entorno. No habilitar modo producción.
6. Leer logs del nuevo despliegue. La comprobación de salud `/healthz` debe responder 200 si el proceso arranca. `/readyz` devolverá 200 solamente si `payment_orders` es consultable con las credenciales servidor; si devuelve 503, auditar migraciones SQL y permisos antes de procesar eventos.
7. Hacer pruebas de firma inválida (401), firma válida, evento duplicado y reenvío idempotente, cuidando que Wompi y Railway usen el mismo secreto de **sandbox**.
8. Registrar la evidencia del webhook y del cambio de estado de una orden de ensayo en Supabase. No aprobar ni desembolsar importes reales.

## Condición de bloqueo

No declarar Wompi operativo por el hecho de que CI pruebe funciones aisladas. El entorno real permanece no validado hasta que el proceso levante, su `/readyz` responda y se demuestre el flujo de eventos de ensayo de extremo a extremo.
