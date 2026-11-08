// The page's styles, as one constant. The host loads only the .mjs file, so there is no separate CSS file.
// Labels use the colour of the host's text; the marker colours are decoration only, on a shape next to a text.

export const STYLE_TEXT = `
.gp-page { font-family: inherit; line-height: 1.45; max-width: 72rem; margin: 0 auto; padding: 1rem; }
.gp-page section { margin: 1.5rem 0; }
.gp-page h1, .gp-page h2, .gp-page h3 { margin: 0.5rem 0; }
.gp-page ul.cards, .gp-page ul.findings { list-style: none; padding: 0; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); }
.gp-page ul.findings { grid-template-columns: 1fr; }
.gp-page li.card, .gp-page li.finding { border: 1px solid currentColor; border-radius: 0.5rem; padding: 0.75rem; }
.gp-page p { margin: 0.25rem 0; }
.gp-page .marker { display: inline-block; width: 0.9rem; height: 0.9rem; border: 2px solid currentColor; border-radius: 50%; vertical-align: -0.1rem; margin-right: 0.35rem; }
.gp-page .marker-green { background: #2e9e4f; }
.gp-page .marker-amber { background: #e0a100; border-radius: 0; }
.gp-page .marker-red { background: #d13a3a; border-radius: 0.2rem; transform: rotate(45deg); }
.gp-page .marker-error { background: #7a5bd1; border-style: dashed; }
.gp-page .marker-none { background: transparent; border-style: dotted; }
.gp-page .strip { display: flex; gap: 2px; margin: 0.35rem 0; flex-wrap: wrap; }
.gp-page .strip .cell { width: 0.7rem; height: 0.7rem; border: 1px solid currentColor; display: inline-block; margin: 0; }
.gp-page .tokens, .gp-page .command, .gp-page .file { font-family: ui-monospace, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; display: block; padding: 0.35rem; border: 1px solid currentColor; border-radius: 0.25rem; margin: 0.25rem 0; }
.gp-page pre.file { margin: 0.25rem 0; overflow-x: auto; max-width: 100%; }
.gp-page table { border-collapse: collapse; width: 100%; }
.gp-page th, .gp-page td { border: 1px solid currentColor; padding: 0.25rem 0.5rem; text-align: left; }
.gp-page button { font: inherit; padding: 0.3rem 0.7rem; cursor: pointer; margin: 0.15rem 0.25rem 0.15rem 0; }
.gp-page button:focus-visible, .gp-page textarea:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.gp-page textarea { width: 100%; font-family: ui-monospace, Consolas, monospace; }
.gp-page .warning { font-weight: bold; }
.gp-page .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .gp-page * { scroll-behavior: auto; } }
`;