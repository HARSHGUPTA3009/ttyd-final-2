export const PAGE = `<!doctype html><meta charset=utf-8><title>Talk to your data</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
 :root{
   color-scheme:light;
   --bg:#f7f8fa; --card:#ffffff; --ink:#12151a; --muted:#6b7280; --line:#e4e7ec;
   --accent:#2563eb; --ok:#15803d; --okbg:#ecfdf3; --warn:#b45309; --warnbg:#fffbeb;
   --info:#1d4ed8; --infobg:#eff6ff; --bad:#b91c1c; --badbg:#fef2f2;
 }
 *{box-sizing:border-box}
 body{background:var(--bg);color:var(--ink);margin:0;padding:40px 20px 80px;
      font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
 .wrap{max-width:900px;margin:0 auto}
 header{margin-bottom:22px}
 h1{font-size:22px;font-weight:650;letter-spacing:-.02em;margin:0}
 .sub{color:var(--muted);font-size:13.5px;margin-top:5px}
 .tabs{display:flex;gap:8px;margin:20px 0 14px}
 .tab{padding:7px 15px;border-radius:9px;border:1px solid var(--line);background:var(--card);
      color:var(--muted);cursor:pointer;font:inherit;font-size:13px;transition:.15s}
 .tab:hover{border-color:#cfd4dc}
 .tab.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:500}
 input,select{width:100%;padding:13px 15px;background:var(--card);border:1px solid var(--line);
              border-radius:11px;color:inherit;font:inherit;transition:.15s}
 input{box-shadow:0 1px 2px rgba(16,24,40,.04)}
 input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
 .card{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:18px;
       margin-top:16px;box-shadow:0 1px 2px rgba(16,24,40,.04)}

 .flow{display:flex;flex-wrap:wrap;gap:7px;align-items:stretch}
 .step{flex:1 1 108px;min-width:108px;border:1px solid var(--line);border-radius:10px;
       padding:9px 10px;background:#fbfcfd;opacity:.45;transition:.25s}
 .step .name{font-size:12px;font-weight:600;letter-spacing:.01em}
 .step .note{font-size:10.5px;color:var(--muted);margin-top:3px;min-height:13px;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .step.run{opacity:1;border-color:var(--accent);background:var(--infobg);
           animation:pulse 1s ease-in-out infinite}
 .step.ok{opacity:1;border-color:#a6e9c1;background:var(--okbg)}
 .step.ok .name{color:var(--ok)}
 .step.warn{opacity:1;border-color:#f2d08a;background:var(--warnbg)}
 .step.warn .name{color:var(--warn)}
 .step.fail{opacity:1;border-color:#f3b4b4;background:var(--badbg)}
 .step.fail .name{color:var(--bad)}
 .step.skip{opacity:.3}
 @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.16)}50%{box-shadow:0 0 0 5px rgba(37,99,235,0)}}
 .flowhead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:11px}
 .flowhead b{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
 .flowhead span{font-size:12px;color:var(--muted)}

 .tag{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.06em;
      text-transform:uppercase;padding:4px 10px;border-radius:999px}
 .answer{background:var(--okbg);color:var(--ok)}
 .clarify{background:var(--warnbg);color:var(--warn)}
 .refuse{background:var(--infobg);color:var(--info)}
 .error{background:var(--badbg);color:var(--bad)}
 .body{white-space:pre-wrap;margin-top:11px;font-size:15px}
 .meta{color:var(--muted);font-size:12.5px;margin-top:10px}
 pre{background:#f6f8fa;border:1px solid var(--line);border-radius:9px;padding:12px;
     overflow:auto;font-size:12.5px;white-space:pre-wrap;margin:11px 0;
     font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#1f2937}
 table{border-collapse:collapse;width:100%;font-size:13px;margin-top:11px}
 th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left}
 th{color:var(--muted);font-weight:600;font-size:12px;letter-spacing:.02em;
    text-transform:uppercase;background:#fafbfc}
 tr:last-child td{border-bottom:none}
 .hide{display:none}
 .empty{color:var(--muted);font-size:13.5px;padding:22px 0;text-align:center}
 .opt{border-left:3px solid var(--warn);padding-left:12px;margin-top:14px}
 .opt b{font-size:13.5px}
</style>

<div class=wrap>
<header>
  <h1>Talk to your data</h1>
  <div class=sub>Chinook &middot; every answer ships with the query and rows behind it.</div>
</header>

<div class=tabs>
  <button class="tab on" id=tabAsk>Ask</button>
  <button class=tab id=tabHistory>History</button>
</div>

<div id=paneAsk>
  <input id=q placeholder="e.g. which genre generated the most revenue?" autofocus>
  <div id=flowCard class="card hide">
    <div class=flowhead><b>pipeline</b><span id=flowTime></span></div>
    <div class=flow id=flow></div>
  </div>
  <div id=out></div>
</div>

<div id=paneHistory class=hide>
  <select id=picker></select>
  <div id=histOut></div>
</div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

const STEPS = [
  ['retrieve', 'pick tables'],
  ['plan', 'model call'],
  ['probe', 'compare readings'],
  ['validate', 'sql guard'],
  ['execute', 'read-only query'],
  ['narrate', 'write answer'],
  ['verify', 'check numbers']
];

function drawFlow(state = {}) {
  $('flow').innerHTML = STEPS.map(([key, hint]) => {
    const cell = state[key] || {};
    const cls = cell.status ? cell.status : 'idle';
    return '<div class="step ' + cls + '" id=step-' + key + '>' +
           '<div class=name>' + key + '</div>' +
           '<div class=note>' + esc(cell.detail || hint) + '</div></div>';
  }).join('');
}

function view(d) {
  let h = '<div class="tag ' + d.outcome + '">' + d.outcome + (d.cached ? ' &middot; cached' : '') + '</div>';
  h += '<div class=body>' + esc(d.answer) + '</div>';
  if (d.assumption) h += '<div class=meta><b>assumption:</b> ' + esc(d.assumption) + '</div>';

  (d.options || []).forEach((o) => {
    h += '<div class=opt><b>' + esc(o.label) + '</b>' + (o.wouldAnswer ? ' &rarr; ' + esc(o.wouldAnswer) : '') +
         '<pre>' + esc(o.sql) + '</pre></div>';
  });

  const sql = d.evidence ? d.evidence.sql : d.sql;
  const cols = d.evidence ? d.evidence.columns : d.columns;
  const rows = d.evidence ? d.evidence.rows : d.rows;

  if (sql) h += '<pre>' + esc(sql) + '</pre>';
  if (cols && cols.length) {
    h += '<table><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr>';
    h += (rows || []).slice(0, 25).map((r) => '<tr>' + r.map((c) => '<td>' + esc(String(c)) + '</td>').join('') + '</tr>').join('');
    h += '</table>';
  }

  const count = d.evidence ? d.evidence.rowCount : d.rowCount;
  const bits = [];
  if (sql && count !== undefined && count !== null) bits.push(count + ' rows');
  if (d.evidence && d.evidence.durationMs !== undefined) bits.push(d.evidence.durationMs + ' ms query');
  if (d.latencyMs) bits.push(Math.round(d.latencyMs) + ' ms total');
  if (bits.length) h += '<div class=meta>' + bits.join(' &middot; ') + '</div>';

  h += '<div class=meta>verification: ' + esc(d.verification || '') + '</div>';
  return '<div class=card>' + h + '</div>';
}

let stream = null;

function ask(question) {
  if (stream) stream.close();

  const state = {};
  $('flowCard').classList.remove('hide');
  $('flowTime').textContent = 'running...';
  $('out').innerHTML = '';
  drawFlow(state);

  let finished = false;
  stream = new EventSource('/ask/stream?q=' + encodeURIComponent(question));

  stream.addEventListener('stage', (event) => {
    const step = JSON.parse(event.data);
    if (step.stage === 'done' || step.stage === 'error') return;
    state[step.stage] = { status: step.status, detail: step.detail || '' };
    drawFlow(state);
    $('flowTime').textContent = step.atMs + ' ms';
  });

  stream.addEventListener('result', (event) => {
    finished = true;
    const data = JSON.parse(event.data);
    for (const [key] of STEPS) if (!state[key]) state[key] = { status: 'skip' };
    drawFlow(state);
    $('flowTime').textContent = Math.round(data.latencyMs || 0) + ' ms' + (data.cached ? ' · cached' : '');
    $('out').innerHTML = view(data);
    stream.close();
    stream = null;
  });

  stream.onerror = () => {
    stream.close();
    stream = null;
    if (finished) return;

    fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    })
      .then((r) => r.json())
      .then((data) => {
        for (const [key] of STEPS) state[key] = state[key] || { status: 'ok' };
        drawFlow(state);
        $('flowTime').textContent = Math.round(data.latencyMs || 0) + ' ms';
        $('out').innerHTML = view(data);
      })
      .catch(() => {
        $('flowTime').textContent = 'failed';
        $('out').innerHTML = '<div class=card><div class="tag error">error</div>' +
                             '<div class=body>Could not reach the server.</div></div>';
      });
  };
}

$('q').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  ask(e.target.value.trim());
});

async function loadHistory() {
  const items = await (await fetch('/history')).json();
  const picker = $('picker');

  if (!items.length) {
    picker.innerHTML = '';
    picker.classList.add('hide');
    $('histOut').innerHTML = '<div class=empty>Nothing yet. Ask a question first.</div>';
    return;
  }

  picker.classList.remove('hide');
  picker.innerHTML = items
    .map((it, i) => '<option value=' + i + '>' +
      esc(new Date(it.at).toLocaleTimeString() + '  ·  ' + it.outcome + '  ·  ' + it.question) + '</option>')
    .join('');

  const show = () => { $('histOut').innerHTML = view(items[picker.value]); };
  picker.onchange = show;
  show();
}

$('tabAsk').onclick = () => {
  $('tabAsk').classList.add('on'); $('tabHistory').classList.remove('on');
  $('paneAsk').classList.remove('hide'); $('paneHistory').classList.add('hide');
};

$('tabHistory').onclick = () => {
  $('tabHistory').classList.add('on'); $('tabAsk').classList.remove('on');
  $('paneHistory').classList.remove('hide'); $('paneAsk').classList.add('hide');
  loadHistory();
};

drawFlow();
</script>`;
