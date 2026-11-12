(function () {
'use strict';
const $ = id => document.getElementById(id);
const clients = {};
let current = null;
let pageDirty = false;
const imageUrls = [];
const imageAlts = [];
const imageLinks = [];
const buttonOv = [];
const linkAmountOff = [];
let previewMode = 'light';
let footerOverride = false;
const resetImages = () => { imageUrls.length = 0; imageAlts.length = 0; imageLinks.length = 0; buttonOv.length = 0; linkAmountOff.length = 0; };
let timer = null;
let last = null;

async function loadClient(id) {
  const base = 'clients/' + id + '/';
  const cfg = await (await fetch(base + 'config.json', { cache: 'no-store' })).json();
  try {
    const ov = localStorage.getItem('eb_cfg_' + id);
    if (ov) { Object.assign(cfg, JSON.parse(ov)); cfg._local = true; }
  } catch (e) { /* ignore */ }
  if (cfg.output.template) cfg._template = await (await fetch(base + cfg.output.template, { cache: 'no-store' })).text();
  if (cfg.output.theme) cfg._theme = await (await fetch(base + cfg.output.theme, { cache: 'no-store' })).text();
  try {
    const t = localStorage.getItem('eb_tpl_' + id);
    if (t) { if (cfg.output.template) cfg._template = t; if (cfg.output.theme) cfg._theme = t; cfg._local = true; }
  } catch (e) { /* ignore */ }
  clients[id] = cfg;
  return cfg;
}

function renderClientControls() {
  const c = current;
  $('plainBtn').classList.toggle('hidden', c.platform !== 'sb');
  $('adminLink').href = 'admin.html?client=' + encodeURIComponent(c.id);
  if (!pageDirty) $('page').value = c.defaultPage;
  $('refWrap').classList.toggle('hidden', (c.refcode || {}).mode !== 'append');
  $('htmlLabel').textContent = c.output.mode === 'body' ? 'Body HTML (paste into the email source)' : 'Full email HTML';
  const checks = $('checks');
  Array.from(checks.querySelectorAll('.toggle')).forEach(n => n.remove());
  (c.toggles || []).forEach(t => {
    const l = document.createElement('label');
    l.className = 'toggle';
    l.innerHTML = '<input type="checkbox" data-toggle="' + t.id + '"' + (t.default ? ' checked' : '') + ' /> ' + t.label;
    checks.appendChild(l);
    l.querySelector('input').addEventListener('change', schedule);
  });
}

function schedule() { clearTimeout(timer); timer = setTimeout(run, 250); }

function run() {
  if (!current) return;
  const draft = $('draft');
  if (!draft.textContent.trim() && !draft.querySelector('img')) { clearOutputs(); return; }
  const toggles = {};
  document.querySelectorAll('[data-toggle]').forEach(i => { toggles[i.dataset.toggle] = i.checked; });
  const probe = document.createElement('div');
  probe.innerHTML = draft.innerHTML;
  const opts = {
    fix: $('fix').checked, recurring: $('recurring').checked, page: $('page').value, refcode: $('refcode').value.trim(), toggles,
    footerOverride,
    linkAmountOff: linkAmountOff.slice(),
    buttonOverrides: buttonOv.map(o => Object.assign({}, o)),
    imageUrls: imageUrls.slice(), imageAlts: imageAlts.slice(), imageLinks: imageLinks.slice()
  };
  let result;
  try {
    result = EmailEngine.build(current, probe, opts);
  } catch (e) {
    console.error(e);
    $('notes').innerHTML = '<div class="note warn"><b>Something went wrong</b>' + String(e.message || e) + '</div>';
    return;
  }
  last = result;
  show(result);
}

function copyRows(containerId, label, values) {
  const box = $(containerId);
  box.innerHTML = '';
  const list = values && values.length ? values : [''];
  list.forEach((v, i) => {
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = '<label></label>';
    head.firstChild.textContent = list.length > 1 ? label + ' ' + (i + 1) : label;
    const row = document.createElement('div');
    row.className = 'outrow';
    row.innerHTML = '<input type="text" readonly /><button type="button">Copy</button>';
    const input = row.querySelector('input');
    input.value = v;
    row.querySelector('button').addEventListener('click', e => copy(input.value, e.target));
    box.appendChild(head); box.appendChild(row);
  });
}

function clearOutputs() {
  $('meta').textContent = '';
  copyRows('senders', 'Sender name', []); copyRows('subjects', 'Subject line', []); copyRows('previews', 'Preview text', []);
  $('html').value = ''; $('plain').value = ''; $('notes').innerHTML = ''; $('btnCard').classList.add('hidden');
  $('size').textContent = ''; $('frame').srcdoc = ''; $('imgCard').classList.add('hidden');
}

function list(items) { return '<ul class="list">' + items.map(i => '<li>' + i.replace(/</g, '&lt;') + '</li>').join('') + '</ul>'; }

function show(r) {
  $('meta').textContent = r.sendTime ? 'Send: ' + r.sendTime : '';
  copyRows('senders', 'Sender name', r.sender ? [r.sender] : []);
  copyRows('subjects', 'Subject line', r.subjects);
  copyRows('previews', 'Preview text', r.previews);
  $('html').value = r.html;
  $('plain').value = r.plainText || '';
  $('size').textContent = Math.round(r.bytes / 1024 * 10) / 10 + ' KB';
  let notes = '';
  if (r.footer) {
    const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (r.footer.state === 'locked') notes += '<div class="note warn"><b>Footer box links still directing to ' + esc(r.footer.regular) + '</b>They are part of the NGP theme, so this email’s page is not used there.</div>';
    else notes += r.footer.state === 'override'
      ? '<div class="note warn"><b>Footer box links are directing to ' + esc(r.footer.event) + '</b><button type="button" class="ghost small" id="footerBack">Send them back to ' + esc(r.footer.regular) + '</button></div>'
      : '<div class="note warn"><b>Footer box links still directing to ' + esc(r.footer.regular) + '</b><button type="button" class="ghost small" id="footerOv">Send them to ' + esc(r.footer.event) + ' instead</button></div>';
  }
  const al = r.amountLinks || [];
  if (r.warnings.length || al.length) {
    let items = r.warnings.map(w => '<li>' + esc(w) + '</li>').join('');
    items += al.map(x => '<li>' + (x.on ? 'Set amount=' + esc(x.amount) + ' on the link "' + esc(x.text) + '"' : 'Not setting an amount on the link "' + esc(x.text) + '"')
      + ' <button type="button" class="ghost small" data-amt="' + x.index + '">' + (x.on ? 'Remove the amount' : 'Set amount=' + esc(x.amount)) + '</button></li>').join('');
    notes += '<div class="note warn"><b>Check these</b><ul class="list">' + items + '</ul></div>';
  }
  if (r.changes.length) notes += '<div class="note ok"><b>What was done</b>' + list(r.changes) + '</div>';
  $('notes').innerHTML = notes;
  $('notes').querySelectorAll('[data-amt]').forEach(btn => btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.amt, 10), pos = linkAmountOff.indexOf(idx);
    if (pos >= 0) linkAmountOff.splice(pos, 1); else linkAmountOff.push(idx);
    run();
  }));
  const ov = $('footerOv'), back = $('footerBack');
  if (ov) ov.addEventListener('click', () => {
    if (!confirm('Are you sure? Buttons in the footer have a direct dollar amount and overriding might be confusing.')) return;
    if (!confirm('Last check: send the footer box buttons to ' + r.footer.event + '?')) return;
    footerOverride = true; run();
  });
  if (back) back.addEventListener('click', () => { footerOverride = false; run(); });
  renderImages(r);
  renderButtons(r);
  const doc = EmailEngine.previewDoc(current, r, previewMode);
  $('frame').srcdoc = doc;
}

