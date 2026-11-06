import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mensajeErrorGestionUsuarios } from '../src/core/usuario-error-es.ts';

const source = readFileSync(
  new URL('../src/modules/users/UsersRolesModule.tsx', import.meta.url), 'utf8',
);
const invite = source.slice(source.indexOf('  async function inviteUser('),
  source.indexOf('  async function toggleMemberRole('));

test('visible user-management errors are Spanish and never expose raw PostgREST data',()=>{
  const secret='duplicate key value violates unique constraint "organization_invitations_email_key"; contact someone@example.com';
  const cases={
    '42501': 'No tienes permiso para realizar esta acción en la inmobiliaria.',
    '23505': 'Ya existe un registro o una asignación con estos datos. Actualiza la lista antes de reintentar.',
    '23503': 'El usuario, la invitación o el rol seleccionado ya no está disponible. Actualiza la lista.',
    '23514': 'Los datos enviados no cumplen los requisitos. Revísalos e inténtalo nuevamente.',
    '22P02': 'Los datos enviados no cumplen los requisitos. Revísalos e inténtalo nuevamente.',
  };
  for(const [code,expected] of Object.entries(cases)){
    assert.equal(mensajeErrorGestionUsuarios({code,message:secret}),expected);
    assert.doesNotMatch(mensajeErrorGestionUsuarios({code,message:secret}),/organization_invitations|someone@example\.com|duplicate key/i);
  }
  const generic=mensajeErrorGestionUsuarios({code:'PGRST999',message:secret},'consultar las invitaciones');
  assert.match(generic,/No fue posible consultar las invitaciones/);
  assert.doesNotMatch(generic,/organization_invitations|someone@example\.com|duplicate key/i);
  assert.match(mensajeErrorGestionUsuarios(null),/^No fue posible/);
  assert.match(mensajeErrorGestionUsuarios(new Error(secret)),/^No fue posible/);
});

test('invitation submit guards all async steps with immediate single-flight lock and finally',()=>{
  assert.match(source,/const invitationInFlight = useRef\(false\)/);
  assert.match(invite,/\|\| invitationInFlight\.current\) return/);
  assert.match(invite,/invitationInFlight\.current = true;/);
  assert.match(invite,/setInviting\(true\)/);
  assert.ok(invite.indexOf('invitationInFlight.current = true;') <
    invite.indexOf("new FormData(formElement)"));
  assert.match(invite,/try\s*\{/);
  assert.match(invite,/finally\s*\{\s*invitationInFlight\.current = false;\s*setInviting\(false\)/);
  assert.match(source,/<button type="submit" disabled=\{inviting\} aria-busy=\{inviting\}/);
  assert.match(source, /\{inviting \? 'Preparando invitación…' : 'Crear invitación'\}/);
  assert.match(source, /<button type="button" disabled=\{inviting\} onClick=\{\(\) => setShowInvite\(false\)\}/);
});

test('duplicate lookup and role cleanup failures stop before the replacement insert',()=>{
  const lookup = invite.indexOf('if (lookupError) {');
  const existing = invite.indexOf('let invitationId');
  const deleteRoles = invite.indexOf('if (deleteRolesError) {');
  const insertRoles = invite.indexOf(".from('invitation_roles')\n      .insert");
  assert.ok(lookup > 0 && lookup < existing);
  assert.ok(deleteRoles > 0 && deleteRoles < insertRoles);
  assert.match(invite,/if \(lookupError\) \{\s*setMessage\(mensajeErrorGestionUsuarios\(lookupError/);
  assert.match(invite,/if \(deleteRolesError\) \{\s*setMessage\(mensajeErrorGestionUsuarios\(deleteRolesError/);
  assert.match(invite,/if \(rolesError\) \{\s*setMessage\('No se pudieron asignar los roles/);
  assert.doesNotMatch(invite,/await supabase\.from\('invitation_roles'\)\.delete\(\)/);
});

test('success remains visible after refresh, and uncertain refreshed history has honest feedback',()=>{
  const refresh=invite.indexOf('const refreshed = await load();');
  const confirmation=invite.indexOf("setMessage(refreshed");
  const reset=invite.indexOf('formElement.reset()');
  assert.ok(refresh>0 && refresh<confirmation && confirmation<reset);
  assert.match(invite,/Invitación preparada, pero no se pudo verificar el historial actualizado/);
  assert.match(invite,/const formElement = event\.currentTarget/);
  assert.doesNotMatch(invite,/event\.currentTarget\.reset\(\)/);
  assert.match(source,/return !membersResult\.error && !rolesResult\.error && !permissionsResult\.error/);
  assert.doesNotMatch(source,/setMessage\(error\.message\)/);
  assert.doesNotMatch(source,/setMessage\(rolesResult\.error!\.message\)/);
});
