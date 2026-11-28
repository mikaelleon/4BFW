// Markup, style and browser script of the legal page. Self-contained: no external fonts, scripts or trackers.
// It reads like a dictionary entry for STFW, with the sections as numbered senses.
// Without JavaScript both documents simply show one after the other.

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = String.raw`
  :root {
    color-scheme: light;
    --bg: #fff; --ink: #241a1d; --muted: #6e5d63; --line: #e8e0e3; --accent: #821b33; --marker: #f0a03c; --mark-ink: #b4690c;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg: #1a1315; --ink: #f2ebed; --muted: #b6a4aa; --line: #3a2c31; --accent: #f08da2; --mark-ink: #f0a03c;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #1a1315; --ink: #f2ebed; --muted: #b6a4aa; --line: #3a2c31; --accent: #f08da2; --mark-ink: #f0a03c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 1rem/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  [hidden] { display: none !important; }
  .wrap { max-width: 62rem; margin: 0 auto; padding-inline: 1rem; }
  :focus-visible { outline: 2px solid var(--marker); outline-offset: 2px; }
  .sr, .js h2 { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  header { padding-top: 3rem; padding-bottom: 2rem; }
  h1 { margin: 0; font-size: clamp(2.5rem, 8vw, 4rem); font-weight: 600; line-height: 1; color: var(--accent); }
  h1 span { color: var(--mark-ink); }
  header p { margin: .75rem 0 0; max-width: 40rem; }
  .say { color: var(--muted); }
  .sense { font-size: 1.15rem; line-height: 1.5; }
  .sense b { font-weight: 600; color: var(--accent); }
  .updated { color: var(--muted); font-size: .875rem; }

  .bar { position: sticky; top: 0; z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); }
  .bar .wrap { display: flex; align-items: center; gap: 1.25rem; height: 3.5rem; }
  .tabs { display: flex; gap: 1.25rem; align-self: stretch; }
  button, input { font: inherit; color: inherit; }
  button { cursor: pointer; background: none; border: 0; padding: 0; white-space: nowrap; }
  button:hover { color: var(--accent); }
  .tabs button { border-block: 2px solid transparent; color: var(--muted); }
  .tabs button[aria-selected="true"] { border-bottom-color: var(--accent); color: var(--ink); font-weight: 600; }
  input[type="search"] { flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: .3rem .75rem; }
  .toggle { display: flex; align-items: center; gap: .4rem; cursor: pointer; white-space: nowrap; }
  .toggle input { accent-color: #821b33; margin: 0; }

  main { display: grid; gap: 3rem; padding-top: 2.5rem; padding-bottom: 3rem; }
  nav.toc { display: none; }
  @media (min-width: 56rem) {
    .js main { grid-template-columns: 15rem minmax(0, 1fr); align-items: start; }
    .js nav.toc { display: block; position: sticky; top: 6rem; max-height: calc(100vh - 7rem); overflow: auto; }
  }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc a { display: block; padding: .375rem 0; color: var(--muted); text-decoration: none; font-size: .875rem; line-height: 1.4; }
  .toc a:hover { color: var(--ink); }
  .toc a[aria-current="true"] { color: var(--accent); font-weight: 600; }

  h2 { font-size: 1.5rem; font-weight: 600; }
  .doc { max-width: 40rem; }
  .doc + .doc { margin-top: 4rem; }
  .js .doc + .doc { margin-top: 0; }
  article { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); margin-bottom: 2.5rem; scroll-margin-top: 5rem; }
  article > * { grid-column: 2; }
  .num { grid-column: 1; grid-row: 1; justify-self: start; position: relative; min-width: 1.75rem; height: 1.75rem; border-radius: 4px;
    color: var(--accent); font-size: 1.15rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.75rem; text-align: left; text-decoration: none; }
  .num:hover { text-decoration: underline; }
  article.here .num { text-decoration: underline; text-decoration-color: var(--marker); text-decoration-thickness: 3px; text-underline-offset: 4px; }
  .num[data-note]::after { content: attr(data-note); position: absolute; left: 0; top: 100%; z-index: 1; padding: .1rem .4rem; border-radius: 4px;
    background: var(--ink); color: var(--bg); font-size: .75rem; font-weight: 400; line-height: 1.5; white-space: nowrap; }
  h3 { grid-row: 1; margin: 0 0 .5rem; font-size: 1.15rem; font-weight: 600; line-height: 1.5; }
  article p { margin: 0; }
  article ul { margin: 0; padding-left: 1.1rem; }
  li + li { margin-top: .5rem; }
  aside { margin-top: .75rem; padding-left: .875rem; border-left: 3px solid var(--accent); color: var(--muted); }
  article a:not(.num), footer a { color: var(--accent); text-underline-offset: 3px; }
  footer { padding-block: 1.5rem 3rem; border-top: 1px solid var(--line); font-size: .875rem; }
  footer p { margin: 0 0 .25rem; color: var(--muted); }
  footer ul { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; margin: 0; padding: 0; list-style: none; }
  footer li + li { margin: 0; }
  .who { margin: 0 0 3.5rem 2.5rem; }
  .who h3 { margin-bottom: .75rem; }
  .who fieldset { display: none; flex-wrap: wrap; gap: .5rem; margin: 0 0 1rem; padding: 0; border: 0; }
  .js .who fieldset { display: flex; }
  .who label { position: relative; cursor: pointer; padding: .35rem .75rem; border: 1px solid var(--line); border-radius: 4px; }
  .who label:hover { border-color: var(--accent); }
  .who input { position: absolute; opacity: 0; pointer-events: none; }
  .who label:has(input:checked) { background: #821b33; border-color: #821b33; color: #fff; }
  .who label:has(input:focus-visible) { outline: 2px solid var(--marker); outline-offset: 2px; }
  .post { padding: .25rem 0 .25rem .875rem; border-left: 3px solid var(--accent); }
  .post p { margin: 0; }
  .post b { font-weight: 600; }
  .post small { color: var(--muted); font-size: .875rem; }
  .sent { display: none; align-items: center; gap: .5rem; margin-top: .75rem !important; font-size: .875rem; }
  .js .sent { display: flex; }
  .sent span { padding: 0 .4rem; border-radius: 4px; background: var(--ink); color: var(--bg); }
  .sent.seen span { background: var(--marker); color: #241a1d; font-weight: 600; }
  .answers { margin: 1rem 0 0 !important; padding: 0 !important; list-style: none; }
  .js .answers b { display: none; }
  mark { background: var(--marker); color: #241a1d; }
  .empty { color: var(--muted); }

  @media (max-width: 40rem) {
    header { padding-top: 1.5rem; padding-bottom: 1rem; }
    header p { margin-top: .4rem; }
    .sense { font-size: 1rem; }
    .bar .wrap { gap: .75rem; font-size: .875rem; }
    .tabs { gap: .75rem; }
    .long { display: none; }
    article { grid-template-columns: 2rem minmax(0, 1fr); }
    .who { margin-left: 0; }
    .who fieldset { gap: .25rem; font-size: .875rem; }
    .who label { padding: .3rem .5rem; }
  }
  @media print { .bar, .toc { display: none !important; } .doc, aside, .answers li { display: block !important; } .who fieldset, .sent { display: none !important; } .answers b { display: inline !important; } article { display: grid !important; } main { display: block; } }
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
    });
    // The examples switch only shows on a document that has examples.
    examples.parentElement.hidden = !$('#' + id + ' aside');
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
    var active = shown.filter(function (a) { return a.getBoundingClientRect().top < 120; }).pop() || shown[0];
    if (max > 0 && root.scrollTop >= max - 2) active = shown[shown.length - 1];
    if (picked && shown.indexOf(picked) !== -1) active = picked;
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

  var viewers = $$('.who input'), answers = $$('.answers li'), sent = $('.sent');
  function view() {
    viewers.forEach(function (v, i) {
      if (!v.checked) return;
      answers.forEach(function (a, j) { a.hidden = i !== j; });
      var seen = v.dataset.sender === 'true';
      sent.classList.toggle('seen', seen);
      $('span', sent).textContent = seen ? 'Your Discord account' : 'Hidden';
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
  function label() { theme.textContent = isDark() ? 'Light' : 'Dark'; }
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
  // The browser jumps to "#terms" by itself once loaded: go back up so the title stays in view.
  addEventListener('load', function () {
    if (location.hash.indexOf('-') === -1) setTimeout(function () { window.scrollTo(0, 0); }, 0);
  });
})();
`;

