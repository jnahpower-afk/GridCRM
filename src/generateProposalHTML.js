// ─────────────────────────────────────────────────────────────────────────────
// generateProposalHTML.js
// Produces a self-contained Grid CRM private wire proposal HTML document.
// ─────────────────────────────────────────────────────────────────────────────

// UK solar irradiance monthly distribution (fraction of annual generation)
const UK_SOLAR_FACTORS = [0.028, 0.040, 0.082, 0.110, 0.135, 0.137, 0.133, 0.113, 0.088, 0.058, 0.035, 0.031];
// UK commercial electricity demand monthly distribution (slightly higher in winter)
const UK_DEMAND_FACTORS = [0.0980, 0.0880, 0.0920, 0.0810, 0.0780, 0.0750, 0.0790, 0.0780, 0.0760, 0.0840, 0.0840, 0.0870];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function computeMonthly(annualDemand, annualGen, hasExport) {
  return MONTHS_SHORT.map((month, i) => {
    const demand       = Math.round(annualDemand * UK_DEMAND_FACTORS[i]);
    const generation   = Math.round(annualGen    * UK_SOLAR_FACTORS[i]);
    const solarConsumed = Math.min(generation, demand);
    const gridExport   = hasExport ? Math.max(0, generation - demand) : 0;
    const gridImport   = demand - solarConsumed;
    return { month, demand, gridImport, solarConsumed, gridExport, generation };
  });
}

