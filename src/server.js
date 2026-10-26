const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createDatabase, seedDemoData } = require('./db');
const { listAgents, runAllAgents, runAgent, reviewProposal } = require('./agents');

const port = Number(process.env.PORT || 3100);
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = createDatabase(process.env.DATABASE_PATH || path.join(dataDir, 'company-pulse.sqlite'));
if (!db.prepare('SELECT COUNT(*) n FROM metric_snapshots').get().n) seedDemoData(db);
if (!db.prepare('SELECT COUNT(*) n FROM agent_runs').get().n) runAllAgents(db);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) { reject(new Error('Request body too large')); req.destroy(); } }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body')); } }); req.on('error', reject); }); }
function dashboard() {
  const metrics = db.prepare('SELECT * FROM metric_snapshots ORDER BY domain, metric_key').all().map(m => ({ ...m, metadata: JSON.parse(m.metadata_json || '{}') }));
  const findings = db.prepare(`SELECT * FROM findings WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC, rowid DESC) rn FROM findings) WHERE rn=1) ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'risk' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END, created_at DESC LIMIT 16`).all().map(f => ({ ...f, facts: JSON.parse(f.facts_json), hypotheses: JSON.parse(f.hypotheses_json), evidence: db.prepare('SELECT e.*,m.metric_key,m.label,m.unit FROM evidence e JOIN metric_snapshots m ON m.id=e.metric_id WHERE e.finding_id=?').all(f.id) }));
  const proposals = db.prepare(`SELECT p.*,f.title AS finding_title FROM action_proposals p LEFT JOIN findings f ON f.id=p.finding_id ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 12`).all().map(p => ({ ...p, payload: JSON.parse(p.payload_json) }));
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date LIMIT 12").all();
  const briefings = db.prepare('SELECT * FROM briefings ORDER BY created_at DESC LIMIT 4').all().map(b => ({ ...b, finding_ids: JSON.parse(b.finding_ids_json), decision_ids: JSON.parse(b.decision_ids_json) }));
  const decisions = db.prepare("SELECT * FROM decision_records ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, due_date LIMIT 20").all();
  const meetings = db.prepare('SELECT * FROM meetings ORDER BY scheduled_at DESC LIMIT 10').all();
  const latestRun = db.prepare('SELECT MAX(completed_at) at FROM agent_runs').get().at;
  const domainHealth = ['finance','commercial','operations','people','data_quality'].map(domain => {
    const set=metrics.filter(m=>m.domain===domain); const stale=set.filter(m=>m.freshness_hours>24).length; const below=set.filter(m=>m.target!==null&&m.target!==undefined&&(m.unit==='ratio'?m.value<m.target:m.metric_key==='cash_runway'?m.value<m.target:m.value<m.target)).length;
    return {domain,count:set.length,stale,attention:below};
  });
  return { company:{name:'Northstar Systems',period:'Week of October 26',updatedAt:latestRun}, metrics, findings, proposals, tasks, briefings, decisions, meetings, agents:listAgents(), domainHealth, counts:{findings:db.prepare('SELECT COUNT(*) n FROM findings').get().n,pending:db.prepare("SELECT COUNT(*) n FROM action_proposals WHERE status='pending'").get().n,openTasks:db.prepare("SELECT COUNT(*) n FROM tasks WHERE status='open'").get().n,auditEvents:db.prepare('SELECT COUNT(*) n FROM audit_log').get().n} };
}
const routes = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/dashboard') return json(res,200,dashboard());
  if (req.method === 'GET' && url.pathname === '/api/audit') return json(res,200,db.prepare('SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 80').all().map(e=>({...e,details:JSON.parse(e.details_json)})));
  if (req.method === 'GET' && url.pathname === '/api/agents') return json(res,200,listAgents());
  if (req.method === 'POST' && url.pathname === '/api/meetings') {
    const body=await readBody(req); const title=String(body.title||'').trim();
    if(title.length<3||title.length>180)return json(res,400,{error:'Meeting title must be 3–180 characters.'});
    const id=randomUUID(),at=new Date().toISOString(),briefingId=body.briefingId||null;
    db.prepare('INSERT INTO meetings(id,briefing_id,title,scheduled_at,agenda,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,briefingId,title,at,String(body.agenda||'').slice(0,8000),String(body.notes||'').slice(0,8000),String(body.createdBy||'Executive').slice(0,120),at);
    db.prepare('INSERT INTO audit_log(id,actor,event_type,entity_type,entity_id,details_json,occurred_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'Executive','meeting.confirmed','meeting',id,JSON.stringify({title,briefingId}),at);
    return json(res,201,{meeting:db.prepare('SELECT * FROM meetings WHERE id=?').get(id),dashboard:dashboard()});
  }
  if (req.method === 'POST' && url.pathname === '/api/decisions') {
    const body=await readBody(req);const title=String(body.title||'').trim(),decision=String(body.decision||'').trim(),owner=String(body.owner||'').trim(),expected=String(body.expectedOutcome||'').trim();
    if(title.length<3||decision.length<3||owner.length<2||expected.length<3)return json(res,400,{error:'Provide a title, decision, owner, and expected outcome.'});
    if([title,decision,owner,expected].some(x=>x.length>1000))return json(res,400,{error:'Decision fields are too long.'});
    const id=randomUUID(),at=new Date().toISOString(),findingId=body.findingId||null,meetingId=body.meetingId||null,dueDate=body.dueDate||null;
    if(findingId&&!db.prepare('SELECT id FROM findings WHERE id=?').get(findingId))return json(res,400,{error:'Finding does not exist.'});
    if(meetingId&&!db.prepare('SELECT id FROM meetings WHERE id=?').get(meetingId))return json(res,400,{error:'Meeting does not exist.'});
    db.prepare('INSERT INTO decision_records(id,meeting_id,finding_id,title,decision,owner,due_date,expected_outcome,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,meetingId,findingId,title,decision,owner,dueDate,expected,'Executive',at);
    db.prepare('INSERT INTO audit_log(id,actor,event_type,entity_type,entity_id,details_json,occurred_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'Executive','decision.recorded','decision',id,JSON.stringify({title,owner,meetingId,findingId}),at);
    return json(res,201,{decision:db.prepare('SELECT * FROM decision_records WHERE id=?').get(id),dashboard:dashboard()});
  }
const decisionOutcomeMatch=url.pathname.match(/^\/api\/decisions\/([\w-]+)\/outcome$/);
  if(req.method==='POST'&&decisionOutcomeMatch){const body=await readBody(req),actual=String(body.actualOutcome||'').trim(),status=String(body.status||'completed');if(actual.length<3||actual.length>1000||!['completed','reversed'].includes(status))return json(res,400,{error:'Provide an outcome and choose completed or reversed.'});const decision=db.prepare("SELECT * FROM decision_records WHERE id=? AND status='in_progress'").get(decisionOutcomeMatch[1]);if(!decision)return json(res,404,{error:'Open decision not found.'});const at=new Date().toISOString();db.prepare('UPDATE decision_records SET actual_outcome=?,status=?,reviewed_at=? WHERE id=?').run(actual,status,at,decision.id);db.prepare('INSERT INTO audit_log(id,actor,event_type,entity_type,entity_id,details_json,occurred_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),String(body.reviewer||'Executive').slice(0,120),'decision.outcome_recorded','decision',decision.id,JSON.stringify({status,actualOutcome:actual}),at);return json(res,200,{decision:db.prepare('SELECT * FROM decision_records WHERE id=?').get(decision.id),dashboard:dashboard()})}
  const taskMatch=url.pathname.match(/^\/api\/tasks\/([\w-]+)\/complete$/);
  if(req.method==='POST'&&taskMatch){const body=await readBody(req);const task=db.prepare("SELECT * FROM tasks WHERE id=? AND status='open'").get(taskMatch[1]);if(!task)return json(res,404,{error:'Open task not found.'});const at=new Date().toISOString(),outcome=String(body.outcome||'Completed and reviewed.').slice(0,1000);db.prepare("UPDATE tasks SET status='completed',completed_at=?,outcome=? WHERE id=?").run(at,outcome,task.id);db.prepare('INSERT INTO audit_log(id,actor,event_type,entity_type,entity_id,details_json,occurred_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),String(body.reviewer||'Executive').slice(0,120),'task.completed','task',task.id,JSON.stringify({outcome}),at);return json(res,200,{task:db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),dashboard:dashboard()})}
  if(req.method==='POST'&&url.pathname==='/api/scenarios/preview') {
    const body=await readBody(req),revenueChange=Number(body.revenueChangePct||0),expenseChange=Number(body.expenseChangePct||0),hiring=Number(body.additionalHeadcount||0);
    if(![revenueChange,expenseChange,hiring].every(Number.isFinite)||Math.abs(revenueChange)>100||Math.abs(expenseChange)>100||hiring<0||hiring>1000)return json(res,400,{error:'Scenario assumptions must be finite and within supported ranges.'});
    const get=k=>db.prepare('SELECT * FROM metric_snapshots WHERE metric_key=?').get(k),revenue=get('revenue'),margin=get('gross_margin'),cash=get('cash_runway');
    const baselineOperatingCost=revenue.value*.25,weeklySalaryPerHire=180000/52,baselineGrossProfit=revenue.value*margin.value,baselineContribution=baselineGrossProfit-baselineOperatingCost;
    const scenarioRevenue=revenue.value*(1+revenueChange/100),scenarioOperatingCost=baselineOperatingCost*(1+expenseChange/100)+hiring*weeklySalaryPerHire,scenarioGrossProfit=scenarioRevenue*margin.value,scenarioContribution=scenarioGrossProfit-scenarioOperatingCost;
    return json(res,200,{assumptions:{revenueChangePct:revenueChange,expenseChangePct:expenseChange,additionalHeadcount:hiring,annualSalaryPerHireBRL:180000,baselineOperatingCostPctRevenue:25},baseline:{weeklyRevenue:revenue.value,grossMargin:margin.value,weeklyGrossProfit:baselineGrossProfit,weeklyOperatingCostAssumption:baselineOperatingCost,weeklyOperatingContribution:baselineContribution,cashRunwayMonths:cash.value},scenario:{weeklyRevenue:scenarioRevenue,grossMargin:margin.value,weeklyGrossProfit:scenarioGrossProfit,weeklyOperatingCostAssumption:scenarioOperatingCost,weeklyOperatingContribution:scenarioContribution,cashRunwayMonths:cash.value},delta:{weeklyRevenue:scenarioRevenue-revenue.value,weeklyOperatingContribution:scenarioContribution-baselineContribution},note:'Illustrative sensitivity, not a forecast. Operating cost assumes 25% of current weekly revenue and BRL 180,000 annual salary per hire. Cash runway is shown unchanged because this demo lacks cash-balance and timing data. No source data or approved plan is changed.'});
  }  if (req.method === 'POST' && url.pathname === '/api/agents/run') { const results=runAllAgents(db); return json(res,201,{results,dashboard:dashboard()}); }
  const agentMatch=url.pathname.match(/^\/api\/agents\/([a-z-]+)\/run$/);
  if(req.method==='POST'&&agentMatch){try{return json(res,201,{result:runAgent(db,agentMatch[1]),dashboard:dashboard()})}catch(e){return json(res,404,{error:e.message})}}
  const reviewMatch=url.pathname.match(/^\/api\/proposals\/([\w-]+)\/review$/);
  if(req.method==='POST'&&reviewMatch){try{const body=await readBody(req);if(!['approved','rejected'].includes(body.decision))return json(res,400,{error:'Decision must be approved or rejected.'});const proposal=reviewProposal(db,reviewMatch[1],{decision:body.decision,reviewer:String(body.reviewer||'Executive').slice(0,120),note:String(body.note||'').slice(0,1000)});return json(res,200,{proposal,dashboard:dashboard()})}catch(e){return json(res,e.message.toLowerCase().includes('not found')?404:409,{error:e.message})}}
  if(url.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found.'});
  const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)); const full=path.resolve(__dirname,'..','public',requested); const root=path.resolve(__dirname,'..','public');
  if(!full.startsWith(root+path.sep)&&full!==root)return json(res,403,{error:'Forbidden'});
  fs.readFile(full,(error,content)=>{if(error){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':mime[path.extname(full)]||'application/octet-stream','cache-control':'no-cache'});res.end(content)});
};
const server=http.createServer((req,res)=>{Promise.resolve(routes(req,res)).catch(error=>json(res,400,{error:error.message||'Request failed.'}))});
server.listen(port,()=>console.log(`Company Pulse running at http://localhost:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0)})});
