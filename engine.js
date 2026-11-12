(function (g) {
'use strict';

/* ---------- small helpers ---------- */
const NAMED = {
  '’': '&rsquo;', '‘': '&lsquo;', '“': '&ldquo;', '”': '&rdquo;',
  '—': '&mdash;', '–': '&ndash;', '…': '&hellip;', '→': '&rarr;',
  '•': '&bull;', '©': '&copy;'
};
function enc(s) {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    out += cp < 128 ? ch : (NAMED[ch] || '&#' + cp + ';');
  }
  return out;
}
const escText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
function mapText(html, fn) {
  return html.split(/(<[^>]*>)/).map((seg, i) => (i % 2 ? seg : fn(seg))).join('');
}
function splitHash(u) {
  const i = u.indexOf('#');
  return i < 0 ? [u, ''] : [u.slice(0, i), u.slice(i)];
}
function getParam(u, key) {
  const [base] = splitHash(u);
  const q = base.split('?')[1];
  if (!q) return null;
  for (const p of q.split('&')) {
    const [k, v] = [p.split('=')[0], p.split('=').slice(1).join('=')];
    if (k.toLowerCase() === key) return v;
  }
  return null;
}
function setParam(u, key, val, encode) {
  const [base, hash] = splitHash(u);
  const path = base.split('?')[0];
  const q = base.split('?')[1] || '';
  const kept = q.split('&').filter(Boolean).filter(p => p.split('=')[0].toLowerCase() !== key.toLowerCase());
  if (val !== null && val !== undefined) kept.push(key + '=' + (encode ? encodeURIComponent(val) : val));
  return path + (kept.length ? '?' + kept.join('&') : '') + hash;
}

/* ---------- state ---------- */
function newState(client, opts) {
  const st = {
    client, opts,
    fix: !!opts.fix,
    page: (opts.page || client.defaultPage || '').trim(),
    changes: new Map(),
    warnings: [],
    images: [],
    last: '',
    flags: { text: 0, bold: 0, link: 0 },
    usesAsks: false,
    rules: new Set(Array.isArray(client.rules) ? client.rules : RULES.map(r => r.id))
  };
  st.buttons = [];
  st.amountLinks = [];
  st.btnOv = Array.isArray(opts.buttonOverrides) ? opts.buttonOverrides : [];
  st.style = Object.assign({}, client.style, { caps: opts.caps !== undefined && opts.caps !== null ? !!opts.caps : true });
  st.mute = false;
  st.note = (msg, n) => { if (!st.mute) st.changes.set(msg, (st.changes.get(msg) || 0) + (n || 1)); };
  st.warn = msg => { if (!st.warnings.includes(msg)) st.warnings.push(msg); };
  return st;
}
const FIXED_ASKS = [10, 25, 50, 100, 250, 500];
const askMerge = (st, n) => (st.client.merge.ask ? st.client.merge.ask.replace('{n}', n) : String(FIXED_ASKS[n - 1]));
function pageWith(st, params, base) {
  let u = base || st.page;
  for (const p of (params || '').split('&').filter(Boolean)) {
    const [k, ...v] = p.split('=');
    u = setParam(u, k, v.join('='), false);
  }
  return u;
}

/* ---------- text fixes ---------- */
const TYPOS = {
  teh: 'the', recieve: 'receive', recieved: 'received', definately: 'definitely', seperate: 'separate',
  occured: 'occurred', untill: 'until', alot: 'a lot', wich: 'which', thier: 'their', becuase: 'because',
  goverment: 'government', accomodate: 'accommodate', tommorow: 'tomorrow', begining: 'beginning',
  beleive: 'believe', wierd: 'weird', adress: 'address', enviroment: 'environment', publically: 'publicly',
  sucess: 'success', necesary: 'necessary', experiance: 'experience', acheive: 'achieve', commited: 'committed',
  oppurtunity: 'opportunity', realy: 'really', judgement: 'judgment', 'thankyou': 'thank you'
};
function typoMap(st) {
  if (st._typos) return st._typos;
  const off = new Set((st.client.disabledTypos || []).map(s => String(s).toLowerCase()));
  const m = {};
  Object.keys(TYPOS).forEach(k => { if (!off.has(k.toLowerCase())) m[k.toLowerCase()] = TYPOS[k]; });
  Object.keys(st.client.typos || {}).forEach(k => { if (k.trim()) m[k.trim().toLowerCase()] = st.client.typos[k]; });
  st._typos = m;
  return m;
}
function matchCase(src, rep) {
  if (/[A-Z]/.test(rep)) return rep;
  if (src === src.toUpperCase() && src.length > 1) return rep.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
  return rep;
}
const RULES = [
  { id: 'spaces', label: 'Collapse extra spaces', example: 'two  spaces becomes one space' },
  { id: 'spaceBeforePunct', label: 'Remove a space before , . ! ? ; :', example: 'word . becomes word.' },
  { id: 'spaceAfterPeriod', label: 'Add a missing space after a period', example: 'today.Please becomes today. Please' },
  { id: 'spaceAfterComma', label: 'Add a missing space after a comma', example: 'Hello,friend becomes Hello, friend' },
  { id: 'repeatedWord', label: 'Remove a repeated word', example: 'the the becomes the' },
  { id: 'typos', label: 'Correct common typos', example: 'recieve becomes receive' },
  { id: 'smartQuotes', label: 'Make curly quote marks straight', example: '“Hi” becomes "Hi"' },
  { id: 'ctaLink', label: 'Link the bold ask sentence above a button', example: 'bold sentence + [DONATE] makes the sentence a link' }
];
const MERGE_SPLIT = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/;
function straightenCode(x) {
  return x.replace(/[‘’‚‛]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    .replace(/[“”„‟]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"');
}
function fixText(t, st) {
  return t.split(MERGE_SPLIT).map((seg, i) => (i % 2 ? straightenCode(seg) : fixPlain(seg, st))).join('');
}
function fixPlain(t, st) {
  if (!st.fix) return t;
  const on = id => st.rules.has(id);
  const note = (m, n) => st.note(m, n);
  if (on('spaces')) t = t.replace(/[ \t]{2,}/g, () => { note('Extra spaces removed'); return ' '; });
  if (on('spaceBeforePunct')) t = t.replace(/ +([,.!?;:])(?=\s|$)/g, (m, p) => { note('Space before punctuation removed'); return p; });
  if (on('spaceAfterPeriod')) t = t.replace(/([a-z]{2,}[.!?])([A-Z][a-z])/g, (m, a, b) => { note('Missing space after period added'); return a + ' ' + b; });
  if (on('spaceAfterComma')) t = t.replace(/([a-z]),([A-Za-z])/g, (m, a, b) => { note('Missing space after comma added'); return a + ', ' + b; });
  if (on('repeatedWord')) {
    t = t.replace(/\b([A-Za-z]{2,})\s+\1\b/gi, (m, w) => {
      if (/^(had|that)$/i.test(w)) return m;
      note('Repeated word removed');
      return w;
    });
  }
  if (on('typos')) {
    const typos = typoMap(st);
    t = t.replace(/\b[A-Za-z']{3,}\b/g, w => {
      const hit = typos[w.toLowerCase()];
      if (!hit) return w;
      const fixedWord = matchCase(w, hit);
      if (fixedWord === w) return w;
      note('Typo fixed: ' + w + ' → ' + fixedWord);
      return fixedWord;
    });
  }
  if (on('smartQuotes')) {
    t = t.replace(/[‘’‚‛]/g, () => { note('Curly quote marks were made straight'); return "'"; });
    t = t.replace(/[“”„‟]/g, () => { note('Curly quote marks were made straight'); return '"'; });
  }
  return t;
}

/* ---------- tokens ---------- */
function applyTokens(html, st) {
  const c = st.client;
  return mapText(html, seg => {
    seg = seg.replace(/\[{0,2}FIRSTNAME\]{0,2}/g, () => { st.note('FIRSTNAME merge tag inserted'); return c.merge.firstName; });
    seg = seg.replace(/\$ASK([1-6])\b/g, (m, n) => { st.usesAsks = true; st.askCount = Math.max(st.askCount || 4, +n); if (!c.merge.ask) st.warn('This platform has no personalized ask amounts. $ASK' + n + ' was set to $' + FIXED_ASKS[n - 1] + '.'); st.note('$ASK amount merge inserted'); return '$' + askMerge(st, n); });
    seg = seg.replace(/\[\[([^\]]+)\]\]/g, (m, name) => {
      const key = name.trim().toUpperCase();
      if (c.tokens && c.tokens[key] !== undefined) { st.note('[[' + key + ']] replaced'); return c.tokens[key]; }
      st.warn('No replacement set for [[' + name.trim() + ']] for this client');
      return m;
    });
    return seg;
  });
}
function leftoverCheck(html, st) {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\{%[\s\S]*?%\}/g, ' ');
  const m1 = text.match(/\b(FIRSTNAME|ASK\d+|PARTNER)\b/g);
  if (m1) st.warn('Unconverted text left in the email: ' + [...new Set(m1)].join(', '));
  const m2 = text.match(/\[[^\]\n]{1,40}\]/g);
  if (m2) st.warn('Bracketed text left in the email: ' + [...new Set(m2)].slice(0, 5).join(' '));
}

