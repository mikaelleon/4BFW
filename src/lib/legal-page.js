// Markup, style and browser script of the web page. Self-contained: no external fonts, scripts or trackers.
// It reads like a dictionary entry for STFW, with the sections as numbered senses.
// Each document is a tab with its own address ("/" for the first, "/<id>" for the rest, "#<id>-<n>" for a section).
// Without JavaScript the documents simply show one after the other.

import { readFileSync } from 'node:fs';

// The official logos, inlined so the page stays a single file: maroon "st" for light, white "st" for dark.
const logo = (name) => `data:image/png;base64,${readFileSync(new URL(`../assets/${name}`, import.meta.url)).toString('base64')}`;
const LOGO_LIGHT = logo('logo-light.png');
const LOGO_DARK = logo('logo-dark.png');
const LOGO_HEIGHT = 292;

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STYLE = String.raw`
  /* One radius family, always nested: outer 20 = inner 12 + padding 8. Controls sit straight on their card: no tracks. */
  :root {
    color-scheme: light;
    --bg: #f5f0f2; --card: #fff; --inner: #f5f0f2; --ink: #241a1d; --muted: #685359; --accent: #821b33; --fill: #821b33;
    --marker: #f0a03c; --on-marker: #4a2605; --ring: rgb(80 20 35 / .09); --track: #d9cdd1; --on: 0;
    --lift: 0 0 0 1px var(--ring), 0 2px 4px rgb(80 20 35 / .05), 0 12px 24px -16px rgb(80 20 35 / .16);
    --knob: 0 0 0 1px rgb(0 0 0 / .06), 0 1px 2px rgb(0 0 0 / .16), 0 2px 6px rgb(0 0 0 / .12);
    --r1: 20px; --r2: 12px; --r3: 8px;
    /* Motion: press and hover, switch knob and chevron, list open and close, note in and out, icon swap. */
    --t-press: 150ms; --t-move: 200ms; --t-open: 250ms; --t-close: 190ms; --t-note-in: 125ms; --t-note-out: 90ms; --t-swap: 300ms;
    --ease-out: cubic-bezier(.32, .72, 0, 1); --ease-in: cubic-bezier(.55, 0, 1, .45); --ease-in-out: cubic-bezier(.77, 0, .175, 1);
    --ease-swap: cubic-bezier(.25, .1, 0, 1);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg: #140f11; --card: #211a1d; --inner: #2d2327; --ink: #f2ebed; --muted: #bcaab0; --accent: oklch(.75 .105 13); --fill: oklch(.47 .105 13); --marker: oklch(.768 .11 68);
      --ring: rgb(255 255 255 / .08); --track: #4a3a40; --on: 1; --lift: 0 0 0 1px var(--ring), 0 2px 4px rgb(0 0 0 / .16), 0 12px 24px -16px rgb(0 0 0 / .16);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #140f11; --card: #211a1d; --inner: #2d2327; --ink: #f2ebed; --muted: #bcaab0; --accent: oklch(.75 .105 13); --fill: oklch(.47 .105 13); --marker: oklch(.768 .11 68);
    --ring: rgb(255 255 255 / .08); --track: #4a3a40; --on: 1; --lift: 0 0 0 1px var(--ring), 0 2px 4px rgb(0 0 0 / .16), 0 12px 24px -16px rgb(0 0 0 / .16);
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased; }
  [hidden] { display: none !important; }
  .wrap { max-width: 64rem; margin: 0 auto; padding-inline: 1rem; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .sr, .js h2 { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  button, input { font: inherit; color: inherit; }
  button, input, .toggle, .toc a, .toc summary, .action, footer a { line-height: 1.4; }
  button { cursor: pointer; background: none; border: 0; padding: 0; white-space: nowrap; }
  h3 { text-wrap: balance; }
  p, li { text-wrap: pretty; }

  header { padding-top: 2rem; padding-bottom: 1.5rem; }
  /* The two official logos sit on top of each other and the theme picks one, so nothing flashes or moves. */
  h1 { display: grid; width: clamp(11rem, 40vw, 16rem); margin: 0 0 1.25rem; }
  h1 a { display: grid; border-radius: var(--r3); }
  h1 img { grid-area: 1 / 1; width: 100%; height: auto; }
  .logo-light { opacity: calc(1 - var(--on)); }
  .logo-dark { opacity: var(--on); }
  header p { margin: .75rem 0 0; max-width: 40rem; }
  .say { color: var(--muted); }
  .sense { font-size: 1.15rem; line-height: 1.5; }
  .sense b { font-weight: 400; color: var(--accent); }
  header .say + .sense { margin-top: 0; }
  header .updated { margin-top: 14px; color: var(--muted); font-size: .875rem; }

  .card, article { background: var(--card); border-radius: var(--r1); padding: 8px; box-shadow: var(--lift); }

  /* Toolbar */
  .bar { position: sticky; top: 0; z-index: 5; padding-block: 8px; background: var(--bg); }
  .tools { display: grid; grid-template: "tabs search examples theme" / auto minmax(0, 1fr) auto auto; gap: 8px; }
  .tabs, .who fieldset { position: relative; grid-auto-flow: column; grid-auto-columns: 1fr; margin: 0; padding: 0; border: 0;
    isolation: isolate; }
  .tabs { grid-area: tabs; display: grid; }
  /* The sliding pill under the picked segment. --i is the picked index. It is tinted, so the filled button stays the one standout. */
  .tabs::before, .who fieldset::before { content: ""; position: absolute; z-index: -1; top: 0; bottom: 0; left: 0;
    width: calc(100% / var(--n)); border-radius: var(--r2); background: color-mix(in srgb, var(--accent) 14%, var(--card));
    transform: translateX(calc(var(--i, 0) * 100%)); }
  .tabs button { position: relative; height: 44px; padding-inline: 1.375rem; border-radius: var(--r2); color: var(--muted); }
  .tabs button[aria-selected="true"] { color: var(--accent); }
  input[type="search"] { grid-area: search; width: 100%; min-width: 0; height: 44px; padding: 0 22px 0 44px; border: 0; border-radius: var(--r2);
    background: var(--inner) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a7479' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E") 16px center / 18px no-repeat; }
  input::placeholder { color: var(--muted); }
  .toggle { grid-area: examples; display: flex; align-items: center; justify-content: space-between; gap: .75rem; height: 44px;
    padding-inline: 8px; border-radius: var(--r2); cursor: pointer; user-select: none; white-space: nowrap; }
  .toggle input { appearance: none; position: relative; flex: none; width: 40px; height: 24px; margin: 0; border-radius: 12px;
    background: var(--track); cursor: inherit; }
  .toggle input::after { content: ""; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border-radius: 50%; background: #fff;
    box-shadow: var(--knob); }
  .toggle input:checked { background: var(--fill); }
  .toggle input:checked::after { transform: translateX(16px); }
  /* Theme button: the theme tokens pick the icon (moon in light, sun in dark), so it is right before any script runs. */
  #theme { grid-area: theme; display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--r2); color: var(--muted); }
  #theme svg { grid-area: 1 / 1; width: 20px; height: 20px; }
  #theme .sun { opacity: var(--on); scale: calc(.3 + .7 * var(--on)); filter: blur(calc((1 - var(--on)) * 3px)); }
  #theme .moon { opacity: calc(1 - var(--on)); scale: calc(1 - .7 * var(--on)); filter: blur(calc(var(--on) * 3px)); }
  /* Lucide icons. */
  .icon { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round;
    stroke-linejoin: round; pointer-events: none; }

  main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-top: 8px; padding-bottom: 16px; }
  nav.toc { display: none; }
  .js nav.toc { display: block; }
  /* On narrow screens the contents list is one row that opens in place. */
  .toc summary { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding-inline: 1.375rem;
    border-radius: var(--r2); cursor: pointer; list-style: none; }
  .toc summary::-webkit-details-marker { display: none; }
  .toc summary .icon { color: var(--accent); }
  .toc.shown summary .icon { rotate: 180deg; }
  .expander { display: grid; grid-template-rows: 0fr; }
  .toc.shown .expander { grid-template-rows: 1fr; }
  .expander > div { min-height: 0; overflow: hidden; }
  .toc a:focus-visible { outline-offset: -2px; }
  @media (min-width: 56rem) {
    .js main { grid-template-columns: 17rem minmax(0, 1fr); align-items: start; }
    .js nav.toc { position: sticky; top: 76px; max-height: calc(100vh - 84px); overflow: auto; }
    .toc summary { display: none; }
    .expander { grid-template-rows: 1fr; }
    .expander > div { overflow: visible; }
  }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc a { display: block; padding: .65rem 1.3rem; border-radius: var(--r2); color: var(--muted); text-decoration: none; font-size: .875rem; line-height: 1.4; }
  .toc a[aria-current="true"] { background: var(--inner); color: var(--accent); }
  li + li { margin-top: .5rem; }
  .toc li + li { margin-top: 2px; }

  h2 { margin: 48px 0 8px; font-size: 1.5rem; font-weight: 600; line-height: 1.2; }
  .doc + .doc { margin-top: 4rem; }
  .js .doc + .doc { margin-top: 0; }
  article { display: grid; grid-template-columns: 40px minmax(0, 1fr); column-gap: 4px; margin-bottom: 16px; scroll-margin-top: 80px; }
  article.here { box-shadow: 0 0 0 2px var(--accent); }
  article:focus { outline: none; }
  .keys article:focus { outline: 2px solid var(--ink); outline-offset: 2px; }
  article > * { grid-column: 2; }
  .num { grid-column: 1; grid-row: 1; position: relative; display: grid; place-items: center; width: 40px; height: 40px;
    border-radius: var(--r2); background: var(--inner); color: var(--accent); font-weight: 600; font-variant-numeric: tabular-nums; text-decoration: none; }
  article.here .num { background: var(--fill); color: #fff; }
  .num::before { content: ""; position: absolute; inset: -2px; }
  .num::after { content: attr(data-note); position: absolute; left: 0; top: calc(100% + 4px); z-index: 1; padding: .25rem .5rem;
    border-radius: var(--r3); background: var(--ink); color: var(--bg); font-size: .75rem; font-weight: 400; line-height: 1.5;
    white-space: nowrap; opacity: 0; scale: .97; transform-origin: top left; pointer-events: none; }
  .num[data-show]::after { opacity: 1; scale: 1; }
  h3 { grid-row: 1; align-self: center; margin: 0; padding: .25rem .75rem; font-size: 1.15rem; font-weight: 600; line-height: 1.25; }
  article p { margin: 0; padding: .25rem .75rem .75rem; max-width: 40rem; }
  article ul { margin: 0; padding: .25rem .75rem .75rem 1.9rem; max-width: 42rem; }
  article aside { grid-column: 1 / -1; padding: .75rem 1rem .75rem 3.5rem; border-radius: var(--r2); background: var(--inner); color: var(--muted); }
  article a:not(.num) { color: var(--accent); text-underline-offset: 3px; }
  /* A taller target for links inside text, without moving the lines. */
  article p a, article li a { padding-block: .65rem; }
  .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 24px; }
  .js:not([data-page="home"]) .cta { display: none; }
  .action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 48px; padding-inline: 24px;
    border-radius: var(--r2); background: var(--card); box-shadow: var(--lift); color: var(--accent); font-weight: 600;
    text-decoration: none; }
  .action:first-child { background: var(--fill); color: #fff; }
  code { padding: .1rem .35rem; border-radius: var(--r3); background: var(--inner); font-size: .875em; overflow-wrap: anywhere; }
  .ui, strong { font-weight: 600; }
  .ui { white-space: nowrap; }
  .hint { display: none; margin: 0 0 8px; padding-inline: .75rem; color: var(--muted); font-size: .875rem; }
  .js .hint { display: block; }

  .js[data-page="home"] nav.toc { display: none; }
  .js[data-page="home"] main { grid-template-columns: minmax(0, 1fr); }
  .sample { display: none; }
  .js:not([data-page="home"]) .sample { display: none; }
  .js[data-page="home"] .sample { display: block; }
  .sample.post { margin: 16px 0 0; padding: 1rem 1.25rem; background: var(--card); box-shadow: var(--lift); }
  .by { display: flex; align-items: center; gap: .5rem; margin-top: .75rem !important; font-size: .875rem; }
  .by span { padding: .1rem .5rem; border-radius: var(--r3); background: var(--ink); color: var(--bg); user-select: none; }
  @media (min-width: 56rem) {
    .js[data-page="home"] header { display: grid; grid-template-columns: minmax(0, 1fr) 22rem; align-items: center; gap: 48px; }
    .sample.post { margin: 0; }
    #home { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 16px; }
    #home article { align-content: start; }
    #home article p { grid-column: 1 / -1; }
    #home article:nth-of-type(4), #home .elsewhere { grid-column: 1 / -1; }
  }

  .who { margin-bottom: 16px; }
  .who h3 { padding: .5rem .75rem .75rem; }
  .who fieldset { display: none; --n: 2; }
  .js .who fieldset { display: grid; }
  .who label { position: relative; display: grid; place-items: center; min-height: 44px; padding: 0 .25rem; border-radius: var(--r2);
    color: var(--muted); cursor: pointer; font-size: .875rem; line-height: 1.2; text-align: center; }
  .who input { position: absolute; opacity: 0; pointer-events: none; }
  .who label:has(input:checked) { color: var(--accent); }
  .who label:has(input:focus-visible) { outline: 2px solid var(--ink); outline-offset: 2px; }
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
  mark { background: var(--marker); color: var(--on-marker); }
  .empty { padding-inline: .75rem; color: var(--muted); }
  .searching .hint, .nothing nav.toc { display: none !important; }
  .elsewhere { display: flex; flex-wrap: wrap; gap: 8px; }
  .elsewhere button { min-height: 44px; padding-inline: 22px; border-radius: var(--r2); background: var(--card); box-shadow: var(--lift);
    color: var(--accent); }
  /* Past the home page the definition steps aside, so the document starts higher. */
  .js:not([data-page="home"]) header .say, .js:not([data-page="home"]) header .sense { display: none; }
  .js:not([data-page="home"]) header { padding-top: 1.5rem; padding-bottom: .5rem; }
  .js:not([data-page="home"]) h1 { width: 8rem; margin-bottom: 0; }

  /* Live status on the home page: two cards in neutral colors, so the invite button stays the one standout. */
  .live { display: none; gap: 16px; margin-bottom: 16px; }
  .js .live { display: grid; grid-column: 1 / -1; }
  @media (min-width: 56rem) { .js .live { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; } }
  .live .card { padding: 20px; min-width: 0; }
  .live h3 { padding: 0; }
  .live p { margin: .5rem 0 0; }
  .state { display: flex; align-items: center; gap: .5rem; font-weight: 600; }
  .state::before { content: ""; width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--muted); }
  .state[data-state="online"]::before { background: var(--ink); box-shadow: none; }
  .live small { display: block; color: var(--muted); font-size: .875rem; }
  .days { display: grid; grid-template-columns: repeat(30, minmax(0, 1fr)); gap: 2px; height: 40px; margin-top: 16px; }
  .days span { display: flex; align-items: flex-end; border-radius: 2px; background: var(--inner); }
  .days span[data-empty] { background: none; box-shadow: inset 0 0 0 1px var(--track); }
  .days i { width: 100%; border-radius: 2px; background: var(--muted); }
  .ends { display: flex; justify-content: space-between; margin-top: .25rem; color: var(--muted); font-size: .75rem; }
  /* The updates are a timeline: one line through every dot, a filled dot for the newest. --dot is the dot's center. */
  .timeline { --dot: 19px; margin-top: .5rem; }
  .timeline ol { margin: 0; padding: 0; list-style: none; }
  .timeline li { position: relative; margin: 0; padding-left: 28px; }
  .timeline li::before { content: ""; position: absolute; z-index: 1; left: 1px; top: calc(var(--dot) - 6px); width: 12px; height: 12px;
    border-radius: 50%; background: var(--card); box-shadow: inset 0 0 0 2px var(--muted); }
  .timeline > ol:first-child > li:first-child::before { background: var(--ink); box-shadow: none; }
  .timeline li::after, .timeline summary::before { content: ""; position: absolute; left: 6px; top: 0; bottom: 0; width: 2px;
    background: var(--track); }
  .timeline > ol:first-child > li:first-child::after { top: var(--dot); }
  /* The line ends at the oldest dot shown. A closed "more" row keeps half a line, to say the history goes on. */
  .timeline details li:last-child::after, .timeline:has(details[hidden]) > ol > li:last-child::after { bottom: auto; height: var(--dot); }
  .timeline details[hidden] li::after { display: none; }
  .timeline details:not([open]) summary::before { bottom: 50%; }
  .timeline li a { display: block; padding-block: .5rem; color: var(--ink); text-decoration: none; overflow-wrap: anywhere; }
  .timeline li a span { display: block; }
  .timeline li a:hover span { text-decoration: underline; text-underline-offset: 3px; }
  .timeline summary { position: relative; padding-left: 28px; }
  .live summary { display: flex; align-items: center; min-height: 44px; cursor: pointer; color: var(--accent); }
  .live .all { display: inline-flex; align-items: center; gap: .5rem; min-height: 44px; color: var(--accent); text-underline-offset: 3px; }

  /* Icons beside headings and in controls. */
  .icon.lead { width: 20px; height: 20px; color: var(--accent); }
  .live h3 { display: flex; align-items: center; align-self: stretch; gap: .5rem; }
  .updates { display: flex; flex-direction: column; }
  .updates .all { margin-top: auto; align-self: flex-start; }
  span.num .icon { width: 20px; height: 20px; }
  span.num { pointer-events: none; }
  span.num::before, span.num::after { content: none; }
  /* Home cards line their action up along the bottom. */
  #home article { grid-template-rows: auto 1fr auto; }
  .do { grid-column: 1 / -1; justify-self: start; display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
    min-width: 10rem; min-height: 44px; margin: 0 0 4px 4px; padding-inline: 16px; border-radius: var(--r2); background: var(--inner);
    color: var(--accent); font-size: .875rem; line-height: 1.4; }
  .swap { display: grid; }
  .swap .icon { grid-area: 1 / 1; }
  .swap .done { opacity: 0; scale: .3; }
  .do[data-done] .swap .done { opacity: 1; scale: 1; }
  .do[data-done] .swap .idle { opacity: 0; scale: .3; }
  .column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .try { display: flex; flex: 1; flex-direction: column; }
  .try > label[for] { margin-top: .75rem; font-size: .875rem; color: var(--muted); }
  .try textarea { width: 100%; min-height: 5.5rem; margin-top: .25rem; padding: .75rem; border: 0; border-radius: var(--r2);
    background: var(--bg); box-shadow: 0 0 0 1px var(--ring); color: var(--ink); font: inherit; resize: vertical; }
  .try textarea::placeholder { color: var(--muted); }
  .try .toggle { justify-content: flex-start; align-self: flex-start; padding: 0; font-size: .875rem; }
  .try .post { flex: 1; margin: 0; }
  .try .post .words { min-height: 3rem; margin-top: .25rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  .try .post .words[data-empty] { color: var(--muted); }
  .try .post.veiled .words { filter: blur(6px); user-select: none; }
  .reveal { min-height: 44px; color: var(--accent); font-size: .875rem; }
  .try small { margin-top: .75rem; }
  .again { display: inline-flex; align-items: center; gap: .5rem; min-height: 44px; margin-top: .5rem; color: var(--accent); }
  .days { cursor: crosshair; touch-action: pan-y; border-radius: var(--r3); }
  .days span.on { box-shadow: 0 0 0 2px var(--ink); }
  .readout { min-height: 1.5rem; font-size: .875rem; font-variant-numeric: tabular-nums; }
  .live summary { gap: .5rem; list-style: none; }
  .live summary::-webkit-details-marker { display: none; }
  .live details[open] summary .icon { rotate: 180deg; }

  footer { padding-bottom: 3rem; }
  footer p { margin: 0; padding: .25rem .75rem .75rem; color: var(--muted); font-size: .875rem; }
  footer ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  footer li + li { margin: 0; }
  footer a { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding-inline: 22px; border-radius: var(--r2);
    background: var(--inner); color: var(--accent); text-decoration: none; }

  /* Motion and feedback. Transitions start after the first paint, and are off for keyboard use: tabs and keys answer on the
     next frame. Colors never fade across a theme swap. */
  .ready:not(.keys) :is(.tabs button, .num, #theme, .who label, footer a, .toc a, .toc summary, .action, .elsewhere button, .toggle) {
    transition: scale var(--t-press) var(--ease-out), background-color var(--t-press) ease, filter var(--t-press) ease,
      box-shadow var(--t-press) ease; }
  .ready.swapping :is(.tabs button, .num, #theme, .who label, footer a, .toc a, .toc summary, .action, .elsewhere button, .toggle) {
    transition: none; }
  .ready:not(.keys) .toggle input::after { transition: transform var(--t-move) var(--ease-in-out); }
  .ready:not(.keys) #theme svg { transition: opacity var(--t-swap) var(--ease-swap), scale var(--t-swap) var(--ease-swap),
    filter var(--t-swap) var(--ease-swap); }
  .ready:not(.keys) .expander { transition: grid-template-rows var(--t-close) var(--ease-in-out); }
  .ready:not(.keys) .toc.shown .expander { transition-duration: var(--t-open); }
  .ready:not(.keys) .toc summary .icon { transition: rotate var(--t-move) var(--ease-in-out); }
  .ready:not(.keys) :is(.do, .again, .reveal) { transition: scale var(--t-press) var(--ease-out), background-color var(--t-press) ease; }
  .ready:not(.keys) .swap .icon { transition: opacity var(--t-press) var(--ease-out), scale var(--t-press) var(--ease-out); }
  .ready:not(.keys) .live summary .icon { transition: rotate var(--t-move) var(--ease-in-out); }
  .ready:not(.keys) .try .post .words { transition: filter var(--t-move) ease; }
  :is(.do, .again):active { scale: .96; }
  @media (hover: hover) and (pointer: fine) { :is(.do, .again, .reveal):hover { box-shadow: inset 0 0 0 1px var(--accent); } }
  .ready:not(.keys) .num::after { transition: opacity var(--t-note-out) var(--ease-in), scale var(--t-note-out) var(--ease-in); }
  .ready:not(.keys) .num[data-show]::after { transition: opacity var(--t-note-in) var(--ease-out), scale var(--t-note-in) var(--ease-out); }
  @media (hover: hover) and (pointer: fine) {
    .tabs button[aria-selected="false"]:hover, .who label:not(:has(input:checked)):hover { color: var(--ink); }
    .toc a:hover { background: var(--inner); color: var(--ink); }
    .toc a[aria-current="true"]:hover { color: var(--accent); }
    .num:hover, footer a:hover, .toc summary:hover, .elsewhere button:hover { box-shadow: inset 0 0 0 1px var(--accent); }
    #theme:hover, .toggle:hover { background: var(--inner); color: var(--ink); }
    .action:first-child:hover { filter: brightness(1.12); }
    .action:not(:first-child):hover { box-shadow: inset 0 0 0 1px var(--accent); }
  }
  /* Press: small controls shrink; wide surfaces and the toolbar change color instead. */
  .num:active { scale: .96; }
  .tabs button:active, #theme:active, .who label:active, footer a:active, .toc a:active, .toc summary:active,
  .action:not(:first-child):active, .elsewhere button:active, .toggle:active, article a:not(.num, .action):active {
    background-color: color-mix(in srgb, var(--accent) 22%, var(--card)); }
  h1 a:active { opacity: .7; }
  .action:first-child:active { filter: brightness(.88); }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }

  @media (max-width: 56rem) {
    .tools { grid-template: "tabs tabs theme" "search examples examples" / minmax(0, 1fr) auto 44px; }
    .tools #theme { justify-self: end; }
    .tools:has(.toggle[hidden]) #search { grid-column: 1 / -1; }
    .tools:has(#search[hidden]) { grid-template: "tabs tabs theme" / minmax(0, 1fr) auto 44px; }
    article { scroll-margin-top: 132px; }
  }
  @media (max-width: 40rem) {
    header { padding-top: 1.5rem; padding-bottom: .5rem; }
    header p { margin-top: .4rem; }
    h1 { width: 8rem; margin-bottom: .5rem; }
    .sense { font-size: 1rem; }
    .action { flex: 1 0 100%; }
    .toggle { gap: .5rem; padding-left: .75rem; font-size: .875rem; }
    .long { display: none; }
    .tabs button { padding-inline: .25rem; font-size: .875rem; }
    article p { grid-column: 1 / -1; }
    article ul { grid-column: 1 / -1; padding-left: 2rem; }
    article aside { padding-left: .75rem; }
    .js .answers { min-height: 6.4rem; }
    .who label { padding: 0; white-space: nowrap; }
    /* Past the home page the logo and date share one row, so the text starts higher. */
    .js:not([data-page="home"]) header { padding-top: .75rem; padding-bottom: .5rem; }
    .js:not([data-page="home"]) header > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
    .js:not([data-page="home"]) h1 { width: 5.5rem; margin: 0; }
    .js:not([data-page="home"]) header .updated { margin: 0; }
    /* One text edge, 20px inside every card. */
    .toc summary, .toc a { padding-inline: .75rem; }
    .toc a { padding-block: .75rem; }
    .hint, .empty { padding-inline: 1.25rem; }
    footer a { padding-inline: .75rem; }
  }
  /* A phone on its side: a pinned toolbar would take a third of the screen. */
  @media (max-height: 30rem) and (max-width: 60rem) {
    .bar { position: static; }
    article { scroll-margin-top: 8px; }
  }
  @media print { .bar, .toc, .hint, .elsewhere { display: none !important; } .doc, aside, .answers li { display: block !important; } .who fieldset, .sent { display: none !important; } .answers b { display: inline !important; } article { display: grid !important; } main { display: block; } .card, article { box-shadow: none; } }
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
  var contents = $('.toc details'), wide = matchMedia('(min-width: 56rem)');
  var live = $('#live'), asked = 0, pickedDay = 29;

  function save(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
  function saved(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  // Keys answer at once; a pointer or finger gets the transitions back.
  addEventListener('keydown', function () { root.classList.add('keys'); }, true);
  addEventListener('pointerdown', function () { root.classList.remove('keys'); }, true);

  // The contents list stays open beside the text, and starts closed above it. There it opens and closes in place, and can be
  // turned around halfway.
  var toc = $('.toc'), summary = $('.toc summary'), list = $('.toc .expander > div'), closing;
  var still = matchMedia('(prefers-reduced-motion: reduce)');
  function fit() {
    clearTimeout(closing);
    toc.classList.remove('shown');
    list.inert = false;
    contents.open = wide.matches;
  }
  function unfold(open) {
    clearTimeout(closing);
    if (open) {
      contents.open = true;
      void list.offsetHeight; // lays the closed list out first, so it has a height to grow from
    }
    toc.classList.toggle('shown', open);
    list.inert = !open;
    if (open) return;
    var wait = still.matches || root.classList.contains('keys') ? 0 : parseFloat(getComputedStyle(root).getPropertyValue('--t-close'));
    closing = setTimeout(function () { contents.open = false; }, wait);
  }
  summary.addEventListener('click', function (e) {
    if (wide.matches) return;
    e.preventDefault();
    unfold(!toc.classList.contains('shown'));
  });
  toc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || wide.matches || !toc.classList.contains('shown')) return;
    unfold(false);
    summary.focus();
  });
  wide.addEventListener('change', fit);
  fit();

  function show(id) {
    current = id;
    document.title = 'STFW · ' + document.getElementById(id).dataset.name;
    docs.forEach(function (d) { d.hidden = d.id !== id; });
    tocs.forEach(function (t) { t.hidden = t.dataset.doc !== id; });
    tabs.forEach(function (t) {
      var on = t.dataset.doc === id;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on) t.parentElement.style.setProperty('--i', tabs.indexOf(t));
    });
    // Each control only shows where it has something to do: the home page is short enough to need no search.
    var doc = document.getElementById(id);
    root.dataset.page = id;
    search.hidden = id === docs[0].id;
    examples.parentElement.hidden = !$('aside', doc);
    $('.updated').hidden = !doc.hasAttribute('data-dated');
    filter();
    refresh();
  }

  function isDoc(id) { return docs.some(function (d) { return d.id === id; }); }

  // "privacy" is "/privacy", "privacy-3" is "/privacy#privacy-3". The first document lives at "/".
  function address(key) {
    var id = key.split('-')[0];
    return (id === docs[0].id ? '/' : '/' + id) + (key === id ? '' : '#' + key);
  }

  // The hash wins over the path, so older links such as "/legal#faq-6" still open the right place.
  // "/legal" on its own opens the Terms, as it did before there was a home page.
  function route() {
    var hash = location.hash.slice(1);
    var path = location.pathname.split('/')[1];
    var id = hash.split('-')[0];
    if (!isDoc(id)) {
      id = path === 'legal' ? 'terms' : isDoc(path) ? path : docs[0].id;
      hash = id;
    }
    var target = document.getElementById(hash);
    var key = target ? hash : id;
    history.replaceState(history.state, '', address(key));
    if (id !== current || key !== id) search.value = '';
    show(id);
    picked = key !== id ? target : null;
    $$('article').forEach(function (a) { a.classList.toggle('here', a === picked); });
    if (picked) picked.scrollIntoView();
    else window.scrollTo(0, 0);
    spy();
  }

  function go(key) {
    history.replaceState({ y: scrollY }, '');
    history.pushState(null, '', address(key));
    route();
  }

  function revisit() {
    var kept = history.state;
    route();
    if (kept && typeof kept.y === 'number') { window.scrollTo(0, kept.y); spy(); }
  }

  function unmark(el) {
    $$('mark', el).forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
    el.normalize();
  }

  // Same length in and out, so match positions still line up with the page's text.
  function plain(s) { return s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"'); }

  function highlight(el, term) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('.num, .sr')) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var at = plain(node.nodeValue).indexOf(term);
      while (at !== -1) {
        var hit = node.splitText(at);
        node = hit.splitText(term.length);
        var mark = document.createElement('mark');
        hit.replaceWith(mark);
        mark.appendChild(hit);
        at = plain(node.nodeValue).indexOf(term);
      }
    });
  }

  function matches(a, term) {
    return plain($$('h3, p, li' + (examples.checked ? ', aside' : ''), a)
      .map(function (n) { return n.textContent; }).join(' '))
      .indexOf(term) !== -1;
  }

  // When this document has no match, offers the ones that do, keeping the search.
  function offer(box, term) {
    function add(text, act) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.addEventListener('click', act);
      box.appendChild(button);
    }
    add('Clear search', function () { search.value = ''; filter(); spy(); search.focus(); });
    docs.slice(1).forEach(function (d) {
      var count = $$('article', d).filter(function (a) { return matches(a, term); }).length;
      if (d.id === current || !count) return;
      add('Show ' + count + (count === 1 ? ' match in ' : ' matches in ') + d.dataset.name, function () {
        var typed = search.value;
        go(d.id);
        search.value = typed;
        filter();
        spy();
        $('[role="tab"][data-doc="' + d.id + '"]').focus();
      });
    });
  }

  function filter() {
    var term = plain(search.value.trim()), found = 0;
    var doc = document.getElementById(current);
    $$('article', doc).forEach(function (a) {
      unmark(a);
      var hit = !term || matches(a, term);
      a.hidden = !hit;
      $('.toc a[href="#' + a.id + '"]').parentElement.hidden = !hit;
      if (hit) found++;
      if (hit && term) highlight(a, term);
    });
    root.classList.toggle('searching', !!term);
    root.classList.toggle('nothing', !found);
    var empty = $('.empty', doc);
    empty.hidden = found > 0;
    if (!found) empty.textContent = 'No section here matches “' + search.value.trim() + '”. Try a shorter word, or clear the search.';
    var elsewhere = $('.elsewhere', doc);
    elsewhere.textContent = '';
    if (!found) offer(elsewhere, term);
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

  // Live status: read when the home page is open, then once a minute while it stays in view.
  function day(date) { return date.toLocaleDateString('en', { month: 'short', day: 'numeric' }); }
  function percent(n) { return (n >= 99.95 ? '100' : n.toFixed(1)) + '%'; }
  function put(name, text) { $('[data-live="' + name + '"]', live).textContent = text; }
  function showBot(bot) {
    $('.again', live).hidden = !!bot;
    var state = !bot ? 'unknown' : bot.online ? 'online' : 'offline';
    var words = { online: 'Online', offline: 'Offline', unknown: 'Status unavailable' }[state];
    $('.state', live).dataset.state = state;
    // Written only on a change, so screen readers are not told the same status every minute.
    if ($('[data-live="state"]', live).textContent !== words) put('state', words);
    var started = bot && bot.online && bot.startedAt ? new Date(bot.startedAt) : null;
    put('since', started ? 'Running since ' + day(started) + ', ' + started.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : '');
    var known = bot ? bot.days.filter(function (d) { return d.percent !== null; }).length : 0;
    put('uptime', !bot ? 'The bot’s status cannot be read right now.' : !known ? 'No uptime history yet'
      : percent(bot.percent) + ' uptime ' + (known === 1 ? 'today' : 'over the last ' + known + ' days'));
    var chart = $('.days', live);
    chart.textContent = '';
    (bot ? bot.days : []).forEach(function (d) {
      var p = d.date.split('-'), cell = document.createElement('span');
      cell.dataset.text = day(new Date(p[0], p[1] - 1, p[2])) + ': ' + (d.percent === null ? 'no data' : percent(d.percent) + ' uptime');
      if (d.percent === null) cell.setAttribute('data-empty', '');
      else {
        var bar = document.createElement('i');
        bar.style.height = d.percent + '%';
        cell.appendChild(bar);
      }
      chart.appendChild(cell);
    });
    if (bot) readDay(pickedDay);
    $('.history', live).hidden = !bot;
  }
  function showUpdates(updates) {
    var have = !!(updates && updates.length);
    put('updates', have ? '' : $$('li', live).length ? 'Could not refresh, so this is the last list loaded.' : 'Updates cannot be loaded right now.');
    $('[data-live="updates"]', live).hidden = have;
    if (!have) return; // keeps a list that loaded earlier
    var lists = $$('ol', live);
    lists.forEach(function (list) { list.textContent = ''; });
    updates.forEach(function (u, i) {
      var item = document.createElement('li'), a = document.createElement('a'), when = document.createElement('small'),
        title = document.createElement('span');
      a.href = u.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      when.textContent = day(new Date(u.date));
      title.textContent = u.title;
      a.append(when, title);
      item.appendChild(a);
      lists[i < 3 ? 0 : 1].appendChild(item);
    });
    var more = $('details', live), rest = updates.length - 3;
    more.hidden = rest <= 0;
    if (!more.dataset.set) { more.open = wide.matches; more.dataset.set = '1'; } // once: the reader's choice wins after that
    $('summary span', more).textContent = 'Show ' + rest + (rest === 1 ? ' more update' : ' more updates');
  }
  function refresh() {
    if (!live || current !== docs[0].id || document.hidden || Date.now() - asked < 55000) return;
    asked = Date.now();
    fetch(live.dataset.url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (s) { showBot(s.bot); showUpdates(s.updates); })
      .catch(function () { showBot(null); showUpdates(null); });
  }
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', refresh);

  // Cards on the home page: copy a command, or jump to the preview.
  $$('.do[data-copy]').forEach(function (b) {
    var label = $('span.text', b), idle = label.textContent, timer;
    b.addEventListener('click', function () {
      var done = function (note, ok) {
        clearTimeout(timer);
        label.textContent = note;
        if (ok) b.dataset.done = '';
        $('#said').textContent = note;
        timer = setTimeout(function () { label.textContent = idle; delete b.dataset.done; }, 1800);
      };
      if (!navigator.clipboard) return done('Copy failed', false);
      navigator.clipboard.writeText(b.dataset.copy).then(function () { done('Copied', true); }, function () { done('Copy failed', false); });
    });
  });
  var draft = $('#draft');
  $$('.do[data-try]').forEach(function (b) {
    b.addEventListener('click', function () {
      draft.scrollIntoView({ block: 'center', behavior: still.matches || root.classList.contains('keys') ? 'auto' : 'smooth' });
      draft.focus({ preventScroll: true });
    });
  });

  // The preview: what is typed shows as a post. It stays in this tab.
  if (draft) {
    var warn = $('#warn'), shown = false, words = $('.try .words'), reveal = $('.reveal'), blank = words.textContent;
    var preview = function () {
      var typed = draft.value.trim(), veiled = warn.checked && !shown && !!typed;
      words.textContent = typed ? draft.value : blank;
      words.toggleAttribute('data-empty', !typed);
      words.setAttribute('aria-hidden', veiled);
      words.parentElement.classList.toggle('veiled', veiled);
      $('.try .warning').hidden = !warn.checked;
      reveal.hidden = !warn.checked || !typed;
      reveal.textContent = shown ? 'Hide text' : 'Show hidden text';
    };
    draft.addEventListener('input', preview);
    warn.addEventListener('change', function () { shown = false; preview(); });
    reveal.addEventListener('click', function () { shown = !shown; preview(); });
    preview();
  }

  // Uptime chart: point at a day, or use the arrow keys, to read it.
  function readDay(i) {
    var cells = $$('.days span', live);
    if (!cells.length) return;
    pickedDay = Math.max(0, Math.min(cells.length - 1, i));
    cells.forEach(function (c, j) { c.classList.toggle('on', j === pickedDay); });
    var text = cells[pickedDay].dataset.text;
    put('day', text);
    var chart = $('.days', live);
    chart.setAttribute('aria-valuenow', pickedDay + 1);
    chart.setAttribute('aria-valuetext', text);
  }
  if (live) {
    var chart = $('.days', live);
    var point = function (e) {
      var box = chart.getBoundingClientRect();
      readDay(Math.floor((e.clientX - box.left) / box.width * 30));
    };
    chart.addEventListener('pointerdown', point);
    chart.addEventListener('pointermove', point);
    chart.addEventListener('keydown', function (e) {
      var to = { ArrowLeft: pickedDay - 1, ArrowRight: pickedDay + 1, Home: 0, End: 29 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      readDay(to);
    });
    $('.again', live).addEventListener('click', function () {
      put('state', 'Checking…');
      asked = 0;
      refresh();
    });
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { go(tab.dataset.doc); });
    tab.addEventListener('keydown', function (e) {
      var to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      var next = tabs[(to + tabs.length) % tabs.length];
      next.focus();
      go(next.dataset.doc);
    });
  });

  $$('.toc a').forEach(function (l) {
    l.addEventListener('click', function (e) {
      e.preventDefault();
      if (!wide.matches) fit();
      go(l.hash.slice(1));
      var section = document.getElementById(l.hash.slice(1));
      section.tabIndex = -1;
      section.focus({ preventScroll: true });
    });
  });

  // The hint about section numbers stays until one is used.
  function dropHints() { $$('.hint').forEach(function (h) { h.remove(); }); }
  if (saved('copied')) dropHints();

  // Links between documents switch tabs without loading the page again. Ctrl or Shift clicks keep their usual meaning.
  $$('a[data-page]').forEach(function (l) {
    l.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(l.dataset.page);
      if (!l.getClientRects().length) $('[role="tab"][aria-selected="true"]').focus({ preventScroll: true });
    });
  });

  // Clicking a section number copies a link to that section.
  $$('a.num').forEach(function (n) {
    n.addEventListener('click', function (e) {
      e.preventDefault();
      history.replaceState(null, '', n.hash);
      save('copied', '1');
      dropHints();
      picked = n.parentElement;
      $$('article').forEach(function (a) { a.classList.toggle('here', a === picked); });
      spy();
      var done = function (note) {
        clearTimeout(n.timer);
        n.dataset.note = note;
        void n.offsetWidth;
        n.dataset.show = '';
        $('#said').textContent = note;
        n.timer = setTimeout(function () { delete n.dataset.show; }, 1800);
      };
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

  function showExamples() { $$('aside').forEach(function (a) { a.hidden = !examples.checked; }); }
  examples.addEventListener('change', function () {
    save('examples', examples.checked ? '1' : '');
    showExamples();
    filter();
    spy();
  });

  function isDark() {
    return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function label() {
    theme.setAttribute('aria-checked', isDark());
    $('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }
  function swap() {
    root.classList.add('swapping');
    setTimeout(function () { root.classList.remove('swapping'); }, 50);
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { swap(); label(); });
  theme.addEventListener('click', function () {
    swap();
    root.dataset.theme = isDark() ? 'light' : 'dark';
    save('theme', root.dataset.theme);
    label();
  });

  search.addEventListener('input', function () { filter(); spy(); });
  search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') search.blur();
    if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; filter(); spy(); }
  });
  addEventListener('scroll', spy, { passive: true });
  // Once the reader scrolls by hand, the contents list follows the scroll position again.
  ['wheel', 'touchmove', 'keydown', 'mousedown'].forEach(function (type) {
    addEventListener(type, function (e) {
      if (!e.target.closest || !e.target.closest('.toc, .num')) picked = null;
    }, { passive: true });
  });
  addEventListener('resize', spy);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  addEventListener('hashchange', revisit);
  addEventListener('popstate', revisit);
  // iOS only shows :active styles on pages that listen for touches.
  document.addEventListener('touchstart', function () {}, { passive: true });
  examples.checked = !!saved('examples');
  showExamples();
  label();
  route();
  spy();
  setTimeout(function () { root.classList.add('ready'); }, 50);
  // The browser scrolls by itself once loaded. Put a linked section back under the toolbar, and anything else at the top so
  // the title stays in view.
  addEventListener('load', function () {
    setTimeout(function () {
      if (picked) picked.scrollIntoView();
      else window.scrollTo(0, 0);
      spy();
    }, 0);
  });
})();
`;

