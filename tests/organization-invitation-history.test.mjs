import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {invitationDisplayStatus} from '../src/modules/users/InvitationHistory.tsx';

const users=readFileSync(new URL('../src/modules/users/UsersRolesModule.tsx',import.meta.url),'utf8');
const history=readFileSync(new URL('../src/modules/users/InvitationHistory.tsx',import.meta.url),'utf8');

test('accepted invitations remain accepted, including after the expiry date',()=>{
  const now=Date.parse('2026-10-14T20:00:00Z');
  assert.equal(invitationDisplayStatus({status:'ACCEPTED',expires_at:'2026-10-01T00:00:00Z'},now),'ACCEPTED');
  assert.equal(invitationDisplayStatus({status:'CANCELLED',expires_at:'2026-10-01T00:00:00Z'},now),'CANCELLED');
  assert.equal(invitationDisplayStatus({status:'EXPIRED',expires_at:'2027-01-01T00:00:00Z'},now),'EXPIRED');
  assert.equal(invitationDisplayStatus({status:'PENDING',expires_at:'2026-10-15T00:00:00Z'},now),'PENDING');
  assert.equal(invitationDisplayStatus({status:'PENDING',expires_at:'2026-10-14T19:00:00Z'},now),'EXPIRED');
  assert.equal(invitationDisplayStatus({status:'UNKNOWN',expires_at:'2026-10-15T00:00:00Z'},now),'UNKNOWN');
});

test('visible invitation history renders every status and accepted timestamp',()=>{
  assert.match(users,/<InvitationHistory invitations=\{invitations\}/);
  assert.match(history,/Invitaciones e historial/);
  assert.match(history,/Invitada:/);
  assert.match(history,/Aceptada:/);
  assert.match(history,/dateText\(invitation\.accepted_at\)/);
  assert.match(history,/Pendiente de aceptación/);
  assert.match(history,/Vencida/);
  assert.match(history,/Cancelada/);
  assert.match(history,/Todas/);
  assert.match(history,/No hay invitaciones pendientes de aceptación/);
  assert.doesNotMatch(users,/pendingInvitations\.length > 0/);
});

test('invitation list stays scoped to active organization and fails closed on incomplete reads',()=>{
  assert.match(users,/\.from\('organization_invitations'\)/);
  assert.match(users,/\.select\('id,email,full_name,status,expires_at,created_at,accepted_at,invitation_roles/);
  assert.match(users,/\.eq\('organization_id', organizationId\)/);
  assert.match(users,/\.limit\(501\)/);
  assert.match(users,/invitationsResult\.count>500/);
  assert.match(users,/setInvitationLoadError\(/);
  assert.match(history,/No se mostrará una lista incompleta como si estuviera vacía/);
});

test('cancellation only targets an unexpired pending invitation of this tenant and retains history',()=>{
  assert.match(users,/window\.confirm\('¿Cancelar esta invitación pendiente/);
  assert.match(users,/\.update\(\{ status: 'CANCELLED' \}\)/);
  assert.match(users,/\.eq\('organization_id',organizationId\)/);
  assert.match(users,/\.eq\('status','PENDING'\)/);
  assert.match(users,/\.gt\('expires_at',new Date\(\)\.toISOString\(\)\)/);
  assert.match(users,/can\(PERMISSIONS\.USERS_EDIT\)/);
  assert.doesNotMatch(users,/\.from\('organization_invitations'\)\.delete\(/);
});

test('current invite flow still uses same-email unique record rather than fabricating additional invitations',()=>{
  assert.match(users,/\.eq\('email', email\)/);
  assert.match(users,/status: 'PENDING'/);
  assert.match(users,/Invitación preparada/);
});