/* ---------- DOM walk ---------- */
const alignOf = el => {
  const s = (el.getAttribute && (el.getAttribute('style') || '')) || '';
  return /text-align:\s*center/i.test(s) || (el.getAttribute && el.getAttribute('align') === 'center') ? 'center' : null;
};
function walk(el, blocks) {
  let buf = [];
  const flush = () => { if (buf.length) { blocks.push({ type: 'p', nodes: buf, align: null }); buf = []; } };
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) { buf.push(n); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'title', 'head', 'xml'].includes(tag)) continue;
    if (tag === 'ul' || tag === 'ol') { flush(); blocks.push({ type: 'list', ordered: tag === 'ol', items: Array.from(n.children).filter(c => c.tagName.toLowerCase() === 'li') }); continue; }
    if (tag === 'table') { flush(); blocks.push({ type: 'table' }); continue; }
    if (tag === 'hr') { flush(); continue; }
    if (/^h[1-6]$/.test(tag)) { flush(); blocks.push({ type: 'heading', nodes: Array.from(n.childNodes) }); continue; }
    if (tag === 'p' || tag === 'blockquote') { flush(); blocks.push({ type: 'p', nodes: Array.from(n.childNodes), align: alignOf(n) }); continue; }
    if (['div', 'section', 'article', 'center', 'body', 'b', 'strong', 'span', 'font'].includes(tag)) {
      if (n.querySelector('p,div,h1,h2,h3,h4,h5,h6,ul,ol,table,li')) { flush(); walk(n, blocks); }
      else if (tag === 'div' || tag === 'center') { flush(); blocks.push({ type: 'p', nodes: Array.from(n.childNodes), align: alignOf(n) || (tag === 'center' ? 'center' : null) }); }
      else buf.push(n);
      continue;
    }
    buf.push(n);
  }
  flush();
}
const plainOf = b => (b.nodes || []).map(n => n.textContent).join('').replace(/[ ​-‍﻿]/g, ' ').replace(/\s+/g, ' ').trim();
const hasImg = b => (b.nodes || []).some(n => n.nodeType === 1 && (n.tagName === 'IMG' || (n.querySelector && n.querySelector('img'))));
function rawOf(nodes) {
  let out = '';
  (function rec(list) {
    for (const n of list) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) { if (n.tagName === 'BR') out += '\n'; else rec(n.childNodes); }
    }
  })(nodes);
  return out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[ ​-‍﻿]/g, ' ');
}

