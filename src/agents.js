const { randomUUID } = require('node:crypto');

const AGENTS = [
  { key: 'company-health', name: 'Company Health', domains: ['finance','commercial','operations','people'], description: 'Summarizes material changes and company-wide risks.' },
  { key: 'finance', name: 'Finance', domains: ['finance'], description: 'Monitors revenue, margin, runway and planning signals.' },
  { key: 'commercial', name: 'Commercial', domains: ['commercial'], description: 'Monitors pipeline, conversion and customer concentration.' },
  { key: 'operations', name: 'Operations', domains: ['operations'], description: 'Monitors service levels and operational incidents.' },
  { key: 'meeting-prep', name: 'Meeting Prep & Follow-up', domains: ['all'], description: 'Creates executive briefing and follow-up tasks from current findings.' },
  { key: 'data-quality', name: 'Data Quality', domains: ['data_quality','all'], description: 'Flags stale, low-confidence or incomplete source data.' },
];

const id = (prefix) => `${prefix}_${randomUUID()}`;
const timestamp = (options) => (options.now ? new Date(options.now) : new Date()).toISOString();
function insertAudit(db, actor, eventType, entityType, entityId, details, at) {
  db.prepare(`INSERT INTO audit_log(id,actor,event_type,entity_type,entity_id,details_json,occurred_at)
    VALUES (?,?,?,?,?,?,?)`).run(id('audit'), actor, eventType, entityType, entityId, JSON.stringify(details), at);
}
function metricMap(db) {
  return new Map(db.prepare('SELECT * FROM metric_snapshots').all().map(m => [m.metric_key, m]));
}
function recordFinding(db, runId, agentKey, { severity='watch', title, explanation, facts=[], hypotheses=[], confidence=.85, metrics=[] }, at) {
  const findingId = id('finding');
  db.prepare(`INSERT INTO findings(id,run_id,agent_key,severity,title,explanation,facts_json,hypotheses_json,confidence,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(findingId, runId, agentKey, severity, title, explanation,
      JSON.stringify(facts), JSON.stringify(hypotheses), confidence, at);
  const evidenceInsert = db.prepare(`INSERT INTO evidence(id,finding_id,metric_id,role,captured_value,captured_source,captured_at)
    VALUES (?,?,?,?,?,?,?)`);
  metrics.forEach(({ metric, role }) => evidenceInsert.run(id('evidence'), findingId, metric.id, role, metric.value, metric.source, metric.observed_at));
  insertAudit(db, `agent:${agentKey}`, 'finding.created', 'finding', findingId, { severity, evidenceCount: metrics.length }, at);
  return { id: findingId, agent_key: agentKey, severity, title, explanation, facts, hypotheses, confidence,
    evidence: metrics.map(({metric, role}) => ({metric_key:metric.metric_key,label:metric.label,value:metric.value,unit:metric.unit,source:metric.source,observed_at:metric.observed_at,role})) };
}
function addProposal(db, finding, agentKey, title, rationale, actionType, payload, at) {
  const proposalId=id('proposal');
  db.prepare(`INSERT INTO action_proposals(id,finding_id,agent_key,title,rationale,action_type,payload_json,requires_approval,status,created_at)
    VALUES (?,?,?,?,?,?,?,1,'pending',?)`).run(proposalId,finding.id,agentKey,title,rationale,actionType,JSON.stringify(payload),at);
  insertAudit(db,`agent:${agentKey}`,'proposal.created','action_proposal',proposalId,{requiresApproval:true,actionType},at);
  return {id:proposalId,finding_id:finding.id,agent_key:agentKey,title,rationale,action_type:actionType,payload,requires_approval:true,status:'pending',created_at:at};
}
function addTask(db, findingId, proposalId, title, owner, dueDate, at) {
  const taskId=id('task');
  db.prepare(`INSERT INTO tasks(id,finding_id,proposal_id,title,owner,due_date,status,created_at)
    VALUES (?,?,?,?,?,?,'open',?)`).run(taskId,findingId,proposalId,title,owner,dueDate,at);
  insertAudit(db,'system','task.created','task',taskId,{findingId,proposalId},at);
  return {id:taskId,finding_id:findingId,proposal_id:proposalId,title,owner,due_date:dueDate,status:'open',created_at:at};
}

function runAgent(db, agentKey, options={}) {
  const agent=AGENTS.find(a=>a.key===agentKey);
  if(!agent) throw new Error(`Unknown agent: ${agentKey}`);
  const at=timestamp(options), metrics=metricMap(db), results={agent:agentKey,findings:[],proposals:[],tasks:[],briefing:null};
  const runId=id('run');
  const tx=()=>{
    db.prepare(`INSERT INTO agent_runs(id,agent_key,status,started_at,completed_at,summary,input_digest)
      VALUES (?,?,'running',?,NULL,'','')`).run(runId,agentKey,at);
    const finding=(spec)=>{const f=recordFinding(db,runId,agentKey,spec,at);results.findings.push(f);return f;};
    const proposal=(...args)=>{const p=addProposal(db,...args,at);results.proposals.push(p);return p;};
    const task=(...args)=>{const t=addTask(db,...args,at);results.tasks.push(t);return t;};
    const m=(key)=>metrics.get(key);
    const check=(key, predicate, spec, action)=>{const x=m(key);if(x&&predicate(x)){const detail=typeof spec==='function'?spec(x):spec;const f=finding({...detail,metrics:[{metric:x,role:'trigger'}]});if(action){const [title,rationale,type,payload,taskSpec]=action(f);const p=proposal(f,agentKey,title,rationale,type,payload);if(taskSpec)task(f.id,p.id,...taskSpec);}}};

    if(agentKey==='finance'||agentKey==='company-health'){
      check('revenue',x=>x.target!=null&&x.value<x.target*.95,x=>({severity:'critical',title:'Revenue is below plan',explanation:'Net revenue is materially below its recorded target. This is a performance signal, not a causal diagnosis.',facts:[{metric:'revenue',comparison:'below_target'}],hypotheses:['Review segment, renewal and pipeline drivers; current snapshot alone does not establish cause.'],confidence:.9}),f=>['Review revenue recovery options','Revenue is below plan; inspect the linked source data and assign an owner for a recovery plan.','review_revenue',{suggested_owner:'CFO'},['Prepare revenue recovery options','CFO',null]]);
      check('cash_runway',x=>x.value<6,x=>({severity:x.value<3?'critical':'watch',title:'Cash runway needs attention',explanation:'The current cash runway is below the six-month planning threshold.',facts:[{metric:'cash_runway',threshold_months:6}],hypotheses:['Investigate forecast assumptions and upcoming obligations.'],confidence:.88}),f=>['Review cash forecast and scenarios','Runway is below the planning threshold. Review assumptions and prepare options for leadership; no cash action is performed.','review_finance_forecast',{suggested_owner:'CFO'},['Prepare cash forecast scenarios','CFO',null]]);
      check('gross_margin',x=>x.target!=null&&x.value<x.target-.01,{severity:'watch',title:'Gross margin is below target',explanation:'Reported gross margin is more than one percentage point below target.',facts:[{metric:'gross_margin',comparison:'below_target'}],hypotheses:['Check pricing, cost mix and one-off adjustments.'],confidence:.84},f=>['Review margin drivers','Inspect cost and pricing drivers before changing plans.','review_margin',{suggested_owner:'CFO'}]);
    }
    if(agentKey==='commercial'||agentKey==='company-health'){
      check('pipeline_coverage',x=>x.target!=null&&x.value<x.target,{severity:'watch',title:'Pipeline coverage is below target',explanation:'Current pipeline coverage is below the recorded target.',facts:[{metric:'pipeline_coverage',comparison:'below_target'}],hypotheses:['Validate opportunity stage quality and forecast timing.'],confidence:.83},f=>['Review pipeline coverage','Inspect pipeline by segment and stage; confirm forecast assumptions.','review_pipeline',{suggested_owner:'VP Sales'}]);
      check('win_rate',x=>x.target!=null&&x.value<x.target-.02,{severity:'watch',title:'Win rate has declined below target',explanation:'Qualified opportunity win rate is below target; this does not identify a root cause.',facts:[{metric:'win_rate',comparison:'below_target'}],hypotheses:['Review recent losses, qualification and sales cycle changes.'],confidence:.8},f=>['Review recent opportunity losses','Summarize common loss reasons for leadership review.','analyze_win_rate',{suggested_owner:'VP Sales'}]);
      check('customer_concentration',x=>x.value>(x.target??.25),{severity:'watch',title:'Revenue concentration exceeds threshold',explanation:'The largest customer contributes more revenue than the configured concentration threshold.',facts:[{metric:'customer_concentration',comparison:'above_threshold'}],hypotheses:['Assess renewal exposure and diversification opportunities.'],confidence:.86},f=>['Review largest-customer exposure','Prepare a renewal and concentration risk review.','review_customer_concentration',{suggested_owner:'CEO'}]);
    }
    if(agentKey==='operations'||agentKey==='company-health'){
      check('sla_attainment',x=>x.value<(x.target??.95),{severity:'watch',title:'SLA attainment is below target',explanation:'Service-level attainment is below the recorded target.',facts:[{metric:'sla_attainment',comparison:'below_target'}],hypotheses:['Inspect affected service areas and time windows.'],confidence:.86},f=>['Review SLA misses','Identify the services and customer impact behind recent misses.','review_sla',{suggested_owner:'COO'}]);
      check('open_incidents',x=>x.value>(x.target??3),x=>({severity:x.value>6?'critical':'watch',title:'High-priority incident backlog is elevated',explanation:'Open high-priority incidents exceed the configured limit.',facts:[{metric:'open_incidents',comparison:'above_threshold'}],hypotheses:['Check incident age, customer impact and ownership.'],confidence:.9}),f=>['Triage high-priority incidents','Review open incident ownership and target dates.','triage_incidents',{suggested_owner:'COO'},['Triage high-priority incidents','COO',null]]);
    }
    if(agentKey==='data-quality'){
      for(const x of metrics.values()){
        if(x.freshness_hours>24||x.confidence<.8){const f=finding({severity:x.freshness_hours>72?'critical':'watch',title:`Data freshness or confidence needs review: ${x.label}`,explanation:'This metric may not reflect the current operating state. Treat dependent findings as provisional until the source is refreshed or verified.',facts:[{freshness_hours:x.freshness_hours,confidence:x.confidence}],hypotheses:[],confidence:.99,metrics:[{metric:x,role:'quality_signal'}]});proposal(f,agentKey,'Refresh or verify source data',`Verify ${x.label} from ${x.source} before relying on it.`,'refresh_data',{metric_key:x.metric_key,source:x.source});}
        if(x.metric_key==='data_quality_missing'&&x.value>0){const f=finding({severity:'watch',title:'CRM records are missing an owner',explanation:`${x.value} records have no assigned owner, which can weaken follow-up reporting.`,facts:[{missing_owner_records:x.value}],hypotheses:[],confidence:.98,metrics:[{metric:x,role:'quality_signal'}]});proposal(f,agentKey,'Assign owners to unowned CRM records','Review and assign owners to records flagged by the CRM data-quality report.','assign_record_owners',{count:x.value});}
      }
    }
    if(agentKey==='meeting-prep'){
      const recent=db.prepare(`SELECT f.*, r.agent_key FROM findings f JOIN agent_runs r ON r.id=f.run_id
        WHERE f.created_at >= ? ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, f.created_at DESC`).all(new Date(new Date(at).getTime()-7*86400000).toISOString());
      for(const row of recent){const f={id:row.id,title:row.title,explanation:row.explanation,severity:row.severity,agent_key:row.agent_key};
        if(row.severity==='critical'){
          const exists=db.prepare("SELECT id FROM tasks WHERE finding_id=? AND status='open'").get(row.id);
          if(!exists)task(row.id,null,`Discuss: ${row.title}`,'CEO',null);
        }
      }
      const decisionRows=db.prepare("SELECT id,title,status,created_at FROM action_proposals WHERE status='pending' ORDER BY created_at DESC").all();
      const title='Weekly executive briefing';
      const sections=recent.map(f=>`- [${f.severity.toUpperCase()}] ${f.title}: ${f.explanation}`).join('\n')||'- No material findings in the last seven days.';
      const pending=decisionRows.map(p=>`- Pending approval: ${p.title}`).join('\n')||'- No pending proposals.';
      const briefingId=id('briefing');
      db.prepare(`INSERT INTO briefings(id,period,title,body,finding_ids_json,decision_ids_json,created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(briefingId,new Date(at).toISOString().slice(0,10),title,`Executive review\n\nMaterial signals\n${sections}\n\nDecisions awaiting review\n${pending}\n\nUse linked metric evidence to verify each signal. Hypotheses are not established causes.`,JSON.stringify(recent.map(f=>f.id)),JSON.stringify(decisionRows.map(p=>p.id)),at);
      results.briefing={id:briefingId,period:new Date(at).toISOString().slice(0,10),title,body:`Executive review\n\nMaterial signals\n${sections}\n\nDecisions awaiting review\n${pending}\n\nUse linked metric evidence to verify each signal. Hypotheses are not established causes.`,finding_ids:recent.map(f=>f.id),decision_ids:decisionRows.map(p=>p.id)};
    }
    const inputDigest=[...metrics.values()].map(x=>`${x.metric_key}:${x.value}:${x.observed_at}`).sort().join('|');
    db.prepare(`UPDATE agent_runs SET status='completed',completed_at=?,summary=?,input_digest=? WHERE id=?`)
      .run(at,`${results.findings.length} findings, ${results.proposals.length} proposals, ${results.tasks.length} tasks`,inputDigest,runId);
    insertAudit(db,`agent:${agentKey}`,'agent.completed','agent_run',runId,{findingCount:results.findings.length,proposalCount:results.proposals.length,taskCount:results.tasks.length},at);
  };
  db.exec('BEGIN');
  try { tx(); db.exec('COMMIT'); }
  catch(error) { db.exec('ROLLBACK'); throw error; }
  results.run_id=runId; return results;
}

function runAllAgents(db, options={}) {
  const results=[];
  for(const agent of AGENTS)results.push(runAgent(db,agent.key,options));
  return results;
}
function reviewProposal(db, proposalId, {decision,reviewer,note=''}={}) {
  if(!['approved','rejected'].includes(decision))throw new Error('decision must be approved or rejected');
  if(!reviewer||typeof reviewer!=='string')throw new Error('reviewer is required');
  const current=db.prepare('SELECT * FROM action_proposals WHERE id=?').get(proposalId);
  if(!current)throw new Error('proposal not found');
  if(current.status!=='pending')throw new Error(`proposal is already ${current.status}`);
  const at=new Date().toISOString();
  db.prepare('UPDATE action_proposals SET status=?,reviewed_at=?,reviewed_by=?,review_note=? WHERE id=? AND status=\'pending\'')
    .run(decision,at,reviewer,note,proposalId);
  insertAudit(db,reviewer,`proposal.${decision}`,'action_proposal',proposalId,{note},at);
  return db.prepare('SELECT * FROM action_proposals WHERE id=?').get(proposalId);
}
function listAgents(){return AGENTS.map(x=>({...x}));}

module.exports={AGENTS,listAgents,runAgent,runAllAgents,reviewProposal};
