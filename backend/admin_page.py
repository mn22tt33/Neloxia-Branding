"""Local-only queue administration page."""

ADMIN_PAGE = r"""<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>إدارة الطابور | QUIZORA</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --panel: #101e30;
      --panel-soft: #14243a;
      --line: rgba(179, 205, 235, .12);
      --text: #f2f6fc;
      --muted: #9aacc2;
      --teal: #54dfc2;
      --amber: #ffbf69;
      --red: #ff7d86;
      font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(ellipse at 87% 0%, rgba(39, 114, 132, .2), transparent 34rem),
        radial-gradient(ellipse at 8% 30%, rgba(37, 76, 130, .16), transparent 30rem),
        var(--bg);
    }
    button { font: inherit; }
    .shell { width: min(1120px, calc(100% - 36px)); margin: 0 auto; padding: 38px 0 56px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 30px; }
    .brand { display: flex; align-items: center; gap: 13px; }
    .brand-mark {
      display: grid; place-items: center; width: 48px; height: 48px; border-radius: 15px;
      color: #04221f; background: linear-gradient(145deg, #71f0d1, #2bb99e);
      font-size: 19px; font-weight: 900; box-shadow: 0 10px 28px rgba(62, 220, 186, .18);
    }
    .brand-name { margin: 0; font-size: 14px; letter-spacing: .16em; color: var(--teal); font-weight: 800; }
    .brand-subtitle { margin: 5px 0 0; font-size: 12px; color: var(--muted); }
    .local-badge {
      display: flex; align-items: center; gap: 9px; padding: 10px 13px; border: 1px solid var(--line);
      border-radius: 999px; background: rgba(16, 30, 48, .72); color: #c3d2e3; font-size: 12px;
    }
    .local-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 12px var(--teal); }
    .hero { display: flex; justify-content: space-between; align-items: end; gap: 18px; margin-bottom: 22px; }
    .eyebrow { margin: 0 0 9px; color: var(--teal); font-size: 12px; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 0; font-size: clamp(25px, 4vw, 36px); letter-spacing: -.035em; }
    .intro { margin: 9px 0 0; color: var(--muted); font-size: 14px; }
    .refresh-label { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat {
      position: relative; overflow: hidden; min-height: 108px; padding: 18px 19px;
      border: 1px solid var(--line); border-radius: 18px;
      background: linear-gradient(145deg, rgba(20, 36, 58, .96), rgba(13, 26, 43, .96));
    }
    .stat::after {
      content: ""; position: absolute; width: 100px; height: 100px; left: -34px; bottom: -55px;
      border-radius: 50%; background: var(--glow, rgba(84, 223, 194, .1)); filter: blur(2px);
    }
    .stat-label { color: var(--muted); font-size: 13px; font-weight: 600; }
    .stat-value { display: block; margin-top: 12px; font-size: 34px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; }
    .stat.queue { --glow: rgba(84, 223, 194, .13); }
    .stat.running { --glow: rgba(255, 191, 105, .13); }
    .stat.solved { --glow: rgba(108, 151, 255, .16); }
    .stat.solved {
      width: 100%; color: inherit; font-family: inherit; text-align: right; cursor: pointer;
      transition: transform .16s ease, border-color .16s ease;
    }
    .stat.solved:hover { transform: translateY(-1px); border-color: rgba(169, 189, 255, .35); }
    .stat.solved:focus-visible { outline: 2px solid var(--teal); outline-offset: 3px; }
    .stat.active { --glow: rgba(151, 196, 255, .12); }
    .stat.running .stat-value { color: var(--amber); }
    .stat.solved .stat-value { color: #a9bdff; }
    .stat.active .stat-value { color: #a9d8ff; }
    .preferences {
      display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 20px;
      padding: 17px 20px; border: 1px solid var(--line); border-radius: 17px;
      background: linear-gradient(110deg, rgba(20, 36, 58, .92), rgba(13, 26, 43, .9));
    }
    .site-actions { display: flex; align-items: center; gap: 12px; flex: none; }
    .site-state { color: var(--teal); font-size: 11px; font-weight: 700; }
    .site-state.is-disabled { color: var(--red); }
    .site-preview { min-height: 38px; padding: 0 12px; white-space: nowrap; }
    .preference-title { margin: 0; font-size: 14px; font-weight: 800; }
    .preference-hint { margin: 6px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; }
    .preference-state { flex: none; min-width: 115px; color: var(--muted); font-size: 11px; }
    .subscription-code-output {
      display: block; margin-top: 9px; color: var(--teal); font: 800 17px/1.5 Consolas, monospace;
      letter-spacing: .08em; overflow-wrap: anywhere;
    }
    .subscription-code-note { margin: 6px 0 0; color: var(--muted); font-size: 11px; line-height: 1.7; }
    .subscription-code-actions { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    .subscription-code-field { display: grid; gap: 7px; color: var(--muted); font-size: 11px; }
    .subscription-code-field select { min-width: 210px; }
    .switch { position: relative; flex: none; width: 48px; height: 27px; }
    .switch input { position: absolute; width: 1px; height: 1px; opacity: 0; }
    .switch-track {
      position: absolute; inset: 0; border: 1px solid rgba(179,205,235,.2); border-radius: 999px;
      background: #24344a; cursor: pointer; transition: .2s ease;
    }
    .switch-track::after {
      content: ""; position: absolute; top: 3px; right: 3px; width: 19px; height: 19px;
      border-radius: 50%; background: #b7c5d5; transition: .2s ease;
    }
    .switch input:checked + .switch-track { border-color: rgba(84,223,194,.45); background: rgba(51,178,151,.42); }
    .switch input:checked + .switch-track::after { transform: translateX(-21px); background: #78f0d1; box-shadow: 0 0 12px rgba(84,223,194,.35); }
    .switch input:focus-visible + .switch-track { outline: 2px solid var(--teal); outline-offset: 3px; }
    .switch input:disabled + .switch-track { cursor: wait; opacity: .55; }
    .board { overflow: hidden; border: 1px solid var(--line); border-radius: 20px; background: rgba(13, 26, 43, .88); box-shadow: 0 24px 70px rgba(0, 0, 0, .22); }
    .board-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 20px 22px; border-bottom: 1px solid var(--line); }
    .board-title { margin: 0; font-size: 17px; }
    .board-caption { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
    .live { display: flex; align-items: center; gap: 8px; color: #b6c8da; font-size: 12px; }
    .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: .4; box-shadow: 0 0 0 5px rgba(84, 223, 194, .08); } }
    .toolbar {
      display: flex; align-items: center; gap: 10px; padding: 14px 20px;
      border-bottom: 1px solid var(--line); background: rgba(255,255,255,.015);
    }
    .search { position: relative; flex: 1; min-width: 160px; }
    .search input, .status-filter {
      width: 100%; min-height: 40px; border: 1px solid var(--line); border-radius: 11px;
      color: var(--text); background: #0b1828; font: inherit; font-size: 12px; outline: none;
    }
    .search input { padding: 0 38px 0 12px; }
    .search::before { content: "⌕"; position: absolute; right: 13px; top: 7px; color: #8fa4bc; font-size: 20px; }
    .search input:focus, .status-filter:focus { border-color: rgba(84,223,194,.55); box-shadow: 0 0 0 3px rgba(84,223,194,.08); }
    .status-filter { width: auto; min-width: 140px; padding: 0 11px; }
    .refresh-button {
      flex: none; min-height: 40px; padding: 0 13px; border: 1px solid var(--line); border-radius: 11px;
      color: #d7e5f4; background: #14243a; font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .refresh-button:hover { border-color: rgba(84,223,194,.35); color: var(--teal); }
    .list { padding: 8px 14px 14px; }
    .job {
      display: grid; grid-template-columns: 48px minmax(130px, 1fr) minmax(140px, 1.1fr) minmax(135px, .9fr) minmax(180px, 1.15fr) auto;
      align-items: center; gap: 14px; padding: 15px 9px; border-bottom: 1px solid rgba(179, 205, 235, .08);
    }
    .job:last-child { border-bottom: 0; }
    .position {
      display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid rgba(84, 223, 194, .18);
      border-radius: 13px; color: var(--teal); background: rgba(84, 223, 194, .07); font-weight: 800;
      font-variant-numeric: tabular-nums;
    }
    .position.is-running { border-color: rgba(255, 191, 105, .2); color: var(--amber); background: rgba(255, 191, 105, .07); }
    .field-label { display: block; margin-bottom: 6px; color: #8196af; font-size: 10px; font-weight: 700; }
    .code { direction: ltr; text-align: right; overflow-wrap: anywhere; font-size: 14px; font-weight: 750; letter-spacing: .02em; }
    .detail { color: #d7e2ee; font-size: 13px; line-height: 1.5; }
    .phase { color: #b8c7d8; font-size: 12px; line-height: 1.5; }
    .tag {
      display: inline-flex; align-items: center; gap: 7px; margin-top: 5px; padding: 5px 9px;
      border: 1px solid var(--line); border-radius: 999px; color: #b8c7d8; background: rgba(255,255,255,.025); font-size: 10px;
    }
    .tag::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #90a5bc; }
    .tag.running { color: #ffd298; border-color: rgba(255,191,105,.18); background: rgba(255,191,105,.06); }
    .tag.running::before { background: var(--amber); box-shadow: 0 0 8px rgba(255,191,105,.7); }
    .tag.waiting::before { background: var(--teal); }
    .elapsed { margin-top: 6px; color: #8297af; font-size: 10px; }
    .job-progress { min-width: 0; }
    .progress-info { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; color: #b9c9dc; font-size: 10px; }
    .progress-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progress-percent { flex: none; color: var(--teal); font-weight: 800; font-variant-numeric: tabular-nums; }
    .progress-track { height: 6px; overflow: hidden; border-radius: 99px; background: rgba(179,205,235,.12); }
    .progress-track > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #39bfa3, #78f0d1); transition: width .3s ease; }
    .progress-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; color: #8196af; font-size: 9px; }
    .skip {
      min-height: 39px; padding: 0 13px; border: 1px solid rgba(84, 223, 194, .24); border-radius: 11px;
      color: #071b1a; background: linear-gradient(135deg, #72efd1, #38c8aa); font-weight: 800; font-size: 12px;
      cursor: pointer; transition: transform .16s ease, filter .16s ease;
    }
    .skip:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.07); }
    .skip:disabled { cursor: not-allowed; opacity: .48; }
    .empty, .error {
      display: grid; place-items: center; min-height: 190px; padding: 28px; text-align: center; color: var(--muted); line-height: 1.8;
    }
    .empty strong { display: block; margin-bottom: 5px; color: var(--text); font-size: 15px; }
    .error { min-height: 0; margin-bottom: 14px; padding: 12px 16px; border: 1px solid rgba(255,125,134,.22); border-radius: 12px; color: #ffb9be; background: rgba(255,125,134,.07); }
    .error[hidden] { display: none; }
    .solved-dialog {
      width: min(560px, calc(100% - 24px)); max-height: min(80vh, 680px); padding: 0;
      border: 1px solid var(--line); border-radius: 20px; color: var(--text);
      background: #101e30; box-shadow: 0 24px 70px rgba(0,0,0,.45);
    }
    .solved-dialog::backdrop { background: rgba(1, 8, 16, .78); backdrop-filter: blur(4px); }
    .solved-dialog-content { padding: 20px; }
    .solved-dialog-head { display: flex; justify-content: space-between; align-items: start; gap: 16px; }
    .solved-dialog-title { margin: 0; font-size: 19px; }
    .solved-dialog-summary { margin: 8px 0 15px; color: var(--muted); font-size: 12px; line-height: 1.8; }
    .solved-dialog-close {
      flex: none; width: 36px; height: 36px; border: 1px solid var(--line); border-radius: 10px;
      color: var(--text); background: #14243a; font-size: 20px; cursor: pointer;
    }
    .solved-events { display: grid; gap: 9px; max-height: 55vh; overflow: auto; }
    .solved-event { padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; background: rgba(255,255,255,.025); }
    .solved-event-head { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
    .solved-event-code { direction: ltr; text-align: left; overflow-wrap: anywhere; color: #dce8f6; font-size: 14px; font-weight: 800; }
    .solved-event-detail { color: #b8c7d8; font-size: 12px; line-height: 1.6; text-align: left; }
    .solved-event-owner { display: grid; gap: 4px; margin-top: 9px; color: #91a5bc; font-size: 11px; }
    .solved-event-email { direction: ltr; text-align: right; overflow-wrap: anywhere; }
    .solved-event-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; margin-top: 9px; color: #91a5bc; font-size: 10px; }
    .solved-event-duration { color: var(--teal); font-weight: 700;
    }
    .solved-empty { padding: 20px 14px; border: 1px dashed var(--line); border-radius: 11px; color: var(--muted); text-align: center; font-size: 13px; line-height: 1.8; }
    .toast { position: fixed; right: 50%; bottom: 24px; z-index: 3; transform: translate(50%, 20px); opacity: 0; pointer-events: none; padding: 12px 18px; border: 1px solid var(--line); border-radius: 12px; background: #17283e; color: var(--text); box-shadow: 0 12px 35px rgba(0,0,0,.3); transition: .2s ease; }
    .toast.show { transform: translate(50%, 0); opacity: 1; }
    .workspace { display: grid; grid-template-columns: 205px minmax(0, 1fr); align-items: start; gap: 18px; }
    .sidebar { position: sticky; top: 18px; padding: 14px; border: 1px solid var(--line); border-radius: 18px; background: rgba(13, 26, 43, .9); }
    .sidebar-label { margin: 3px 8px 10px; color: #8196af; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
    .sidebar-nav { display: grid; gap: 6px; }
    .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 43px; padding: 0 11px; border: 1px solid transparent; border-radius: 11px; color: #b6c8da; background: transparent; text-align: right; font-size: 12px; font-weight: 700; cursor: pointer; }
    .nav-item:hover { background: rgba(255,255,255,.035); color: var(--text); }
    .nav-item.active { border-color: rgba(84,223,194,.18); color: var(--teal); background: rgba(84,223,194,.08); }
    .nav-icon { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 8px; background: rgba(255,255,255,.05); font-size: 13px; }
    .sidebar-divider { height: 1px; margin: 15px 3px; background: var(--line); }
    .sidebar-account { overflow-wrap: anywhere; padding: 0 8px; color: #8297af; font-size: 10px; line-height: 1.8; }
    .sidebar-account strong { display: block; color: #d7e5f4; font-size: 11px; }
    .content { min-width: 0; }
    .view[hidden] { display: none; }
    .user-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; margin-bottom: 15px; }
    .user-stat { padding: 16px 18px; border: 1px solid var(--line); border-radius: 15px; background: linear-gradient(145deg, rgba(20,36,58,.96), rgba(13,26,43,.96)); }
    .user-stat span { display: block; color: var(--muted); font-size: 11px; }
    .user-stat strong { display: block; margin-top: 8px; color: var(--text); font-size: 26px; font-variant-numeric: tabular-nums; }
    .user-stat.active strong { color: var(--teal); }
    .user-stat.blocked strong { color: var(--red); }
    .user-board { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: rgba(13,26,43,.88); }
    .users-toolbar { display: flex; align-items: center; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }
    .users-toolbar .search { flex: 1; }
    .user-table-wrap { overflow-x: auto; }
    .user-table { width: 100%; min-width: 700px; border-collapse: collapse; text-align: right; }
    .user-table th { padding: 12px 15px; color: #8196af; background: rgba(255,255,255,.02); font-size: 10px; font-weight: 800; white-space: nowrap; }
    .user-table td { padding: 13px 15px; border-top: 1px solid rgba(179,205,235,.08); color: #d7e2ee; font-size: 11px; vertical-align: middle; }
    .user-primary { color: var(--text); font-size: 12px; font-weight: 750; }
    .user-email { direction: ltr; text-align: right; color: #9aacc2; overflow-wrap: anywhere; }
    .user-role, .user-state { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 999px; font-size: 10px; white-space: nowrap; }
    .user-role.admin { color: #c6b5ff; border-color: rgba(174,151,255,.2); background: rgba(174,151,255,.07); }
    .user-state.active { color: var(--teal); border-color: rgba(84,223,194,.18); background: rgba(84,223,194,.06); }
    .user-state.blocked { color: #ffabb1; border-color: rgba(255,125,134,.2); background: rgba(255,125,134,.07); }
    .user-actions { display: flex; gap: 6px; }
    .user-action { min-height: 31px; padding: 0 9px; border: 1px solid var(--line); border-radius: 8px; color: #d7e5f4; background: #14243a; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .user-action:hover:not(:disabled) { border-color: rgba(84,223,194,.35); color: var(--teal); }
    .user-action.danger { color: #ffabb1; }
    .user-action.danger:hover:not(:disabled) { border-color: rgba(255,125,134,.4); color: #ffc1c5; }
    .user-action:disabled { opacity: .45; cursor: not-allowed; }
    .users-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 15px; color: var(--muted); font-size: 10px; }
    .users-pagination { display: flex; align-items: center; gap: 8px; }
    .users-pagination button { min-height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; color: #d7e5f4; background: #14243a; font-size: 10px; cursor: pointer; }
    .users-pagination button:disabled { opacity: .42; cursor: not-allowed; }
    .users-empty { padding: 36px 16px; color: var(--muted); text-align: center; font-size: 12px; }
    .users-error { margin: 12px 14px 0; }
    .users-error[hidden] { display: none; }
    @media (max-width: 760px) {
      .shell { width: min(100% - 24px, 560px); padding-top: 22px; }
      .topbar { margin-bottom: 25px; }
      .workspace { grid-template-columns: minmax(0, 1fr); gap: 12px; }
      .sidebar { position: static; padding: 9px; }
      .sidebar-label, .sidebar-divider, .sidebar-account { display: none; }
      .sidebar-nav { display: flex; overflow-x: auto; gap: 5px; }
      .nav-item { flex: 1 0 auto; justify-content: center; width: auto; min-height: 40px; padding: 0 9px; }
      .nav-icon { display: none; }
      .user-stat { padding: 13px 11px; }
      .user-stat strong { font-size: 22px; }
      .users-toolbar { flex-wrap: wrap; }
      .users-toolbar .search { flex-basis: 100%; }
      .users-toolbar .status-filter { flex: 1; }
      .users-meta { align-items: start; flex-direction: column; }
      .hero { align-items: start; flex-direction: column; }
      .stats { grid-template-columns: repeat(2, 1fr); gap: 9px; }
      .stat { min-height: 100px; padding: 15px 13px; border-radius: 15px; }
      .stat-label { font-size: 11px; }
      .stat-value { margin-top: 11px; font-size: 29px; }
      .preferences { padding: 14px; gap: 12px; }
      .preference-state { display: none; }
      .site-actions { flex-wrap: wrap; justify-content: flex-start; }
      .site-state { flex-basis: 100%; }
      .board-head { padding: 17px 15px; }
      .toolbar { flex-wrap: wrap; padding: 12px; }
      .search { flex-basis: 100%; }
      .status-filter { flex: 1; }
      .list { padding: 5px 12px 10px; }
      .job { grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 10px; padding: 15px 2px; }
      .position { grid-column: 1; grid-row: 1 / span 5; width: 36px; height: 36px; }
      .job-code, .job-detail, .job-state, .job-progress, .job-action { grid-column: 2; }
      .job-action { justify-self: start; }
      .skip { padding: 0 10px; }
      .refresh-label { font-size: 11px; }
    }
    @media (max-width: 380px) {
      .local-badge { padding: 8px 10px; font-size: 10px; }
      .brand-mark { width: 42px; height: 42px; }
      .job { grid-template-columns: 39px minmax(0, 1fr) auto; gap: 8px; }
      .skip { max-width: 82px; padding: 0 8px; font-size: 11px; }
    }

    /* Premium glass administration layer */
    body {
      background:
        radial-gradient(900px 500px at 100% 0, rgba(62,95,158,.18), transparent 58%),
        radial-gradient(700px 420px at 0 100%, rgba(156,135,221,.10), transparent 62%),
        var(--bg);
    }
    .shell { width: min(1180px, calc(100% - 40px)); padding: 28px 0 48px; }
    .topbar {
      min-height: 92px; margin-bottom: 22px; padding: 14px 18px;
      border: 1px solid rgba(255,255,255,.10); border-radius: 24px;
      background:
        radial-gradient(420px 140px at 82% -60%, rgba(255,255,255,.10), transparent 60%),
        linear-gradient(112deg, #07111f 0%, #2C2054 58%, #3E5F9E 100%);
      box-shadow: 0 18px 44px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.07);
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    }
    .brand-mark {
      width: 58px; height: 58px; border-radius: 18px;
      color: #fff; background: linear-gradient(135deg, #7A63CB, #3E5F9E);
      box-shadow: 0 12px 28px rgba(62,95,158,.26);
    }
    .workspace { grid-template-columns: 220px minmax(0,1fr); gap: 16px; }
    .sidebar {
      position: sticky; top: 18px; padding: 12px; border-radius: 20px;
      border: 1px solid rgba(255,255,255,.09);
      background: rgba(13,26,43,.88);
      box-shadow: 0 16px 40px rgba(0,0,0,.20), inset 0 1px 0 rgba(255,255,255,.04);
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
    }
    .nav-item { min-height: 46px; border-radius: 13px; }
    .nav-item.active {
      border-color: rgba(84,223,194,.22);
      background: linear-gradient(135deg, rgba(84,223,194,.11), rgba(84,223,194,.05));
    }
    .hero, .preferences, .board, .user-board, .user-stat {
      border: 1px solid rgba(179,205,235,.11);
      background: rgba(16,30,48,.84);
      box-shadow: 0 12px 32px rgba(0,0,0,.14), inset 0 1px 0 rgba(255,255,255,.025);
      -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
    }
    .hero { border-radius: 22px; padding: 22px 24px; }
    .preferences { border-radius: 17px; }
    .stats { gap: 12px; }
    .stat { min-height: 112px; border: 1px solid rgba(179,205,235,.10); border-radius: 18px; }
    .board { border-radius: 20px; }
    .job { border-radius: 14px; background: rgba(255,255,255,.018); }
    .job-actions button, .refresh-button, .user-action, .users-pagination button {
      border-radius: 10px; transition: .16s;
    }
    .job-actions button:hover:not(:disabled), .refresh-button:hover, .user-action:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    @media (max-width:760px) {
      .shell { width: calc(100% - 24px); padding-top: 16px; }
      .topbar { min-height: 76px; padding: 10px 12px; border-radius: 18px; }
      .brand-mark { width: 48px; height: 48px; border-radius: 15px; }
      .workspace { grid-template-columns: minmax(0,1fr); }
      .sidebar { position: static; border-radius: 15px; }
      .hero { padding: 18px 16px; border-radius: 18px; }
      .stat { min-height: 96px; border-radius: 15px; }
    }
    @media (max-width: 760px) {
      body { overflow-x: hidden; line-height: 1.65; }
      .shell { width: calc(100% - 20px); min-width: 0; padding: 12px 0 28px; }
      .topbar { min-width: 0; flex-wrap: wrap; align-items: flex-start; gap: 10px; }
      .brand { min-width: 0; flex: 1 1 180px; }
      .brand-subtitle, .local-badge { line-height: 1.5; }
      .local-badge { max-width: 100%; white-space: normal; }
      .workspace, .content, .view { min-width: 0; width: 100%; }
      .hero { align-items: flex-start; flex-direction: column; gap: 8px; }
      .intro, .preference-hint, .board-caption { line-height: 1.7; overflow-wrap: anywhere; }
      .refresh-label { white-space: normal; }
      .preferences { min-width: 0; flex-wrap: wrap; align-items: flex-start; padding: 14px; }
      .preferences > div { min-width: 0; flex: 1 1 100%; }
      .site-actions { min-width: 0; flex: 1 1 100%; flex-wrap: wrap; }
      .site-state { flex: 1 0 100%; line-height: 1.6; }
      .preference-state { display: block; min-width: 0; flex: 1 1 100%; }
      .site-preview { min-width: 0; white-space: normal; }
      .board-head { align-items: flex-start; flex-wrap: wrap; padding: 15px; }
      .toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
      .toolbar .search { grid-column: 1 / -1; min-width: 0; }
      .status-filter { min-width: 0; width: 100%; }
      .refresh-button { min-height: 42px; }
      .job { min-width: 0; }
      .detail, .phase, .elapsed, .field-label { line-height: 1.65; overflow-wrap: anywhere; }
      .user-table-wrap { max-width: 100%; }
      .users-meta { flex-wrap: wrap; }
    }
    @media (max-width: 380px) {
      .topbar { align-items: center; }
      .local-badge { flex: 1 1 100%; justify-content: center; }
      .stats { gap: 7px; }
      .stat { min-width: 0; padding: 12px 10px; }
      .stat-label { line-height: 1.55; overflow-wrap: anywhere; }
      .site-actions { gap: 8px; }
      .site-preview { flex: 1 1 100%; }
      .nav-item { min-height: 42px; padding-inline: 8px; white-space: nowrap; }
      .job { grid-template-columns: 34px minmax(0, 1fr); }
      .position { width: 32px; height: 32px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">Q</div>
        <div><p class="brand-name">QUIZORA</p><p class="brand-subtitle">لوحة إدارة التشغيل</p></div>
      </div>
      <div class="local-badge"><span class="local-dot"></span>إدارة محلية آمنة</div>
    </header>

    <div class="workspace">
      <aside class="sidebar" aria-label="قائمة الإدارة">
        <p class="sidebar-label">مساحة العمل</p>
        <nav class="sidebar-nav">
          <button class="nav-item active" type="button" data-view="overviewView">
            <span class="nav-icon" aria-hidden="true">▦</span>نظرة عامة
          </button>
          <button class="nav-item" type="button" data-view="usersView">
            <span class="nav-icon" aria-hidden="true">♙</span>المستخدمون
          </button>
          <button class="nav-item" type="button" data-view="subscriptionCodesView">
            <span class="nav-icon" aria-hidden="true">◇</span>إنشاء كود الاشتراك
          </button>
        </nav>
        <div class="sidebar-divider"></div>
        <div class="sidebar-account" id="adminIdentity">جارٍ التحقق من حساب المدير...</div>
      </aside>
      <div class="content">
        <section class="view" id="overviewView">
    <section class="hero">
      <div><p class="eyebrow">مركز المتابعة</p><h1>إدارة الطابور</h1><p class="intro">تابع الحسابات النشطة وابدأ أي حساب منتظر فورًا.</p></div>
      <div class="refresh-label" id="updated">جارٍ الاتصال بالخادم المحلي...</div>
    </section>

      <section class="preferences" aria-labelledby="sitePreferenceTitle">
        <div>
          <h2 class="preference-title" id="sitePreferenceTitle">التحكم في إتاحة الموقع</h2>
          <p class="preference-hint">عند الإيقاف تظهر صفحة الصيانة للزوار، بينما تظل المعاينة المحلية متاحة على هذا الجهاز.</p>
        </div>
        <div class="site-actions">
          <span class="site-state" id="siteSettingState" aria-live="polite">جارٍ تحميل الحالة...</span>
          <label class="switch" aria-label="إتاحة الموقع للزوار">
            <input id="siteEnabled" type="checkbox" role="switch" disabled>
            <span class="switch-track"></span>
          </label>
          <button class="refresh-button site-preview" id="previewSiteButton" type="button">عرض الموقع على جهازي</button>
        </div>
      </section>

    <section class="stats" aria-label="ملخص التشغيل">
      <article class="stat queue"><span class="stat-label">حسابات في الطابور</span><strong class="stat-value" id="queueCount">—</strong></article>
      <article class="stat running"><span class="stat-label">حسابات قيد الحل الآن</span><strong class="stat-value" id="runningCount">—</strong></article>
      <article class="stat active"><span class="stat-label">عمليات نشطة</span><strong class="stat-value" id="activeJobCount">—</strong></article>
      <button class="stat solved" id="solvedCard" type="button" aria-haspopup="dialog" aria-controls="solvedDialog" title="عرض سجل عمليات الحل الناجحة">
        <span class="stat-label">عمليات حل ناجحة (تراكمي)</span><strong class="stat-value" id="solvedCount">—</strong>
      </button>
    </section>

    <section class="preferences" aria-labelledby="browserPreferenceTitle">
      <div>
        <h2 class="preference-title" id="browserPreferenceTitle">عرض متصفح الحل</h2>
        <p class="preference-hint">عند التفعيل، يظهر متصفح منصة Qureo أو SPX على صفحة المنصة نفسها، دون تبويب متابعة إضافي. وضع اللعبة لا يفتح متصفحًا.</p>
      </div>
      <span class="preference-state" id="browserSettingState">جارٍ تحميل الإعداد...</span>
      <label class="switch" aria-label="عرض متصفح الحل">
        <input id="browserVisible" type="checkbox" role="switch" disabled>
        <span class="switch-track"></span>
      </label>
    </section>

    <div class="error" id="error" role="alert" hidden></div>
    <section class="board">
      <header class="board-head">
        <div><h2 class="board-title">الحسابات النشطة</h2><p class="board-caption">البدء الفوري لا يوقف الحسابات التي تعمل حاليًا.</p></div>
        <div class="live"><span class="live-dot"></span>تحديث مباشر</div>
      </header>
      <div class="toolbar">
        <label class="search">
          <input id="searchJobs" type="search" placeholder="ابحث بالكود أو المسار..." aria-label="بحث في الحسابات النشطة">
        </label>
        <select class="status-filter" id="statusFilter" aria-label="تصفية حسب الحالة">
          <option value="all">كل الحالات</option>
          <option value="running">قيد الحل</option>
          <option value="waiting">في الطابور</option>
        </select>
        <button class="refresh-button" id="refreshButton" type="button">تحديث الآن</button>
      </div>
      <div class="list" id="jobs" aria-live="polite"></div>
    </section>
        </section>

        <section class="view" id="usersView" hidden>
          <section class="hero">
            <div><p class="eyebrow">إدارة الحسابات</p><h1>المستخدمون</h1><p class="intro">راجع بيانات الحسابات، وأدر الحظر والوصول بأمان.</p></div>
            <div class="refresh-label" id="usersUpdated">لم يتم تحميل المستخدمين بعد</div>
          </section>
          <section class="user-stats" aria-label="ملخص المستخدمين">
            <article class="user-stat"><span>إجمالي المستخدمين</span><strong id="totalUsers">—</strong></article>
            <article class="user-stat active"><span>حسابات نشطة</span><strong id="activeUsers">—</strong></article>
            <article class="user-stat blocked"><span>حسابات محظورة</span><strong id="blockedUsers">—</strong></article>
          </section>
          <section class="user-board" aria-labelledby="usersTitle">
            <header class="board-head">
              <div><h2 class="board-title" id="usersTitle">دليل المستخدمين</h2><p class="board-caption">البريد والاسم والدور وحالة الوصول وتاريخ إنشاء الحساب.</p></div>
              <div class="live"><span class="live-dot"></span>بيانات مباشرة</div>
            </header>
            <div class="users-toolbar">
              <label class="search">
                <input id="userSearch" type="search" placeholder="ابحث بالاسم أو البريد..." aria-label="بحث عن مستخدم">
              </label>
              <select class="status-filter" id="userStatus" aria-label="تصفية المستخدمين">
                <option value="all">كل المستخدمين</option>
                <option value="active">النشطون</option>
                <option value="blocked">المحظورون</option>
              </select>
              <button class="refresh-button" id="usersRefresh" type="button">تحديث</button>
            </div>
            <div class="error users-error" id="usersError" role="alert" hidden></div>
            <div class="user-table-wrap">
              <table class="user-table">
                <thead><tr><th scope="col">المستخدم</th><th scope="col">البريد الإلكتروني</th><th scope="col">الدور</th><th scope="col">الحالة</th><th scope="col">تاريخ التسجيل</th><th scope="col">الإجراءات</th></tr></thead>
                <tbody id="userRows" aria-live="polite"></tbody>
              </table>
              <div class="users-empty" id="usersEmpty" hidden>لا توجد حسابات مطابقة لخيارات البحث.</div>
            </div>
            <footer class="users-meta">
              <span id="usersCount">—</span>
              <div class="users-pagination">
                <button id="usersPrevious" type="button" disabled>السابق</button>
                <span id="usersPage">—</span>
                <button id="usersNext" type="button" disabled>التالي</button>
              </div>
            </footer>
          </section>
        </section>

        <section class="view" id="subscriptionCodesView" hidden>
          <section class="hero">
            <div><p class="eyebrow">إدارة الاشتراكات</p><h1>إنشاء كود الاشتراك</h1><p class="intro">أنشئ كودًا لخطة محددة وشاركه بعد استلام الدفع.</p></div>
            <div class="refresh-label" id="subscriptionCodesUpdated">الأكواد لا تُعرض كاملة بعد الإنشاء</div>
          </section>
          <section class="preferences">
            <div>
              <h2 class="preference-title">كود جديد</h2>
              <p class="preference-hint">كل كود يُستخدم مرة واحدة فقط، ويرتبط بالخطة المختارة ولا يعمل مع خطة أخرى.</p>
            </div>
            <div class="subscription-code-actions">
              <label class="subscription-code-field" for="subscriptionPlan">
                <span>الخطة</span>
                <select class="status-filter" id="subscriptionPlan">
                  <option value="basic">العادية — 25 جنيه — طلب حل واحد</option>
                  <option value="premium">المميزة — 50 جنيه — 3 طلبات حل</option>
                  <option value="professional">الاحترافية — 120 جنيه — 6 طلبات حل</option>
                </select>
              </label>
              <button class="refresh-button" id="createSubscriptionCode" type="button">إنشاء كود</button>
            </div>
          </section>
          <div class="error users-error" id="subscriptionCodesError" role="alert" hidden></div>
          <section class="preferences" id="subscriptionCodeResult" aria-live="polite" hidden>
            <div>
              <h2 class="preference-title">الكود جاهز للمشاركة</h2>
              <p class="subscription-code-note">احتفظ بنسخة منه الآن؛ لن يظهر الكود كاملًا مرة أخرى.</p>
              <output class="subscription-code-output" id="subscriptionCodeValue" dir="ltr"></output>
            </div>
            <button class="refresh-button" id="copySubscriptionCode" type="button">نسخ الكود</button>
          </section>
          <section class="user-board">
            <header class="board-head">
              <div><h2 class="board-title">الأكواد المنشأة</h2><p class="board-caption">تظهر حالة الكود وخطته فقط، دون كشف الكود نفسه.</p></div>
              <button class="refresh-button" id="subscriptionCodesRefresh" type="button">تحديث</button>
            </header>
            <div class="user-table-wrap">
              <table class="user-table">
                <thead><tr><th scope="col">الخطة</th><th scope="col">الحالة</th><th scope="col">تاريخ الإنشاء</th><th scope="col">تاريخ الاستخدام</th><th scope="col">معرّف المستخدم</th></tr></thead>
                <tbody id="subscriptionCodeRows" aria-live="polite"></tbody>
              </table>
              <div class="users-empty" id="subscriptionCodesEmpty" hidden>لم يتم إنشاء أكواد بعد.</div>
            </div>
          </section>
        </section>
      </div>
    </div>
  </main>
  <dialog class="solved-dialog" id="solvedDialog" aria-labelledby="solvedDialogTitle">
    <div class="solved-dialog-content">
      <header class="solved-dialog-head">
        <div>
          <h2 class="solved-dialog-title" id="solvedDialogTitle">سجل عمليات الحل الناجحة</h2>
          <p class="solved-dialog-summary" id="solvedDialogSummary"></p>
        </div>
        <button class="solved-dialog-close" id="closeSolvedDialog" type="button" aria-label="إغلاق">×</button>
      </header>
      <div class="solved-events" id="solvedEvents" aria-live="polite"></div>
    </div>
  </dialog>
  <div class="toast" id="toast" role="status"></div>
  <script>
    const jobsRoot = document.getElementById("jobs");
    const errorBox = document.getElementById("error");
    const browserToggle = document.getElementById("browserVisible");
    const siteToggle = document.getElementById("siteEnabled");
    const solvedDialog = document.getElementById("solvedDialog");
    const userRows = document.getElementById("userRows");
    const usersError = document.getElementById("usersError");
    const userPageSize = 50;
    let lastPayload = null;
    let refreshing = false;
    let usersOffset = 0;
    let usersRequestId = 0;
    let usersLoaded = false;
    let usersSearchTimer;
    let toastTimer;
    let subscriptionCodesLoaded = false;

    function showToast(message) {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
    }

    function addText(parent, tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      element.textContent = text == null ? "" : String(text);
      parent.appendChild(element);
      return element;
    }

    function formatUserDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? "غير متاح"
        : date.toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" });
    }

    function renderUsers(data) {
      document.getElementById("totalUsers").textContent = data.total_users;
      document.getElementById("activeUsers").textContent = data.active_users;
      document.getElementById("blockedUsers").textContent = data.blocked_users;
      document.getElementById("usersUpdated").textContent =
        "آخر تحديث " + new Date().toLocaleTimeString("ar-EG");
      document.getElementById("usersCount").textContent =
        data.total ? "عرض " + (data.offset + 1) + "–" + Math.min(data.offset + data.users.length, data.total) + " من " + data.total : "لا توجد نتائج";
      document.getElementById("usersPage").textContent =
        Math.floor(data.offset / userPageSize) + 1 + " / " + Math.max(1, Math.ceil(data.total / userPageSize));
      document.getElementById("usersPrevious").disabled = data.offset <= 0;
      document.getElementById("usersNext").disabled = data.offset + userPageSize >= data.total;
      userRows.replaceChildren();
      document.getElementById("usersEmpty").hidden = data.users.length > 0;

      data.users.forEach((user) => {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        addText(nameCell, "div", "user-primary", user.full_name);
        row.appendChild(nameCell);

        const emailCell = document.createElement("td");
        addText(emailCell, "div", "user-email", user.email || "—");
        row.appendChild(emailCell);

        const roleCell = document.createElement("td");
        addText(
          roleCell,
          "span",
          "user-role" + (user.role === "admin" ? " admin" : ""),
          user.role === "admin" ? "مدير" : "مستخدم"
        );
        row.appendChild(roleCell);

        const stateCell = document.createElement("td");
        addText(
          stateCell,
          "span",
          "user-state " + (user.is_blocked ? "blocked" : "active"),
          user.is_blocked ? "محظور" : "نشط"
        );
        row.appendChild(stateCell);

        const dateCell = document.createElement("td");
        dateCell.textContent = formatUserDate(user.created_at);
        row.appendChild(dateCell);

        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "user-actions";
        if (user.role === "admin") {
          addText(actions, "span", "user-role admin", "حساب محمي");
        } else {
          const toggleButton = addText(
            actions,
            "button",
            "user-action" + (user.is_blocked ? "" : " danger"),
            user.is_blocked ? "فك الحظر" : "حظر"
          );
          toggleButton.type = "button";
          toggleButton.addEventListener("click", () => manageUser(
            user,
            user.is_blocked ? "unblock" : "block",
            toggleButton
          ));

          const deleteButton = addText(actions, "button", "user-action danger", "حذف");
          deleteButton.type = "button";
          deleteButton.addEventListener("click", () => manageUser(user, "delete", deleteButton));
        }
        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);
        userRows.appendChild(row);
      });
    }

    function renderSubscriptionCodes(codes) {
      const rows = document.getElementById("subscriptionCodeRows");
      rows.replaceChildren();
      document.getElementById("subscriptionCodesEmpty").hidden = codes.length > 0;
      codes.forEach((code) => {
        const row = document.createElement("tr");
        addText(row, "td", "", code.plan_name);
        addText(
          row,
          "td",
          "",
          code.status === "redeemed" ? "مستخدم" : "متاح"
        );
        addText(row, "td", "", formatUserDate(code.created_at));
        addText(
          row,
          "td",
          "",
          code.redeemed_at ? formatUserDate(code.redeemed_at) : "—"
        );
        addText(
          row,
          "td",
          "user-email",
          code.redeemed_by ? code.redeemed_by.slice(0, 8) : "—"
        );
        rows.appendChild(row);
      });
      document.getElementById("subscriptionCodesUpdated").textContent =
        "آخر تحديث " + new Date().toLocaleTimeString("ar-EG");
    }

    async function loadSubscriptionCodes() {
      const error = document.getElementById("subscriptionCodesError");
      error.hidden = true;
      try {
        const response = await fetch(
          "/api/admin/subscription-codes?limit=100",
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "تعذّر تحميل أكواد الاشتراك.");
        }
        subscriptionCodesLoaded = true;
        renderSubscriptionCodes(data.codes || []);
      } catch (loadError) {
        error.textContent = loadError.message || "تعذّر تحميل أكواد الاشتراك.";
        error.hidden = false;
      }
    }

    async function createSubscriptionCode() {
      const button = document.getElementById("createSubscriptionCode");
      const error = document.getElementById("subscriptionCodesError");
      button.disabled = true;
      error.hidden = true;
      document.getElementById("subscriptionCodeResult").hidden = true;
      try {
        const response = await fetch("/api/admin/subscription-codes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_key: document.getElementById("subscriptionPlan").value
          })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "تعذّر إنشاء كود الاشتراك.");
        }
        document.getElementById("subscriptionCodeValue").textContent = data.code;
        document.getElementById("subscriptionCodeResult").hidden = false;
        showToast("تم إنشاء الكود. انسخه الآن وشاركه مع صاحبه.");
        await loadSubscriptionCodes();
      } catch (createError) {
        error.textContent = createError.message || "تعذّر إنشاء كود الاشتراك.";
        error.hidden = false;
      } finally {
        button.disabled = false;
      }
    }

    async function loadUsers(offset) {
      const requestId = ++usersRequestId;
      usersOffset = Math.max(0, offset || 0);
      usersError.hidden = true;
      const params = new URLSearchParams({
        limit: String(userPageSize),
        offset: String(usersOffset),
        q: document.getElementById("userSearch").value.trim(),
        status: document.getElementById("userStatus").value
      });
      try {
        const response = await fetch("/api/admin/users?" + params.toString(), { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "تعذّر تحميل المستخدمين.");
        if (requestId !== usersRequestId) return;
        const lastOffset = Math.max(0, Math.ceil(data.total / userPageSize) - 1) * userPageSize;
        if (usersOffset > lastOffset) {
          await loadUsers(lastOffset);
          return;
        }
        usersLoaded = true;
        renderUsers(data);
      } catch (error) {
        if (requestId !== usersRequestId) return;
        usersError.textContent = error.message || "تعذّر تحميل قائمة المستخدمين.";
        usersError.hidden = false;
      }
    }

    async function manageUser(user, action, button) {
      const actionLabel = action === "delete"
        ? "حذف الحساب نهائيًا"
        : action === "block" ? "حظر المستخدم" : "فك حظر المستخدم";
      if (!window.confirm(actionLabel + " لـ " + user.full_name + (action === "delete" ? "؟ لا يمكن التراجع عن هذا الإجراء." : "؟"))) {
        return;
      }
      button.disabled = true;
      try {
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: user.id, action })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || "تعذّر تحديث المستخدم.");
        showToast(data.message);
        await loadUsers(usersOffset);
      } catch (error) {
        showToast(error.message || "تعذّر تحديث المستخدم.");
        button.disabled = false;
      }
    }

    async function loadAdminIdentity() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await response.json();
        const identity = document.getElementById("adminIdentity");
        identity.replaceChildren();
        if (response.ok && data.user && data.user.role === "admin") {
          addText(identity, "strong", "", data.user.full_name);
          addText(identity, "span", "", data.user.email);
        } else {
          addText(identity, "strong", "", "المدير المحلي");
          addText(identity, "span", "", "جلسة الإدارة المحلية");
        }
      } catch (error) {
        document.getElementById("adminIdentity").textContent =
          error.message || "تعذّر التحقق من حساب المدير.";
      }
    }

    function selectView(viewId) {
      document.querySelectorAll(".view").forEach((view) => {
        view.hidden = view.id !== viewId;
      });
      document.querySelectorAll(".nav-item").forEach((button) => {
        const active = button.dataset.view === viewId;
        button.classList.toggle("active", active);
        button.setAttribute("aria-current", active ? "page" : "false");
      });
      if (viewId === "usersView" && !usersLoaded) loadUsers(0);
      if (viewId === "subscriptionCodesView" && !subscriptionCodesLoaded) {
        loadSubscriptionCodes();
      }
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Number(seconds) || 0);
      if (total < 60) return total + " ث";
      const minutes = Math.floor(total / 60);
      const remainingSeconds = total % 60;
      if (minutes < 60) return minutes + " د " + remainingSeconds + " ث";
      return Math.floor(minutes / 60) + " س " + (minutes % 60) + " د";
    }

    function formatSolvedDate(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "وقت غير متاح" : date.toLocaleString("ar-EG");
    }

    function showSolvedEvents() {
      if (!lastPayload) {
        showToast("انتظر حتى يتم تحميل بيانات لوحة الإدارة.");
        return;
      }
      const events = Array.isArray(lastPayload.solved_events) ? lastPayload.solved_events : [];
      const summary = document.getElementById("solvedDialogSummary");
      summary.textContent = events.length + " عملية ناجحة محفوظة. يُعرض السجل كاملًا.";
      const eventsRoot = document.getElementById("solvedEvents");
      eventsRoot.replaceChildren();
      if (!events.length) {
        addText(
          eventsRoot,
          "div",
          "solved-empty",
          "لا توجد عمليات حل ناجحة مسجلة بعد."
        );
      } else {
        [...events].reverse().forEach((event) => {
          const entry = document.createElement("article");
          entry.className = "solved-event";
          const head = document.createElement("div");
          head.className = "solved-event-head";
          addText(head, "span", "solved-event-code", event.code);
          addText(head, "span", "solved-event-detail", event.detail || event.mode || "حل");
          entry.appendChild(head);
          const owner = document.createElement("div");
          owner.className = "solved-event-owner";
          addText(owner, "span", "", "الاسم: " + (event.user_name || "غير مسجل"));
          addText(owner, "span", "solved-event-email", "البريد: " + (event.user_email || "غير متاح"));
          entry.appendChild(owner);
          const meta = document.createElement("div");
          meta.className = "solved-event-meta";
          addText(meta, "span", "solved-event-duration", "مدة الحل: " + formatDuration(event.duration_seconds));
          addText(meta, "span", "", "وقت الاكتمال: " + formatSolvedDate(event.solved_at));
          entry.appendChild(meta);
          eventsRoot.appendChild(entry);
        });
      }
      solvedDialog.showModal();
    }

    function render(data) {
      document.getElementById("queueCount").textContent = data.queue_count;
      document.getElementById("runningCount").textContent = data.running_count;
      document.getElementById("activeJobCount").textContent = data.active_job_count;
      document.getElementById("solvedCount").textContent = data.solved_count;
      document.getElementById("updated").textContent = "آخر تحديث " + new Date().toLocaleTimeString("ar-EG");
      errorBox.hidden = true;
      jobsRoot.replaceChildren();

      const query = document.getElementById("searchJobs").value.trim().toLocaleLowerCase();
      const status = document.getElementById("statusFilter").value;
      const jobs = data.jobs.filter((job) => {
        const searchable = [job.code, job.detail, job.phase].join(" ").toLocaleLowerCase();
        return (!query || searchable.includes(query))
          && (status === "all" || (status === "running" ? job.running : !job.running));
      });

      if (!jobs.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        const content = document.createElement("div");
        const hasActiveJobs = data.jobs.length > 0;
        addText(content, "strong", "", hasActiveJobs ? "لا توجد نتائج مطابقة" : "الطابور فارغ حاليًا");
        addText(content, "span", "", hasActiveJobs ? "غيّر كلمات البحث أو التصفية لعرض حسابات أخرى." : "ستظهر هنا الحسابات الجديدة فور إضافتها.");
        empty.appendChild(content);
        jobsRoot.appendChild(empty);
        return;
      }

      jobs.forEach((job) => {
        const row = document.createElement("article");
        row.className = "job";
        const position = addText(row, "div", "position" + (job.running ? " is-running" : ""), job.position);
        position.setAttribute("aria-label", (job.running ? "قيد الحل، " : "") + "الترتيب " + job.position);

        const code = document.createElement("div");
        code.className = "job-code";
        addText(code, "span", "field-label", "كود الحساب");
        addText(code, "div", "code", job.code);
        row.appendChild(code);

        const detail = document.createElement("div");
        detail.className = "job-detail";
        addText(detail, "span", "field-label", "المسار");
        addText(detail, "div", "detail", job.detail || job.mode || "حل");
        row.appendChild(detail);

        const state = document.createElement("div");
        state.className = "job-state";
        addText(state, "span", "field-label", "الحالة");
        addText(state, "div", "phase", job.phase || (job.running ? "جاري الحل..." : "في الانتظار"));
        addText(state, "span", "tag " + (job.running ? "running" : "waiting"), job.running ? "قيد الحل" : "في الطابور");
        addText(
          state,
          "div",
          "elapsed",
          job.running
            ? "مدة الحل: " + formatDuration(job.elapsed_seconds)
            : "في الانتظار منذ: " + formatDuration(job.queued_seconds)
        );
        row.appendChild(state);

        const progressData = job.progress || {};
        const total = Math.max(0, Number(progressData.total) || 0);
        const done = Math.max(0, Number(progressData.done) || 0);
        const percent = total
          ? Math.max(0, Math.min(100, Number(progressData.pct) || Math.round(done / total * 100)))
          : 0;
        const progress = document.createElement("div");
        progress.className = "job-progress";
        const progressInfo = document.createElement("div");
        progressInfo.className = "progress-info";
        addText(progressInfo, "span", "progress-title", progressData.title || (job.running ? "جاري تجهيز الحل..." : "بانتظار البدء"));
        addText(progressInfo, "span", "progress-percent", total ? percent + "%" : "—");
        progress.appendChild(progressInfo);
        const progressTrack = document.createElement("div");
        progressTrack.className = "progress-track";
        progressTrack.setAttribute("role", "progressbar");
        progressTrack.setAttribute("aria-valuemin", "0");
        progressTrack.setAttribute("aria-valuemax", "100");
        progressTrack.setAttribute("aria-valuenow", String(percent));
        const progressBar = document.createElement("i");
        progressBar.style.width = percent + "%";
        progressTrack.appendChild(progressBar);
        progress.appendChild(progressTrack);
        addText(
          progress,
          "div",
          "progress-meta",
          total ? done + " من " + total : "لا توجد بيانات تقدم بعد"
        );
        row.appendChild(progress);

        const action = document.createElement("div");
        action.className = "job-action";
        const button = addText(action, "button", "skip", job.running ? "بدأ الحل" : "ابدأ الآن");
        button.type = "button";
        button.disabled = job.running;
        button.dataset.jobId = job.id;
        button.addEventListener("click", () => startNow(button));
        row.appendChild(action);
        jobsRoot.appendChild(row);
      });
    }

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/admin/queue", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "تعذّر تحميل الطابور.");
        lastPayload = data;
        render(data);
      } catch (error) {
        errorBox.textContent = error.message || "تعذّر الاتصال بالخادم المحلي.";
        errorBox.hidden = false;
      } finally {
        refreshing = false;
      }
    }

    async function startNow(button) {
      button.disabled = true;
      try {
        const response = await fetch("/api/admin/start-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: button.dataset.jobId })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || "تعذّر بدء العملية.");
        showToast(data.message);
        await refresh();
      } catch (error) {
        showToast(error.message || "تعذّر بدء العملية.");
        button.disabled = false;
      }
    }

    async function loadBrowserSetting() {
      try {
        const response = await fetch("/api/admin/settings", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "تعذّر تحميل إعداد المتصفح.");
        browserToggle.checked = data.browser_visible;
        document.getElementById("browserSettingState").textContent =
          data.browser_visible ? "المتصفح سيظهر" : "المتصفح مخفي";
        browserToggle.disabled = false;
      } catch (error) {
        document.getElementById("browserSettingState").textContent = "تعذّر تحميل الإعداد";
        errorBox.textContent = error.message || "تعذّر تحميل إعداد المتصفح.";
        errorBox.hidden = false;
      }
    }

    function renderSiteSetting(enabled) {
      siteToggle.checked = enabled;
      const state = document.getElementById("siteSettingState");
      state.textContent = enabled
        ? "الموقع متاح للزوار"
        : "الموقع متوقف — تظهر صفحة الصيانة";
      state.classList.toggle("is-disabled", !enabled);
    }

    async function loadSiteSetting() {
      siteToggle.disabled = true;
      try {
        const response = await fetch("/api/admin/site-status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "تعذّر تحميل حالة الموقع.");
        }
        renderSiteSetting(data.enabled);
        siteToggle.disabled = false;
      } catch (error) {
        document.getElementById("siteSettingState").textContent =
          "تعذّر تحميل الحالة من قاعدة البيانات";
        showToast(error.message || "تعذّر تحميل حالة الموقع.");
      }
    }

    async function saveSiteSetting() {
      const nextValue = siteToggle.checked;
      renderSiteSetting(nextValue);
      try {
        const response = await fetch("/api/admin/site-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextValue })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "تعذّر حفظ حالة الموقع.");
        }
        renderSiteSetting(data.enabled);
        showToast(data.message);
      } catch (error) {
        renderSiteSetting(!nextValue);
        showToast(error.message || "تعذّر حفظ حالة الموقع.");
      }
    }

    async function saveBrowserSetting() {
      const nextValue = browserToggle.checked;
      browserToggle.disabled = true;
      try {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browser_visible: nextValue })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || "تعذّر حفظ إعداد المتصفح.");
        document.getElementById("browserSettingState").textContent =
          data.browser_visible ? "المتصفح سيظهر" : "المتصفح مخفي";
        showToast(data.message);
      } catch (error) {
        browserToggle.checked = !nextValue;
        showToast(error.message || "تعذّر حفظ إعداد المتصفح.");
      } finally {
        browserToggle.disabled = false;
      }
    }

    document.getElementById("searchJobs").addEventListener("input", () => {
      if (lastPayload) render(lastPayload);
    });
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => selectView(button.dataset.view));
    });
    document.getElementById("userSearch").addEventListener("input", () => {
      clearTimeout(usersSearchTimer);
      usersSearchTimer = setTimeout(() => loadUsers(0), 250);
    });
    document.getElementById("userStatus").addEventListener("change", () => loadUsers(0));
    document.getElementById("usersRefresh").addEventListener("click", () => loadUsers(usersOffset));
    document.getElementById("usersPrevious").addEventListener("click", () => {
      loadUsers(Math.max(0, usersOffset - userPageSize));
    });
    document.getElementById("usersNext").addEventListener("click", () => {
      loadUsers(usersOffset + userPageSize);
    });
    document.getElementById("createSubscriptionCode").addEventListener(
      "click",
      createSubscriptionCode
    );
    document.getElementById("subscriptionCodesRefresh").addEventListener(
      "click",
      loadSubscriptionCodes
    );
    document.getElementById("copySubscriptionCode").addEventListener(
      "click",
      async () => {
        const code = document.getElementById("subscriptionCodeValue").textContent;
        try {
          await navigator.clipboard.writeText(code);
          showToast("تم نسخ الكود.");
        } catch (error) {
          showToast("انسخ الكود يدويًا من الحقل.");
        }
      }
    );
    document.getElementById("statusFilter").addEventListener("change", () => {
      if (lastPayload) render(lastPayload);
    });
    document.getElementById("refreshButton").addEventListener("click", refresh);
    document.getElementById("solvedCard").addEventListener("click", showSolvedEvents);
    document.getElementById("closeSolvedDialog").addEventListener("click", () => solvedDialog.close());
    browserToggle.addEventListener("change", saveBrowserSetting);
    siteToggle.addEventListener("change", saveSiteSetting);
    document.getElementById("previewSiteButton").addEventListener("click", () => {
      window.open("/", "_blank", "noopener");
    });

    refresh();
    loadBrowserSetting();
    loadSiteSetting();
    loadAdminIdentity();
    setInterval(refresh, 2000);
  </script>
</body>
</html>
"""