// Runs before the page paints, so neither a saved theme nor the wrong tab's layout flashes. Without it nothing is hidden.
const boot = (ids) =>
  `(function(){var d=document.documentElement,k=${JSON.stringify(ids)},p=location.pathname.split('/')[1],h=location.hash.slice(1).split('-')[0];` +
  `d.className='js';d.dataset.page=k.indexOf(h)>-1?h:p==='legal'?'terms':k.indexOf(p)>-1?p:k[0];` +
  `try{var t=localStorage.getItem('theme');if(t)d.dataset.theme=t}catch(e){}})()`;

// Icons from Lucide (lucide.dev, ISC licence), inlined so the page stays a single file.
const icon = (name, shapes) => `<svg class="icon ${name}" viewBox="0 0 24 24" aria-hidden="true">${shapes}</svg>`;
const SUN = icon('sun', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2M20 12h2m-13.66 5.66-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
const MOON = icon('moon', '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>');
const CHEVRON = icon('chevron-down', '<path d="m6 9 6 6 6-6"/>');
const LUCIDE = {
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  pointer: '<path d="M14 4.1 12 6M5.1 8l-2.9-.8M6 12l-1.9 2M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};
const lucide = (name, extra = name) => icon(extra, LUCIDE[name]);
const EXTERNAL = icon('external-link', '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const ARROW = icon('arrow-up-right', '<path d="M7 7h10v10M7 17 17 7"/>');

const classed = (name) => (name ? ` class="${name}"` : '');
const external = (label, url, name) => `<a${classed(name)} href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

// An address starting with "/" is another document of this page; anything else opens in a new tab.
const link = (label, url, name) =>
  url.startsWith('/')
    ? `<a${classed(name)} href="${escapeHtml(url)}" data-page="${escapeHtml(url.slice(1))}">${label}</a>`
    : external(label, url, name);

const article = (docId, section, n) => {
  const { title, body, points, after, example, links = [], icon: mark, copy, tryIt } = section;
  const marked = (s) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b class="ui">$1</b>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  const text = (s) => links.reduce((out, [phrase, url]) => out.replace(escapeHtml(phrase), () => link(escapeHtml(phrase), url)), marked(s));
  return [
    `<article id="${docId}-${n}">`,
    mark ? `<span class="num">${lucide(mark)}</span>` : `<a class="num" href="#${docId}-${n}" title="Copy link to this section">${n}</a>`,
    `<h3>${escapeHtml(title)}</h3>`,
    ...[body ?? []].flat().map((p) => `<p>${text(p)}</p>`),
    points ? `<ul>${points.map((p) => `<li>${text(p)}</li>`).join('')}</ul>` : '',
    ...(after ?? []).map((p) => `<p>${text(p)}</p>`),
    example ? `<aside><span class="sr">Example: </span>${escapeHtml(example)}</aside>` : '',
    copy ? `<button type="button" class="do" data-copy="${escapeHtml(copy)}"><span class="swap">${lucide('copy', 'idle')}${lucide('check', 'done')}</span><span class="text">Copy ${escapeHtml(copy.trim())}</span></button>` : '',
    tryIt ? `<button type="button" class="do" data-try>${lucide('pen')}${escapeHtml(tryIt)}</button>` : '',
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

const samplePost = ({ title, text }) => `<figure class="post sample">
<p><b>${escapeHtml(title)}</b> <small>Sample post</small></p>
<p>${escapeHtml(text)}</p>
<p class="by">Sent by <span>Hidden</span></p>
</figure>`;

const liveStatus = ({ url, history }) => `<div class="live" id="live" data-url="${escapeHtml(url)}">
<div class="column">
<section class="card">
<h3>${lucide('activity', 'lead')}Bot status</h3>
<p class="state" role="status"><span data-live="state">Checking…</span></p>
<small data-live="since"></small>
<p data-live="uptime"></p>
<div class="history" hidden><div class="days" role="slider" tabindex="0" aria-label="Uptime by day" aria-valuemin="1" aria-valuemax="30"></div><div class="ends" aria-hidden="true"><span>30 days ago</span><span>Today</span></div><p class="readout" data-live="day"></p></div>
<button type="button" class="again" hidden>${lucide('refresh')}Check again</button>
</section>
<section class="card try">
<h3>${lucide('pen', 'lead')}Try a post</h3>
<label for="draft">Your message</label>
<textarea id="draft" rows="3" maxlength="500" placeholder="Type something to see how it looks…"></textarea>
<label class="toggle">Content warning <input type="checkbox" role="switch" id="warn"></label>
<div class="post"><p><b>Anonymous #013</b> <small class="warning" hidden>Content warning</small></p><p class="words">Your words will appear here.</p><button type="button" class="reveal" hidden></button><p class="by">Sent by <span>Hidden</span></p></div>
<small>This preview stays in your browser. Nothing is sent or saved.</small>
</section>
</div>
<section class="card updates">
<h3>${lucide('commit', 'lead')}Latest updates</h3>
<p data-live="updates">Loading…</p>
<div class="timeline">
<ol></ol>
<details hidden><summary><span></span>${CHEVRON}</summary><ol></ol></details>
</div>
<a class="all" href="${escapeHtml(history)}" target="_blank" rel="noopener noreferrer">All updates on GitHub${EXTERNAL}</a>
</section>
</div>`;

// "Terms of Use" -> "Terms<span> of Use</span>", so narrow screens can show the first word only. A document with a
// `short` name (the end of its full name) shows that instead: "<span>General </span>FAQs".
const tabName = ({ name, short }) => {
  if (short) return `<span class="long">${name.slice(0, -short.length)}</span>${short}`;
  const [first, ...rest] = name.split(' ');
  return rest.length ? `${first}<span class="long"> ${rest.join(' ')}</span>` : first;
};

/**
 * Home sections may add `icon` (replaces the number), `copy` (a command to copy) and `tryIt` (a button to the preview).
 * The whole page. `docs` is [{ id, name, short?, who?, dated?, sections: [{ title, body? (text, or a list of paragraphs), points?, after? (paragraphs under the points), example?, links? }] }];
 * ids hold no "-". The first document is the home page; `dated` shows the "Last updated" line on that document, and
 * `who.after` is the section number the "Who sees what" card follows. `actions` are the home page's buttons, as [label, url], and
 * `sample` is the { title, text } of the post shown there. `live` is { url, history }: where the home page reads its status
 * and updates, and the page listing every update.
 */
export function renderLegalPage({ updated, docs, actions = [], sample, related = [], live }) {
  const names = new Intl.ListFormat('en').format(docs.map((d) => d.name));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f5f0f2">
<title>STFW · Server Thoughts Freedom Wall</title>
<meta name="description" content="${names} of STFW, the Server Thoughts Freedom Wall Discord bot.">
<style>${STYLE}</style>
<script>${boot(docs.map((d) => d.id))}</script>
</head>
<body>
<div class="bar"><div class="wrap"><div class="tools card">
  <div class="tabs" role="tablist" aria-label="Document" style="--n: ${docs.length}">
    ${docs.map((d) => `<button type="button" role="tab" data-doc="${d.id}" aria-controls="${d.id}" aria-label="${d.name}">${tabName(d)}</button>`).join('')}
  </div>
  <input type="search" id="search" placeholder="Search…" enterkeyhint="search" autocomplete="off" aria-label="Search this document">
  <label class="toggle">Examples <input type="checkbox" role="switch" id="examples"></label>
  <button type="button" id="theme" role="switch" aria-checked="false" aria-label="Dark mode" title="Dark mode">
    ${SUN}${MOON}
  </button>
</div></div></div>
<header class="wrap">
  <div>
  <h1><a href="/" data-page="${docs[0].id}" aria-label="STFW home">
    <img class="logo-light" src="${LOGO_LIGHT}" alt="STFW" width="784" height="${LOGO_HEIGHT}">
    <img class="logo-dark" src="${LOGO_DARK}" alt="" width="784" height="${LOGO_HEIGHT}">
  </a></h1>
  <p class="say"><i>noun</i> /ˌɛs-ti-ɛf-ˈdʌbəl-ju/</p>
  <p class="sense"><b>S</b>erver <b>T</b>houghts <b>F</b>reedom <b>W</b>all; an anonymous outlet for unfiltered thoughts and confessions.</p>
  <div class="cta">${actions.map(([label, url]) => link((url.startsWith('/') ? lucide('book') : '') + escapeHtml(label) + (url.startsWith('/') ? '' : EXTERNAL), url, 'action')).join('')}</div>
  <p class="updated">Last updated ${updated}</p>
  </div>
  ${sample ? samplePost(sample) : ''}
</header>
<main class="wrap">
  <nav class="toc card" aria-label="Contents"><details><summary>Contents ${CHEVRON}</summary><div class="expander"><div>
    ${docs
      .map((d) => `<ol data-doc="${d.id}">${d.sections.map((s, i) => `<li><a href="#${d.id}-${i + 1}">${escapeHtml(s.title.replace(/\.$/, ''))}</a></li>`).join('')}</ol>`)
      .join('\n')}
  </div></div></details></nav>
  <div>
    ${docs
      .map(
        (d, at) => `<section class="doc" id="${d.id}" data-name="${d.name}"${d.dated ? ' data-dated' : ''}>
<h2>${d.name}</h2>
${at ? '<p class="hint">Select a section number to copy its link.</p>' : ''}
${d.sections.map((s, i) => article(d.id, s, i + 1) + (d.who && d.who.after === i + 1 ? whoSeesWhat(d.who) : '')).join('\n')}
${live && !at ? liveStatus(live) : ''}
<p class="empty" role="status" hidden>No section here matches your search</p>
<div class="elsewhere"></div>
</section>`,
      )
      .join('\n')}
  </div>
</main>
<p class="sr" id="said" role="status"></p>
<footer class="wrap"><div class="card">
  <p>Discord’s own policies</p>
  <ul>${related.map(([label, url]) => `<li>${external(escapeHtml(label) + ARROW, url)}</li>`).join('')}</ul>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
