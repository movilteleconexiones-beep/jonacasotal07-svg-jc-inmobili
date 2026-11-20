/**
 * G29 — canonical and non-user-controlled password recovery destination.
 * This exact URL must be allowed in Supabase Auth > URL Configuration.
 */
export const PASSWORD_RESET_PATH = '/restablecer-contrasena';
export const PASSWORD_RESET_REDIRECT_URL = 'https://www.inmojco.com/restablecer-contrasena';

export function isPasswordResetPath(pathname: string): boolean {
  return pathname === PASSWORD_RESET_PATH || pathname === `${PASSWORD_RESET_PATH}/`;
}

/**
 * Supabase stores passwords securely; this client validation only improves UX.
 * A 72-byte maximum prevents unexpected bcrypt truncation.
 */
export function validateNewPassword(password: string, confirmation: string): string | null {
  const length = new TextEncoder().encode(password).length;
  if (length < 12) return 'La nueva contraseña debe tener al menos 12 caracteres.';
  if (length > 72) return 'La nueva contraseña no debe superar 72 bytes.';
  if (password !== confirmation) return 'Las contraseñas no coinciden.';
  return null;
}
