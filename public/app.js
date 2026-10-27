'use strict';

// Company Pulse UI. Every dynamic value is rendered through h() (textContent), never innerHTML.
(() => {
  const state = { data: null, filter: 'all', loading: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  /** Element builder: attributes, event handlers (on*) and text/element children. */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  // Formatting
  const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
  const pct = v => `${Math.round(Number(v) * 100)}%`;
  const dateTime = iso => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const titleCase = s => String(s ?? '').replaceAll(/[-_]/g, ' ');
  const initials = name =>
    String(name)
      .split(/[ &]/)
      .filter(Boolean)
      .map(w => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  function formatValue(value, unit) {
    if (value === null || value === undefined) return '—';
    if (unit === 'BRL') return money(value);
    if (unit === 'ratio') return pct(value);
    if (unit === 'months') return `${Number(value).toFixed(1)} mo`;
    if (unit === 'x') return `${Number(value).toFixed(1)}×`;
    if (unit === 'people') return `${value} people`;
    return String(value);
  }
  const SEVERITY = { critical: 'Urgent', watch: 'Watch', info: 'Info' };
  const STATUS_TEXT = { off_track: 'Off target', on_track: 'On target', no_target: 'No target' };

  // Viewer permissions mirror the server's checks; the server remains the boundary.
  const can = permission => Boolean(state.data?.viewer?.permissions?.includes(permission));
  function actorName(actor) {
    if (!actor) return 'Unknown';
    if (actor.startsWith('user:')) return state.data?.personas.find(p => `user:${p.id}` === actor)?.name ?? actor.slice(5);
    if (actor.startsWith('agent:')) return `${titleCase(actor.slice(6))} agent`;
    return actor === 'system' || actor.startsWith('system:') ? 'System' : actor;
  }

  // API
  async function api(url, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error.name === 'AbortError' ? 'The request timed out.' : 'Network error. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 204) return null;
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(data?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  /** Runs fn once at a time for these buttons: disables them to block double submits. */
  async function busy(buttons, fn) {
    const list = [buttons].flat().filter(Boolean);
    if (list.some(b => b.getAttribute('aria-busy') === 'true')) return;
    list.forEach(b => {
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
    });
    try {
      return await fn();
    } finally {
      list.forEach(b => {
        b.removeAttribute('aria-busy');
        b.disabled = false;
      });
    }
  }

  let toastTimer;
  function toast(message, tone = 'info') {
    const el = $('#toast');
    el.textContent = message;
    el.dataset.tone = tone;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // Dialogs
  function openDetail({ kicker, title, content }) {
    $('#detail-kicker').textContent = kicker;
    $('#detail-title').textContent = title;
    $('#detail-content').replaceChildren(...[content].flat(Infinity).filter(Boolean));
    const dialog = $('#detail-dialog');
    if (!dialog.open) dialog.showModal();
    $('#detail-content').scrollTop = 0;
  }
  const closeDetail = () => $('#detail-dialog').open && $('#detail-dialog').close();
  const empty = (title, text) => h('div', { class: 'empty-state' }, h('strong', {}, title), text ? h('p', {}, text) : null);
  const definitionList = pairs =>
    h(
      'dl',
      { class: 'facts' },
      pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v))),
    );
  const table = (headings, rows) =>
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            headings.map(t => h('th', { scope: 'col' }, t)),
          ),
        ),
        h('tbody', {}, rows),
      ),
    );

  // Loading
  const LIVE_REGIONS = ['#metric-grid', '#finding-list', '#proposal-list', '#task-list', '#decision-list', '#agent-list'];
  function skeletons() {
    $('#metric-grid').replaceChildren(
      ...Array.from({ length: 6 }, () => h('div', { class: 'metric-card skeleton', 'aria-hidden': 'true' })),
    );
    for (const id of ['#finding-list', '#proposal-list', '#task-list']) {
      $(id).replaceChildren(...Array.from({ length: 3 }, () => h('div', { class: 'row-skeleton skeleton', 'aria-hidden': 'true' })));
    }
  }

  async function load({ quiet = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (!state.data) skeletons();
    LIVE_REGIONS.forEach(id => $(id).setAttribute('aria-busy', 'true'));
    try {
      state.data = await api('/api/dashboard');
      $('#load-error').hidden = true;
      render();
    } catch (error) {
      if (error.status === 401) return openPersonas();
      $('#load-error-detail').textContent = error.message;
      $('#load-error').hidden = false;
      $('#next-step-title').textContent = 'Your workspace could not load';
      $('#next-step-detail').textContent = 'Nothing was changed. Try again in a moment.';
      if (!state.data) $('#metric-grid').replaceChildren(empty('Indicators unavailable.', 'Reload the workspace to try again.'));
      if (!quiet) toast(`Could not load workspace: ${error.message}`, 'error');
    } finally {
      state.loading = false;
      LIVE_REGIONS.forEach(id => $(id).setAttribute('aria-busy', 'false'));
    }
  }

  /** Applies a dashboard returned by a write without a second round trip. */
  function apply(dashboard) {
    state.data = dashboard;
    render();
  }

  // Rendering
  const metric = key => state.data.metrics.find(m => m.metric_key === key);
  const tone = m => (m.stale ? 'warn' : m.status === 'off_track' ? 'bad' : 'ok');

  function metricCard(m, lead) {
    const statusText = m.stale ? 'Stale source' : STATUS_TEXT[m.status];
    const comparison =
      m.target === null || m.target === undefined
        ? `Prior ${formatValue(m.prior_value, m.unit)}`
        : `Target ${formatValue(m.target, m.unit)}${m.variance_to_target !== null && m.unit !== 'ratio' ? ` · ${m.variance_to_target > 0 ? '+' : ''}${Math.round(m.variance_to_target * 100)}%` : ''}`;
    return h(
      'button',
      {
        class: `metric-card${lead ? ' lead' : ''}`,
        type: 'button',
        onclick: () => openMetric(m.metric_key),
        'aria-label': `${m.label}: ${formatValue(m.value, m.unit)}, ${statusText}. ${comparison}. Open definition and source.`,
      },
      h('span', { class: 'metric-top' }, h('span', {}, m.label), h('span', { class: 'metric-domain' }, titleCase(m.domain).toUpperCase())),
      h('span', { class: 'metric-value' }, formatValue(m.value, m.unit)),
      h('span', { class: 'metric-compare' }, comparison),
      h('span', { class: `status status-${tone(m)}` }, h('span', { class: `pip pip-${tone(m)}`, 'aria-hidden': 'true' }), statusText),
    );
  }

  function renderMetrics() {
    const keys = ['revenue', 'cash_runway', 'gross_margin', 'pipeline_coverage', 'sla_attainment'];
    const cards = keys
      .map(metric)
      .filter(Boolean)
      .map((m, i) => metricCard(m, i === 0));
    const stale = state.data.metrics.filter(m => m.stale).sort((a, b) => b.freshness_hours - a.freshness_hours);
    const t = stale.length ? 'warn' : 'ok';
    cards.push(
      h(
        'button',
        {
          class: 'metric-card',
          type: 'button',
          onclick: openDataHealth,
          'aria-label': `Data freshness: ${stale.length} stale sources. Open data health.`,
        },
        h('span', { class: 'metric-top' }, h('span', {}, 'Data freshness'), h('span', { class: 'metric-domain' }, 'DATA HEALTH')),
        h('span', { class: 'metric-value' }, stale.length ? `${Math.round(stale[0].freshness_hours)}h old` : 'Current'),
        h('span', { class: 'metric-compare' }, stale.length ? `Oldest: ${stale[0].source}` : 'All simulated sources fresh'),
        h(
          'span',
          { class: `status status-${t}` },
          h('span', { class: `pip pip-${t}`, 'aria-hidden': 'true' }),
          stale.length ? `${stale.length} stale` : 'Fresh',
        ),
      ),
    );
    $('#metric-grid').replaceChildren(...cards);
  }

  function renderFindings() {
    const all = state.data.findings;
    const selected = all.filter(f => state.filter === 'all' || f.severity === state.filter);
    $('#signal-count').textContent = all.length;
    $('#finding-list').replaceChildren(
      ...(selected.length
        ? selected
            .slice(0, 8)
            .map(f =>
              h(
                'button',
                { class: `finding sev-${f.severity}`, type: 'button', onclick: () => openFinding(f.id) },
                h('span', { class: 'finding-mark', 'aria-hidden': 'true' }, f.severity === 'critical' ? '!' : '↗'),
                h(
                  'span',
                  { class: 'finding-content' },
                  h(
                    'span',
                    { class: 'finding-title-line' },
                    h('strong', {}, f.title),
                    h('span', { class: 'severity-label' }, SEVERITY[f.severity] ?? f.severity),
                  ),
                  h('span', { class: 'finding-text' }, f.explanation),
                  h(
                    'span',
                    { class: 'finding-foot' },
                    h('span', {}, `${titleCase(f.agent_key)} agent`),
                    h('span', {}, `${f.evidence.length} source${f.evidence.length === 1 ? '' : 's'} cited`),
                    h('span', {}, `Confidence ${pct(f.confidence)}`),
                    f.limitations?.length ? h('span', { class: 'qualified' }, 'Provisional · data caveat') : null,
                  ),
                ),
                h('span', { class: 'finding-arrow', 'aria-hidden': 'true' }, '›'),
              ),
            )
        : [empty('You’re all caught up.', 'No signals match this filter. Choose “All” to see the complete picture.')]),
    );
  }

  function renderProposals() {
    const pending = state.data.proposals.filter(p => p.status === 'pending');
    $('#pending-count').textContent = pending.length;
    $('#open-count').textContent = `${pending.length} ${pending.length === 1 ? 'recommendation' : 'recommendations'} to review`;
    $('#proposal-list').replaceChildren(
      ...(pending.length
        ? pending.slice(0, 6).map(p =>
            h(
              'div',
              { class: 'row' },
              h('span', { class: 'row-symbol', 'aria-hidden': 'true' }, '↗'),
              h(
                'div',
                { class: 'row-main' },
                h('strong', {}, p.title),
                h('small', {}, p.rationale),
                h(
                  'small',
                  { class: 'muted' },
                  `${titleCase(p.agent_key)} agent · Tier ${p.tier ?? 'B'} · proposed owner ${p.payload?.task?.owner ?? p.payload?.suggested_owner ?? '—'}`,
                ),
              ),
              h(
                'button',
                {
                  class: 'secondary-button small',
                  type: 'button',
                  onclick: () => openProposal(p.id),
                  'aria-label': `Review “${p.title}”`,
                },
                'Review',
              ),
            ),
          )
        : [empty('Nothing waiting on you.', 'New recommendations will appear here for review.')]),
    );
  }

  function renderTasks() {
    const tasks = state.data.tasks;
    const manage = can('tasks.manage');
    $('#task-count').textContent = tasks.filter(t => t.status === 'open').length;
    $('#task-list').replaceChildren(
      ...(tasks.length
        ? tasks.slice(0, 6).map(t =>
            h(
              'div',
              { class: 'row' },
              h('span', { class: `task-symbol${t.status === 'open' ? '' : ' done'}`, 'aria-hidden': 'true' }),
              h(
                'div',
                { class: 'row-main' },
                h('strong', {}, t.title),
                h(
                  'small',
                  {},
                  `${t.owner} · ${t.due_date ? `Due ${t.due_date}` : 'No due date'} · ${t.proposal_id ? 'from an approved recommendation' : `created by ${actorName(t.created_by)}`}`,
                ),
              ),
              t.status !== 'open'
                ? h('span', { class: 'status status-ok' }, h('span', { class: 'pip pip-ok', 'aria-hidden': 'true' }), 'Completed')
                : manage
                  ? h(
                      'button',
                      {
                        class: 'secondary-button small',
                        type: 'button',
                        onclick: e => completeTask(t, e.currentTarget),
                        'aria-label': `Mark “${t.title}” done`,
                      },
                      'Mark done',
                    )
                  : h('span', { class: 'status' }, 'Open'),
            ),
          )
        : [empty('No follow-ups yet.', 'Approved recommendations and meeting decisions create work to track here.')]),
    );
  }

  function renderDecisions() {
    const decisions = state.data.decisions;
    const manage = can('decisions.manage');
    $('#decision-list').replaceChildren(
      ...(decisions.length
        ? decisions.slice(0, 4).map(d =>
            h(
              'div',
              { class: 'row' },
              h(
                'div',
                { class: 'row-main' },
                h('strong', {}, d.title),
                h('small', {}, d.decision),
                h(
                  'small',
                  { class: 'muted' },
                  `${d.owner} · ${titleCase(d.status)}${d.due_date ? ` · due ${d.due_date}` : ''} · expected: ${d.expected_outcome}`,
                ),
                d.actual_outcome ? h('small', {}, `Outcome: ${d.actual_outcome}`) : null,
              ),
              d.status === 'in_progress' && manage
                ? h(
                    'button',
                    {
                      class: 'secondary-button small',
                      type: 'button',
                      onclick: () => openOutcome(d),
                      'aria-label': `Record outcome for “${d.title}”`,
                    },
                    'Record outcome',
                  )
                : null,
            ),
          )
        : [empty('No leadership decisions yet.', 'Record a decision to give it an owner and an expected outcome.')]),
    );
  }

  function renderAgents() {
    const runnable = can('agents.run');
    $('#agent-list').replaceChildren(
      ...state.data.agents.map(a => {
        const run = a.lastRun;
        const failed = run?.status === 'failed';
        const label = run ? (failed ? 'Last run failed' : `Ran ${dateTime(run.completed_at)}`) : 'Not run yet';
        return h(
          'article',
          { class: 'agent-card' },
          h(
            'div',
            { class: 'agent-card-top' },
            h('span', { class: 'agent-monogram', 'aria-hidden': 'true' }, initials(a.name)),
            runnable
              ? h(
                  'button',
                  {
                    class: 'icon-button',
                    type: 'button',
                    'aria-label': `Run ${a.name} agent`,
                    title: `Run ${a.name}`,
                    onclick: e => runAgent(a, e.currentTarget),
                  },
                  '↗',
                )
              : null,
          ),
          h('h3', {}, a.name),
          h('p', {}, a.description),
          h('p', { class: 'agent-state' }, h('span', { class: `pip pip-${failed ? 'bad' : 'ok'}`, 'aria-hidden': 'true' }), label),
        );
      }),
    );
  }

  const briefingPoints = b =>
    (b.body.split('Material signals')[1]?.split('Decisions awaiting review')[0] ?? '')
      .split('\n')
      .map(x => x.trim())
      .filter(x => x.startsWith('- '))
      .map(x => x.slice(2).replace(/^\[[A-Z]+\] /, ''));

  function renderBrief() {
    const b = state.data.briefings[0];
    $('#brief-open').disabled = !b;
    $('#meeting-confirm').disabled = !b;
    if (!b) {
      $('#brief-points').replaceChildren(h('li', {}, 'No briefing yet. Run the Meeting Prep agent to draft one.'));
      $('#brief-meta').textContent = 'No briefing drafted';
      return;
    }
    $('#brief-title').textContent = b.title;
    const points = briefingPoints(b).map(p => p.split(':')[0]);
    $('#brief-points').replaceChildren(
      ...(points.length ? points.slice(0, 4).map(p => h('li', {}, p)) : [h('li', {}, 'No material changes in the latest run.')]),
    );
    $('#brief-meta').textContent = `${b.finding_ids.length} cited signals · drafted ${dateTime(b.created_at)}`;
  }

  function renderNextStep() {
    const pending = state.data.proposals.filter(p => p.status === 'pending').length;
    const urgent = state.data.findings.find(f => f.severity === 'critical');
    const openTasks = state.data.tasks.filter(t => t.status === 'open').length;
    const go = id => () => $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    let step;
    if (pending && can('proposals.review'))
      step = [
        `${pending} recommendations need your review`,
        'See what the agents found. Nothing happens until a person approves it.',
        'Review recommendations',
        go('#decisions'),
      ];
    else if (urgent) step = ['A company signal needs attention', urgent.title, 'Explore signal', () => openFinding(urgent.id)];
    else if (openTasks)
      step = [`${openTasks} follow-ups in motion`, 'Check progress and mark completed work as done.', 'View follow-ups', go('#decisions')];
    else step = ['You’re all caught up', 'No reviews or urgent follow-ups are waiting right now.', 'Explore signals', go('#signals')];
    const [title, detail, label, action] = step;
    $('#next-step-title').textContent = title;
    $('#next-step-detail').textContent = detail;
    const button = $('#next-step-action');
    button.textContent = label;
    button.onclick = action;
    button.disabled = false;
  }

  function renderHeader() {
    const v = state.data.viewer;
    const hour = new Date().getHours();
    $('#greeting').textContent = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${v.name.split(' ')[0]}.`;
    $('#persona-name').textContent = v.name;
    $('#persona-role').textContent = titleCase(v.role);
    $('#persona-initials').textContent = initials(v.name);
    $('#date-line').textContent = `WEEKLY OPERATING REVIEW · ${state.data.company.period.toUpperCase()}`;
    const stale = state.data.metrics.filter(m => m.stale).length;
    $('#refresh-time').textContent = state.data.company.updatedAt
      ? `Agents ran ${dateTime(state.data.company.updatedAt)}`
      : 'Agents have not run yet';
    $('#data-summary').textContent = `${state.data.metrics.length} indicators · ${stale} stale · simulated sources`;
  }

  /** Hides static controls the current role cannot use (the API answers 403 anyway). */
  function applyPermissions() {
    for (const el of $$('[data-requires]')) el.hidden = !can(el.dataset.requires);
  }

  function render() {
    if (!state.data) return;
    renderHeader();
    renderMetrics();
    renderFindings();
    renderProposals();
    renderTasks();
    renderDecisions();
    renderAgents();
    renderBrief();
    renderNextStep();
    applyPermissions();
  }

  // Detail views
  function openMetric(key) {
    const m = metric(key);
    if (!m) return;
    const citing = state.data.findings.filter(f => f.evidence.some(e => e.metric_key === key));
    openDetail({
      kicker: `${titleCase(m.domain).toUpperCase()} · METRIC`,
      title: m.label,
      content: [
        h('p', { class: 'lede' }, m.definition ?? 'No definition recorded.'),
        m.stale || m.low_confidence
          ? h(
              'div',
              { class: 'callout warn', role: 'note' },
              h('strong', {}, 'Provisional data'),
              h('p', {}, 'This source is stale or below the reliability threshold. Signals that depend on it are qualified.'),
            )
          : null,
        definitionList([
          ['Value', formatValue(m.value, m.unit)],
          ['Target', m.target === null ? 'None' : formatValue(m.target, m.unit)],
          ['Prior period', formatValue(m.prior_value, m.unit)],
          ['Status', STATUS_TEXT[m.status]],
          ['Better when', m.direction === 'lower' ? 'Lower' : 'Higher'],
          ['Period', `${m.period} · ${m.grain ?? '—'}`],
          ['Source', `${m.source} (simulated connector)`],
          ['Observed', dateTime(m.observed_at)],
          ['Freshness', `${m.freshness_hours}h${m.stale ? ' · stale' : ''}`],
          ['Source confidence', `${pct(m.confidence)}${m.low_confidence ? ' · below threshold' : ''}`],
        ]),
        h('h3', {}, 'Signals citing this metric'),
        citing.length
          ? h(
              'ul',
              { class: 'link-list' },
              citing.map(f =>
                h('li', {}, h('button', { class: 'text-button', type: 'button', onclick: () => openFinding(f.id) }, f.title)),
              ),
            )
          : h('p', { class: 'muted' }, 'No current signal cites this metric.'),
      ],
    });
  }

  function openDataHealth() {
    const rows = state.data.domainHealth.map(d =>
      h('tr', {}, h('th', { scope: 'row' }, titleCase(d.domain)), h('td', {}, d.count), h('td', {}, d.stale), h('td', {}, d.attention)),
    );
    const flagged = state.data.metrics.filter(m => m.stale || m.low_confidence);
    openDetail({
      kicker: 'DATA HEALTH',
      title: 'Source freshness and confidence',
      content: [
        h(
          'p',
          { class: 'lede' },
          'All sources are simulated fixtures. Stale or low-confidence data qualifies every signal that depends on it.',
        ),
        table(['Domain', 'Metrics', 'Stale', 'Off target'], rows),
        h('h3', {}, 'Needs verification'),
        flagged.length
          ? h(
              'ul',
              { class: 'link-list' },
              flagged.map(m =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { class: 'text-button', type: 'button', onclick: () => openMetric(m.metric_key) },
                    `${m.label} — ${m.freshness_hours}h old, ${pct(m.confidence)} confidence`,
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'Every source is fresh and reliable.'),
      ],
    });
  }

  function openFinding(id) {
    const f = state.data.findings.find(x => x.id === id);
    if (!f) return;
    const fact = f.facts?.[0] ?? {};
    const rows = f.evidence.map(e =>
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, e.label),
        h('td', {}, formatValue(e.captured_value, e.unit)),
        h('td', {}, e.captured_source),
        h('td', {}, dateTime(e.captured_at)),
        h('td', {}, titleCase(e.role)),
      ),
    );
    openDetail({
      kicker: `${titleCase(f.agent_key).toUpperCase()} AGENT · ${(SEVERITY[f.severity] ?? f.severity).toUpperCase()}`,
      title: f.title,
      content: [
        h('p', { class: 'lede' }, f.explanation),
        f.limitations?.length
          ? h(
              'div',
              { class: 'callout warn', role: 'note' },
              h('strong', {}, 'Data caveat'),
              h(
                'ul',
                {},
                f.limitations.map(l => h('li', {}, l)),
              ),
            )
          : null,
        h('h3', {}, 'Why this signal fired'),
        definitionList([
          ['Rule', f.rule_id ?? '—'],
          ['Comparison', fact.comparison ? titleCase(fact.comparison) : undefined],
          ['Observed value', fact.value !== undefined ? formatValue(fact.value, fact.unit) : undefined],
          ['Threshold', fact.threshold !== undefined && fact.threshold !== null ? formatValue(fact.threshold, fact.unit) : undefined],
          ['Period', fact.period],
          ['Confidence', `${pct(f.confidence)} · supports review, does not establish cause`],
        ]),
        h('h3', {}, 'Evidence'),
        rows.length
          ? table(['Metric', 'Value', 'Source', 'Observed', 'Role'], rows)
          : h('p', { class: 'muted' }, 'No source observation is available for this signal.'),
        f.hypotheses?.length
          ? [
              h('h3', {}, 'Questions to investigate'),
              h(
                'ul',
                {},
                f.hypotheses.map(x => h('li', {}, x)),
              ),
            ]
          : null,
      ],
    });
  }

  function openProposal(id) {
    const p = state.data.proposals.find(x => x.id === id);
    if (!p) return;
    const task = p.payload?.task;
    const finding = state.data.findings.find(f => f.id === p.finding_id);
    const error = h('p', { class: 'form-error', role: 'alert' });
    const review = decision =>
      busy($$('#detail-content [data-review]'), async () => {
        error.textContent = '';
        try {
          const result = await api(`/api/proposals/${encodeURIComponent(p.id)}/review`, {
            method: 'POST',
            body: { decision, note: 'Reviewed in executive workspace.' },
          });
          closeDetail();
          apply(result.dashboard);
          toast(
            decision === 'approved'
              ? 'Approved. An internal follow-up was created; nothing external was executed.'
              : 'Declined. No action was taken.',
            'success',
          );
        } catch (err) {
          error.textContent = err.message;
        }
      });
    openDetail({
      kicker: `AGENT RECOMMENDATION · ${titleCase(p.agent_key).toUpperCase()}`,
      title: p.title,
      content: [
        h('p', { class: 'lede' }, p.rationale),
        h(
          'div',
          { class: 'callout' },
          h('strong', {}, 'What approval means'),
          h(
            'p',
            {},
            task
              ? `Approval creates one internal follow-up — “${task.title}”, owned by ${task.owner}. No external system is changed.`
              : 'Approval is recorded in the demo workspace. No external system is changed.',
          ),
        ),
        definitionList([
          ['Action type', titleCase(p.action_type)],
          ['Tier', `${p.tier ?? 'B'} · internal and reversible`],
          ['Originating signal', finding?.title ?? p.finding_title ?? '—'],
          ['Proposed', dateTime(p.created_at)],
          ['Payload fingerprint', p.payload_hash ? `${p.payload_hash.slice(0, 12)}…` : undefined],
        ]),
        finding
          ? h(
              'button',
              { class: 'text-button', type: 'button', onclick: () => openFinding(finding.id) },
              'Inspect the evidence behind this recommendation',
            )
          : null,
        error,
        can('proposals.review')
          ? h(
              'div',
              { class: 'dialog-actions' },
              h(
                'button',
                { class: 'secondary-button', type: 'button', 'data-review': 'rejected', onclick: () => review('rejected') },
                'Decline',
              ),
              h(
                'button',
                { class: 'primary-button', type: 'button', 'data-review': 'approved', onclick: () => review('approved') },
                'Approve recommendation',
              ),
            )
          : h('p', { class: 'callout' }, 'Your role can view recommendations but not approve or decline them.'),
      ],
    });
  }

  /** Form with labelled fields, native constraints and an error region announced to screen readers. */
  function formView({ id, fields, submitLabel, onSubmit }) {
    const error = h('p', { class: 'form-error', role: 'alert', id: `${id}-error` });
    const submit = h('button', { class: 'primary-button', type: 'submit' }, submitLabel);
    const form = h('form', { id, class: 'form', novalidate: true }, fields, error, submit);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      error.textContent = '';
      if (!form.checkValidity()) {
        const invalid = form.querySelector(':invalid');
        const label = invalid?.closest('label')?.querySelector('span')?.textContent ?? 'A field';
        error.textContent = `${label}: ${invalid?.validationMessage || 'check this value.'}`;
        invalid?.focus();
        return;
      }
      await busy(submit, async () => {
        try {
          await onSubmit(Object.fromEntries(new FormData(form)));
        } catch (err) {
          error.textContent = err.message;
        }
      });
    });
    return form;
  }
  const field = (label, control, hint) =>
    h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'muted' }, hint) : null);

  function openDecisionForm() {
    openDetail({
      kicker: 'LEADERSHIP RECORD',
      title: 'Record a decision',
      content: [
        h('p', { class: 'lede' }, 'Capture the choice, who owns the follow-through, and what result you expect.'),
        formView({
          id: 'decision-form',
          submitLabel: 'Save decision',
          fields: [
            field(
              'Decision title',
              h('input', {
                name: 'title',
                required: true,
                minlength: 3,
                maxlength: 180,
                placeholder: 'e.g. Rebalance Q4 sales coverage',
                autocomplete: 'off',
              }),
            ),
            field(
              'What was decided',
              h('textarea', {
                name: 'decision',
                required: true,
                minlength: 3,
                maxlength: 1000,
                placeholder: 'Describe the approved choice',
              }),
            ),
            field('Owner', h('input', { name: 'owner', required: true, minlength: 2, maxlength: 120, placeholder: 'Name or role' })),
            field(
              'Expected outcome',
              h('input', {
                name: 'expectedOutcome',
                required: true,
                minlength: 3,
                maxlength: 1000,
                placeholder: 'What should improve, and by when?',
              }),
            ),
            field('Follow-up date', h('input', { name: 'dueDate', type: 'date' }), 'Optional'),
            field(
              'Related signal',
              h(
                'select',
                { name: 'findingId' },
                h('option', { value: '' }, 'No linked signal'),
                state.data.findings.map(f => h('option', { value: f.id }, f.title)),
              ),
            ),
          ],
          onSubmit: async data => {
            const result = await api('/api/decisions', { method: 'POST', body: data });
            closeDetail();
            apply(result.dashboard);
            toast('Decision recorded with owner and expected outcome.', 'success');
          },
        }),
      ],
    });
  }

  function openOutcome(decision) {
    openDetail({
      kicker: 'DECISION REVIEW',
      title: 'Record the result',
      content: [
        h('p', { class: 'lede' }, `${decision.title} · owner: ${decision.owner}`),
        h('div', { class: 'callout' }, h('strong', {}, 'Expected outcome'), h('p', {}, decision.expected_outcome)),
        formView({
          id: 'outcome-form',
          submitLabel: 'Save outcome',
          fields: [
            field(
              'What happened?',
              h('textarea', {
                name: 'actualOutcome',
                required: true,
                minlength: 3,
                maxlength: 1000,
                placeholder: 'Compare the result with the expected outcome',
              }),
            ),
            field(
              'Status',
              h(
                'select',
                { name: 'status' },
                h('option', { value: 'completed' }, 'Completed'),
                h('option', { value: 'reversed' }, 'Reversed'),
              ),
            ),
          ],
          onSubmit: async data => {
            const result = await api(`/api/decisions/${encodeURIComponent(decision.id)}/outcome`, { method: 'POST', body: data });
            closeDetail();
            apply(result.dashboard);
            toast('Decision outcome recorded.', 'success');
          },
        }),
      ],
    });
  }

  function openScenario() {
    const output = h(
      'div',
      { class: 'scenario-result', 'aria-live': 'polite' },
      'Adjust the assumptions to compare against the current demo baseline.',
    );
    const number = (name, value, min, max) =>
      h('input', { name, type: 'number', inputmode: 'numeric', min, max, value, step: 1, required: true });
    openDetail({
      kicker: 'ILLUSTRATIVE PLANNING',
      title: 'What if?',
      content: [
        h('p', { class: 'lede' }, 'Explore how simple, explicit assumptions change the weekly operating picture.'),
        formView({
          id: 'scenario-form',
          submitLabel: 'Calculate scenario',
          fields: h(
            'div',
            { class: 'scenario-grid' },
            field('Revenue change (%)', number('revenueChangePct', 5, -100, 100)),
            field('Expense change (%)', number('expenseChangePct', 0, -100, 100)),
            field('Additional hires', number('additionalHeadcount', 0, 0, 1000)),
          ),
          onSubmit: async data => {
            const result = await api('/api/scenarios/preview', {
              method: 'POST',
              body: {
                revenueChangePct: Number(data.revenueChangePct),
                expenseChangePct: Number(data.expenseChangePct),
                additionalHeadcount: Number(data.additionalHeadcount),
              },
            });
            output.replaceChildren(
              definitionList([
                ['Scenario revenue / week', money(result.scenario.weeklyRevenue)],
                ['Baseline revenue / week', money(result.baseline.weeklyRevenue)],
                ['Operating contribution change', money(result.delta.weeklyOperatingContribution)],
                ['Cash runway', `${result.scenario.cashRunwayMonths} mo (unchanged)`],
              ]),
              h('p', { class: 'muted' }, result.note),
            );
          },
        }),
        output,
      ],
    });
  }

  async function openPersonas() {
    const dialog = $('#persona-dialog');
    const list = $('#persona-list');
    if (!dialog.open) dialog.showModal();
    let personas = state.data?.personas;
    let current = state.data?.viewer?.id;
    if (!personas) {
      list.replaceChildren(h('p', { class: 'muted' }, 'Loading personas…'));
      try {
        const session = await api('/api/session');
        personas = session.personas;
        current = session.viewer?.id;
      } catch (error) {
        list.replaceChildren(h('p', { class: 'form-error', role: 'alert' }, error.message));
        return;
      }
    }
    list.replaceChildren(
      ...personas.map(p =>
        h(
          'button',
          {
            class: 'persona-option',
            type: 'button',
            'aria-pressed': String(p.id === current),
            onclick: e => switchPersona(p, e.currentTarget),
          },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.name)),
          h('span', { class: 'persona-option-text' }, h('strong', {}, p.name), h('small', {}, `${p.title} · ${titleCase(p.role)}`)),
        ),
      ),
    );
  }

  async function switchPersona(persona, button) {
    await busy(button, async () => {
      try {
        await api('/api/session', { method: 'POST', body: { personaId: persona.id } });
        $('#persona-dialog').close();
        await load({ quiet: true });
        toast(`Now viewing as ${persona.name} (${titleCase(persona.role)}).`, 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function showAudit() {
    const list = $('#audit-list');
    list.replaceChildren(h('p', { class: 'muted' }, 'Loading audit trail…'));
    if (!$('#audit-dialog').open) $('#audit-dialog').showModal();
    try {
      const events = await api('/api/audit');
      list.replaceChildren(
        ...(events.length
          ? events.map(x =>
              h(
                'div',
                { class: 'audit-row' },
                h('time', { datetime: x.occurred_at }, dateTime(x.occurred_at)),
                h(
                  'div',
                  {},
                  h('strong', {}, titleCase(x.event_type.replaceAll('.', ' '))),
                  h(
                    'p',
                    {},
                    `${actorName(x.actor)} · ${titleCase(x.entity_type)} · ${x.entity_id.slice(0, 22)}${x.entity_id.length > 22 ? '…' : ''}`,
                  ),
                ),
              ),
            )
          : [empty('No events recorded.')]),
      );
    } catch (error) {
      list.replaceChildren(
        h('div', { class: 'callout warn', role: 'alert' }, h('strong', {}, 'Could not load the audit trail.'), h('p', {}, error.message)),
      );
    }
  }

  // Commands (each request carries an Idempotency-Key, so a retried request never runs twice)
  // getRandomValues also works outside secure contexts, unlike randomUUID.
  const idempotencyKey = () =>
    `ui-${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')}`;
  const runButtons = () => [$('#run-all'), $('#run-all-bottom')];
  async function runAll() {
    await busy(runButtons(), async () => {
      try {
        const result = await api('/api/agents/run', { method: 'POST', body: {}, headers: { 'idempotency-key': idempotencyKey() } });
        const failed = result.results.filter(r => r.status === 'failed').length;
        apply(result.dashboard);
        toast(
          failed
            ? `${result.results.length - failed} agents finished; ${failed} failed and kept no partial output.`
            : 'All six agents completed a fresh review.',
          failed ? 'error' : 'success',
        );
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function runAgent(agent, button) {
    await busy(button, async () => {
      try {
        const result = await api(`/api/agents/${encodeURIComponent(agent.key)}/run`, {
          method: 'POST',
          body: {},
          headers: { 'idempotency-key': idempotencyKey() },
        });
        apply(result.dashboard);
        toast(
          `${agent.name} finished: ${result.result.findings.length} findings, ${result.result.proposals.length} new recommendations.`,
          'success',
        );
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function completeTask(task, button) {
    await busy(button, async () => {
      try {
        const result = await api(`/api/tasks/${encodeURIComponent(task.id)}/complete`, {
          method: 'POST',
          body: { outcome: 'Owner marked the follow-up complete.' },
        });
        apply(result.dashboard);
        toast('Follow-up marked complete and added to the audit trail.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function saveMeeting(button) {
    const b = state.data?.briefings[0];
    if (!b) return;
    await busy(button, async () => {
      try {
        const result = await api('/api/meetings', { method: 'POST', body: { title: b.title, briefingId: b.id, agenda: b.body } });
        apply(result.dashboard);
        toast('Meeting brief saved with its source briefing.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function openBriefing() {
    const b = state.data?.briefings[0];
    if (!b) return;
    const blocks = b.body.split('\n\n').map(block => {
      const [heading, ...lines] = block.split('\n');
      const items = lines.filter(l => l.startsWith('- '));
      return items.length
        ? [
            h('h3', {}, heading),
            h(
              'ul',
              {},
              items.map(l => h('li', {}, l.slice(2))),
            ),
          ]
        : h('p', {}, block);
    });
    openDetail({ kicker: `EXECUTIVE BRIEFING · ${b.period}`, title: b.title, content: blocks });
  }

  // Wiring
  document.addEventListener('DOMContentLoaded', () => {
    runButtons().forEach(b => b.addEventListener('click', runAll));
    $('#refresh').addEventListener('click', e => busy(e.currentTarget, () => load()));
    $('#load-retry').addEventListener('click', e => busy(e.currentTarget, () => load()));
    $('#scenario-open').addEventListener('click', openScenario);
    $('#audit-open').addEventListener('click', showAudit);
    $('#footer-audit').addEventListener('click', showAudit);
    $('#decision-create').addEventListener('click', openDecisionForm);
    $('#brief-open').addEventListener('click', openBriefing);
    $('#meeting-confirm').addEventListener('click', e => saveMeeting(e.currentTarget));
    $('#persona-open').addEventListener('click', openPersonas);
    $$('.filter').forEach(btn =>
      btn.addEventListener('click', () => {
        $$('.filter').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
        state.filter = btn.dataset.filter;
        if (state.data) renderFindings();
      }),
    );
    $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    // A click on the backdrop (outside the dialog box) closes it.
    $$('dialog').forEach(d =>
      d.addEventListener('click', e => {
        if (e.target !== d) return;
        const r = d.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
      }),
    );
    const menu = $('#menu-toggle');
    const setMenu = open => {
      $('#topnav').classList.toggle('open', open);
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    };
    menu.addEventListener('click', () => setMenu(!$('#topnav').classList.contains('open')));
    $$('.topnav a').forEach(a =>
      a.addEventListener('click', () => {
        setMenu(false);
        $$('.topnav a').forEach(x => x.removeAttribute('aria-current'));
        a.setAttribute('aria-current', 'page');
      }),
    );
    // Without a session (and no server default persona) ask for one instead of requesting the dashboard.
    api('/api/session')
      .then(session => (session.viewer ? load() : openPersonas()))
      .catch(() => load());
  });
})();
