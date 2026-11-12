(function () {
'use strict';
const $ = id => document.getElementById(id);
const REPO = 'JacobGC22/email-builder';
const BRANCH = 'main';
let id = null;
let cfg = null;
const RULES = EmailEngine.RULES;

const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };
const key = i => 'eb_cfg_' + i;

async function published(i) {
  const token = lsGet('eb_gh_token');
  if (token) {
    // read the newest saved copy straight from GitHub, so a just-published change is never shown stale
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/clients/' + i + '/config.json?ref=' + BRANCH + '&t=' + Date.now(),
        { cache: 'no-store', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json' } });
      if (r.ok) return JSON.parse(await r.text());
    } catch (e) { /* fall back to the site copy */ }
  }
  return await (await fetch('clients/' + i + '/config.json?t=' + Date.now(), { cache: 'no-store' })).json();
}
function setStatus(t, kind) { const s = $('status'); s.textContent = t; s.className = kind || ''; }
function writeJson() { $('json').value = JSON.stringify(cfg, null, 2); $('err').textContent = ''; }

/* ---------- name fallback + platform presets ---------- */
function fallbackWord() {
  const f = (cfg.merge && cfg.merge.firstName) || '';
  const m = f.match(/or\s+'([^']*)'/) || f.match(/FNAME:([^|]*)\|/);
  return m ? m[1] : '';
}
function applyPlatform(p) {
  const w = (fallbackWord() || 'Friend').replace(/['|]/g, '');
  cfg.platform = p;
  if (p === 'sb') {
    const f = "{{ sb_first_name or '" + w + "' }}";
    cfg.merge = { firstName: f, firstNameSubject: f, ask: '{{ ask{n} }}' };
    cfg.refcode = { mode: 'append' };
    if (!cfg.prevGiftField) cfg.prevGiftField = 'sb_max_amount_donated';
  } else if (p === 'ngp') {
    const f = "{{FirstName or '" + w + "'}}";
    cfg.merge = { firstName: f, firstNameSubject: f, ask: "{{get('ask{n}')}}" };
    cfg.refcode = { mode: 'strip' };
  } else {
    const f = '*|FNAME:' + w + '|*';
    cfg.merge = { firstName: f, firstNameSubject: f, ask: null };
    cfg.refcode = { mode: 'append' };
  }
}
function setFallback(w) {
  w = w.replace(/['|]/g, '');
  ['firstName', 'firstNameSubject'].forEach(k => {
    if (!cfg.merge || !cfg.merge[k]) return;
    cfg.merge[k] = cfg.merge[k].replace(/or\s+'[^']*'/, "or '" + w + "'").replace(/FNAME:[^|]*\|/, 'FNAME:' + w + '|');
  });
}

/* ---------- rows ---------- */
function pairRows(containerId, obj, onChange, ph) {
  const box = $(containerId);
  box.innerHTML = '';
  Object.entries(obj || {}).forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'pair';
    row.innerHTML = '<input type="text" placeholder="' + ph[0] + '" /><input type="text" placeholder="' + ph[1] + '" /><button class="ghost small" type="button">Delete</button>';
    const [a, b, rm] = row.children;
    a.value = k; b.value = v == null ? '' : v;
    const commit = () => onChange(collect(box));
    a.addEventListener('input', commit); b.addEventListener('input', commit);
    rm.addEventListener('click', () => { row.remove(); commit(); });
    box.appendChild(row);
  });
}
function collect(box) {
  const out = {};
  box.querySelectorAll('.pair').forEach(r => { const k = r.children[0].value.trim(); if (k) out[k] = r.children[1].value; });
  return out;
}

/* ---------- rules ---------- */
function activeRules() { return Array.isArray(cfg.rules) ? cfg.rules : RULES.map(r => r.id); }
function renderRules() {
  const on = new Set(activeRules());
  const box = $('rules'); box.innerHTML = '';
  RULES.filter(r => on.has(r.id)).forEach(r => {
    const row = document.createElement('div'); row.className = 'rule';
    row.innerHTML = '<div class="t"><b></b><span></span></div><button class="ghost small" type="button">Delete</button>';
    row.querySelector('b').textContent = r.label;
    row.querySelector('span').textContent = r.example;
    row.querySelector('button').addEventListener('click', () => { cfg.rules = activeRules().filter(x => x !== r.id); renderRules(); writeJson(); });
    box.appendChild(row);
  });
  if (!box.children.length) box.innerHTML = '<div class="fixed">No rules. Fix with rules does nothing for this client.</div>';
  const gone = RULES.filter(r => !on.has(r.id));
  $('removedRules').classList.toggle('hidden', !gone.length);
  const list = $('removedList'); list.innerHTML = '';
  gone.forEach(r => {
    const row = document.createElement('div'); row.className = 'rule';
    row.innerHTML = '<div class="t"><b></b></div><button class="ghost small" type="button">Restore</button>';
    row.querySelector('b').textContent = r.label;
    row.querySelector('button').addEventListener('click', () => {
      const keep = new Set(activeRules()); keep.add(r.id);
      cfg.rules = RULES.map(x => x.id).filter(x => keep.has(x)); renderRules(); writeJson();
    });
    list.appendChild(row);
  });
}

/* ---------- custom templates ---------- */
function renderSnippets() {
  const box = $('snippets'); box.innerHTML = '';
  Object.entries(cfg.snippets || {}).forEach(([name, html]) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border:1px solid var(--line);border-radius:6px;padding:10px;margin-bottom:8px';
    wrap.innerHTML = '<div class="pair"><input type="text" placeholder="Name used in the draft, like BOX" /><button class="ghost small" type="button">Delete</button></div><textarea style="min-height:110px" placeholder="HTML. %%CONTENT%% is where the marked lines go, %%PAGE%% is the donate page."></textarea>';
    const nameInput = wrap.querySelector('input'), area = wrap.querySelector('textarea');
    nameInput.value = name; area.value = html;
    const commit = () => {
      const out = {};
      box.querySelectorAll('div[style*="border"]').forEach(w => {
        const n = w.querySelector('input').value.trim().toUpperCase();
        if (n) out[n] = w.querySelector('textarea').value;
      });
      cfg.snippets = out; writeJson();
    };
    nameInput.addEventListener('input', commit); area.addEventListener('input', commit);
    wrap.querySelector('button').addEventListener('click', () => { wrap.remove(); commit(); });
    box.appendChild(wrap);
  });
}

/* ---------- built-in typo list ---------- */
function renderBuiltin() {
  const off = new Set((cfg.disabledTypos || []).map(s => s.toLowerCase()));
  const box = $('builtin'); box.innerHTML = '';
  const list = $('builtinOffList'); list.innerHTML = '';
  let gone = 0;
  Object.entries(EmailEngine.TYPOS).forEach(([bad, good]) => {
    const isOff = off.has(bad.toLowerCase());
    const row = document.createElement('div'); row.className = 'rule';
    row.innerHTML = '<div class="t"><b></b></div><button class="ghost small" type="button"></button>';
    row.querySelector('b').textContent = bad + '  →  ' + good;
    const btn = row.querySelector('button');
    btn.textContent = isOff ? 'Restore' : 'Delete';
    btn.addEventListener('click', () => {
      const cur = new Set(cfg.disabledTypos || []);
      if (isOff) { [...cur].forEach(x => { if (x.toLowerCase() === bad.toLowerCase()) cur.delete(x); }); } else cur.add(bad);
      cfg.disabledTypos = [...cur];
      if (!cfg.disabledTypos.length) delete cfg.disabledTypos;
      renderBuiltin(); writeJson();
    });
    if (isOff) { gone++; list.appendChild(row); } else box.appendChild(row);
  });
  $('builtinOff').classList.toggle('hidden', !gone);
}

function fillForm() {
  $('f_name').value = cfg.name || '';
  $('f_platform').value = cfg.platform || 'sb';
  $('f_page').value = cfg.defaultPage || '';
  $('f_fallback').value = fallbackWord();
  $('f_refmode').value = (cfg.refcode && cfg.refcode.mode) || 'strip';
  $('f_plainfooter').value = cfg.plainFooter || '';
  pairRows('tokens', cfg.tokens, o => { cfg.tokens = o; writeJson(); }, ['PARTNER', 'Replace with']);
  pairRows('typos', cfg.typos, o => { cfg.typos = o; writeJson(); }, ['Misspelling', 'Correct spelling']);
  ['btnBg', 'btnEdge', 'btnText', 'bar'].forEach(k => { $('c_' + k).value = (cfg.style && cfg.style[k]) || '#000000'; });
  renderRules();
  renderBuiltin();
  renderSnippets();
  writeJson();
}

/* ---------- publish ---------- */
function utf8b64(s) { return btoa(unescape(encodeURIComponent(s))); }
/* one place that saves a file to the repository, used for settings and for templates */
async function putFile(path, text, message) {
  const token = lsGet('eb_gh_token') || $('token').value.trim();
  if (!token) {
    $('tokenRow').classList.remove('hidden');
    throw new Error('Paste a GitHub token that can edit this repository, then publish again.');
  }
  const api = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
  const hdr = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  const content = utf8b64(text);
  let put = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await fetch(api + '?ref=' + BRANCH + '&t=' + Date.now() + attempt, { headers: hdr, cache: 'no-store' });
    if (!cur.ok) throw new Error(cur.status === 401 || cur.status === 403 || cur.status === 404 ? 'GitHub did not accept that token for this repository.' : 'GitHub returned ' + cur.status + '.');
    const sha = (await cur.json()).sha;
    const body = JSON.stringify({ message, content, sha, branch: BRANCH });
    put = await fetch(api, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdr), body, cache: 'no-store' });
    if (put.status !== 409) break;
    await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
  }
  if (!put.ok) {
    let why = '';
    try { why = (await put.json()).message || ''; } catch (e) { /* ignore */ }
    throw new Error('GitHub did not save it (' + put.status + ')' + (why ? ': ' + why : '.'));
  }
  lsSet('eb_gh_token', token);
  $('tokenRow').classList.add('hidden'); $('token').value = '';
  $('forget').classList.remove('hidden');
}
async function publish() {
  try { JSON.parse($('json').value); } catch (e) { setStatus('Fix the full config first.', 'bad'); return; }
  if (!lsGet('eb_gh_token') && !$('token').value.trim()) { $('tokenRow').classList.remove('hidden'); setStatus('Paste a GitHub token that can edit this repository, then publish again.', 'bad'); return; }
  if (!confirm('Publish ' + (cfg.name || id) + ' settings for everyone?')) return;
  setStatus('Publishing...');
  try {
    await putFile('clients/' + id + '/config.json', JSON.stringify(cfg, null, 2) + '\n', 'Update ' + id + ' settings');
    lsDel(key(id));
    setStatus('Published. Everyone gets it within a few minutes.', 'ok');
  } catch (e) { setStatus(String(e.message || e), 'bad'); }
}

