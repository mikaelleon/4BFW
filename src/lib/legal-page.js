// Markup, style and browser script of the legal page. Self-contained: no external fonts, scripts or trackers.
// It reads like a dictionary entry for STFW, with the sections as numbered senses.
// Without JavaScript both documents simply show one after the other.

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = String.raw`
  /* One radius family, always nested: outer 20 = inner 12 + padding 8; segmented control 12 = thumb 8 + padding 4. */
  :root {
    color-scheme: light;
    --bg: #f5f0f2; --card: #fff; --inner: #f5f0f2; --ink: #241a1d; --muted: #685359; --accent: #821b33; --fill: #821b33;
    --marker: #f0a03c; --mark-ink: #a95f06; --ring: rgb(80 20 35 / .09); --track: #d9cdd1; --on: 0;
    --lift: 0 0 0 1px var(--ring), 0 1px 2px rgb(80 20 35 / .05), 0 10px 24px -16px rgb(80 20 35 / .25);
    --r1: 20px; --r2: 12px; --r3: 8px;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg: #140f11; --card: #211a1d; --inner: #2d2327; --ink: #f2ebed; --muted: #bcaab0; --accent: #f08da2; --fill: #9c2a46;
      --mark-ink: #f0a03c; --ring: rgb(255 255 255 / .08); --track: #4a3a40; --on: 1; --lift: 0 0 0 1px var(--ring);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #140f11; --card: #211a1d; --inner: #2d2327; --ink: #f2ebed; --muted: #bcaab0; --accent: #f08da2; --fill: #9c2a46;
    --mark-ink: #f0a03c; --ring: rgb(255 255 255 / .08); --track: #4a3a40; --on: 1; --lift: 0 0 0 1px var(--ring);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 1rem/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased; }
  [hidden] { display: none !important; }
  .wrap { max-width: 64rem; margin: 0 auto; padding-inline: 1rem; }
  :focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; }
  .sr, .js h2 { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  button, input { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: 0; padding: 0; white-space: nowrap; }
  h3 { text-wrap: balance; }
  p, li { text-wrap: pretty; }

  header { padding-top: 3rem; padding-bottom: 1.5rem; }
  h1 { margin: 0; font-size: clamp(2.5rem, 8vw, 4rem); font-weight: 600; line-height: 1; letter-spacing: -.022em; color: var(--accent); }
  h1 span { color: var(--mark-ink); }
  header p { margin: .75rem 0 0; max-width: 40rem; }
  .say { color: var(--muted); }
  .sense { font-size: 1.15rem; line-height: 1.5; }
  .sense b { font-weight: 600; color: var(--accent); }
  .updated { color: var(--muted); font-size: .875rem; }

  .card, article { background: var(--card); border-radius: var(--r1); padding: 8px; box-shadow: var(--lift); }

  /* Toolbar */
  .bar { position: sticky; top: 0; z-index: 5; padding-block: 8px; background: var(--bg); }
  .tools { display: grid; grid-template: "tabs search examples theme" / auto minmax(0, 1fr) auto auto; gap: 8px; }
  .tabs, .who fieldset { position: relative; grid-auto-flow: column; grid-auto-columns: 1fr; margin: 0; padding: 4px; border: 0;
    border-radius: var(--r2); background: var(--inner); isolation: isolate; }
  .tabs { grid-area: tabs; display: grid; }
  /* The sliding thumb under the picked segment. --i is the picked index. */
  .tabs::before, .who fieldset::before { content: ""; position: absolute; z-index: -1; top: 4px; bottom: 4px; left: 4px;
    width: calc((100% - 8px) / var(--n)); border-radius: var(--r3); background: var(--fill); transform: translateX(calc(var(--i, 0) * 100%)); }
  .tabs { --n: 3; }
  .tabs button { position: relative; height: 36px; padding-inline: 1rem; border-radius: var(--r3); color: var(--muted); }
  .tabs button::after { content: ""; position: absolute; inset: -4px 0; }
  .tabs button[aria-selected="true"] { color: #fff; }
  input[type="search"] { grid-area: search; width: 100%; min-width: 0; height: 44px; padding-inline: 1rem; border: 0; border-radius: var(--r2);
    background: var(--inner); }
  input::placeholder { color: var(--muted); }
  .toggle { grid-area: examples; display: flex; align-items: center; justify-content: space-between; gap: .75rem; height: 44px;
    padding: 0 10px 0 1rem; border-radius: var(--r2); background: var(--inner); cursor: pointer; user-select: none; white-space: nowrap; }
  .toggle input { appearance: none; position: relative; flex: none; width: 40px; height: 24px; margin: 0; border-radius: 12px;
    background: var(--track); cursor: inherit; }
  .toggle input::after { content: ""; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    box-shadow: 0 1px 3px rgb(0 0 0 / .3); }
  .toggle input:checked { background: var(--fill); }
  .toggle input:checked::after { transform: translateX(16px); }
  .toggle:has(input:disabled) { opacity: .45; cursor: default; }
  /* Theme switch: position and icon colors come from the theme tokens, so it is right before any script runs. */
  #theme { grid-area: theme; display: grid; place-items: center; width: 72px; height: 44px; border-radius: var(--r2); background: var(--inner); }
  .track { position: relative; display: flex; width: 56px; height: 32px; padding: 4px; border-radius: 16px; background: var(--track); }
  .knob { position: absolute; top: 4px; left: 4px; width: 24px; height: 24px; border-radius: 50%; background: var(--card);
    box-shadow: 0 1px 3px rgb(0 0 0 / .3); transform: translateX(calc(var(--on) * 24px)); }
  .track svg { position: relative; width: 24px; height: 24px; padding: 4px; fill: none; stroke: currentColor; stroke-width: 2;
    stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .track .sun { color: color-mix(in srgb, var(--accent) calc((1 - var(--on)) * 100%), var(--ink)); }
  .track .moon { color: color-mix(in srgb, var(--accent) calc(var(--on) * 100%), var(--ink)); }

  main { display: grid; gap: 16px; padding-top: 8px; padding-bottom: 16px; }
  nav.toc { display: none; }
  @media (min-width: 56rem) {
    .js main { grid-template-columns: 17rem minmax(0, 1fr); align-items: start; }
    .js nav.toc { display: block; position: sticky; top: 76px; max-height: calc(100vh - 84px); overflow: auto; }
  }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc a { display: block; padding: .6rem .75rem; border-radius: var(--r2); color: var(--muted); text-decoration: none; font-size: .875rem; line-height: 1.4; }
  .toc a[aria-current="true"] { background: var(--inner); color: var(--accent); }
  li + li { margin-top: .5rem; }
  .toc li + li { margin-top: 2px; }

  h2 { font-size: 1.5rem; font-weight: 600; }
  .doc + .doc { margin-top: 4rem; }
  .js .doc + .doc { margin-top: 0; }
  article { display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 4px; margin-bottom: 16px; scroll-margin-top: 80px; }
  article.here { box-shadow: 0 0 0 2px var(--accent); }
  article > * { grid-column: 2; }
  .num { grid-column: 1; grid-row: 1; position: relative; display: grid; place-items: center; width: 40px; height: 40px;
    border-radius: var(--r2); background: var(--inner); color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; text-decoration: none; }
  article.here .num { background: var(--fill); color: #fff; }
  .num[data-note]::after { content: attr(data-note); position: absolute; left: 0; top: calc(100% + 4px); z-index: 1; padding: .25rem .5rem;
    border-radius: var(--r3); background: var(--ink); color: var(--bg); font-size: .75rem; font-weight: 400; line-height: 1.5; white-space: nowrap; }
  h3 { grid-row: 1; align-self: center; margin: 0; padding: .25rem .75rem; font-size: 1.15rem; font-weight: 600; line-height: 1.4; }
  article p { margin: 0; padding: .25rem .75rem .75rem; max-width: 40rem; }
  article ul { margin: 0; padding: .25rem .75rem .75rem 1.9rem; max-width: 42rem; }
  article aside { grid-column: 1 / -1; padding: .75rem 1rem .75rem 3.5rem; border-radius: var(--r2); background: var(--inner); color: var(--muted); }
  article a:not(.num) { color: var(--accent); text-underline-offset: 3px; }

  .who { margin-bottom: 16px; }
  .who h3 { padding: .5rem .75rem .75rem; }
  .who fieldset { display: none; --n: 2; }
  .js .who fieldset { display: grid; }
  .who label { position: relative; display: grid; place-items: center; min-height: 36px; padding: 0 .25rem; border-radius: var(--r3);
    color: var(--muted); cursor: pointer; font-size: .875rem; line-height: 1.2; text-align: center; }
  .who label::after { content: ""; position: absolute; inset: -4px 0; }
  .who input { position: absolute; opacity: 0; pointer-events: none; }
  .who label:has(input:checked) { color: #fff; }
  .who label:has(input:focus-visible) { outline: 2px solid var(--marker); outline-offset: 2px; }
  .post { margin-top: 8px; padding: .75rem 1rem; border-left: 4px solid var(--accent); border-radius: var(--r2); background: var(--inner); }
  .post p { margin: 0; }
  .post b { font-weight: 600; }
  .post small { color: var(--muted); font-size: .875rem; }
  .sent { display: none; align-items: center; gap: .5rem; margin-top: .75rem !important; font-size: .875rem; }
  .js .sent { display: flex; }
  .sent span { padding: .1rem .5rem; border-radius: var(--r3); background: var(--ink); color: var(--bg); }
  .answers { margin: 0; padding: .75rem; list-style: none; }
  .js .answers { min-height: 4.7rem; }
  .js .answers b { display: none; }
  mark { background: var(--marker); color: #241a1d; }
  .empty { padding-inline: .75rem; color: var(--muted); }

  footer { padding-bottom: 3rem; }
  footer p { margin: 0; padding: .25rem .75rem .75rem; color: var(--muted); font-size: .875rem; }
  footer ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  footer li + li { margin: 0; }
  footer a { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding-inline: 1rem; border-radius: var(--r2);
    background: var(--inner); color: var(--accent); text-decoration: none; }
  footer a::after { content: "↗" / ""; }

  /* Motion and feedback. Transitions switch on after the first paint, and only ever move things. */
  .ready .tabs::before, .ready .who fieldset::before, .ready .knob, .ready .toggle input::after { transition: transform .2s cubic-bezier(.65, 0, .35, 1); }
  .tabs button, .num, #theme, .who label, footer a, .toc a { transition: scale .12s ease; }
  .tabs button:active, .num:active, #theme:active, .who label:active, footer a:active, .toc a:active { scale: .96; }
  @media (hover: hover) {
    .tabs button[aria-selected="false"]:hover, .who label:not(:has(input:checked)):hover { color: var(--ink); }
    .toc a:hover { background: var(--inner); color: var(--ink); }
    .toc a[aria-current="true"]:hover { color: var(--accent); }
    #theme:hover, .toggle:hover:not(:has(input:disabled)), .num:hover, footer a:hover { box-shadow: inset 0 0 0 1px var(--accent); }
  }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }

  @media (max-width: 40rem) {
    header { padding-top: 1.5rem; padding-bottom: .5rem; }
    header p { margin-top: .4rem; }
    .sense { font-size: 1rem; }
    .tools { grid-template: "tabs tabs theme" "search search examples" / minmax(0, 1fr) auto auto; }
    .tools #theme { justify-self: end; }
    .toggle { gap: .5rem; padding-left: .75rem; font-size: .875rem; }
    .long { display: none; }
    .tabs button { padding-inline: .25rem; font-size: .875rem; }
    article { scroll-margin-top: 132px; }
    article p { grid-column: 1 / -1; }
    article ul { grid-column: 1 / -1; padding-left: 2rem; }
    article aside { padding-left: .75rem; }
    .js .answers { min-height: 6.4rem; }
    .who label { font-size: .75rem; padding: 0; white-space: nowrap; }
  }
  @media print { .bar, .toc { display: none !important; } .doc, aside, .answers li { display: block !important; } .who fieldset, .sent { display: none !important; } .answers b { display: inline !important; } article { display: grid !important; } main { display: block; } .card, article { box-shadow: none; } }
`;