/* ---------- inline conversion ---------- */
function toHex(v) {
  v = String(v).trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map(c => c + c).join('');
  m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return '#' + m[1];
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => ('0' + Math.min(255, +n).toString(16)).slice(-2)).join('');
  return null;
}
function salient(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  const bright = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return spread >= 40 && bright >= 0.22 && bright <= 0.92;
}
function contrastText(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1B2733' : '#FFFFFF';
}
function unwrapGoogle(u) {
  const m = u.match(/^https?:\/\/(?:www\.)?google\.com\/url\?(?:[^#]*&)?q=([^&]+)/i);
  return m ? decodeURIComponent(m[1]) : u;
}
function inline(node, st, fmt) {
  if (node.nodeType === 3) {
    const raw = node.nodeValue.replace(/[ ]/g, ' ').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ');
    if (!raw) return '';
    // merge/Jinja code is never edited; curly quotes inside it are made straight so it still works
    const fixed = raw.split(/(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/).map((s, i) => {
      if (i % 2) {
        st.last = '}';
        return s.replace(/[‘’“”]/g, q => { st.note('Curly quote marks inside merge code were made straight so the code works'); return /[‘’]/.test(q) ? "'" : '"'; });
      }
      const f = fixText(s, st);
      if (f) st.last = f.slice(-1);
      return f;
    }).join('');
    if (fixed.trim()) { st.flags.text++; if (fmt.bold) st.flags.bold++; }
    st.last = fixed.slice(-1) || st.last;
    return enc(escText(fixed));
  }
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const style = (node.getAttribute('style') || '').toLowerCase();
  if (tag === 'br') return '<br />';
  if (tag === 'script' || tag === 'style') return '';
  if (tag === 'img') {
    const id = st.images.length;
    const wm = style.match(/width:\s*([\d.]+)px/) || [null, node.getAttribute('width')];
    st.images.push({ id, src: node.getAttribute('src') || '', alt: node.getAttribute('alt') || '', w: wm[1] ? Math.round(parseFloat(wm[1])) : 0, url: '' });
    return 'IMG' + id + '';
  }
  const isB = tag === 'b' || tag === 'strong';
  const bold = isB ? !/font-weight:\s*(normal|400|300)/.test(style) : /font-weight:\s*(bold|[6-9]00)/.test(style);
  const ital = tag === 'em' || tag === 'i' || /font-style:\s*italic/.test(style);
  const und = tag === 'u' || (/text-decoration[^;]*underline/.test(style) && tag !== 'a');
  const sub = Object.assign({}, fmt);
  if (bold) sub.bold = true;
  if (ital) sub.ital = true;
  if (tag === 'a') sub.link = true;
  let colorHex = null;
  if (tag !== 'a' && !fmt.link) {
    const cm = style.match(/(?:^|;)\s*color:\s*([^;]+)/) || (tag === 'font' && node.getAttribute('color') ? [null, node.getAttribute('color')] : null);
    const hex = cm ? toHex(cm[1]) : null;
    if (hex && salient(hex) && hex !== fmt.color) { colorHex = hex; sub.color = hex; }
  }
  let bgHex = null;
  if (tag !== 'a' && !fmt.link && !fmt.bg) {
    const bm = style.match(/(?:^|;)\s*background(?:-color)?:\s*([^;]+)/);
    const hex = bm ? toHex(bm[1]) : null;
    if (hex && hex !== '#ffffff') { bgHex = hex; sub.bg = true; }
  }
  let inner = Array.from(node.childNodes).map(c => inline(c, st, sub)).join('');
  if (colorHex && inner.replace(/<[^>]*>/g, '').trim()) {
    inner = '<span style="color:' + colorHex + ' !important;">' + inner + '</span>';
    st.note('Text color kept');
  }
  if (bgHex && inner.replace(/<[^>]*>/g, '').trim()) {
    const fg = colorHex || fmt.color || contrastText(bgHex);
    inner = '<span style="background-color:' + bgHex + ' !important;color:' + fg + ' !important;">' + inner + '</span>';
    st.note('Highlight kept');
  }
  if (tag === 'a') {
    let href = (node.getAttribute('href') || '').trim();
    href = unwrapGoogle(href);
    if (!href || href === '#' || /^(LINK|\[LINK\])$/i.test(href)) { href = st.page; st.note('Empty link pointed at the default page'); }
    st.flags.link++;
    inner = '<a href="' + escAttr(href) + '">' + inner + '</a>';
  }
  if (!inner.replace(/<[^>]*>/g, '').trim() && !//.test(inner)) return inner;
  if (ital && !fmt.ital) inner = '<em>' + inner + '</em>';
  if (und && !fmt.und && tag !== 'a') inner = '<u>' + inner + '</u>';
  if (bold && !fmt.bold) inner = '<strong>' + inner + '</strong>';
  return inner;
}
function cleanHtml(h) {
  let prev;
  do {
    prev = h;
    h = h.replace(/<\/strong>(\s*)<strong>/g, '$1').replace(/<\/em>(\s*)<em>/g, '$1').replace(/<\/u>(\s*)<u>/g, '$1');
    h = h.replace(/<(strong|em|u)>\s*<\/\1>/g, '');
  } while (h !== prev);
  h = h.replace(/(<br \/>\s*){3,}/g, '<br /><br />');
  h = h.replace(/^(\s|<br \/>)+/, '').replace(/(\s|<br \/>)+$/, '');
  return h.replace(/<br \/>/g, '<br />\n');
}
function para(b, st) {
  st.last = ''; st.flags = { text: 0, bold: 0, link: 0 };
  let html = cleanHtml(b.nodes.map(n => inline(n, st, {})).join(''));
  html = applyTokens(html, st);
  return {
    html, plain: plainOf(b), align: b.align,
    allBold: st.flags.text > 0 && st.flags.bold === st.flags.text,
    hasLink: st.flags.link > 0
  };
}

/* ---------- components ---------- */
function barTable(S) {
  return '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 22px;" width="48">\n\t<tbody>\n\t\t<tr>\n\t\t\t<td bgcolor="' + S.bar + '" class="accent-rule" height="6" style="font-size:6px;line-height:6px;mso-line-height-rule:exactly;height:6px;background-color:' + S.bar + ';color:' + S.bar + ';">&nbsp;</td>\n\t\t</tr>\n\t</tbody>\n</table>\n\n';
}
function buttonHtml(S, href, label, o) {
  o = o || {};
  label = caseLabel(label, S.caps);
  const ghost = !!o.ghost, hi = !!o.hi && !ghost, small = !!o.small;
  const imp = ' !important';
  const cls = ghost ? 'content-btn-ghost' : 'content-btn';
  let bg = ghost ? S.ghostBg : S.btnBg;
  let color = ghost ? S.ghostText : S.btnText;
  let edge = S.btnEdge;
  if (hi) { bg = S.hiBg || S.btnText; color = S.hiText || S.btnBg; edge = S.hiEdge || S.btnEdge; }
  const border = ghost
    ? 'border:2px solid ' + S.ghostBorder + ';border-bottom-width:4px;border-radius:6px;'
    : 'border-bottom:4px solid ' + edge + (hi ? imp : '') + ';border-radius:6px;';
  let pad = ghost ? '13px 18px 11px' : '14px 18px 12px';
  let size = S.btnSize;
  if (small) { pad = ghost ? '11px 8px 9px' : '12px 8px 10px'; size = Math.max(12, S.btnSize - 2); }
  const bgStyle = 'background-color:' + bg + (hi ? imp : '') + ';';
  const colorStyle = 'color:' + color + (hi ? imp : '') + ';';
  const sizeStyle = 'font-size:' + size + 'px' + (small ? imp : '') + ';';
  return '<table border="0" cellpadding="0" cellspacing="0" class="' + cls + '" role="presentation" style="border-collapse:separate !important;border-spacing:0;" width="100%">\n'
    + '\t\t\t\t<tbody>\n\t\t\t\t\t<tr>\n'
    + '\t\t\t\t\t\t<td align="center" bgcolor="' + bg + '" class="btn-cell" style="' + bgStyle + 'padding:' + pad + (small ? imp : '') + ';' + border + '"><a class="button-link btn-label" href="' + escAttr(href) + '" style="display:block;font-family:' + S.btnFont + ';' + sizeStyle + 'line-height:20px;mso-line-height-rule:exactly;font-weight:' + S.btnWeight + ';font-synthesis:none;letter-spacing:' + S.letterSpacing + ';text-align:center;' + colorStyle + 'text-decoration:none;-webkit-text-size-adjust:none;" target="_blank">' + label + '</a></td>\n'
    + '\t\t\t\t\t</tr>\n\t\t\t\t</tbody>\n\t\t\t</table>';
}
function buttonRow(S, href, label, ghost, last, o) {
  const bp = last ? '6px 0 26px' : '6px 0';
  return '\t\t<tr>\n\t\t\t<td style="padding:' + bp + ';">\n' + buttonHtml(S, href, label, Object.assign({ ghost }, o || {})) + '\n\t\t\t</td>\n\t\t</tr>\n';
}
function buttonPairRow(S, a, b) {
  const cell = (x, pad) => '<td width="50%" valign="top" style="padding:' + pad + ';">' + buttonHtml(S, x.href, x.label, { hi: x.hi, ghost: x.ghost, small: true }) + '</td>';
  return '\t\t<tr>\n\t\t\t<td style="padding:6px 0;">\n'
    + '\t\t\t<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">\n\t\t\t\t<tbody>\n\t\t\t\t\t<tr>\n'
    + cell(a, '0 4px 0 0') + '\n' + cell(b, '0 0 0 4px')
    + '\n\t\t\t\t\t</tr>\n\t\t\t\t</tbody>\n\t\t\t</table>\n\t\t\t</td>\n\t\t</tr>\n';
}
function buttonTable(rows, maxWidth) {
  return '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:' + (maxWidth || 400) + 'px;" width="100%">\n\t<tbody>\n' + rows + '\t</tbody>\n</table>\n\n';
}
const definedOnly = o => { const out = {}; Object.keys(o || {}).forEach(k => { if (o[k] !== undefined && o[k] !== null) out[k] = o[k]; }); return out; };
/* A single button. Defaults come from the draft and the page settings; the Buttons panel can override each one. */
function makeSingle(st, d) {
  const idx = st.buttons.length;
  const o = st.btnOv[idx] || {};
  const defaults = { label: d.label, link: d.link, amount: d.amount || '', recurring: false, caps: st.style.caps };
  const pick = k => (o[k] !== undefined && o[k] !== null ? o[k] : defaults[k]);
  const caps = pick('caps') !== false;
  const label = String(pick('label'));
  const link = String(o.link ? o.link : defaults.link);
  const amount = String(pick('amount') || '').trim();
  let href = link;
  if (amount) href = setParam(href, 'amount', amount, false);
  if (pick('recurring')) href = setParam(href, 'recurring', '1', false);
  let labelH = applyTokens(enc(escText(caps ? label.toUpperCase() : label)), st);
  if (!/&rarr;/.test(labelH)) labelH += ' &rarr;';
  st.buttons.push({ type: 'button', title: defaults.label, defaults });
  return buttonTable(buttonRow(Object.assign({}, st.style, { caps }), href, labelH, false, true));
}
/* One column: 3, 4 or 5 amount buttons. Two columns: 3 or 5, so the "another amount" button completes the last pair. */
function stackSettings(st, ov) {
  const def = st.client.stack || {};
  const o = Object.assign({}, definedOnly(st.opts.stack), definedOnly(ov));
  const columns = parseInt(o.columns || def.columns || 1, 10) === 2 ? 2 : 1;
  let count = Math.min(5, Math.max(3, parseInt(o.count || def.count || 4, 10)));
  if (columns === 2 && count % 2 === 0) count -= 1;
  let hi = o.highlight !== undefined ? parseInt(o.highlight, 10) : parseInt(def.highlight || 0, 10);
  if (!(hi >= 1 && hi <= count)) hi = 0;
  return { count, columns, hi };
}
function expressStack(st) {
  const c = st.client;
  const idx = st.buttons.length;
  const ov = st.btnOv[idx] || {};
  const base = stackSettings(st, null);
  const { count, columns, hi } = stackSettings(st, { count: ov.count, columns: ov.columns, highlight: ov.highlight });
  const recurring = ov.recurring !== undefined && ov.recurring !== null ? !!ov.recurring : false;
  const caps = ov.caps !== undefined && ov.caps !== null ? !!ov.caps : st.style.caps !== false;
  const S = Object.assign({}, st.style, { caps });
  st.buttons.push({ type: 'stack', title: 'Express stack', defaults: { count: base.count, columns: base.columns, highlight: base.hi, recurring: false, caps: st.style.caps !== false } });
  st.usesAsks = true;
  st.askCount = Math.max(st.askCount || 4, count);
  const rec = u => (recurring ? setParam(u, 'recurring', '1', false) : u);
  const disc = '<p style="text-align:center;font-size:12px;line-height:1.4;"><span style="font-size:12px;"><em>' + c.expressDisclaimer + '</em></span></p>\n\n';
  const items = [];
  for (let i = 1; i <= count; i++) {
    items.push({ href: rec(pageWith(st, 'express_lane=true&amount=' + askMerge(st, i))), label: 'DONATE $' + askMerge(st, i) + ' &rarr;', hi: hi === i });
  }
  const other = { href: rec(pageWith(st, '')), label: c.buttons.another, ghost: true };
  let rows = '';
  if (columns === 1) {
    items.forEach(x => { rows += buttonRow(S, x.href, x.label, false, false, { hi: x.hi }); });
    rows += buttonRow(S, other.href, other.label, true, true);
  } else {
    const all = items.concat([other]);
    for (let k = 0; k < all.length; k += 2) rows += buttonPairRow(S, all[k], all[k + 1]);
    rows = rows.replace(/<td style="padding:6px 0;">(?![\s\S]*<td style="padding:6px 0;">)/, '<td style="padding:6px 0 26px;">');
  }
  st.note('Express stack inserted (' + count + ' amounts, ' + (columns === 2 ? 'two columns' : 'one column') + (hi ? ', button ' + hi + ' highlighted' : '') + ')');
  return disc + buttonTable(rows, columns === 2 ? 440 : 400);
}
function caseLabel(label, caps) {
  if (caps !== false) return label;
  let first = true;
  return label.split(/(\{\{[\s\S]*?\}\}|&[#a-z0-9]+;|<[^>]*>)/i).map((seg, i) => {
    if (i % 2) return seg;
    return seg.replace(/[A-Za-z]/g, ch => { if (first) { first = false; return ch.toUpperCase(); } return ch.toLowerCase(); });
  }).join('');
}
const SANS_STACK = 'Arial,Helvetica,sans-serif';
function calloutBox(st, html) {
  const S = st.client.style, panel = S.panel || '#EEF3F8';
  return '<table align="center" border="0" cellpadding="0" cellspacing="0" class="callout-box" style="width:100%;max-width:520px;margin:18px auto 22px;border-left:5px solid ' + S.bar + ';background-color:' + panel + ';">\n\t<tbody>\n\t\t<tr>\n'
    + '\t\t\t<td bgcolor="' + panel + '" style="padding:20px 22px;background-color:' + panel + ';font-family:' + (S.bodyFont || SANS_STACK) + ';font-size:18px;line-height:150%;font-weight:400;color:' + S.ink + ';">' + html + '</td>\n'
    + '\t\t</tr>\n\t</tbody>\n</table>\n\n';
}
function quoteBlock(st, html) {
  const S = st.client.style;
  return '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px;" width="100%">\n\t<tbody>\n\t\t<tr>\n'
    + '\t\t\t<td class="pq-cell" style="border-left:6px solid ' + S.bar + ';padding:4px 0 4px 20px;font-family:' + (S.bodyFont || SANS_STACK) + ';font-size:23px;line-height:1.3;font-weight:700;font-style:italic;mso-line-height-rule:exactly;color:' + S.ink + ';">' + html + '</td>\n'
    + '\t\t</tr>\n\t</tbody>\n</table>\n\n';
}
function dividerRule(st) {
  const S = st.client.style;
  return '<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px;" width="100%">\n\t<tbody>\n\t\t<tr>\n'
    + '\t\t\t<td bgcolor="' + S.bar + '" class="accent-rule" height="3" style="font-size:3px;line-height:3px;mso-line-height-rule:exactly;height:3px;background-color:' + S.bar + ';color:' + S.bar + ';">&nbsp;</td>\n'
    + '\t\t</tr>\n\t</tbody>\n</table>\n\n';
}
function imageAlt(st, id) {
  const im = st.images[id];
  const o = st.opts.imageAlts && st.opts.imageAlts[id];
  return o !== undefined && o !== null ? o : (im.alt || '');
}
function imageBlock(st, id, docHref, alignCenter) {
  const im = st.images[id];
  const autoHref = docHref || (st.client.imageLinkDefault !== false && st.page ? pageWith(st, '') : '');
  im.docLink = autoHref;
  im.docAlt = im.alt || '';
  const lo = st.opts.imageLinks && st.opts.imageLinks[id];
  const href = lo !== undefined && lo !== null ? lo : autoHref;
  const max = st.client.imageWidth || 536;
  const w = im.w && im.w < max ? im.w : max;
  const tag = '<img alt="' + escAttr(imageAlt(st, id)) + '" src="%%IMG' + id + '%%" width="' + w + '" style="display:block;width:100%;max-width:' + w + 'px;height:auto;margin:0 auto;border:0;outline:none;text-decoration:none;" />';
  const inner = href ? '<a href="' + escAttr(href) + '" target="_blank">' + tag + '</a>' : tag;
  return '<table align="center" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin:8px auto 24px;max-width:' + w + 'px;" width="100%">\n\t<tbody>\n\t\t<tr>\n\t\t\t<td align="center">' + inner + '</td>\n\t\t</tr>\n\t</tbody>\n</table>\n\n';
}
function inlineImg(st, id) {
  const im = st.images[id];
  const w = Math.min(im.w || 200, st.client.imageWidth || 536);
  im.docAlt = im.alt || '';
  return '<img alt="' + escAttr(imageAlt(st, id)) + '" src="%%IMG' + id + '%%" width="' + w + '" style="height:auto;border:0;vertical-align:middle;" />';
}

/* ---------- asks header ---------- */
function asksHeader(st) {
  const c = st.client;
  if (c.platform !== 'ngp' && c.platform !== 'sb') return '';
  if (c.platform === 'ngp') {
    const lines = c.asks.slice(0, Math.max(4, st.askCount || 4)).map((a, i) => "{{set('ask" + (i + 1) + "', round_min_max(zero_if_null(HighestPreviousContributionAmount)*" + a.mult + ',1,' + a.min + ',' + a.max + "))}}");
    return '<!--\n' + lines.join('\n') + '\n--->\n\n';
  }
  const f = c.prevGiftField || 'sb_max_amount_donated';
  let s = '{% set hp = (' + f + ' or 0) | float %}\n';
  c.asks.slice(0, Math.max(4, st.askCount || 4)).forEach((a, i) => {
    const n = i + 1;
    s += '{% set a' + n + ' = (hp * ' + a.mult + ') | round | int %}{% if a' + n + ' < ' + a.min + ' %}{% set ask' + n + ' = ' + a.min + ' %}{% elif a' + n + ' > ' + a.max + ' %}{% set ask' + n + ' = ' + a.max + ' %}{% else %}{% set ask' + n + ' = a' + n + ' %}{% endif %}\n';
  });
  return s;
}

/* ---------- donation amounts read from link and button wording ---------- */
const ASK_BEFORE = /(chip in|chipping in|give|giving|donate|donating|contribute|contributing|pitch in|split|send|make a|add|even|just|only|as little as|at least|gift of|donation of|pledge)\s+(?:(?:a|an|us|me|another|additional|extra|that|your)\s+)*$/;
const GOAL_BEFORE = /(raise|raising|hit|hitting|reach|reaching|goal of|goal is|goal|need|needs|needed|match|matched|matching|total|target|toward|towards|up to|bring in|worth)\s+(?:(?:the|our|us|a|an|another|of|to|that|this)\s+)*(?:\w+\s+){0,1}$/;
const GOAL_AFTER = /^\s*(?:\w+\s+){0,2}(?:goal|deadline|target|total|match)\b/;
const ASK_AFTER = /^\s*(?:or\s+(?:any|more|whatever|what|even)|today\b|right now|now\b|to (?:help|show|support|keep|fund|get|make|stand|protect|flip|elect|send)\b)/;
function amountsIn(text) {
  const out = [];
  const re = /\$(\d[\d,]*(?:\.\d{1,2})?|\{\{[^}]+\}\})/g;
  let m;
  while ((m = re.exec(text))) {
    const merge = m[1][0] === '{';
    out.push({ idx: m.index, len: m[0].length, merge, raw: m[1], val: merge ? null : parseFloat(m[1].replace(/,/g, '')) });
  }
  return out;
}
function classifyAmount(a, text, isButton) {
  const before = text.slice(Math.max(0, a.idx - 60), a.idx).toLowerCase();
  const after = text.slice(a.idx + a.len, a.idx + a.len + 40).toLowerCase();
  if (!a.merge && a.val >= 1000 && !isButton) return 'goal';
  if (GOAL_AFTER.test(after)) return 'goal';
  if (ASK_BEFORE.test(before)) return 'ask';
  if (GOAL_BEFORE.test(before)) return 'goal';
  if (ASK_AFTER.test(after)) return 'ask';
  return isButton ? 'ask' : 'unknown';
}
function pickAmounts(text, isButton) {
  const list = amountsIn(text).map(a => Object.assign(a, { kind: classifyAmount(a, text, isButton) }));
  return {
    asks: list.filter(a => a.kind === 'ask'),
    unknown: list.filter(a => a.kind === 'unknown' && (a.merge || a.val < 1000))
  };
}
const amountValue = a => (a.merge ? a.raw : String(a.val));
function buttonAmount(rawLabel, st) {
  const am = rawLabel.match(/\$ASK([1-6])\b/);
  if (am) st.askCount = Math.max(st.askCount || 4, +am[1]);
  if (am) return askMerge(st, am[1]);
  const { asks } = pickAmounts(rawLabel, true);
  if (asks.length === 1) return amountValue(asks[0]);
  if (asks.length > 1) st.warn('The button [' + rawLabel + '] mentions more than one amount, so no amount= was set.');
  return null;
}
function inferAmounts(body, st) {
  let seen = -1;
  return body.replace(/<a\b([^>]*?)\bhref="([^"]*actblue\.com[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi, (m, pre, href, post, inner) => {
    if (/button-link/.test(pre + post) || /<img/i.test(inner)) return m;
    const raw = href.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    if (getParam(raw, 'amount') !== null) return m;
    const text = inner.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    const shown = text.length > 70 ? text.slice(0, 70).trim() + '…' : text;
    const { asks, unknown } = pickAmounts(text, false);
    if (asks.length === 1) {
      const v = amountValue(asks[0]);
      seen++;
      const off = (st.opts.linkAmountOff || []).includes(seen);
      st.amountLinks.push({ index: seen, amount: v, text: shown, on: !off });
      if (off) return m;
      return '<a' + pre + 'href="' + escAttr(setParam(raw, 'amount', v, false)) + '"' + post + '>' + inner + '</a>';
    }
    if (asks.length > 1) st.warn('The link "' + shown + '" mentions more than one amount, so no amount= was set.');
    else if (unknown.length) st.warn('The link "' + shown + '" mentions $' + unknown[0].raw + ' but it is not clear that it is an ask, so no amount= was set.');
    return m;
  });
}

function makeRecurring(body, st) {
  let n = 0;
  const out = body.replace(/<a\b([^>]*?)\bhref="([^"]*actblue\.com[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi, (m, pre, href, post, inner) => {
    if (/<img/i.test(inner) || /button-link/.test(pre + post)) return m;
    const raw = href.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const u2 = setParam(raw, 'recurring', '1', false);
    if (u2 !== raw) n++;
    return '<a' + pre + 'href="' + escAttr(u2) + '"' + post + '>' + inner + '</a>';
  });
  if (n) st.note('Donation links made recurring', n);
  return out;
}

function plainTextFrom(bodyHtml) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + bodyHtml, 'text/html');
  const out = [];
  const inlineText = node => {
    let s = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) s += n.nodeValue.replace(/\s+/g, ' ');
      else if (n.nodeType === 1) {
        const t = n.tagName.toLowerCase();
        if (t === 'br') s += '\n';
        else if (t === 'img') { const a = n.getAttribute('alt'); if (a) s += '[' + a + ']'; }
        else if (t === 'a' && !n.classList.contains('button-link')) {
          const href = n.getAttribute('href') || '';
          const inner = inlineText(n).trim();
          s += href && inner ? inner + ' (' + href + ')' : inner;
        } else s += inlineText(n);
      }
    });
    return s;
  };
  Array.from(doc.body.children).forEach(el => {
    const t = el.tagName.toLowerCase();
    if (t === 'p' || /^h\d$/.test(t)) {
      const x = inlineText(el).replace(/[ \t]*\n[ \t]*/g, '\n').trim();
      if (x) out.push(x);
    } else if (t === 'ul' || t === 'ol') {
      out.push(Array.from(el.querySelectorAll('li')).map((li, i) => (t === 'ol' ? (i + 1) + '. ' : '- ') + inlineText(li).trim()).join('\n'));
    } else if (t === 'table') {
      const btns = Array.from(el.querySelectorAll('a.button-link'));
      if (btns.length) {
        out.push(btns.map(a => inlineText(a).replace(/\s*→\s*$/, '').trim() + ': ' + a.getAttribute('href')).join('\n'));
      } else {
        const x = inlineText(el).replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]+/g, ' ').trim();
        if (x) out.push(x);
      }
    } else {
      const x = el.textContent.replace(/\s+/g, ' ').trim();
      if (x) out.push(x);
    }
  });
  return out.join('\n\n');
}