/* ---------- the template or theme file for this client ---------- */
const tplKey = i => 'eb_tpl_' + i;
let tplFile = '';
function tplStatus(t, kind) { const s = $('tplStatus'); s.textContent = t; s.className = kind || ''; }
function tplLabels() {
  const isNgp = cfg.platform === 'ngp';
  tplFile = (cfg.output && (cfg.output.template || cfg.output.theme)) || '';
  $('tplName').textContent = tplFile;
  $('tplCopy').textContent = isNgp ? 'Copy theme for NGP' : 'Copy template';
}
async function publishedTemplate(i) {
  const file = (cfg.output && (cfg.output.template || cfg.output.theme)) || '';
  if (!file) return '';
  const token = lsGet('eb_gh_token');
  if (token) {
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/clients/' + i + '/' + file + '?ref=' + BRANCH + '&t=' + Date.now(),
        { cache: 'no-store', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github.raw+json' } });
      if (r.ok) return await r.text();
    } catch (e) { /* fall back to the site copy */ }
  }
  return await (await fetch('clients/' + i + '/' + file + '?t=' + Date.now(), { cache: 'no-store' })).text();
}
async function loadTemplate(i) {
  tplLabels();
  const local = lsGet(tplKey(i));
  $('tpl').value = local != null ? local : await publishedTemplate(i);
  tplStatus(local != null ? 'Showing the template you saved for testing in this browser.' : '');
}
function bindTemplate() {
  $('tplCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('tpl').value); tplStatus('Copied.', 'ok'); }
    catch (e) { $('tpl').select(); document.execCommand('copy'); tplStatus('Copied.', 'ok'); }
  });
  $('tplUpload').addEventListener('click', () => $('tplFile').click());
  $('tplFile').addEventListener('change', async () => {
    const f = $('tplFile').files[0]; if (!f) return;
    $('tpl').value = await f.text(); $('tplFile').value = '';
    tplStatus('Loaded ' + f.name + '. Test it in the builder or publish it.', 'ok');
  });
  $('tplTest').addEventListener('click', () => {
    tplStatus(lsSet(tplKey(id), $('tpl').value) ? 'Saved in this browser only. Open the builder to try it.' : 'Could not save in this browser.', 'ok');
  });
  $('tplReset').addEventListener('click', async () => {
    lsDel(tplKey(id)); $('tpl').value = await publishedTemplate(id); tplStatus('Back to the published template.');
  });
  $('tplPublish').addEventListener('click', async () => {
    const text = $('tpl').value;
    if (!/%%BODY%%|\{\{EmailContent\}\}/.test(text)) { tplStatus('This does not contain %%BODY%% or {{EmailContent}}, so it would not show the email body. Not published.', 'bad'); return; }
    if (!lsGet('eb_gh_token') && !$('token').value.trim()) { $('tokenRow').classList.remove('hidden'); tplStatus('Paste a GitHub token above, then publish again.', 'bad'); return; }
    if (!confirm('Publish this ' + (cfg.platform === 'ngp' ? 'theme' : 'template') + ' for ' + (cfg.name || id) + ' for everyone?')) return;
    tplStatus('Publishing...');
    try {
      await putFile('clients/' + id + '/' + tplFile, text, 'Update ' + id + ' ' + tplFile);
      lsDel(tplKey(id));
      tplStatus('Published. Everyone gets it within a few minutes.', 'ok');
    } catch (e) { tplStatus(String(e.message || e), 'bad'); }
  });
}