// Runs in the browser. Kept free of backticks so it can sit inside String.raw.
const SCRIPT = String.raw`
(function () {
  var root = document.documentElement;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var docs = $$('.doc'), tabs = $$('[role="tab"]'), tocs = $$('.toc ol');
  var search = $('#search'), examples = $('#examples'), theme = $('#theme');
  var current = docs[0].id, picked = null;

  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  function show(id) {
    current = id;
    docs.forEach(function (d) { d.hidden = d.id !== id; });
    tocs.forEach(function (t) { t.hidden = t.dataset.doc !== id; });
    tabs.forEach(function (t) {
      var on = t.dataset.doc === id;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on) t.parentElement.style.setProperty('--i', tabs.indexOf(t));
    });
    // The examples switch stays in place (no jump) and is disabled on a document without examples.
    examples.disabled = !$('#' + id + ' aside');
    filter();
  }

  // "#privacy" opens a document, "#privacy-3" opens it at a section.
  function route() {
    var hash = location.hash.slice(1);
    var id = hash.split('-')[0];
    if (!docs.some(function (d) { return d.id === id; })) return show(current);
    if (hash !== id) search.value = '';
    show(id);
    var target = document.getElementById(hash);
    picked = hash !== id && target ? target : null;
    $$('article').forEach(function (a) { a.classList.toggle('here', a === picked); });
    if (picked) picked.scrollIntoView();
    else window.scrollTo(0, 0);
    spy();
  }

  function go(hash) {
    history.pushState(null, '', '#' + hash);
    route();
  }

  function unmark(el) {
    $$('mark', el).forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
    el.normalize();
  }

  function highlight(el, term) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.num, .sr')) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var at = node.nodeValue.toLowerCase().indexOf(term);
      while (at !== -1) {
        var hit = node.splitText(at);
        node = hit.splitText(term.length);
        var mark = document.createElement('mark');
        hit.replaceWith(mark);
        mark.appendChild(hit);
        at = node.nodeValue.toLowerCase().indexOf(term);
      }
    });
  }

  function filter() {
    var term = search.value.trim().toLowerCase(), found = 0;
    var doc = document.getElementById(current);
    $$('article', doc).forEach(function (a) {
      unmark(a);
      var text = $$('h3, p, li' + (examples.checked ? ', aside' : ''), a)
        .map(function (n) { return n.textContent; }).join(' ').toLowerCase();
      var hit = !term || text.indexOf(term) !== -1;
      a.hidden = !hit;
      $('.toc a[href="#' + a.id + '"]').parentElement.hidden = !hit;
      if (hit) found++;
      if (hit && term) highlight(a, term);
    });
    $('.empty', doc).hidden = found > 0;
  }

  // Marks the section being read in the contents list.
  function spy() {
    var doc = document.getElementById(current);
    var shown = $$('article', doc).filter(function (a) { return !a.hidden; });
    var max = root.scrollHeight - root.clientHeight;
    var active = shown.filter(function (a) { return a.getBoundingClientRect().top < $('.bar').offsetHeight + 40; }).pop() || shown[0];
    if (max > 0 && root.scrollTop >= max - 2) active = shown[shown.length - 1];
    // The picked section wins only while it is still on screen (a scrollbar drag fires none of the events below).
    var box = picked && shown.indexOf(picked) !== -1 && picked.getBoundingClientRect();
    if (box && box.bottom > $('.bar').offsetHeight && box.top < innerHeight) active = picked;
    $$('.toc a').forEach(function (l) { l.setAttribute('aria-current', !!active && l.hash === '#' + active.id); });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { go(tab.dataset.doc); });
    tab.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      var next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      go(next.dataset.doc);
    });
  });

  $$('.toc a').forEach(function (l) {
    l.addEventListener('click', function (e) { e.preventDefault(); go(l.hash.slice(1)); });
  });

  // Clicking a section number copies a link to that section.
  $$('.num').forEach(function (n) {
    n.addEventListener('click', function (e) {
      e.preventDefault();
      history.replaceState(null, '', n.hash);
      picked = n.parentElement;
      $$('article').forEach(function (a) { a.classList.toggle('here', a === picked); });
      spy();
      var done = function (note) { n.dataset.note = note; setTimeout(function () { delete n.dataset.note; }, 1800); };
      if (!navigator.clipboard) return done('Link in address bar');
      navigator.clipboard.writeText(n.href).then(function () { done('Link copied'); }, function () { done('Link in address bar'); });
    });
  });

  var viewers = $$('.who input'), answers = $$('.answers li');
  function view() {
    viewers.forEach(function (v, i) {
      if (!v.checked) return;
      answers.forEach(function (a, j) { a.hidden = i !== j; });
      v.closest('fieldset').style.setProperty('--i', i);
    });
  }
  viewers.forEach(function (v) { v.addEventListener('change', view); });
  if (viewers.length) { viewers[0].checked = true; view(); }

  examples.addEventListener('change', function () {
    $$('aside').forEach(function (a) { a.hidden = !examples.checked; });
    filter();
    spy();
  });

  function isDark() {
    return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function label() { theme.setAttribute('aria-checked', isDark()); }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  theme.addEventListener('click', function () {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    save('theme', root.dataset.theme);
    label();
  });

  search.addEventListener('input', function () { filter(); spy(); });
  addEventListener('scroll', spy, { passive: true });
  // Once the reader scrolls by hand, the contents list follows the scroll position again.
  ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach(function (type) {
    addEventListener(type, function (e) {
      if (!e.target.closest || !e.target.closest('.toc, .num')) picked = null;
    }, { passive: true });
  });
  addEventListener('resize', spy);
  addEventListener('hashchange', route);
  addEventListener('popstate', route);
  examples.checked = true;
  label();
  route();
  spy();
  setTimeout(function () { root.classList.add('ready'); }, 50);
  // The browser jumps to "#terms" by itself once loaded: go back up so the title stays in view.
  addEventListener('load', function () {
    if (location.hash.indexOf('-') === -1) setTimeout(function () { window.scrollTo(0, 0); }, 0);
  });
})();
`;

