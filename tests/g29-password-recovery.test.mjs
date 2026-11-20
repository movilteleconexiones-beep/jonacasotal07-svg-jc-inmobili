import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  isPasswordResetPath,
  PASSWORD_RESET_PATH,
  PASSWORD_RESET_REDIRECT_URL,
  validateNewPassword,
} from '../src/core/password-recovery.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const authModal = read('../src/components/AuthAccessButton.tsx');
const resetPage = read('../src/components/PasswordResetPage.tsx');
const app = read('../src/App.tsx');

test('G29: recovery callback has a fixed, canonical production URL', () => {
  assert.equal(PASSWORD_RESET_PATH, '/restablecer-contrasena');
  assert.equal(PASSWORD_RESET_REDIRECT_URL, 'https://www.inmojco.com/restablecer-contrasena');
  assert.equal(isPasswordResetPath('/restablecer-contrasena'), true);
  assert.equal(isPasswordResetPath('/restablecer-contrasena/'), true);
  for (const path of ['/', '/app', '/super-admin', '/restablecer-contrasena-maliciosa', '//restablecer-contrasena', '/inmobiliaria/foo']) {
    assert.equal(isPasswordResetPath(path), false, path);
  }
  assert.match(authModal, /redirectTo:\s*PASSWORD_RESET_REDIRECT_URL/);
  assert.doesNotMatch(authModal, /redirectTo:\s*(window\.location|new URLSearchParams)/);
});

test('G29: password strength and confirmation reject unsafe inputs', () => {
  assert.match(validateNewPassword('Corta123!', 'Corta123!'), /12 caracteres/);
  assert.match(validateNewPassword('x'.repeat(73), 'x'.repeat(73)), /72 bytes/);
  assert.match(validateNewPassword('Suficiente-123!', 'Suficiente-124!'), /no coinciden/);
  assert.equal(validateNewPassword('Suficiente-123!', 'Suficiente-123!'), null);
  assert.match(validateNewPassword('ñ'.repeat(40), 'ñ'.repeat(40)), /72 bytes/, 'unicode must be checked in bytes');
});

test('G29: sign-in retains registration and adds a non-enumerating forgot-password path', () => {
  assert.match(authModal, /¿Olvidaste tu contraseña\?/);
  assert.match(authModal, /mode === 'RECOVER'/);
  assert.match(authModal, /supabase\.auth\.resetPasswordForEmail\(email\.trim\(\)/);
  assert.match(authModal, /Si el correo corresponde a una cuenta registrada/);
  assert.match(authModal, /setPassword\(''\)/);
  assert.match(authModal, /setMode\('SIGN_IN'\)/);
  assert.match(authModal, /setMode\('SIGN_UP'\)/);
  assert.match(authModal, /mode !== 'RECOVER' && <label/);
  assert.doesNotMatch(authModal, /console\.log\(password|console\.log\(email/i);
});

test('G29: callback verifies identity server-side, then updates only own account', () => {
  assert.match(resetPage, /supabase\.auth\.getUser\(\)/);
  assert.match(resetPage, /if \(error \|\| !data\.user\)/);
  assert.match(resetPage, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(resetPage, /supabase\.auth\.signOut\(\)/);
  assert.match(resetPage, /validateNewPassword\(password, confirmation\)/);
  assert.match(resetPage, /phase === 'invalid'/);
  assert.match(resetPage, /phase === 'done'/);
  assert.match(resetPage, /history\.replaceState/);
  assert.doesNotMatch(resetPage, /organization_members|service_role|isPlatformAdmin|roles\.includes/);
});

test('G29: callback is rendered before private workspace routing', () => {
  const recoveryIndex = app.indexOf('if (isPasswordResetPath(window.location.pathname))');
  const adminIndex = app.indexOf('if (isSuperAdminRoute)');
  const dashboardIndex = app.indexOf('if (user && (activeMembership || isPlatformAdmin)');
  assert.ok(recoveryIndex > 0 && recoveryIndex < adminIndex && recoveryIndex < dashboardIndex);
  assert.match(app, /return <PasswordResetPage \/>/);
});