function computeGanttQuarters(proposalDate) {
  const d = new Date(proposalDate || Date.now());
  const m = d.getMonth(); // 0-11
  const y = d.getFullYear();
  // Start from the *current* quarter
  let q = Math.floor(m / 3); // 0=Q1, 1=Q2, 2=Q3, 3=Q4
  const qLabels   = ['Jan – Mar','Apr – Jun','Jul – Sep','Oct – Dec'];
  const qTitles   = ['Q1','Q2','Q3','Q4'];
  const quarters  = [];
  for (let i = 0; i < 4; i++) {
    const qi = (q + i) % 4;
    const yi = y + Math.floor((q + i) / 4);
    quarters.push({ q: `${qTitles[qi]} ${yi}`, m: qLabels[qi] });
  }
  return quarters;
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
  :root {
    --orange:#F8632C;--orange-deep:#D94E1A;--orange-tint:#FDEADF;
    --ink:#0E0E0E;--ink-soft:#2A2A2A;--muted:#6B6B6B;
    --line:#E6E2DB;--paper:#F6F4F0;--paper-deep:#ECE7DD;--white:#FFFFFF;
    --teal:#1F3D4A;--teal-soft:#5A7984;--gold:#E4B44A;
    --display:"Figtree",ui-sans-serif,system-ui,sans-serif;
    --body:"Inter",ui-sans-serif,system-ui,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,monospace;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--body);}
  body{font-size:17px;line-height:1.55;-webkit-font-smoothing:antialiased;}
  a{color:inherit;} img{max-width:100%;display:block;}
  ::selection{background:var(--orange);color:white;}

  /* Nav */
  .topnav{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:18px 40px;backdrop-filter:blur(14px);background:rgba(246,244,240,0.72);border-bottom:1px solid transparent;transition:background .25s ease,border-color .25s ease;}
  .topnav.scrolled{background:rgba(246,244,240,0.92);border-bottom-color:var(--line);}
  .topnav .brand{display:flex;align-items:center;gap:12px;font-family:var(--display);font-weight:800;letter-spacing:-0.3px;font-size:18px;white-space:nowrap;flex-shrink:0;}
  .topnav .brand .x{color:var(--muted);font-weight:500;font-size:15px;margin:0 2px;}
  .topnav .meta{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);white-space:nowrap;flex-shrink:0;}
  @media(max-width:1280px){.topnav .meta{display:none;}}
  .topnav nav{display:flex;gap:28px;font-family:var(--mono);font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted);margin-left:40px;padding-left:32px;border-left:1px solid var(--line);}
  .topnav nav a{text-decoration:none;padding:4px 2px;border-bottom:1px solid transparent;transition:color .15s,border-color .15s;}
  .topnav nav a:hover,.topnav nav a.active{color:var(--ink);border-bottom-color:var(--orange);}
  @media(max-width:900px){.topnav nav{display:none;}}

  /* Sections */
  section{position:relative;}
  .container{max-width:1280px;margin:0 auto;padding:0 40px;}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--muted);}
  h1,h2,h3{font-family:var(--display);font-weight:700;letter-spacing:-1px;line-height:1.02;margin:0;}
  h2{font-size:clamp(40px,5.5vw,84px);margin-bottom:20px;}
  h3{font-size:clamp(26px,2.4vw,38px);}
  p{text-wrap:pretty;}
  p.lede{font-size:clamp(20px,1.7vw,26px);line-height:1.4;color:var(--ink-soft);max-width:860px;}

  /* HERO */
  .hero{min-height:100vh;background:var(--ink);color:white;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;padding:120px 40px 80px;}
  .hero .bloom{position:absolute;top:-20%;right:-15%;width:1100px;height:1100px;border-radius:50%;background:radial-gradient(closest-side,rgba(248,99,44,0.6),transparent 70%);pointer-events:none;}
  .hero .grid{position:absolute;inset:0;pointer-events:none;opacity:0.15;background-image:linear-gradient(rgba(255,255,255,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.08) 1px,transparent 1px);background-size:80px 80px;}
  .hero-inner{max-width:1280px;margin:0 auto;width:100%;position:relative;}
  .hero .kicker{font-family:var(--mono);font-size:12px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:14px;margin-bottom:40px;}
  .hero .kicker .tag{padding:6px 12px;border:1px solid rgba(248,99,44,0.4);border-radius:999px;color:var(--orange);}
  .hero h1{font-size:clamp(56px,9vw,140px);line-height:0.95;letter-spacing:-3px;font-weight:800;margin:0 0 32px;max-width:14ch;}
  .hero h1 .orange{color:var(--orange);font-style:italic;font-weight:700;}
  .hero .sub{max-width:640px;font-size:clamp(17px,1.4vw,22px);line-height:1.45;color:rgba(255,255,255,0.75);margin-bottom:56px;}
  .hero .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:32px;border-top:1px solid rgba(255,255,255,0.1);padding-top:32px;}
  .hero .stat .num{font-family:var(--display);font-size:clamp(34px,3.6vw,56px);font-weight:800;letter-spacing:-1.5px;line-height:1;white-space:nowrap;}
  .hero .stat .num .u{font-family:var(--mono);font-weight:500;font-size:0.5em;color:var(--orange);margin-left:6px;letter-spacing:1px;}
  .hero .stat .label{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.55);margin-top:10px;}
  @media(max-width:900px){.hero .stats{grid-template-columns:repeat(2,1fr);}}
  .hero .scroll{position:absolute;bottom:32px;left:40px;font-family:var(--mono);font-size:11px;letter-spacing:2px;color:rgba(255,255,255,0.5);text-transform:uppercase;display:flex;align-items:center;gap:10px;}
  .hero .scroll .line{width:40px;height:1px;background:rgba(255,255,255,0.4);}

  /* Section padding */
  .sec{padding:120px 0;border-top:1px solid var(--line);}
  .sec-head{display:flex;flex-direction:column;gap:14px;margin-bottom:64px;}
  .sec-head .num{font-family:var(--mono);font-size:13px;letter-spacing:3px;color:var(--orange);text-transform:uppercase;font-weight:600;}

  /* Pillars */
  .pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;}
  @media(max-width:900px){.pillars{grid-template-columns:1fr;}}
  .pillar{background:var(--white);border:1px solid var(--line);border-radius:20px;padding:32px;display:flex;flex-direction:column;gap:16px;min-height:260px;position:relative;overflow:hidden;transition:transform .3s ease,box-shadow .3s ease;}
  .pillar:hover{transform:translateY(-4px);box-shadow:0 20px 40px -20px rgba(0,0,0,0.15);}
  .pillar .tag{font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--orange);text-transform:uppercase;font-weight:600;}
  .pillar .big{font-family:var(--display);font-size:56px;font-weight:800;letter-spacing:-2px;line-height:0.95;}
  .pillar .big .u{font-size:0.45em;color:var(--muted);font-weight:500;margin-left:6px;font-family:var(--mono);letter-spacing:1px;}
  .pillar h3{font-size:28px;}
  .pillar p{margin:0;font-size:15px;color:var(--ink-soft);line-height:1.5;}
  .pillar.dark{background:var(--ink);color:white;border-color:var(--ink);}
  .pillar.dark p{color:rgba(255,255,255,0.7);}
  .pillar.dark .tag{color:var(--orange);}

  /* Scenario toggle */
  .toggle-wrap{display:flex;justify-content:center;margin-bottom:56px;}
  .toggle{display:inline-flex;border:1px solid var(--line);border-radius:999px;background:var(--white);padding:4px;gap:4px;}
  .toggle button{border:0;background:transparent;font-family:var(--mono);font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:12px 26px;border-radius:999px;cursor:pointer;color:var(--muted);transition:all .2s ease;font-weight:600;}
  .toggle button.on{background:var(--ink);color:white;}
  .scenario{background:var(--white);border:1px solid var(--line);border-radius:24px;padding:48px;display:grid;grid-template-columns:1fr 1.4fr;gap:48px;}
  @media(max-width:1000px){.scenario{grid-template-columns:1fr;padding:32px;}}
  .scenario-left .scenario-tag{font-family:var(--mono);font-size:12px;letter-spacing:3px;color:var(--orange);text-transform:uppercase;font-weight:600;margin-bottom:16px;}
  .scenario-left h3{font-size:clamp(32px,3vw,46px);margin-bottom:20px;}
  .scenario-left p{color:var(--ink-soft);max-width:46ch;margin:0 0 32px;}
  .kpi-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
  .kpi{background:var(--paper);border-radius:14px;padding:20px;}
  .kpi .l{font-family:var(--mono);font-size:10px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;font-weight:600;margin-bottom:8px;}
  .kpi .v{font-family:var(--display);font-size:32px;font-weight:700;letter-spacing:-1px;line-height:1;}
  .kpi .v .u{font-size:0.5em;color:var(--muted);font-weight:500;margin-left:4px;font-family:var(--mono);}
  .chart-wrap{display:flex;flex-direction:column;gap:16px;}
  .chart-title{display:flex;justify-content:space-between;align-items:baseline;}
  .chart-title .t{font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;font-weight:600;}
  .legend{display:flex;gap:16px;font-family:var(--mono);font-size:11px;letter-spacing:1px;color:var(--muted);text-transform:uppercase;}
  .legend .d{display:flex;align-items:center;gap:8px;}
  .legend .sw{width:14px;height:14px;border-radius:3px;}
  .legend .sw.sw-line{height:3px;border-radius:2px;align-self:center;}

  /* Compare */
  .compare-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--white);border:1px solid var(--line);border-radius:18px;overflow:hidden;}
  .compare-table th,.compare-table td{padding:20px 24px;text-align:left;border-bottom:1px solid var(--line);font-size:15px;}
  .compare-table tr:last-child td{border-bottom:0;}
  .compare-table th{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);font-weight:600;background:var(--paper);}
  .compare-table td.metric{font-family:var(--mono);font-size:12px;letter-spacing:1px;color:var(--muted);text-transform:uppercase;font-weight:600;width:260px;}
  .compare-table td .v{font-family:var(--display);font-size:22px;font-weight:700;letter-spacing:-0.5px;}
  .compare-table td .v.win{color:var(--orange-deep);}
  .compare-table tbody tr:hover{background:rgba(246,244,240,0.5);}

  /* PPA */
  .ppa-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
  @media(max-width:1000px){.ppa-grid{grid-template-columns:repeat(2,1fr);}}
  .ppa-card{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:16px;min-height:300px;}
  .ppa-card.dark{background:var(--ink);color:white;border-color:var(--ink);}
  .ppa-card.dark .ppa-tag{color:var(--orange);}
  .ppa-card.dark li{color:rgba(255,255,255,0.8);}
  .ppa-card.dark hr{border-color:rgba(255,255,255,0.15);}
  .ppa-tag{font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--orange);text-transform:uppercase;font-weight:700;}
  .ppa-card h3{font-size:26px;letter-spacing:-0.5px;}
  .ppa-card hr{border:0;border-top:1px solid var(--line);margin:4px 0;}
  .ppa-card ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;}
  .ppa-card li{font-size:14px;line-height:1.5;color:var(--ink-soft);display:flex;gap:10px;}
  .ppa-card li::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--orange);margin-top:9px;flex-shrink:0;}

  /* Gantt */
  .gantt{border:1px solid var(--line);border-radius:18px;background:var(--white);overflow:hidden;}
  .gantt-head{display:grid;grid-template-columns:240px repeat(4,1fr);background:var(--paper);border-bottom:1px solid var(--line);}
  .gantt-head>div:not(:first-child){padding:18px 20px;border-left:1px solid var(--line);}
  .gantt-head .q{font-family:var(--display);font-size:22px;font-weight:800;letter-spacing:-0.5px;}
  .gantt-head .m{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;}
  .gantt-row{display:grid;grid-template-columns:240px repeat(4,1fr);align-items:center;padding:10px 0;position:relative;border-bottom:1px solid var(--paper-deep);}
  .gantt-row:last-child{border-bottom:0;}
  .gantt-row .name{padding:0 20px;font-size:14px;font-weight:600;}
  .gantt-row .col-divide{position:absolute;inset:0;display:grid;grid-template-columns:240px repeat(4,1fr);pointer-events:none;}
  .gantt-row .col-divide>div:not(:first-child){border-left:1px dashed var(--line);}
  .gantt-bar{margin:0 10px;height:36px;border-radius:8px;display:flex;align-items:center;padding:0 16px;color:white;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative;z-index:1;}
  .gantt-bar.ink{background:var(--ink);}
  .gantt-bar.orange{background:var(--orange);}

  /* Location */
  .location{background:var(--ink);color:white;border-radius:24px;padding:48px;margin-bottom:32px;position:relative;overflow:hidden;}
  .location::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 80% 0%,rgba(248,99,44,0.18),transparent 60%);pointer-events:none;}
  .loc-head{position:relative;z-index:1;max-width:760px;margin-bottom:36px;}
  .loc-kicker{font-family:var(--mono);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--orange);font-weight:600;margin-bottom:12px;}
  .loc-title{font-family:var(--display);font-weight:700;font-size:36px;letter-spacing:-1px;line-height:1.05;margin-bottom:14px;}
  .loc-sub{color:rgba(255,255,255,0.65);font-size:15px;line-height:1.55;max-width:62ch;}
  .loc-frames{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;position:relative;z-index:1;}
  @media(max-width:900px){.loc-frames{grid-template-columns:1fr;}}
  .loc-frame{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:18px;position:relative;aspect-ratio:1/1.1;display:flex;flex-direction:column;}
  .loc-frame[data-stage="3"]{border-color:rgba(248,99,44,0.45);background:rgba(248,99,44,0.05);}
  .loc-label{font-family:var(--mono);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.7);display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .loc-label .i{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.08);font-size:9px;font-weight:700;color:rgba(255,255,255,0.9);}
  .loc-frame[data-stage="3"] .loc-label .i{background:var(--orange);color:white;}
  .loc-svg{flex:1;width:100%;height:100%;min-height:0;}
  .loc-scale{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:9px;color:rgba(255,255,255,0.45);letter-spacing:1px;margin-top:8px;}
  .loc-scale .bar{flex:1;height:1px;background:rgba(255,255,255,0.3);}
  @keyframes locPulse{0%,100%{transform:scale(1);opacity:0.7;}50%{transform:scale(1.5);opacity:0;}}
  @keyframes locGlow{0%,100%{opacity:0.5;}50%{opacity:0.9;}}
  .loc-frame .loc-pin-ring{transform-origin:center;transform-box:fill-box;animation:locPulse 2.4s ease-out infinite;}
  .loc-frame .loc-glow{transform-origin:center;transform-box:fill-box;animation:locGlow 3s ease-in-out infinite;}

  /* About */
  .about{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:start;}
  @media(max-width:900px){.about{grid-template-columns:1fr;}}
  .credentials{display:flex;flex-direction:column;gap:32px;}
  .cred .n{font-family:var(--display);font-size:64px;font-weight:800;letter-spacing:-3px;line-height:1;}
  .cred .l{font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:8px;}

  /* FAQs */
  .faq-list{display:flex;flex-direction:column;gap:0;}
  .faq{border-top:1px solid var(--line);padding:0;}
  .faq:last-child{border-bottom:1px solid var(--line);}
  .faq summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:28px 0;list-style:none;gap:24px;}
  .faq summary::-webkit-details-marker{display:none;}
  .faq summary h3{font-size:clamp(20px,1.8vw,28px);letter-spacing:-0.5px;flex:1;}
  .faq .plus{font-size:24px;color:var(--muted);transition:transform .25s ease;flex-shrink:0;}
  .faq[open] .plus{transform:rotate(45deg);}
  .faq .a{padding:0 0 28px;color:var(--ink-soft);font-size:15px;line-height:1.7;max-width:72ch;}

  /* Next steps */
  .next{background:var(--ink);color:white;border-radius:24px;padding:80px;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:start;position:relative;overflow:hidden;}
  @media(max-width:900px){.next{grid-template-columns:1fr;padding:48px;}}
  .next .bloom{position:absolute;top:-30%;right:-20%;width:800px;height:800px;border-radius:50%;background:radial-gradient(closest-side,rgba(248,99,44,0.35),transparent 70%);pointer-events:none;}
  .next h2{color:white;}
  .next p{color:rgba(255,255,255,0.7);}
  .cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:32px;}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:16px 28px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;transition:all .2s ease;font-family:var(--display);}
  .btn.primary{background:var(--orange);color:white;}
  .btn.primary:hover{background:var(--orange-deep);}
  .steps{display:flex;flex-direction:column;gap:0;position:relative;}
  .step{display:flex;gap:24px;padding:24px 0;border-bottom:1px solid rgba(255,255,255,0.08);align-items:flex-start;}
  .step:last-child{border-bottom:0;}
  .step .n{font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--orange);font-weight:700;padding-top:4px;flex-shrink:0;}
  .step .t{font-size:18px;font-weight:700;margin-bottom:4px;font-family:var(--display);}
  .step .d{font-size:14px;color:rgba(255,255,255,0.6);}

  /* Downloads */
  .downloads{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;}
  @media(max-width:700px){.downloads{grid-template-columns:1fr;}}
  .dl{background:var(--white);border:1px solid var(--line);border-radius:18px;padding:32px;display:flex;flex-direction:column;gap:12px;text-decoration:none;transition:transform .25s ease,box-shadow .25s ease;}
  .dl:hover{transform:translateY(-4px);box-shadow:0 20px 40px -20px rgba(0,0,0,0.2);}
  .dl .type{display:flex;justify-content:space-between;align-items:center;font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);font-weight:600;}
  .dl .arrow{color:var(--orange);font-size:18px;}
  .dl h3{font-size:28px;letter-spacing:-0.5px;}
  .dl p{font-size:14px;color:var(--muted);margin:0;}

  /* Footer */
  footer{background:var(--ink);color:rgba(255,255,255,0.55);font-family:var(--mono);font-size:12px;letter-spacing:1.5px;text-transform:uppercase;padding:40px;display:flex;flex-direction:column;gap:16px;}
  footer .brand{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;color:white;}
  footer .brand .dot{width:8px;height:8px;border-radius:50%;background:var(--orange);}

  /* Reveal animation */
  .reveal{opacity:0;transform:translateY(24px);transition:opacity .65s ease,transform .65s ease;}
  .reveal.visible{opacity:1;transform:none;}

  /* Scroll progress */
  .scroll-progress{position:fixed;top:0;left:0;height:3px;background:var(--orange);z-index:100;width:0%;transition:width .1s linear;}
