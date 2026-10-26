const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child, port, tempDir;
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function api(route,options){const r=await fetch(`http://127.0.0.1:${port}${route}`,options);const body=await r.json();return {status:r.status,body};}
async function start(){
  tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'company-pulse-test-'));port=await freePort();
  child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),DATABASE_PATH:path.join(tempDir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',c=>stderr+=c.toString());
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){if(child.exitCode!==null)throw new Error(`server exited: ${stderr}`);try{const r=await fetch(`http://127.0.0.1:${port}/api/dashboard`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,80));}
  child.kill();throw new Error(`server did not start: ${stderr}`);
}
async function stop(){if(child&&!child.killed){child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1500))]);}if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});}

test('executive API exposes the seeded workspace and six bounded agents',async()=>{
  await start();
  const {status,body}=await api('/api/dashboard');
  assert.equal(status,200);assert.equal(body.company.name,'Northstar Systems');assert.equal(body.agents.length,6);assert.ok(body.metrics.length>=12);assert.ok(body.findings.length>0);assert.ok(body.proposals.some(p=>p.status==='pending'));assert.equal(body.meetings.length,0);
  const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200);assert.match(await page.text(),/Good morning, Elena/);
  await stop();
});

test('meeting, decision, approval, task completion and audit form one traceable flow',async()=>{
  await start();const initial=(await api('/api/dashboard')).body;const finding=initial.findings[0],brief=initial.briefings[0],proposal=initial.proposals.find(p=>p.status==='pending'),task=initial.tasks.find(t=>t.status==='open');
  const meeting=await api('/api/meetings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Weekly leadership review',briefingId:brief.id,agenda:brief.body})});assert.equal(meeting.status,201);
  const decision=await api('/api/decisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Review revenue gap',decision:'Prepare a recovery plan',owner:'CFO',expectedOutcome:'Return to plan next month',findingId:finding.id,meetingId:meeting.body.meeting.id})});assert.equal(decision.status,201);assert.equal(decision.body.decision.owner,'CFO');
  const outcome=await api(`/api/decisions/${decision.body.decision.id}/outcome`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actualOutcome:'Revenue returned to plan after coverage changes.',status:'completed',reviewer:'CEO'})});assert.equal(outcome.status,200);assert.equal(outcome.body.decision.status,'completed');
  const review=await api(`/api/proposals/${proposal.id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'approved',reviewer:'CEO',note:'Reviewed'})});assert.equal(review.status,200);assert.equal(review.body.proposal.status,'approved');
  const complete=await api(`/api/tasks/${task.id}/complete`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({outcome:'Verified'})});assert.equal(complete.status,200);assert.equal(complete.body.task.status,'completed');
  const audit=(await api('/api/audit')).body;for(const event of ['meeting.confirmed','decision.recorded','decision.outcome_recorded','proposal.approved','task.completed'])assert.ok(audit.some(x=>x.event_type===event),`missing ${event}`);
  const replay=await api(`/api/proposals/${proposal.id}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:'rejected',reviewer:'CEO'})});assert.equal(replay.status,409);
  await stop();
});

test('scenario preview is explicit, bounded, and does not write source data',async()=>{
  await start();const before=(await api('/api/dashboard')).body.metrics.find(m=>m.metric_key==='revenue').value;
  const result=await api('/api/scenarios/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revenueChangePct:5,expenseChangePct:0,additionalHeadcount:2})});assert.equal(result.status,200);assert.equal(result.body.scenario.weeklyRevenue,before*1.05);assert.match(result.body.note,/not a forecast/i);
  const invalid=await api('/api/scenarios/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revenueChangePct:250})});assert.equal(invalid.status,400);
  assert.equal((await api('/api/dashboard')).body.metrics.find(m=>m.metric_key==='revenue').value,before);
  await stop();
});
