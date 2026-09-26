// zaina-platform/src/payments/page-css.ts — the payment page's stylesheet
// (served at /pay-assets/pay.css; the page allows styles from its own site only).

export const PAY_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f5;
  --card: #ffffff;
  --text: #1c2321;
  --muted: #5d6865;
  --line: #dfe4e1;
  --accent: #0f766e;
  --accent-text: #ffffff;
  --accent-soft: #e3f3f0;
  --warn-soft: #fdf3e1;
  --warn: #8a5a00;
  --error-soft: #fbe9e8;
  --error: #a3261c;
  --ok-soft: #e5f4e8;
  --ok: #1d6b33;
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111615;
    --card: #1a2120;
    --text: #e8eeec;
    --muted: #9fb0ab;
    --line: #2d3836;
    --accent: #2bb3a3;
    --accent-text: #06201d;
    --accent-soft: #143430;
    --warn-soft: #3a2d12;
    --warn: #f0c46a;
    --error-soft: #3d1a17;
    --error: #ff9d92;
    --ok-soft: #173321;
    --ok: #8fdca6;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.pay { max-width: 560px; margin: 0 auto; padding: 24px 16px 40px; }
header { margin-bottom: 16px; }
.business { margin: 0; color: var(--muted); font-weight: 600; }
h1 { margin: 2px 0 4px; font-size: 1.6rem; line-height: 1.2; }
h2 { margin: 0 0 12px; font-size: 1.15rem; }
h3 { margin: 16px 0 8px; font-size: 1rem; }
.ref { margin: 0; color: var(--muted); }
.ref strong { color: var(--text); letter-spacing: 0.06em; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px;
  margin: 0 0 16px;
}
.notice { border-radius: var(--radius); padding: 14px 16px; margin: 0 0 16px; }
.notice p { margin: 0; }
.notice p + p { margin-top: 6px; }
.notice.info { background: var(--accent-soft); }
.notice.warn { background: var(--warn-soft); color: var(--warn); }
.notice.error { background: var(--error-soft); color: var(--error); }
.notice.ok { background: var(--ok-soft); color: var(--ok); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; margin: 0 0 14px; }
.facts div { min-width: 0; }
.facts dt { color: var(--muted); font-size: 0.85rem; }
.facts dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
table.lines { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
table.lines th { text-align: left; font-weight: 400; padding: 6px 12px 6px 0; }
table.lines td { text-align: right; padding: 6px 0; white-space: nowrap; }
table.lines tr.sub th, table.lines tr.sub td { color: var(--muted); font-size: 0.92rem; }
table.lines tr.total th, table.lines tr.total td { font-weight: 700; border-top: 1px solid var(--line); padding-top: 10px; }
table.lines tr.due th, table.lines tr.due td { font-weight: 700; color: var(--accent); }
form { margin: 0; }
form + form, .method + .method { margin-top: 14px; }
.method { border-top: 1px solid var(--line); padding-top: 14px; }
.method:first-of-type { border-top: 0; padding-top: 0; }
label { display: block; font-weight: 600; margin-bottom: 10px; }
label span { display: block; font-weight: 400; color: var(--muted); font-size: 0.9rem; }
input {
  display: block;
  width: 100%;
  margin-top: 6px;
  font: inherit;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--text);
}
input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
button {
  display: block;
  width: 100%;
  font: inherit;
  font-weight: 700;
  padding: 12px 16px;
  border-radius: 10px;
  border: 0;
  background: var(--accent);
  color: var(--accent-text);
  cursor: pointer;
}
button.secondary { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
.hint { margin: 6px 0 0; color: var(--muted); font-size: 0.9rem; }
ol.steps { margin: 0 0 12px; padding-left: 1.25rem; }
ol.steps li { margin: 2px 0; }
.small { color: var(--muted); font-size: 0.9rem; }
footer { color: var(--muted); font-size: 0.85rem; text-align: center; margin-top: 8px; }
footer p { margin: 4px 0; overflow-wrap: anywhere; }
a { color: var(--accent); }
`;