`;

// ─── HTML GENERATOR ───────────────────────────────────────────────────────────
export function generateProposalHTML(data) {
  const {
    orgName      = 'Client Organisation',
    siteName     = 'Site Name',
    postcode     = '',
    annualDemand = 2500,
    scA          = { cap: 0.75, gen: 788, cov: 26 },
    scB          = { cap: 2.25, gen: 2363, cov: 38, exp: 1328 },
    ppaTerm      = 10,
    planningAuth = '',
    wireDistance = '',
    preparerEmail= '',
    proposalDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    proposalMonthYear = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  } = data;

  // Compute monthly data arrays — use pre-computed DCF actuals when available
  const scAMonthly = data._scAMonthly || computeMonthly(annualDemand, scA.gen, false);
  const scBMonthly = data._scBMonthly || computeMonthly(annualDemand, scB.gen, true);

  // Gantt quarters
  const quarters = computeGanttQuarters(data._rawDate);

  // Format numbers
  const demandFmt = fmt(annualDemand);
  const scAGenFmt = fmt(scA.gen);
  const scBGenFmt = fmt(scB.gen);
  const scBExpFmt = fmt(scB.exp);
  const scBSelfConsumed = fmt(scBMonthly.reduce((s, r) => s + r.solarConsumed, 0));

  // Comparison table rows
  const compareRows = [
    { m: 'Capacity',            a: `${scA.cap} MWp`,            b: `${scB.cap} MWp`,          bWins: true  },
    { m: 'Annual generation',   a: `${scAGenFmt} MWh`,          b: `${scBGenFmt} MWh`,         bWins: true  },
    { m: 'Demand coverage',     a: `${scA.cov}%`,               b: `${scB.cov}%`,              bWins: true  },
    { m: 'Grid export',         a: 'None',                      b: `${scBExpFmt} MWh`,         bWins: true  },
    { m: 'PPA volume (min)',    a: `Sized to ${scAGenFmt} MWh`, b: `Sized to ${scBSelfConsumed} MWh self-consumed`, bWins: false },
    { m: 'Land footprint',      a: `≈ ${Math.round(scA.cap * 2.5)} acres`, b: `≈ ${Math.round(scB.cap * 2.5)} acres`, bWins: false },
    { m: 'Commercial simplicity', a: 'Higher, behind-the-meter only', b: 'Moderate, DNO export agreement', bWins: false, aWins: true },
  ];

  // Gantt bars (standard structure, relative to quarters)
  const ganttBars = [
    { name: 'Tech, design & sizing',        s: 0, e: 1, note: 'Sizing & design locked',     style: 'ink'    },
    { name: 'Land rights',                  s: 0, e: 1, note: 'Ground lease, easements',     style: 'orange' },
    { name: 'Commercial agreement',         s: 0, e: 2, note: 'PPA, connection',             style: 'ink'    },
    { name: 'Planning',                     s: 1, e: 2, note: 'Pre-app, EIA, submission',    style: 'orange' },
    { name: 'Procurement & contracting',    s: 1, e: 3, note: 'EPC, balance of plant',       style: 'ink'    },
    { name: 'Construction & commissioning', s: 2, e: 4, note: `COD early ${quarters[3]?.q || 'Q1 2027'}`, style: 'orange' },
  ];

  const renderGanttHTML = () => {
    let html = `<div class="gantt-head"><div></div>` +
      quarters.map(q => `<div><div class="q">${q.q}</div><div class="m">${q.m}</div></div>`).join('') +
      `</div>`;
    ganttBars.forEach(b => {
      let cells = '';
      for (let i = 0; i < 4; i++) {
        if (i === b.s) {
          cells += `<div style="grid-column:${b.s + 2}/${b.e + 2};"><div class="gantt-bar ${b.style}">${b.note}</div></div>`;
        } else if (i < b.s || i >= b.e) {
          cells += `<div></div>`;
        }
      }
      html += `<div class="gantt-row">
        <div class="col-divide"><div></div><div></div><div></div><div></div><div></div></div>
        <div class="name">${b.name}</div>
        ${cells}
      </div>`;
    });
    return `<div class="gantt">${html}</div>`;
  };

  const renderCompareHTML = () => compareRows.map(r => `
    <tr>
      <td class="metric">${r.m}</td>
      <td><span class="v ${r.aWins ? 'win' : ''}">${r.a}</span></td>
      <td><span class="v ${r.bWins ? 'win' : ''}">${r.b}</span></td>
    </tr>`).join('');

  const planningNote = planningAuth ? `Planning authority: ${planningAuth}.` : '';
  const wireNote = wireDistance ? `Private wire distance: approximately ${wireDistance}.` : '';
  const contactHref = preparerEmail ? `mailto:${preparerEmail}` : '#downloads';
  const contactLabel = preparerEmail || 'Contact details available on request';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Grid CRM × ${orgName} · Near-Site Solar Proposal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>

<div class="scroll-progress" id="scroll-progress"></div>

<header class="topnav" id="topnav">
  <div class="brand">
    Grid CRM <span class="x">×</span>
    <span style="font-weight:500;font-size:15px;color:var(--muted);">${orgName}</span>
  </div>
  <nav id="navlinks">
    <a href="#summary">Summary</a>
    <a href="#scenarios">Scenarios</a>
    <a href="#compare">Compare</a>
    <a href="#ppa">PPA</a>
    <a href="#timeline">Timeline</a>
    <a href="#site">Site</a>
    <a href="#gridcrm">Grid CRM</a>
    <a href="#faq">FAQ</a>
    <a href="#next">Next</a>
  </nav>
  <div class="meta">Confidential · ${proposalDate}</div>
</header>

<section class="hero">
  <div class="grid"></div>
  <div class="bloom"></div>
  <div class="hero-inner">
    <div class="kicker">
      <span class="tag">Private proposal</span>
      <span>Grid CRM · ${proposalMonthYear}</span>
      <span style="padding-left:14px;border-left:1px solid rgba(255,255,255,0.18);margin-left:4px;color:rgba(255,255,255,0.75);">Prepared for ${orgName}</span>
    </div>
    <h1>Ten years of <span class="orange">fixed-price</span> solar. Built next door.</h1>
    <p class="sub">A near-site solar farm dedicated to ${orgName}: zero capital outlay, a long-term fixed tariff, and the renewable energy certificates to match.</p>
    <div class="stats">
      <div class="stat">
        <div class="num">${demandFmt}<span class="u">MWh</span></div>
        <div class="label">Annual demand</div>
      </div>
      <div class="stat">
        <div class="num">${scA.cap}–${scB.cap}<span class="u">MWp</span></div>
        <div class="label">Sizing range</div>
      </div>
      <div class="stat">
        <div class="num">${ppaTerm}<span class="u">yr</span></div>
        <div class="label">PPA term</div>
      </div>
      <div class="stat">
        <div class="num">Zero<span class="u">capex</span></div>
        <div class="label">Client investment</div>
      </div>
    </div>
  </div>
  <div class="scroll"><span class="line"></span> Scroll</div>
</section>

<!-- 01 SUMMARY -->
<section class="sec" id="summary">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">01. Executive Summary</div>
      <h2>The case in three points.</h2>
    </div>
    <div class="pillars reveal">
      <div class="pillar dark">
        <div class="tag">01 · Energy</div>
        <div class="big">${demandFmt}<span class="u">MWh</span></div>
        <p>${orgName} consumes approximately ${demandFmt} MWh of electricity each year. A dedicated near-site solar farm replaces between ${scA.cov}% and ${scB.cov}% of that with generation matched to on-site demand.</p>
      </div>
      <div class="pillar">
        <div class="tag">02 · Commercial</div>
        <h3>Fixed tariff. Zero capex.</h3>
        <p>Grid CRM develops, builds, owns and operates the farm under a ${ppaTerm}-year Power Purchase Agreement. ${orgName} pays a fixed £/MWh rate, CPI-indexed. No construction spend, no O&amp;M liability.</p>
      </div>
      <div class="pillar">
        <div class="tag">03 · Renewable</div>
        <h3>REGOs transferred monthly.</h3>
        <p>Every megawatt-hour generated earns a Renewable Energy Guarantee of Origin. Ofgem issues and Grid CRM transfers them monthly, giving ${orgName} certificated, auditable decarbonisation of site consumption.</p>
      </div>
    </div>
  </div>
</section>

<!-- 02 SCENARIOS -->
<section class="sec" id="scenarios" style="background:var(--paper-deep);">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">02. Scenarios</div>
      <h2>Two sizing options.</h2>
      <p class="lede">We have modelled two scenarios using ${orgName}'s annual consumption of ${demandFmt} MWh. Both assume a ${ppaTerm}-year PPA with Grid CRM.</p>
    </div>
    <div class="toggle-wrap reveal">
      <div class="toggle" id="scenario-toggle">
        <button class="on" data-s="A">Scenario A</button>
        <button data-s="B">Scenario B</button>
      </div>
    </div>
    <div class="scenario reveal">
      <div class="scenario-left">
        <div class="scenario-tag" id="sc-tag">Optimised for demand coverage</div>
        <h3 id="sc-title">${scA.cap} MWp, sized to site</h3>
        <p id="sc-desc">All generation feeds ${orgName}. No grid export. The simplest commercial footprint: a pure behind-the-meter arrangement delivering roughly ${scA.cov}% of annual demand.</p>
        <div class="kpi-grid">
          <div class="kpi"><div class="l">Capacity</div><div class="v" id="kpi-cap">${scA.cap}<span class="u">MWp</span></div></div>
          <div class="kpi"><div class="l">Generation</div><div class="v" id="kpi-gen">${scAGenFmt}<span class="u">MWh</span></div></div>
          <div class="kpi"><div class="l">Demand coverage</div><div class="v" id="kpi-cov">${scA.cov}<span class="u">%</span></div></div>
          <div class="kpi"><div class="l">Grid export</div><div class="v" id="kpi-exp">None</div></div>
        </div>
      </div>
      <div class="scenario-right chart-wrap">
        <div class="chart-title">
          <div class="t" id="chart-title">Solar generation vs demand · Scenario A</div>
        </div>
        <svg id="scenario-chart" width="100%" viewBox="0 0 680 320" style="overflow:visible;"></svg>
        <div class="legend" id="legend"></div>
      </div>
    </div>
  </div>
</section>

<!-- 03 COMPARE -->
<section class="sec" id="compare">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">03. Comparison</div>
      <h2>Side by side.</h2>
    </div>
    <div class="reveal">
      <table class="compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Scenario A</th>
            <th>Scenario B</th>
          </tr>
        </thead>
        <tbody id="compare-body">
          ${renderCompareHTML()}
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- 04 PPA -->
<section class="sec" id="ppa" style="background:var(--paper-deep);">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">04. Commercial</div>
      <h2>How the PPA works.</h2>
      <p class="lede">The structure applies to both scenarios: certainty and simplicity for ${orgName}, and the long-term offtake commitment Grid CRM needs to finance the build at a competitive rate.</p>
    </div>
    <div class="ppa-grid reveal">
      <div class="ppa-card dark">
        <div class="ppa-tag">01</div>
        <h3>Pricing &amp; term</h3>
        <hr>
        <ul>
          <li>Fixed £/MWh rate, CPI-indexed, for the full ${ppaTerm}-year term</li>
          <li>Renewal negotiated every ${ppaTerm} years at fair market value</li>
        </ul>
      </div>
      <div class="ppa-card">
        <div class="ppa-tag">02</div>
        <h3>Supply</h3>
        <hr>
        <ul>
          <li>Generation from near-site farm (${scA.cap} or ${scB.cap} MWp)</li>
          <li>REGOs transferred to ${orgName}</li>
        </ul>
      </div>
      <div class="ppa-card">
        <div class="ppa-tag">03</div>
        <h3>Operations</h3>
        <hr>
        <ul>
          <li>Grid CRM handles O&amp;M, insurance and performance guarantees</li>
          <li>Zero capital expenditure through construction and operation</li>
        </ul>
      </div>
      <div class="ppa-card">
        <div class="ppa-tag">04</div>
        <h3>Offtake</h3>
        <hr>
        <ul>
          <li>Take-or-Pay: ${orgName} commits to a minimum annual volume</li>
          <li>Complementary sleeved PPA available for remaining demand</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- 05 TIMELINE -->
<section class="sec" id="timeline">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">05. Programme</div>
      <h2>Development timeline.</h2>
      <p class="lede">Sizing and design complete by end ${quarters[0]?.q || 'Q1'}; land and commercial negotiation conclude mid-year to enable planning submission. Construction starts in ${quarters[2]?.q || 'Q3'} with commercial operation targeted ${quarters[3]?.q || 'Q4'}.</p>
    </div>
    <div class="reveal">
      ${renderGanttHTML()}
      <div style="display:flex;gap:24px;margin-top:20px;font-family:var(--mono);font-size:11px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;">
        <div style="display:flex;align-items:center;gap:8px;"><span style="width:18px;height:10px;background:var(--ink);border-radius:3px;"></span> Pre-construction</div>
        <div style="display:flex;align-items:center;gap:8px;"><span style="width:18px;height:10px;background:var(--orange);border-radius:3px;"></span> Build &amp; energise</div>
        <div style="margin-left:auto;">Dates a working assumption · subject to change</div>
      </div>
    </div>
  </div>
</section>

<!-- 06 SITE -->
<section class="sec" id="site" style="background:var(--paper-deep);">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">06. Site &amp; Design</div>
      <h2>Private wire,<br>direct to site.</h2>
      <p class="lede">A dedicated private wire runs from the near-site solar farm to ${siteName}${postcode ? ' (' + postcode + ')' : ''}. The existing grid connection stays in place as a top-up import route and, in Scenario B, as the export path for surplus generation.</p>
    </div>
    <div class="location reveal">
      <div class="loc-head">
        <div class="loc-kicker">Site · ${siteName}${postcode ? ' · ' + postcode : ''}</div>
        <div class="loc-title">Near-site solar, private wire connected.</div>
        <div class="loc-sub">The solar farm sits on land adjoining ${orgName}'s site. ${wireNote ? wireNote + ' ' : ''}${planningNote} The private wire delivers generation directly to the meter point, eliminating transmission and distribution charges on the solar portion.</div>
      </div>
      <div class="loc-frames">
        <div class="loc-frame" data-stage="1">
          <div class="loc-label"><span class="i">01</span> United Kingdom</div>
          <svg viewBox="0 0 200 260" preserveAspectRatio="xMidYMid meet" class="loc-svg">
            <defs><radialGradient id="uk-glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#F8632C" stop-opacity="0.55"/><stop offset="100%" stop-color="#F8632C" stop-opacity="0"/></radialGradient></defs>
            <path d="M 95 20 Q 88 15 82 22 L 78 32 Q 70 38 72 48 L 68 58 Q 60 62 58 72 L 50 80 Q 42 85 45 95 L 40 108 Q 32 115 38 128 L 35 142 Q 40 155 52 160 L 60 172 Q 58 185 68 195 L 75 210 Q 85 218 98 218 L 110 222 Q 122 220 128 212 L 135 200 Q 140 190 135 180 L 140 168 Q 148 160 145 148 L 150 135 Q 155 122 148 112 L 152 100 Q 155 88 148 80 L 150 68 Q 145 58 138 55 L 135 45 Q 128 38 120 40 L 112 32 Q 105 25 95 20 Z M 40 200 Q 32 205 30 215 L 32 225 Q 38 230 46 228 L 52 222 Q 50 212 42 208 Z M 20 195 Q 12 198 14 208 L 18 215 Q 25 217 28 210 Z" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.35)" stroke-width="1" stroke-linejoin="round"/>
            <circle class="loc-glow" cx="92" cy="145" r="30" fill="url(#uk-glow)"/>
            <circle class="loc-pin-ring" cx="92" cy="145" r="8" fill="none" stroke="#F8632C" stroke-width="1.5" opacity="0.6"/>
            <circle cx="92" cy="145" r="4" fill="#F8632C"/>
            <text x="104" y="136" font-family="monospace" font-size="7" fill="#F8632C" letter-spacing="1">SITE</text>
          </svg>
          <div class="loc-scale"><span>0</span><span class="bar"></span><span>300 km</span></div>
        </div>
        <div class="loc-frame" data-stage="2">
          <div class="loc-label"><span class="i">02</span> Region</div>
          <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" class="loc-svg" style="background:rgba(255,255,255,0.02);">
            <rect width="200" height="200" fill="none"/>
            <circle class="loc-glow" cx="100" cy="100" r="40" fill="url(#uk-glow)"/>
            <circle class="loc-pin-ring" cx="100" cy="100" r="16" fill="none" stroke="#F8632C" stroke-width="1.2" opacity="0.5"/>
            <circle class="loc-pin-ring r2" cx="100" cy="100" r="9" fill="none" stroke="#F8632C" stroke-width="1" opacity="0.8"/>
            <circle cx="100" cy="100" r="4" fill="#F8632C"/>
            <text x="112" y="96" font-family="monospace" font-size="8" fill="#F8632C" letter-spacing="0.8" font-weight="600">${siteName.toUpperCase()}</text>
          </svg>
          <div class="loc-scale"><span>0</span><span class="bar"></span><span>25 km</span></div>
        </div>
        <div class="loc-frame" data-stage="3">
          <div class="loc-label"><span class="i">03</span> Site layout</div>
          <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" class="loc-svg">
            <rect x="60" y="60" width="80" height="80" rx="6" fill="rgba(248,99,44,0.12)" stroke="#F8632C" stroke-width="1.5"/>
            <text x="100" y="96" text-anchor="middle" font-family="monospace" font-size="7" fill="#F8632C" letter-spacing="1" text-transform="uppercase">SOLAR</text>
            <text x="100" y="108" text-anchor="middle" font-family="monospace" font-size="7" fill="#F8632C" letter-spacing="1">FARM</text>
            <path d="M140 100 L168 100" stroke="rgba(248,99,44,0.7)" stroke-width="2" stroke-dasharray="4 3"/>
            <text x="170" y="96" font-family="monospace" font-size="6" fill="rgba(255,255,255,0.6)" letter-spacing="0.5">Private wire</text>
            <rect x="168" y="88" width="24" height="24" rx="3" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
            <text x="180" y="102" text-anchor="middle" font-family="monospace" font-size="5.5" fill="rgba(255,255,255,0.8)">HQ</text>
            <text x="100" y="170" text-anchor="middle" font-family="monospace" font-size="6" fill="rgba(255,255,255,0.4)" letter-spacing="0.5">${postcode || siteName}</text>
          </svg>
          <div class="loc-scale"><span>0</span><span class="bar"></span><span>500 m</span></div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- 07 ABOUT GRID CRM -->
<section class="sec" id="gridcrm">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">07. About Grid CRM</div>
      <h2>Renewable energy,<br>delivered end-to-end.</h2>
    </div>
    <div class="about reveal">
      <div>
        <p class="lede">Grid CRM is a full-stack energy company. We supply power to businesses and homes, and we develop and build solar farms too, exporting to the grid or supplying offtakers directly via private wire. EPC and O&amp;M are both in-house, so there are no third-party handoffs. Grid CRM originates the site, secures planning, finances construction, and then owns and operates the asset for the full life of the project. Our clients only ever see a clean MWh and a fixed invoice.</p>
      </div>
      <div class="credentials">
        <div class="cred"><div class="n">450<span style="font-size:0.4em;color:var(--muted);margin-left:6px;font-family:var(--mono);">MW+</span></div><div class="l">Global development pipeline &amp; counting</div></div>
        <div class="cred"><div class="n">4</div><div class="l">Operational sites</div></div>
        <div class="cred"><div class="n">49.64<span style="font-size:0.4em;color:var(--muted);margin-left:6px;font-family:var(--mono);">MW</span></div><div class="l">RtB acquired · 2 projects</div></div>
        <div class="cred"><div class="n">UK</div><div class="l">Wholly UK-owned</div></div>
      </div>
    </div>
  </div>
</section>

<!-- 08 FAQ -->
<section class="sec" id="faq" style="background:var(--paper-deep);">
  <div class="container" style="max-width:1000px;">
    <div class="sec-head reveal">
      <div class="num">08. FAQs</div>
      <h2>Common questions.</h2>
    </div>
    <div class="faq-list reveal">
      <details class="faq"><summary><h3>What happens if Grid CRM goes out of business?</h3><span class="plus">+</span></summary>
        <div class="a">The solar farm is held in a ring-fenced SPV, separate from Grid CRM's wider trading activity. If Grid CRM were to fail, the asset itself, the land rights, and the DNO connection remain intact and under the SPV, so the physical generation capacity is protected. The PPA is drafted with continuity provisions so that ${orgName}'s supply is not dependent on Grid CRM's corporate solvency: in practice this means the SPV can be transferred to an alternative owner or operator, with ${orgName}'s contract novated across.</div>
      </details>
      <details class="faq"><summary><h3>Is planning a material risk to the timeline?</h3><span class="plus">+</span></summary>
        <div class="a">A solar farm at this scale (under 5 MW) is within typical local planning authority powers${planningAuth ? ' — in this case ' + planningAuth : ''} rather than requiring a DCO. Grid CRM manages pre-application engagement, EIA screening and submission. Our indicative timeline assumes standard determination; material delay would shift COD by one quarter.</div>
      </details>
      <details class="faq"><summary><h3>What if site demand changes materially?</h3><span class="plus">+</span></summary>
        <div class="a">The Take-or-Pay volume is set conservatively against today's consumption of ${demandFmt} MWh/yr. If demand grows, additional volume can be absorbed at the same rate up to the generation cap. If it falls, the minimum volume remains, protecting the finance stack while still delivering the vast majority of consumed energy renewably.</div>
      </details>
      <details class="faq"><summary><h3>How does this interact with our existing supplier?</h3><span class="plus">+</span></summary>
        <div class="a">Your incumbent supply contract stays in place for top-up volume. The private wire behaves as an on-site generator behind the MPAN, so existing metering, billing and DNO arrangements continue without disruption.</div>
      </details>
      <details class="faq"><summary><h3>Why a ${ppaTerm}-year term?</h3><span class="plus">+</span></summary>
        <div class="a">${ppaTerm} years is long enough to underwrite the build at a competitive rate, and short enough to give ${orgName} commercial flexibility. The PPA includes a renewal mechanism, reset at fair market value, so the arrangement can extend naturally if both parties choose.</div>
      </details>
      <details class="faq"><summary><h3>How are REGOs handled?</h3><span class="plus">+</span></summary>
        <div class="a">Renewable Energy Guarantees of Origin are issued by Ofgem per MWh generated and transferred monthly to ${orgName}, giving you auditable, certificated decarbonisation of site consumption in line with SECR and Net Zero reporting frameworks.</div>
      </details>
    </div>
  </div>
</section>

<!-- 09 NEXT STEPS -->
<section class="sec" id="next">
  <div class="container">
    <div class="next reveal">
      <div class="bloom"></div>
      <div class="l">
        <div style="font-family:var(--mono);font-size:11px;letter-spacing:3px;text-transform:uppercase;color:var(--orange);font-weight:600;margin-bottom:16px;">09. Next Steps</div>
        <h2>Shall we build it?</h2>
        <p>Four decisions stand between this proposal and a signed PPA. We're ready to move as soon as ${orgName} is.</p>
        <div class="cta-row">
          <a class="btn primary" href="${contactHref}">Get in touch →</a>
        </div>
      </div>
      <div class="steps">
        <div class="step"><div class="n">01</div><div><div class="t">Confirm preferred scenario</div><div class="d">Align on the ${scA.cap} MWp or ${scB.cap} MWp pathway.</div></div></div>
        <div class="step"><div class="n">02</div><div><div class="t">Land rights &amp; heads of terms</div><div class="d">Sign exclusivity and agree ground lease HoTs.</div></div></div>
        <div class="step"><div class="n">03</div><div><div class="t">Design &amp; feasibility</div><div class="d">Finalise layout, grid connection, planning strategy.</div></div></div>
        <div class="step"><div class="n">04</div><div><div class="t">PPA drafting</div><div class="d">Negotiate and execute Power Purchase Agreement.</div></div></div>
      </div>
    </div>
  </div>
</section>

<!-- 10 DOWNLOADS -->
<section class="sec" id="downloads" style="background:var(--paper-deep);">
  <div class="container">
    <div class="sec-head reveal">
      <div class="num">10. Take-aways</div>
      <h2>Downloads.</h2>
      <p class="lede">Everything you need to take this through your procurement and finance teams.</p>
    </div>
    <div class="downloads reveal">
      <a class="dl" href="#" onclick="window.print();return false;">
        <div class="type"><span>HTML · Print / PDF</span><span class="arrow">↗</span></div>
        <h3>Full proposal</h3>
        <p>Save as PDF using your browser's print function.</p>
      </a>
      <a class="dl" href="${contactHref}">
        <div class="type"><span>Email · On request</span><span class="arrow">↗</span></div>
        <h3>Draft PPA template</h3>
        <p>Contact your Grid CRM account manager for a draft PPA redline.</p>
      </a>
    </div>
  </div>
</section>

<footer>
  <div class="container" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;">
    <div class="brand"><span class="dot"></span> Grid CRM</div>
    <div>Confidential · For ${orgName} only · Prepared ${proposalDate}</div>
    <div>${contactLabel}</div>
  </div>
</footer>

<script>
// ── DATA ──────────────────────────────────────────────────────────────────────
const SCENARIO_A = ${JSON.stringify(scAMonthly)};
const SCENARIO_B = ${JSON.stringify(scBMonthly)};

const SCENARIOS = {
  A: {
    tag: 'Optimised for demand coverage',
    title: '${scA.cap} MWp, sized to site',
    desc: 'All generation feeds ${orgName}. No grid export. The simplest commercial footprint: a pure behind-the-meter arrangement delivering roughly ${scA.cov}% of annual demand.',
    cap: '${scA.cap}', gen: '${scAGenFmt}', cov: '${scA.cov}', exp: 'None',
    data: SCENARIO_A, hasExport: false,
  },
  B: {
    tag: 'Scaled for export value',
    title: '${scB.cap} MWp, with grid export',
    desc: 'Generation exceeds site demand in peak months. Surplus ${scBExpFmt} MWh/yr exports to the grid under a DNO export agreement, creating a second revenue stream.',
    cap: '${scB.cap}', gen: '${scBGenFmt}', cov: '${scB.cov}', exp: '${scBExpFmt}',
    data: SCENARIO_B, hasExport: true,
  },
};

// ── CHART ─────────────────────────────────────────────────────────────────────
const accent = '#F8632C';
const TEAL = '#1F3D4A';
const GREEN = '#4A8C5C';
const GOLD = '#E4B44A';

function renderChart(scenarioKey) {
  const s = SCENARIOS[scenarioKey];
  const svg = document.getElementById('scenario-chart');
  const W = svg.getBoundingClientRect().width || 680;
  const H = 320;
  const PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 60;
  const barW = Math.max(24, (W - PAD_L - PAD_R) / 12 - 6);
  const baseY = H - PAD_B;
  const maxVal = Math.max(...s.data.map(r => r.demand));
  const scale = v => (v / maxVal) * (H - PAD_T - PAD_B);
  const yAt = v => baseY - scale(v);
  const xAt = i => PAD_L + i * ((W - PAD_L - PAD_R) / 12) + ((W - PAD_L - PAD_R) / 12 - barW) / 2;

  let html = '';
  s.data.forEach((r, i) => {
    const x = xAt(i);
    const cx = x + barW / 2;
    const yImport = yAt(r.gridImport);
    const ySolar = yAt(r.gridImport + r.solarConsumed);
    const yExport = yAt(r.gridImport + r.solarConsumed + r.gridExport);
    html += \`<rect class="bar" style="transform-origin:\${x}px \${baseY}px" x="\${x}" y="\${yImport}" width="\${barW}" height="\${scale(r.gridImport)}" fill="\${TEAL}"/>\`;
    html += \`<rect class="bar" style="transform-origin:\${x}px \${baseY}px" x="\${x}" y="\${ySolar}" width="\${barW}" height="\${scale(r.solarConsumed)}" fill="\${accent}"/>\`;
    if (r.gridExport > 0) {
      html += \`<rect class="bar" style="transform-origin:\${x}px \${baseY}px" x="\${x}" y="\${yExport}" width="\${barW}" height="\${scale(r.gridExport)}" fill="\${GREEN}"/>\`;
    }
    html += \`<text x="\${cx}" y="\${H - 32}" text-anchor="middle" font-family="monospace" font-size="11" fill="#6B6B6B">\${r.month}</text>\`;
  });

  const genPts = s.data.map((r, i) => ({ x: xAt(i) + barW / 2, y: yAt(r.generation) }));
  function smoothPath(pts) {
    if (!pts.length) return '';
    let d = \`M \${pts[0].x} \${pts[0].y}\`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
      d += \` C \${cp1x} \${cp1y}, \${cp2x} \${cp2y}, \${p2.x} \${p2.y}\`;
    }
    return d;
  }
  html += \`<path class="gen-line" d="\${smoothPath(genPts)}" fill="none" stroke="\${GOLD}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>\`;
  genPts.forEach((p, i) => {
    html += \`<circle class="gen-dot" data-i="\${i}" cx="\${p.x}" cy="\${p.y}" r="4.5" fill="#fff" stroke="\${GOLD}" stroke-width="2.5"/>\`;
  });
  html += \`<line x1="\${PAD_L}" y1="\${baseY}" x2="\${W - PAD_R}" y2="\${baseY}" stroke="#0E0E0E" stroke-width="1"/>\`;
  svg.innerHTML = html;

  svg.querySelectorAll('.bar').forEach(el => { el.style.transition = 'none'; el.style.transform = 'scaleY(0)'; });
  const path = svg.querySelector('.gen-line');
  if (path) { const len = path.getTotalLength(); path.style.strokeDasharray = len; path.style.strokeDashoffset = len; }
  svg.querySelectorAll('.gen-dot').forEach(el => { el.style.opacity = 0; });

  requestAnimationFrame(() => animateChart(svg));

  const legend = document.getElementById('legend');
  legend.innerHTML = s.hasExport
    ? \`<div class="d"><span class="sw" style="background:\${TEAL}"></span> Grid import</div><div class="d"><span class="sw" style="background:\${accent}"></span> Solar consumed</div><div class="d"><span class="sw" style="background:\${GREEN}"></span> Grid export</div><div class="d"><span class="sw sw-line" style="background:\${GOLD}"></span> Generation</div>\`
    : \`<div class="d"><span class="sw" style="background:\${TEAL}"></span> Grid import</div><div class="d"><span class="sw" style="background:\${accent}"></span> Solar consumed</div><div class="d"><span class="sw sw-line" style="background:\${GOLD}"></span> Generation</div>\`;
  document.getElementById('chart-title').textContent = \`Solar generation vs demand · Scenario \${scenarioKey}\`;
}

function animateChart(svg) {
  svg.querySelectorAll('.bar').forEach((el, i) => {
    el.getBoundingClientRect();
    el.style.transition = \`transform 0.65s cubic-bezier(.4,0,.2,1) \${i * 10}ms\`;
    el.style.transform = 'scaleY(1)';
  });
  const path = svg.querySelector('.gen-line');
  if (path) { path.getBoundingClientRect(); path.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(.3,0,.2,1) 250ms'; path.style.strokeDashoffset = 0; }
  svg.querySelectorAll('.gen-dot').forEach((el, i) => {
    el.style.transition = \`opacity 0.3s ease \${600 + i * 80}ms\`;
    requestAnimationFrame(() => { el.style.opacity = 1; });
  });
}

// ── SCENARIO TOGGLE ────────────────────────────────────────────────────────────
function setScenario(key) {
  const s = SCENARIOS[key];
  document.getElementById('sc-tag').textContent = s.tag;
  document.getElementById('sc-title').textContent = s.title;
  document.getElementById('sc-desc').textContent = s.desc;
  document.getElementById('kpi-cap').innerHTML = s.cap + '<span class="u">MWp</span>';
  document.getElementById('kpi-gen').innerHTML = s.gen + '<span class="u">MWh</span>';
  document.getElementById('kpi-cov').innerHTML = s.cov + '<span class="u">%</span>';
  document.getElementById('kpi-exp').innerHTML = s.hasExport ? s.exp + '<span class="u">MWh</span>' : 'None';
  document.querySelectorAll('#scenario-toggle button').forEach(b => b.classList.toggle('on', b.dataset.s === key));
  renderChart(key);
}

document.getElementById('scenario-toggle').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) setScenario(btn.dataset.s);
});

// ── INIT ──────────────────────────────────────────────────────────────────────
setScenario('A');

// Nav scroll state
const nav = document.getElementById('topnav');
window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 40));

// Scroll progress
const prog = document.getElementById('scroll-progress');
window.addEventListener('scroll', () => {
  const pct = window.scrollY / (document.body.scrollHeight - window.innerHeight) * 100;
  prog.style.width = pct + '%';
});

// Reveal on scroll
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
}, { threshold: 0.12 });
revealEls.forEach(el => io.observe(el));

// Active nav
const navLinks = document.querySelectorAll('#navlinks a');
const sections = Array.from(navLinks).map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
window.addEventListener('scroll', () => {
  const scrollY = window.scrollY + 120;
  let active = sections[0];
  sections.forEach(s => { if (s && s.offsetTop <= scrollY) active = s; });
  navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + active?.id));
}, { passive: true });

// FAQ plus icon toggle
document.querySelectorAll('.faq').forEach(el => {
  el.addEventListener('toggle', () => {
    const plus = el.querySelector('.plus');
    if (plus) plus.textContent = el.open ? '×' : '+';
  });
});
</script>
</body>
</html>`;
}
