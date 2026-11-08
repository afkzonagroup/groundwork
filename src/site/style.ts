// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The stylesheet embedded in every page. System fonts only, no external
 * assets. Colour pairs meet WCAG 2.1 AA contrast (checked in tests).
 *
 * @packageDocumentation
 */

/** Colour tokens for the light and dark themes. */
export const THEME = {
  light: {
    bg: '#ffffff',
    surface: '#f4f6f8',
    text: '#1b1f24',
    muted: '#4b5563',
    border: '#c4cad1',
    accent: '#0b57d0',
    accentText: '#ffffff',
    focus: '#0b57d0',
    okBg: '#e9f6ee',
    okText: '#0b5d2b',
    badBg: '#fbeaea',
    badText: '#9b1c1c',
  },
  dark: {
    bg: '#14171a',
    surface: '#1e2328',
    text: '#e8eaed',
    muted: '#b4bac2',
    border: '#4a525c',
    accent: '#8ab4f8',
    accentText: '#0f1720',
    focus: '#8ab4f8',
    okBg: '#12301f',
    okText: '#9ee2b4',
    badBg: '#3a1717',
    badText: '#f6b3b3',
  },
} as const;

type Theme = (typeof THEME)['light'] | (typeof THEME)['dark'];

function vars(t: Theme): string {
  return [
    `--bg:${t.bg}`,
    `--surface:${t.surface}`,
    `--text:${t.text}`,
    `--muted:${t.muted}`,
    `--border:${t.border}`,
    `--accent:${t.accent}`,
    `--accent-text:${t.accentText}`,
    `--focus:${t.focus}`,
    `--ok-bg:${t.okBg}`,
    `--ok-text:${t.okText}`,
    `--bad-bg:${t.badBg}`,
    `--bad-text:${t.badText}`,
  ].join(';');
}

/** The complete stylesheet. */
export const STYLESHEET = `
:root{${vars(THEME.light)};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${vars(THEME.dark)}}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:1.0625rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow-wrap:break-word}
.wrap{max-width:46rem;margin:0 auto;padding:0 1rem}
.skip{position:absolute;left:-9999px;top:0;background:var(--accent);color:var(--accent-text);padding:.5rem 1rem;z-index:10}
.skip:focus{left:1rem;top:1rem}
header.site{border-bottom:1px solid var(--border);background:var(--surface)}
header.site .wrap{display:flex;flex-wrap:wrap;gap:.25rem 1rem;align-items:baseline;padding-top:.75rem;padding-bottom:.75rem}
header.site .course{font-weight:600;color:var(--text);text-decoration:none}
header.site .course:hover{text-decoration:underline}
header.site .variant{color:var(--muted);font-size:.9375rem}
main{display:block;padding:2rem 0 3rem}
main:focus{outline:none}
h1{font-size:1.875rem;line-height:1.25;margin:.25rem 0 .75rem}
h2{font-size:1.375rem;line-height:1.3;margin:2.25rem 0 .75rem}
h3{font-size:1.125rem;line-height:1.35;margin:1.75rem 0 .5rem}
h4{font-size:1rem;margin:1.5rem 0 .5rem}
p,ul,ol{margin:0 0 1rem}
ul,ol{padding-left:1.5rem}
li{margin:.25rem 0}
a{color:var(--accent);text-underline-offset:.15em}
a:hover{text-decoration-thickness:2px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--surface);padding:.1em .3em;border-radius:3px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
.meta{color:var(--muted);margin:0}
.summary{font-size:1.125rem}
.callout{border-left:4px solid var(--accent);background:var(--surface);padding:.75rem 1rem;margin:0 0 1rem;border-radius:0 4px 4px 0}
.callout>:last-child{margin-bottom:0}
.callout-warning{border-left-color:var(--bad-text)}
.role-block{border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:.25rem 0 .5rem;margin:1.5rem 0}
.role-block>h3:first-child,.role-block>h4:first-child{margin-top:1rem}
.modules{list-style:none;padding:0}
.modules li{border-top:1px solid var(--border);padding:1rem 0;margin:0}
.modules li:last-child{border-bottom:1px solid var(--border)}
.modules a{font-weight:600;font-size:1.0625rem}
.modules p{margin:.25rem 0 0}
fieldset.q{border:1px solid var(--border);border-radius:6px;padding:1rem;margin:0 0 1.25rem;min-width:0}
fieldset.q legend{font-weight:600;padding:0 .25rem;max-width:100%}
.q-num{display:block;font-weight:400;color:var(--muted);font-size:.9375rem}
.opt{display:flex;gap:.625rem;align-items:flex-start;padding:.375rem 0}
.opt input{flex:none;width:1.25rem;height:1.25rem;margin:.2rem 0 0;accent-color:var(--accent)}
.opt label{flex:1;cursor:pointer}
.feedback{margin-top:.75rem;padding:.75rem 1rem;border-radius:4px;background:var(--surface)}
.feedback>:last-child{margin-bottom:0}
.verdict{font-weight:600}
fieldset.is-correct{border-color:var(--ok-text)}
fieldset.is-correct .feedback{background:var(--ok-bg)}
fieldset.is-correct .verdict{color:var(--ok-text)}
fieldset.is-wrong{border-color:var(--bad-text)}
fieldset.is-wrong .feedback{background:var(--bad-bg)}
fieldset.is-wrong .verdict{color:var(--bad-text)}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0}
button{font:inherit;font-weight:600;border-radius:6px;padding:.625rem 1.25rem;min-height:2.75rem;cursor:pointer;border:2px solid var(--accent)}
button.primary{background:var(--accent);color:var(--accent-text)}
button.secondary{background:transparent;color:var(--accent)}
button:disabled{cursor:not-allowed;opacity:.6}
#gw-result{font-weight:600;margin:0 0 1rem}
#gw-result:empty,#gw-scorm-status:empty{display:none}
.status{color:var(--muted)}
.pager{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;border-top:1px solid var(--border);margin-top:2.5rem;padding-top:1rem}
.sources li{overflow-wrap:anywhere}
footer.site{border-top:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:.9375rem}
footer.site .wrap{padding-top:1.25rem;padding-bottom:1.5rem}
footer.site p{margin:0 0 .5rem}
footer.site a{color:var(--accent)}
.attribution{font-weight:600}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media print{header.site,.actions,.skip{display:none}body{font-size:11pt}a{color:inherit}}
`.trim();
