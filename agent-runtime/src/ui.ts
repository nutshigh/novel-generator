const HOME_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NovelBuilder · 从一个念头长出一部小说</title>
<style>
:root{
  --bg:#f5f5f1; --surface:#ffffff; --surface-2:#fafaf7; --ink:#15171a; --ink-2:#3c4147;
  --muted:#666b73; --line:#e5e5df; --line-2:#d5d6cf;
  --accent:#1f5b4e; --accent-dark:#17453b; --accent-soft:#e8f0ed;
  --warm:#d9603f; --warm-ink:#b34428; --warm-soft:#fbeae4;
  --serif:"Songti SC","Noto Serif SC","Source Han Serif SC","STSong",serif;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:"Cascadia Code","SFMono-Regular",Consolas,monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
[hidden] { display: none !important; }
body { min-height: 100vh; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 15px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
body.drawer-open { overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.topbar { background: rgba(245,245,241,.86); border-bottom: 1px solid var(--line); }
.topbar-inner { max-width: 1220px; margin: 0 auto; padding: 0 30px; height: 66px; display: flex; align-items: center; justify-content: space-between; gap: 26px; }
.brand { display: flex; align-items: center; gap: 11px; min-width: 180px; }
.logo { width: 30px; height: 30px; border-radius: 9px; background: var(--ink); color: #fff; display: grid; place-items: center; font-family: var(--serif); font-size: 16px; }
.brand-name { font-size: 16.5px; font-weight: 700; letter-spacing: -.02em; }
.top-actions { display: flex; align-items: center; gap: 9px; min-width: 0; }
.model-pill { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 11px; border: 1px solid var(--line-2); border-radius: 999px; background: rgba(255,255,255,.62); font-size: 11.5px; color: var(--ink-2); }
.model-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: #2f8a63; box-shadow: 0 0 0 3px rgba(47,138,99,.12); flex: none; }
.icon-btn { width: 34px; height: 34px; border: 1px solid var(--line-2); border-radius: 9px; background: rgba(255,255,255,.62); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; }
.icon-btn:hover { background: var(--surface); color: var(--ink); }

.page { max-width: 1220px; margin: 0 auto; padding: 40px 30px 60px; filter: saturate(.92); }
.intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; margin-bottom: 26px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .16em; color: var(--accent); text-transform: uppercase; margin-bottom: 12px; }
.eyebrow::before { content: ""; width: 18px; height: 2px; background: var(--accent); border-radius: 2px; }
h1 { font-size: clamp(30px,3.6vw,42px); line-height: 1.2; letter-spacing: -.035em; font-weight: 750; margin: 0; }
h1 span { font-family: var(--serif); font-weight: 600; color: var(--accent); }
.intro p { max-width: 560px; margin: 12px 0 0; color: var(--muted); font-size: 13.5px; }
.layout { display: grid; grid-template-columns: minmax(0,1fr) 372px; gap: 22px; align-items: start; }

.composer { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 1px 2px rgba(20,24,20,.04); overflow: hidden; }
.composer-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 26px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg,#fdfdfb,var(--surface)); }
.composer-title { display: flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 650; }
.step-no { width: 22px; height: 22px; border-radius: 7px; background: var(--accent-soft); color: var(--accent); font-family: var(--mono); font-size: 10.5px; font-weight: 700; display: grid; place-items: center; }
.composer-body { padding: 26px; }
textarea { width: 100%; min-height: 150px; padding: 18px 20px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--surface-2); color: var(--ink); font: inherit; font-family: var(--serif); font-size: 18.5px; line-height: 1.9; resize: vertical; outline: 0; transition: border-color .15s ease, box-shadow .15s ease; }
textarea::placeholder { color: #6f746e; }
textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(31,91,78,.08); }
.prompt-row { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.prompt-row .count { font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
.options { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 22px; }
.composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 26px; border-top: 1px solid var(--line); background: var(--surface-2); }
.save-hint { display: flex; align-items: center; gap: 7px; max-width: min(420px, 100%); min-width: 0; flex: 0 1 auto; font-size: 11.5px; color: var(--muted); }
.save-hint > span[aria-hidden] { color: var(--accent); font-size: 12px; line-height: 1; }
.btn-primary { display: inline-flex; align-items: center; gap: 9px; height: 40px; padding: 0 22px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.btn-primary:hover { background: var(--accent-dark); border-color: var(--accent-dark); }
.btn-primary:disabled, .btn-ghost:disabled { opacity: .55; cursor: not-allowed; }
.btn-ghost { height: 34px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--ink-2); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; }
.btn-ghost:hover { background: var(--surface-2); color: var(--ink); }
.btn-dark { height: 34px; padding: 0 16px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer; }
.btn-dark:hover { background: var(--accent-dark); border-color: var(--accent-dark); }

aside { display: flex; flex-direction: column; gap: 16px; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.panel-head h2 { margin: 0; font-size: 12.5px; font-weight: 650; }
.status { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 650; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 4px 9px; }
.status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.panel-body { padding: 16px 18px 18px; }
.big-stat { display: flex; align-items: center; gap: 15px; margin-bottom: 16px; }
.big-stat b { display: block; font-size: 15px; letter-spacing: -.02em; }
.big-stat span { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
.steps { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.steps li { position: relative; display: flex; align-items: flex-start; gap: 11px; padding: 0 0 15px; }
.steps li:last-child { padding-bottom: 0; }
.steps .bullet { position: relative; width: 17px; height: 17px; border-radius: 50%; border: 1.5px solid var(--line-2); background: var(--surface); flex: none; margin-top: 1px; display: grid; place-items: center; font-size: 9px; color: var(--muted); }
.steps .txt { font-size: 12px; color: var(--muted); line-height: 1.35; }
.steps .txt b { display: block; color: var(--ink); font-weight: 600; }
.steps .txt span { font-size: 10px; color: var(--muted); }
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 16px; }
.kv div { background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px; }
.kv span { display: block; font-size: 9.5px; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }
.kv b { display: block; font-family: var(--mono); font-size: 15px; font-weight: 600; margin-top: 1px; }
#last-update.is-stale { color: #b0552f; }
.log .event-duration { color: #8a7a63; white-space: nowrap; }

.overlay { position: fixed; inset: 0; z-index: 20; background: rgba(18,22,20,.34); backdrop-filter: blur(2px); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 21; width: min(456px,100%); display: flex; flex-direction: column; background: var(--surface); box-shadow: -32px 0 80px -30px rgba(15,24,20,.45); border-left: 1px solid var(--line); }
.drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 26px 18px; border-bottom: 1px solid var(--line); }
.drawer-kicker { font-size: 10px; font-weight: 700; letter-spacing: .18em; color: var(--accent); text-transform: uppercase; margin-bottom: 7px; }
.drawer-head h2 { margin: 0; font-size: 20px; letter-spacing: -.02em; font-weight: 700; }
.drawer-head p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.close-btn { width: 32px; height: 32px; flex: none; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--muted); display: grid; place-items: center; cursor: pointer; font: inherit; font-size: 18px; line-height: 1; }
.close-btn:hover { color: var(--ink); background: var(--surface-2); }
.drawer-body { flex: 1; overflow-y: auto; padding: 22px 26px 26px; }
.current { display: flex; align-items: center; gap: 10px; background: var(--accent-soft); border: 1px solid #d6e4df; border-radius: 10px; padding: 11px 13px; margin-bottom: 22px; }
.current .pulse { width: 7px; height: 7px; border-radius: 50%; background: #2f8a63; box-shadow: 0 0 0 4px rgba(47,138,99,.14); flex: none; }
.current b { display: block; font-size: 12.5px; font-weight: 600; }
.current span { display: block; font-size: 10.5px; color: var(--muted); margin-top: 1px; }
.current .tag { margin-left: auto; font-size: 9.5px; font-weight: 650; letter-spacing: .04em; color: var(--accent); border: 1px solid rgba(31,91,78,.24); background: #fff; border-radius: 999px; padding: 3px 8px; white-space: nowrap; }
.current > div { min-width: 0; }
.current > div b,
.current > div span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#model-pill-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#model-hint-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.section-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 0; margin-bottom: 10px; }
.section-label span { font-weight: 500; letter-spacing: 0; text-transform: none; color: #6f746e; font-size: 10px; }
.field { margin-bottom: 17px; }
.field > label, .field-label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; padding: 0; }
.field .hint { display: block; margin-top: 5px; font-size: 10.5px; line-height: 1.6; color: var(--muted); }
.segmented { display: flex; gap: 3px; padding: 3px; background: #f1f2ed; border: 1px solid var(--line); border-radius: 9px; }
.segmented span { flex: 1; text-align: center; font-size: 11.5px; color: var(--muted); padding: 6px 8px; border-radius: 6px; cursor: pointer; }
input { width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 12.5px; outline: 0; transition: border-color .15s ease, box-shadow .15s ease; }
input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(31,91,78,.08); }
input::placeholder { color: #6f746e; }
input.mono { font-family: var(--mono); font-size: 11.5px; }
.key-row { display: flex; align-items: center; gap: 8px; }
.key-row input { flex: 1; letter-spacing: .08em; }
.key-state { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; font-size: 10.5px; color: var(--accent); }
.key-state > span[aria-hidden] { font-size: 11px; line-height: 1; }
.link-btn {
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 4px 2px;
  white-space: nowrap;
}
.link-btn:hover { color: var(--accent-dark); text-decoration: underline; }
.divider { height: 1px; background: var(--line); margin: 20px 0; }
.auto-note { display: flex; gap: 10px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 9px; padding: 11px 12px; font-size: 10.5px; line-height: 1.65; color: var(--muted); }
.auto-note > span[aria-hidden] { color: var(--accent); font-family: var(--mono); font-size: 14px; line-height: 1.2; flex: none; }
.auto-note b { color: var(--ink-2); font-weight: 600; }
.auto-note code { font-family: var(--mono); font-size: 10px; }
.drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 26px; border-top: 1px solid var(--line); background: var(--surface-2); }
.save-state { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--accent); font-weight: 600; }
.save-state .sub { color: var(--muted); font-weight: 400; margin-left: 2px; }
.foot-actions { display: flex; align-items: center; gap: 8px; }

.segmented label { flex: 1; display: block; cursor: pointer; }
.segmented span { display: block; width: 100%; text-align: center; }
.segmented input:checked + span { background: var(--surface); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgba(20,24,20,.08); }
.segmented input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
fieldset.field { border: 0; padding: 0; margin: 0 0 17px; min-width: 0; }
.field-label { display: block; padding: 0; margin: 0 0 6px; font-size: 12px; font-weight: 600; }
.model-pill { font-family: inherit; max-width: min(360px, 46vw); min-width: 0; cursor: pointer; }
.icon-btn { font: inherit; cursor: pointer; }
.opt {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 11px 13px;
  display: flex;
  align-items: baseline;
  row-gap: 3px;
  column-gap: 5px;
  flex-wrap: wrap;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.opt.is-editable { cursor: text; }
.opt:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(31,91,78,.08);
}
.opt > span { width: 100%; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.opt input {
  width: 76px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid transparent;
  background: transparent;
  color: var(--ink);
  font-family: var(--mono);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -.03em;
  outline: 0;
}
.opt input:focus {
  border-bottom-color: var(--accent);
  box-shadow: none;
}
.opt b { min-width: 76px; font-family: var(--mono); font-size: 19px; font-weight: 600; letter-spacing: -.03em; }
.opt em { font-style: normal; font-size: 11px; color: var(--muted); }
.save-hint { border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
.composer-actions { display: flex; align-items: center; gap: 9px; }
.current[data-state="warn"] { background: #fdf6e7; border-color: #ecd9ad; }
.current[data-state="warn"] .pulse { background: #c58a2a; box-shadow: 0 0 0 4px rgba(197,138,42,.14); }
.current[data-state="warn"] .tag { color: #8a5c12; border-color: #e5c98e; }
.save-state[data-state="warn"] { color: #8a5c12; }
.save-state[data-state="saving"] { color: var(--muted); }
.save-state[data-state="error"] { color: var(--warm-ink); cursor: pointer; }
.save-state[data-state="idle"] { color: var(--muted); }
.save-state { border: 0; background: none; padding: 0; font: inherit; }

.ring { --p: 0; width: 58px; height: 58px; border-radius: 50%; background: conic-gradient(var(--accent) calc(var(--p) * 1%), #e9eae4 0); display: grid; place-items: center; flex: none; }
.ring span { width: 44px; height: 44px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-family: var(--mono); font-size: 11px; font-weight: 600; color: var(--ink); }

.steps li.done .bullet { background: var(--accent); border-color: var(--accent); color: #fff; }
.steps li.active .bullet { font-size: 0; border-color: var(--accent); box-shadow: 0 0 0 4px rgba(31,91,78,.1); }
.steps li.active .bullet::after,
.steps li.error .bullet::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.steps li.active .bullet::after { background: var(--accent); }
.steps li.error { color: var(--warm-ink); }
.steps li.error .bullet { font-size: 0; border-color: var(--warm); color: var(--warm-ink); }
.steps li.error .bullet::after { background: var(--warm); }
.steps li.error .txt b { color: var(--warm-ink); }
.steps li.done .txt b, .steps li.active .txt b { color: var(--accent); }

.status[data-state="running"], .status[data-state="completed"] { color: var(--accent); background: var(--accent-soft); }
.status[data-state="idle"] { color: var(--muted); background: #f1f2ed; }
.status[data-state="failed"] { color: var(--warm-ink); background: var(--warm-soft); }
.status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.model-pill[data-state="warn"] .dot { background: #c58a2a; box-shadow: 0 0 0 3px rgba(197,138,42,.14); }
.model-pill[data-state="loading"] .dot { background: #6f746e; box-shadow: none; }
.save-hint[data-state="warn"] { color: #8a5c12; }
.save-hint[data-state="warn"] > span:first-child { color: #8a5c12; }
.save-hint[data-state="loading"] > span:first-child { color: var(--muted); }

.overlay { opacity: 0; transition: opacity .2s ease; }
.overlay.is-open { opacity: 1; }
.drawer { transform: translateX(100%); transition: transform .2s ease; }
.drawer.is-open { transform: none; }

.log { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; font-family: var(--mono); font-size: 10px; line-height: 1.7; color: var(--ink-2); }
.log li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0eb; }
.log li:last-child { border-bottom: 0; }
.log time { color: #6f746e; white-space: nowrap; }
.log em { font-style: normal; color: var(--accent); }
.log .log-empty { color: var(--muted); font-family: var(--sans); font-size: 11.5px; }

.result-card { margin-top: 22px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 26px; box-shadow: 0 1px 2px rgba(20,24,20,.04); }
.result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.result-head h2 { margin: 2px 0 0; font-family: var(--serif); font-size: 24px; font-weight: 600; }
.result-stats { display: flex; gap: 24px; }
.result-stats span { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.result-stats b { display: block; font-family: var(--mono); font-size: 20px; margin-top: 2px; }
.result-links { display: flex; gap: 18px; margin-top: 18px; font-size: 13px; font-weight: 600; }
.result-links a { color: var(--accent); text-decoration: none; }
.result-links a:hover { text-decoration: underline; }
.preview { max-height: 440px; margin: 18px 0 0; padding: 18px 20px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); color: var(--ink-2); font-family: var(--sans); font-size: 13.5px; line-height: 1.9; }

.form-error, .alert { margin: 12px 0 0; padding: 10px 12px; border: 1px solid #f0c9bd; border-radius: 9px; background: var(--warm-soft); color: #8f341c; font-size: 12px; line-height: 1.6; }
.form-error { margin: 0 26px 18px; }

.save-hint { font-size: 11.5px; }
.save-state { font-size: 10.5px; }
.opt input { height: auto; }
.opt input::-webkit-outer-spin-button, .opt input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.opt input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 34px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--muted); }

/* ---------- library ---------- */
.view-tabs { display: flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.55); }
.view-tab { border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 650; padding: 6px 14px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.view-tab:hover { color: var(--ink); }
.view-tab.is-active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(20,24,20,.08); }
.tab-count { font-family: var(--mono); font-size: 9.5px; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 1px 6px; }
.library-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.library-head .eyebrow { margin-bottom: 10px; }
.library-head p { max-width: 560px; margin: 10px 0 0; color: var(--muted); font-size: 13.5px; }
.library-run { margin-bottom: 18px; padding: 0; overflow: hidden; }
.library-run-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--surface-2); flex-wrap: wrap; }
.library-run-title { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 12.5px; }
.library-run-title b { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-run-title span.library-sub { color: var(--muted); font-size: 10.5px; white-space: nowrap; }
.library-run-actions { display: flex; align-items: center; gap: 10px; }
.write-progress { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.library-run .log { max-height: 170px; padding: 10px 18px 14px; }
.library-state { padding: 46px 24px; text-align: center; border: 1px dashed var(--line-2); border-radius: 14px; color: var(--muted); font-size: 13px; background: rgba(255,255,255,.45); }
.library-state b { display: block; color: var(--ink); font-size: 16px; margin-bottom: 6px; }
.library-state p { margin: 0 0 14px; }
.book-list { display: flex; flex-direction: column; gap: 12px; }
.book-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 1px 2px rgba(20,24,20,.04); overflow: hidden; }
.book-head { padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.book-main { min-width: 0; flex: 1; }
.book-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.book-title { margin: 0; font-family: var(--serif); font-size: 20px; font-weight: 600; letter-spacing: -.015em; }
.book-badge { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; border-radius: 999px; padding: 3px 9px; background: #f1f2ed; color: var(--muted); white-space: nowrap; }
.book-badge[data-state="done"] { color: var(--accent); background: var(--accent-soft); }
.book-badge[data-state="running"] { color: #8a5c12; background: #fdf6e7; }
.book-badge[data-state="warn"] { color: var(--warm-ink); background: var(--warm-soft); }
.book-badge[data-state="idle"] { color: var(--muted); background: #f1f2ed; }
.book-premise { margin: 6px 0 0; color: var(--ink-2); font-size: 12.5px; line-height: 1.65; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.book-meta { margin-top: 8px; font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
.book-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.book-actions .btn-dark, .book-actions .btn-ghost { white-space: nowrap; }
.book-actions .btn-ghost:disabled { opacity: .45; cursor: not-allowed; }
.book-toc { border-top: 1px solid var(--line); background: var(--surface-2); padding: 12px 20px 18px; }
.tree-group { border-bottom: 1px solid #eeeeE7; }
.tree-group:last-child { border-bottom: 0; }
.tree-toggle { width: 100%; border: 0; background: none; font: inherit; color: var(--ink); display: flex; align-items: center; gap: 9px; padding: 10px 0; cursor: pointer; text-align: left; }
.tree-toggle .caret { width: 16px; color: var(--muted); font-size: 10px; transition: transform .15s ease; }
.tree-toggle[aria-expanded="false"] .caret { transform: rotate(-90deg); }
.tree-toggle .tree-title { font-weight: 650; font-size: 12.5px; }
.tree-toggle .tree-summary { color: var(--muted); font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tree-children { padding-left: 15px; }
.tree-stage { margin-left: 4px; border-left: 1px solid var(--line); padding-left: 12px; }
.tree-stage .tree-toggle .tree-title { font-weight: 600; font-size: 12px; color: var(--ink-2); }
.chapter-list { list-style: none; margin: 0 0 6px; padding: 0 0 0 25px; }
.chapter-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px dashed #eeeee8; }
.chapter-row:last-child { border-bottom: 0; }
.chapter-no { font-family: var(--mono); font-size: 10px; color: var(--muted); min-width: 44px; }
.chapter-name { flex: 1; min-width: 0; border: 0; background: none; padding: 0; font: inherit; font-size: 12px; text-align: left; color: var(--ink-2); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-name:disabled { cursor: default; color: var(--muted); }
.chapter-name:not(:disabled):hover { color: var(--accent); }
.chapter-stat { font-family: var(--mono); font-size: 9.5px; color: var(--muted); white-space: nowrap; }
.chapter-stat[data-state="written"] { color: var(--accent); }
.chapter-stat[data-state="needs_attention"] { color: #8a5c12; }
.chapter-stat[data-state="missing"] { color: var(--muted); }
.chapter-actions { display: flex; gap: 5px; }
.chapter-actions .link-btn { font-size: 10px; padding: 2px 3px; }
.toc-loading { padding: 10px 0; font-size: 11px; color: var(--muted); }

.modal { position: fixed; z-index: 31; top: 50%; left: 50%; width: min(480px, calc(100vw - 40px)); transform: translate(-50%, -48%); background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 30px 80px -30px rgba(15,24,20,.5); overflow: hidden; }
.modal.is-open { transform: translate(-50%, -50%); }
.modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px 14px; border-bottom: 1px solid var(--line); }
.modal-head h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
.modal-head p { margin: 4px 0 0; color: var(--muted); font-size: 11.5px; }
.modal-body { padding: 18px 24px; }
.modal-body > p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.8; color: var(--ink-2); }
.continue-field { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; margin: 12px 0 4px; }
.continue-field input { width: 84px; height: 34px; font-family: var(--mono); }
.continue-field span { color: var(--muted); font-size: 10.5px; font-weight: 400; }
.modal-foot { display: flex; align-items: center; justify-content: flex-end; gap: 9px; padding: 14px 24px; border-top: 1px solid var(--line); background: var(--surface-2); }
.modal-overlay { z-index: 30; }
.reader-drawer { width: min(720px, 100%); }
.reader-drawer .drawer-body { padding-top: 22px; }
.reader-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--serif); font-size: 16px; line-height: 2; color: var(--ink-2); }
.reader-nav { display: flex; align-items: center; gap: 10px; }
.reader-position { font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
/* ---------- knowledge graph page ---------- */
.graph-layout { display: grid; grid-template-columns: 260px minmax(0,1fr) 300px; gap: 14px; align-items: stretch; }
.graph-side, .graph-detail { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px; min-width: 0; }
.graph-side { max-height: calc(100vh - 170px); overflow-y: auto; }
.graph-book-list { display: flex; flex-direction: column; gap: 6px; }
.graph-book-item { width: 100%; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); padding: 8px 10px; text-align: left; font: inherit; cursor: pointer; color: var(--ink-2); }
.graph-book-item:hover { border-color: var(--line-2); color: var(--ink); }
.graph-book-item.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.graph-book-item b { display: block; font-size: 12px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.graph-book-item span { display: block; margin-top: 2px; font-family: var(--mono); font-size: 9.5px; color: var(--muted); }
.graph-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0 12px; }
.graph-kinds label, .graph-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-2); cursor: pointer; }
.graph-kinds input, .graph-toggle input { width: auto; height: auto; flex: none; }
.graph-toggle { margin: 7px 0; }
.graph-range { margin: 14px 0 10px; }
.graph-range label { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 600; margin-bottom: 7px; }
.graph-range label span { font-family: var(--mono); font-weight: 400; color: var(--muted); }
.graph-range input[type="range"] { width: 100%; height: auto; padding: 0; border: 0; background: transparent; box-shadow: none; accent-color: var(--accent); }
.graph-layout-field { margin-top: 12px; margin-bottom: 0; }
.graph-layout-field select { width: 100%; height: 36px; padding: 0 9px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--surface); color: var(--ink); font: inherit; font-size: 12px; }
.graph-main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 620px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.graph-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 14px; border-bottom: 1px solid var(--line); background: var(--surface-2); flex-wrap: wrap; }
.graph-counts { display: flex; align-items: center; gap: 14px; font-size: 10.5px; color: var(--muted); flex-wrap: wrap; }
.graph-counts b { font-family: var(--mono); font-size: 12px; color: var(--ink); }
#graph-status { font-family: var(--mono); font-size: 9.5px; }
.graph-tools { display: flex; gap: 5px; }
.graph-canvas { flex: 1; min-height: 560px; width: 100%; background: radial-gradient(circle at 50% 40%, #ffffff 0%, #fbfbf7 55%, #f4f4ef 100%); }
.graph-unavailable { position: absolute; inset: 54px 18px 46px; display: grid; place-items: center; background: rgba(255,255,255,.92); }
.graph-legend { display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 14px; border-top: 1px solid var(--line); font-size: 10px; color: var(--muted); }
.graph-legend span { display: inline-flex; align-items: center; gap: 5px; }
.graph-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.graph-detail { max-height: calc(100vh - 170px); overflow-y: auto; }
.graph-detail h2 { margin: 0; font-family: var(--serif); font-size: 20px; font-weight: 600; letter-spacing: -.015em; }
.graph-detail-meta { margin-top: 4px; font-family: var(--mono); font-size: 10px; color: var(--muted); }
.graph-detail-body { margin-top: 14px; }
.graph-detail-empty { margin: 0; font-size: 11.5px; color: var(--muted); line-height: 1.7; }
.graph-detail-section { margin-bottom: 14px; }
.graph-detail-section h4 { margin: 0 0 6px; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.graph-detail-list { list-style: none; margin: 0; padding: 0; }
.graph-detail-list li { padding: 5px 0; border-bottom: 1px dashed #eeeEE7; font-size: 11px; line-height: 1.6; color: var(--ink-2); }
.graph-detail-list li:last-child { border-bottom: 0; }
.graph-detail-kv { display: grid; grid-template-columns: 1fr; gap: 4px; margin: 0; }
.graph-detail-kv div { display: flex; justify-content: space-between; gap: 10px; font-size: 10.5px; padding: 4px 0; border-bottom: 1px dashed #eeeEE7; }
.graph-detail-kv dt { color: var(--muted); }
.graph-detail-kv dd { margin: 0; color: var(--ink-2); text-align: right; overflow-wrap: anywhere; }
.graph-note { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #ecd9ad; border-radius: 9px; background: #fdf6e7; color: #8a5c12; font-size: 11.5px; line-height: 1.7; }
@media (max-width: 1200px) {
  .graph-layout { grid-template-columns: 220px minmax(0,1fr) 260px; }
}
@media (max-width: 980px) {
  .graph-layout { grid-template-columns: 1fr; }
  .graph-side { order: 2; max-height: none; }
  .graph-main { order: 1; min-height: 520px; }
  .graph-detail { order: 3; max-height: none; }
  .graph-canvas { min-height: 460px; }
}

@media (max-width: 980px) {
  .layout { grid-template-columns: 1fr; }
  .drawer { width: 100%; }
  .page { padding: 28px 20px 44px; }
  .topbar-inner { padding: 0 20px; }
  .brand { min-width: 0; }
  .model-pill { max-width: 56vw; }
  .options { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .view-tabs { order: 3; width: 100%; justify-content: center; }
  .topbar-inner { height: auto; padding: 10px 20px; flex-wrap: wrap; gap: 10px; }
  .book-head { flex-direction: column; }
  .book-actions { width: 100%; }
  .chapter-row { flex-wrap: wrap; }
  .chapter-name { flex-basis: 100%; order: 3; }
}
@media (prefers-reduced-motion: reduce) {
  .overlay, .drawer, .ring, .btn-primary { transition: none; animation: none; }
}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <div class="brand"><div class="logo" aria-hidden="true">N</div><div class="brand-name">NovelBuilder</div></div>
    <nav class="view-tabs" aria-label="视图切换">
      <button class="view-tab is-active" id="view-tab-create" type="button" data-view="create" aria-current="page">创作</button>
      <button class="view-tab" id="view-tab-library" type="button" data-view="library">书架<span class="tab-count" id="library-count" hidden>0</span></button>
      <button class="view-tab" id="view-tab-graph" type="button" data-view="graph">图谱</button>
    </nav>
    <div class="top-actions">
      <button class="model-pill" id="model-pill" data-state="loading" type="button" aria-haspopup="dialog" title="模型设置">
        <span class="dot" aria-hidden="true"></span>
        <span class="sr-only">模型设置：</span>
        <span id="model-pill-text">读取设置…</span>
      </button>
      <button class="icon-btn" id="settings-button" type="button" aria-label="全局设置" aria-haspopup="dialog"><span aria-hidden="true" style="font-size:16px">⚙</span></button>
    </div>
  </div>
</header>

<main class="page">
  <div id="create-view">
  <section class="intro">
    <div>
      <div class="eyebrow">NEW STORY</div>
      <h1>从一个念头，<span>长出一部小说</span>。</h1>
      <p>故事圣经、分卷大纲、逐章写作与连续性维护，自动串成一条流水线。模型配置收进全局设置，这里只留给创作。</p>
    </div>
  </section>

  <div class="layout">
    <section class="composer">
      <form id="novel-form" novalidate>
        <div class="composer-top"><div class="composer-title"><span class="step-no">01</span>故事前提</div></div>
        <div class="composer-body">
          <label class="sr-only" for="premise">故事前提</label>
          <textarea id="premise" name="premise" required placeholder="例如：旧城即将沉没，一个修钟匠发现自己能听见地脉的回声。"></textarea>
          <div class="prompt-row"><span class="count" id="premise-count">0 字</span></div>
          <div class="options">
            <label class="opt is-editable" for="maxChapters"><span>章节数</span><input id="maxChapters" type="number" min="1" max="40" step="1" value="6" inputmode="numeric"><em>章</em></label>
            <label class="opt is-editable" for="chapterWords"><span>每章字数</span><input id="chapterWords" type="number" min="200" max="20000" step="100" value="800" inputmode="numeric"><em>字</em></label>
            <div class="opt"><span>全书预计</span><b id="total-words">4,800</b><em>字</em></div>
          </div>
        </div>
        <div class="composer-foot">
          <button class="save-hint" id="model-hint" type="button" data-state="loading" aria-haspopup="dialog"><span aria-hidden="true">✓</span><span id="model-hint-text">读取设置…</span></button>
          <div class="composer-actions">
            <button class="btn-ghost" id="abort-button" type="button" hidden>停止生成</button>
            <button class="btn-primary" id="submit-button" type="submit">开始生成 <span aria-hidden="true">→</span></button>
          </div>
        </div>
        <p class="form-error" id="form-error" role="alert" hidden></p>
      </form>
    </section>

    <aside>
      <section class="panel" id="progress-panel">
        <div class="panel-head"><h2>运行概览</h2><span class="status" id="status-badge" data-state="idle"><i aria-hidden="true"></i><span id="status-text">待命</span></span></div>
        <div class="panel-body">
          <div class="big-stat"><div class="ring" id="progress-ring"><span id="ring-text">0/6</span></div><div><b id="phase-title">等待开始</b><span id="phase-sub">填写故事前提后开始生成</span></div></div>
          <ol class="steps" id="timeline">
            <li data-phase="setup"><span class="bullet">1</span><span class="txt"><b>故事圣经</b><span>Story bible</span></span></li>
            <li data-phase="outline"><span class="bullet">2</span><span class="txt"><b>章节大纲</b><span>Outline</span></span></li>
            <li data-phase="done"><span class="bullet">3</span><span class="txt"><b>准备写作</b><span>Ready</span></span></li>
          </ol>
          <div class="kv">
            <div><span>实时字数</span><b id="live-words">0</b></div>
            <div><span>已用时</span><b id="elapsed">00:00</b></div>
            <div><span>最后更新</span><b id="last-update">—</b></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>事件流</h2><span id="log-count" style="font-family:var(--mono);font-size:10px;color:var(--muted)">0 条</span></div>
        <div class="panel-body"><ol class="log" id="event-log" aria-live="polite"><li class="log-empty" id="event-empty">等待开始。填写故事前提后点击“开始生成”。</li></ol></div>
      </section>

      <p class="alert" id="run-error" role="alert" hidden></p>
    </aside>
  </div>

  <section class="result-card" id="result-panel" hidden aria-labelledby="result-title">
    <div class="result-head">
      <div><div class="eyebrow" id="result-eyebrow">大纲已就绪</div><h2 id="result-title">未命名手稿</h2></div>
      <div class="result-stats">
        <div><span>规划章节</span><b id="result-chapters">—</b></div>
        <div><span>已写章节</span><b id="result-words">—</b></div>
      </div>
    </div>
    <div class="result-links"><a id="manuscript-link" href="#" target="_blank" rel="noopener" hidden>打开 book.md</a><button class="link-btn" id="result-library-link" type="button">去书架开始写作</button><a id="project-link" href="#" target="_blank" rel="noopener">查看项目档案</a></div>
    <div role="region" aria-label="手稿预览">
      <pre class="preview" id="result-preview"></pre>
    </div>
  </section>
  </div>

  <div id="library-view" hidden>
    <section class="library-head">
      <div>
        <div class="eyebrow">LIBRARY</div>
        <h1>我的<span>书架</span></h1>
        <p>这里按“本”收录之前构建过的小说。展开目录可以查看每一卷、每一阶段和每一章，也可以从任意章节继续写作。</p>
      </div>
      <button class="btn-ghost" id="library-refresh" type="button">刷新书架</button>
    </section>

    <section class="panel library-run" id="library-run" hidden aria-live="polite">
      <div class="library-run-head">
        <div class="library-run-title">
          <span class="status" id="library-status" data-state="running"><i aria-hidden="true"></i><span id="library-status-text">续写中</span></span>
          <b id="library-run-title">正在续写</b>
          <span class="library-sub" id="library-run-sub"></span>
        </div>
        <div class="library-run-actions">
          <span class="write-progress" id="library-progress">第 0/0 章</span>
          <button class="btn-ghost" id="library-abort" type="button">停止续写</button>
        </div>
      </div>
      <ol class="log" id="library-log"><li class="log-empty" id="library-log-empty">等待开始。</li></ol>
    </section>

    <p class="alert" id="library-error" role="alert" hidden></p>
    <div class="library-state" id="library-loading" hidden>正在读取书架…</div>
    <div class="library-state" id="library-empty" hidden>
      <b>书架还是空的</b>
      <p>回到“创作”写下第一个念头，生成的小说会自动出现在这里。</p>
      <button class="btn-dark" id="library-empty-create" type="button">去创作</button>
    </div>
    <div class="book-list" id="book-list"></div>
  </div>

  <div id="graph-view" hidden>
    <section class="library-head">
      <div>
        <div class="eyebrow">KNOWLEDGE GRAPH</div>
        <h1>人物与<span>情节图谱</span></h1>
        <p id="graph-page-sub">选择一本已完成或正在写作的书，查看人物关系、事件和情节线。</p>
      </div>
      <button class="btn-ghost" id="graph-refresh" type="button">重建图谱</button>
    </section>

    <p class="alert" id="graph-error" role="alert" hidden></p>

    <div class="graph-layout">
      <aside class="graph-side">
        <h3 class="section-label">书籍</h3>
        <div class="graph-book-list" id="graph-book-list"></div>

        <div class="divider"></div>

        <h3 class="section-label">筛选</h3>
        <input id="graph-search" type="search" placeholder="搜索人物、事件或线索…" autocomplete="off">
        <div class="graph-kinds">
          <label><input id="graph-kind-character" type="checkbox" checked>人物</label>
          <label><input id="graph-kind-event" type="checkbox" checked>事件</label>
          <label><input id="graph-kind-thread" type="checkbox" checked>情节线</label>
          <label><input id="graph-kind-location" type="checkbox" checked>地点</label>
          <label><input id="graph-kind-item" type="checkbox" checked>物品</label>
          <label><input id="graph-kind-concept" type="checkbox" checked>概念</label>
          <label><input id="graph-kind-faction" type="checkbox" checked>阵营</label>
        </div>

        <label class="graph-toggle"><input id="graph-show-history" type="checkbox">显示历史关系</label>
        <label class="graph-toggle"><input id="graph-show-chapters" type="checkbox">显示章节节点</label>

        <div class="graph-range">
          <label for="graph-chapter-range">章节范围 <span id="graph-chapter-label"></span></label>
          <input id="graph-chapter-range" type="range" min="0" max="0" step="1" value="0">
        </div>

        <div class="field graph-layout-field">
          <label for="graph-layout">布局</label>
          <select id="graph-layout">
            <option value="cose">力导向</option>
            <option value="concentric">分组布局</option>
            <option value="breadthfirst">章节顺序</option>
          </select>
        </div>
      </aside>

      <section class="graph-main">
        <div class="graph-toolbar">
          <div class="graph-counts"><span>节点 <b id="graph-node-count">0</b></span><span>关系 <b id="graph-edge-count">0</b></span><span id="graph-status"></span></div>
          <div class="graph-tools">
            <button class="btn-ghost" id="graph-zoom-out" type="button" aria-label="缩小">−</button>
            <button class="btn-ghost" id="graph-zoom-in" type="button" aria-label="放大">+</button>
            <button class="btn-ghost" id="graph-fit" type="button">适配</button>
          </div>
        </div>
        <div class="graph-canvas" id="graph-canvas"></div>
        <div class="library-state graph-unavailable" id="graph-unavailable" hidden></div>
        <div class="graph-legend">
          <span><i style="background:#1f5b4e"></i>人物</span>
          <span><i style="background:#d9603f"></i>事件</span>
          <span><i style="background:#b07b2a"></i>情节线</span>
          <span><i style="background:#2f6f8a"></i>地点</span>
          <span><i style="background:#8a7a45"></i>物品/概念</span>
          <span><i style="background:#9b9b90"></i>章节</span>
        </div>
      </section>

      <aside class="graph-detail">
        <h3 class="section-label">节点详情</h3>
        <p class="graph-detail-empty" id="graph-detail-empty">点击画布中的节点或关系边查看详情。</p>
        <div id="graph-detail" hidden>
          <h2 id="graph-detail-title"></h2>
          <div class="graph-detail-meta" id="graph-detail-meta"></div>
          <div class="graph-detail-body" id="graph-detail-body"></div>
        </div>
      </aside>
    </div>
  </div>

  <footer><span>NovelBuilder · 本地优先的创作工具</span><span>输出目录 agent-runtime/output</span></footer>
</main>

<div class="overlay" id="settings-overlay" hidden></div>
<aside class="drawer" id="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden>
  <div class="drawer-head">
    <div><div class="drawer-kicker">GLOBAL SETTINGS</div><h2 id="settings-title">全局设置</h2><p>模型配置只在这里维护，填写后自动保存，之后每次创作都会复用。</p></div>
    <button class="close-btn" id="settings-close" type="button" aria-label="关闭设置">×</button>
  </div>

  <div class="drawer-body">
    <div class="current" id="settings-current" data-state="warn">
      <span class="pulse" aria-hidden="true"></span>
      <div><b id="settings-current-title">尚未配置模型</b><span id="settings-current-sub">填写下方信息后开始创作</span></div>
      <span class="tag" id="settings-current-tag">需要配置</span>
    </div>

    <h3 class="section-label">模型配置 <span>修改后自动保存</span></h3>

    <fieldset class="field">
      <legend class="field-label">API 协议</legend>
      <div class="segmented" role="radiogroup" aria-label="API 协议" aria-describedby="protocol-hint">
        <label><input class="sr-only" id="protocol-openai" name="protocol" type="radio" value="openai" checked><span>OpenAI 兼容</span></label>
        <label><input class="sr-only" id="protocol-anthropic" name="protocol" type="radio" value="anthropic"><span>Anthropic</span></label>
      </div>
      <span class="hint" id="protocol-hint">DeepSeek、Qwen、Moonshot、Ollama 等兼容端点选 OpenAI；Claude 选 Anthropic。</span>
    </fieldset>

    <div class="field"><label for="settings-model">模型名称</label><input id="settings-model" class="mono" autocomplete="off" placeholder="例如：deepseek-chat" aria-describedby="settings-model-hint"><span class="hint" id="settings-model-hint">例如 deepseek-chat、qwen-plus、claude-sonnet-4-5。</span></div>
    <div class="field"><label for="settings-baseUrl">Base URL</label><input id="settings-baseUrl" class="mono" autocomplete="url" placeholder="https://api.example.com/v1" aria-describedby="settings-baseUrl-hint"><span class="hint" id="settings-baseUrl-hint">需要包含 http:// 或 https://。</span></div>

    <div class="field">
      <label for="settings-apiKey">API Key</label>
      <div class="key-row">
        <input id="settings-apiKey" class="mono" type="password" autocomplete="off" placeholder="sk-…" aria-describedby="settings-apiKey-hint">
        <button class="link-btn" id="settings-clear-key" type="button" hidden>清除</button>
      </div>
      <span class="hint" id="settings-apiKey-hint">需要鉴权的端点必填；留空会保留已保存的 Key。</span>
      <span class="key-state" id="settings-key-state" hidden><span aria-hidden="true">✓</span>已保存在本机，页面不会回显明文</span>
    </div>

    <div class="divider"></div>
    <div class="auto-note"><span aria-hidden="true">+</span><div><b>设置随改随存。</b> 配置写入本机 <code>agent-runtime/.agent/settings.json</code>，不会上传，也不会写进作品文件。</div></div>
  </div>

  <div class="drawer-foot">
    <button class="save-state" id="settings-save-state" type="button" data-state="idle"><span aria-hidden="true">✓</span><span id="settings-save-text" role="status" aria-live="polite">等待填写</span><span class="sub" id="settings-save-time"></span></button>
    <div class="foot-actions"><button class="btn-ghost" id="settings-clear" type="button">清除配置</button><button class="btn-dark" id="settings-done" type="button">完成</button></div>
  </div>
</aside>

<div class="overlay modal-overlay" id="continue-overlay" hidden></div>
<div class="modal" id="continue-dialog" role="dialog" aria-modal="true" aria-labelledby="continue-title" hidden>
  <div class="modal-head">
    <div><h2 id="continue-title">续写小说</h2><p id="continue-sub">使用当前全局模型配置</p></div>
    <button class="close-btn" id="continue-close" type="button" aria-label="关闭续写窗口">×</button>
  </div>
  <div class="modal-body">
    <p id="continue-copy"></p>
    <label class="continue-field" id="continue-batch">本次写作章数<input id="continue-chapters" type="number" min="1" max="200" step="1" value="6" inputmode="numeric"><span id="continue-batch-estimate"></span></label>
    <label class="continue-field" id="continue-extension" hidden>追加大纲章数<input id="continue-count" type="number" min="1" max="20" step="1" value="6" inputmode="numeric"><span id="continue-estimate"></span></label>
    <p class="alert" id="continue-error" role="alert" hidden></p>
  </div>
  <div class="modal-foot">
    <button class="btn-ghost" id="continue-cancel" type="button">取消</button>
    <button class="btn-primary" id="continue-confirm" type="button">开始续写</button>
  </div>
</div>

<div class="overlay" id="reader-overlay" hidden></div>
<aside class="drawer reader-drawer" id="reader-drawer" role="dialog" aria-modal="true" aria-labelledby="reader-title" hidden>
  <div class="drawer-head">
    <div><div class="drawer-kicker">CHAPTER</div><h2 id="reader-title">章节</h2><p id="reader-meta"></p></div>
    <button class="close-btn" id="reader-close" type="button" aria-label="关闭阅读">×</button>
  </div>
  <div class="drawer-body"><pre class="reader-text" id="reader-text"></pre></div>
  <div class="drawer-foot">
    <div class="reader-nav"><button class="btn-ghost" id="reader-prev" type="button">上一章</button><button class="btn-ghost" id="reader-next" type="button">下一章</button></div>
    <span class="reader-position" id="reader-position"></span>
  </div>
</aside>

<script src="/vendor/cytoscape.min.js"></script>
<script>
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var form = $("novel-form");
  var premiseInput = $("premise");
  var premiseCount = $("premise-count");
  var maxChaptersInput = $("maxChapters");
  var chapterWordsInput = $("chapterWords");
  var totalWords = $("total-words");
  var submitButton = $("submit-button");
  var abortButton = $("abort-button");
  var formError = $("form-error");
  var runError = $("run-error");
  var modelPill = $("model-pill");
  var modelPillText = $("model-pill-text");
  var modelHint = $("model-hint");
  var modelHintText = $("model-hint-text");
  var settingsButton = $("settings-button");
  var settingsOverlay = $("settings-overlay");
  var settingsDrawer = $("settings-drawer");
  var settingsClose = $("settings-close");
  var settingsDone = $("settings-done");
  var settingsClear = $("settings-clear");
  var settingsCurrent = $("settings-current");
  var settingsCurrentTitle = $("settings-current-title");
  var settingsCurrentSub = $("settings-current-sub");
  var settingsCurrentTag = $("settings-current-tag");
  var settingsModel = $("settings-model");
  var settingsBaseUrl = $("settings-baseUrl");
  var settingsApiKey = $("settings-apiKey");
  var settingsKeyState = $("settings-key-state");
  var settingsClearKey = $("settings-clear-key");
  var settingsSaveState = $("settings-save-state");
  var settingsSaveText = $("settings-save-text");
  var settingsSaveTime = $("settings-save-time");
  var protocolOpenai = $("protocol-openai");
  var protocolAnthropic = $("protocol-anthropic");

  var statusBadge = $("status-badge");
  var statusText = $("status-text");
  var progressRing = $("progress-ring");
  var ringText = $("ring-text");
  var phaseTitle = $("phase-title");
  var phaseSub = $("phase-sub");
  var timeline = $("timeline");
  var timelineItems = Array.prototype.slice.call(timeline.querySelectorAll("li"));
  var liveWords = $("live-words");
  var elapsed = $("elapsed");
  var lastUpdateEl = $("last-update");
  var logCount = $("log-count");
  var eventLog = $("event-log");
  var resultPanel = $("result-panel");
  var resultEyebrow = $("result-eyebrow");
  var resultTitle = $("result-title");
  var resultChapters = $("result-chapters");
  var resultWords = $("result-words");
  var manuscriptLink = $("manuscript-link");
  var resultLibraryLink = $("result-library-link");
  var projectLink = $("project-link");
  var resultPreview = $("result-preview");

  var createView = $("create-view");
  var libraryView = $("library-view");
  var viewTabCreate = $("view-tab-create");
  var viewTabLibrary = $("view-tab-library");
  var libraryCount = $("library-count");
  var libraryRefresh = $("library-refresh");
  var libraryRun = $("library-run");
  var libraryStatus = $("library-status");
  var libraryStatusText = $("library-status-text");
  var libraryRunTitle = $("library-run-title");
  var libraryRunSub = $("library-run-sub");
  var libraryProgress = $("library-progress");
  var libraryAbort = $("library-abort");
  var libraryLog = $("library-log");
  var libraryError = $("library-error");
  var libraryLoading = $("library-loading");
  var libraryEmpty = $("library-empty");
  var libraryEmptyCreate = $("library-empty-create");
  var bookList = $("book-list");

  var continueOverlay = $("continue-overlay");
  var continueDialog = $("continue-dialog");
  var continueClose = $("continue-close");
  var continueCopy = $("continue-copy");
  var continueBatch = $("continue-batch");
  var continueChapters = $("continue-chapters");
  var continueBatchEstimate = $("continue-batch-estimate");
  var continueExtension = $("continue-extension");
  var continueCount = $("continue-count");
  var continueEstimate = $("continue-estimate");
  var continueError = $("continue-error");
  var continueCancel = $("continue-cancel");
  var continueConfirm = $("continue-confirm");

  var readerOverlay = $("reader-overlay");
  var readerDrawer = $("reader-drawer");
  var readerClose = $("reader-close");
  var readerTitle = $("reader-title");
  var readerMeta = $("reader-meta");
  var readerText = $("reader-text");
  var readerPrev = $("reader-prev");
  var readerNext = $("reader-next");
  var readerPosition = $("reader-position");

  var graphView = $("graph-view");
  var viewTabGraph = $("view-tab-graph");
  var graphRefresh = $("graph-refresh");
  var graphSearch = $("graph-search");
  var graphBookList = $("graph-book-list");
  var graphError = $("graph-error");
  var graphPageSub = $("graph-page-sub");
  var graphCanvas = $("graph-canvas");
  var graphUnavailable = $("graph-unavailable");
  var graphStatus = $("graph-status");
  var graphNodeCount = $("graph-node-count");
  var graphEdgeCount = $("graph-edge-count");
  var graphChapterRange = $("graph-chapter-range");
  var graphChapterLabel = $("graph-chapter-label");
  var graphShowHistory = $("graph-show-history");
  var graphShowChapters = $("graph-show-chapters");
  var graphLayout = $("graph-layout");
  var graphFit = $("graph-fit");
  var graphZoomIn = $("graph-zoom-in");
  var graphZoomOut = $("graph-zoom-out");
  var graphDetail = $("graph-detail");
  var graphDetailEmpty = $("graph-detail-empty");
  var graphDetailTitle = $("graph-detail-title");
  var graphDetailMeta = $("graph-detail-meta");
  var graphDetailBody = $("graph-detail-body");
  var graphKindInputs = {
    character: $("graph-kind-character"),
    event: $("graph-kind-event"),
    thread: $("graph-kind-thread"),
    location: $("graph-kind-location"),
    item: $("graph-kind-item"),
    concept: $("graph-kind-concept"),
    faction: $("graph-kind-faction")
  };

  var PHASE_TIMELINE = { setup: 0, bible: 0, outline: 1, done: 2 };
  var PHASE_LABEL = {
    queued: "排队", submit: "提交", setup: "准备", bible: "故事圣经",
    outline: "大纲", model: "模型", write: "写作", chapter: "完成",
    review: "审校", revise: "修订", state: "状态", graph: "图谱",
    export: "整理", resume: "续写", abort: "停止", done: "完成",
    error: "失败", network: "网络"
  };
  var STATUS = { idle: "待命", running: "生成中", completed: "已完成", failed: "失败" };
  var PROTOCOL_LABEL = { openai: "OpenAI 兼容", anthropic: "Anthropic" };
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var settings = {
    protocol: null, model: "", baseUrl: "", hasApiKey: false,
    complete: false, usable: false, updatedAt: null,
    envConfigured: false, envModel: ""
  };
  var settingsLoaded = false;
  var settingsOpen = false;
  var settingsLoadFailed = false;
  var autoOpened = false;
  var saveTimer = null;
  var saveRevision = 0;
  var saveChain = Promise.resolve();
  var clearArmed = false;
  var clearing = false;
  var protocolTouched = false;
  var lastTrigger = null;
  var closeTimer = null;
  var lastFailedAction = null;

  var source = null;
  var runId = null;
  var projectId = null;
  var finished = true;
  var reached = -1;
  var maxChapters = 6;
  var seenEvents = Object.create(null);
  var wordByChapter = {};
  var runStartedAt = 0;
  var elapsedTimer = null;
  var lastEventAt = 0;

  var currentView = "create";
  var books = [];
  var bookToc = Object.create(null);
  var expandedBooks = Object.create(null);
  var libraryFetching = false;
  var libraryPromise = null;
  var graphSelectedBookId = null;
  var graphData = null;
  var graphCy = null;
  var graphRequestSeq = 0;
  var graphChapterMax = 0;
  var libraryRunId = null;
  var libraryRunActive = false;
  var libraryRunBook = null;
  var libraryRunFrom = 0;
  var libraryRunTo = 0;
  var libraryRunWords = 0;
  var librarySeenEvents = Object.create(null);
  var continueState = null;
  var readerState = null;

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (ignore) {}
        if (!response.ok) {
          var error = new Error(data && data.error ? data.error : "请求失败（" + response.status + "）");
          error.code = data && data.code;
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }

  function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
  }

  function clearFormError() {
    formError.textContent = "";
    formError.hidden = true;
  }

  function showRunError(message) {
    runError.textContent = message;
    runError.hidden = false;
  }

  function setStatus(state) {
    statusBadge.setAttribute("data-state", state);
    statusText.textContent = STATUS[state] || state;
  }

  function readProtocol() {
    if (protocolAnthropic.checked) return "anthropic";
    if (protocolOpenai.checked) return "openai";
    return null;
  }

  function writeProtocol(value) {
    protocolOpenai.checked = value !== "anthropic";
    protocolAnthropic.checked = value === "anthropic";
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (ignore) { return url || "未填写 Base URL"; }
  }

  function hasDraft() {
    return Boolean(settings.protocol || settings.model || settings.baseUrl);
  }

  function renderModelPill() {
    if (!settingsLoaded && !settingsLoadFailed) {
      modelPill.setAttribute("data-state", "loading");
      modelPillText.textContent = "读取设置…";
      modelHint.setAttribute("data-state", "loading");
      modelHintText.textContent = "读取设置…";
      return;
    }
    if (settingsLoadFailed) {
      modelPill.setAttribute("data-state", "warn");
      modelPillText.textContent = "设置不可用";
      modelHint.setAttribute("data-state", "warn");
      modelHintText.textContent = "设置读取失败，点击重试";
      return;
    }
    if (settings.complete) {
      modelPill.setAttribute("data-state", "ok");
      modelPillText.textContent = settings.model;
      modelHint.setAttribute("data-state", "ok");
      modelHintText.textContent = settings.model + " · 配置已自动保存";
      return;
    }
    if (hasDraft() && settings.envConfigured) {
      modelPill.setAttribute("data-state", "warn");
      modelPillText.textContent = "配置不完整 · 使用 .env";
      modelHint.setAttribute("data-state", "warn");
      modelHintText.textContent = "配置不完整，当前使用服务器 .env（" + settings.envModel + "）";
      return;
    }
    if (settings.envConfigured) {
      modelPill.setAttribute("data-state", "ok");
      modelPillText.textContent = settings.envModel + " · env";
      modelHint.setAttribute("data-state", "ok");
      modelHintText.textContent = settings.envModel + " · 来自服务器 .env";
      return;
    }
    modelPill.setAttribute("data-state", "warn");
    modelPillText.textContent = "未配置模型";
    modelHint.setAttribute("data-state", "warn");
    modelHintText.textContent = hasDraft() ? "配置不完整，点击继续设置" : "尚未配置模型，点击设置";
  }

  function renderSettingsCurrent() {
    if (settings.complete) {
      settingsCurrent.setAttribute("data-state", "ok");
      settingsCurrentTitle.textContent = settings.model;
      settingsCurrentSub.textContent = PROTOCOL_LABEL[settings.protocol] + " · " + hostOf(settings.baseUrl);
      settingsCurrentTag.textContent = "已连接";
      return;
    }
    if (hasDraft() && settings.envConfigured) {
      settingsCurrent.setAttribute("data-state", "warn");
      settingsCurrentTitle.textContent = "配置不完整";
      settingsCurrentSub.textContent = "当前仍使用服务器 .env（" + settings.envModel + "）";
      settingsCurrentTag.textContent = "使用 .env";
      return;
    }
    if (hasDraft()) {
      settingsCurrent.setAttribute("data-state", "warn");
      settingsCurrentTitle.textContent = "配置不完整";
      settingsCurrentSub.textContent = "填写协议、模型名称和 Base URL 后生效";
      settingsCurrentTag.textContent = "需要配置";
      return;
    }
    if (settings.envConfigured) {
      settingsCurrent.setAttribute("data-state", "ok");
      settingsCurrentTitle.textContent = settings.envModel;
      settingsCurrentSub.textContent = "来自服务器 .env";
      settingsCurrentTag.textContent = "已连接";
      return;
    }
    settingsCurrent.setAttribute("data-state", "warn");
    settingsCurrentTitle.textContent = "尚未配置模型";
    settingsCurrentSub.textContent = "填写下方信息后开始创作";
    settingsCurrentTag.textContent = "需要配置";
  }

  function renderKeyState() {
    if (settings.hasApiKey) {
      settingsApiKey.placeholder = "••••••••（已保存）";
      settingsKeyState.hidden = false;
      settingsClearKey.hidden = false;
    } else {
      settingsApiKey.placeholder = "sk-…";
      settingsKeyState.hidden = true;
      settingsClearKey.hidden = true;
    }
  }

  function setSaveState(state, message) {
    settingsSaveState.setAttribute("data-state", state);
    settingsSaveText.textContent = message;
    if (state !== "saved") settingsSaveTime.textContent = "";
  }

  function reflectSaveState() {
    if (settings.complete) {
      setSaveState("saved", "已保存");
      var stamp = settings.updatedAt ? new Date(settings.updatedAt) : new Date();
      settingsSaveTime.textContent = isNaN(stamp.getTime())
        ? ""
        : stamp.toLocaleTimeString("zh-CN", {
            hour: "2-digit", minute: "2-digit", hour12: false
          });
    } else if (hasDraft()) {
      setSaveState("warn", "配置不完整");
    } else {
      setSaveState("idle", "等待填写");
    }
  }

  function renderSettings(payload, fillInputs) {
    settings = {
      protocol: payload.protocol || null,
      model: payload.model || "",
      baseUrl: payload.baseUrl || "",
      hasApiKey: Boolean(payload.hasApiKey),
      complete: Boolean(payload.complete),
      usable: Boolean(payload.usable),
      updatedAt: payload.updatedAt || null,
      envConfigured: Boolean(payload.envConfigured),
      envModel: payload.envModel || ""
    };
    settingsLoaded = true;
    settingsLoadFailed = false;

    if (fillInputs) {
      protocolTouched = false;
      writeProtocol(settings.protocol);
      settingsModel.value = settings.model;
      settingsBaseUrl.value = settings.baseUrl;
      settingsApiKey.value = "";
    }

    renderModelPill();
    renderSettingsCurrent();
    renderKeyState();

    if (settings.updatedAt) {
      var date = new Date(settings.updatedAt);
      settingsSaveTime.textContent = isNaN(date.getTime())
        ? ""
        : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
  }

  function loadSettings() {
    return api("/api/settings").then(function (payload) {
      lastFailedAction = null;
      renderSettings(payload, true);
      reflectSaveState();
      if (!settings.usable && !autoOpened) {
        autoOpened = true;
        openSettings(false);
      }
    }).catch(function () {
      settingsLoaded = false;
      settingsLoadFailed = true;
      renderModelPill();
      setSaveState("error", "设置读取失败，点击重试");
    });
  }

  function collectPatch() {
    var patch = {};
    var protocol = readProtocol();
    var model = settingsModel.value.trim();
    var baseUrl = settingsBaseUrl.value.trim();
    var key = settingsApiKey.value.trim();

    var otherChanged = model !== settings.model || baseUrl !== settings.baseUrl || Boolean(key);
    if (protocol !== settings.protocol && (protocolTouched || otherChanged)) {
      patch.protocol = protocol;
    }
    if (model !== settings.model) patch.model = model;
    if (baseUrl !== settings.baseUrl) patch.baseUrl = baseUrl;
    if (key) patch.apiKey = key;
    return patch;
  }

  function hasPatch(patch) {
    return Object.keys(patch).length > 0;
  }

  function putSettings(patch) {
    return api("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    }).then(function (payload) {
      var sentKey = patch.apiKey;
      lastFailedAction = null;
      renderSettings(payload, false);
      if (readProtocol() === payload.protocol) protocolTouched = false;
      if (sentKey && settingsApiKey.value.trim() === sentKey) settingsApiKey.value = "";
      return payload;
    });
  }

  function flushSave() {
    if (clearing || !settingsLoaded) return Promise.resolve();
    var patch = collectPatch();
    if (!hasPatch(patch)) {
      reflectSaveState();
      return Promise.resolve();
    }

    var revision = ++saveRevision;
    setSaveState("saving", "保存中…");

    saveChain = saveChain.then(function () {
      return putSettings(patch).then(function () {
        if (revision === saveRevision) {
          settingsSaveState.title = "";
          reflectSaveState();
        }
        var pending = collectPatch();
        if (!clearing && hasPatch(pending)) scheduleSave(false);
      }).catch(function (error) {
        lastFailedAction = flushSave;
        setSaveState("error", "保存失败，重试");
        settingsSaveState.title = error.message;
      });
    });

    return saveChain;
  }

  function scheduleSave(immediate) {
    if (clearing || !settingsLoaded) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      flushSave();
    }, immediate ? 0 : 700);
  }

  function setTriggersExpanded(expanded) {
    [settingsButton, modelPill, modelHint].forEach(function (trigger) {
      trigger.setAttribute("aria-controls", "settings-drawer");
      trigger.setAttribute("aria-expanded", expanded ? "true" : "false");
    });
  }

  function trapFocus(event) {
    if (!settingsOpen || event.key !== "Tab") return;
    var nodes = settingsDrawer.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    );
    var list = Array.prototype.filter.call(nodes, function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
    if (list.length === 0) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openSettings(triggeredByUser) {
    if (settingsOpen) return;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    lastTrigger = document.activeElement;
    settingsOpen = true;
    settingsOverlay.hidden = false;
    settingsDrawer.hidden = false;
    document.body.classList.add("drawer-open");
    setTriggersExpanded(true);
    if (reducedMotion.matches) {
      settingsOverlay.classList.add("is-open");
      settingsDrawer.classList.add("is-open");
    } else {
      requestAnimationFrame(function () {
        settingsOverlay.classList.add("is-open");
        settingsDrawer.classList.add("is-open");
      });
    }
    var focusTarget = settingsModel;
    if (settingsLoadFailed) focusTarget = settingsClose;
    focusTarget.focus();
    if (settingsLoadFailed || !settingsLoaded) {
      setSaveState("saving", "读取中…");
      loadSettings();
    }
  }

  function closeSettings() {
    if (!settingsOpen) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    flushSave();
    settingsOpen = false;
    settingsOverlay.classList.remove("is-open");
    settingsDrawer.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    setTriggersExpanded(false);
    var delay = reducedMotion.matches ? 0 : 200;
    closeTimer = setTimeout(function () {
      closeTimer = null;
      settingsOverlay.hidden = true;
      settingsDrawer.hidden = true;
    }, delay);
    if (lastTrigger && typeof lastTrigger.focus === "function") lastTrigger.focus();
    clearArmed = false;
    settingsClear.textContent = "清除配置";
  }

  function clearApiKey() {
    if (clearing) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    settingsApiKey.value = "";
    saveRevision += 1;
    setSaveState("saving", "保存中…");
    saveChain = saveChain.then(function () {
      return putSettings({ clearApiKey: true });
    }).then(function () {
      lastFailedAction = null;
      reflectSaveState();
    }).catch(function (error) {
      lastFailedAction = clearApiKey;
      setSaveState("error", "保存失败，重试");
      settingsSaveState.title = error.message;
    });
  }

  function performClearAll() {
    if (clearing) return;
    clearing = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveChain = saveChain.then(function () {
      return api("/api/settings", { method: "DELETE" });
    }).then(function (payload) {
      clearing = false;
      lastFailedAction = null;
      renderSettings(payload, true);
      reflectSaveState();
    }).catch(function (error) {
      clearing = false;
      lastFailedAction = performClearAll;
      setSaveState("error", "清除失败，重试");
      settingsSaveState.title = error.message;
    });
  }

  function clearAllSettings() {
    if (!clearArmed) {
      clearArmed = true;
      settingsClear.textContent = "确认清除？";
      return;
    }
    clearArmed = false;
    settingsClear.textContent = "清除配置";
    performClearAll();
  }

  settingsButton.addEventListener("click", function () { openSettings(true); });
  modelPill.addEventListener("click", function () { openSettings(true); });
  modelHint.addEventListener("click", function () { openSettings(true); });
  settingsClose.addEventListener("click", closeSettings);
  settingsDone.addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", closeSettings);
  settingsClear.addEventListener("click", clearAllSettings);
  settingsClearKey.addEventListener("click", clearApiKey);
  settingsSaveState.addEventListener("click", function () {
    if (settingsLoadFailed) {
      setSaveState("saving", "读取中…");
      loadSettings();
      return;
    }
    if (settingsSaveState.getAttribute("data-state") !== "error") return;
    if (lastFailedAction) {
      var action = lastFailedAction;
      lastFailedAction = null;
      action();
      return;
    }
    flushSave();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (continueState) {
        event.preventDefault();
        closeContinue();
        return;
      }
      if (readerState) {
        event.preventDefault();
        closeReader();
        return;
      }
      if (settingsOpen) {
        event.preventDefault();
        closeSettings();
        return;
      }
    }
    trapFocus(event);
  });

  settingsModel.addEventListener("input", function () { scheduleSave(false); });
  settingsBaseUrl.addEventListener("input", function () { scheduleSave(false); });
  settingsApiKey.addEventListener("input", function () { scheduleSave(false); });
  settingsModel.addEventListener("change", function () { scheduleSave(true); });
  settingsBaseUrl.addEventListener("change", function () { scheduleSave(true); });
  settingsApiKey.addEventListener("change", function () { scheduleSave(true); });
  protocolOpenai.addEventListener("change", function () { protocolTouched = true; scheduleSave(true); });
  protocolAnthropic.addEventListener("change", function () { protocolTouched = true; scheduleSave(true); });

  setTriggersExpanded(false);
  renderModelPill();
  loadSettings();

  function updateTotal() {
    var chapters = parseInt(maxChaptersInput.value, 10);
    var words = parseInt(chapterWordsInput.value, 10);
    if (!Number.isFinite(chapters) || chapters <= 0) chapters = 6;
    if (!Number.isFinite(words) || words <= 0) words = 800;
    totalWords.textContent = (chapters * words).toLocaleString("zh-CN");
  }

  function updatePremiseCount() {
    premiseCount.textContent = premiseInput.value.trim().length + " 字";
  }

  function clampNumber(input, fallback, min, max) {
    var parsed = parseInt(input.value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.min(max, Math.max(min, parsed));
    input.value = String(parsed);
    return parsed;
  }

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function updateElapsed() {
    if (runStartedAt) {
      var seconds = Math.floor((Date.now() - runStartedAt) / 1000);
      elapsed.textContent = pad(Math.floor(seconds / 60)) + ":" + pad(seconds % 60);
    }
    updateLastUpdate();
  }

  function updateLastUpdate() {
    if (!lastEventAt) {
      lastUpdateEl.textContent = "—";
      lastUpdateEl.classList.remove("is-stale");
      return;
    }
    var age = Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000));
    lastUpdateEl.textContent = age < 1 ? "刚刚" : age + " 秒前";
    var stale = !finished && age >= 20;
    lastUpdateEl.classList.toggle("is-stale", stale);
    if (stale) {
      phaseSub.textContent = "仍在等待模型返回（已 " + age + " 秒没有新事件）";
    }
  }

  function markEventTime(event) {
    var at = event && typeof event.at === "string" ? Date.parse(event.at) : NaN;
    lastEventAt = Number.isFinite(at) ? at : Date.now();
    updateLastUpdate();
  }

  function startElapsed(from) {
    stopElapsed();
    runStartedAt = typeof from === "number" && Number.isFinite(from) ? from : Date.now();
    updateElapsed();
    elapsedTimer = setInterval(updateElapsed, 1000);
  }

  function stopElapsed() {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return ms + " 毫秒";
    if (ms < 60000) return (ms / 1000).toFixed(1) + " 秒";
    var minutes = Math.floor(ms / 60000);
    var seconds = Math.round((ms % 60000) / 1000);
    return minutes + " 分 " + seconds + " 秒";
  }

  function setRing(current, total) {
    var ratio = total > 0 ? Math.min(1, current / total) : 0;
    progressRing.style.setProperty("--p", String(Math.round(ratio * 100)));
    ringText.textContent = current + "/" + total;
  }

  function addEmptyLog() {
    while (eventLog.firstChild) eventLog.removeChild(eventLog.firstChild);
    var empty = document.createElement("li");
    empty.className = "log-empty";
    empty.id = "event-empty";
    empty.textContent = "等待开始。填写故事前提后点击“开始生成”。";
    eventLog.appendChild(empty);
  }

  function updateLogCount() {
    logCount.textContent = eventLog.querySelectorAll(".event-item").length + " 条";
  }

  function addEvent(message, phase, durationMs) {
    var empty = eventLog.querySelector(".log-empty");
    if (empty) empty.parentNode.removeChild(empty);

    var item = document.createElement("li");
    item.className = "event-item";

    var time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    var tag = document.createElement("em");
    tag.textContent = PHASE_LABEL[phase] || String(phase || "info").toUpperCase();

    var text = document.createElement("span");
    text.textContent = String(message || "");
    item.appendChild(time);
    item.appendChild(tag);
    item.appendChild(text);

    var duration = formatDuration(durationMs);
    if (duration) {
      item.appendChild(make("span", "event-duration", "（" + duration + "）"));
    }
    eventLog.appendChild(item);

    while (eventLog.querySelectorAll(".event-item").length > 200) {
      var first = eventLog.querySelector(".event-item");
      if (!first) break;
      first.parentNode.removeChild(first);
    }
    updateLogCount();
    eventLog.scrollTop = eventLog.scrollHeight;
  }

  function resetProgress() {
    reached = -1;
    wordByChapter = {};
    timelineItems.forEach(function (item) {
      item.classList.remove("done", "active", "error");
    });
    setRing(0, maxChapters);
    liveWords.textContent = "0";
    elapsed.textContent = "00:00";
    lastEventAt = 0;
    lastUpdateEl.textContent = "—";
    lastUpdateEl.classList.remove("is-stale");
    phaseTitle.textContent = "等待开始";
    phaseSub.textContent = "填写故事前提后开始生成";
    addEmptyLog();
    updateLogCount();
    runError.hidden = true;
    runError.textContent = "";
  }

  function markPhase(phase) {
    if (phase === "error") {
      if (reached >= 0 && timelineItems[reached]) timelineItems[reached].classList.add("error");
      return;
    }
    var index = PHASE_TIMELINE[phase];
    if (index === undefined) return;
    if (index > reached) {
      reached = index;
    }
    timelineItems.forEach(function (item, itemIndex) {
      item.classList.remove("error");
      item.classList.toggle("done", itemIndex < reached || (itemIndex === reached && finished));
      item.classList.toggle("active", itemIndex === reached && !finished);
    });
  }

  function completeTimeline() {
    timelineItems.forEach(function (item) {
      item.classList.add("done");
      item.classList.remove("active", "error");
    });
  }

  function updateChapterStats(chapterNumber) {
    var total = 0;
    Object.keys(wordByChapter).forEach(function (key) { total += wordByChapter[key]; });
    liveWords.textContent = total.toLocaleString("zh-CN");
    if (typeof chapterNumber === "number") {
      var completed = Object.keys(wordByChapter).length;
      setRing(completed, maxChapters);
      if (completed < maxChapters) {
        phaseTitle.textContent = "第 " + (completed + 1) + " 章正在写作";
      } else {
        phaseTitle.textContent = "第 " + completed + " 章已完成";
      }
      phaseSub.textContent = "已完成 " + completed + " / " + maxChapters + " 章 · " + total.toLocaleString("zh-CN") + " 字";
    }
  }

  function updatePhaseCopy(phase, event) {
    var chapter = typeof event.chapterNumber === "number" ? event.chapterNumber : null;
    if (phase === "queued") {
      phaseTitle.textContent = "任务已排队";
      phaseSub.textContent = "正在建立项目并准备模型请求";
    } else if (phase === "setup") {
      phaseTitle.textContent = "正在准备生成";
      phaseSub.textContent = "即将请求模型生成故事圣经";
    } else if (phase === "bible") {
      phaseTitle.textContent = "正在生成故事圣经";
      phaseSub.textContent = "人物、世界与核心冲突正在成形；长任务通常需要 1–3 分钟";
    } else if (phase === "outline") {
      phaseTitle.textContent = "正在生成章节大纲";
      phaseSub.textContent = "大纲完成后，去书架决定本次写多少章";
    } else if (phase === "write" && chapter !== null) {
      phaseTitle.textContent = "第 " + chapter + " 章 · 写作中";
      phaseSub.textContent = "模型正在生成本章正文";
    } else if (phase === "revise" && chapter !== null) {
      phaseTitle.textContent = "第 " + chapter + " 章 · 修订中";
      phaseSub.textContent = "根据审校意见改写本章";
    } else if (phase === "review" && chapter !== null) {
      phaseTitle.textContent = "第 " + chapter + " 章 · 审校中";
      phaseSub.textContent = "检查连贯性、节奏与角色一致性";
    } else if (phase === "state" && chapter !== null) {
      phaseTitle.textContent = "第 " + chapter + " 章 · 同步状态";
      phaseSub.textContent = "提取实体、关系与伏笔变化";
    } else if (phase === "graph") {
      phaseTitle.textContent = "同步知识图谱";
      phaseSub.textContent = "把本章事实写入人物与情节关系图";
    } else if (phase === "export") {
      phaseTitle.textContent = "正在整理手稿";
      phaseSub.textContent = "写入 book.md 与项目档案";
    } else if (phase === "abort") {
      phaseTitle.textContent = "正在停止";
      phaseSub.textContent = "等待当前模型调用结束";
    }
  }

  function setRunningUi(isRunning) {
    submitButton.disabled = isRunning;
    if (isRunning) submitButton.setAttribute("aria-busy", "true");
    else submitButton.removeAttribute("aria-busy");
    abortButton.hidden = !isRunning;
    abortButton.disabled = isRunning;
  }

  function failRun(message) {
    if (finished) return;
    finished = true;
    setStatus("failed");
    phaseTitle.textContent = "生成失败";
    phaseSub.textContent = String(message || "请检查模型配置后重试。");
    setRunningUi(false);
    stopElapsed();
    updateLastUpdate();
    closeSource();
    showRunError(String(message || "生成失败。"));
    if (currentView === "library") loadLibrary(true);
  }

  function finishRun() {
    if (finished) return;
    finished = true;
    setStatus("completed");
    statusText.textContent = "大纲就绪";
    phaseTitle.textContent = "大纲已就绪";
    phaseSub.textContent = "已规划 " + maxChapters + " 章，去书架决定本次写多少章";
    completeTimeline();
    setRing(0, maxChapters);
    setRunningUi(false);
    stopElapsed();
    updateLastUpdate();
    closeSource();
    if (projectId) loadOutlineResult(projectId);
    if (currentView === "library") loadLibrary(true);
  }

  function closeSource() {
    if (source) { source.close(); source = null; }
  }

  function reattachCreateRun(run) {
    if (!finished) return;
    runId = run.runId;
    projectId = run.projectId;
    finished = false;
    seenEvents = Object.create(null);
    resetProgress();
    setStatus("running");
    setRunningUi(true);
    var started = typeof run.startedAt === "string" ? Date.parse(run.startedAt) : NaN;
    startElapsed(Number.isFinite(started) ? started : Date.now());
    phaseTitle.textContent = run.projectTitle ? "正在生成《" + run.projectTitle + "》" : "已重新连接运行中的任务";
    phaseSub.textContent = "正在读取已有进度…";
    addEvent("已重新连接正在运行的任务 " + String(run.runId).slice(0, 8) + "，正在回放进度。", "network");
    api("/api/projects/" + encodeURIComponent(run.projectId)).then(function (payload) {
      var project = payload && payload.project ? payload.project : null;
      if (project && typeof project.maxChapters === "number") {
        maxChapters = project.maxChapters;
        setRing(Object.keys(wordByChapter).length, maxChapters);
      }
    }).catch(function (ignore) {});
    subscribe();
  }

  function reattachLibraryRun(run, retried) {
    if (libraryRunActive) return;
    var book = findBook(run.projectId);
    if (!book) {
      if (!retried) {
        loadLibrary(false).then(function () { reattachLibraryRun(run, true); });
      }
      return;
    }
    startLibraryRun({
      runId: run.runId,
      fromChapter: typeof run.fromChapter === "number" ? run.fromChapter : (book.firstUnwrittenChapter || 1),
      toChapter: typeof run.toChapter === "number" ? run.toChapter : book.plannedChapters,
      extended: !!run.extended
    }, book);
    addLibraryEvent("已重新连接正在运行的任务，正在回放进度。", "network");
  }

  function restoreActiveRun() {
    api("/api/runs?status=running&limit=5").then(function (payload) {
      var runs = payload && Array.isArray(payload.runs) ? payload.runs : [];
      if (runs.length === 0) return;
      var setupRun = null;
      var continuationRun = null;
      for (var index = 0; index < runs.length; index += 1) {
        if (runs[index].kind === "setup" && !setupRun) setupRun = runs[index];
        if (runs[index].kind === "continuation" && !continuationRun) continuationRun = runs[index];
      }
      if (currentView === "create" && finished && setupRun) reattachCreateRun(setupRun);
      if (currentView === "library" && !libraryRunActive && continuationRun) {
        reattachLibraryRun(continuationRun, false);
      }
    }).catch(function (ignore) {});
  }

  function loadOutlineResult(id) {
    var projectUrl = "/api/projects/" + encodeURIComponent(id);
    Promise.all([
      fetch(projectUrl).then(function (r) { return r.ok ? r.json() : null; }),
      fetch(projectUrl + "/toc").then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (responses) {
      var projectPayload = responses[0];
      var toc = responses[1];
      var project = projectPayload && projectPayload.project ? projectPayload.project : (projectPayload || {});
      if (!toc) throw new Error("大纲读取失败。");

      var lines = [];
      for (var v = 0; v < toc.volumes.length; v += 1) {
        var volume = toc.volumes[v];
        lines.push("【" + volume.title + "】" + (volume.summary || ""));
        for (var s = 0; s < volume.stages.length; s += 1) {
          var stage = volume.stages[s];
          lines.push("");
          lines.push("  " + stage.title + " — " + (stage.summary || ""));
          for (var c = 0; c < stage.chapters.length; c += 1) {
            var chapter = stage.chapters[c];
            lines.push("    " + chapter.title + "：" + chapter.summary);
          }
        }
        lines.push("");
      }

      maxChapters = toc.plannedChapters;
      resultEyebrow.textContent = "大纲已就绪";
      resultTitle.textContent = toc.title || project.premise || "未命名作品";
      resultChapters.textContent = String(toc.plannedChapters);
      resultWords.textContent = String(toc.writtenChapters);
      manuscriptLink.hidden = true;
      resultLibraryLink.hidden = false;
      projectLink.href = projectUrl;
      var preview = lines.join("\\n").trim();
      resultPreview.textContent = preview.length > 3000 ? preview.slice(0, 3000) + "\\n\\n…" : preview;
      setRing(toc.writtenChapters, toc.plannedChapters);
      phaseSub.textContent = "共 " + toc.plannedChapters + " 章大纲，去书架决定本次写多少章";
      resultPanel.hidden = false;
      resultPanel.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    }).catch(function (error) {
      addEvent("大纲结果加载失败：" + (error instanceof Error ? error.message : String(error)), "error");
    });
  }

  function handleEvent(event) {
    if (!event || typeof event.phase !== "string") return;
    var phase = event.phase;
    markEventTime(event);

    if (phase === "done") {
      addEvent(event.message || "手稿完成。", "done");
      markPhase("done");
      finishRun();
      return;
    }

    if (phase === "error") {
      var message = event.error || event.message || "生成失败。";
      addEvent(message, "error");
      markPhase("error");
      failRun(message);
      return;
    }

    if (typeof event.chapterNumber === "number") {
      if (typeof event.wordCount === "number") {
        wordByChapter[String(event.chapterNumber)] = event.wordCount;
      }
      updateChapterStats(event.chapterNumber);
    }

    updatePhaseCopy(phase, event);
    markPhase(phase);
    addEvent(event.message || phase, phase, event.durationMs);
  }

  function subscribe() {
    if (!runId) return;
    closeSource();
    source = new EventSource("/api/runs/" + encodeURIComponent(runId) + "/events");
    source.onmessage = function (messageEvent) {
      if (messageEvent.lastEventId) {
        if (seenEvents[messageEvent.lastEventId]) return;
        seenEvents[messageEvent.lastEventId] = true;
      }
      var payload;
      try { payload = JSON.parse(messageEvent.data); } catch (ignore) { return; }
      handleEvent(payload);
    };
    source.onerror = function () {
      if (finished) return;
      addEvent("SSE 连接中断，正在尝试恢复…", "network");
      window.setTimeout(function () {
        if (finished || !runId) return;
        api("/api/runs/" + encodeURIComponent(runId)).then(function (record) {
          if (finished) return;
          if (!record) {
            failRun("运行记录已丢失，请刷新页面重新查看。");
            return;
          }
          var events = Array.isArray(record.events) ? record.events : [];
          for (var index = 0; index < events.length; index += 1) {
            var key = String(index);
            if (seenEvents[key]) continue;
            seenEvents[key] = true;
            handleEvent(events[index]);
          }
        }).catch(function (error) {
          if (error && error.status === 404) {
            failRun("运行记录已丢失（服务可能已重启），请刷新页面后到书架继续。");
          }
        });
      }, 1000);
    };
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatBookDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function findBook(id) {
    for (var index = 0; index < books.length; index += 1) {
      if (books[index].id === id) return books[index];
    }
    return null;
  }

  function bookStatus(book) {
    if (!book.outlineReady) return { state: "idle", label: "未生成大纲" };
    if (book.status === "running") return { state: "running", label: "生成中" };
    if (book.firstUnwrittenChapter === null) {
      if (book.needsAttention > 0) {
        return { state: "warn", label: "待处理 " + book.needsAttention + " 章" };
      }
      return { state: "done", label: "已完成" };
    }
    var progress = book.writtenChapters + "/" + book.plannedChapters;
    if (book.writtenChapters === 0 && book.status !== "failed") {
      return { state: "idle", label: "大纲已就绪" };
    }
    if (book.status === "failed") return { state: "warn", label: "已中断 " + progress };
    return { state: "running", label: "写作中 " + progress };
  }

  function actionDisabled() {
    return libraryRunActive || !finished;
  }

  function setView(next, updateHash, bookId) {
    currentView = next;
    var isCreate = next === "create";
    var isLibrary = next === "library";
    var isGraph = next === "graph";
    if (isGraph && bookId) graphSelectedBookId = bookId;
    createView.hidden = !isCreate;
    libraryView.hidden = !isLibrary;
    graphView.hidden = !isGraph;
    viewTabCreate.classList.toggle("is-active", isCreate);
    viewTabLibrary.classList.toggle("is-active", isLibrary);
    viewTabGraph.classList.toggle("is-active", isGraph);
    [viewTabCreate, viewTabLibrary, viewTabGraph].forEach(function (tab) {
      tab.removeAttribute("aria-current");
    });
    if (isCreate) viewTabCreate.setAttribute("aria-current", "page");
    if (isLibrary) viewTabLibrary.setAttribute("aria-current", "page");
    if (isGraph) viewTabGraph.setAttribute("aria-current", "page");

    if (updateHash) {
      var hash = isLibrary ? "#library" : isCreate ? "#create" : "#graph";
      if (isGraph && graphSelectedBookId) {
        hash += "/" + encodeURIComponent(graphSelectedBookId);
      }
      if (window.location.hash !== hash) window.location.hash = hash;
    }
    if (isLibrary) {
      loadLibrary(false).then(restoreActiveRun);
    } else if (isCreate) {
      restoreActiveRun();
    }
    if (isGraph) loadGraphView();
  }

  function routeFromHash() {
    var hash = window.location.hash.replace(/^#/, "");
    if (hash === "library") return { view: "library", bookId: null };
    if (hash === "graph") return { view: "graph", bookId: null };
    if (hash.indexOf("graph/") === 0) {
      var encoded = hash.slice("graph/".length);
      var bookId = null;
      try { bookId = decodeURIComponent(encoded); } catch (ignore) { bookId = encoded; }
      return { view: "graph", bookId: bookId || null };
    }
    return { view: "create", bookId: null };
  }

  function loadLibrary(force) {
    if (libraryFetching && !force) return libraryPromise || Promise.resolve();
    libraryFetching = true;
    libraryError.hidden = true;
    libraryLoading.hidden = false;
    libraryEmpty.hidden = true;
    libraryPromise = api("/api/projects").then(function (payload) {
      libraryFetching = false;
      libraryLoading.hidden = true;
      books = payload && Array.isArray(payload.projects) ? payload.projects : [];
      renderBookList();
    }).catch(function (error) {
      libraryFetching = false;
      libraryLoading.hidden = true;
      libraryError.textContent = error instanceof Error ? error.message : String(error);
      libraryError.hidden = false;
    });
    return libraryPromise;
  }

  function renderBookList() {
    bookList.textContent = "";
    if (books.length > 0) {
      libraryCount.hidden = false;
      libraryCount.textContent = String(books.length);
    } else {
      libraryCount.hidden = true;
    }
    libraryEmpty.hidden = books.length > 0;
    for (var index = 0; index < books.length; index += 1) {
      bookList.appendChild(renderBookCard(books[index]));
    }
  }

  function renderBookCard(book) {
    var card = make("article", "book-card");
    card.setAttribute("data-book-id", book.id);

    var head = make("div", "book-head");
    var main = make("div", "book-main");
    var titleRow = make("div", "book-title-row");
    titleRow.appendChild(make("h2", "book-title", book.title));
    var status = bookStatus(book);
    var badge = make("span", "book-badge", status.label);
    badge.setAttribute("data-state", status.state);
    titleRow.appendChild(badge);
    main.appendChild(titleRow);
    main.appendChild(make("p", "book-premise", book.premise));

    var metaText = book.outlineReady
      ? book.writtenChapters + "/" + book.plannedChapters + " 章 · " +
        book.wordCount.toLocaleString("zh-CN") + " 字 · " + formatBookDate(book.createdAt)
      : "尚未生成大纲 · " + formatBookDate(book.createdAt);
    main.appendChild(make("div", "book-meta", metaText));

    var actions = make("div", "book-actions");
    var disabled = actionDisabled();

    if (book.outlineReady) {
      if (book.firstUnwrittenChapter !== null) {
        var continueButton = make("button", "btn-dark", "继续写作");
        continueButton.type = "button";
        continueButton.disabled = disabled;
        continueButton.addEventListener("click", function () {
          openContinue(book, { fromChapter: book.firstUnwrittenChapter });
        });
        actions.appendChild(continueButton);
      } else {
        var extendButton = make("button", "btn-dark", "续写新章节");
        extendButton.type = "button";
        extendButton.disabled = disabled || !book.canExtend;
        if (!book.canExtend) extendButton.title = "已达到单本章节上限";
        extendButton.addEventListener("click", function () {
          openContinue(book, { extension: true });
        });
        actions.appendChild(extendButton);
      }

      var tocButton = make("button", "btn-ghost", expandedBooks[book.id] ? "收起目录" : "展开目录");
      tocButton.type = "button";
      tocButton.setAttribute("data-action", "toggle-toc");
      tocButton.addEventListener("click", function () {
        toggleBookToc(book, card, tocButton);
      });
      actions.appendChild(tocButton);
    } else {
      actions.appendChild(make("span", "save-hint", "这本书还没有大纲，暂时不能续写。"));
    }

    if (book.outlineReady && book.writtenChapters > 0) {
      var readButton = make("button", "btn-ghost", "阅读");
      readButton.type = "button";
      readButton.disabled = disabled;
      readButton.addEventListener("click", function () { openReader(book, null); });
      actions.appendChild(readButton);
    }

    var historyButton = make("button", "btn-ghost", "运行记录");
    historyButton.type = "button";
    historyButton.addEventListener("click", function () { showLatestRun(book); });
    actions.appendChild(historyButton);

    if (book.outlineReady) {
      var graphButton = make("button", "btn-ghost", "图谱");
      graphButton.type = "button";
      graphButton.addEventListener("click", function () { setView("graph", true, book.id); });
      actions.appendChild(graphButton);
    }

    head.appendChild(main);
    head.appendChild(actions);
    card.appendChild(head);

    if (book.outlineReady && expandedBooks[book.id]) {
      var tocBox = make("div", "book-toc");
      card.appendChild(tocBox);
      renderBookToc(book, tocBox);
    }

    return card;
  }

  function bookTocChapters(toc) {
    var chapters = [];
    for (var v = 0; v < toc.volumes.length; v += 1) {
      var stages = toc.volumes[v].stages;
      for (var s = 0; s < stages.length; s += 1) {
        for (var c = 0; c < stages[s].chapters.length; c += 1) {
          chapters.push(stages[s].chapters[c]);
        }
      }
    }
    return chapters;
  }

  function loadBookToc(bookId, force) {
    if (!force && bookToc[bookId]) return Promise.resolve(bookToc[bookId]);
    return api("/api/projects/" + encodeURIComponent(bookId) + "/toc").then(function (payload) {
      bookToc[bookId] = payload;
      return payload;
    });
  }

  function toggleBookToc(book, card, button) {
    var expanded = !expandedBooks[book.id];
    expandedBooks[book.id] = expanded;
    button.textContent = expanded ? "收起目录" : "展开目录";
    var box = card.querySelector(".book-toc");
    if (!expanded) {
      if (box) box.remove();
      return;
    }
    if (!box) {
      box = make("div", "book-toc");
      card.appendChild(box);
    }
    renderBookToc(book, box);
  }

  function renderBookToc(book, box) {
    box.textContent = "";
    box.appendChild(make("div", "toc-loading", "正在读取目录…"));
    loadBookToc(book.id, false).then(function (toc) {
      box.textContent = "";
      if (!toc.outlineReady) {
        box.appendChild(make("div", "toc-loading", "这本书还没有生成章节大纲。"));
        return;
      }
      for (var v = 0; v < toc.volumes.length; v += 1) {
        box.appendChild(renderVolume(book, toc, toc.volumes[v]));
      }
    }).catch(function (error) {
      box.textContent = "";
      box.appendChild(make("div", "toc-loading", "目录读取失败：" + (error instanceof Error ? error.message : String(error))));
    });
  }

  function renderVolume(book, toc, volume) {
    var group = make("div", "tree-group");
    var toggle = make("button", "tree-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "true");
    toggle.appendChild(make("span", "caret", "▾"));
    toggle.appendChild(make("span", "tree-title", volume.title));
    if (volume.summary) toggle.appendChild(make("span", "tree-summary", volume.summary));
    var children = make("div", "tree-children");
    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      children.hidden = expanded;
    });
    group.appendChild(toggle);
    group.appendChild(children);
    for (var s = 0; s < volume.stages.length; s += 1) {
      children.appendChild(renderStage(book, toc, volume.stages[s]));
    }
    return group;
  }

  function renderStage(book, toc, stage) {
    var group = make("div", "tree-stage");
    var toggle = make("button", "tree-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "true");
    toggle.appendChild(make("span", "caret", "▾"));
    toggle.appendChild(make("span", "tree-title", stage.title));
    if (stage.summary) toggle.appendChild(make("span", "tree-summary", stage.summary));
    var list = make("ul", "chapter-list");
    toggle.addEventListener("click", function () {
      var expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      list.hidden = expanded;
    });
    group.appendChild(toggle);
    group.appendChild(list);
    for (var c = 0; c < stage.chapters.length; c += 1) {
      list.appendChild(renderChapterRow(book, toc, stage.chapters[c]));
    }
    return group;
  }

  function renderChapterRow(book, toc, chapter) {
    var row = make("li", "chapter-row");
    row.appendChild(make("span", "chapter-no", "第" + chapter.number + "章"));

    var name = make("button", "chapter-name", chapter.title);
    name.type = "button";
    name.disabled = !chapter.hasText || actionDisabled();
    if (chapter.hasText) {
      name.addEventListener("click", function () { openReader(book, chapter.number); });
    }
    row.appendChild(name);

    var statusText = chapter.status === "written"
      ? chapter.wordCount.toLocaleString("zh-CN") + " 字"
      : chapter.status === "needs_attention" ? "待处理" : "未写";
    var stat = make("span", "chapter-stat", statusText);
    stat.setAttribute("data-state", chapter.status);
    row.appendChild(stat);

    var actions = make("div", "chapter-actions");
    if (chapter.hasText) {
      var read = make("button", "link-btn", "阅读");
      read.type = "button";
      read.disabled = actionDisabled();
      read.addEventListener("click", function () { openReader(book, chapter.number); });
      actions.appendChild(read);
    }
    var write = make("button", "link-btn", "从此章续写");
    write.type = "button";
    write.disabled = actionDisabled();
    write.addEventListener("click", function () {
      openContinue(book, { fromChapter: chapter.number, toc: toc });
    });
    actions.appendChild(write);
    row.appendChild(actions);

    return row;
  }

  function writeCountLimit(state) {
    if (state.extension) return state.outlineCount;
    return Math.max(0, state.planned - state.fromChapter + 1);
  }

  function openContinue(book, options) {
    if (actionDisabled()) {
      libraryError.textContent = "已有生成任务在运行，请等待完成或先停止。";
      libraryError.hidden = false;
      return;
    }
    libraryError.hidden = true;
    continueError.hidden = true;
    continueConfirm.disabled = false;
    continueConfirm.textContent = options.extension ? "扩展并续写" : "开始续写";

    var toc = options.toc || bookToc[book.id] || null;
    var extension = Boolean(options.extension);
    var fromChapter = extension ? book.plannedChapters + 1 : (options.fromChapter || 1);
    var remaining = extension ? 6 : Math.max(1, book.plannedChapters - fromChapter + 1);
    var writeCount = Math.min(6, remaining);

    continueState = {
      book: book,
      toc: toc,
      fromChapter: fromChapter,
      extension: extension,
      planned: book.plannedChapters,
      chapterWords: book.chapterWords || 0,
      outlineCount: 6,
      writeCount: writeCount
    };

    continueExtension.hidden = !extension;
    continueBatch.hidden = false;
    continueChapters.value = String(writeCount);
    continueChapters.max = String(writeCountLimit(continueState));
    if (extension) continueCount.value = "6";
    renderContinueCopy(continueState);

    document.getElementById("continue-sub").textContent = "《" + book.title + "》 · 使用当前全局模型配置";
    continueOverlay.hidden = false;
    continueDialog.hidden = false;
    document.body.classList.add("drawer-open");
    requestAnimationFrame(function () {
      continueOverlay.classList.add("is-open");
      continueDialog.classList.add("is-open");
      continueConfirm.focus();
    });

    if (!extension && !toc) {
      loadBookToc(book.id, false).then(function (payload) {
        if (!continueState || continueState.book.id !== book.id) return;
        continueState.toc = payload;
        renderContinueCopy(continueState);
      }).catch(function () {
        // The confirmation still works without the overwrite breakdown.
      });
    }
  }

  function renderContinueCopy(state) {
    var limit = writeCountLimit(state);
    if (!Number.isFinite(state.writeCount)) state.writeCount = 1;
    state.writeCount = Math.min(limit, Math.max(1, state.writeCount));
    continueChapters.value = String(state.writeCount);
    continueChapters.max = String(limit);

    var endChapter = state.fromChapter + state.writeCount - 1;
    var words = state.chapterWords > 0 ? state.writeCount * state.chapterWords : 0;
    continueBatchEstimate.textContent = "第 " + state.fromChapter + "–" + endChapter + " 章" +
      (words > 0 ? " · 约 " + words.toLocaleString("zh-CN") + " 字" : "");

    if (state.extension) {
      continueCopy.textContent = "当前大纲的 " + state.planned +
        " 章已经全部写完。本次追加 " + state.outlineCount +
        " 章新大纲，并先写其中的 " + state.writeCount +
        " 章（第 " + state.fromChapter + "–" + endChapter + " 章）。";
      var total = state.planned + state.outlineCount;
      var outlineWords = state.chapterWords > 0 ? state.outlineCount * state.chapterWords : 0;
      continueEstimate.textContent = "完成后大纲共 " + total + " 章" +
        (outlineWords > 0 ? "，新增大纲约 " + outlineWords.toLocaleString("zh-CN") + " 字" : "");
      return;
    }

    var overwrite = 0;
    if (state.toc) {
      var chapters = bookTocChapters(state.toc);
      for (var index = 0; index < chapters.length; index += 1) {
        var number = chapters[index].number;
        if (number >= state.fromChapter && number <= endChapter && chapters[index].hasText) {
          overwrite += 1;
        }
      }
    }
    continueCopy.textContent = "从第 " + state.fromChapter + " 章开始，本次写 " +
      state.writeCount + " 章（第 " + state.fromChapter + "–" + endChapter + " 章）。" +
      (overwrite > 0
        ? "其中 " + overwrite + " 章已有正文，会被重新生成并覆盖。"
        : "这一段还没有正文，会从这里开始补写。");
  }

  function updateContinueBatch() {
    if (!continueState) return;
    var value = parseInt(continueChapters.value, 10);
    if (!Number.isFinite(value)) value = 1;
    continueState.writeCount = value;
    renderContinueCopy(continueState);
  }

  function updateContinueEstimate() {
    if (!continueState || !continueState.extension) return;
    var count = parseInt(continueCount.value, 10);
    if (!Number.isFinite(count)) count = 6;
    count = Math.min(20, Math.max(1, count));
    continueCount.value = String(count);
    continueState.outlineCount = count;
    renderContinueCopy(continueState);
  }

  function closeContinue() {
    if (!continueState) return;
    continueState = null;
    continueOverlay.classList.remove("is-open");
    continueDialog.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    setTimeout(function () {
      continueOverlay.hidden = true;
      continueDialog.hidden = true;
    }, 180);
  }

  function submitContinue() {
    if (!continueState) return;
    var state = continueState;
    var body;

    if (state.extension) {
      var outlineCount = parseInt(continueCount.value, 10);
      if (!Number.isFinite(outlineCount) || outlineCount < 1 || outlineCount > 20) {
        continueError.textContent = "追加大纲章数必须在 1 到 20 之间。";
        continueError.hidden = false;
        return;
      }
      state.outlineCount = outlineCount;
    }

    renderContinueCopy(state);
    var writeCount = state.writeCount;
    if (!Number.isFinite(writeCount) || writeCount < 1) {
      continueError.textContent = "本次写作章数至少为 1。";
      continueError.hidden = false;
      return;
    }

    if (state.extension) {
      body = {
        additionalChapters: state.outlineCount,
        chapterCount: writeCount
      };
    } else {
      body = {
        fromChapter: state.fromChapter,
        chapterCount: writeCount
      };
    }

    continueConfirm.disabled = true;
    continueConfirm.textContent = state.extension ? "正在扩展…" : "正在提交…";
    continueError.hidden = true;

    api("/api/projects/" + encodeURIComponent(state.book.id) + "/continue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (payload) {
      closeContinue();
      startLibraryRun(payload, state.book);
    }).catch(function (error) {
      continueConfirm.disabled = false;
      continueConfirm.textContent = state.extension ? "扩展并续写" : "开始续写";
      continueError.textContent = error && error.code === "model_not_configured"
        ? "请先在全局设置中完成模型配置。"
        : (error instanceof Error ? error.message : String(error));
      continueError.hidden = false;
    });
  }

  function addLibraryEvent(message, phase, durationMs) {
    var empty = libraryLog.querySelector(".log-empty");
    if (empty) empty.parentNode.removeChild(empty);
    var item = make("li", "event-item");
    item.appendChild(make("time", "", new Date().toLocaleTimeString("zh-CN", { hour12: false })));
    item.appendChild(make("em", "", PHASE_LABEL[phase] || String(phase || "info").toUpperCase()));
    item.appendChild(make("span", "", String(message || "")));
    var duration = formatDuration(durationMs);
    if (duration) item.appendChild(make("span", "event-duration", "（" + duration + "）"));
    libraryLog.appendChild(item);
    while (libraryLog.querySelectorAll(".event-item").length > 400) {
      var first = libraryLog.querySelector(".event-item");
      if (!first) break;
      first.parentNode.removeChild(first);
    }
    libraryLog.scrollTop = libraryLog.scrollHeight;
  }

  function resetLibraryLog(message) {
    libraryLog.textContent = "";
    var empty = make("li", "log-empty", message || "等待开始。");
    empty.id = "library-log-empty";
    libraryLog.appendChild(empty);
  }

  function startLibraryRun(payload, book) {
    libraryRunId = payload.runId;
    libraryRunActive = true;
    libraryRunBook = book;
    libraryRunFrom = payload.fromChapter;
    libraryRunTo = payload.toChapter;
    libraryRunWords = 0;
    librarySeenEvents = Object.create(null);

    libraryRun.hidden = false;
    libraryStatus.setAttribute("data-state", "running");
    libraryStatusText.textContent = payload.extended ? "扩展大纲中" : "续写中";
    libraryRunTitle.textContent = "正在续写《" + book.title + "》";
    libraryRunSub.textContent = "从第 " + payload.fromChapter + " 章开始";
    libraryProgress.textContent = "第 " + Math.max(0, payload.fromChapter - 1) + "/" + payload.toChapter + " 章";
    libraryAbort.hidden = false;
    libraryAbort.disabled = false;
    libraryError.hidden = true;
    resetLibraryLog("已提交续写请求，正在读取既有章节…");
    renderBookList();
    submitButton.disabled = true;

    subscribeLibrary();
    libraryRun.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
  }

  function subscribeLibrary() {
    if (!libraryRunId) return;
    closeSource();
    source = new EventSource("/api/runs/" + encodeURIComponent(libraryRunId) + "/events");
    source.onmessage = function (messageEvent) {
      if (messageEvent.lastEventId) {
        if (librarySeenEvents[messageEvent.lastEventId]) return;
        librarySeenEvents[messageEvent.lastEventId] = true;
      }
      var payload;
      try { payload = JSON.parse(messageEvent.data); } catch (ignore) { return; }
      handleLibraryEvent(payload);
    };
    source.onerror = function () {
      if (!libraryRunActive) return;
      addLibraryEvent("SSE 连接中断，正在尝试恢复…", "network");
      window.setTimeout(function () {
        if (!libraryRunActive || !libraryRunId) return;
        api("/api/runs/" + encodeURIComponent(libraryRunId)).then(function (record) {
          if (!libraryRunActive) return;
          if (!record) {
            failLibraryRun("运行记录已丢失，请刷新页面后重试。");
            return;
          }
          var events = Array.isArray(record.events) ? record.events : [];
          for (var index = 0; index < events.length; index += 1) {
            var key = String(index);
            if (librarySeenEvents[key]) continue;
            librarySeenEvents[key] = true;
            handleLibraryEvent(events[index]);
          }
        }).catch(function (error) {
          if (error && error.status === 404) {
            failLibraryRun("运行记录已丢失（服务可能已重启），请刷新页面后重试。");
          }
        });
      }, 1000);
    };
  }

  function handleLibraryEvent(event) {
    if (!event || typeof event.phase !== "string") return;
    var phase = event.phase;
    if (phase === "done") {
      addLibraryEvent(event.message || "续写完成。", "done");
      finishLibraryRun();
      return;
    }
    if (phase === "error") {
      var message = event.error || event.message || "续写失败。";
      addLibraryEvent(message, "error");
      failLibraryRun(message);
      return;
    }
    if (typeof event.chapterNumber === "number") {
      libraryProgress.textContent = "第 " + event.chapterNumber + "/" + libraryRunTo + " 章";
    }
    if (typeof event.wordCount === "number") {
      libraryRunWords += event.wordCount;
      libraryRunSub.textContent = "本次新增 " + libraryRunWords.toLocaleString("zh-CN") + " 字";
    }
    if (event.phase === "write" && typeof event.chapterNumber === "number") {
      libraryRunSub.textContent = "正在写第 " + event.chapterNumber + " 章 · 本次新增 " + libraryRunWords.toLocaleString("zh-CN") + " 字";
    }
    if (event.phase === "review" || event.phase === "revise" || event.phase === "state") {
      libraryRunSub.textContent = "第 " + (event.chapterNumber || libraryRunFrom) + " 章 · " + (PHASE_LABEL[event.phase] || event.phase) + "中";
    }
    addLibraryEvent(event.message || phase, phase, event.durationMs);
  }

  function finishLibraryRun() {
    libraryRunActive = false;
    libraryRunId = null;
    libraryStatus.setAttribute("data-state", "completed");
    libraryStatusText.textContent = "本次完成";
    libraryRunTitle.textContent = "《" + (libraryRunBook ? libraryRunBook.title : "本书") + "》本批写作完成";
    libraryRunSub.textContent = "本次新增 " + libraryRunWords.toLocaleString("zh-CN") + " 字";
    libraryProgress.textContent = "第 " + libraryRunTo + "/" + libraryRunTo + " 章";
    libraryAbort.hidden = true;
    closeSource();
    submitButton.disabled = false;
    if (libraryRunBook) delete bookToc[libraryRunBook.id];
    loadLibrary(true);
  }

  function failLibraryRun(message) {
    libraryRunActive = false;
    libraryRunId = null;
    libraryStatus.setAttribute("data-state", "failed");
    libraryStatusText.textContent = "已中断";
    libraryRunTitle.textContent = "续写未完成";
    libraryRunSub.textContent = "已生成的章节会保留，可以稍后继续。";
    libraryAbort.hidden = true;
    closeSource();
    submitButton.disabled = false;
    if (libraryRunBook) delete bookToc[libraryRunBook.id];
    loadLibrary(true).then(function () {
      libraryError.textContent = String(message || "续写失败。");
      libraryError.hidden = false;
    });
  }

  function showLatestRun(book) {
    if (libraryRunActive) {
      libraryError.textContent = "已有续写任务在运行，请等待完成或先停止。";
      libraryError.hidden = false;
      return;
    }
    libraryError.hidden = true;
    api("/api/runs?projectId=" + encodeURIComponent(book.id) + "&limit=1").then(function (payload) {
      var run = payload && Array.isArray(payload.runs) ? payload.runs[0] : null;
      if (!run) {
        libraryError.textContent = "这本书还没有可查看的运行记录。";
        libraryError.hidden = false;
        return;
      }
      if (run.status === "running") {
        reattachLibraryRun(run, false);
        return;
      }
      return api("/api/runs/" + encodeURIComponent(run.runId)).then(function (record) {
        showLibraryRunRecord(book, record || run);
      });
    }).catch(function (error) {
      libraryError.textContent = error instanceof Error ? error.message : String(error);
      libraryError.hidden = false;
    });
  }

  function showLibraryRunRecord(book, record) {
    var failed = record.status === "failed";
    var started = record.startedAt ? Date.parse(record.startedAt) : NaN;
    var updated = record.updatedAt ? Date.parse(record.updatedAt) : NaN;
    var duration = Number.isFinite(started) && Number.isFinite(updated) ? updated - started : undefined;
    var when = Number.isFinite(started)
      ? new Date(started).toLocaleString("zh-CN", { hour12: false })
      : "";

    libraryRun.hidden = false;
    libraryStatus.setAttribute("data-state", failed ? "failed" : "completed");
    libraryStatusText.textContent = failed ? "运行失败" : "运行完成";
    libraryRunTitle.textContent = "《" + book.title + "》最近一次运行";
    libraryRunSub.textContent = when + (duration === undefined ? "" : " · 用时 " + formatDuration(duration));
    libraryProgress.textContent = record.kind === "continuation"
      ? "第 " + (record.fromChapter || 0) + "/" + (record.toChapter || 0) + " 章"
      : (record.status === "completed" ? "大纲就绪" : "准备阶段");
    libraryAbort.hidden = true;
    resetLibraryLog("运行记录：共 " + (Array.isArray(record.events) ? record.events.length : 0) + " 条事件。");
    if (Array.isArray(record.events)) {
      for (var index = 0; index < record.events.length; index += 1) {
        var event = record.events[index];
        addLibraryEvent(event.message || event.phase, event.phase, event.durationMs);
      }
    }
    libraryError.hidden = true;
    if (failed) {
      libraryError.textContent = String(record.error || record.lastMessage || "任务失败。");
      libraryError.hidden = false;
    }
    libraryRun.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
  }

  function openReader(book, chapterNumber) {
    var tocPromise = loadBookToc(book.id, false);
    tocPromise.then(function (toc) {
      var chapters = bookTocChapters(toc).filter(function (chapter) {
        return chapter.hasText;
      });
      if (chapters.length === 0) {
        libraryError.textContent = "这本书还没有可以阅读的章节。";
        libraryError.hidden = false;
        return;
      }
      var target = chapters[0].number;
      if (typeof chapterNumber === "number") target = chapterNumber;
      var index = 0;
      for (var i = 0; i < chapters.length; i += 1) {
        if (chapters[i].number === target) { index = i; break; }
      }
      openReaderAt(book, toc, chapters, index);
    }).catch(function (error) {
      libraryError.textContent = error instanceof Error ? error.message : String(error);
      libraryError.hidden = false;
    });
  }

  function openReaderAt(book, toc, chapters, index) {
    if (index < 0 || index >= chapters.length) return;
    var chapter = chapters[index];
    api("/api/projects/" + encodeURIComponent(book.id) + "/chapters/" + chapter.number)
      .then(function (payload) {
        readerState = {
          book: book,
          toc: toc,
          chapters: chapters,
          index: index
        };
        readerTitle.textContent = payload.title || ("第" + chapter.number + "章");
        readerMeta.textContent = "第 " + chapter.number + " 章 · " +
          (payload.wordCount || 0).toLocaleString("zh-CN") + " 字";
        readerText.textContent = String(payload.text || "").trim();
        readerPosition.textContent = (index + 1) + "/" + chapters.length;
        readerPrev.disabled = index <= 0;
        readerNext.disabled = index >= chapters.length - 1;
        readerOverlay.hidden = false;
        readerDrawer.hidden = false;
        document.body.classList.add("drawer-open");
        requestAnimationFrame(function () {
          readerOverlay.classList.add("is-open");
          readerDrawer.classList.add("is-open");
          readerClose.focus();
        });
      }).catch(function (error) {
        libraryError.textContent = "章节读取失败：" + (error instanceof Error ? error.message : String(error));
        libraryError.hidden = false;
      });
  }

  function closeReader() {
    if (!readerState) return;
    readerState = null;
    readerOverlay.classList.remove("is-open");
    readerDrawer.classList.remove("is-open");
    document.body.classList.remove("drawer-open");
    setTimeout(function () {
      readerOverlay.hidden = true;
      readerDrawer.hidden = true;
    }, 180);
  }

  function graphKindLabel(kind) {
    var labels = {
      character: "人物",
      event: "事件",
      thread: "情节线",
      location: "地点",
      item: "物品",
      concept: "概念",
      faction: "阵营",
      chapter: "章节",
      book: "书"
    };
    return labels[kind] || kind;
  }

  function graphKindAllowed(kind) {
    var input = graphKindInputs[kind];
    return input ? input.checked : true;
  }

  function renderGraphBookList() {
    graphBookList.textContent = "";
    if (books.length === 0) {
      graphBookList.appendChild(make("p", "graph-detail-empty", "书架还是空的，先去创作一本。"));
      return;
    }
    for (var index = 0; index < books.length; index += 1) {
      var book = books[index];
      var button = make("button", "graph-book-item" + (book.id === graphSelectedBookId ? " is-active" : ""));
      button.type = "button";
      button.appendChild(make("b", "", book.title));
      button.appendChild(make("span", "", book.writtenChapters + "/" + book.plannedChapters + " 章" +
        (book.outlineReady ? "" : " · 未生成大纲")));
      button.addEventListener("click", function (current) {
        return function () { selectGraphBook(current); };
      }(book));
      graphBookList.appendChild(button);
    }
  }

  function showGraphUnavailable(message) {
    if (graphCy) {
      graphCy.destroy();
      graphCy = null;
    }
    graphUnavailable.textContent = message;
    graphUnavailable.hidden = false;
    graphStatus.textContent = "";
    graphNodeCount.textContent = "0";
    graphEdgeCount.textContent = "0";
    clearGraphDetail();
  }

  function selectGraphBook(book) {
    graphSelectedBookId = book.id;
    graphPageSub.textContent = "《" + book.title + "》 · 已写 " + book.writtenChapters + "/" +
      book.plannedChapters + " 章";
    renderGraphBookList();
    var hash = "#graph/" + encodeURIComponent(book.id);
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
    if (!book.outlineReady) {
      showGraphUnavailable("这本书还没有章节大纲，先完成大纲生成后再查看图谱。");
      return;
    }
    loadGraphForBook(book);
  }

  function loadGraphView() {
    graphError.hidden = true;
    if (books.length === 0) {
      loadLibrary(false).then(function () {
        renderGraphBookList();
        pickGraphBook();
      }).catch(function (error) {
        showGraphUnavailable("书架读取失败：" + (error instanceof Error ? error.message : String(error)));
      });
      return;
    }
    renderGraphBookList();
    pickGraphBook();
  }

  function pickGraphBook() {
    if (books.length === 0) {
      graphSelectedBookId = null;
      graphPageSub.textContent = "书架还是空的，先去创作一本，再回来查看知识图谱。";
      showGraphUnavailable("书架还是空的。生成大纲并写几章后，这里会出现人物关系与情节线索图。");
      return;
    }

    var selected = null;
    if (graphSelectedBookId) {
      for (var i = 0; i < books.length; i += 1) {
        if (books[i].id === graphSelectedBookId) selected = books[i];
      }
    }
    if (!selected) {
      for (var j = 0; j < books.length; j += 1) {
        if (books[j].outlineReady) { selected = books[j]; break; }
      }
    }
    if (!selected) selected = books[0];
    if (!selected) return;

    if (!selected.outlineReady) {
      graphSelectedBookId = selected.id;
      graphPageSub.textContent = "《" + selected.title + "》还没有生成章节大纲。";
      renderGraphBookList();
      showGraphUnavailable("这本书还没有章节大纲，先完成大纲生成后再查看图谱。");
      return;
    }

    selectGraphBook(selected);
  }

  function loadGraphForBook(book) {
    var requestSeq = ++graphRequestSeq;
    graphSelectedBookId = book.id;
    graphError.hidden = true;
    graphUnavailable.hidden = false;
    graphUnavailable.textContent = "正在从 Neo4j 读取并重建图谱…";
    graphStatus.textContent = "loading…";
    clearGraphDetail();
    if (graphCy) {
      graphCy.destroy();
      graphCy = null;
    }

    api("/api/projects/" + encodeURIComponent(book.id) + "/graph")
      .then(function (payload) {
        if (requestSeq !== graphRequestSeq) return;
        if (!payload || !payload.available) {
          showGraphUnavailable("知识图谱暂不可用：" +
            (payload && payload.reason ? payload.reason : "Neo4j 未连接"));
          return;
        }
        renderGraph(book, payload);
      })
      .catch(function (error) {
        if (requestSeq !== graphRequestSeq) return;
        graphError.textContent = "知识图谱读取失败：" + (error instanceof Error ? error.message : String(error));
        graphError.hidden = false;
        showGraphUnavailable("知识图谱读取失败，请检查 Neo4j 是否运行。");
      });
  }

  function graphElements(payload) {
    var nodeIds = Object.create(null);
    var nodes = [];
    for (var i = 0; i < payload.nodes.length; i += 1) {
      var node = payload.nodes[i];
      if (node.kind === "book") continue;
      nodeIds[node.id] = true;
      var raw = node.data || {};
      nodes.push({
        data: {
          id: node.id,
          label: node.kind === "chapter" ? "第" + node.chapter + "章" : node.name,
          name: node.name,
          kind: node.kind,
          status: node.status || "",
          chapter: typeof node.chapter === "number" ? node.chapter : null,
          setupChapter: typeof raw.setupChapter === "number" ? raw.setupChapter : null,
          payoffChapter: typeof raw.payoffChapter === "number" ? raw.payoffChapter : null,
          raw: raw
        },
        classes: "kind-" + node.kind
      });
    }

    var edges = [];
    for (var j = 0; j < payload.edges.length; j += 1) {
      var edge = payload.edges[j];
      if (!nodeIds[edge.source] || !nodeIds[edge.target]) continue;
      var edgeRaw = edge.data || {};
      var label = edge.kind === "relation"
        ? String(edgeRaw.relationshipKind || "关系")
        : "";
      edges.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: label,
          kind: edge.kind,
          description: edge.description || "",
          fromChapter: typeof edge.fromChapter === "number" ? edge.fromChapter : null,
          toChapter: typeof edge.toChapter === "number" ? edge.toChapter : null,
          evidenceChapter: typeof edge.evidenceChapter === "number" ? edge.evidenceChapter : null,
          status: edge.status || "",
          raw: edgeRaw
        },
        classes: "edge-" + edge.kind
      });
    }

    return nodes.concat(edges);
  }

  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          "background-color": "#6f746e",
          "border-width": 2,
          "border-color": "#ffffff",
          width: 24,
          height: 24,
          label: "data(label)",
          color: "#3c4147",
          "font-size": 9.5,
          "font-family": "PingFang SC, Microsoft YaHei, sans-serif",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 5,
          "text-wrap": "ellipsis",
          "text-max-width": 90,
          "overlay-opacity": 0
        }
      },
      {
        selector: 'node[kind="character"]',
        style: { "background-color": "#1f5b4e", width: 34, height: 34, "font-size": 10.5, "font-weight": 600 }
      },
      {
        selector: 'node[kind="event"]',
        style: { "background-color": "#d9603f", shape: "diamond", width: 24, height: 24, "font-size": 8.5 }
      },
      {
        selector: 'node[kind="thread"]',
        style: { "background-color": "#b07b2a", shape: "hexagon", width: 30, height: 30, "font-size": 9.5 }
      },
      {
        selector: 'node[kind="location"]',
        style: { "background-color": "#2f6f8a", shape: "round-rectangle", width: 26, height: 22 }
      },
      {
        selector: 'node[kind="item"]',
        style: { "background-color": "#8a7a45", shape: "triangle", width: 20, height: 20 }
      },
      {
        selector: 'node[kind="concept"]',
        style: { "background-color": "#6b5b95", shape: "ellipse", width: 22, height: 22 }
      },
      {
        selector: 'node[kind="faction"]',
        style: { "background-color": "#6f6f63", shape: "round-tag", width: 30, height: 22 }
      },
      {
        selector: 'node[kind="chapter"]',
        style: { "background-color": "#9b9b90", shape: "round-rectangle", width: 18, height: 18, label: "", "font-size": 8 }
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#c9cbc3",
          "target-arrow-color": "#c9cbc3",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "curve-style": "bezier",
          opacity: 0.55,
          "overlay-opacity": 0
        }
      },
      {
        selector: 'edge[kind="relation"]',
        style: { width: 1.7, "line-color": "#1f5b4e", "target-arrow-color": "#1f5b4e", opacity: 0.82 }
      },
      {
        selector: 'edge[status="ended"]',
        style: { "line-style": "dashed", opacity: 0.35 }
      },
      {
        selector: 'edge[kind="thread_setup_in"], edge[kind="thread_payoff_in"], edge[kind="thread_advanced_in"]',
        style: { "line-color": "#b07b2a", "target-arrow-color": "#b07b2a", "line-style": "dashed", opacity: 0.55 }
      },
      {
        selector: 'edge[kind="event_involves"], edge[kind="event_in_chapter"], edge[kind="event_location"]',
        style: { "line-color": "#d9603f", "target-arrow-color": "#d9603f", opacity: 0.35 }
      },
      {
        selector: 'edge[kind="located_at"]',
        style: { "line-color": "#2f6f8a", "target-arrow-color": "#2f6f8a", "line-style": "dotted", opacity: 0.5 }
      },
      {
        selector: 'edge[kind="appears_in"], edge[kind="chapter_follows"]',
        style: { "line-color": "#cfcfc7", "target-arrow-color": "#cfcfc7", opacity: 0.28 }
      },
      {
        selector: "edge:selected",
        style: {
          label: "data(label)",
          "font-size": 9,
          color: "#1f5b4e",
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.85,
          "text-background-padding": "2px",
          "text-rotation": "autorotate",
          opacity: 1
        }
      },
      { selector: ".graph-hidden", style: { display: "none" } },
      { selector: ".graph-dim", style: { opacity: 0.1 } },
      {
        selector: "node:selected",
        style: { "border-width": 4, "border-color": "#d9603f", "overlay-opacity": 0 }
      }
    ];
  }

  function renderGraph(book, payload) {
    graphData = payload;
    graphUnavailable.hidden = true;
    graphPageSub.textContent = "《" + book.title + "》 · 已写 " + payload.book.writtenChapters +
      "/" + payload.book.plannedChapters + " 章";
    graphStatus.textContent = payload.graph || "";
    if (typeof window.cytoscape !== "function") {
      showGraphUnavailable("Cytoscape 资源加载失败，请检查 /vendor/cytoscape.min.js。");
      return;
    }

    var maxChapter = Math.max(0, payload.book.writtenChapters || 0);
    graphChapterMax = maxChapter;
    graphChapterRange.min = "0";
    graphChapterRange.max = String(maxChapter);
    graphChapterRange.value = String(maxChapter);
    graphChapterRange.disabled = maxChapter === 0;
    graphChapterLabel.textContent = maxChapter > 0 ? "第 1–" + maxChapter + " 章" : "仅设定";

    var elements = graphElements(payload);
    graphCy = window.cytoscape({
      container: graphCanvas,
      elements: elements,
      style: graphStyle(),
      layout: { name: "preset" },
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.2
    });

    graphCy.on("tap", "node", function (event) {
      showGraphNodeDetail(event.target);
      highlightGraph(event.target);
    });
    graphCy.on("tap", "edge", function (event) {
      showGraphEdgeDetail(event.target);
      highlightGraph(event.target);
    });
    graphCy.on("tap", function (event) {
      if (event.target === graphCy) clearGraphDetail();
    });
    graphCy.on("dbltap", "node", function (event) {
      graphCy.fit(event.target.closedNeighborhood(), 60);
    });

    applyGraphFilters(true);
  }

  function graphLayoutOptions() {
    var name = graphLayout.value;
    if (name === "concentric") {
      var rank = { character: 5, thread: 4, event: 3, location: 3, faction: 2, item: 1, concept: 1, chapter: 0 };
      return {
        name: "concentric",
        animate: false,
        padding: 35,
        minNodeSpacing: 35,
        levelWidth: function () { return 2; },
        concentric: function (node) { return rank[node.data("kind")] || 1; }
      };
    }
    if (name === "breadthfirst") {
      var roots = graphCy.nodes('[kind="chapter"][chapter="1"]').filter(":visible");
      if (roots.length === 0) roots = graphCy.elements(":visible").nodes().filter('[kind="character"]').slice(0, 1);
      var options = {
        name: "breadthfirst",
        directed: true,
        animate: false,
        padding: 35,
        spacingFactor: 1.15
      };
      if (roots.length > 0) options.roots = roots;
      return options;
    }
    return {
      name: "cose",
      animate: false,
      padding: 35,
      idealEdgeLength: 95,
      nodeRepulsion: 9000,
      gravity: 0.28,
      numIter: 700,
      randomize: true
    };
  }

  function runGraphLayout(fitAfter) {
    if (!graphCy) return;
    var visible = graphCy.elements(":visible");
    if (visible.length === 0) return;
    visible.layout(graphLayoutOptions()).run();
    if (fitAfter) {
      setTimeout(function () {
        if (graphCy) graphCy.fit(undefined, 40);
      }, 0);
    }
  }

  function applyGraphFilters(relayout) {
    if (!graphCy) return;
    var cutoff = parseInt(graphChapterRange.value, 10);
    if (!Number.isFinite(cutoff)) cutoff = 0;
    var showChapters = graphShowChapters.checked;
    var showHistory = graphShowHistory.checked;
    var query = graphSearch.value.trim().toLowerCase();
    var hiddenNodeIds = Object.create(null);
    var visibleNodes = 0;
    var visibleEdges = 0;

    graphCy.batch(function () {
      graphCy.nodes().forEach(function (node) {
        var kind = node.data("kind");
        var hidden = false;
        if (!graphKindAllowed(kind)) hidden = true;
        if (kind === "chapter" && !showChapters) hidden = true;
        if (!hidden && node.data("chapter") !== null && node.data("chapter") > cutoff) hidden = true;
        if (!hidden && kind === "thread" && node.data("setupChapter") !== null && node.data("setupChapter") > cutoff) hidden = true;
        if (hidden) hiddenNodeIds[node.id()] = true;
        else visibleNodes += 1;
        node.toggleClass("graph-hidden", hidden);
      });

      graphCy.edges().forEach(function (edge) {
        var hidden = false;
        if (!showHistory && edge.data("status") === "ended") hidden = true;
        if (!showChapters && (edge.data("kind") === "appears_in" || edge.data("kind") === "chapter_follows")) hidden = true;
        if (!hidden && edge.data("fromChapter") !== null && edge.data("fromChapter") > cutoff) hidden = true;
        if (hiddenNodeIds[edge.source().id()] || hiddenNodeIds[edge.target().id()]) hidden = true;
        if (!hidden) visibleEdges += 1;
        edge.toggleClass("graph-hidden", hidden);
      });

      graphCy.nodes().forEach(function (node) {
        var dim = Boolean(query) && !node.hasClass("graph-hidden") &&
          String(node.data("name") || "").toLowerCase().indexOf(query) < 0;
        node.toggleClass("graph-dim", dim);
      });
    });

    graphNodeCount.textContent = String(visibleNodes);
    graphEdgeCount.textContent = String(visibleEdges);
    graphCy.resize();
    if (relayout) runGraphLayout(true);
  }

  function clearGraphDetail() {
    graphDetail.hidden = true;
    graphDetailEmpty.hidden = false;
    if (graphCy) graphCy.elements().removeClass("graph-dim");
  }

  function highlightGraph(element) {
    if (!graphCy) return;
    graphCy.elements().removeClass("graph-dim");
    var hood = element.isNode() ? element.closedNeighborhood() : element.connectedNodes().union(element);
    graphCy.elements().not(hood).addClass("graph-dim");
  }

  function graphChapterRangeText(from, to) {
    if (from === undefined || from === null) return "";
    return "第" + from + "章" + (to === undefined || to === null ? "至今" : "–第" + to + "章");
  }

  function renderGraphDetailKv(entries) {
    var list = make("dl", "graph-detail-kv");
    for (var i = 0; i < entries.length; i += 1) {
      var row = make("div", "");
      row.appendChild(make("dt", "", entries[i][0]));
      row.appendChild(make("dd", "", String(entries[i][1])));
      list.appendChild(row);
    }
    return list;
  }

  function graphRawEntries(raw) {
    var entries = [];
    if (!raw || typeof raw !== "object") return entries;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var value = raw[key];
      if (value === undefined || value === null || value === "") continue;
      if (key === "relationshipKind" || key === "pairKey" || key === "signature") continue;
      if (typeof value === "object") {
        try { value = JSON.stringify(value); } catch (ignore) { continue; }
      }
      if (typeof value === "string" && value.length > 120) value = value.slice(0, 120) + "…";
      entries.push([key, value]);
    }
    return entries;
  }

  function showGraphNodeDetail(node) {
    if (!graphCy) return;
    graphDetailEmpty.hidden = true;
    graphDetail.hidden = false;
    graphDetailTitle.textContent = node.data("name") || "未命名节点";
    var meta = graphKindLabel(node.data("kind"));
    if (node.data("chapter") !== null) meta += " · 第" + node.data("chapter") + "章";
    if (node.data("status")) meta += " · " + node.data("status");
    graphDetailMeta.textContent = meta;
    graphDetailBody.textContent = "";

    var entries = graphRawEntries(node.data("raw"));
    if (entries.length > 0) {
      var dataSection = make("section", "graph-detail-section");
      dataSection.appendChild(make("h4", "", "属性"));
      dataSection.appendChild(renderGraphDetailKv(entries));
      graphDetailBody.appendChild(dataSection);
    }

    var edges = node.connectedEdges().filter(function (edge) {
      return !edge.hasClass("graph-hidden");
    });
    var edgeSection = make("section", "graph-detail-section");
    edgeSection.appendChild(make("h4", "", "关联关系 (" + edges.length + ")"));
    if (edges.length === 0) {
      edgeSection.appendChild(make("p", "graph-detail-empty", "暂无可见关联。"));
    } else {
      var list = make("ul", "graph-detail-list");
      edges.forEach(function (edge) {
        var other = edge.source().id() === node.id() ? edge.target() : edge.source();
        var direction = edge.source().id() === node.id() ? "→" : "←";
        var label = edge.data("label") || graphKindLabel(edge.data("kind"));
        var range = graphChapterRangeText(edge.data("fromChapter"), edge.data("toChapter"));
        var text = direction + " " + (other.data("name") || other.id()) + "｜" + label +
          (range ? "｜" + range : "") +
          (edge.data("description") ? "｜" + edge.data("description") : "");
        list.appendChild(make("li", "", text));
      });
      edgeSection.appendChild(list);
    }
    graphDetailBody.appendChild(edgeSection);
  }

  function showGraphEdgeDetail(edge) {
    if (!graphCy) return;
    graphDetailEmpty.hidden = true;
    graphDetail.hidden = false;
    var label = edge.data("label") || graphKindLabel(edge.data("kind"));
    graphDetailTitle.textContent = label;
    graphDetailMeta.textContent = (edge.source().data("name") || edge.source().id()) +
      " → " + (edge.target().data("name") || edge.target().id());
    graphDetailBody.textContent = "";

    var entries = [];
    if (edge.data("description")) entries.push(["说明", edge.data("description")]);
    entries.push(["类型", graphKindLabel(edge.data("kind"))]);
    entries.push(["区间", graphChapterRangeText(edge.data("fromChapter"), edge.data("toChapter")) || "—"]);
    if (edge.data("evidenceChapter") !== null) entries.push(["证据章节", "第" + edge.data("evidenceChapter") + "章"]);
    if (edge.data("status")) entries.push(["状态", edge.data("status")]);

    var section = make("section", "graph-detail-section");
    section.appendChild(make("h4", "", "关系信息"));
    section.appendChild(renderGraphDetailKv(entries));
    graphDetailBody.appendChild(section);
  }

  viewTabCreate.addEventListener("click", function () { setView("create", true); });
  viewTabLibrary.addEventListener("click", function () { setView("library", true); });
  viewTabGraph.addEventListener("click", function () { setView("graph", true); });
  resultLibraryLink.addEventListener("click", function () {
    if (!projectId) return;
    expandedBooks[projectId] = true;
    setView("library", true);
  });
  graphRefresh.addEventListener("click", function () {
    if (graphSelectedBookId) {
      var selected = findBook(graphSelectedBookId);
      if (selected) {
        loadGraphForBook(selected);
        return;
      }
    }
    loadGraphView();
  });
  graphSearch.addEventListener("input", function () { applyGraphFilters(false); });
  graphShowHistory.addEventListener("change", function () { applyGraphFilters(false); });
  graphShowChapters.addEventListener("change", function () { applyGraphFilters(true); });
  graphLayout.addEventListener("change", function () { runGraphLayout(true); });
  graphChapterRange.addEventListener("input", function () {
    var cutoff = parseInt(graphChapterRange.value, 10);
    graphChapterLabel.textContent = cutoff > 0 ? "第 1–" + cutoff + " 章" : "仅设定";
    applyGraphFilters(false);
  });
  Object.keys(graphKindInputs).forEach(function (kind) {
    graphKindInputs[kind].addEventListener("change", function () { applyGraphFilters(true); });
  });
  graphFit.addEventListener("click", function () {
    if (graphCy) graphCy.fit(undefined, 40);
  });
  graphZoomIn.addEventListener("click", function () {
    if (!graphCy) return;
    graphCy.zoom({ level: graphCy.zoom() * 1.2, renderedPosition: { x: graphCanvas.clientWidth / 2, y: graphCanvas.clientHeight / 2 } });
  });
  graphZoomOut.addEventListener("click", function () {
    if (!graphCy) return;
    graphCy.zoom({ level: graphCy.zoom() / 1.2, renderedPosition: { x: graphCanvas.clientWidth / 2, y: graphCanvas.clientHeight / 2 } });
  });
  libraryRefresh.addEventListener("click", function () { loadLibrary(true); });
  libraryEmptyCreate.addEventListener("click", function () { setView("create", true); });
  libraryAbort.addEventListener("click", function () {
    if (!libraryRunId) return;
    libraryAbort.disabled = true;
    addLibraryEvent("正在请求停止…", "abort");
    fetch("/api/runs/" + encodeURIComponent(libraryRunId) + "/abort", { method: "POST" })
      .then(function (response) {
        if (!response.ok) throw new Error("停止请求失败（" + response.status + "）");
      })
      .catch(function (error) {
        libraryAbort.disabled = false;
        addLibraryEvent(error instanceof Error ? error.message : String(error), "error");
      });
  });

  continueCancel.addEventListener("click", closeContinue);
  continueClose.addEventListener("click", closeContinue);
  continueOverlay.addEventListener("click", closeContinue);
  continueCount.addEventListener("input", updateContinueEstimate);
  continueCount.addEventListener("change", updateContinueEstimate);
  continueChapters.addEventListener("input", updateContinueBatch);
  continueChapters.addEventListener("change", updateContinueBatch);
  continueConfirm.addEventListener("click", submitContinue);

  readerClose.addEventListener("click", closeReader);
  readerOverlay.addEventListener("click", closeReader);
  readerPrev.addEventListener("click", function () {
    if (!readerState) return;
    openReaderAt(readerState.book, readerState.toc, readerState.chapters, readerState.index - 1);
  });
  readerNext.addEventListener("click", function () {
    if (!readerState) return;
    openReaderAt(readerState.book, readerState.toc, readerState.chapters, readerState.index + 1);
  });

  window.addEventListener("hashchange", function () {
    var route = routeFromHash();
    setView(route.view, false, route.bookId);
  });
  window.addEventListener("resize", function () {
    if (graphCy) graphCy.resize();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (libraryRunActive) {
      showFormError("书架正在续写另一本书，请等待完成或先停止。");
      return;
    }
    if (!finished) return;

    var premise = premiseInput.value.trim();
    if (!premise) {
      showFormError("请先填写故事前提。");
      premiseInput.focus();
      return;
    }

    maxChapters = clampNumber(maxChaptersInput, 6, 1, 40);
    var chapterWords = clampNumber(chapterWordsInput, 800, 200, 20000);
    updateTotal();

    if (settingsLoaded && !settings.usable) {
      showFormError("请先完成模型设置，或配置服务器 .env。");
      openSettings(true);
      return;
    }

    clearFormError();
    resultPanel.hidden = true;
    finished = false;
    projectId = null;
    runId = null;
    seenEvents = Object.create(null);
    resetProgress();
    setStatus("running");
    phaseTitle.textContent = "建立项目";
    phaseSub.textContent = "正在创建故事与运行记录";
    setRunningUi(true);
    startElapsed();
    addEvent("已提交创作请求，正在建立项目…", "submit");

    api("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        premise: premise,
        maxChapters: maxChapters,
        chapterWords: chapterWords
      })
    }).then(function (data) {
      if (!data || !data.projectId || !data.runId) {
        throw new Error("服务端响应缺少 projectId 或 runId。");
      }
      projectId = data.projectId;
      runId = data.runId;
      abortButton.disabled = false;
      addEvent("项目 " + String(projectId).slice(0, 8) + " · 运行 " + String(runId).slice(0, 8), "queued");
      subscribe();
    }).catch(function (error) {
      if (error && error.code === "model_not_configured") {
        showFormError("请先完成模型设置，或配置服务器 .env。");
        openSettings(true);
      }
      failRun(error instanceof Error ? error.message : String(error));
    });
  });

  abortButton.addEventListener("click", function () {
    if (finished || !runId) return;
    abortButton.disabled = true;
    addEvent("正在请求停止…", "abort");
    fetch("/api/runs/" + encodeURIComponent(runId) + "/abort", { method: "POST" })
      .then(function (response) {
        if (!response.ok) throw new Error("停止请求失败（" + response.status + "）");
      })
      .catch(function (error) {
        abortButton.disabled = false;
        addEvent(error instanceof Error ? error.message : String(error), "error");
      });
  });

  premiseInput.addEventListener("input", updatePremiseCount);
  maxChaptersInput.addEventListener("input", updateTotal);
  chapterWordsInput.addEventListener("input", updateTotal);
  maxChaptersInput.addEventListener("change", function () { maxChapters = clampNumber(maxChaptersInput, 6, 1, 40); updateTotal(); });
  chapterWordsInput.addEventListener("change", function () { clampNumber(chapterWordsInput, 800, 200, 20000); updateTotal(); });

  updatePremiseCount();
  updateTotal();
  setRing(0, 6);
  setStatus("idle");
  var initialRoute = routeFromHash();
  setView(initialRoute.view, false, initialRoute.bookId);
})();
</script>
</body>
</html>
`;

export function renderHomePage(): string {
  return HOME_PAGE;
}
