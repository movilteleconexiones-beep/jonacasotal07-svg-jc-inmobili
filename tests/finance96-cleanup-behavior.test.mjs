import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupQaAccounts} from '../scripts/qa/finance96-cleanup.mjs';

const ORG = '976cd8d8-d66c-4aeb-9784-4b4d10250918';
const RUN = 'qa96-run-for-unit-tests';
const created = [{userId:'temp-auth-id',memberId:'temp-member-id'}];

function fakeAdmin({suite='finance96',run=RUN,memberError=false,authError=false,lookupError=false} = {}) {
  const events = [];
  const chain = {
    eq(key,value) { events.push('scope:'+key); return this; },
    then(resolve,reject) { return Promise.resolve({error:memberError ? {code:'DB_TEST'} : null}).then(resolve,reject); },
  };
  const admin = {
    auth:{admin:{
      async getUserById(id) {
        events.push('attest');
        return lookupError ? {data:null,error:{code:'QA_LOOKUP_FAIL'}} :
          {data:{user:{id,app_metadata:{qa_suite:suite,qa_run:run}}},error:null};
      },
      async deleteUser(id) {
        events.push('delete-user');
        return {error:authError ? {code:'QA_AUTH_FAIL'} : null};
      },
    }},
    from(name) {
      assert.equal(name,'organization_members');
      return { delete() {events.push('delete-membership');return chain;} };
    },
  };
  const logger={log(message){events.push(message)}};
  return {admin,events,logger};
}

test('#96 cleanup deletes only accounts attested for the same QA run',async()=>{
  const f=fakeAdmin();
  const result=await cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger});
  assert.deepEqual(result,{attempted:1,authDeleted:1});
  assert.ok(f.events.indexOf('attest') < f.events.indexOf('delete-membership'));
  assert.ok(f.events.indexOf('delete-membership') < f.events.indexOf('delete-user'));
  assert.ok(f.events.some(x=>x.includes('failures=0')));
});

test('#96 cleanup refuses an identity without the exact run marker',async()=>{
  const f=fakeAdmin({run:'another-qa-run'});
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger}),
    /QA cleanup incomplete/);
  assert.ok(!f.events.includes('delete-membership'));
  assert.ok(!f.events.includes('delete-user'));
});

test('#96 cleanup refuses an identity without the suite marker',async()=>{
  const f=fakeAdmin({suite:'real-user'});
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger}),
    /QA cleanup incomplete/);
  assert.ok(!f.events.includes('delete-user'));
});

test('#96 cleanup removes Auth user even when membership deletion fails',async()=>{
  const f=fakeAdmin({memberError:true});
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger}),
    /QA cleanup incomplete/);
  assert.ok(f.events.includes('delete-user'), 'Foreign-key cascade must still be attempted');
});

test('#96 cleanup reports failed Auth deletion instead of declaring success',async()=>{
  const f=fakeAdmin({authError:true});
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger}),
    /QA cleanup incomplete/);
  assert.ok(f.events.some(x=>x.includes('failures=1')));
});

test('#96 cleanup never deletes when Admin API cannot attest the user',async()=>{
  const f=fakeAdmin({lookupError:true});
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:RUN,logger:f.logger}),
    /QA cleanup incomplete/);
  assert.ok(!f.events.includes('delete-user'));
});

test('#96 cleanup rejects absent run identity before any I/O',async()=>{
  const f=fakeAdmin();
  await assert.rejects(cleanupQaAccounts({admin:f.admin,created,orgId:ORG,runId:'',logger:f.logger}),
    /requires admin/);
  assert.equal(f.events.length,0);
});
