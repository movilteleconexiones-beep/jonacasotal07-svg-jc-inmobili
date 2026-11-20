# G29 — Recuperación de contraseña de usuarios INMOJCO

**Hallazgo:** el formulario de inicio de sesión central no tenía la opción **¿Olvidaste tu contraseña?**. Esto impide validar el correo de autenticación real y deja a los usuarios sin recuperación autoservicio.

## Comportamiento implementado en PR

1. En **Acceso → Iniciar sesión**, el usuario selecciona **¿Olvidaste tu contraseña?**, introduce su correo y recibe un mensaje genérico que no revela si existe una cuenta.
2. Supabase Auth `resetPasswordForEmail` envía un enlace **al correo registrado**, con redirección fija `https://www.inmojco.com/restablecer-contrasena`. No concatenar `redirectTo` desde un query param.
3. La ruta muestra un formulario exclusivo de cambio de contraseña. Antes de habilitarlo, `supabase.auth.getUser()` debe verificar la sesión que creó Supabase al abrir el enlace. Sin sesión válida, se muestra que el enlace expiró o no es válido.
4. El formulario exige 12 caracteres como mínimo y valida confirmación y tamaño en bytes antes de llamar `supabase.auth.updateUser({password})`.
5. Tras actualizar, cierra sesión y solicita iniciar de nuevo. La ruta se resuelve ANTES de la navegación al panel (incluso si hay membresía), no modifica organizaciones, permisos, planes ni RLS y no publica tokens.
6. Mantener mensajes y navegación en español, y sin mostrar las credenciales en logs o capturas.

## Verificaciones manuales obligatorias ANTES del despliegue

- En **Supabase proyecto oficial → Authentication → URL Configuration**, establecer Site URL canónica `https://www.inmojco.com/` y añadir a **Redirect URLs** exactamente `https://www.inmojco.com/restablecer-contrasena`. Comprobar valores existentes sin borrarlos; no utilizar comodines de localhost en producción.
- En **Authentication → Emails → Templates → Reset Password**, comprobar el enlace de confirmación de Supabase y el texto de marca correspondiente a Sistema Inmobiliario JCO, sin introducir URL de terceros.
- La conexión SMTP Namecheap en Supabase se ha activado por el titular, pero NO se considera certificada hasta probar un mensaje que provenga de Supabase Auth (no es suficiente enviar desde el buzón humano).
- Ejecutar prueba E2E con **cuenta de prueba propia**, correo real, enlace de recuperación recibido, contraseña nueva válida y reingreso exitoso. Probar también enlace utilizado/vencido, destinatario inexistente (respuesta no enumeradora), doble clic y recorrido móvil.
- Comprobar en entorno aislado primero y publicar tras CI integral. **No** alterar contraseñas de usuarios auténticos sin su acción, ni probar contra el SuperAdmin real. No copiar enlaces de recuperación ni capturas con tokens en issues.
- El proceso no habilita Wompi LIVE ni la captación pública cerrada por G07. La incidencia #415 (npm audit HIGH) sigue siendo puerta de seguridad independiente.

Referencias oficiales:
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/auth/passwords