const MERGE_ALL = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
function fixMergeQuotes(x) { return x.replace(MERGE_ALL, m => straightenCode(m)); }
function checkMergeCode(texts, st) {
  const bad = [];
  texts.forEach(t => (String(t || '').match(MERGE_ALL) || []).forEach(m => { if (/[^\x20-\x7E\r\n\t]/.test(m)) bad.push(m.length > 60 ? m.slice(0, 60) + '...' : m); }));
  if (bad.length) st.warn('Merge code with an unusual character, it may not work: ' + [...new Set(bad)].slice(0, 3).join('  '));
}

/* ---------- main build ---------- */
function build(client, root, opts) {
  opts = Object.assign({ fix: true, refcode: '', toggles: {}, page: '' }, opts);
  const st = newState(client, opts);
  const S = st.style;
  const blocks = [];
  walk(root, blocks);
  let items = blocks.filter(b => b.type !== 'p' || plainOf(b) !== '' || hasImg(b));

  /* header lines: send time, sender, subject, preview text */
  let subject = null, pt = null, sender = '', sendTime = '';
  const META = /^(Send(?:\s*Date)?(?:\s*\/\s*Time)?|Sender(?:\s*Name)?|From|SL|Subject(?:\s*Line)?|PT|Pre-?header(?:\s*Text)?|Pre-?view(?:\s*Text)?)\s*[:\-–—]\s*(.*)$/i;
  const metaKind = label => (/^sender|^from/i.test(label) ? 'sender' : /^send/i.test(label) ? 'sendTime' : /^(sl|subject)/i.test(label) ? 'subject' : 'pt');
  const linesOf = b => {
    const lines = [''];
    (function rec(list) {
      for (const n of list) {
        if (n.nodeType === 3) lines[lines.length - 1] += n.nodeValue;
        else if (n.nodeType === 1) { if (n.tagName === 'BR') lines.push(''); else rec(n.childNodes); }
      }
    })(b.nodes || []);
    return lines.map(s => s.replace(/[ ​-‍﻿]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
  const meta = { subject: [], pt: [], sender: '', sendTime: '' };
  let sawMeta = false;
  const itemText = li => li.textContent.replace(/[ ​-‍﻿]/g, ' ').replace(/\s+/g, ' ').trim();
  while (items.length && items[0].type === 'p') {
    const ls = linesOf(items[0]);
    if (!ls.length) break;
    const ms = ls.map(l => l.match(META));
    if (!ms.every(Boolean)) break;
    items.shift();
    sawMeta = true;
    let pending = null;
    ms.forEach(m => {
      const k = metaKind(m[1]);
      const v = m[2].trim();
      pending = null;
      if (k === 'sender') { if (!meta.sender) meta.sender = v; }
      else if (k === 'sendTime') { if (!meta.sendTime) meta.sendTime = v; }
      else if (v) meta[k].push(v);
      else pending = k;
    });
    // "Subject Line:" followed by a list means several versions to test
    if (pending) {
      if (items.length && items[0].type === 'list') {
        items.shift().items.forEach(li => { const t = itemText(li); if (t) meta[pending].push(t); });
      } else {
        while (items.length && items[0].type === 'p') {
          const mm = plainOf(items[0]).match(/^\d+[.)]\s+(.+)$/);
          if (!mm) break;
          meta[pending].push(mm[1]);
          items.shift();
        }
      }
    }
  }
  let subjects = [], previews = [];
  if (sawMeta) {
    subjects = meta.subject; previews = meta.pt; sender = meta.sender; sendTime = meta.sendTime;
  } else if (items.length && items[0].type === 'p') {
    subjects = [plainOf(items.shift())];
  }
  if (!subjects.length) st.warn('No subject line found. Start the paste with the subject line, or a "Subject Line:" label.');

  const plainText = t => { st.last = ''; return applyTokens(fixText(t, st), st); };
  subjects = subjects.map(plainText);
  previews = previews.map(plainText);
  subject = subjects[0] || '';
  pt = previews[0] || '';
  const ptLabeled = previews.length > 0;

  /* body */
  const parts = [];
  const fs = client.bodyFontSize || 18;
  const pushPara = rec => {
    const style = rec.align === 'center' ? ' style="text-align:center;"' : '';
    parts.push({ rec, s: '<p' + style + '><span style="font-size:' + fs + 'px;">' + rec.html + '</span></p>\n\n' });
  };
  const autoLink = () => {
    if (!st.rules.has('ctaLink')) return;
    const last = parts[parts.length - 1];
    if (!last || !last.rec || !last.rec.allBold || last.rec.hasLink || last.rec.plain.length < 20) return;
    const m = last.s.match(/^(<p[^>]*><span[^>]*>)<strong>([\s\S]*)<\/strong>(<\/span><\/p>\n\n)$/);
    if (!m) return;
    last.s = m[1] + '<strong><a href="' + escAttr(pageWith(st, '')) + '">' + m[2] + '</a></strong>' + m[3];
    last.rec.hasLink = true;
    st.note('Bold ask sentence linked to the donate page');
  };

  const bodyPlain = [];
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (b.type === 'table') { st.warn('A table in the paste was skipped'); continue; }
    if (b.type === 'list') {
      const lis = b.items.map(li => {
        st.last = ''; st.flags = { text: 0, bold: 0, link: 0 };
        return '<li>' + applyTokens(cleanHtml(Array.from(li.childNodes).map(n => inline(n, st, {})).join('')), st) + '</li>';
      }).join('\n');
      const tagn = b.ordered ? 'ol' : 'ul';
      parts.push({ s: '<' + tagn + '>\n' + lis + '\n</' + tagn + '>\n\n' });
      continue;
    }
    if (b.type === 'heading') {
      const rec = para({ nodes: b.nodes }, st);
      parts.push({ s: '<h2>' + rec.html.replace(/<\/?(strong|em|u)>/g, '') + '</h2>\n\n' + barTable(S) });
      continue;
    }
    const t = plainOf(b);
    let m;
    if ((m = t.match(/^\[HTML\]([\s\S]*)$/i))) {
      let raw = rawOf(b.nodes).replace(/^\s*\[HTML\]/i, '');
      let done = /\[\/HTML\]/i.test(raw);
      while (!done && i + 1 < items.length) {
        i++;
        raw += '\n' + rawOf(items[i].nodes || []);
        done = /\[\/HTML\]/i.test(raw);
      }
      raw = raw.replace(/\[\/HTML\][\s\S]*$/i, '').trim();
      if (!done) st.warn('[HTML] was never closed with [/HTML]');
      parts.push({ s: raw + '\n\n' });
      st.note('Custom HTML block passed through');
      continue;
    }
    if (t.length <= 40 && /\b(?:ABX|EXPRESS|EXPL)\b/i.test(t)) { autoLink(); parts.push({ s: expressStack(st) }); continue; }
    if ((m = t.match(/^\[(?:DONATE|BUTTON|LINK)(?::\s*(.+?))?\]$/i)) || /^LINK$/.test(t)) {
      autoLink();
      const given = m && m[1] ? m[1].trim() : null;
      const amt = given ? buttonAmount(given, st) : null;
      if (amt) st.warn('Set amount=' + amt + ' on the button [' + given + ']');
      parts.push({ s: makeSingle(st, { label: given || String(client.buttons.single || 'DONATE').replace(/\s*&rarr;\s*$/i, ''), link: pageWith(st, ''), amount: amt }) });
      st.note('Donate button inserted');
      continue;
    }
    if ((m = t.match(/^\[IMAGE(?::\s*(\S+?))?\]$/i))) {
      const id = st.images.length;
      st.images.push({ id, src: '', alt: '', w: 0, url: m[1] || '' });
      parts.push({ s: imageBlock(st, id, null) });
      continue;
    }
    const snm = t.match(/^\[([A-Za-z][A-Za-z0-9 _-]{0,24})\]$/);
    if (snm) {
      const sname = snm[1].trim().toUpperCase();
      const customKey = Object.keys(client.snippets || {}).find(k => k.trim().toUpperCase() === sname);
      const builtin = ['CALLOUT', 'QUOTE', 'DIVIDER'].includes(sname);
      if (customKey || builtin) {
        const esc = sname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const closeRe = new RegExp('^\\[/' + esc + '\\]$', 'i');
        let j = i + 1, closed = false;
        const innerBlocks = [];
        while (j < items.length) {
          const tj = items[j].type === 'p' ? plainOf(items[j]) : '';
          if (closeRe.test(tj)) { closed = true; break; }
          innerBlocks.push(items[j]); j++;
        }
        const needsContent = sname === 'CALLOUT' || sname === 'QUOTE' || (customKey && String(client.snippets[customKey]).includes('%%CONTENT%%'));
        if (needsContent && !closed) {
          st.warn('[' + sname + '] was never closed with [/' + sname + ']');
        } else {
          const contentHtml = closed ? innerBlocks.map(b2 => (b2.type === 'p' ? para(b2, st).html : '')).filter(Boolean).join('<br /><br />\n') : '';
          if (closed) i = j;
          let outHtml;
          if (customKey) outHtml = String(client.snippets[customKey]).replace(/%%CONTENT%%/g, () => contentHtml).replace(/%%PAGE%%/g, () => escAttr(pageWith(st, ''))) + '\n\n';
          else if (sname === 'CALLOUT') outHtml = calloutBox(st, contentHtml);
          else if (sname === 'QUOTE') outHtml = quoteBlock(st, contentHtml);
          else outHtml = dividerRule(st);
          parts.push({ s: outHtml });
          st.note('Template [' + sname + '] inserted');
          continue;
        }
      }
    }
    const isLinked = (b.nodes || []).some(n => n.nodeType === 1 && (n.tagName === 'A' || (n.querySelector && n.querySelector('a'))));
    if ((m = t.match(/^\[([^\]]{2,40})\]$/)) && (isLinked || !/[a-z]/.test(m[1]))) {
      const lrec = para(b, st);
      const hm = lrec.html.match(/<a href="([^"]*)"/);
      const href = hm ? hm[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : pageWith(st, '');
      const rawLabel = m[1].trim();
      const amt = buttonAmount(rawLabel, st);
      if (amt) st.warn('Set amount=' + amt + ' on the button [' + rawLabel + ']');
      autoLink();
      parts.push({ s: makeSingle(st, { label: rawLabel, link: href, amount: amt }) });
      st.note('Button made from [' + m[1].trim() + ']');
      continue;
    }
    const rec = para(b, st);
    const only = rec.html.replace(/<\/?a[^>]*>/g, '').trim();
    const im = only.match(/^IMG(\d+)$/);
    if (im) {
      const hm = rec.html.match(/<a href="([^"]*)"/);
      const href = hm ? hm[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;
      parts.push({ s: imageBlock(st, +im[1], href) });
      continue;
    }
    if (!rec.html.trim()) continue;
    rec.html = rec.html.replace(/IMG(\d+)/g, (x, n) => inlineImg(st, +n));
    pushPara(rec);
    bodyPlain.push(rec.plain);
  }
  let body = parts.map(p => p.s).join('').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  body = inferAmounts(body, st);
  if (opts.recurring) body = makeRecurring(body, st);

  /* preview text is only ever what the draft says */
  if (!ptLabeled) pt = '';

  /* images -> src */
  const imgSrc = (html, mode) => html.replace(/%%IMG(\d+)%%/g, (x, n) => {
    const im = st.images[+n];
    return escAttr(im.url || (mode === 'preview' ? im.src : '') || 'PASTE-IMAGE-URL-HERE');
  });
  (opts.imageUrls || []).forEach((u, k) => {
    if (!st.images[k] || !u) return;
    if (/^https?:\/\/\S+$/i.test(u)) st.images[k].url = u;
    else st.warn('Image ' + (k + 1) + ': the hosted image URL does not look like a web address, so it was ignored.');
  });
  st.images.forEach((im, k) => {
    if (!im.url) st.warn('Image ' + (k + 1) + ' needs a hosted image URL');
    if (!imageAlt(st, k).trim()) st.warn('Image ' + (k + 1) + ': Put in alt text.');
  });

  /* document */
  let html;
  let footer = null;
  const header = asksHeader(st);
  if (client.output.mode === 'document' && !client._template) st.warn('This client has no email template yet, so only the body is shown.');
  if (client.output.mode === 'body' || !client._template) {
    html = header + body;
    const samePage = (a, b) => String(a || '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase() === String(b || '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
    if (!samePage(st.page, client.defaultPage)) footer = { state: 'locked', regular: client.defaultPage, event: st.page };
  } else {
    let doc = client._template;
    const tg = opts.toggles || {};
    const baseOf = u => String(u || '').split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
    const eventPage = st.page, regularPage = client.defaultPage;
    const footerPage = opts.footerOverride ? eventPage : regularPage;
    if (tg.footerbox !== false && baseOf(eventPage) !== baseOf(regularPage)) footer = { state: opts.footerOverride ? 'override' : 'default', regular: regularPage, event: eventPage };
    if (tg.logo === false) doc = doc.replace(/<!--\{HEADER\}-->[\s\S]*?<!--\{\/HEADER\}-->/, '');
    if (tg.footerbox === false) doc = doc.replace(/<!--\{FOOTERBOX\}-->[\s\S]*?<!--\{\/FOOTERBOX\}-->/, '');
    doc = doc.replace(/<!--\{\/?(HEADER|FOOTERBOX)\}-->/g, '');
    const ptDiv = pt ? '<div style="display:none;max-height:0px;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">' + enc(escText(pt)) + '</div>' : '';
    doc = doc.replace('%%PREHEADER%%', () => ptDiv).replace('%%ASKS%%', () => header.trim()).replace('%%BODY%%', () => body);
    doc = doc.replace(/%%PAGE(?:\|([^%]*))?%%/g, (x, params) => escAttr(pageWith(st, params || '')));
    doc = doc.replace(/%%FPAGE(?:\|([^%]*))?%%/g, (x, params) => escAttr(pageWith(st, params || '', footerPage)));
    html = doc;
  }

  /* refcodes on ActBlue links */
  let touched = 0;
  const mode = (client.refcode || {}).mode;
  const applyRef = h => h.replace(/href="([^"]*actblue\.com[^"]*)"/gi, (m0, href) => {
    const raw = href.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    let u2 = raw;
    if (mode === 'append' && opts.refcode) u2 = setParam(raw, 'refcode', opts.refcode, true);
    else u2 = setParam(raw, 'refcode', null, false);
    if (u2 !== raw) touched++;
    return 'href="' + escAttr(u2) + '"';
  });
  html = applyRef(html);

  /* plain-text copy (Switchboard needs one; NGP and Mailchimp make their own) */
  let plainOut = '';
  if (client.platform === 'sb') {
    const urlRe = /https?:\/\/(?:[^\s)<>"{]|\{\{[^}]*\}\})*actblue\.com(?:[^\s)<>"{]|\{\{[^}]*\}\})*/gi;
    plainOut = fixMergeQuotes(plainTextFrom(body)).replace(urlRe, u => (mode === 'append' && opts.refcode ? setParam(u, 'refcode', opts.refcode, true) : setParam(u, 'refcode', null, false)));
    const foot = String(client.plainFooter || '').trim();
    if (foot) plainOut += '\n\n' + foot;
    plainOut += '\n';
  }
  if (client.output.mode === 'document' && client._template && st.style.caps === false) {
    html = html.replace(/(<a class="button-link"[^>]*>)([^<]*)(<\/a>)/g, (m, a, t, c) => a + caseLabel(t, false) + c);
  }
  if (mode === 'append') {
    if (!opts.refcode) st.warn('Links currently have no refcode.');
    else if (touched) st.note('Refcode added to ActBlue links', touched);
  } else if (touched) st.note('Refcode removed from ActBlue links', touched);

  leftoverCheck(body, st);
  const final = fixMergeQuotes(imgSrc(html, 'out'));
  checkMergeCode([final].concat(subjects, previews, [plainOut]), st);
  const bodyMode = client.output.mode === 'body' || !client._template;
  const previewHtml = fixMergeQuotes(imgSrc(bodyMode ? html : (header.trim() ? html.replace(header.trim(), '') : html), 'preview'));
  const bytes = new Blob([final]).size;
  if (bytes > 100 * 1024) st.warn('This email is ' + Math.round(bytes / 1024) + 'KB. Gmail clips messages over about 102KB.');
  if (/PASTE-IMAGE-URL-HERE/.test(final)) { /* warned above */ }

  return {
    subject, preheader: pt, subjects, previews, sender, sendTime, plainText: plainOut, footer, buttons: st.buttons, amountLinks: st.amountLinks, html: final, bodyHtml: imgSrc(body, 'out'),
    previewSource: previewHtml, bodyMode, images: st.images, bytes,
    changes: Array.from(st.changes.entries()).map(([k, v]) => (v > 1 ? k + ' (' + v + ')' : k)),
    warnings: st.warnings
  };
}