function renderImages(r) {
  const card = $('imgCard'), box = $('imgs');
  if (!r.images.length) { card.classList.add('hidden'); box.innerHTML = ''; return; }
  card.classList.remove('hidden');
  if (box.children.length === r.images.length) {
    // keep untouched fields in step with the page box and the draft
    box.querySelectorAll('.imgrow').forEach((row, i) => {
      const im = r.images[i]; if (!im) return;
      const link = row.querySelector('[data-f=link]');
      if (imageLinks[i] == null && document.activeElement !== link) link.value = im.docLink || '';
    });
    return;
  }
  box.innerHTML = '';
  r.images.forEach((im, i) => {
    const row = document.createElement('div');
    row.className = 'imgrow';
    const thumb = im.src ? '<img src="' + im.src.replace(/"/g, '&quot;') + '" alt="" />' : '<div class="ph">Image ' + (i + 1) + '</div>';
    const val = x => String(x == null ? '' : x).replace(/"/g, '&quot;');
    row.innerHTML = thumb + '<div class="imgfields">'
      + '<input type="text" data-f="url" placeholder="Hosted image URL" value="' + val(imageUrls[i] || im.url) + '" />'
      + '<input type="text" data-f="alt" placeholder="Alt text" value="' + val(imageAlts[i] != null ? imageAlts[i] : im.docAlt) + '" />'
      + '<div class="linkrow"><input type="text" data-f="link" placeholder="Image links to (optional)" value="' + val(imageLinks[i] != null ? imageLinks[i] : im.docLink) + '" />'
      + '<button type="button" class="ghost small">Insert page link</button></div>'
      + '</div>';
    const f = n => row.querySelector('[data-f=' + n + ']');
    f('url').addEventListener('input', e => { imageUrls[i] = e.target.value.trim(); schedule(); });
    f('alt').addEventListener('input', e => { imageAlts[i] = e.target.value; schedule(); });
    f('link').addEventListener('input', e => { imageLinks[i] = e.target.value.trim(); schedule(); });
    row.querySelector('button').addEventListener('click', () => { const p = $('page').value.trim() || current.defaultPage; f('link').value = p; imageLinks[i] = p; schedule(); });
    box.appendChild(row);
  });
}

/* ---------- one small settings panel per button and per express stack ---------- */
function btnVal(i, k, b) {
  const o = buttonOv[i];
  return o && o[k] != null ? o[k] : b.defaults[k];
}
function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function allowedCounts(cols) { return String(cols) === '2' ? [3, 5] : [3, 4, 5]; }

function buildButtonRow(b, i, n) {
  const row = document.createElement('div');
  row.className = 'btnrow';
  row.dataset.i = i;
  const set = (k, v) => { (buttonOv[i] = buttonOv[i] || {})[k] = v; schedule(); };
  const checks = '<label class="inl"><input type="checkbox" data-k="recurring" /> Recurring</label><label class="inl"><input type="checkbox" data-k="caps" /> All caps</label>';
  if (b.type === 'button') {
    row.innerHTML = '<div class="btitle">Button ' + n + ' <span>' + esc(b.title) + '</span></div>'
      + '<div class="bfields">'
      + '<input type="text" data-k="label" placeholder="Button text" />'
      + '<div class="linkrow"><input type="text" data-k="link" placeholder="Button links to" /><button type="button" class="ghost small" data-act="page">Insert page link</button></div>'
      + '<input type="text" data-k="amount" placeholder="Amount (none)" />'
      + '<div class="bchecks">' + checks + '</div></div>';
  } else {
    row.innerHTML = '<div class="btitle">Express stack ' + n + '</div>'
      + '<div class="bfields"><div class="row3">'
      + '<div><label>Layout</label><select data-k="columns"><option value="1">One column</option><option value="2">Two columns</option></select></div>'
      + '<div><label>Amount buttons</label><select data-k="count"></select></div>'
      + '<div><label>Highlight</label><select data-k="highlight"></select></div></div>'
      + '<div class="bchecks">' + checks + '</div></div>';
  }
  const field = k => row.querySelector('[data-k=' + k + ']');
  row.querySelectorAll('input[type=text]').forEach(inp => inp.addEventListener('input', () => set(inp.dataset.k, inp.value)));
  row.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => set(cb.dataset.k, cb.checked)));
  const pageBtn = row.querySelector('[data-act=page]');
  if (pageBtn) pageBtn.addEventListener('click', () => {
    const p = $('page').value.trim() || current.defaultPage;
    field('link').value = p; set('link', p);
  });
  if (b.type === 'stack') {
    const refill = () => {
      const cols = field('columns').value;
      const ok = allowedCounts(cols);
      let cur = parseInt(field('count').value || btnVal(i, 'count', b), 10);
      if (!ok.includes(cur)) cur = ok.includes(cur - 1) ? cur - 1 : ok[ok.length - 1];
      field('count').innerHTML = ok.map(x => '<option value="' + x + '">' + x + ' amounts</option>').join('');
      field('count').value = String(cur);
      const hiKeep = parseInt(field('highlight').value || btnVal(i, 'highlight', b) || 0, 10);
      field('highlight').innerHTML = '<option value="0">None</option>' + Array.from({ length: cur }, (_, x) => '<option value="' + (x + 1) + '">Button ' + (x + 1) + '</option>').join('');
      field('highlight').value = String(hiKeep >= 1 && hiKeep <= cur ? hiKeep : 0);
    };
    field('columns').value = String(btnVal(i, 'columns', b));
    field('count').innerHTML = '<option value="' + btnVal(i, 'count', b) + '"></option>';
    field('count').value = String(btnVal(i, 'count', b));
    refill();
    field('columns').addEventListener('change', () => { set('columns', field('columns').value); refill(); set('count', field('count').value); set('highlight', field('highlight').value); });
    field('count').addEventListener('change', () => { set('count', field('count').value); refill(); set('highlight', field('highlight').value); });
    field('highlight').addEventListener('change', () => set('highlight', field('highlight').value));
  }
  return row;
}

