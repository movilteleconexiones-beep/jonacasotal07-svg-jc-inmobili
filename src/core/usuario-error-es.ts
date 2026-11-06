/**
 * Presenta errores de gestión de usuarios sin exponer mensajes internos de
 * PostgREST/PostgreSQL (nombres de tablas, políticas, correos o SQL).
 * La autorización y las restricciones siguen siendo responsabilidad de RLS.
 */
export function mensajeErrorGestionUsuarios(
  error: unknown,
  operacion = 'completar la operación',
): string {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : '';

  switch (code) {
    case '42501':
    case 'PGRST301':
    case 'PGRST302':
      return 'No tienes permiso para realizar esta acción en la inmobiliaria.';
    case '23505':
      return 'Ya existe un registro o una asignación con estos datos. Actualiza la lista antes de reintentar.';
    case '23503':
      return 'El usuario, la invitación o el rol seleccionado ya no está disponible. Actualiza la lista.';
    case '23514':
    case '23502':
    case '22P02':
      return 'Los datos enviados no cumplen los requisitos. Revísalos e inténtalo nuevamente.';
    default:
      return `No fue posible ${operacion}. Revisa tu conexión y los permisos, y vuelve a intentarlo.`;
  }
}