// Runs before the page paints, so a saved theme does not flash and the contents list only shows with JavaScript.
const BOOT = `document.documentElement.className='js';try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

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

const whoSeesWhat = ({ heading, post, viewers }) => `<div class="who">
<h3>${escapeHtml(heading)}</h3>
<fieldset><legend class="sr">Viewer</legend>${viewers
  .map((v) => `<label><input type="radio" name="viewer" data-sender="${v.sender}"> ${escapeHtml(v.name)}</label>`)
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
  const names = docs.map((d) => d.name).join(' and ');
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
<div class="bar"><div class="wrap">
  <div class="tabs" role="tablist" aria-label="Document">
    ${docs.map((d) => `<button type="button" role="tab" data-doc="${d.id}" aria-controls="${d.id}" aria-label="${d.name}">${tabName(d.name)}</button>`).join('')}
  </div>
  <input type="search" id="search" placeholder="Search" aria-label="Search this document">
  <label class="toggle"><input type="checkbox" id="examples" checked> Examples</label>
  <button type="button" id="theme" title="Switch color theme">Dark</button>
</div></div>
<main class="wrap">
  <nav class="toc" aria-label="Contents">
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
<footer class="wrap">
  <p>Discord’s own policies</p>
  <ul>${related.map(([label, url]) => `<li>${external(escapeHtml(label), url)}</li>`).join('')}</ul>
</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