/* ---------- preview ---------- */
const SAMPLE = {
  sb_first_name: 'Alex', first_name: 'Alex', firstname: 'Alex', FirstName: 'Alex',
  ask1: 10, ask2: 25, ask3: 50, ask4: 100, ask5: 250, ask6: 500,
  sb_max_amount_donated: 30, sb_most_recent_donation_amount: 25, previous_donation: 30, total_donations: 2,
  sb_unsubscribe: '#', sb_month: 'November', sb_weekday: 'Tuesday', sb_day: '3', sb_year: '2026'
};
function jsExpr(expr) {
  return expr
    .replace(/\|\s*(?:title|bold|italic|int|float|round|sb_money|sb_date\([^)]*\))/g, '')
    .replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!')
    .replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
}
function evalJs(expr) {
  const ctx = new Proxy(SAMPLE, { has: (t, k) => typeof k === 'string', get: (t, k) => t[k] });
  try { return new Function('c', 'with(c){return (' + jsExpr(expr) + ')}')(ctx); } catch (e) { return undefined; }
}
function jinjaPreview(h) {
  h = h.replace(/\{%-?\s*set\b[\s\S]*?-?%\}/g, '');
  const re = /\{%-?\s*(if|elif|else|endif)\b\s*([\s\S]*?)\s*-?%\}/g;
  let out = '', last = 0, m;
  const stack = [];
  const active = () => stack.every(f => f.on);
  while ((m = re.exec(h))) {
    if (active()) out += h.slice(last, m.index);
    last = m.index + m[0].length;
    const kind = m[1], cond = m[2];
    if (kind === 'if') { const v = !!evalJs(cond); stack.push({ on: v, taken: v }); }
    else if (kind === 'elif') { const f = stack[stack.length - 1]; if (f) { const v = !f.taken && !!evalJs(cond); f.on = v; f.taken = f.taken || v; } }
    else if (kind === 'else') { const f = stack[stack.length - 1]; if (f) { f.on = !f.taken; f.taken = true; } }
    else stack.pop();
  }
  if (active()) out += h.slice(last);
  return out.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (all, expr) => {
    if (/^(?:get\(|FirstName\b)/.test(expr) || /^if\b|^end$|^set\(|^EmailContent$/.test(expr)) return all;
    let v = evalJs(expr);
    if (v === undefined || v === null) return '';
    if (/\|\s*title/.test(expr)) v = String(v).replace(/\b\w/g, c => c.toUpperCase());
    return String(v);
  });
}
function resolveMerges(h) {
  h = h.replace(/<!--[\s\S]*?-->/g, m => (/\{\{set\(|\{% set/.test(m) ? '' : m));
  h = h.replace(/\{\{\s*if [^}]*\}\}/g, '').replace(/\{\{\s*end\s*\}\}/g, '');
  h = h.replace(/\{\{\s*UnsubscribeUrl\s*\}\}/g, '#');
  h = h.replace(/\{\{\s*get\('ask(\d)'\)\s*\}\}/g, (m, n) => SAMPLE['ask' + n]);
  h = h.replace(/\{\{\s*FirstName\s+or\s+'[^']*'\s*\}\}/g, 'Alex');
  h = h.replace(/\*\|FNAME(?::[^|]*)?\|\*/g, 'Alex').replace(/\*\|UNSUB\|\*/g, '#');
  return jinjaPreview(h);
}
function previewDoc(client, result, mode) {
  let h = result.previewSource;
  if (result.bodyMode && client._theme) {
    h = client._theme.replace('{{EmailContent}}', () => h.replace(/^<!--[\s\S]*?--->\s*/, ''));
  }
  h = h.replace(/@media \(prefers-color-scheme: dark\)/g, mode === 'dark' ? '@media all' : '@media not all');
  return resolveMerges(h);
}

g.EmailEngine = { build, previewDoc, RULES, TYPOS };
})(typeof window !== 'undefined' ? window : globalThis);