// Runs before the page paints, so a saved theme does not flash and the contents list only shows with JavaScript.
const BOOT = `document.documentElement.className='js';try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

const icon = (name, shapes) => `<svg class="${name}" viewBox="0 0 24 24" aria-hidden="true">${shapes}</svg>`;
const SUN = icon('sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>');
const MOON = icon('moon', '<path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z"/>');

const external = (label, url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

const article = (docId, section, n) => {
  const { title, body, points, example, links = [] } = section;
  const text = (s) => links.reduce((out, [phrase, url]) => out.replace(escapeHtml(phrase), () => external(escapeHtml(phrase), url)), escapeHtml(s));
  return [
    `<article id="${docId}-${n}">`,
    `<a class="num" href="#${docId}-${n}" title="Copy link to this section">${n}</a>`,
    `<h3>${escapeHtml(title)}</h3>`,
    body ? `<p>${text(body)}</p>` : '',
    points ? `<ul>${points.map((p) => `<li>${text(p)}</li>`).join('')}</ul>` : '',
    example ? `<aside><span class="sr">Example: </span>${escapeHtml(example)}</aside>` : '',
    '</article>',
  ].join('\n');
};

const whoSeesWhat = ({ heading, post, viewers }) => `<div class="who card">
<h3>${escapeHtml(heading)}</h3>
<fieldset><legend class="sr">Viewer</legend>${viewers
  .map((v) => `<label><input type="radio" name="viewer"> ${escapeHtml(v.name)}</label>`)
  .join('')}</fieldset>