function refreshButtonRow(row, b, i) {
  row.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k;
    const touched = buttonOv[i] && buttonOv[i][k] != null;
    if (touched || document.activeElement === el) return;
    const v = b.defaults[k];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.value === String(v))) el.value = String(v); }
    else el.value = v == null ? '' : v;
  });
}

function renderButtons(r) {
  const card = $('btnCard'), box = $('btns');
  if (!r.buttons || !r.buttons.length) { card.classList.add('hidden'); box.innerHTML = ''; box.dataset.sig = ''; return; }
  card.classList.remove('hidden');
  $('btnTitle').textContent = 'Buttons (' + r.buttons.length + ')';
  const sig = r.buttons.map(b => b.type).join(',');
  if (box.dataset.sig === sig && box.children.length === r.buttons.length) {
    Array.from(box.children).forEach((row, i) => refreshButtonRow(row, r.buttons[i], i));
    return;
  }
  box.dataset.sig = sig;
  box.innerHTML = '';
  const seen = { button: 0, stack: 0 };
  r.buttons.forEach((b, i) => {
    seen[b.type]++;
    const row = buildButtonRow(b, i, seen[b.type]);
    box.appendChild(row);
    refreshButtonRow(row, b, i);
  });
}

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent; btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1200);
}

async function init() {
  const ids = await (await fetch('clients/index.json', { cache: 'no-store' })).json();
  for (const id of ids) await loadClient(id);
  const sel = $('client');
  ids.forEach(id => { const o = document.createElement('option'); o.value = id; o.textContent = clients[id].name; sel.appendChild(o); });
  const saved = (() => { try { return localStorage.getItem('eb_client'); } catch (e) { return null; } })();
  sel.value = saved && clients[saved] ? saved : ids[0];
  current = clients[sel.value];
  renderClientControls();
  if (ids.some(i => clients[i]._local)) {
    $('localNote').classList.remove('hidden');
    $('localReset').addEventListener('click', () => {
      ids.forEach(i => { try { localStorage.removeItem('eb_cfg_' + i); } catch (e) { /* ignore */ } });
      location.reload();
    });
  }
  sel.addEventListener('change', () => {
    current = clients[sel.value];
    try { localStorage.setItem('eb_client', sel.value); } catch (e) { /* ignore */ }
    pageDirty = false; footerOverride = false; resetImages(); $('imgs').innerHTML = '';
    renderClientControls(); schedule();
  });
  $('page').addEventListener('input', () => {
    footerOverride = false; pageDirty = $('page').value.trim() !== current.defaultPage; schedule(); });
  ['refcode', 'fix', 'recurring'].forEach(id => $(id).addEventListener('input', schedule));
  $('fix').addEventListener('change', schedule);
  $('recurring').addEventListener('change', schedule);
  $('draft').addEventListener('input', () => { $('imgs').innerHTML = ''; schedule(); });
  $('draft').addEventListener('paste', () => { resetImages(); $('imgs').innerHTML = ''; setTimeout(schedule, 50); });
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copy($(b.dataset.copy).value, b)));
  document.querySelectorAll('#seg button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('on', x === b));
    $('frameWrap').className = b.dataset.w;
  }));
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
    previewMode = b.dataset.m;
    if (last) $('frame').srcdoc = EmailEngine.previewDoc(current, last, previewMode);
  }));
  window.__eb = { run, get last() { return last; }, clients };
}
init();
})();