/* ---------- wiring ---------- */
function bind() {
  bindTemplate();
  $('f_name').addEventListener('input', () => { cfg.name = $('f_name').value; writeJson(); });
  $('f_page').addEventListener('input', () => { cfg.defaultPage = $('f_page').value.trim(); writeJson(); });
  $('f_fallback').addEventListener('input', () => { setFallback($('f_fallback').value); writeJson(); });
  $('f_platform').addEventListener('change', () => { applyPlatform($('f_platform').value); fillForm(); tplLabels(); });
  $('f_plainfooter').addEventListener('input', () => { cfg.plainFooter = $('f_plainfooter').value; writeJson(); });
  $('f_refmode').addEventListener('change', () => { cfg.refcode = Object.assign({}, cfg.refcode, { mode: $('f_refmode').value }); writeJson(); });
  ['btnBg', 'btnEdge', 'btnText', 'bar'].forEach(k => $('c_' + k).addEventListener('input', () => {
    cfg.style = Object.assign({}, cfg.style, { [k]: $('c_' + k).value.toUpperCase() });
    writeJson();
  }));
  $('addToken').addEventListener('click', () => { cfg.tokens = Object.assign({}, cfg.tokens, { '': '' }); fillForm(); });
  $('addSnippet').addEventListener('click', () => { cfg.snippets = Object.assign({}, cfg.snippets, { '': '<table>%%CONTENT%%</table>' }); fillForm(); });
  $('addTypo').addEventListener('click', () => { cfg.typos = Object.assign({}, cfg.typos, { '': '' }); fillForm(); });
  $('json').addEventListener('input', () => {
    try {
      cfg = JSON.parse($('json').value);
      $('err').textContent = '';
      const keep = $('json').value;
      fillForm();
      $('json').value = keep;
    } catch (e) { $('err').textContent = 'Not valid JSON yet: ' + e.message; }
  });
  $('save').addEventListener('click', () => {
    try { JSON.parse($('json').value); } catch (e) { setStatus('Fix the full config first.', 'bad'); return; }
    setStatus(lsSet(key(id), $('json').value) ? 'Saved in this browser only. Open the builder to try it.' : 'Could not save in this browser.', lsGet(key(id)) ? 'ok' : 'bad');
  });
  $('reset').addEventListener('click', async () => {
    lsDel(key(id));
    cfg = await published(id); fillForm(); setStatus('Back to the published settings.');
  });
  $('download').addEventListener('click', () => {
    const blob = new Blob([$('json').value + '\n'], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'config.json'; a.click();
    URL.revokeObjectURL(a.href);
  });
  $('publish').addEventListener('click', publish);
  $('forget').addEventListener('click', e => { e.preventDefault(); lsDel('eb_gh_token'); $('forget').classList.add('hidden'); setStatus('Token forgotten.'); });
  $('client').addEventListener('change', () => { lsSet('eb_client', $('client').value); history.replaceState(null, '', '?client=' + $('client').value); load($('client').value); });
}

async function load(i) {
  id = i;
  const s = lsGet(key(i));
  cfg = s ? JSON.parse(s) : await published(i);
  fillForm();
  setStatus(s ? 'Showing the settings you saved for testing in this browser.' : '');
  await loadTemplate(i);
}

(async function init() {
  const ids = await (await fetch('clients/index.json', { cache: 'no-store' })).json();
  for (const i of ids) {
    const c = await published(i);
    const o = document.createElement('option'); o.value = i; o.textContent = c.name; $('client').appendChild(o);
  }
  bind();
  const want = new URLSearchParams(location.search).get('client') || lsGet('eb_client');
  const start = ids.includes(want) ? want : ids[0];
  $('client').value = start;
  lsSet('eb_client', start);
  if (lsGet('eb_gh_token')) $('forget').classList.remove('hidden');
  await load(start);
})();
})();
