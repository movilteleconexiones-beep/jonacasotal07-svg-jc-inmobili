# Verificación de transacciones Wompi antes de activar licencias

## Dos endpoints, una regla de seguridad

- Supabase Edge `billing/events` ya contrasta los cinco campos del evento firmado
  (`id`, `reference`, `amount_in_cents`, `currency`, `status`) con
  `GET /v1/transactions/{id}` autenticado mediante la llave privada del comercio.
- Railway `POST /wompi/events` debe hacer **la misma consulta**, antes de llamar a
  `process_verified_payment_event`. La firma de Wompi puede omitir la
  `reference` y `currency`: no asumir que esos campos están firmados.
- La RPC de activación valida importe/moneda/referencia contra la orden local,
  pero por sí sola no acredita que esa referencia realmente pertenezca a la
  transacción consultada. De ahí la conciliación externa.

## Configuración del servicio Railway `inmojco-wompi-sandbox`

1. En Railway → Variables del servicio, añade **WOMPI_PRIVATE_KEY** con
   la llave **`prv_test_...`** del mismo comercio sandbox Wompi que suministra
   `WOMPI_EVENTS_SECRET`. No pegarla en GitHub, Vite, el navegador, logs ni chat.
2. Mantén `WOMPI_ENV=sandbox` y `WOMPI_PRODUCTION_APPROVED` sin activar.
3. Railway verifica la firma del webhook, consulta exclusivamente
   `https://sandbox.wompi.co/v1/transactions/{id}` y valida los cinco campos.
   Si falta la llave, si la API no responde o existe discrepancia, **no llama a
   la RPC de activación**. Responde 503 para permitir reintento de proveedor o
   409 para discrepancia, sin devolver secretos.
4. Para el futuro modo real se necesitan `prv_prod_...` y aprobación comercial
   explícita; la mera presencia de una llave no habilita producción.
5. Comprueba con una transacción sandbox nueva: webhook legítimo + GET Wompi
   coincidentes → evento procesado; una alteración de referencia, estado o
   moneda debe ser rechazada sin activar una nueva organización.

Si Wompi ya envía eventos a `billing/events` de Supabase Edge, no redirigirlos
a Railway innecesariamente. Ambos endpoints permanecen sujetos a la misma regla.

Documentación Wompi: https://docs.wompi.co/docs/colombia/transacciones/
y https://docs.wompi.co/docs/colombia/eventos/
