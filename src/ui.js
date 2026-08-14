export const PAGE = `<!doctype html><meta charset=utf-8><title>Talk to your data</title>
<style>
 :root{color-scheme:dark}
 *{box-sizing:border-box}
 body{background:#0f1115;color:#e6e6e6;font:15px/1.55 ui-sans-serif,system-ui,sans-serif;
      max-width:860px;margin:5vh auto;padding:0 20px}
 h1{font-size:19px;font-weight:600;margin:0}
 .sub{color:#8b8f9a;font-size:13px;margin:4px 0 18px}
 .tabs{display:flex;gap:6px;margin-bottom:14px}
 .tab{padding:6px 14px;border-radius:8px;border:1px solid #262b36;background:#161922;
      color:#9aa0aa;cursor:pointer;font:inherit;font-size:13px}
 .tab.on{background:#1d2331;color:#e6e6e6;border-color:#3f4a60}
 input,select{width:100%;padding:11px 13px;background:#171a21;border:1px solid #262b36;
              border-radius:9px;color:inherit;font:inherit}
 input:focus,select:focus{outline:none;border-color:#4c6ef5}
 pre{background:#12151c;border:1px solid #222735;border-radius:9px;padding:12px;
     overflow:auto;font-size:12.5px;white-space:pre-wrap;margin:10px 0}
 .tag{display:inline-block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
      padding:3px 9px;border-radius:999px;margin:14px 0 8px}
 .answer{background:#12301f;color:#7ee2a8}.clarify{background:#332a10;color:#f2c661}
 .refuse{background:#101f33;color:#79b8f3}.error{background:#331414;color:#f38080}
 .body{white-space:pre-wrap}
 .meta{color:#71757f;font-size:12px;margin-top:8px}
 table{border-collapse:collapse;width:100%;font-size:12.5px;margin-top:10px}
 th,td{border-bottom:1px solid #222735;padding:6px 8px;text-align:left}
 th{color:#8b8f9a;font-weight:500}
 .hide{display:none}
 .empty{color:#71757f;font-size:13px;padding:18px 0}
</style>
<h1>Talk to your data</h1>
<div class=sub>Chinook &middot; every answer ships with the query and rows behind it.</div>

<div class=tabs>
  <button class="tab on" id=tabAsk>Ask</button>
  <button class=tab id=tabHistory>History</button>
</div>

<div id=paneAsk>
  <input id=q placeholder="e.g. which genre generated the most revenue?" autofocus>
  <div id=out></div>
</div>

<div id=paneHistory class=hide>
  <select id=picker></select>
  <div id=histOut></div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

function view(d) {
  let h = '<div class="tag ' + d.outcome + '">' + d.outcome + (d.cached ? ' &middot; cached' : '') + '</div>';
  h += '<div class=body>' + esc(d.answer) + '</div>';
  if (d.assumption) h += '<div class=meta>assumption: ' + esc(d.assumption) + '</div>';

  (d.options || []).forEach((o) => {
    h += '<div class=meta><b>' + esc(o.label) + '</b>' + (o.wouldAnswer ? ' &rarr; ' + esc(o.wouldAnswer) : '') + '</div>';
    h += '<pre>' + esc(o.sql) + '</pre>';
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
  if (d.evidence && d.evidence.durationMs !== undefined) bits.push(d.evidence.durationMs + ' ms');
  if (d.latencyMs) bits.push(Math.round(d.latencyMs) + ' ms total');
  if (bits.length) h += '<div class=meta>' + bits.join(' &middot; ') + '</div>';

  h += '<div class=meta>verification: ' + esc(d.verification || '') + '</div>';
  return h;
}

$('q').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  $('out').innerHTML = '<div class=meta>thinking...</div>';

  const res = await fetch('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: e.target.value })
  });

  $('out').innerHTML = view(await res.json());
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
    .map((it, i) => '<option value=' + i + '>' + esc(new Date(it.at).toLocaleTimeString() + '  ·  ' + it.outcome + '  ·  ' + it.question) + '</option>')
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
</script>`;
