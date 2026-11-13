import test from 'node:test';
import assert from 'node:assert/strict';
import {addTemporaryQaMember} from '../scripts/qa/finance96-membership.mjs';

const ORG='976cd8d8-d66c-4aeb-9784-4b4d10250918';
const USER='77777777-7777-4777-8777-777777777777';
const ROLE='88888888-8888-4888-8888-888888888888';
const MEMBER='99999999-9999-4999-8999-999999999999';

function makeFake({fail=null}={}) {
  const events=[];
  const memberInsert = {
    select(columns) {
      events.push(['insert-select',columns]);
      return {async single(){return fail==='invite'?
        {data:null,error:{code:'P0001'}}:{data:{id:MEMBER},error:null};}};
    },
  };
  const memberUpdate = {
    eq(key,value){events.push(['update-scope',key,value]);return this;},
    select(columns) {
      events.push(['update-select',columns]);
      return {async single(){return fail==='activate'?
        {data:null,error:{code:'P0001'}}:
        fail==='noactivation'?{data:null,error:null}:
        {data:{id:MEMBER,status:'ACTIVE'},error:null};}};
    },
  };
  const admin={
    from(table){
      if(table==='organization_members')return {
        insert(data){
          events.push(['invite',table,data]);
          return memberInsert;
        },
        update(data){
          events.push(['activate',table,data]);
          return memberUpdate;
        },
      };
      if(table==='member_roles')return {
        async insert(data){
          events.push(['assign',table,data]);
          return {error:fail==='role'?{code:'23514'}:null};
        },
      };
      throw new Error('Unexpected table');
    },
  };
  return {admin,events};
}

async function runFixture(f, record={userId:USER,memberId:null}) {
  return addTemporaryQaMember({admin:f.admin,orgId:ORG,userId:USER,roleId:ROLE,record});
}

test('#96 QA: invited member -> exclusive role -> active member in strict order', async()=>{
  const f=makeFake();
  const record={userId:USER,memberId:null};
  const result=await runFixture(f,record);
  assert.equal(result,MEMBER);
  assert.equal(record.memberId,MEMBER);
  const names=f.events.filter(([key])=>['invite','assign','activate'].includes(key)).map(x=>x[0]);
  assert.deepEqual(names,['invite','assign','activate']);
  assert.deepEqual(f.events.find(x=>x[0]==='invite')[2],{
    organization_id:ORG,user_id:USER,status:'INVITED',
  });
  assert.deepEqual(f.events.find(x=>x[0]==='assign')[2],{
    organization_member_id:MEMBER,role_id:ROLE,
  });
  assert.deepEqual(f.events.find(x=>x[0]==='activate')[2],{status:'ACTIVE'});
  for(const [field,value] of [['id',MEMBER],['organization_id',ORG],
    ['user_id',USER],['status','INVITED']]){
    assert.ok(f.events.some(x=>x[0]==='update-scope'&&x[1]===field&&x[2]===value),
      'Member activation missing RLS-safe scope: '+field);
  }
});

test('#96 QA: failed invitation leaves no role or active membership',async()=>{
  const f=makeFake({fail:'invite'}),record={userId:USER,memberId:null};
  await assert.rejects(runFixture(f,record),/invited membership creation failed: P0001/);
  assert.equal(record.memberId,null);
  assert.ok(!f.events.some(x=>['assign','activate'].includes(x[0])));
});

test('#96 QA: failure after invitation records member ID for the finally cleanup',async()=>{
  const f=makeFake({fail:'role'}),record={userId:USER,memberId:null};
  await assert.rejects(runFixture(f,record),/role assignment failed: 23514/);
  assert.equal(record.memberId,MEMBER);
  assert.ok(!f.events.some(x=>x[0]==='activate'));
});

test('#96 QA: failed activation leaves marked ID for cleanup and fails closed',async()=>{
  const f=makeFake({fail:'activate'}),record={userId:USER,memberId:null};
  await assert.rejects(runFixture(f,record),/membership activation refused: P0001/);
  assert.equal(record.memberId,MEMBER);
  assert.ok(f.events.some(x=>x[0]==='assign'));
});

test('#96 QA: missing activated result is not accepted',async()=>{
  const f=makeFake({fail:'noactivation'});
  await assert.rejects(runFixture(f),/membership activation refused: missing-row/);
});

test('#96 QA: refuses attempt to reassign an existing membership',async()=>{
  const f=makeFake();
  await assert.rejects(runFixture(f,{userId:USER,memberId:MEMBER}),
    /must not already have membership/);
  assert.equal(f.events.length,0);
});

test('#96 QA: fails before any request if member user does not match created Auth',async()=>{
  const f=makeFake();
  await assert.rejects(runFixture(f,{userId:'an-unrelated-user',memberId:null}),
    /requires a previously created Auth identity/);
  assert.equal(f.events.length,0);
});