<div class="post">
<p><b>${escapeHtml(post.title)}</b> <small>Sample post</small></p>
<p>${escapeHtml(post.text)}</p>
<p class="sent">Sent by <span>Hidden</span></p>
</div>
<ul class="answers" aria-live="polite">${viewers.map((v) => `<li><b>${escapeHtml(v.name)}: </b>${escapeHtml(v.answer)}</li>`).join('')}</ul>
</div>`;

// "Terms of Use" -> "Terms<span> of Use</span>", so narrow screens can show the first word only.
const tabName = (name) => {
  const [first, ...rest] = name.split(' ');
  return rest.length ? `${first}<span class="long"> ${rest.join(' ')}</span>` : first;
};

/** The whole page. `docs` is [{ id, name, who?, sections: [{ title, body?, points?, example? }] }]; ids hold no "-". */
export function renderLegalPage({ updated, docs, related = [] }) {
  const names = new Intl.ListFormat('en').format(docs.map((d) => d.name));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STFW · ${names}</title>
<meta name="description" content="${names} of STFW, the Server Thoughts Freedom Wall Discord bot.">
<style>${STYLE}</style>
<script>${BOOT}</script>
</head>
<body>
<header class="wrap">
  <h1>ST<span>FW</span></h1>
  <p class="say"><i>noun</i> /ˌɛs-ti-ɛf-ˈdʌbəl-ju/</p>
  <p class="sense"><b>S</b>erver <b>T</b>houghts <b>F</b>reedom <b>W</b>all; an anonymous outlet for unfiltered thoughts and confessions.</p>
  <p class="updated">Last updated ${updated}</p>
</header>
<div class="bar"><div class="wrap"><div class="tools card">
  <div class="tabs" role="tablist" aria-label="Document">
    ${docs.map((d) => `<button type="button" role="tab" data-doc="${d.id}" aria-controls="${d.id}" aria-label="${d.name}">${tabName(d.name)}</button>`).join('')}
  </div>
  <input type="search" id="search" placeholder="Search" aria-label="Search this document">
  <label class="toggle">Examples <input type="checkbox" role="switch" id="examples" checked></label>
  <button type="button" id="theme" role="switch" aria-checked="false" aria-label="Dark mode" title="Dark mode">
    <span class="track"><span class="knob"></span>${SUN}${MOON}</span>
  </button>
</div></div></div>
<main class="wrap">
  <nav class="toc card" aria-label="Contents">
    ${docs
      .map((d) => `<ol data-doc="${d.id}">${d.sections.map((s, i) => `<li><a href="#${d.id}-${i + 1}">${escapeHtml(s.title.replace(/\.$/, ''))}</a></li>`).join('')}</ol>`)
      .join('\n')}
  </nav>
  <div>
    ${docs
      .map(
        (d) => `<section class="doc" id="${d.id}">
<h2>${d.name}</h2>
${d.who ? whoSeesWhat(d.who) : ''}
${d.sections.map((s, i) => article(d.id, s, i + 1)).join('\n')}
<p class="empty" role="status" hidden>No section matches your search</p>
</section>`,
      )
      .join('\n')}
  </div>
</main>
<footer class="wrap"><div class="card">
  <p>Discord’s own policies</p>
  <ul>${related.map(([label, url]) => `<li>${external(escapeHtml(label), url)}</li>`).join('')}</ul>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
