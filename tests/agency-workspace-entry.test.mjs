import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {shouldOpenAgencyWorkspace} from '../src/core/agency-workspace-entry.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('public root remains public after sign-in; /app is authenticated backoffice',()=>{
  const base={authenticated:true,hasMembership:true,platformAdmin:false,pathname:'/',publicConsignment:false};
  assert.equal(shouldOpenAgencyWorkspace(base),false);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/inmobiliaria/tenant-a'}),false);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app'}),true);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app/'}),true);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app',platformAdmin:true}),true);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app',platformAdmin:true,hasMembership:false}),true);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app',authenticated:false}),false);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app',hasMembership:false}),false);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/super-admin'}),false);
  assert.equal(shouldOpenAgencyWorkspace({...base,pathname:'/app',publicConsignment:true}),false);
});

test('marketing homepage cannot show before agency session hydration is complete',()=>{
  const app=read('src/App.tsx');
  const dashboard=read('src/modules/dashboard/PrivateDashboard.tsx');
  assert.match(app,/const \{ user, activeMembership, isPlatformAdmin, loading: authLoading, accessError \} = useAuth\(\)/);
  assert.match(app,/const agencyWorkspaceRequired = shouldOpenAgencyWorkspace\(/);
  const hydration=app.indexOf('if (authLoading) {');
  const dashboardDecision=app.indexOf('isPrivateDashboardOpen || agencyWorkspaceRequired');
  const marketing=app.indexOf('<div id="inicio"');
  assert.ok(hydration>0 && dashboardDecision>hydration && marketing>dashboardDecision);
  assert.match(dashboard,/aria-label="Inmobiliaria activa"[^>]*>\{activeMembership\.organization\.name\}/);
  assert.match(dashboard,/Panel privado de la inmobiliaria/);
  assert.match(dashboard,/\{isPlatformAdmin && <button[\s\S]{0,250}onClick=\{onClose\}[\s\S]{0,290}<Home/);
  assert.match(dashboard,/\{activeMembership\.organization\.name\} · Portal privado/);
});
