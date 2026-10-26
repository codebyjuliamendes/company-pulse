const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, seedDemoData } = require('../src/db');
const { listAgents, runAllAgents, runAgent, reviewProposal } = require('../src/agents');

function setup(){const db=createDatabase();seedDemoData(db,new Date('2026-10-26T12:00:00Z'));return db;}

test('demo seed is deterministic in shape and all six agents execute',()=>{
  const db=setup();
  assert.equal(seedDemoData(db,new Date('2026-10-26T12:00:00Z')),12);
  assert.equal(listAgents().length,6);
  const results=runAllAgents(db,{now:'2026-10-26T12:00:00Z'});
  assert.equal(results.length,6);
  for(const result of results)assert.ok(result.run_id);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM findings').get().n>0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM evidence').get().n>0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM briefings').get().n>0);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM agent_runs WHERE status='completed'").get().n===6);
  db.close();
});

test('consequential proposals always wait for a human and review is audited',()=>{
  const db=setup();
  const result=runAgent(db,'finance',{now:'2026-10-26T12:00:00Z'});
  assert.ok(result.proposals.length>0);
  const p=result.proposals[0];
  assert.equal(p.requires_approval,true);
  assert.equal(p.status,'pending');
  const reviewed=reviewProposal(db,p.id,{decision:'approved',reviewer:'ceo@example.test',note:'Reviewed in demo'});
  assert.equal(reviewed.status,'approved');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE event_type='proposal.approved'").get().n,1);
  assert.throws(()=>reviewProposal(db,p.id,{decision:'rejected',reviewer:'ceo@example.test'}),/already approved/);
  db.close();
});

test('agent output does not execute external or financial actions',()=>{
  const db=setup();seedDemoData(db,new Date('2026-10-26T12:00:00Z'));
  runAllAgents(db,{now:'2026-10-26T12:00:00Z'});
  const writes=db.prepare("SELECT COUNT(*) n FROM audit_log WHERE event_type LIKE '%payment%' OR event_type LIKE '%sent%' OR event_type LIKE '%executed%'").get().n;
  assert.equal(writes,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM action_proposals WHERE requires_approval=0").get().n,0);
  db.close();
});

test('unknown agent and invalid approval decisions fail clearly',()=>{
  const db=setup();
  assert.throws(()=>runAgent(db,'unknown'),/Unknown agent/);
  assert.throws(()=>reviewProposal(db,'missing',{decision:'execute',reviewer:'x'}),/decision must/);
  db.close();
});
