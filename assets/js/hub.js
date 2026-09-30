/* ==========================================================================
   Orascom BIM Digital Delivery Hub \u2014 Application Logic
   No external framework. Vanilla JS, namespaced under window.OHub.
   All persistence is localStorage-based (this is a static, offline-first
   shell \u2014 see IMPLEMENTATION_REPORT.md for the data-architecture notes).
   ========================================================================== */
(function(){
  "use strict";

  var LS = {
    projects:'ohub_projects',
    active:'ohub_active_project',
    scores:'ohub_scores',
    weights:'ohub_weights',
    activity:'ohub_activity',
    issues:'ohub_issues',
    thresholds:'ohub_thresholds',
    deliverables:'ohub_deliverables',
    models:'ohub_models',
    dark:'ohub_dark',
    reports:'ohub_report_history',
    history:'ohub_history',
    tour:'ohub_tour_done',
    sync:'ohub_sync',
    rollups:'ohub_rollups',
    gates:'ohub_gates',
    cloud:'ohub_cloud'
  };

  var MODULES = [
    {id:'midp',       label:'Delivery Verification',  file:'modules/delivery-verification.html?v=e65e9219', weightKey:'midp'},
    {id:'naming',     label:'Naming Convention',      file:'modules/naming-convention.html?v=ce5c21b5',      weightKey:'naming'},
    {id:'qaqc',       label:'Model Quality',          file:'modules/model-quality.html?v=e7ef379c',          weightKey:'qaqc'},
    {id:'workset',    label:'Workset Validator',      file:'modules/workset-validator.html?v=de5f44aa',     weightKey:'workset'},
    {id:'parameters', label:'Parameter Validator',    file:'modules/parameter-validator.html?v=e70c7525',   weightKey:'parameters'},
    {id:'clash',      label:'Clash Analysis',         file:'modules/clash.html?v=fc1646f5',                 weightKey:'clash'}
  ];

  var DEFAULT_WEIGHTS = {midp:20, naming:15, qaqc:25, workset:15, parameters:15, clash:10};
  var DEFAULT_THRESHOLDS = {ok:90, warn:75};
  var DELIV_STATUSES = ['Upcoming','In Progress','Submitted','Delayed','Milestone'];

  /* ---------------- utils ---------------- */
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function uid(prefix){ return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function fmtDate(d){
    if(!d) return '\u2014';
    var dt = new Date(d);
    if(isNaN(dt)) return '\u2014';
    return dt.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  function fmtDateTime(d){
    var dt = new Date(d);
    if(isNaN(dt)) return '\u2014';
    return dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' \u00b7 ' +
           dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  }
  function daysUntil(d){
    if(!d) return null;
    var dt = new Date(d);
    if(isNaN(dt)) return null;
    var ms = dt.setHours(0,0,0,0) - new Date().setHours(0,0,0,0);
    return Math.round(ms / 86400000);
  }
  function readLS(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }
  function writeLS(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){ /* storage unavailable */ }
  }

  /* ---------------- state ---------------- */
  var state = {
    projects: readLS(LS.projects, []),
    active: readLS(LS.active, null),
    scores: readLS(LS.scores, {}),
    weights: readLS(LS.weights, DEFAULT_WEIGHTS),
    activity: readLS(LS.activity, []),
    issues: readLS(LS.issues, []),
    thresholds: readLS(LS.thresholds, DEFAULT_THRESHOLDS),
    deliverables: readLS(LS.deliverables, []),
    models: readLS(LS.models, []),
    dark: readLS(LS.dark, false),
    reports: readLS(LS.reports, []),
    history: readLS(LS.history, {}),
    sync: readLS(LS.sync, {url:'http://localhost:8787', model:'', auto:false}),
    rollups: readLS(LS.rollups, {}),
    gates: readLS(LS.gates, {}),
    cloud: readLS(LS.cloud, {url:'https://orascom-hub-sync.mohamedyasserelgendy2015.workers.dev', token:'', workspace:'main', lastSync:0})
  };
  // migrate older saves that predate a module/threshold being added
  MODULES.forEach(function(m){ if(state.weights[m.weightKey]==null) state.weights[m.weightKey] = DEFAULT_WEIGHTS[m.weightKey]||0; });
  if(state.thresholds.ok==null) state.thresholds.ok = DEFAULT_THRESHOLDS.ok;
  if(state.thresholds.warn==null) state.thresholds.warn = DEFAULT_THRESHOLDS.warn;
  // One-time repair: plot boundaries saved before the [lat,lng]\u2192GeoJSON
  // import fix carry swapped coordinates. Re-derive them from the library.
  (function migratePlotBounds(){
    var lib = window.SITE_PLOTS || [], changed = false;
    function inLib(code){ var f = false; lib.forEach(function(pl){ if(pl.code===code) f = true; }); return f; }
    state.projects.forEach(function(p){
      if(!p.plotCode) return;
      if(!inLib(p.plotCode)){
        // plot retired from the library: keep the shape as an ordinary
        // custom boundary rather than dropping the user's data silently.
        p.plotCode = null; p.plotRev = null; changed = true; return;
      }
      if(p.plotRev===2) return;
      var found = null;
      lib.forEach(function(pl){ if(pl.code===p.plotCode) found = pl; });
      if(found && found.rings){
        p.boundary = {type:'MultiPolygon', coordinates:[found.rings]};
        p.plotRev = 2; changed = true;
      }
    });
    if(changed) persist('projects');
  })();
  // Seed library plots as real projects so they appear in the project
  // picker with zero clicks. Idempotent: skips codes already held.
  (function seedLibraryProjects(){
    var lib = window.SITE_PLOTS || [], changed = false;
    lib.forEach(function(pl){
      if(!pl.kpi) return;
      var exists = false;
      state.projects.forEach(function(p){ if(p.plotCode===pl.code) exists = true; });
      if(exists) return;
      state.projects.push({id:uid('proj'), name:pl.code+' \u2014 '+pl.name, code:pl.code,
        client:'', accUrl:'', stage:'Design', lat:null, lng:null,
        boundary:{type:'MultiPolygon', coordinates:[pl.rings]},
        plotCode:pl.code, plotRev:2, color:null, kpi:null});
      changed = true;
    });
    if(changed){
      if(!state.active && state.projects.length) state.active = state.projects[0].id;
      persist('projects'); persist('active');
    }
  })();
  if(state.dark){ try{ document.body.classList.add('dark'); }catch(e){} }

  function persist(part){
    if(part==='projects') writeLS(LS.projects, state.projects);
    if(part==='active') writeLS(LS.active, state.active);
    if(part==='scores') writeLS(LS.scores, state.scores);
    if(part==='weights') writeLS(LS.weights, state.weights);
    if(part==='activity') writeLS(LS.activity, state.activity);
    if(part==='issues') writeLS(LS.issues, state.issues);
    if(part==='thresholds') writeLS(LS.thresholds, state.thresholds);
    if(part==='deliverables') writeLS(LS.deliverables, state.deliverables);
    if(part==='models') writeLS(LS.models, state.models);
    if(part==='dark') writeLS(LS.dark, state.dark);
    if(part==='reports') writeLS(LS.reports, state.reports);
    if(part==='history') writeLS(LS.history, state.history);
    if(part==='sync') writeLS(LS.sync, state.sync);
    if(part==='rollups') writeLS(LS.rollups, state.rollups);
    if(part==='gates') writeLS(LS.gates, state.gates);
    if(part==='cloud') writeLS(LS.cloud, state.cloud);
    try{ refreshNavBadges(); }catch(e){}
  }
  function toggleDark(){
    state.dark = !state.dark;
    persist('dark');
    try{ document.body.classList.toggle('dark', state.dark); }catch(e){}
    broadcastTheme();
    if(currentView==='projects' && projectsViewMode==='map'){ try{ renderProjectsMap(); }catch(e){} }
    if(currentView==='gis'){ try{ renderGis(); }catch(e){} }
  }
  function hubTheme(){ return state.dark ? 'dark' : 'light'; }
  function broadcastTheme(){
    MODULES.forEach(function(m){
      if(!loadedModules[m.id]) return;
      var frame = document.getElementById('frame-'+m.id);
      if(!frame || !frame.contentWindow) return;
      try{ frame.contentWindow.postMessage({source:'orascom-hub', type:'set-theme', theme:hubTheme()}, '*'); }catch(e){}
    });
  }

  function activeProject(){
    return state.projects.find(function(p){ return p.id===state.active; }) || null;
  }
  var DEFAULT_ACC_URL = 'https://acc.autodesk.com/docs/files/projects/d4b39b32-1ca6-471e-9eb7-3ed253943172?folderUrn=urn%3Aadsk.wipprod%3Afs.folder%3Aco.Z9k-vv1SSEykGEh0YZgb3Q&viewModel=detail&moduleId=folders';
  function accUrlFor(p){
    if(p && p.accUrl && p.accUrl.trim()) return p.accUrl.trim();
    return DEFAULT_ACC_URL;
  }
  function openAcc(){
    var p = activeProject();
    window.open(accUrlFor(p), '_blank', 'noopener');
  }
  function projectScores(pid){
    return state.scores[pid] || {};
  }
  function logActivity(text, tone){
    state.activity.unshift({ts:Date.now(), text:text, tone:tone||'info'});
    state.activity = state.activity.slice(0,40);
    persist('activity');
  }

  /* ---------------- KPI engine ---------------- */
  // Weighted BIM Delivery Health. Modules without a recorded score are
  // excluded and the remaining weights are renormalized proportionally,
  // rather than silently treating "no data" as 0%.
  function computeHealth(pid){
    var sc = projectScores(pid);
    var totalW = 0, weighted = 0, have = 0;
    MODULES.forEach(function(m){
      var w = Number(state.weights[m.weightKey])||0;
      var rec = sc[m.id];
      if(rec && typeof rec.score==='number'){
        weighted += rec.score * w;
        totalW += w;
        have++;
      }
    });
    if(totalW===0) return {value:null, have:0, total:MODULES.length};
    return {value: Math.round(weighted/totalW), have:have, total:MODULES.length};
  }
  function tone(val){
    if(val==null) return 'muted';
    if(val>=state.thresholds.ok) return 'ok';
    if(val>=state.thresholds.warn) return 'warn';
    return 'fail';
  }
  function statusLabel(val){
    if(val==null) return 'No data';
    if(val>=state.thresholds.ok) return 'Good';
    if(val>=state.thresholds.warn) return 'Attention';
    return 'Critical';
  }
  function toneBadge(t){ return t==='ok'?'ok':t==='warn'?'warn':t==='fail'?'fail':'muted'; }
  var TONE_HEX = {ok:'#27AE60', warn:'#E67E22', fail:'#E03535', muted:'#8E9BB3'};

  /* ---------------- router ---------------- */
  var currentView = 'dashboard';
  var loadedModules = {};
  var pendingSends = {}; // Data Center outbox: modId -> [{files, role, done}]
  var framesReady = {}; // modId -> true once the iframe finished loading

  function switchView(viewId, opts){
    opts = opts||{};
    currentView = viewId;
    try{ if(location.hash !== '#/'+viewId) history.replaceState(null, '', '#/'+viewId); }catch(e){}
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
    var el = document.getElementById('view-'+viewId);
    if(el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function(n){
      n.classList.toggle('active', n.getAttribute('data-view')===viewId);
    });
    var titles = {
      dashboard:['Executive Dashboard','Home'],
      projects:['Projects','Portfolio'],
      models:['Models','Portfolio'],
      datacenter:['Data Center','Overview'],
      gis:['GIS','Overview'],
      program:['Program','Overview'],
      midp:['Delivery Verification','Modules'],
      naming:['Naming Convention','Modules'],
      qaqc:['Model Quality','Modules'],
      workset:['Workset Validator','Modules'],
      parameters:['Parameter Validator','Modules'],
      clash:['Clash Analysis','Modules'],
      'quality-center':['BIM Quality Center','Governance'],
      reports:['Reporting Center','Governance'],
      delivery:['Delivery Overview','Governance'],
      stages:['Stage Gates','Governance'],
      settings:['Settings','System']
    };
    var t = titles[viewId] || ['Orascom BIM Hub',''];
    document.getElementById('page-title').textContent = t[0];
    document.getElementById('page-crumb').textContent = t[1];

    var mod = MODULES.find(function(m){ return m.id===viewId; });
    if(mod) lazyLoadModule(mod);

    if(viewId==='dashboard') renderDashboard();
    if(viewId==='projects') renderProjects();
    if(viewId==='models') renderModels();
    if(viewId==='datacenter'){ renderDataCenter(); renderAccTree(); accCloudRender(); accCloudRefresh(); }
    if(viewId==='gis') renderGis();
    if(viewId==='program') renderProgram();
    if(viewId==='quality-center') renderQualityCenter();
    if(viewId==='reports') renderReports();
    if(viewId==='delivery') renderDeliverables();
    if(viewId==='stages') renderStages();
    if(viewId==='settings'){ renderSettings(); renderSyncSettings(); renderFormaSettings(); renderCloudSettings(); }
    if(!opts.silent) closeSearch();
    if(viewId!=='gis'){ try{ gisCancelDraw(true); }catch(e){} }
    try{ refreshNavBadges(); }catch(e){}
  }

  function lazyLoadModule(mod){
    if(loadedModules[mod.id]) return;
    var frame = document.getElementById('frame-'+mod.id);
    if(!frame) return;
    frame.src = mod.file;
    loadedModules[mod.id] = true;
    frame.addEventListener('load', function(){
      framesReady[mod.id] = true;
      pushContextToModule(mod.id);
      flushPendingSends(mod.id);
    });
    var p = activeProject();
    logActivity('Opened ' + mod.label + (p ? ' for ' + p.name : ''), 'info');
    renderDashboard(); // activity feed may be visible
  }

  function pushContextToModule(modId){
    var frame = document.getElementById('frame-'+modId);
    if(!frame || !frame.contentWindow) return;
    var p = activeProject();
    frame.contentWindow.postMessage({
      source:'orascom-hub', type:'set-context',
      context: p ? {id:p.id, name:p.name, code:p.code} : null,
      theme: hubTheme()
    }, '*');
  }

  window.addEventListener('message', function(ev){
    if(!ev || !ev.data || ev.data.source!=='orascom-hub-module') return;

    if(ev.data.type==='theme-toggle'){ toggleDark(); return; }

    if(ev.data.type==='ready'){
      // find which frame this came from and (re)send context
      MODULES.forEach(function(m){
        var f = document.getElementById('frame-'+m.id);
        if(f && f.contentWindow === ev.source) pushContextToModule(m.id);
      });
    }

    if(ev.data.type==='score-update'){
      var srcModId = null;
      MODULES.forEach(function(m){
        var f = document.getElementById('frame-'+m.id);
        if(f && f.contentWindow === ev.source) srcModId = m.id;
      });
      if(!srcModId) return;
      // prefer the project id the module was actually given context for;
      // fall back to whichever project is currently active in the Hub
      var pid = (ev.data.context && ev.data.context.id) || state.active;
      var findings = (ev.data.meta && ev.data.meta.findings) || ev.data.findings || [];
      applyModuleScore(pid, srcModId, ev.data.score, ev.data.issues, findings,
        ev.data.meta && ev.data.meta.projectField, null);
    }
  });

  /* ---------------- score recording (modules + nightly rollups) ---------------- */
  // Single choke point for every auto-reported score: interactive module
  // postMessages and headless hubscores rollups share it, so dashboard math,
  // issue filing and history snapshots behave identically either way.
  // Hand-entered scores (auto:false) are NEVER clobbered by automation.
  function applyModuleScore(pid, modId, score, issues, findings, enteredName, batch){
    if(!pid) return false;
    var existing = state.scores[pid] && state.scores[pid][modId];
    if(existing && !existing.auto) return false;
    if(!state.scores[pid]) state.scores[pid] = {};
    var s = Math.max(0, Math.min(100, Number(score)));
    if(isNaN(s)) return false;
    s = Math.round(s*10)/10;
    var proj = state.projects.find(function(p){return p.id===pid;});
    var mismatch = !!(enteredName && proj && enteredName.trim() && enteredName.trim().toLowerCase()!==proj.name.trim().toLowerCase());
    state.scores[pid][modId] = {
      score:s, issues: Number(issues)||0, updated: Date.now(), auto:true,
      enteredName: enteredName||null, mismatch: mismatch
    };
    persist('scores');
    var mod = MODULES.find(function(m){return m.id===modId;});
    logActivity((mod?mod.label:modId)+' auto-reported '+s+'%'+(proj?' for '+proj.name:'')+(batch?' (nightly '+batch+')':''), 'ok');
    if(pid && findings && findings.length) fileAutoIssues(pid, modId, findings);
    snapshotHistory(pid);
    if(currentView==='dashboard') renderDashboard();
    if(currentView==='quality-center') renderQualityCenter();
    if(currentView==='projects') renderProjects();
    return true;
  }

  /* ---------------- validator findings -> Hub issues ---------------- */
  // Modules may attach up to ~20 concrete findings {desc, severity, model?}
  // to their score report. They are filed as source:'auto' issues, de-duplicated
  // against still-open auto issues, and capped so one run cannot flood the log.
  function fileAutoIssues(pid, modId, findings){
    var added = 0;
    findings.slice(0,20).forEach(function(f){
      var desc = String((f && f.desc) || '').trim().slice(0,220);
      if(!desc) return;
      var dup = state.issues.some(function(i){
        return i.project===pid && i.module===modId && i.description===desc &&
               i.status!=='Closed' && i.status!=='Waived' && i.status!=='Resolved';
      });
      if(dup) return;
      var openAuto = state.issues.filter(function(i){
        return i.project===pid && i.module===modId && i.source==='auto' &&
               (i.status==='Open' || i.status==='In Progress');
      }).length;
      if(openAuto>=20) return;
      var sev = (f && f.severity) || 'Medium';
      if(['Critical','High','Medium','Low'].indexOf(sev)===-1) sev = 'Medium';
      state.issues.push({
        id: uid('iss'), project: pid, module: modId, description: desc,
        severity: sev, status: 'Open', due: null,
        model: (f && f.model) || '', responsible: '', created: Date.now(), source: 'auto'
      });
      added++;
    });
    if(added){
      persist('issues');
      var mod2 = MODULES.find(function(m){return m.id===modId;});
      logActivity('Filed '+added+' issue'+(added===1?'':'s')+' from '+(mod2?mod2.label:modId), 'warn');
    }
  }

  /* ---------------- toast ---------------- */
  function toast(msg){
    var host = document.getElementById('toast-host');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .3s'; }, 2400);
    setTimeout(function(){ if(t.parentNode) host.removeChild(t); }, 2800);
  }

  /* ---------------- guided tour (first run + topbar button) ---------------- */
  var TOUR_STEPS = [
    {el:'.sidebar', title:'1 \u00b7 Navigation', text:'Modules live left, content right. Validation modules embed the full tools \u2014 nothing was simplified.'},
    {el:'#project-picker-select', title:'2 \u00b7 Active project', text:'Everything \u2014 scores, issues, deliverables, models \u2014 is tracked per project. Modules are told which project is active.'},
    {view:'datacenter', el:'#dc-drop', title:'3 \u00b7 Data Center', text:'Import shared files once here, then push them to any validator. No more dropping the same file in two places.'},
    {view:'dashboard', el:'#dash-content', title:'4 \u00b7 Health dashboard', text:'BIM Delivery Health blends every recorded module score. Missing modules are excluded \u2014 never scored as zero.'},
    {view:'quality-center', el:'#qc-content', title:'5 \u00b7 Quality Center', text:'Per-area scores plus the issue log. Validator findings arrive here automatically; manual entries stay separate.'},
    {view:'reports', el:'#reports-content', title:'6 \u00b7 Reports', text:'One-click executive Excel and PDF across all areas. Each module keeps its own native exports too.'},
    {view:'delivery', el:'#deliverables-content', title:'7 \u00b7 Delivery overview', text:'Planned deliverables on a timeline with schedule health. Dates you track here feed the dashboard.'},
    {view:'stages', el:'#stages-content', title:'8 \u00b7 Stage gates', text:'Design-stage sign-offs per package \u2014 click a cell to advance it. Hand-recorded, never inferred.'},
    {view:'settings', el:'#settings-weights', title:'9 \u00b7 Weighting', text:'Decide how much each module counts toward overall health. Thresholds for Good / Attention / Critical live here too.'}
  ];
  var TOUR_CURRENT = -1;
  function startTour(){
    TOUR_CURRENT = -1;
    nextTourStep();
  }
  function endTour(finished){
    TOUR_CURRENT = -1;
    try{ document.getElementById('tour-overlay').style.display='none'; }catch(e){}
    var h = document.querySelector('.tour-highlight'); if(h) h.remove();
    var c = document.querySelector('.tour-card'); if(c) c.remove();
    try{ localStorage.setItem(LS.tour, '1'); }catch(e){}
    if(finished) switchView('dashboard');
  }
  function nextTourStep(){ TOUR_CURRENT++; renderTourStep(false); }
  function prevTourStep(){ if(TOUR_CURRENT>0){ TOUR_CURRENT--; renderTourStep(false); } }
  function renderTourStep(retried){
    if(TOUR_CURRENT>=TOUR_STEPS.length){ endTour(true); toast('Tour complete'); return; }
    var step = TOUR_STEPS[TOUR_CURRENT];
    if(step.view && currentView!==step.view){
      switchView(step.view);
      if(!retried){ setTimeout(function(){ renderTourStep(true); }, 120); return; }
    }
    var el = document.querySelector(step.el);
    var rect = el ? el.getBoundingClientRect() : null;
    if(!el || !rect || rect.width===0){
      if(!retried && step.view){ setTimeout(function(){ renderTourStep(true); }, 200); return; }
      TOUR_CURRENT++; renderTourStep(false); return;
    }
    try{ document.getElementById('tour-overlay').style.display='block'; }catch(e){}
    var oldH = document.querySelector('.tour-highlight'); if(oldH) oldH.remove();
    var oldC = document.querySelector('.tour-card'); if(oldC) oldC.remove();
    var h = document.createElement('div'); h.className='tour-highlight';
    h.style.cssText='left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;height:'+rect.height+'px;';
    document.body.appendChild(h);
    var card = document.createElement('div'); card.className='tour-card';
    var l = rect.left+rect.width+14, t = rect.top;
    if(l+360>window.innerWidth) l = Math.max(10, rect.left-370);
    if(t+220>window.innerHeight) t = Math.max(10, window.innerHeight-230);
    card.style.cssText='left:'+l+'px;top:'+t+'px;';
    card.innerHTML='<h3>'+escapeHtml(step.title)+'</h3><p>'+escapeHtml(step.text)+'</p><div class="tour-actions">'+
      (TOUR_CURRENT>0?'<button class="tour-btn" onclick="OHub.prevTourStep()">Back</button>':'')+
      '<button class="tour-btn tour-skip" onclick="OHub.endTour(false)">Skip</button>'+
      '<button class="tour-btn tour-next" onclick="OHub.nextTourStep()">'+(TOUR_CURRENT<TOUR_STEPS.length-1?'Next':'Finish')+'</button></div>'+
      '<div class="tour-count">'+(TOUR_CURRENT+1)+' / '+TOUR_STEPS.length+'</div>';
    document.body.appendChild(card);
  }

  function emptyState(icon, title, body, actionsHtml){
    return '<div class="empty-state"><div class="es-ic">'+icon+'</div><h4>'+escapeHtml(title)+'</h4><p>'+escapeHtml(body)+'</p>'+(actionsHtml||'')+'</div>';
  }

  /* ---------------- project picker + projects view ---------------- */
  function refreshProjectPicker(){
    var sel = document.getElementById('project-picker-select');
    sel.innerHTML = '';
    if(state.projects.length===0){
      var o = document.createElement('option');
      o.textContent = 'No projects yet';
      o.value = '';
      sel.appendChild(o);
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    state.projects.forEach(function(p){
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.code ? (p.code+' \u2014 '+p.name) : p.name;
      if(p.id===state.active) o.selected = true;
      sel.appendChild(o);
    });
  }
  function setActiveProject(pid){
    state.active = pid;
    persist('active');
    refreshProjectPicker();
    MODULES.forEach(function(m){ if(loadedModules[m.id]) pushContextToModule(m.id); });
    renderDashboard(); renderProjects(); renderQualityCenter();
    if(currentView==='delivery') renderDeliverables();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    if(currentView==='models') renderModels();
    if(currentView==='stages') renderStages();
    if(currentView==='reports') renderReports();
  }

  var projectsViewMode = 'grid';
  var mapObj = null, mapMarkers = [];
  var boundaryDirty = false; // project modal: true once the boundary field/file/clear was touched
  var plotCodeStaged = null, plotJsonStaged = '', plotRevStaged = null; // library plot staged from the Assign-plot dropdown

  function setProjectsView(mode){
    projectsViewMode = mode;
    document.getElementById('projects-grid').style.display = mode==='grid' ? 'grid' : 'none';
    document.getElementById('projects-map').style.display = mode==='map' ? 'block' : 'none';
    document.getElementById('projects-compare').style.display = mode==='compare' ? 'block' : 'none';
    document.querySelectorAll('.view-toggle-btn').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-mode')===mode);
    });
    if(mode==='map') renderProjectsMap();
    if(mode==='compare') renderCompare();
  }

  function renderProjects(){
    var host = document.getElementById('projects-grid');
    if(state.projects.length===0){
      host.innerHTML = emptyState('\uD83C\uDFE2','No projects yet',
        'Add a project to start tracking its BIM Digital Delivery status across delivery, naming, model quality, worksets, parameters and clashes.',
        '<button class="btn btn-primary" onclick="OHub.openProjectModal()">+ Add project</button> '+
        '<button class="btn btn-outline" onclick="OHub.seedDemo()">Load Demo SA39</button>');
      return;
    }
    host.innerHTML = state.projects.map(function(p){
      var h = computeHealth(p.id);
      var badge = h.value==null ? '<span class="badge badge-muted">No data</span>'
        : '<span class="badge badge-'+toneBadge(tone(h.value))+'">'+statusLabel(h.value)+'</span>';
      return '<div class="project-card '+(p.id===state.active?'active':'')+'" onclick="OHub.setActiveProject(\''+p.id+'\')">'+
        '<div class="pc-code">'+escapeHtml(p.code||'\u2014')+'</div>'+
        '<div class="pc-name">'+escapeHtml(p.name)+'</div>'+
        '<div class="pc-meta">'+escapeHtml(p.client||'No client set')+' \u00b7 '+escapeHtml(p.stage||'Stage not set')+'</div>'+
        '<div class="pc-foot">'+
          '<div style="font-family:\'Barlow Condensed\',sans-serif;font-weight:800;font-size:1.3rem;color:var(--ink);">'+(h.value==null?'\u2014':h.value+'%')+'</div>'+
          badge+
        '</div>'+
      '</div>';
    }).join('');
    if(projectsViewMode==='map') renderProjectsMap();
    if(projectsViewMode==='compare') renderCompare();
  }

  function renderCompare(){
    var host = document.getElementById('projects-compare');
    if(!host) return;
    if(state.projects.length<2){
      host.innerHTML = emptyState('\uD83D\uDCCA','Nothing to compare',
        'Add at least two projects with recorded results to compare them side by side.',
        '<button class="btn btn-primary" onclick="OHub.openProjectModal()">+ Add project</button>');
      return;
    }
    function cell(v){ return v==null ? '<span style="color:var(--muted);">\u2014</span>' : v+'%'; }
    var head = '<tr><th>Project</th><th>Health</th>'+MODULES.map(function(m){return '<th>'+escapeHtml(m.label)+'</th>';}).join('')+'<th>Models</th><th>Open issues</th></tr>';
    var body = state.projects.map(function(p){
      var h = computeHealth(p.id), sc = projectScores(p.id);
      var open = state.issues.filter(function(i){ return i.project===p.id && (i.status==='Open'||i.status==='In Progress'); }).length;
      return '<tr><td><a href="#" onclick="OHub.setActiveProject(\''+p.id+'\');return false;"><strong>'+escapeHtml(p.code ? (p.code+' \u2014 '+p.name) : p.name)+'</strong></a></td>'+
        '<td><strong>'+(h.value==null?'\u2014':h.value+'%')+'</strong></td>'+
        MODULES.map(function(m){ var r=sc[m.id]; return '<td>'+cell(r?r.score:null)+'</td>'; }).join('')+
        '<td>'+projectModels(p.id).length+'</td><td>'+open+'</td></tr>';
    }).join('');
    var withData = state.projects.map(function(p){ return {p:p, h:computeHealth(p.id).value}; }).filter(function(x){ return x.h!=null; });
    var chartHtml = withData.length<2
      ? '<p style="font-size:.82rem;color:var(--muted);">Health chart appears once two or more projects have recorded results.</p>'
      : '<div style="position:relative;height:220px;"><canvas id="compare-chart"></canvas></div>';
    host.innerHTML = '<div class="card" style="margin-bottom:18px;"><div class="card-head"><h3>Health by project</h3></div>'+chartHtml+'</div>'+
      '<div class="tbl-wrap"><table class="tbl"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
    if(withData.length>=2 && typeof Chart!=='undefined'){
      var el = document.getElementById('compare-chart');
      if(!el) return;
      try{ if(compareChart) compareChart.destroy(); }catch(e){}
      var dark = !!state.dark;
      try{
        compareChart = new Chart(el, {type:'bar',
          data:{labels:withData.map(function(x){ return x.p.code||x.p.name; }),
            datasets:[{data:withData.map(function(x){return x.h;}), backgroundColor:'#2563B8'}]},
          options:{indexAxis:'y', responsive:true, maintainAspectRatio:false,
            plugins:{legend:{display:false}},
            scales:{x:{min:0, max:100, ticks:{color:dark?'#E7EDF7':'#5D7494'}, grid:{color:dark?'#233252':'#D0DAE8'}},
                    y:{ticks:{color:dark?'#E7EDF7':'#5D7494'}, grid:{display:false}}}}});
      }catch(e){}
    }
  }

  function mapTileFor(theme){
    // CARTO basemaps now require an API key, so dark mode uses Esri's
    // keyless dark-gray canvas (base + reference overlay for labels).
    if(theme==='dark') return {urls:['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
      attr:'Tiles \u00a9 Esri \u2014 Esri, DeLorme, NAVTEQ'};
    return {url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr:'\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'};
  }
  function makeBaseLayer(spec){
    if(spec.urls) return L.layerGroup(spec.urls.map(function(u){ return L.tileLayer(u, {maxZoom:18, attribution:spec.attr}); }));
    return L.tileLayer(spec.url, {maxZoom:18, attribution:spec.attr});
  }
  // Per-project zone color override (project form). Wins in package/overall
  // modes; review/stage/issues modes keep their honest status colors.
  function customColor(p){
    var c = p && p.color;
    return (typeof c==='string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : null;
  }
  function zoneColorSet(pid, val){
    if(!/^#[0-9a-fA-F]{6}$/.test(val||'')){ toast('Invalid color'); return; }
    var p = null;
    state.projects.forEach(function(x){ if(x.id===pid) p = x; });
    if(!p) return;
    p.color = val;
    persist('projects');
    renderProjects();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    toast('Zone color updated');
  }
  function zoneColor(p, fallback){
    if((gisMode==='package'||gisMode==='overall') && customColor(p)) return customColor(p);
    return fallback;
  }
  var mapTileTheme = '', mapTileLayer = null;
  // Honest derived metric: equirectangular shoelace on [lng,lat] rings (holes subtract).
  function boundaryAreaKm2(coords){
    var total = 0;
    (coords||[]).forEach(function(poly){
      (poly||[]).forEach(function(ring, ri){
        if(!ring || ring.length<3) return;
        var a = 0, mLat = 0, i, c1, c2;
        for(i=0;i<ring.length;i++){
          c1 = ring[i]; c2 = ring[(i+1)%ring.length];
          a += (c1[0]*c2[1] - c2[0]*c1[1]);
          mLat += c1[1];
        }
        mLat = mLat/ring.length;
        var kx = 111.32*Math.cos(mLat*Math.PI/180), ky = 110.57;
        var km = Math.abs(a)/2*kx*ky;
        total += (ri===0 ? km : -km);
      });
    });
    return Math.max(0, total);
  }
  function fmtArea(km2){
    if(km2>=10) return Math.round(km2)+' km\u00b2';
    if(km2>=1) return (Math.round(km2*10)/10)+' km\u00b2';
    if(km2>=0.01) return (Math.round(km2*100)/100)+' km\u00b2';
    return Math.round(km2*1000000)+' m\u00b2';
  }
  function renderProjectsMap(){
    var container = document.getElementById('projects-map');
    if(typeof L==='undefined'){
      container.innerHTML = '<div class="empty-state"><div class="es-ic">\uD83D\uDDFA</div><h4>Map library unavailable</h4><p>Leaflet did not load (no internet connection in this browser). The grid view above still works fully offline.</p></div>';
      return;
    }
    var located = state.projects.filter(function(p){ return typeof p.lat==='number' && typeof p.lng==='number'; });
    if(!mapObj){
      container.innerHTML = '<div id="leaflet-el" style="width:100%;height:100%;"></div>';
      mapObj = L.map('leaflet-el', {scrollWheelZoom:true});
      mapTileTheme = ''; mapTileLayer = null;
      mapObj.setView([26.8206, 30.8025], 5); // default: Egypt-wide view
    }
    // Projects map defaults to Aerial imagery (Esri, keyless) in both themes.
    if(mapTileTheme!=='aerial'){
      if(mapTileLayer){ try{ mapObj.removeLayer(mapTileLayer); }catch(e){} mapTileLayer = null; }
      var spec = gisTileSpec('aerial');
      mapTileLayer = makeBaseLayer(spec).addTo(mapObj);
      mapTileTheme = 'aerial';
    }
    mapMarkers.forEach(function(m){ mapObj.removeLayer(m); });
    mapMarkers = [];
    var hasPoly = state.projects.some(function(p){ return p.boundary && p.boundary.coordinates; });
    if(located.length===0 && !hasPoly){
      // no markers to show; keep default wide view
      setTimeout(function(){ mapObj.invalidateSize(); }, 50);
      return;
    }
    var bounds = [];
    located.forEach(function(p){
      var h = computeHealth(p.id);
      var color = TONE_HEX[tone(h.value)];
      var icon = L.divIcon({
        className: '',
        html: '<div style="width:16px;height:16px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>',
        iconSize:[16,16], iconAnchor:[8,8]
      });
      var mk = L.marker([p.lat, p.lng], {icon:icon}).addTo(mapObj);
      mk.bindPopup(
        '<strong>'+escapeHtml(p.name)+'</strong><br>'+
        escapeHtml(p.code||'')+'<br>'+
        'Health: '+(h.value==null?'no data':h.value+'%')
      );
      mk.on('click', function(){ setActiveProject(p.id); });
      mapMarkers.push(mk);
      bounds.push([p.lat, p.lng]);
    });
    // Site boundaries (GeoJSON [lng,lat] flipped to Leaflet [lat,lng]), toned by health
    state.projects.forEach(function(p){
      if(!p.boundary || !p.boundary.coordinates) return;
      var rings = [];
      p.boundary.coordinates.forEach(function(poly){
        (poly||[]).forEach(function(ring){
          var ll = (ring||[]).map(function(c){ return [c[1], c[0]]; });
          if(ll.length>=3) rings.push(ll);
        });
      });
      if(!rings.length) return;
      var hb = computeHealth(p.id);
      var pg = L.polygon(rings, {color:customColor(p)||TONE_HEX[tone(hb.value)], weight:2, fillOpacity:0.18, className:zoneAlert(p.id)?'zone-alert':''}).addTo(mapObj);
      pg.bindTooltip(p.code||p.name, {permanent:true, direction:'center', className:'plot-label'});
      pg.bindPopup('<strong>'+escapeHtml(p.name)+'</strong><br>'+
        escapeHtml(p.code||'')+'<br>'+
        'Health: '+(hb.value==null?'no data':hb.value+'%')+'<br>'+
        'Site: \\u2248 '+fmtArea(boundaryAreaKm2(p.boundary.coordinates))+
        (fmtKpiLine(p.kpi) ? '<br>'+fmtKpiLine(p.kpi) : '')+alertLine(p.id));
      pg.on('click', function(){ setActiveProject(p.id); });
      mapMarkers.push(pg);
      try{
        var pb = pg.getBounds();
        bounds.push([pb.getSouth(), pb.getWest()], [pb.getNorth(), pb.getEast()]);
      }catch(e){}
    });
    setTimeout(function(){
      mapObj.invalidateSize();
      if(bounds.length===1){ mapObj.setView(bounds[0], 10); }
      else { mapObj.fitBounds(bounds, {padding:[30,30]}); }
    }, 50);
  }

  /* ---------------- GIS tab ---------------- */
  // MODON-style plots board: every library plot on one map with its KPIs,
  // plus any custom project boundary. Assign actions write through the
  // same validated boundary path as the project form.
  var gisMapObj = null, gisLayers = [], gisTileTheme = '', gisTileLayer = null;
  var gisMode = 'package', gisBase = 'auto', gisQuery = '', gisSearchFocus = false;
  var gisPlotBounds = {};
  var DP_COLORS = {DP01:'#14b8a6',DP05:'#8b5cf6'};
  var GIS_MODES = [
    {id:'package', label:'Design Package'},
    {id:'review', label:'Review Status'},
    {id:'stage', label:'Current Stage'},
    {id:'overall', label:'Overall'},
    {id:'issues', label:'Issues'}
  ];
  function gisTileSpec(which){
    if(which==='aerial') return {url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr:'Tiles \u00a9 Esri \u2014 Source: Esri, Maxar, Earthstar Geographics'};
    if(which==='dark') return mapTileFor('dark');
    if(which==='streets') return mapTileFor('light');
    return mapTileFor(hubTheme()==='dark' ? 'dark' : 'light');
  }
  function holderGates(pid){
    var total=0, approved=0, submitted=0, wip=0, furthest=-1;
    Object.keys(state.gates||{}).forEach(function(k){
      if(k.indexOf(pid+'|')!==0) return;
      var st = state.gates[k];
      var stage = k.split('|').slice(2).join('|');
      var idx = GATE_STAGES.indexOf(stage);
      total++;
      if(st==='Approved'){ approved++; if(idx>furthest) furthest=idx; }
      else if(st==='Submitted') submitted++;
      else if(st==='In Progress') wip++;
    });
    return {total:total, approved:approved, submitted:submitted, wip:wip, furthest:furthest};
  }
  function holderOverdue(pid){
    var d0 = new Date(); d0.setHours(0,0,0,0);
    var tToday = d0.getTime();
    return state.deliverables.filter(function(d){
      if(d.project!==pid) return false;
      var t = delivTime(d.due);
      return t!=null && t<tToday && d.status!=='Submitted';
    }).length;
  }
  function holderOpenIssues(pid){
    return state.issues.filter(function(i){ return i.project===pid && (i.status==='Open'||i.status==='In Progress'); }).length;
  }
  // MODON-style alert: a zone flashes and its texts go red while its holder
  // has open issues or overdue deliverables. One predicate drives map flash,
  // register rows, popups and nav badges so they can never disagree.
  function zoneAlert(pid){
    return holderOpenIssues(pid)>0 || holderOverdue(pid)>0;
  }
  function alertLine(pid){
    var open = holderOpenIssues(pid), od = holderOverdue(pid);
    if(!open && !od) return '';
    return '<span style="display:block;font-size:.76rem;color:var(--fail2);font-weight:700;">'+
      (od>0 ? ('\u26a0 '+od+' overdue'+(open>0 ? ' \\u00b7 ' : '')) : '')+
      (open>0 ? (open+' open issue'+(open>1?'s':'')) : '')+'</span>';
  }
  function setNavBadge(view, n){
    var item = document.querySelector('.nav-item[data-view="'+view+'"]');
    if(!item) return;
    var b = item.querySelector('.nav-badge');
    if(n>0){
      if(!b){ b = document.createElement('span'); b.className = 'nav-badge'; item.appendChild(b); }
      b.textContent = n>99 ? '99+' : String(n);
      b.style.display = '';
    } else if(b){ b.style.display = 'none'; }
  }
  function refreshNavBadges(){
    var p = activeProject();
    setNavBadge('quality-center', p ? holderOpenIssues(p.id) : 0);
    setNavBadge('delivery', p ? holderOverdue(p.id) : 0);
    var alerts = 0, seen = {};
    state.projects.forEach(function(x){
      if((x.boundary && x.boundary.coordinates) && !seen[x.id] && zoneAlert(x.id)){ seen[x.id]=1; alerts++; }
    });
    setNavBadge('gis', alerts);
  }
  function plotBucket(holder, g, overdue){
    if(!holder) return 'Not Started';
    if(overdue>0) return 'Delayed';
    if(g.total>0 && g.approved===g.total) return 'Approved';
    if(g.submitted>0) return 'Submitted';
    if(g.wip>0) return 'In Progress';
    return 'Not Started';
  }
  function bucketBadge(b){
    if(b==='Approved') return '<span class="badge badge-ok">Approved</span>';
    if(b==='Submitted') return '<span class="badge badge-info">Submitted</span>';
    if(b==='In Progress') return '<span class="badge badge-warn">In Progress</span>';
    if(b==='Delayed') return '<span class="badge badge-fail">Delayed</span>';
    return '<span class="badge badge-muted">Not Started</span>';
  }
  function plotModeStyle(pl, holder, g, overdue, open){
    if(gisMode==='package'){
      if(DP_COLORS[pl.code]) return {color:DP_COLORS[pl.code], fill:0.30, dash:null, tag:pl.code};
      return {color:'#8E9BB3', fill:0.10, dash:null, tag:pl.code}; // neighbours: grey context, no data
    }
    if(!holder) return {color:'#8E9BB3', fill:0.06, dash:'4 4', tag:pl.code+'<br>Unassigned'};
    var h = computeHealth(holder.id);
    if(gisMode==='review'){
      var b0 = plotBucket(holder, g, overdue);
      if(overdue>0) return {color:'#E03535', fill:0.32, dash:null, tag:pl.code+'<br>'+b0+' \u26a0'+overdue+' overdue'};
      return {color:TONE_HEX[tone(h.value)], fill:0.24, dash:null, tag:pl.code+'<br>'+b0};
    }
    if(gisMode==='stage'){
      var sc = ['#8E9BB3','#E67E22','#E67E22','#4A5FBB','#27AE60','#27AE60'][Math.min(5, g.furthest+1)];
      var sn = g.furthest<0 ? 'Not started' : GATE_STAGES[g.furthest];
      return {color:sc, fill:0.30, dash:null, tag:pl.code+'<br>'+escapeHtml(sn)};
    }
    if(gisMode==='issues'){
      var ic = open===0 ? '#27AE60' : open<=2 ? '#E67E22' : '#E03535';
      return {color:ic, fill:0.30, dash:null, tag:pl.code+'<br>'+open+' open'};
    }
    return {color:TONE_HEX[tone(h.value)], fill:0.22, dash:null,
      tag:pl.code+'<br>'+(h.value==null?'no data':h.value+'%')};
  }
  function ringFlip(multi){
    var out = [];
    // Tolerate Polygon-level nesting too (defensive: validated saves are
    // always MultiPolygon, but never let a shape vanish silently).
    if(multi && multi.length && typeof multi[0][0]==='number') multi = [[multi]];
    else if(multi && multi.length && multi[0].length && typeof multi[0][0][0]==='number') multi = [multi];
    (multi||[]).forEach(function(poly){
      (poly||[]).forEach(function(ring){
        var ll = (ring||[]).map(function(c){ return [c[1], c[0]]; });
        if(ll.length>=3) out.push(ll);
      });
    });
    return out;
  }
  function numFmt(n){ return Number(n||0).toLocaleString('en-US'); }
  function fmtKpiLine(kpi){
    if(!kpi) return '';
    var parts = [];
    if(kpi.units!=null) parts.push('<strong>'+numFmt(kpi.units)+'</strong> units');
    if(kpi.population!=null) parts.push('<strong>'+numFmt(kpi.population)+'</strong> pop');
    if(kpi.buildings!=null) parts.push('<strong>'+numFmt(kpi.buildings)+'</strong> bldgs');
    if(kpi.gsa!=null) parts.push('GSA '+numFmt(kpi.gsa));
    if(kpi.gfa!=null) parts.push('GFA '+numFmt(kpi.gfa));
    if(kpi.gla!=null) parts.push('GLA '+numFmt(kpi.gla));
    return parts.join(' \u00b7 ');
  }
  function gisAssignPlot(code){
    var p = activeProject();
    if(!p){ toast('Select a project first, then assign the plot to it'); switchView('projects'); return; }
    var found = null;
    sitePlots().forEach(function(pl){ if(pl.code===code) found = pl; });
    if(!found){ toast('Plot not found in library'); return; }
    if(!found.kpi){ toast('No data for '+code+' \u2014 Orascom holds DP01 and DP05'); return; }
    p.boundary = {type:'MultiPolygon', coordinates:[found.rings]};
    p.plotCode = code; p.plotRev = 2;
    persist('projects');
    logActivity('Assigned plot '+code+' to '+p.name);
    gisSearchFocus = false;
    renderProjects(); renderDashboard();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    toast(code+' assigned to '+p.name);
  }
  function renderGis(){
    var mapHost = document.getElementById('gis-map');
    var regHost = document.getElementById('gis-register');
    if(!mapHost || !regHost) return;
    var plots = sitePlots();
    if(typeof L==='undefined'){
      mapHost.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:var(--muted);">Map library unavailable offline.</div>';
      regHost.innerHTML = '';
      return;
    }
    if(!gisMapObj){
      gisMapObj = L.map('gis-map', {scrollWheelZoom:true});
      gisMapObj.setView([31.10, 27.81], 13); // Wadi Yemm plots cluster (coast)
    }
    var wantBase = gisBase==='auto' ? (hubTheme()==='dark' ? 'dark' : 'streets') : gisBase;
    if(gisTileTheme!==wantBase){
      if(gisTileLayer){ try{ gisMapObj.removeLayer(gisTileLayer); }catch(e){} gisTileLayer = null; }
      var spec = gisTileSpec(wantBase);
      gisTileLayer = makeBaseLayer(spec).addTo(gisMapObj);
      gisTileTheme = wantBase;
    }
    gisLayers.forEach(function(l){ try{ gisMapObj.removeLayer(l); }catch(e){} });
    gisLayers = [];
    gisPlotBounds = {};
    var bounds = [];
    function trackBounds(ll){
      ll.forEach(function(ring){ ring.forEach(function(c){ bounds.push(c); }); });
    }
    var usedBy = {};
    state.projects.forEach(function(p){ if(p.plotCode) usedBy[p.plotCode] = p; });
    var dataPlots = plots.filter(function(pl){ return !!pl.kpi; }); // neighbours stay map-only
    plots.forEach(function(pl){
      var ll = ringFlip([pl.rings]);
      if(!ll.length) return;
      var holder = usedBy[pl.code] || null;
      var g = holder ? holderGates(holder.id) : {total:0, approved:0, submitted:0, wip:0, furthest:-1};
      var overdue = holder ? holderOverdue(holder.id) : 0;
      var open = holder ? holderOpenIssues(holder.id) : 0;
      var stageName = g.furthest<0 ? '\u2014' : GATE_STAGES[g.furthest];
      var sty = plotModeStyle(pl, holder, g, overdue, open);
      var al = !!(holder && (open>0 || overdue>0));
      var atag = sty.tag + (al ? '<br><span style="color:#ff7b7b;">\u26a0 '+
        (overdue>0 ? (overdue+' overdue'+(open>0 ? ' \u00b7 ' : '')) : '')+
        (open>0 ? (open+' open') : '')+'</span>' : '');
      var pg = L.polygon(ll, {color:zoneColor(holder, sty.color), weight:2, fillOpacity:sty.fill, dashArray:sty.dash, className: al?'zone-alert':''}).addTo(gisMapObj);
      pg.bindTooltip(atag, {permanent:true, direction:'center', className:'plot-label'});
      var kpi = pl.kpi || null;
      var kpiLine = kpi ? '<br>Units: '+numFmt(kpi.units)+' \u00b7 Pop: '+numFmt(kpi.population)+' \u00b7 Bldgs: '+numFmt(kpi.buildings) : '';
      pg.bindPopup('<strong>'+escapeHtml(pl.code+' \u2014 '+pl.name)+'</strong><br>'+
        escapeHtml(pl.cluster||'')+'<br>'+
        'Site: \u2248 '+fmtArea(boundaryAreaKm2([pl.rings]))+kpiLine+'<br>'+
        'Review: '+plotBucket(holder, g, overdue)+' \\u00b7 Stage: '+escapeHtml(stageName)+
        ' \\u00b7 Open issues: '+(open>0 ? '<span style="color:var(--fail2);font-weight:700;">'+open+'</span>' : '0')+
        (overdue>0 ? ' \\u00b7 <span style="color:var(--fail2);font-weight:700;">'+overdue+' overdue</span>' : '')+'<br>'+
        (holder ? 'Assigned: '+escapeHtml(holder.name) : 'Unassigned'));
      if(holder) pg.on('click', (function(pid){ return function(){ setActiveProject(pid); }; })(holder.id));
      gisLayers.push(pg);
      gisPlotBounds[pl.code] = pg.getBounds();
      trackBounds(ll);
    });
    state.projects.forEach(function(p){
      if(!p.boundary || !p.boundary.coordinates || p.plotCode) return;
      var ll = ringFlip(p.boundary.coordinates);
      if(!ll.length) return;
      var hb2 = computeHealth(p.id);
      var pg2 = L.polygon(ll, {color:zoneColor(p, TONE_HEX[tone(hb2.value)]), weight:2, fillOpacity:0.18, className:zoneAlert(p.id)?'zone-alert':''}).addTo(gisMapObj);
      pg2.bindTooltip(p.code||p.name, {permanent:true, direction:'center', className:'plot-label'});
      pg2.bindPopup('<strong>'+escapeHtml(p.name)+'</strong><br>Custom boundary<br>'+
        'Site: \\u2248 '+fmtArea(boundaryAreaKm2(p.boundary.coordinates))+
        (fmtKpiLine(p.kpi) ? '<br>'+fmtKpiLine(p.kpi) : '')+alertLine(p.id));
      pg2.on('click', (function(pid){ return function(){ setActiveProject(pid); }; })(p.id));
      gisLayers.push(pg2);
      trackBounds(ll);
    });
    setTimeout(function(){
      gisMapObj.invalidateSize();
      if(bounds.length) gisMapObj.fitBounds(bounds, {padding:[30,30]});
      else gisMapObj.setView([31.10, 27.81], 13);
    }, 50);
    var ap = activeProject();
    paintGisDrawSeg();
    var modesHost = document.getElementById('gis-modes');
    if(modesHost){
      modesHost.innerHTML = GIS_MODES.map(function(m){
        return '<button class="seg-btn'+(gisMode===m.id?' active':'')+'" onclick="OHub.gisSetMode(\''+m.id+'\')">'+m.label+'</button>';
      }).join('');
    }
    var basesHost = document.getElementById('gis-bases');
    if(basesHost){
      basesHost.innerHTML = [{id:'dark',label:'Dark'},{id:'streets',label:'Streets'},{id:'aerial',label:'Aerial'}].map(function(b){
        var active = (gisBase==='auto' && ((b.id==='dark')===(hubTheme()==='dark'))) || gisBase===b.id;
        return '<button class="seg-btn'+(active?' active':'')+'" onclick="OHub.gisSetBase(\''+b.id+'\')">'+b.label+'</button>';
      }).join('');
    }
    var legHost = document.getElementById('gis-legend');
    if(legHost){
      var sw = function(c, l){ return '<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:11px;height:11px;border-radius:3px;background:'+c+';display:inline-block;"></span>'+l+'</span>'; };
      legHost.innerHTML = sw('#27AE60','Approved')+sw('#4A5FBB','Submitted')+sw('#E67E22','In Progress')+sw('#E03535','Delayed')+sw('#8E9BB3','Not Started')+
        '<span style="margin-left:auto;">Click a zone to open its project</span>';
    }
    var tblHost = document.getElementById('gis-table');
    if(tblHost){
      var far = function(kpi){ return (kpi.gsa>0 && kpi.gfa!=null) ? (Math.round(kpi.gfa/kpi.gsa*100)/100).toFixed(2) : '\u2014'; };
      tblHost.innerHTML = '<table class="tbl"><thead><tr><th>Package</th><th>Review</th><th>Stage</th>'+
        '<th style="text-align:right;">Plots</th><th style="text-align:right;">GSA (m\u00b2)</th>'+
        '<th style="text-align:right;">GFA (m\u00b2)</th><th style="text-align:right;">FAR</th>'+
        '<th style="text-align:right;">GLA (m\u00b2)</th><th style="text-align:right;">Units</th>'+
        '<th style="text-align:right;">Population</th><th style="text-align:right;">Buildings</th></tr></thead><tbody>'+
        dataPlots.map(function(pl){
          var holder = usedBy[pl.code] || null;
          var g = holder ? holderGates(holder.id) : {total:0, approved:0, submitted:0, wip:0, furthest:-1};
          var overdue = holder ? holderOverdue(holder.id) : 0;
          var kpi = pl.kpi || {};
          var stageName = g.furthest<0 ? '\u2014' : GATE_STAGES[g.furthest];
          var r = function(v){ return '<td style="text-align:right;">'+numFmt(v)+'</td>'; };
          return '<tr style="cursor:pointer;" onclick="OHub.gisFocusPlot(\''+escapeHtml(pl.code)+'\')">'+
            '<td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:'+zoneColor(holder,(DP_COLORS[pl.code]||'#8E9BB3'))+';margin-right:7px;"></span><strong>'+escapeHtml(pl.code)+'</strong> <span style="color:var(--muted);font-size:.76rem;">'+escapeHtml(pl.name)+'</span></td>'+
            '<td>'+bucketBadge(plotBucket(holder, g, overdue))+'</td>'+
            '<td>'+escapeHtml(stageName)+'</td>'+
            r(kpi.plots)+r(kpi.gsa)+r(kpi.gfa)+
            '<td style="text-align:right;">'+far(kpi)+'</td>'+
            r(kpi.gla)+r(kpi.units)+r(kpi.population)+r(kpi.buildings)+'</tr>';
        }).join('')+'</tbody></table>';
    }
    var q = (gisQuery||'').toLowerCase();
    var shown = dataPlots.filter(function(pl){
      return !q || pl.code.toLowerCase().indexOf(q)>-1 || (pl.name||'').toLowerCase().indexOf(q)>-1;
    });
    var buckets = {'Approved':0,'Submitted':0,'In Progress':0,'Delayed':0,'Not Started':0};
    dataPlots.forEach(function(pl){
      var holder = usedBy[pl.code] || null;
      var g = holder ? holderGates(holder.id) : {total:0, approved:0, submitted:0, wip:0, furthest:-1};
      buckets[plotBucket(holder, g, holder ? holderOverdue(holder.id) : 0)]++;
    });
    function sumCard(label, n, toneCls){
      return '<div class="card" style="padding:10px 12px;text-align:center;">'+
        '<div style="font-size:1.3rem;font-weight:800;color:var(--'+toneCls+');">'+n+'</div>'+
        '<div style="font-size:.66rem;letter-spacing:.1em;color:var(--muted);font-weight:700;">'+label+'<br>'+(dataPlots.length?Math.round(n/dataPlots.length*100):0)+'%</div></div>';
    }
    regHost.innerHTML =
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px;margin-bottom:12px;">'+
        sumCard('APPROVED', buckets['Approved'], 'ok2')+
        sumCard('SUBMITTED', buckets['Submitted'], 'info')+
        sumCard('IN PROGRESS', buckets['In Progress'], 'warn')+
        sumCard('DELAYED', buckets['Delayed'], 'fail2')+
        sumCard('NOT STARTED', buckets['Not Started'], 'muted')+
      '</div>'+
      '<div class="card" style="margin-bottom:12px;"><div class="card-head"><h3>Plot register</h3>'+
      '<span class="hint">'+shown.length+'/'+dataPlots.length+' plots</span></div>'+
      '<input id="gis-q" type="text" placeholder="Search package\u2026" value="'+escapeHtml(gisQuery)+'" oninput="OHub.gisSearch(this.value)" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:.8rem;background:var(--white);color:var(--text);margin-bottom:4px;">'+
      '<p style="font-size:.78rem;color:var(--muted);margin:6px 0 0;">'+(ap ? 'Assigning to active project: <strong>'+escapeHtml(ap.name)+'</strong>' : 'Select a project to enable assigning.')+'</p></div>' +
      (function(){
        var customs = state.projects.filter(function(p){ return p.boundary && p.boundary.coordinates && !p.plotCode; });
        if(!customs.length) return '';
        return '<div class="card" style="margin-bottom:12px;"><div class="card-head"><h3>My zones</h3>'+
          '<span class="hint">'+customs.length+'</span></div>'+
          customs.map(function(p){
            var col = customColor(p)||TONE_HEX[tone(computeHealth(p.id).value)];
            var zk = fmtKpiLine(p.kpi);
            return '<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--light);">'+
              '<input type="color" value="'+col+'" title="Edit zone color" onchange="OHub.zoneColorSet(\''+p.id+'\',this.value)" style="width:26px;height:20px;padding:0;border:1px solid var(--border);border-radius:4px;background:var(--white);cursor:pointer;flex-shrink:0;">'+
              '<span style="flex:1;cursor:pointer;" onclick="OHub.gisFocusProject(\''+p.id+'\')"><strong>'+escapeHtml(p.code ? (p.code+' \u2014 '+p.name) : p.name)+'</strong><br>'+
              '<span style="font-size:.74rem;color:var(--muted);">\u2248 '+fmtArea(boundaryAreaKm2(p.boundary.coordinates))+(zk ? '<br>'+zk : '')+alertLine(p.id)+'</span></span></div>';
          }).join('')+'</div>';
      })() +
      shown.map(function(pl){
        var holder = usedBy[pl.code] || null;
        var kpi = pl.kpi || {};
        var g = holder ? holderGates(holder.id) : {total:0, approved:0, submitted:0, wip:0, furthest:-1};
        var overdue = holder ? holderOverdue(holder.id) : 0;
        var bucket = plotBucket(holder, g, overdue);
        var stageName = g.furthest<0 ? '\u2014' : GATE_STAGES[g.furthest];
        var prog = g.total ? Math.round(g.approved/g.total*100) : 0;
        var dot = gisMode==='package' ? zoneColor(holder, (DP_COLORS[pl.code]||'#8E9BB3')) : plotModeStyle(pl, holder, g, overdue, holder?holderOpenIssues(holder.id):0).color;
        return '<div class="card" style="margin-bottom:10px;cursor:pointer;" onclick="OHub.gisFocusPlot(\''+escapeHtml(pl.code)+'\')">'+
          '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">'+
            '<span style="width:12px;height:12px;border-radius:3px;background:'+dot+';flex-shrink:0;"></span>'+
            '<h3 style="font-size:.92rem;margin:0;">'+escapeHtml(pl.code)+'</h3>'+
            '<span class="hint">'+escapeHtml(pl.name)+'</span></div>'+
          '<div style="font-size:.76rem;color:var(--muted);margin-bottom:6px;">'+escapeHtml(pl.cluster||'')+' \u00b7 \u2248 '+fmtArea(boundaryAreaKm2([pl.rings]))+'</div>'+
          '<div style="display:flex;gap:10px;align-items:center;font-size:.76rem;margin-bottom:6px;flex-wrap:wrap;">'+
            bucketBadge(bucket)+'<span>'+escapeHtml(stageName)+'</span>'+
            '<span style="flex:1;min-width:60px;height:5px;background:var(--light);border-radius:3px;overflow:hidden;">'+
              '<span style="display:block;height:100%;width:'+prog+'%;background:var(--b2);"></span></span>'+
            '<span style="color:var(--muted);">'+prog+'%</span></div>'+
          '<div style="font-size:.76rem;color:var(--muted);margin-bottom:8px;"><strong>'+numFmt(kpi.units)+'</strong> units \u00b7 <strong>'+numFmt(kpi.population)+'</strong> pop \u00b7 <strong>'+numFmt(kpi.buildings)+'</strong> bldgs</div>'+alertLine(holder?holder.id:null)+
          (holder
            ? '<div style="font-size:.78rem;">Assigned: <a href="#" onclick="OHub.setActiveProject(\''+holder.id+'\');return false;"><strong>'+escapeHtml(holder.name)+'</strong></a></div>'
            : '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
              '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();OHub.gisAssignPlot(\''+escapeHtml(pl.code)+'\')"'+(ap?'':' disabled')+'>Assign to active project</button>'+
              '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();OHub.gisNewProjectFromPlot(\''+escapeHtml(pl.code)+'\')">\uff0b New project</button></div>')+
        '</div>';
      }).join('');
    if(gisSearchFocus){
      var nq = document.getElementById('gis-q');
      if(nq){ nq.focus(); try{ nq.setSelectionRange(nq.value.length, nq.value.length); }catch(e){} }
    }
  }
  function gisSetMode(id){ gisMode = id; gisSearchFocus = false; renderGis(); }
  function gisSetBase(id){ gisBase = id; gisSearchFocus = false; renderGis(); }
  function gisSearch(v){ gisQuery = v||''; gisSearchFocus = true; renderGis(); }
  function gisFocusPlot(code){
    if(gisMapObj && gisPlotBounds[code]){ try{ gisMapObj.fitBounds(gisPlotBounds[code], {padding:[40,40]}); }catch(e){} }
  }
  function gisFocusProject(pid){
    var p = null;
    state.projects.forEach(function(x){ if(x.id===pid) p = x; });
    if(!p) return;
    setActiveProject(pid);
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    if(p.boundary && p.boundary.coordinates && gisMapObj){
      try{ gisMapObj.fitBounds(ringFlip(p.boundary.coordinates), {padding:[40,40]}); }catch(e){}
    }
  }
  function gisNewProjectFromPlot(code){
    var found = null;
    sitePlots().forEach(function(pl){ if(pl.code===code && pl.kpi) found = pl; });
    if(!found){ toast('No data for '+code+' \u2014 Orascom holds DP01 and DP05'); return; }
    var id = uid('proj');
    var p = {id:id, name:code+' \u2014 '+found.name, code:code, client:'', accUrl:'', stage:'Design',
      lat:null, lng:null, boundary:{type:'MultiPolygon', coordinates:[found.rings]},
      plotCode:code, plotRev:2, color:null};
    state.projects.push(p);
    state.active = id;
    persist('projects'); persist('active');
    logActivity('Added project '+p.name+' from plot '+code);
    refreshProjectPicker(); renderProjects(); renderDashboard(); renderQualityCenter();
    if(currentView==='models') renderModels();
    if(currentView==='reports') renderReports();
    if(currentView==='delivery') renderDeliverables();
    if(currentView==='stages') renderStages(); renderQualityCenter();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    toast(code+' added as a project and selected');
  }
  /* ----- hand-drawn zones: click to trace, finish to create a project ----- */
  var gisDrawing = false, gisDrawPts = [], gisDrawLayers = [], gisDrawLine = null;
  function paintGisDrawSeg(){
    var host = document.getElementById('gis-draw');
    if(!host) return;
    host.innerHTML = gisDrawing
      ? '<button class="seg-btn" onclick="OHub.gisFinishDraw()">Finish ('+gisDrawPts.length+')</button>'+
        '<button class="seg-btn" onclick="OHub.gisCancelDraw()">Cancel</button>'
      : '<button class="seg-btn" onclick="OHub.gisStartDraw()">Draw new zone</button>';
  }
  function gisStartDraw(){
    if(!gisMapObj || typeof L==='undefined'){ toast('Open the GIS tab first'); return; }
    gisCancelDraw(true);
    gisDrawing = true;
    gisDrawPts = [];
    try{ gisMapObj.doubleClickZoom.disable(); }catch(e){}
    try{ gisMapObj.on('click', gisDrawClick); }catch(e){}
    var mc = document.getElementById('gis-map');
    if(mc && mc.style) mc.style.cursor = 'crosshair';
    paintGisDrawSeg();
    toast('Click the map to trace the zone \u2014 Finish when done (min 3 points)');
  }
  function gisDrawClick(ev){
    if(!gisDrawing || !ev || !ev.latlng) return;
    var ll = ev.latlng;
    if(typeof ll.lat!=='number' || typeof ll.lng!=='number') return;
    gisDrawPts.push([ll.lat, ll.lng]);
    try{
      gisDrawLayers.push(L.circleMarker([ll.lat, ll.lng], {radius:4, color:'#fff', weight:2, fillColor:'#38c6ff', fillOpacity:1}).addTo(gisMapObj));
      if(gisDrawPts.length>1){
        if(gisDrawLine){ try{ gisMapObj.removeLayer(gisDrawLine); }catch(e){} }
        gisDrawLine = L.polyline(gisDrawPts, {color:'#38c6ff', weight:2, dashArray:'5 5'}).addTo(gisMapObj);
      }
    }catch(e){}
    paintGisDrawSeg();
  }
  function drawGeoJson(pts){
    // Leaflet [lat,lng] clicks -> closed MultiPolygon ([lng,lat]), the
    // storage format, so the shape survives even paths that skip validation.
    var ring = pts.map(function(p){ return [p[1], p[0]]; });
    ring.push(ring[0].slice());
    return {type:'MultiPolygon', coordinates:[[ring]]};
  }
  function gisFinishDraw(){
    if(!gisDrawing) return;
    if(gisDrawPts.length<3){ toast('Trace at least 3 points first'); return; }
    var geo = drawGeoJson(gisDrawPts);
    gisCancelDraw(true);
    openProjectModal(null);
    document.getElementById('pm-name').value = '';
    document.getElementById('pm-boundary').value = JSON.stringify(geo);
    boundaryPreview();
    try{ document.getElementById('pm-name').focus(); }catch(e){}
    toast('Name the project (e.g. Sales Resort Portaluna) and Save');
  }
  function gisCancelDraw(silent){
    gisDrawing = false;
    gisDrawPts = [];
    try{ if(gisMapObj){ gisMapObj.off('click', gisDrawClick); gisMapObj.doubleClickZoom.enable(); } }catch(e){}
    gisDrawLayers.forEach(function(l){ try{ gisMapObj.removeLayer(l); }catch(e){} });
    gisDrawLayers = [];
    if(gisDrawLine){ try{ gisMapObj.removeLayer(gisDrawLine); }catch(e){} gisDrawLine = null; }
    var mc = document.getElementById('gis-map');
    if(mc && mc.style) mc.style.cursor = '';
    paintGisDrawSeg();
    if(!silent) toast('Drawing discarded');
  }

  /* ---------------- Project modal ---------------- */
  function openProjectModal(editId){
    var editing = editId ? state.projects.find(function(p){return p.id===editId;}) : null;
    document.getElementById('pm-title').textContent = editing ? 'Edit project' : 'Add project';
    document.getElementById('pm-name').value = editing? editing.name:'';
    document.getElementById('pm-code').value = editing? editing.code:'';
    document.getElementById('pm-client').value = editing? editing.client:'';
    document.getElementById('pm-accurl').value = (editing && editing.accUrl) ? editing.accUrl : '';
    document.getElementById('pm-stage').value = editing? editing.stage:'Design';
    document.getElementById('pm-lat').value = (editing && typeof editing.lat==='number') ? editing.lat : '';
    document.getElementById('pm-lng').value = (editing && typeof editing.lng==='number') ? editing.lng : '';
    var colorAuto = !(editing && /^#[0-9a-fA-F]{6}$/.test(editing.color||''));
    document.getElementById('pm-color-auto').checked = colorAuto;
    document.getElementById('pm-color').value = (editing && editing.color) || '#38c6ff';
    document.getElementById('pm-color').disabled = colorAuto;
    var kpiEd = (editing && editing.kpi) || {};
    ['units','population','buildings','gsa','gfa','gla'].forEach(function(k){
      var el = document.getElementById('pm-kpi-'+k);
      if(el) el.value = (kpiEd[k]!=null && kpiEd[k]!=='') ? kpiEd[k] : '';
    });
    boundaryDirty = false;
    var bndTa = document.getElementById('pm-boundary');
    if(editing && editing.boundary && editing.boundary.coordinates){
      var bn = countBoundaryPoints(editing.boundary.coordinates);
      bndTa.value = 'Saved: MultiPolygon, '+bn+' points \u2014 paste new GeoJSON here to replace, or Clear.';
      boundaryStatus('\u2713 Boundary set ('+bn+' points).');
    } else {
      bndTa.value = '';
      boundaryStatus('');
    }
    document.getElementById('pm-form').setAttribute('data-edit-id', editId||'');
    refreshPlotOptions();
    plotCodeStaged = editing ? (editing.plotCode||null) : null;
    plotRevStaged = editing ? (editing.plotRev||null) : null;
    plotJsonStaged = '';
    document.getElementById('pm-plot').value = plotCodeStaged||'';
    document.getElementById('project-modal').classList.add('show');
  }
  function closeProjectModal(){ document.getElementById('project-modal').classList.remove('show'); }
  function saveProjectForm(ev){
    ev.preventDefault();
    var editId = document.getElementById('pm-form').getAttribute('data-edit-id');
    var name = document.getElementById('pm-name').value.trim();
    if(!name){ toast('Project name is required'); return; }
    var latRaw = document.getElementById('pm-lat').value.trim();
    var lngRaw = document.getElementById('pm-lng').value.trim();
    var lat = latRaw==='' ? null : parseFloat(latRaw);
    var lng = lngRaw==='' ? null : parseFloat(lngRaw);
    if((lat!=null && isNaN(lat)) || (lng!=null && isNaN(lng))){ toast('Latitude/longitude must be numbers'); return; }
    var colorAutoSave = document.getElementById('pm-color-auto').checked;
    var colorRaw = document.getElementById('pm-color').value;
    var kpiPayload = {}, anyKpi = false;
    ['units','population','buildings','gsa','gfa','gla'].forEach(function(k){
      var raw = document.getElementById('pm-kpi-'+k).value.trim();
      if(raw==='') return;
      var n = Number(raw);
      if(isFinite(n) && n>=0){ kpiPayload[k] = n; anyKpi = true; }
    });
    if(!anyKpi && ['units','population','buildings','gsa','gfa','gla'].some(function(k){ return document.getElementById('pm-kpi-'+k).value.trim()!==''; })){
      toast('Zone data must be numbers zero or above'); return;
    }
    var prevBnd = editId ? (function(){ var ex = state.projects.find(function(pr){return pr.id===editId;}); return ex ? ex.boundary||null : null; })() : null;
    var newBnd = prevBnd;
    if(boundaryDirty){
      var bt = document.getElementById('pm-boundary').value.trim();
      if(bt===''){ newBnd = null; }
      else if(bt.charAt(0)!=='{' && bt.charAt(0)!=='['){ toast('Site boundary is not GeoJSON \u2014 Clear it or paste a GeoJSON object'); return; }
      else {
        var br = parseBoundaryGeometry(bt);
        if(br.error){ toast('Site boundary: '+br.error); return; }
        newBnd = br.geometry;
      }
    }
    var payload = {
      name: name,
      code: document.getElementById('pm-code').value.trim(),
      client: document.getElementById('pm-client').value.trim(),
      accUrl: document.getElementById('pm-accurl').value.trim(),
      stage: document.getElementById('pm-stage').value,
      lat: (lat!=null && lng!=null) ? lat : null,
      lng: (lat!=null && lng!=null) ? lng : null,
      boundary: newBnd,
      plotCode: plotCodeStaged,
      plotRev: plotRevStaged,
      color: (!colorAutoSave && /^#[0-9a-fA-F]{6}$/.test(colorRaw)) ? colorRaw : null,
      kpi: anyKpi ? kpiPayload : null
    };
    if(editId){
      var p = state.projects.find(function(pr){return pr.id===editId;});
      Object.assign(p, payload);
      logActivity('Updated project '+p.name);
    } else {
      var id = uid('proj');
      state.projects.push(Object.assign({id:id}, payload));
      if(!state.active) state.active = id;
      logActivity('Added project '+payload.name);
    }
    persist('projects'); persist('active');
    refreshProjectPicker(); renderProjects(); renderDashboard(); renderQualityCenter();
    if(currentView==='models') renderModels();
    if(currentView==='reports') renderReports();
    if(currentView==='delivery') renderDeliverables();
    if(currentView==='stages') renderStages();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
    closeProjectModal();
    try{ gisCancelDraw(true); }catch(e){} // drop any trace preview \u2014 the shape is saved now
  }
  /* ---------------- Site boundaries (GeoJSON) ---------------- */
  // Accepts a Geometry, Feature or FeatureCollection; normalizes to MultiPolygon.
  // Never invented: invalid input is reported, never silently fixed.
  function countBoundaryPoints(coords){
    var n = 0;
    (coords||[]).forEach(function(poly){ (poly||[]).forEach(function(ring){ n += (ring||[]).length; }); });
    return n;
  }
  function parseBoundaryGeometry(text){
    var MAXPTS = 5000, MAXLEN = 200000;
    if(text.length > MAXLEN) return {error:'Boundary is '+Math.round(text.length/1024)+'KB \u2014 simplify under ~200KB first (e.g. mapshaper.org)'};
    var obj;
    try{ obj = JSON.parse(text); }catch(e){ return {error:'Not valid JSON \u2014 paste a GeoJSON object'}; }
    var geom = null;
    if(obj && obj.type==='FeatureCollection' && Array.isArray(obj.features)){
      for(var i=0;i<obj.features.length;i++){
        var g = obj.features[i] && obj.features[i].geometry;
        if(g && (g.type==='Polygon'||g.type==='MultiPolygon')){ geom = g; break; }
      }
      if(!geom) return {error:'FeatureCollection has no Polygon/MultiPolygon feature'};
    } else if(obj && obj.type==='Feature'){ geom = obj.geometry; }
    else if(obj && (obj.type==='Polygon'||obj.type==='MultiPolygon')){ geom = obj; }
    if(!geom || (geom.type!=='Polygon' && geom.type!=='MultiPolygon'))
      return {error:'Need a GeoJSON Polygon, MultiPolygon, Feature or FeatureCollection'};
    var polys = geom.type==='Polygon' ? [geom.coordinates] : geom.coordinates;
    if(!Array.isArray(polys)) return {error:'Malformed coordinates'};
    var pts = 0, bad = false;
    polys.forEach(function(poly){
      (poly||[]).forEach(function(ring){
        pts += (ring||[]).length;
        (ring||[]).forEach(function(c){
          if(!Array.isArray(c) || !isFinite(c[0]) || !isFinite(c[1]) ||
             c[0]<-180 || c[0]>180 || c[1]<-90 || c[1]>90) bad = true;
        });
      });
    });
    if(bad) return {error:'Coordinates must be [longitude, latitude] numbers in range'};
    if(pts===0) return {error:'Empty geometry'};
    if(pts > MAXPTS) return {error:pts+' points exceeds the '+MAXPTS+' cap \u2014 simplify the shape'};
    return {geometry:{type:'MultiPolygon', coordinates:polys}, points:pts};
  }
  function boundaryStatus(msg, ok){
    var el = document.getElementById('pm-boundary-status');
    if(el) el.textContent = msg || '';
  }
  function sitePlots(){ return (window.SITE_PLOTS && window.SITE_PLOTS.slice()) || []; }
  function refreshPlotOptions(){
    var sel = document.getElementById('pm-plot');
    if(!sel) return;
    var cur = sel.value || '';
    var html = '<option value="">\u2014 No plot \u2014</option>' + sitePlots().filter(function(pl){ return !!pl.kpi; }).map(function(pl){
      return '<option value="'+escapeHtml(pl.code)+'"'+(pl.code===cur?' selected':'')+'>'+
        escapeHtml(pl.code+' \u2014 '+pl.name+(pl.cluster?' \u00b7 '+pl.cluster:''))+'</option>';
    }).join('');
    sel.innerHTML = html;
  }
  function plotAssign(){
    var sel = document.getElementById('pm-plot');
    var code = sel ? sel.value : '';
    if(!code) return;
    var found = null;
    sitePlots().forEach(function(pl){ if(pl.code===code) found = pl; });
    if(!found || !found.rings){ toast('Plot not found in library'); return; }
    if(!found.kpi){ toast('No data for '+code+' \u2014 Orascom holds DP01 and DP05'); return; }
    // Stage the library shape as ordinary GeoJSON in the textarea so the
    // normal validate \u2192 save path handles it (no special-casing downstream).
    plotJsonStaged = JSON.stringify({type:'MultiPolygon', coordinates:[found.rings]});
    document.getElementById('pm-boundary').value = plotJsonStaged;
    plotCodeStaged = code; plotRevStaged = 2;
    boundaryPreview();
  }
  function boundaryPreview(){
    boundaryDirty = true;
    var t = document.getElementById('pm-boundary').value.trim();
    if(t!==plotJsonStaged){ plotCodeStaged = null; plotRevStaged = null; } // hand edit/file load breaks the library link
    if(!t){ boundaryStatus('No boundary \u2014 project shows as a point (or unmapped).'); return; }
    if(t.charAt(0)!=='{' && t.charAt(0)!=='['){ boundaryStatus('\u2715 Not GeoJSON \u2014 paste a GeoJSON object or press Clear.'); return; }
    var r = parseBoundaryGeometry(t);
    boundaryStatus(r.error ? '\u2715 '+r.error : '\u2713 MultiPolygon, '+r.points+' points \u2014 saved on Save.');
  }
  function boundaryPickFile(){ document.getElementById('pm-boundary-file').click(); }
  function boundaryFile(input){
    var f = input.files && input.files[0];
    if(!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      document.getElementById('pm-boundary').value = String(rd.result||'');
      boundaryPreview();
    };
    rd.readAsText(f);
    input.value = '';
  }
  function boundaryClear(){
    document.getElementById('pm-boundary').value = '';
    boundaryDirty = true;
    plotCodeStaged = null; plotJsonStaged = ''; plotRevStaged = null;
    boundaryStatus('Boundary removed \u2014 saved on Save.');
  }
  function deleteActiveProjectPrompt(pid){
    var p = state.projects.find(function(pr){return pr.id===pid;});
    if(!p) return;
    if(!confirm('Remove "'+p.name+'" from the Hub? This only removes it from the Hub registry \u2014 it will not touch any files.')) return;
    state.projects = state.projects.filter(function(pr){return pr.id!==pid;});
    delete state.scores[pid];
    state.deliverables = state.deliverables.filter(function(d){return d.project!==pid;});
    state.issues = state.issues.filter(function(i){return i.project!==pid;});
    state.models = state.models.filter(function(m){return m.project!==pid;});
    Object.keys(state.gates||{}).forEach(function(k){ if(k.indexOf(pid+'|')===0) delete state.gates[k]; });
    if(state.active===pid) state.active = state.projects[0] ? state.projects[0].id : null;
    persist('projects'); persist('scores'); persist('active'); persist('deliverables');
    persist('issues'); persist('models'); persist('gates');
    refreshProjectPicker(); renderProjects(); renderDashboard(); renderQualityCenter();
    if(currentView==='models') renderModels();
    if(currentView==='reports') renderReports();
    if(currentView==='delivery') renderDeliverables();
    if(currentView==='stages') renderStages();
    if(currentView==='gis') renderGis();
    if(currentView==='program') renderProgram();
  }

  /* ---------------- Stage gates ---------------- */
  // Design-stage sign-off matrix per package. Statuses are recorded by hand
  // (click a cell to advance it) \u2014 never inferred, never faked.
  var GATE_STAGES = ['Concept','Schematic','Detailed Design','IFC Issue','As-built'];
  var GATE_ORDER = ['', 'In Progress', 'Submitted', 'Approved'];
  function gateKey(pid, pkg, stage){ return pid+'|'+pkg+'|'+stage; }
  function gateBadge(st){
    if(st==='Approved') return '<span class="badge badge-ok">Approved</span>';
    if(st==='Submitted') return '<span class="badge badge-info">Submitted</span>';
    if(st==='In Progress') return '<span class="badge badge-warn">In Progress</span>';
    return '<span class="badge badge-muted">\u2014</span>';
  }
  function cycleGate(pid, pkgEnc, stageEnc){
    var pkg = decodeURIComponent(pkgEnc), stage = decodeURIComponent(stageEnc);
    var k = gateKey(pid, pkg, stage);
    var cur = state.gates[k] || '';
    state.gates[k] = GATE_ORDER[(GATE_ORDER.indexOf(cur)+1) % GATE_ORDER.length];
    if(!state.gates[k]) delete state.gates[k];
    persist('gates');
    renderStages();
  }
  function renderStages(){
    var p = activeProject();
    var host = document.getElementById('stages-content');
    if(!host) return;
    if(!p){
      host.innerHTML = emptyState('\uD83D\uDEA6','No project selected',
        'Select a project to track its design-stage sign-offs.',
        '<button class="btn btn-primary" onclick="OHub.openProjectModal()">+ Add project</button>');
      return;
    }
    var pkgs = Array.from(new Set(projectModels(p.id).map(function(m){ return ((m.package||'').trim()||'General'); }))).sort();
    if(!pkgs.length) pkgs = ['General'];
    var total = 0, approved = 0;
    var rows = pkgs.map(function(pkg){
      var cells = GATE_STAGES.map(function(st){
        var s = state.gates[gateKey(p.id, pkg, st)] || '';
        total++; if(s==='Approved') approved++;
        return '<td style="text-align:center;cursor:pointer;" onclick="OHub.cycleGate(\''+p.id+'\',\''+encodeURIComponent(pkg)+'\',\''+encodeURIComponent(st)+'\')" title="Click to advance">'+gateBadge(s)+'</td>';
      }).join('');
      var pkgAppr = GATE_STAGES.filter(function(st){ return state.gates[gateKey(p.id, pkg, st)]==='Approved'; }).length;
      return '<tr><td><strong>'+escapeHtml(pkg)+'</strong><br><span style="font-size:.74rem;color:var(--muted);">'+pkgAppr+'/'+GATE_STAGES.length+' approved</span></td>'+cells+'</tr>';
    }).join('');
    var pct = total ? Math.round(approved/total*100) : 0;
    host.innerHTML =
      '<div class="card" style="margin-bottom:14px;"><div class="card-head"><h3>Stage gates \u2014 '+escapeHtml(p.name)+'</h3>'+
      '<span class="hint">'+approved+'/'+total+' approved ('+pct+'%)</span></div>'+
      '<p style="font-size:.82rem;color:var(--muted);margin-bottom:10px;">Click any cell to advance its gate: \u2014 \u2192 In Progress \u2192 Submitted \u2192 Approved. Recorded by hand per package; nothing here is inferred from scores.</p>'+
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Package</th>'+
      GATE_STAGES.map(function(s){ return '<th style="text-align:center;">'+s+'</th>'; }).join('')+
      '</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
  }

  /* ---------------- Program overview (per-package cards) ---------------- */
  // MODON-Overall-inspired: one card per package with models, open issues
  // and gate progress. Click a card to open Models pre-filtered. Only
  // recorded data is shown — packages without data show honest zeroes.
  function programOpenPackage(pkgEnc){
    var pkg = decodeURIComponent(pkgEnc);
    var sel = document.getElementById('models-pkg-filter');
    if(sel){
      var has = false;
      for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===pkg) has = true; }
      if(!has && pkg){ var o = document.createElement('option'); o.value = pkg; o.textContent = pkg; sel.appendChild(o); }
      sel.value = pkg||'';
    }
    switchView('models');
  }
  function renderProgram(){
    var p = activeProject();
    var host = document.getElementById('program-content');
    if(!host) return;
    if(!p){
      host.innerHTML = emptyState('🗂','No project selected','Select a project to see its program overview.');
      return;
    }
    var models = projectModels(p.id);
    var pkgs = Array.from(new Set(models.map(function(m){ return ((m.package||'').trim()||'General'); }))).sort();
    if(!pkgs.length){
      host.innerHTML = emptyState('🗂','No packages yet',
        'Add models with a package set (Models tab) and they will appear here as program cards.',
        '<button class="btn btn-primary" onclick="OHub.switchView(\'models\')">Open Models</button>');
      return;
    }
    var openIss = state.issues.filter(function(i){ return i.project===p.id && (i.status==='Open'||i.status==='In Progress'); });
    var totAppr = 0, totGates = 0;
    var cards = pkgs.map(function(pkg){
      var pm = models.filter(function(m){ return ((m.package||'').trim()||'General')===pkg; });
      var names = {};
      pm.forEach(function(m){ names[m.name] = 1; });
      var iss = openIss.filter(function(i){ return i.model && names[i.model]; }).length;
      var ga = GATE_STAGES.filter(function(st){ return state.gates[gateKey(p.id, pkg, st)]==='Approved'; }).length;
      totAppr += ga; totGates += GATE_STAGES.length;
      var pct = Math.round(ga/GATE_STAGES.length*100);
      return '<div class="card" style="cursor:pointer;" onclick="OHub.programOpenPackage(\''+encodeURIComponent(pkg)+'\')">'+
        '<div class="card-head"><h3>'+escapeHtml(pkg)+'</h3>'+
        (iss>0 ? '<span class="badge badge-fail">'+iss+' open</span>' : '<span class="badge badge-ok">clear</span>')+'</div>'+
        '<div style="display:flex;gap:16px;font-size:.82rem;color:var(--muted);margin-bottom:10px;">'+
          '<span><strong style="font-size:1.2rem;color:var(--ink);">'+pm.length+'</strong> models</span>'+
          '<span><strong style="font-size:1.2rem;color:var(--ink);">'+ga+'/'+GATE_STAGES.length+'</strong> gates</span></div>'+
        '<div style="height:6px;background:var(--light);border-radius:3px;overflow:hidden;">'+
          '<span style="display:block;height:100%;width:'+pct+'%;background:var(--b2);"></span></div>'+
        '<div style="font-size:.74rem;color:var(--muted);margin-top:6px;">'+pct+'% gates approved · click for models</div>'+
      '</div>';
    }).join('');
    var totPct = totGates ? Math.round(totAppr/totGates*100) : 0;
    host.innerHTML =
      '<div class="grid kpi-grid" style="margin-bottom:14px;">'+
        '<div class="card kpi-card"><div class="kpi-label">Packages</div><div class="kpi-value">'+pkgs.length+'</div></div>'+
        '<div class="card kpi-card"><div class="kpi-label">Models</div><div class="kpi-value">'+models.length+'</div></div>'+
        '<div class="card kpi-card"><div class="kpi-label">Open issues</div><div class="kpi-value">'+openIss.length+'</div></div>'+
        '<div class="card kpi-card"><div class="kpi-label">Gates approved</div><div class="kpi-value">'+totPct+'%</div></div>'+
      '</div>'+
      '<div class="grid grid-3">'+cards+'</div>';
  }

  /* ---------------- Models registry ---------------- */
  function projectModels(pid){
    return state.models.filter(function(m){ return m.project===pid; });
  }
  function renderModels(){
    var p = activeProject();
    var host = document.getElementById('models-grid');
    if(!p){
      host.innerHTML = emptyState('\uD83E\uDDE9','No project selected',
        'Select a project to see its models, or seed the demo project.',
        '<button class="btn btn-primary" onclick="OHub.openProjectModal()">+ Add project</button> '+
        '<button class="btn btn-outline" onclick="OHub.seedDemo()">Load Demo SA39</button>');
      renderModelRunbar(null);
      return;
    }
    var rows = projectModels(p.id);
    var pkgs = Array.from(new Set(rows.map(function(m){ return (m.package||'').trim(); }).filter(Boolean))).sort();
    var pkgSel = document.getElementById('models-pkg-filter');
    if(pkgSel){
      var cur = pkgSel.value || '';
      pkgSel.innerHTML = '<option value="">All packages</option>'+pkgs.map(function(g){
        return '<option value="'+escapeHtml(g)+'"'+(g===cur?' selected':'')+'>'+escapeHtml(g)+'</option>';
      }).join('');
      if(cur && pkgs.indexOf(cur)===-1) cur = '';
      rows = rows.filter(function(m){ return !cur || (m.package||'')===cur; });
    }
    if(rows.length===0){
      host.innerHTML = emptyState('\uD83E\uDDE9','No models tracked',
        'Register the Revit models that belong to '+p.name+' so issues and scores can be tied to a model.',
        '<button class="btn btn-primary" onclick="OHub.openModelModal()">+ Add model</button> '+
        '<button class="btn btn-outline" onclick="OHub.switchView(\'datacenter\')">Import from ACC &#8594;</button>');
      renderModelRunbar(p);
      return;
    }
    host.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px;">Run</th><th>Model</th><th>Code</th><th>Package</th><th>Discipline</th><th>Rev</th><th>Status</th><th>Owner</th><th>Open issues</th><th></th></tr></thead><tbody>'+
      rows.map(function(m){
        var open = state.issues.filter(function(i){ return i.project===p.id && i.model===m.name && (i.status==='Open'||i.status==='In Progress'); }).length;
        return '<tr>'+
          (m.filePath ? '<td><input type="checkbox" data-msel="'+m.id+'" onchange="OHub.modelToggleSel(this)" '+(m.sel?'checked':'')+' style="accent-color:var(--g1);"></td>' : (m.accRef ? '<td title="Cloud model \u2014 validated via the pyRevit lane (selected_models.json)">\u2601</td>' : '<td></td>'))+
          '<td><strong>'+escapeHtml(m.name)+'</strong></td>'+
          '<td>'+escapeHtml(m.code||'\u2014')+'</td>'+
          '<td>'+escapeHtml(m.package||'\u2014')+'</td>'+
          '<td>'+escapeHtml(m.discipline||'\u2014')+'</td>'+
          '<td>'+escapeHtml(m.revision||'\u2014')+'</td>'+
          '<td>'+escapeHtml(m.status||'\u2014')+'</td>'+
          '<td>'+escapeHtml(m.owner||'\u2014')+'</td>'+
          '<td>'+open+'</td>'+
          '<td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="OHub.openModelModal(\''+m.id+'\')">Edit</button> '+
          '<button class="btn btn-ghost btn-sm" onclick="OHub.deleteModel(\''+m.id+'\')">Remove</button></td>'+
        '</tr>';
      }).join('')+'</tbody></table></div>';
    renderModelRunbar(p);
  }
  function openModelModal(editId){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var editing = editId ? state.models.find(function(m){return m.id===editId;}) : null;
    document.getElementById('mm-title').textContent = (editing ? 'Edit model' : 'Add model') + ' \u2014 ' + p.name;
    document.getElementById('mm-name').value = editing ? editing.name : '';
    document.getElementById('mm-code').value = editing ? (editing.code||'') : '';
    document.getElementById('mm-package').value = editing ? (editing.package||'') : '';
    document.getElementById('mm-discipline').value = editing ? (editing.discipline||'AR') : 'AR';
    document.getElementById('mm-revision').value = editing ? (editing.revision||'') : '';
    document.getElementById('mm-status').value = editing ? (editing.status||'WIP') : 'WIP';
    document.getElementById('mm-owner').value = editing ? (editing.owner||'') : '';
    document.getElementById('mm-path').value = editing && editing.filePath ? editing.filePath : '';
    document.getElementById('mm-form').setAttribute('data-edit-id', editId||'');
    document.getElementById('model-modal').classList.add('show');
  }
  function closeModelModal(){ document.getElementById('model-modal').classList.remove('show'); }
  function saveModelForm(ev){
    ev.preventDefault();
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var name = document.getElementById('mm-name').value.trim();
    if(!name){ toast('Model name is required'); return; }
    var editId = document.getElementById('mm-form').getAttribute('data-edit-id');
    var payload = {
      name: name,
      code: document.getElementById('mm-code').value.trim(),
      package: document.getElementById('mm-package').value.trim(),
      discipline: document.getElementById('mm-discipline').value,
      revision: document.getElementById('mm-revision').value.trim(),
      status: document.getElementById('mm-status').value,
      owner: document.getElementById('mm-owner').value.trim(),
      filePath: document.getElementById('mm-path').value.trim().replace(/\\/g,'/').replace(/^\//,''),
      updated: Date.now()
    };
    if(editId){
      var m = state.models.find(function(x){return x.id===editId;});
      if(m) Object.assign(m, payload);
      logActivity('Updated model '+name);
    } else {
      state.models.push(Object.assign({id:uid('mod'), project:p.id}, payload));
      logActivity('Added model '+name+' to '+p.name);
    }
    persist('models');
    closeModelModal();
    renderModels(); renderDashboard();
  }
  function deleteModel(id){
    var m = state.models.find(function(x){return x.id===id;});
    if(!m) return;
    if(!confirm('Remove model "'+m.name+'"? Linked issues keep the model name as text.')) return;
    state.models = state.models.filter(function(x){return x.id!==id;});
    persist('models');
    logActivity('Removed model '+m.name);
    renderModels(); renderDashboard();
  }

  /* ---------------- Validation selection (Models tab) ---------------- */
  function modelToggleSel(box){
    var m = state.models.find(function(x){ return x.id===box.getAttribute('data-msel'); });
    if(m) m.sel = !!box.checked;
    persist('models');
    renderModelRunbar(activeProject());
  }
  function modelSelAll(on){
    var p = activeProject();
    if(!p) return;
    projectModels(p.id).forEach(function(m){ if(m.filePath) m.sel = !!on; else m.sel = false; });
    persist('models');
    renderModels();
  }
  function renderModelRunbar(p){
    var host = document.getElementById('models-runbar');
    if(!host) return;
    var total = p ? projectModels(p.id).length : 0;
    var n = p ? projectModels(p.id).filter(function(m){ return m.sel; }).length : 0;
    if(!total){ host.style.display='none'; host.innerHTML=''; return; }
    host.style.display='';
    host.innerHTML =
      '<div class="card-head" style="padding:0 0 8px;margin-bottom:8px;"><h3 style="font-size:.95rem;">Choose what to validate</h3>'+
        '<span class="hint" id="models-sel-count">'+n+' of '+total+' selected</span></div>'+
      '<p style="font-size:.8rem;color:var(--muted);margin-bottom:10px;">Tick the <b>Run</b> checkbox on models to include them in the next validation batch, then download the selection and save it as <code>hub_selection.txt</code> beside <code>run_rbp_nightly.bat</code> &#8212; the nightly job then runs Revit Batch Processor on exactly those models.</p>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'+
        '<button class="btn btn-outline btn-sm" onclick="OHub.modelSelAll(true)">All</button>'+
        '<button class="btn btn-ghost btn-sm" onclick="OHub.modelSelAll(false)">None</button>'+
        '<button class="btn btn-outline btn-sm" onclick="OHub.modelDownloadSelection()">Download selection</button>'+
        '<button class="btn btn-outline btn-sm" onclick="OHub.runCheckSelection()" title="Push the selection to the local runner and verify every path resolves \u2014 no Revit involved">Check selection</button>'+
        '<button class="btn btn-primary btn-sm" onclick="OHub.runValidationNow()" title="Push the selection and launch run_rbp_nightly.bat on this machine">\u25B6 Run validation now</button>'+
        '<span class="hint">'+ (n ? n+' model'+((n===1)?'':'s')+' ready for validation' : 'no models selected yet') +'</span>'+
      '</div>'+
      '<div id="models-run-status"></div>';
    probeRunnerState();
  }
  function buildSelectionText(p){
    var sel = projectModels(p.id).filter(function(m){ return m.sel; });
    if(!sel.length) return {error:'Tick at least one model\u2019s Run box first', sel:[]};
    var missing = sel.filter(function(m){ return !(m.filePath && m.filePath.trim()); });
    if(missing.length) return {error:missing.length+' selected model(s) have no file path \u2014 edit them to add the Connector path', sel:sel};
    return {sel:sel, text:
      '# Orascom Hub model selection \u2014 ' + p.name + '\n' +
      '# Paths relative to the Desktop Connector Project Files root. Save as hub_selection.txt\n' +
      '# beside run_rbp_nightly.bat so the nightly validates only these models.\n' +
      sel.map(function(m){ return m.filePath.trim(); }).join('\n') + '\n'};
  }
  function modelDownloadSelection(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var b = buildSelectionText(p);
    if(b.error){ toast(b.error); return; }
    var blob = new Blob([b.text], {type:'text/plain'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hub_selection.txt';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast('Saved '+b.sel.length+' model(s) \u2014 save next to run_rbp_nightly.bat');
  }

  /* ---------------- Local runner (serve_exports.py) ---------------- */
  var runPollTimer = null;
  function runnerPost(path, payload, timeoutMs){
    var cfg = syncConfig();
    if(!cfg.url) return Promise.reject(new Error('Set the export server URL in Settings first'));
    var ctrl = (typeof AbortController!=='undefined') ? new AbortController() : null;
    var timer = null;
    if(ctrl){ timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs||15000); }
    return fetch(cfg.url+path, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload||{}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(res){
      if(timer) clearTimeout(timer);
      return res.json().then(function(j){
        if(!res.ok) throw new Error((j&&j.error)||('HTTP '+res.status));
        return j;
      });
    }).catch(function(err){
      if(timer) clearTimeout(timer);
      if(err && err.name==='AbortError') throw new Error('Server timed out');
      throw err;
    });
  }
  function runnerGet(path, timeoutMs){
    var cfg = syncConfig();
    if(!cfg.url) return Promise.reject(new Error('Set the export server URL in Settings first'));
    return fetch(cfg.url+path).then(function(res){
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    });
  }
  function setRunStatus(html){
    var el = document.getElementById('models-run-status');
    if(el) el.innerHTML = html || '';
  }
  function stopRunPoll(){
    if(runPollTimer){ clearInterval(runPollTimer); runPollTimer = null; }
  }
  function renderRunState(st){
    if(!st){ setRunStatus(''); return; }
    if(st.running){
      var tail = (st.log_tail||[]).slice(-6).map(function(l){ return escapeHtml(l); }).join('\n');
      setRunStatus('<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg);">'+
        '<div style="font-size:.82rem;font-weight:700;">&#9203; Validation running'+(st.started_at?(' \u2014 started '+escapeHtml(st.started_at)):'')+'</div>'+
        (tail ? '<pre style="font-size:.72rem;color:var(--muted);white-space:pre-wrap;max-height:120px;overflow:auto;margin:8px 0 0;">'+tail+'</pre>' : '<div style="font-size:.78rem;color:var(--muted);margin-top:6px;">Batch starting\u2026</div>')+
        '</div>');
      return;
    }
    if(st.exit_code!=null){
      var ok = st.exit_code===0;
      var tail2 = (st.log_tail||[]).slice(-6).map(function(l){ return escapeHtml(l); }).join('\n');
      setRunStatus('<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg);">'+
        '<div style="font-size:.82rem;font-weight:700;color:'+(ok?'var(--ok,#1c7c3e)':'var(--danger,#b42318)')+';">'+(ok?'\u2714 Validation finished':'\u2718 Run exited with code '+st.exit_code)+'</div>'+
        '<div style="font-size:.78rem;color:var(--muted);margin-top:4px;">Exports land under the server root \u2014 use Data Center \u2192 Sync from export server to pull them in.</div>'+
        (tail2 ? '<pre style="font-size:.72rem;color:var(--muted);white-space:pre-wrap;max-height:120px;overflow:auto;margin:8px 0 0;">'+tail2+'</pre>' : '')+
        '</div>');
      logActivity('Local validation run '+(ok?'finished':'failed (code '+st.exit_code+')'), ok?'ok':'warn');
      return;
    }
    setRunStatus('');
  }
  function startRunPoll(){
    stopRunPoll();
    runPollTimer = setInterval(function(){
      runnerGet('/run-status').then(function(st){
        renderRunState(st);
        if(!st.running) stopRunPoll();
      }).catch(function(){ /* server went away mid-run; keep last status */ });
    }, 5000);
  }
  function runCheckSelection(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var b = buildSelectionText(p);
    if(b.error){ toast(b.error); return; }
    setRunStatus('<div style="font-size:.8rem;color:var(--muted);margin-top:10px;">Pushing selection and resolving against the Connector tree\u2026</div>');
    runnerPost('/selection', {text:b.text}).then(function(){
      return runnerPost('/check', {}, 600000);
    }).then(function(r){
      if(!r.ok){ setRunStatus('<div style="font-size:.82rem;color:var(--danger,#b42318);margin-top:10px;">Check failed: '+escapeHtml(r.error||'unknown')+'</div>'); return; }
      var missed = (r.missed||[]).map(function(m){
        return '<li style="font-family:monospace;font-size:.72rem;">'+escapeHtml(m)+'</li>';
      }).join('');
      setRunStatus('<div style="margin-top:10px;border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--bg);">'+
        '<div style="font-size:.84rem;font-weight:700;">Selection resolves to '+(r.kept==null?'?':r.kept)+' of '+(r.scanned==null?'?':r.scanned)+' model(s)</div>'+
        (missed
          ? '<div style="font-size:.78rem;color:var(--danger,#b42318);margin-top:6px;">Not found under the Connector scan root \u2014 fix the file path on the model, or re-sync the folder in Desktop Connector:</div><ul style="margin:6px 0 0 18px;">'+missed+'</ul>'
          : '<div style="font-size:.78rem;color:var(--ok,#1c7c3e);margin-top:4px;">Every selected model resolves \u2014 safe to run.</div>')+
        '</div>');
      logActivity('Selection check: '+(r.kept==null?'?':r.kept)+' of '+(r.scanned==null?'?':r.scanned)+' resolve');
    }).catch(function(err){
      setRunStatus('');
      toast('Runner unreachable: '+err.message+' \u2014 is serve_exports.py running? (Settings \u2192 Test connection)');
    });
  }
  function runValidationNow(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var b = buildSelectionText(p);
    if(b.error){ toast(b.error); return; }
    if(!confirm('Run Revit Batch Processor now on '+b.sel.length+' model(s)? This opens Revit in the background on this machine and can take a long while.')) return;
    setRunStatus('<div style="font-size:.8rem;color:var(--muted);margin-top:10px;">Pushing selection and starting the batch\u2026</div>');
    runnerPost('/selection', {text:b.text}).then(function(){
      return runnerPost('/run', {}, 30000);
    }).then(function(r){
      if(r.error){ setRunStatus(''); toast('Could not start run: '+r.error); return; }
      toast(r.started ? 'Validation started \u2014 progress appears here' : 'A validation run is already in flight');
      startRunPoll();
      return runnerGet('/run-status');
    }).then(function(st){ if(st) renderRunState(st); })
    .catch(function(err){
      setRunStatus('');
      toast('Runner unreachable: '+err.message+' \u2014 is serve_exports.py running? (Settings \u2192 Test connection)');
    });
  }
  function probeRunnerState(){
    runnerGet('/run-status').then(function(st){
      if(st && st.running){ renderRunState(st); startRunPoll(); }
    }).catch(function(){ /* runner offline: buttons stay, errors surface on click */ });
  }
  function guessAccDiscipline(rel){
    var segs = (rel||'').toLowerCase().split('/');
    var v = segs[0] || '';
    if(v.indexOf('arch')===0) return 'AR';
    if(v.indexOf('struct')===0) return 'ST';
    if(v.indexOf('mechanic')===0||v.indexOf('hvac')===0) return 'MEP';
    if(v.indexOf('electri')===0) return 'EL';
    if(v.indexOf('plumb')===0) return 'MEP';
    if(v.indexOf('fire')===0) return 'MEP';
    if(v.indexOf('telecom')===0||v.indexOf('data')===0) return 'EL';
    if(v.indexOf('civil')===0||v.indexOf('land')===0) return 'CIVIL';
    if(v.indexOf('interior')===0||v.indexOf('id/')===0||v==='id') return 'ID';
    return '';
  }
  function accRegisterChecked(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var sel = accEntries.filter(function(e){ return e.checked; });
    if(!sel.length){ toast('Tick at least one model in the tree first'); return; }
    var added = 0;
    sel.forEach(function(e){
      var nm = e.name.replace(/\.rvt$/i,'');
      var clash = state.models.some(function(x){ return x.project===p.id && x.name.toLowerCase()===nm.toLowerCase(); });
      if(clash) return;
      state.models.push({
        id: uid('mod'), project: p.id,
        name: nm,
        code: '',
        package: accRootName || '',
        discipline: guessAccDiscipline(e.rel) || 'AR',
        revision: '', status: 'WIP', owner: '',
        filePath: e.rel.replace(/\\/g,'/').replace(/^\//,''),
        sel: true, updated: Date.now()
      });
      added++;
    });
    if(added){
      persist('models');
      logActivity('Registered '+added+' model(s) from ACC for '+p.name);
      toast(added+' model(s) registered \u2014 select them under Models \u2192 Run validation');
    } else {
      toast('Checked models are already registered for '+p.name);
    }
    renderModels(); renderDashboard();
  }

  /* ---------------- Demo seed (project + models only, never scores) ---------------- */
  function seedDemo(){
    var existing = state.projects.find(function(pr){return pr.code==='SA39';});
    if(existing){
      setActiveProject(existing.id);
      switchView('dashboard');
      toast('Demo SA39 is already in the registry');
      return;
    }
    var id = uid('proj');
    state.projects.push({id:id, name:"SA'ADA \u2014 SA39", code:'SA39', client:'Demo client', stage:'Construction', lat:27.18, lng:33.78});
    [['Architectural Model','SA39-AR','Package 01','AR','P02','Shared'],['Structural Model','SA39-ST','Package 01','ST','P01','WIP'],['MEP Model','SA39-MEP','Package 02','MEP','P01','WIP']].forEach(function(r){
      state.models.push({id:uid('mod'), project:id, name:r[0], code:r[1], package:r[2], discipline:r[3], revision:r[4], status:r[5], owner:'BIM Team', updated:Date.now()});
    });
    state.active = id;
    persist('projects'); persist('models'); persist('active');
    logActivity('Demo project SA39 seeded (no validation scores \u2014 run the modules to record real ones)');
    refreshProjectPicker(); renderProjects(); renderModels(); renderDashboard(); renderQualityCenter();
    switchView('dashboard');
    toast('Demo SA39 loaded \u2014 run a module to record real scores');
  }

  /* ---------------- Score modal (per module) ---------------- */
  function openScoreModal(moduleId){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var mod = MODULES.find(function(m){return m.id===moduleId;});
    document.getElementById('sm-title').textContent = 'Record ' + mod.label + ' result \u2014 ' + p.name;
    var rec = (state.scores[p.id]||{})[moduleId] || {};
    document.getElementById('sm-score').value = rec.score!=null ? rec.score : '';
    document.getElementById('sm-issues').value = rec.issues!=null ? rec.issues : '';
    document.getElementById('sm-form').setAttribute('data-module', moduleId);
    document.getElementById('score-modal').classList.add('show');
  }
  function closeScoreModal(){ document.getElementById('score-modal').classList.remove('show'); }
  function saveScoreForm(ev){
    ev.preventDefault();
    var p = activeProject();
    var modId = document.getElementById('sm-form').getAttribute('data-module');
    var score = parseFloat(document.getElementById('sm-score').value);
    var issues = parseInt(document.getElementById('sm-issues').value, 10);
    if(isNaN(score) || score<0 || score>100){ toast('Enter a score between 0 and 100'); return; }
    if(!state.scores[p.id]) state.scores[p.id] = {};
    state.scores[p.id][modId] = {score:score, issues: isNaN(issues)?0:issues, updated: Date.now()};
    persist('scores');
    snapshotHistory(p.id);
    var mod = MODULES.find(function(m){return m.id===modId;});
    logActivity(mod.label+' result recorded for '+p.name+': '+score+'%', 'ok');
    closeScoreModal();
    renderDashboard(); renderQualityCenter(); renderProjects();
    toast('Saved '+mod.label+' result');
  }

  /* ---------------- Dashboard ---------------- */
  function renderDashboard(){
    var p = activeProject();
    var host = document.getElementById('dash-content');
    if(!p){
      host.innerHTML = emptyState('\uD83C\uDFE0','No project selected',
        'Select a project from the top bar, or add your first project, to see its BIM Digital Delivery health here.',
        '<button class="btn btn-primary" onclick="OHub.openProjectModal()">+ Add project</button> '+
        '<button class="btn btn-outline" onclick="OHub.seedDemo()">Load Demo SA39</button>');
      return;
    }
    var health = computeHealth(p.id);
    var sc = projectScores(p.id);

    var kpiCards = MODULES.map(function(m){
      var rec = sc[m.id];
      var val = rec ? rec.score : null;
      var t = tone(val);
      return '<div class="card kpi-card tone-'+t+'">'+
        '<div class="kpi-label">'+escapeHtml(m.label)+'</div>'+
        '<div class="kpi-value">'+(val==null?'\u2014':val+'%')+'</div>'+
        '<div class="kpi-sub">'+(rec? (rec.issues||0)+' open issue'+((rec.issues===1)?'':'s')+' \u00b7 '+(rec.auto?'auto-reported ':'updated ')+fmtDateTime(rec.updated) : 'No result recorded yet')+
          (rec && rec.mismatch ? '<br><span style="color:var(--warn);">\u26a0 module was labeled \u201c'+escapeHtml(rec.enteredName)+'\u201d</span>' : '')+
        '</div>'+
        '<div class="kpi-bar"><span style="width:'+(val||0)+'%"></span></div>'+
        '<div style="margin-top:10px;"><button class="btn btn-outline btn-sm" onclick="OHub.openScoreModal(\''+m.id+'\')">Record result</button> '+
        '<button class="btn btn-ghost btn-sm" onclick="OHub.switchView(\''+m.id+'\')">Open module \u2192</button></div>'+
      '</div>';
    }).join('');

    var openIssues = state.issues.filter(function(i){ return i.project===p.id && (i.status==='Open'||i.status==='In Progress'); });
    var upcoming = state.deliverables.filter(function(d){
      return d.project===p.id && (d.status==='Upcoming'||d.status==='In Progress'||d.status==='Delayed');
    }).sort(function(a,b){ return (a.due||'9999') < (b.due||'9999') ? -1 : 1; }).slice(0,5);

    host.innerHTML =
      '<div class="hero-health">'+
        '<div>'+
          '<div class="hh-label">BIM Delivery Health \u2014 '+escapeHtml(p.name)+'</div>'+
          '<div class="hh-value">'+(health.value==null?'\u2014':health.value+'%')+'</div>'+
          '<div class="hh-note">'+(health.have===0
              ? 'No module results recorded yet. Use \u201cRecord result\u201d on a KPI card once you\u2019ve run a validation.'
              : (health.have<health.total
                  ? 'Based on '+health.have+' of '+health.total+' modules \u2014 record the rest for a complete score.'
                  : 'Weighted across all validation modules (weights and status thresholds configurable in Settings).'))+
          '</div>'+
        '</div>'+
        '<div class="hh-ring"><span class="badge badge-'+toneBadge(tone(health.value))+'" style="font-size:.78rem;padding:6px 14px;">'+statusLabel(health.value)+'</span></div>'+
      '</div>'+
      '<div style="height:18px;"></div>'+
      '<div class="grid kpi-grid">'+kpiCards+'</div>'+
      '<div style="height:18px;"></div>'+
      trendCardHtml(p)+
      formaCardHtml(p)+
      '<div class="grid grid-3">'+
        '<div class="card" style="grid-column:span 2;">'+
          '<div class="card-head"><h3>Quick actions</h3></div>'+
          '<div class="quick-actions">'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'datacenter\')">Data Center</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'midp\')">Delivery Verification</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'naming\')">Naming Convention</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'qaqc\')">Model Quality</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'workset\')">Validate worksets</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'parameters\')">Validate parameters</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'clash\')">Review clashes</button>'+
            '<button class="btn btn-outline" onclick="OHub.switchView(\'reports\')">Generate report</button>'+
            '<button class="btn btn-gold" onclick="OHub.switchView(\'quality-center\')">View open issues ('+openIssues.length+')</button>'+
            '<button class="btn btn-outline" onclick="OHub.openAcc()">Open ACC \u2197</button>'+
          '</div>'+
        '</div>'+
        '<div class="card">'+
          '<div class="card-head"><h3>Open issues</h3><span class="hint">'+escapeHtml(p.name)+'</span></div>'+
          (openIssues.length===0
            ? '<p style="color:var(--muted);font-size:.85rem;">No open issues logged for this project.</p>'
            : '<div style="display:flex;flex-direction:column;gap:8px;">'+openIssues.slice(0,4).map(function(i){
                return '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--light);padding-bottom:6px;">'+
                  '<span style="font-size:.82rem;color:var(--ink);">'+escapeHtml(i.description||'(no description)')+'</span>'+
                  '<span class="badge badge-'+sevBadge(i.severity)+'">'+escapeHtml(i.severity)+'</span>'+
                '</div>';
              }).join('')+'</div>')+
        '</div>'+
      '</div>'+
      '<div style="height:18px;"></div>'+
      '<div class="grid grid-2">'+
        '<div class="card">'+
          '<div class="card-head"><h3>Upcoming deliverables</h3>'+(upcoming.length? '<button class="btn btn-ghost btn-sm" onclick="OHub.switchView(\'delivery\')">View all \u2192</button>':'')+'</div>'+
          (upcoming.length===0
            ? emptyState('\uD83D\uDCC5','Nothing scheduled','Add a deliverable date to see it counted down here.',
                '<button class="btn btn-outline btn-sm" onclick="OHub.openDeliverableModal()">+ Add deliverable</button>')
            : '<div style="display:flex;flex-direction:column;gap:8px;">'+upcoming.map(function(d){
                var dl = daysUntil(d.due);
                var overdue = dl!=null && dl<0 && d.status!=='Submitted';
                return '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--light);padding-bottom:6px;">'+
                  '<span style="font-size:.82rem;color:var(--ink);">'+escapeHtml(d.name)+'</span>'+
                  '<span class="badge badge-'+(overdue?'fail':delivBadgeTone(d.status))+'">'+(overdue?'Overdue':(dl==null?d.status:(dl===0?'Due today':(dl>0?dl+'d left':Math.abs(dl)+'d late'))))+'</span>'+
                '</div>';
              }).join('')+'</div>')+
        '</div>'+
        '<div class="card">'+
          '<div class="card-head"><h3>Recent validation activity</h3></div>'+
          renderActivity()+
        '</div>'+
      '</div>';
    drawTrend(p);
  }

  function renderActivity(){
    if(state.activity.length===0){
      return emptyState('\uD83D\uDD52','No activity yet','Activity appears here as you open modules and record results.');
    }
    return '<div style="display:flex;flex-direction:column;gap:9px;max-height:220px;overflow-y:auto;">'+
      state.activity.slice(0,10).map(function(a){
        return '<div style="display:flex;gap:8px;align-items:baseline;font-size:.82rem;">'+
          '<span style="color:var(--muted);font-size:.72rem;flex:0 0 96px;">'+fmtDateTime(a.ts)+'</span>'+
          '<span style="color:var(--ink);">'+escapeHtml(a.text)+'</span>'+
        '</div>';
      }).join('')+'</div>';
  }

  /* ---------------- Quality Center ---------------- */
  function sevBadge(sev){
    if(sev==='Critical') return 'fail';
    if(sev==='High') return 'warn';
    if(sev==='Medium') return 'info';
    return 'muted';
  }
  function renderQualityCenter(){
    var p = activeProject();
    var host = document.getElementById('qc-content');
    if(!p){
      host.innerHTML = emptyState('\u2705','No project selected','Select a project to see its aggregated validation scores and issue log.');
      return;
    }
    var sc = projectScores(p.id);
    var health = computeHealth(p.id);
    var rows = MODULES.map(function(m){
      var rec = sc[m.id];
      var val = rec? rec.score : null;
      return '<tr>'+
        '<td><strong>'+escapeHtml(m.label)+'</strong></td>'+
        '<td>'+(val==null?'\u2014':val+'%')+'</td>'+
        '<td>'+(rec? (rec.issues||0) : '\u2014')+'</td>'+
        '<td><span class="badge badge-'+toneBadge(tone(val))+'">'+statusLabel(val)+'</span></td>'+
        '<td>'+(rec? fmtDateTime(rec.updated)+(rec.auto?' <span class="badge badge-info" style="margin-left:4px;">auto</span>':'')+(rec.mismatch?' <span class="badge badge-warn" style="margin-left:4px;" title="Module was labeled &quot;'+escapeHtml(rec.enteredName)+'&quot;">\u26a0 name mismatch</span>':'') : '\u2014')+'</td>'+
        '<td><button class="btn btn-ghost btn-sm" onclick="OHub.openScoreModal(\''+m.id+'\')">'+(rec&&rec.auto?'Override':'Update')+'</button></td>'+
      '</tr>';
    }).join('');

    var issueRows = state.issues.filter(function(i){return i.project===p.id;});
    var issuesHtml = issueRows.length===0
      ? emptyState('\uD83D\uDCCB','No issues logged','Add an issue to track something that needs follow-up across any validation area.',
          '<button class="btn btn-primary" onclick="OHub.openIssueModal()">+ Add issue</button>')
      : '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Description</th><th>Area</th><th>Model</th><th>Severity</th><th>Status</th><th>Due</th><th>Src</th><th></th></tr></thead><tbody>'+
        issueRows.map(function(i){
          return '<tr>'+
            '<td>'+escapeHtml(i.description)+'</td>'+
            '<td>'+escapeHtml(moduleLabel(i.module))+'</td>'+
            '<td>'+escapeHtml(i.model||'\u2014')+'</td>'+
            '<td><span class="badge badge-'+sevBadge(i.severity)+'">'+escapeHtml(i.severity)+'</span></td>'+
            '<td>'+statusSelect(i.id, i.status)+'</td>'+
            '<td>'+fmtDate(i.due)+'</td>'+
            '<td><span class="badge badge-'+(i.source==='auto'?'info':'muted')+'">'+(i.source==='auto'?'auto':'manual')+'</span></td>'+
            '<td><button class="btn btn-ghost btn-sm" onclick="OHub.deleteIssue(\''+i.id+'\')">Remove</button></td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>';

    host.innerHTML =
      '<div class="card">'+
        '<div class="card-head"><h3>Validation area scores \u2014 '+escapeHtml(p.name)+'</h3>'+
        '<span class="hint">Overall: '+(health.value==null?'\u2014':health.value+'%')+'</span></div>'+
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Validation area</th><th>Score</th><th>Issues</th><th>Status</th><th>Last updated</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      '</div>'+
      '<div style="height:18px;"></div>'+
      '<div class="card">'+
        '<div class="card-head"><h3>Issue log</h3>'+(issueRows.length? '<button class="btn btn-outline btn-sm" onclick="OHub.openIssueModal()">+ Add issue</button>':'')+'</div>'+
        issuesHtml+
      '</div>';
  }
  function moduleLabel(id){
    var m = MODULES.find(function(x){return x.id===id;});
    return m? m.label : 'General';
  }
  function statusSelect(issueId, current){
    var opts = ['Open','In Progress','Resolved','Closed','Waived'];
    return '<select class="status-mini" onchange="OHub.updateIssueStatus(\''+issueId+'\', this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:.78rem;">'+
      opts.map(function(o){ return '<option value="'+o+'" '+(o===current?'selected':'')+'>'+o+'</option>'; }).join('')+
      '</select>';
  }
  function updateIssueStatus(id, status){
    var i = state.issues.find(function(x){return x.id===id;});
    if(!i) return;
    i.status = status;
    persist('issues');
    renderDashboard(); renderQualityCenter();
  }
  function deleteIssue(id){
    state.issues = state.issues.filter(function(i){return i.id!==id;});
    persist('issues');
    renderQualityCenter(); renderDashboard();
  }
  function openIssueModal(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    document.getElementById('im-project-label').textContent = p.name;
    document.getElementById('im-desc').value = '';
    document.getElementById('im-module').value = 'qaqc';
    document.getElementById('im-severity').value = 'Medium';
    document.getElementById('im-due').value = '';
    var msel = document.getElementById('im-model');
    if(msel){
      msel.innerHTML = '<option value="">\u2014 No specific model \u2014</option>'+projectModels(p.id).map(function(m){
        return '<option value="'+escapeHtml(m.name)+'">'+escapeHtml(m.name)+'</option>';
      }).join('');
    }
    var resp = document.getElementById('im-resp');
    if(resp) resp.value = '';
    document.getElementById('issue-modal').classList.add('show');
  }
  function closeIssueModal(){ document.getElementById('issue-modal').classList.remove('show'); }
  function saveIssueForm(ev){
    ev.preventDefault();
    var p = activeProject();
    var desc = document.getElementById('im-desc').value.trim();
    if(!desc){ toast('Describe the issue'); return; }
    state.issues.push({
      id: uid('iss'), project: p.id,
      module: document.getElementById('im-module').value,
      description: desc,
      severity: document.getElementById('im-severity').value,
      status: 'Open',
      due: document.getElementById('im-due').value || null,
      model: (document.getElementById('im-model')||{value:''}).value || '',
      responsible: (document.getElementById('im-resp')||{value:''}).value.trim(),
      created: Date.now(), source: 'manual'
    });
    persist('issues');
    logActivity('Issue logged for '+p.name+': '+desc);
    closeIssueModal();
    renderQualityCenter(); renderDashboard();
  }

  /* ---------------- Deliverables (Hub-native \u2014 see IMPLEMENTATION_REPORT.md) ---------------- */
  function delivBadgeTone(status){
    if(status==='Submitted') return 'ok';
    if(status==='In Progress') return 'info';
    if(status==='Delayed') return 'fail';
    if(status==='Milestone') return 'warn';
    return 'muted'; // Upcoming
  }
  function renderDeliverables(){
    var p = activeProject();
    var host = document.getElementById('deliverables-content');
    if(!p){
      host.innerHTML = emptyState('\uD83D\uDCC5','No project selected','Select a project to see and add its deliverable dates.');
      return;
    }
    var rows = state.deliverables.filter(function(d){return d.project===p.id;})
      .sort(function(a,b){ return (a.due||'9999') < (b.due||'9999') ? -1 : 1; });
    var tl = buildTimeline(p.id, rows);
    var body = rows.length===0
      ? emptyState('\uD83D\uDCC5','No deliverables tracked yet','Add planned submission dates to power the timeline and the Dashboard\u2019s upcoming-deliverables widget.',
          '<button class="btn btn-primary" onclick="OHub.openDeliverableModal()">+ Add deliverable</button>')
      : '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Deliverable</th><th>Discipline</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>'+
        rows.map(function(d){
          var dl = daysUntil(d.due);
          var overdue = dl!=null && dl<0 && d.status!=='Submitted';
          return '<tr>'+
            '<td>'+escapeHtml(d.name)+'</td>'+
            '<td>'+escapeHtml(d.discipline||'\u2014')+'</td>'+
            '<td>'+fmtDate(d.due)+(overdue?' <span class="badge badge-fail">overdue</span>':'')+'</td>'+
            '<td>'+delivStatusSelect(d.id, d.status)+'</td>'+
            '<td><button class="btn btn-ghost btn-sm" onclick="OHub.deleteDeliverable(\''+d.id+'\')">Remove</button></td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>';
    host.innerHTML =
      tl.kpiHtml + tl.timeHtml +
      '<div class="card-head" style="margin-bottom:0;"><h3>Deliverables \u2014 '+escapeHtml(p.name)+'</h3>'+
      (rows.length? '<button class="btn btn-outline btn-sm" onclick="OHub.openDeliverableModal()">+ Add deliverable</button>':'')+'</div>'+
      '<p style="font-size:.78rem;color:var(--muted);margin:6px 0 14px;">Tracked directly in the Hub \u2014 independent of MIDP.html, which doesn\u2019t currently carry planned dates. Feeds the Dashboard\u2019s \u201cUpcoming deliverables\u201d card.</p>'+
      body;
  }
  function delivStatusSelect(id, current){
    return '<select onchange="OHub.updateDeliverableStatus(\''+id+'\', this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:.78rem;">'+
      DELIV_STATUSES.map(function(o){ return '<option value="'+o+'" '+(o===current?'selected':'')+'>'+o+'</option>'; }).join('')+
      '</select>';
  }
  function updateDeliverableStatus(id, status){
    var d = state.deliverables.find(function(x){return x.id===id;});
    if(!d) return;
    d.status = status;
    persist('deliverables');
    renderDashboard();
  }
  function deleteDeliverable(id){
    state.deliverables = state.deliverables.filter(function(d){return d.id!==id;});
    persist('deliverables');
    renderDeliverables(); renderDashboard();
  }
  function openDeliverableModal(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    document.getElementById('dm-project-label').textContent = p.name;
    document.getElementById('dm-name').value = '';
    document.getElementById('dm-discipline').value = '';
    document.getElementById('dm-due').value = '';
    document.getElementById('dm-status').value = 'Upcoming';
    document.getElementById('deliverable-modal').classList.add('show');
  }
  function closeDeliverableModal(){ document.getElementById('deliverable-modal').classList.remove('show'); }
  function saveDeliverableForm(ev){
    ev.preventDefault();
    var p = activeProject();
    var name = document.getElementById('dm-name').value.trim();
    if(!name){ toast('Name the deliverable'); return; }
    state.deliverables.push({
      id: uid('del'), project: p.id, name: name,
      discipline: document.getElementById('dm-discipline').value.trim(),
      due: document.getElementById('dm-due').value || null,
      status: document.getElementById('dm-status').value,
      created: Date.now()
    });
    persist('deliverables');
    logActivity('Deliverable added for '+p.name+': '+name);
    closeDeliverableModal();
    renderDeliverables(); renderDashboard();
  }

  /* ---------------- Delivery timeline (REH-Gantt-inspired, due-date based) ---------------- */
  var DELIV_COLORS = {Submitted:'#27AE60', Delayed:'#E03535', 'In Progress':'#4A5FBB', Milestone:'#E67E22', Upcoming:'#8E9BB3'};
  function delivTime(due){
    if(!due) return null;
    var t = new Date(due+'T00:00:00');
    if(isNaN(t)) t = new Date(due);
    return isNaN(t) ? null : t.getTime();
  }
  function buildTimeline(pid, rows){
    var today = new Date(); today.setHours(0,0,0,0);
    var tToday = today.getTime();
    var total = rows.length;
    var submitted = rows.filter(function(d){return d.status==='Submitted';}).length;
    var delayed = rows.filter(function(d){return d.status==='Delayed';}).length;
    var overdue = rows.filter(function(d){
      var t = delivTime(d.due);
      return t!=null && t<tToday && d.status!=='Submitted';
    }).length;
    var ontrack = rows.filter(function(d){
      var t = delivTime(d.due);
      return (d.status==='Upcoming'||d.status==='In Progress') && !(t!=null && t<tToday);
    }).length;
    function mini(label, val, sub){
      return '<div class="card kpi-card"><div class="kpi-label">'+label+'</div>'+
        '<div class="kpi-value">'+val+'</div><div class="kpi-sub">'+sub+'</div></div>';
    }
    var kpiHtml = total===0 ? '' :
      '<div class="grid kpi-grid" style="margin-bottom:18px;">'+
        mini('Tracked', total, 'deliverables')+
        mini('On track', ontrack, 'upcoming / in progress')+
        mini('Delayed', delayed+overdue, delayed+' marked + '+overdue+' overdue')+
        mini('Submitted', submitted, total? Math.round(submitted/total*100)+'% done' : '\u2014')+
      '</div>';
    var dated = rows.map(function(d){ return {d:d, t:delivTime(d.due)}; }).filter(function(x){ return x.t!=null; })
      .sort(function(a,b){ return a.t-b.t; });
    var unscheduled = rows.length - dated.length;
    if(!dated.length){
      return {kpiHtml:kpiHtml, timeHtml: total===0 ? '' :
        '<div class="card" style="margin-bottom:18px;"><div class="card-head"><h3>Timeline</h3></div>'+
        '<p style="font-size:.82rem;color:var(--muted);">No dated deliverables yet \u2014 add due dates (YYYY-MM-DD) to see them on the timeline.</p></div>'};
    }
    var min = dated[0].t, max = dated[dated.length-1].t;
    if(max===min) max = min + 86400000;
    var pad = (max-min)*0.05 || 86400000;
    min -= pad; max += pad;
    function pct(t){ return Math.max(0, Math.min(100, (t-min)/(max-min)*100)); }
    function fmtT(t){ return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
    var cap = 60;
    var lanes = dated.slice(0,cap).map(function(x){
      var d = x.d, col = DELIV_COLORS[d.status]||'#8E9BB3';
      var late = x.t<tToday && d.status!=='Submitted';
      return '<div class="g-lane"><div class="g-name" title="'+escapeHtml(d.name)+'">'+escapeHtml(d.name)+'</div>'+
        '<div class="g-track">'+
          (tToday>=min && tToday<=max ? '<div class="g-today" style="left:'+pct(tToday).toFixed(2)+'%" title="Today"></div>' : '')+
          '<div class="g-dot" style="left:'+pct(x.t).toFixed(2)+'%;background:'+col+';'+(late?'box-shadow:0 0 0 3px rgba(224,53,53,.35);':'')+'" title="'+escapeHtml(d.name+' \u00b7 '+d.status+' \u00b7 '+(d.due||''))+'"></div>'+
        '</div>'+
        '<div class="g-due">'+escapeHtml(d.due||'')+'</div></div>';
    }).join('');
    var timeHtml =
      '<div class="card" style="margin-bottom:18px;">'+
        '<div class="card-head"><h3>Timeline</h3><span class="hint">due dates \u00b7 red ring = overdue</span></div>'+
        '<div class="g-tl"><div class="g-axis"><span style="left:0%">'+fmtT(min)+'</span>'+
        '<span style="left:50%">'+fmtT((min+max)/2)+'</span><span style="left:100%">'+fmtT(max)+'</span></div>'+
        lanes+'</div>'+
        ((dated.length>cap || unscheduled>0) ? '<p style="font-size:.76rem;color:var(--muted);margin-top:8px;">'+
          (dated.length>cap ? 'Showing earliest '+cap+' of '+dated.length+' dated. ' : '')+
          (unscheduled>0 ? unscheduled+' unscheduled (no valid due date).' : '')+'</p>' : '')+
      '</div>';
    return {kpiHtml:kpiHtml, timeHtml:timeHtml};
  }

  /* ---------------- Data Center (import once, push to modules) ---------------- */
  // Files are staged in this tab's memory only (never uploaded anywhere) and
  // handed to module iframes via postMessage (File survives structured clone).
  // Each module queues them in its NATIVE import flow \u2014 nothing auto-runs.
  var dcFiles = []; // {id, file, name, size, key, kind, options:[[value,label]], sent:{}}
  var DC_TARGETS = {
    html: [['naming','Naming Convention'],['qaqc','Model Quality']],
    csv: [['naming','Naming Convention'],['workset','Workset Validator'],['parameters','Parameter Validator']],
    json: [['naming','Naming Convention']],
    xlsx: [['midp-acc','Delivery \u2014 ACC log'],['midp-list','Delivery \u2014 MIDP'],['clash','Clash Analysis']]
  };
  function dcKindOf(name){
    var ext = ((name.split('.').pop())||'').toLowerCase();
    if(ext==='html'||ext==='htm') return {key:'html', label:'Model-Checker HTML'};
    if(ext==='csv'||ext==='txt') return {key:'csv', label:'CSV schedule'};
    if(ext==='json') return {key:'json', label:'JSON schedule'};
    if(ext==='xlsx'||ext==='xls'||ext==='xlsm') return {key:'xlsx', label:'Excel workbook'};
    return {key:'', label:'Unsupported'};
  }
  function dcTargetLabel(val){
    var map = {'midp-acc':'Delivery \u2014 ACC log','midp-list':'Delivery \u2014 MIDP','naming':'Naming Convention','qaqc':'Model Quality','workset':'Workset Validator','parameters':'Parameter Validator','clash':'Clash Analysis','forma-file':'Forma snapshot'};
    return map[val]||val;
  }
  function dcFmtSize(b){
    if(b==null) return '\u2014';
    if(b<1024) return b+' B';
    if(b<1048576) return (b/1024).toFixed(1)+' KB';
    return (b/1048576).toFixed(1)+' MB';
  }
  function dcAddFiles(list){
    var arr = Array.prototype.slice.call(list||[]);
    var added = 0;
    arr.forEach(function(f){
      if(!f || !f.name) return;
      var k = dcKindOf(f.name);
      if(!k.key){ toast('Skipped unsupported file: '+f.name); return; }
      var dup = dcFiles.some(function(x){ return x.name===f.name && x.size===f.size; });
      if(dup){ toast('Already staged: '+f.name); return; }
      var rec = {id:uid('dc'), file:f, name:f.name, size:f.size, key:k.key, kind:k.label, options:DC_TARGETS[k.key], sent:{}};
      dcFiles.push(rec);
      added++;
      if(k.key==='html' && f.size && f.size<100*1048576 && typeof f.slice==='function'){
        (function(r){
          try{
            f.slice(0, 65536).text().then(function(head){
              if(head && head.indexOf('mainTable')>-1 && head.indexOf('testSummaryTable')>-1){
                r.key = 'clashhtml'; r.kind = 'Navisworks clash HTML';
                r.options = [['clash','Clash Analysis']];
                renderDataCenter();
              }
            }).catch(function(){});
          }catch(e){}
        })(rec);
      }
      if((k.key==='csv') && f.size && f.size<20*1048576 && typeof f.slice==='function'){
        (function(r){
          try{
            f.slice(0, 8192).text().then(function(head){
              var h = String(head||'').toLowerCase();
              if(h.indexOf('forma')>-1 || (h.indexOf('proposal')>-1 && (h.indexOf('gross floor area')>-1 || h.indexOf('site area')>-1 || h.indexOf('gfa')>-1))){
                r.key = 'formacsv'; r.kind = 'Forma metrics CSV';
                r.options = [['forma-file','Forma snapshot']];
                renderDataCenter();
              }
            }).catch(function(){});
          }catch(e){}
        })(rec);
      }
    });
    if(added) logActivity('Data Center staged '+added+' file(s)');
    renderDataCenter();
  }
  /* ---------------- ACC browser (synced Connector tree, no API/admin) ---------------- */
  // The browser never reveals real disk paths, so the Hub works with paths
  // RELATIVE to the picked folder. Download hub_selection.txt, save it next to
  // run_rbp_nightly.bat, and gen_file_list --select resolves it against
  // SCAN_ROOT. Checks persist per root in localStorage; the folder handle
  // persists in IndexedDB for one-click Rescan.
  var accEntries = [];   // [{rel, name, size, mtime, checked}]
  var accRootName = '';
  var accFSMode = false; // true when entries came from showDirectoryPicker
  function accSelKey(){ return 'ohub_acc_sel'; }
  function accLoadSel(){
    try{
      var s = JSON.parse(localStorage.getItem(accSelKey())||'null');
      if(s && s.root !== undefined && s.selected) return s;
    }catch(e){}
    return {root:'', selected:[]};
  }
  function accSaveSel(){
    try{
      localStorage.setItem(accSelKey(), JSON.stringify({root:accRootName,
        selected:accEntries.filter(function(e){return e.checked;}).map(function(e){return e.rel;})}));
    }catch(e){}
  }
  function accApplySel(){
    var s = accLoadSel();
    var keep = (s.root === accRootName) ? s.selected : [];
    accEntries.forEach(function(e){ e.checked = keep.indexOf(e.rel) > -1; });
  }
  function accDb(){
    return new Promise(function(resolve, reject){
      if(!window.indexedDB){ reject(new Error('no-indexeddb')); return; }
      var rq = window.indexedDB.open('ohub_acc', 1);
      rq.onupgradeneeded = function(){ rq.result.createObjectStore('handles'); };
      rq.onsuccess = function(){ resolve(rq.result); };
      rq.onerror = function(){ reject(rq.error); };
    });
  }
  function accStoreHandle(h){
    accDb().then(function(db){
      var tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(h, 'root');
    }).catch(function(){});
  }
  function accLoadHandle(){
    return accDb().then(function(db){
      return new Promise(function(resolve, reject){
        var rq = db.transaction('handles', 'readonly').objectStore('handles').get('root');
        rq.onsuccess = function(){ resolve(rq.result || null); };
        rq.onerror = function(){ reject(rq.error); };
      });
    });
  }
  function accIsRvt(name){ return /\.rvt$/i.test(name||''); }
  function accSkip(name){
    var low = String(name||'').toLowerCase();
    if(low.indexOf('backup')>-1 || low.indexOf('archive')>-1 || low.indexOf('/old')>-1) return true;
    return false;
  }
  function accSetEntries(entries, rootName, fsMode){
    accEntries = entries;
    accRootName = rootName;
    accFSMode = !!fsMode;
    accApplySel();
    renderAccTree();
  }
  function accPickFolder(){
    if(window.showDirectoryPicker){
      window.showDirectoryPicker({mode:'read'}).then(function(handle){
        accStoreHandle(handle);
        accWalkFS(handle, '');
      }).catch(function(){ /* user cancelled */ });
    } else if(document.getElementById('acc-dir-input')){
      document.getElementById('acc-dir-input').click();
    } else {
      toast('This browser cannot pick folders \u2014 use Chrome or Edge');
    }
  }
  function accWalkFS(handle, prefix){
    var out = [];
    function nextOf(iter){
      try{ return iter.next(); }catch(e){ return Promise.resolve({done:true}); }
    }
    function walk(h, pre){
      var iter = null;
      try{ iter = (h && h.values) ? h.values() : null; }catch(e){ iter = null; }
      if(!iter) return Promise.resolve();
      function step(){
        return nextOf(iter).then(function(r){
          if(!r || r.done) return null;
          var v = r.value;
          var rel = pre ? (pre + '/' + v.name) : v.name;
          if(v.kind === 'file'){
            if(accIsRvt(v.name) && !accSkip(rel)){
              return v.getFile().then(function(f){
                if(f.size > 0) out.push({rel:rel, name:v.name, size:f.size, mtime:f.lastModified, checked:false});
              }).catch(function(){}).then(step);
            }
            return step();
          }
          if(v.kind === 'directory'){
            if(accSkip(rel + '/')) return step();
            return walk(v, rel).then(step);
          }
          return step();
        }, function(){ return null; });
      }
      return step();
    }
    toast('Scanning synced folder\u2026');
    walk(handle, prefix).then(function(){
      out.sort(function(a,b){ return a.rel < b.rel ? -1 : 1; });
      if(out.length > 2000) toast('Large tree: showing first 2000 models');
      accSetEntries(out.slice(0, 2000), handle.name || 'synced folder', true);
      toast(out.length ? ('Found ' + out.length + ' model(s)') : 'No .rvt files in that folder');
    }).catch(function(){ toast('Could not read that folder'); });
  }
  function accDirInput(input){
    // Fallback path (no File System Access API): webkitdirectory file list.
    var files = input.files ? Array.prototype.slice.call(input.files) : [];
    var root = '';
    var out = [];
    files.forEach(function(f){
      var rel = f.webkitRelativePath || f.name;
      var parts = rel.split('/');
      if(!root && parts.length > 1) root = parts[0];
      var short = parts.length > 1 ? parts.slice(1).join('/') : rel;
      if(!accIsRvt(f.name) || accSkip(short) || f.size === 0) return;
      out.push({rel:short, name:f.name, size:f.size, mtime:f.lastModified, checked:false});
    });
    out.sort(function(a,b){ return a.rel < b.rel ? -1 : 1; });
    input.value = '';
    if(!out.length){ toast('No .rvt files in that folder'); return; }
    accSetEntries(out.slice(0, 2000), root || 'chosen folder', false);
    toast('Found ' + out.length + ' model(s)');
  }
  function accRescan(){
    accLoadHandle().then(function(h){
      if(!h){ toast('Pick the folder first'); return; }
      var go = function(){ accWalkFS(h, ''); };
      if(h.queryPermission){
        h.queryPermission({mode:'read'}).then(function(p){
          if(p === 'granted'){ go(); return; }
          h.requestPermission({mode:'read'}).then(function(p2){ if(p2 === 'granted') go(); else toast('Permission needed to rescan'); }).catch(function(){ toast('Permission needed to rescan'); });
        }).catch(go);
      } else go();
    }).catch(function(){ toast('Pick the folder first'); });
  }
  function accTree(){
    var root = {name:'', kids:{}, files:[]};
    accEntries.forEach(function(e){
      var parts = e.rel.split('/');
      var node = root;
      for(var i=0;i<parts.length-1;i++){
        if(!node.kids[parts[i]]) node.kids[parts[i]] = {name:parts[i], kids:{}, files:[]};
        node = node.kids[parts[i]];
      }
      node.files.push(e);
    });
    return root;
  }
  function accFolderState(prefix){
    var all = [], any = false, every = true;
    accEntries.forEach(function(e){
      if(e.rel === prefix || e.rel.indexOf(prefix + '/') === 0){ all.push(e); if(e.checked) any = true; else every = false; }
    });
    return {n:all.length, any:any, every:every && all.length > 0};
  }
  function renderAccTree(){
    var host = document.getElementById('acc-tree');
    if(!host) return;
    var lbl = document.getElementById('acc-root-label');
    if(lbl) lbl.textContent = accRootName ? accRootName : 'no folder chosen';
    var rs = document.getElementById('acc-rescan');
    if(rs){
      if(accFSMode){ rs.style.display = ''; }
      else {
        accLoadHandle().then(function(h){ rs.style.display = h ? '' : 'none'; }).catch(function(){ rs.style.display = 'none'; });
      }
    }
    var cnt = document.getElementById('acc-count');
    function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    if(!accEntries.length){
      host.innerHTML = '<p style="font-size:.82rem;color:var(--muted);">Nothing browsed yet. Choose the synced project folder above \u2014 e.g. the <span style="font-family:monospace;">Project Files</span> tree with one folder per building.</p>';
      if(cnt) cnt.textContent = '';
      return;
    }
    function fsize(b){ if(b==null) return ''; if(b<1048576) return (b/1024).toFixed(0)+' KB'; return (b/1048576).toFixed(0)+' MB'; }
    function renderNode(node, prefix, depth){
      var html = '';
      Object.keys(node.kids).sort().forEach(function(k){
        var pre = prefix ? (prefix + '/' + k) : k;
        var st = accFolderState(pre);
        html += '<details' + (depth < 2 ? ' open' : '') + '><summary style="cursor:pointer;font-size:.82rem;font-weight:700;color:var(--ink);padding:5px 0;">' +
          '<input type="checkbox" data-accfolder="'+esc(pre)+'" onchange="OHub.accToggleFolder(this)" ' +
          (st.every ? 'checked' : '') + ' onclick="event.stopPropagation()" style="margin-right:7px;accent-color:var(--g1);">' +
          esc(k) + ' <span style="font-weight:400;color:var(--muted);font-size:.72rem;">(' + st.n + ')</span></summary>' +
          '<div style="margin-left:18px;border-left:1px solid var(--border);padding-left:10px;">' +
          renderNode(node.kids[k], pre, depth + 1) + '</div></details>';
      });
      node.files.sort(function(a,b){ return a.name < b.name ? -1 : 1; }).forEach(function(e){
        html += '<label style="display:flex;gap:8px;align-items:baseline;font-size:.8rem;padding:3px 0;cursor:pointer;">' +
          '<input type="checkbox" data-accfile="'+esc(e.rel)+'" onchange="OHub.accToggleFile(this)" ' +
          (e.checked ? 'checked' : '') + ' style="accent-color:var(--g1);">' +
          '<span style="flex:1;word-break:break-all;">' + esc(e.name) +
          ' <span style="color:var(--muted);font-size:.7rem;">' + esc(e.rel) + '</span></span>' +
          '<span style="color:var(--muted);font-size:.72rem;white-space:nowrap;">' + fsize(e.size) + '</span></label>';
      });
      return html;
    }
    host.innerHTML = renderNode(accTree(), '', 0);
    updateAccCount();
  }
  function updateAccCount(){
    var el = document.getElementById('acc-count');
    if(!el) return;
    var n = accEntries.filter(function(e){ return e.checked; }).length;
    el.textContent = n + ' of ' + accEntries.length + ' selected';
  }
  function accToggleFile(box){
    var rel = box.getAttribute('data-accfile');
    accEntries.forEach(function(e){ if(e.rel === rel) e.checked = !!box.checked; });
    accSaveSel(); updateAccCount();
  }
  function accToggleFolder(box){
    var pre = box.getAttribute('data-accfolder');
    accEntries.forEach(function(e){
      if(e.rel === pre || e.rel.indexOf(pre + '/') === 0) e.checked = !!box.checked;
    });
    accSaveSel(); renderAccTree();
  }
  function accSelectAll(on){
    accEntries.forEach(function(e){ e.checked = !!on; });
    accSaveSel(); renderAccTree();
  }
  function accDownload(){
    var sel = accEntries.filter(function(e){ return e.checked; });
    if(!sel.length){ toast('Tick at least one model first'); return; }
    var text = '# Orascom Hub model selection (' + accRootName + ')\n' +
      '# Save next to run_rbp_nightly.bat as hub_selection.txt\n' +
      sel.map(function(e){ return e.rel; }).join('\n') + '\n';
    var blob = new Blob([text], {type:'text/plain'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hub_selection.txt';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
    toast('Selection downloaded \u2014 save it beside the nightly .bat');
  }

  /* ---------------- ACC cloud browser (live, via local runner) ---------------- */
  // The static Hub cannot finish APS OAuth itself, so serve_exports.py acts
  // as the bridge: it owns the PKCE pair, captures the redirect, keeps the
  // token in server memory (read-only scope), and proxies DM reads.
  var accCloud = {connected:false, hubs:[], hubId:'', region:'US',
    projects:[], projectId:'', projectName:'', nodes:{}, roots:[],
    pollTimer:null};
  function accCloudApi(path, postBody){
    var cfg = syncConfig();
    if(!cfg.url) return Promise.reject(new Error('Set the export server URL in Settings first'));
    var opts = postBody
      ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(postBody)}
      : {};
    return fetch(cfg.url+path, opts).then(function(res){
      return res.json().then(function(j){
        if(!res.ok) throw new Error((j&&j.error)||('HTTP '+res.status));
        if(j && j.ok===false) throw new Error(j.error||'Request failed');
        return j;
      });
    });
  }
  function accCloudSetStatus(t){
    var el = document.getElementById('acc-cloud-status');
    if(el) el.textContent = t;
  }
  function accCloudStopPoll(){
    if(accCloud.pollTimer){ clearInterval(accCloud.pollTimer); accCloud.pollTimer = null; }
  }
  function accCloudConnect(){
    var cfg = syncConfig();
    if(!cfg.url){ toast('Start serve_exports.py and set its URL in Settings first'); return; }
    var pop = window.open('about:blank', 'ohub-acc', 'width=560,height=680');
    if(!pop){ toast('Popup blocked \u2014 allow popups for the Hub and retry'); return; }
    accCloudApi('/acc-auth-url').then(function(j){
      try{ pop.location.href = j.url; }catch(e){}
      toast('Sign in to Autodesk in the popup, then come back here');
      accCloudStopPoll();
      var tries = 0;
      accCloud.pollTimer = setInterval(function(){
        tries++;
        accCloudApi('/acc-status').then(function(st){
          if(st && st.signed_in){
            accCloudStopPoll();
            accCloud.connected = true;
            accCloudSetStatus('connected');
            toast('Connected to ACC');
            accCloudLoadHubs();
          } else if(tries > 90){
            accCloudStopPoll();
            toast('Still not signed in \u2014 complete the popup and press Connect again');
          }
        }).catch(function(){ /* runner hiccup; keep polling */ });
      }, 2000);
    }).catch(function(err){
      try{ pop.close(); }catch(e){}
      toast('ACC bridge: '+err.message);
    });
  }
  function accCloudLogout(){
    accCloudStopPoll();
    accCloudApi('/acc-logout', {}).catch(function(){}).then(function(){
      accCloud.connected = false; accCloud.hubs = []; accCloud.hubId = '';
      accCloud.projects = []; accCloud.projectId = ''; accCloud.projectName = '';
      accCloud.nodes = {}; accCloud.roots = [];
      accCloudRender();
      accCloudSetStatus('not connected');
    });
  }
  function accCloudRefresh(){
    // Called whenever Data Center renders: re-attach to an existing session.
    accCloudApi('/acc-status').then(function(st){
      var was = accCloud.connected;
      accCloud.connected = !!(st && st.signed_in);
      accCloudSetStatus(accCloud.connected ? 'connected' : 'not connected');
      if(accCloud.connected && !was && !accCloud.hubs.length) accCloudLoadHubs();
      else accCloudRender();
    }).catch(function(){ accCloudSetStatus('runner offline'); });
  }
  function accCloudLoadHubs(){
    accCloudSetStatus('loading hubs\u2026');
    accCloudApi('/acc-hubs').then(function(j){
      accCloud.hubs = j.hubs || [];
      accCloud.hubId = ''; accCloud.projects = []; accCloud.projectId = '';
      accCloud.projectName = ''; accCloud.nodes = {}; accCloud.roots = [];
      accCloudRender();
      accCloudSetStatus(accCloud.hubs.length ? 'connected \u2014 pick a hub' : 'connected \u2014 no hubs visible (check Custom Integrations + your access)');
      if(accCloud.hubs.length===1){
        accCloud.hubId = accCloud.hubs[0].id;
        accCloud.region = accCloud.hubs[0].region || 'US';
        accCloudLoadProjects();
      }
    }).catch(function(err){
      accCloudSetStatus('connected \u2014 hub list failed');
      toast('ACC: '+err.message);
    });
  }
  function accCloudHubChanged(sel){
    accCloud.hubId = sel ? sel.value : '';
    var h = accCloud.hubs.find(function(x){ return x.id===accCloud.hubId; });
    accCloud.region = (h && h.region) || 'US';
    accCloud.projects = []; accCloud.projectId = ''; accCloud.projectName = '';
    accCloud.nodes = {}; accCloud.roots = [];
    if(accCloud.hubId) accCloudLoadProjects();
    else accCloudRender();
  }
  function accCloudLoadProjects(){
    accCloudApi('/acc-projects?hub='+encodeURIComponent(accCloud.hubId)).then(function(j){
      accCloud.projects = j.projects || [];
      accCloudRender();
      if(accCloud.projects.length===1){
        accCloud.projectId = accCloud.projects[0].id;
        accCloud.projectName = accCloud.projects[0].name;
        accCloudLoadRoots();
      }
    }).catch(function(err){ toast('ACC: '+err.message); });
  }
  function accCloudProjChanged(sel){
    accCloud.projectId = sel ? sel.value : '';
    var p = accCloud.projects.find(function(x){ return x.id===accCloud.projectId; });
    accCloud.projectName = (p && p.name) || '';
    accCloud.nodes = {}; accCloud.roots = [];
    if(accCloud.projectId) accCloudLoadRoots();
    else accCloudRender();
  }
  function accCloudLoadRoots(){
    accCloudApi('/acc-folders?hub='+encodeURIComponent(accCloud.hubId)+
      '&project='+encodeURIComponent(accCloud.projectId)).then(function(j){
      accCloud.nodes = {}; accCloud.roots = [];
      (j.folders||[]).forEach(function(f){
        var k = 'f:'+f.id;
        accCloud.nodes[k] = {kind:'f', id:f.id, name:f.name, parent:'', checked:false, loaded:false, kids:[]};
        accCloud.roots.push(k);
      });
      accCloudRender();
    }).catch(function(err){ toast('ACC: '+err.message); });
  }
  function accCloudLoadKids(key){
    var n = accCloud.nodes[key];
    if(!n || n.kind!=='f' || n.loaded) return Promise.resolve();
    return accCloudApi('/acc-contents?project='+encodeURIComponent(accCloud.projectId)+
      '&folder='+encodeURIComponent(n.id)).then(function(j){
      n.loaded = true;
      n.kids = [];
      (j.folders||[]).forEach(function(f){
        var k = 'f:'+f.id;
        if(!accCloud.nodes[k]) accCloud.nodes[k] = {kind:'f', id:f.id, name:f.name, parent:key, checked:!!n.checked, loaded:false, kids:[]};
        n.kids.push(k);
      });
      (j.items||[]).forEach(function(it){
        var k = 'i:'+it.id;
        if(!accCloud.nodes[k]) accCloud.nodes[k] = {kind:'i', id:it.id, name:it.name, parent:key, checked:!!n.checked};
        if(n.kids.indexOf(k)===-1) n.kids.push(k);
      });
    });
  }
  function accCloudLoadDeep(key){
    // Recursively load a whole subtree (used by folder-check and Select All).
    return accCloudLoadKids(key).then(function(){
      var n = accCloud.nodes[key];
      var chain = Promise.resolve();
      (n ? n.kids : []).forEach(function(k){
        if(accCloud.nodes[k] && accCloud.nodes[k].kind==='f')
          chain = chain.then(function(){ return accCloudLoadDeep(k); });
      });
      return chain;
    });
  }
  function accCloudSetKids(key, on){
    var n = accCloud.nodes[key];
    if(!n) return;
    n.checked = on;
    (n.kids||[]).forEach(function(k){ accCloudSetKids(k, on); });
  }
  function accCloudCheckedItems(){
    return Object.keys(accCloud.nodes)
      .map(function(k){ return accCloud.nodes[k]; })
      .filter(function(n){ return n.kind==='i' && n.checked && /\.rvt$/i.test(n.name||''); });
  }
  function accCloudUpdateCount(){
    var el = document.getElementById('acc-cloud-count');
    if(!el) return;
    var items = accCloudCheckedItems();
    var total = Object.keys(accCloud.nodes).filter(function(k){
      var n = accCloud.nodes[k];
      return n.kind==='i' && /\.rvt$/i.test(n.name||'');
    }).length;
    el.textContent = items.length+' of '+total+' selected';
  }
  function accCloudRender(){
    var hs = document.getElementById('acc-cloud-hub');
    if(hs){
      var cur = accCloud.hubId || '';
      hs.innerHTML = '<option value="">Pick a hub\u2026</option>'+accCloud.hubs.map(function(h){
        return '<option value="'+escapeHtml(h.id)+'"'+(h.id===cur?' selected':'')+'>'+escapeHtml(h.name)+'</option>';
      }).join('');
    }
    var ps = document.getElementById('acc-cloud-proj');
    if(ps){
      var cur2 = accCloud.projectId || '';
      ps.innerHTML = '<option value="">Pick a project\u2026</option>'+accCloud.projects.map(function(p){
        return '<option value="'+escapeHtml(p.id)+'"'+(p.id===cur2?' selected':'')+'>'+escapeHtml(p.name)+'</option>';
      }).join('');
    }
    var host = document.getElementById('acc-cloud-tree');
    if(!host) return;
    function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    if(!accCloud.connected){
      host.innerHTML = '<p style="font-size:.82rem;color:var(--muted);">Connect first \u2014 then pick a hub and project to browse live folders.</p>';
    } else if(!accCloud.projectId){
      host.innerHTML = '<p style="font-size:.82rem;color:var(--muted);">Pick a hub and project above to browse.</p>';
    } else if(!accCloud.roots.length){
      host.innerHTML = '<p style="font-size:.82rem;color:var(--muted);">No top folders visible \u2014 check the app provisioning and your project access.</p>';
    } else {
      host.innerHTML = accCloudRenderKids(accCloud.roots, 0, esc);
    }
    accCloudUpdateCount();
  }
  function accCloudRenderKids(keys, depth, esc){
    var html = '';
    keys.forEach(function(k){
      var n = accCloud.nodes[k];
      if(!n) return;
      if(n.kind==='f'){
        html += '<details'+(depth<1?' open':'')+' data-acckey="'+esc(k)+'"><summary style="cursor:pointer;font-size:.82rem;font-weight:700;color:var(--ink);padding:5px 0;">'+
          '<input type="checkbox" data-acccloudfolder="'+esc(k)+'" onchange="OHub.accCloudCheckFolder(this)" '+
          (n.checked?'checked':'')+' onclick="event.stopPropagation()" style="margin-right:7px;accent-color:var(--g1);">'+
          esc(n.name)+'</summary>'+
          '<div style="margin-left:18px;border-left:1px solid var(--border);padding-left:10px;" data-acckids="'+esc(k)+'">'+
          (n.loaded ? accCloudRenderKids(n.kids, depth+1, esc) : '<span style="font-size:.75rem;color:var(--muted);">expanding loads this folder\u2026</span>')+
          '</div></details>';
      } else {
        if(!/\.rvt$/i.test(n.name||'')) return;
        html += '<label style="display:flex;gap:8px;align-items:baseline;font-size:.8rem;padding:3px 0;cursor:pointer;">'+
          '<input type="checkbox" data-acccloudfile="'+esc(k)+'" onchange="OHub.accCloudCheckFile(this)" '+
          (n.checked?'checked':'')+' style="accent-color:var(--g1);">'+
          '<span style="flex:1;word-break:break-all;">'+esc(n.name)+'</span></label>';
      }
    });
    return html;
  }
  function accCloudRefreshKids(key){
    // Re-render one folder's children in place after lazy load.
    var all = document.querySelectorAll('[data-acckids]');
    for(var i=0;i<all.length;i++){
      if(all[i].getAttribute('data-acckids')===key){
        var n = accCloud.nodes[key];
        function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
        all[i].innerHTML = n.loaded
          ? accCloudRenderKids(n.kids, 2, esc)
          : '<span style="font-size:.75rem;color:var(--muted);">expanding loads this folder\u2026</span>';
        break;
      }
    }
    accCloudUpdateCount();
  }
  function accCloudCheckFile(box){
    var k = box.getAttribute('data-acccloudfile');
    var n = accCloud.nodes[k];
    if(n) n.checked = !!box.checked;
    accCloudUpdateCount();
  }
  function accCloudCheckFolder(box){
    var k = box.getAttribute('data-acccloudfolder');
    var on = !!box.checked;
    var n = accCloud.nodes[k];
    if(!n) return;
    if(!on){ accCloudSetKids(k, false); accCloudRender(); return; }
    toast('Loading "'+n.name+'" subtree\u2026');
    accCloudLoadDeep(k).then(function(){
      accCloudSetKids(k, true);
      accCloudRender();
    }).catch(function(err){ toast('ACC: '+err.message); accCloudRender(); });
  }
  function accCloudSelectAll(on){
    if(!accCloud.roots.length){ toast('Browse a project first'); return; }
    if(!on){
      accCloud.roots.forEach(function(k){ accCloudSetKids(k, false); });
      accCloudRender();
      return;
    }
    toast('Loading the full tree \u2014 this can take a while on big projects\u2026');
    var chain = Promise.resolve();
    accCloud.roots.forEach(function(k){
      chain = chain.then(function(){ return accCloudLoadDeep(k); });
    });
    chain.then(function(){
      accCloud.roots.forEach(function(k){ accCloudSetKids(k, true); });
      accCloudRender();
      toast('Whole project selected');
    }).catch(function(err){ toast('ACC: '+err.message); accCloudRender(); });
  }
  function accCloudPayload(){
    return accCloudCheckedItems().map(function(n){
      return {item_id:n.id, name:n.name, project_id:accCloud.projectId,
        hub_id:accCloud.hubId, region:accCloud.region||'US'};
    });
  }
  function accCloudSave(){
    var items = accCloudPayload();
    if(!items.length){ toast('Tick at least one model first'); return; }
    accCloudApi('/acc-save', {items:items}).then(function(r){
      toast('Saved '+r.n+' model(s) to selected_models.json \u2014 batch_export.py picks it up');
      logActivity('ACC cloud selection saved ('+r.n+' models)', 'ok');
    }).catch(function(err){
      // Server write failed (e.g. hub-dir not writable): fall back to download.
      var blob = new Blob([JSON.stringify(items, null, 2)], {type:'application/json'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'selected_models.json';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
      toast('Server write failed ('+err.message+') \u2014 downloaded selected_models.json instead; save it beside batch_export.py');
    });
  }
  function accCloudDiscFromName(name){
    var m = String(name||'').match(/M3-([A-Z]{2})-/i);
    return m ? m[1].toUpperCase() : '';
  }
  function accCloudRegister(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    var items = accCloudCheckedItems();
    if(!items.length){ toast('Tick at least one model first'); return; }
    var added = 0;
    items.forEach(function(n){
      var nm = n.name.replace(/\.rvt$/i, '');
      var dup = state.models.some(function(x){
        return x.project===p.id && (x.name.toLowerCase()===nm.toLowerCase() ||
          (x.accRef && x.accRef.item_id===n.id));
      });
      if(dup) return;
      state.models.push({
        id: uid('mod'), project: p.id, name: nm, code: '',
        package: accCloud.projectName || '', discipline: accCloudDiscFromName(n.name) || 'AR',
        revision: '', status: 'WIP', owner: '', filePath: '',
        accRef: {item_id:n.id, project_id:accCloud.projectId,
          hub_id:accCloud.hubId, region:accCloud.region||'US'},
        sel: false, updated: Date.now()
      });
      added++;
    });
    if(added){
      persist('models');
      logActivity('Registered '+added+' cloud model(s) for '+p.name);
      toast(added+' cloud model(s) registered \u2014 marked \u2601 on the Models tab');
    } else {
      toast('Checked models are already registered for '+p.name);
    }
    renderModels(); renderDashboard();
  }
  function dcPick(){ var i=document.getElementById('dc-file'); if(i){ i.value=''; i.click(); } }
  function dcDragOver(ev){ ev.preventDefault(); }
  function dcDrop(ev){ ev.preventDefault(); if(ev.dataTransfer && ev.dataTransfer.files) dcAddFiles(ev.dataTransfer.files); }
  function dcRemoveFile(id){ dcFiles = dcFiles.filter(function(x){return x.id!==id;}); renderDataCenter(); }
  function sendFilesToModule(modId, files, role, done, opts){
    opts = opts||{};
    var mod = MODULES.find(function(m){return m.id===modId;});
    if(!mod) return;
    if(!framesReady[modId]){
      pendingSends[modId] = (pendingSends[modId]||[]).concat([{files:files, role:role||'', done:done||null}]);
      if(!opts.noload){
        lazyLoadModule(mod);
        if(!opts.quiet) toast('Loading '+mod.label+' \u2014 files will be delivered on open');
      }
      return;
    }
    var frame = document.getElementById('frame-'+modId);
    try{
      frame.contentWindow.postMessage({source:'orascom-hub', type:'hub-files', role:role||'', files:files}, '*');
      logActivity('Sent '+files.length+' file(s) to '+mod.label, 'ok');
      toast('Sent '+files.length+' file(s) to '+mod.label);
      if(done) done();
    }catch(e){ toast('Could not reach '+mod.label+' \u2014 open it once first'); }
  }
  function flushPendingSends(modId){
    var q = pendingSends[modId]||[];
    pendingSends[modId] = [];
    q.forEach(function(s){ sendFilesToModule(modId, s.files, s.role, s.done); });
  }

  /* ---------------- export-server auto-sync (nightly exports -> modules) ---------------- */
  // Pulls every latest export for the configured model and hands each file to
  // its module(s) through the same channel as the Data Center. Modules that are
  // open receive instantly; the rest get theirs from the outbox on open.
  // Mapping modules still queue at their mapping screen; Naming/Model Quality
  // auto-run. Nothing is uploaded anywhere \u2014 this only READS your server.
  var SYNC_MAP = [
    {type:'workset',         mod:'workset',    role:''},
    {type:'parameters',      mod:'parameters', role:''},
    {type:'qaqc',            mod:'naming',     role:''},
    {type:'modelhealth-html',mod:'qaqc',       role:''},
    {type:'midp-acc',        mod:'midp',       role:'midp-acc'},
    {type:'midp-list',       mod:'midp',       role:'midp-list'},
    {type:'clash',           mod:'clash',      role:''}
  ];
  function syncTargetValue(modId, role){
    if(modId==='midp') return role==='midp-list' ? 'midp-list' : 'midp-acc';
    return modId;
  }
  function syncConfig(){
    var p = activeProject();
    return {
      url: ((state.sync&&state.sync.url)||'').trim().replace(/\/$/,''),
      model: ((state.sync&&state.sync.model)||'').trim() || (p ? (p.code||p.name) : ''),
      auto: !!(state.sync&&state.sync.auto)
    };
  }
  function saveSyncSettings(){
    var u = document.getElementById('sync-url'), m = document.getElementById('sync-model'),
        a = document.getElementById('sync-auto');
    state.sync = {
      url: u ? u.value.trim() : ((state.sync&&state.sync.url)||''),
      model: m ? m.value.trim() : ((state.sync&&state.sync.model)||''),
      auto: a ? !!a.checked : ((state.sync&&state.sync.auto)||false)
    };
    persist('sync');
  }
  function renderSyncSettings(){
    var cfg = syncConfig(), p = activeProject();
    var u = document.getElementById('sync-url'), m = document.getElementById('sync-model'),
        a = document.getElementById('sync-auto');
    if(u && document.activeElement!==u) u.value = (state.sync&&state.sync.url)||'http://localhost:8787';
    if(m){ if(document.activeElement!==m) m.value = (state.sync&&state.sync.model)||''; m.placeholder = 'defaults to active project ('+((p&&(p.code||p.name))||'none selected')+')'; }
    if(a) a.checked = !!(state.sync&&state.sync.auto);
    var st = document.getElementById('sync-status');
    if(st && !st.getAttribute('data-lock')) st.textContent = '';
  }
  function testSyncServer(){
    var cfg = syncConfig();
    var st = document.getElementById('sync-status');
    if(!cfg.url){ toast('Set the export server URL first'); return; }
    if(st){ st.setAttribute('data-lock','1'); st.textContent = 'Contacting server\u2026'; }
    fetch(cfg.url+'/models').then(function(res){
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }).then(function(j){
      var n = (j&&j.models) ? j.models.length : 0;
      if(st){ st.textContent = 'Server OK \u2014 '+n+' model folder(s): '+((j.models||[]).slice(0,6).join(', ')||'none yet'); }
      toast('Export server reachable');
    }).catch(function(err){
      if(st) st.textContent = 'Unreachable: '+err.message+' \u2014 is serve_exports.py running?';
      toast('Server unreachable: '+err.message);
    }).then(function(){ if(st) st.removeAttribute('data-lock'); });
  }
  function syncFromServer(manual){
    var cfg = syncConfig();
    if(!cfg.url){ if(manual) toast('Set the export server URL in Settings first'); return; }
    if(!cfg.model){ if(manual) toast('Set the model folder name (or pick an active project)'); return; }
    var got = 0, sent = 0, missing = 0;
    var chain = Promise.resolve();
    SYNC_MAP.forEach(function(entry){
      chain = chain.then(function(){
        return fetch(cfg.url+'/latest?model='+encodeURIComponent(cfg.model)+'&type='+entry.type).then(function(res){
          if(res.status===404){ missing++; return null; }
          if(!res.ok) throw new Error(entry.type+': HTTP '+res.status);
          var fname = res.headers.get('X-Export-Filename') || (entry.type+'-export');
          return res.blob().then(function(blob){ return {blob:blob, fname:fname}; });
        }).then(function(r){
          if(!r) return;
          got++;
          var file = new File([r.blob], r.fname, {type:r.blob.type||''});
          // stage in Data Center registry with provenance
          var k = dcKindOf(r.fname);
          var val = syncTargetValue(entry.mod, entry.role);
          var dup = dcFiles.find(function(x){ return x.name===file.name && x.size===file.size; });
          var rec = dup || {id:uid('dc'), file:file, name:file.name, size:file.size,
            key:(k.key||'csv'), kind:(k.key?k.label:'Server export'),
            options:(k.key&&DC_TARGETS[k.key])?DC_TARGETS[k.key]:[[val, dcTargetLabel(val)]], sent:{}};
          if(!dup) dcFiles.push(rec);
          sendFilesToModule(entry.mod, [file], entry.role, function(){
            rec.sent[val] = Date.now(); sent++;
            renderDataCenter();
          }, {noload:true, quiet:true});
        }).catch(function(err){
          if(manual) toast('Sync note ('+entry.type+'): '+err.message);
        });
      });
    });
    chain.then(function(){
      renderDataCenter();
      var msg = 'Sync done: '+got+' file(s) staged'+(sent?(', '+sent+' delivered so far'):'')+(missing?(', '+missing+' type(s) have no export yet'):'')+'. Open a module to run what\u2019s queued.';
      logActivity('Auto-sync for '+cfg.model+': '+got+' staged, '+sent+' delivered', got?'ok':'info');
      if(manual) toast(msg);
      if(currentView==='datacenter') renderDataCenter();
      ingestRollups({quiet:!manual});
    });
  }

  /* ---------------- nightly rollup ingest (full automation) ---------------- */
  // After a scheduled run_rbp_nightly.bat + rollup_scores.py, hubscores JSONs
  // sit under the export root. This pulls the newest batch, matches each
  // rollup to the project that owns the model, pools multi-model scores the
  // way a module fed concatenated inputs would, and records them through
  // applyModuleScore -- the same path interactive module runs use.
  // Ledger (state.rollups pid|mod -> batch) stops re-applying the same
  // batch on every load; hand-entered scores are never touched.
  var ROLLUP_MODS = ['workset','parameters','naming','qaqc'];
  function normRollupName(s){ return String(s||'').replace(/\s*\(\d+\)\s*$/,'').trim().toLowerCase(); }
  function findRollupProject(modelName, exportDir){
    var want = {};
    [modelName, exportDir].forEach(function(s){
      var n = normRollupName(s);
      if(n) want[n] = true;
    });
    var hits = [];
    state.models.forEach(function(m){
      var ok = !!want[normRollupName(m.name)];
      if(!ok && m.filePath){
        var b = String(m.filePath).split('/').pop().replace(/\.rvt$/i,'');
        ok = !!want[normRollupName(b)];
      }
      if(ok) hits.push(m.project);
    });
    if(!hits.length) return null;
    if(hits.indexOf(state.active)>-1)
      return state.projects.find(function(p){return p.id===state.active;}) || null;
    return state.projects.find(function(p){return p.id===hits[0];}) || null;
  }
  function poolRollupScores(mod, docs){
    var findings = [];
    docs.forEach(function(d){
      ((d.scores[mod]||{}).findings||[]).forEach(function(f){
        if(findings.length<20)
          findings.push({desc:f.desc, severity:f.severity||'Medium',
            model:(d.model||d.export_dir||'')});
      });
    });
    var i, s;
    if(mod==='workset'){
      var v=0, t=0, iss=0;
      for(i=0;i<docs.length;i++){ s=docs[i].scores.workset; v+=s.valid||0; t+=s.total||0; iss+=s.issues||0; }
      return {score: t ? Math.round(v/t*1000)/10 : 0, issues: iss, findings: findings};
    }
    if(mod==='parameters'){
      var f=0, a=0, iss2=0;
      for(i=0;i<docs.length;i++){ s=docs[i].scores.parameters; f+=s.filled||0; a+=s.applicable||0; iss2+=s.issues||0; }
      return {score: a ? (f/a*100) : 100, issues: iss2, findings: findings};
    }
    if(mod==='naming'){
      var p=0, t2=0, iss3=0;
      for(i=0;i<docs.length;i++){ s=docs[i].scores.naming; p+=s.pass||0; t2+=s.total||0; iss3+=s.issues||0; }
      return {score: t2 ? Math.round(p/t2*100) : 0, issues: iss3, findings: findings};
    }
    var sum=0, n=0, iss4=0;
    for(i=0;i<docs.length;i++){ s=docs[i].scores.qaqc; sum+=Number(s.pass_rate!=null?s.pass_rate:s.score)||0; n++; iss4+=s.issues||0; }
    return {score: n ? Math.round(sum/n) : 0, issues: iss4, findings: findings};
  }
  function ingestRollups(opts){
    opts = opts||{};
    var cfg = syncConfig();
    if(!cfg.url){
      if(!opts.quiet) toast('Set the export server URL in Settings first');
      return Promise.resolve({applied:0});
    }
    return fetch(cfg.url+'/hubscores').then(function(res){
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }).then(function(j){
      var list = (j&&j.rollups)||[];
      if(!list.length) return {applied:0, total:0};
      var maxBatch = list.reduce(function(m,e){ return (e.batch&&e.batch>m)?e.batch:m; }, '');
      var fresh = maxBatch ? list.filter(function(e){ return e.batch===maxBatch; }) : list;
      return Promise.all(fresh.map(function(e){
        return fetch(cfg.url+'/'+encodeURIComponent(e.model)+'/'+encodeURIComponent(e.file)).then(function(r){
          if(!r.ok) throw new Error(e.file+': HTTP '+r.status);
          return r.json();
        }).catch(function(){ return null; });
      })).then(function(docs){
        docs = docs.filter(Boolean);
        var byPid = {};
        docs.forEach(function(d){
          var p = findRollupProject(d.model||'', d.export_dir||'');
          if(!p) return;
          (byPid[p.id] = byPid[p.id]||[]).push(d);
        });
        var applied = 0;
        Object.keys(byPid).forEach(function(pid){
          var group = byPid[pid];
          var batch = group.reduce(function(m,d){ return (d.batch&&d.batch>m)?d.batch:m; }, maxBatch||'');
          ROLLUP_MODS.forEach(function(mod){
            var have = group.filter(function(d){ return d.scores&&d.scores[mod]; });
            if(!have.length) return;
            var key = pid+'|'+mod;
            if(state.rollups[key]===batch) return;
            var pooled = poolRollupScores(mod, have);
            var proj = state.projects.find(function(p){return p.id===pid;});
            if(applyModuleScore(pid, mod, pooled.score, pooled.issues, pooled.findings, proj?proj.name:'', batch)){
              state.rollups[key] = batch;
              applied++;
            }
          });
        });
        if(applied){
          persist('rollups');
          logActivity('Applied '+applied+' nightly score(s)'+(maxBatch?' (batch '+maxBatch+')':''), 'ok');
          if(!opts.quiet) toast('Applied '+applied+' nightly score(s)');
        }
        return {applied:applied, total:docs.length};
      });
    }).catch(function(err){
      if(!opts.quiet) toast('Rollup ingest: '+err.message);
      return {applied:0, error:String((err&&err.message)||err)};
    });
  }
  function parseFormaCsv(text){
    function splitRow(line, delim){
      var out=[], cur='', q=false;
      for(var i=0;i<line.length;i++){
        var ch=line[i];
        if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"';i++;} else q=!q; }
        else if(ch===delim&&!q){ out.push(cur); cur=''; }
        else cur+=ch;
      }
      out.push(cur);
      return out.map(function(c){return c.trim();});
    }
    var lines = String(text||'').split(/\r\n|\n|\r/).filter(function(l){return l.trim();}).slice(0,60);
    if(!lines.length) return [];
    var delim = (lines[0].indexOf(';')>-1 && lines[0].indexOf(',')===-1) ? ';' : ',';
    var rows = lines.map(function(l){return splitRow(l, delim);})
      .filter(function(r){return r.length>=2 && (r[0]||r[1]);});
    if(rows.length>1 && /^(metric|parameter|name|key|indicator|item)s?$/i.test(rows[0][0])) rows.shift();
    return rows.slice(0,20).map(function(r){
      return {k:(r[0]||'(row)').slice(0,60), v:r.slice(1).join(' | ').slice(0,80)};
    }).filter(function(f){return f.v;});
  }
  function dcSaveFormaSnapshot(id){
    var rec = dcFiles.find(function(x){return x.id===id;});
    if(!rec) return;
    var ap = getActiveProject();
    if(!ap){ toast('Select a project first'); return; }
    if(!window.OForma || !window.OForma.saveFileSnapshot){ toast('Hub connector missing'); return; }
    var rd = new FileReader();
    rd.onload = function(){
      try{
        var figs = parseFormaCsv(rd.result);
        if(!figs.length){ toast('No readable figures in '+rec.name); return; }
        window.OForma.saveFileSnapshot(ap.id, rec.name, figs);
        rec.sent['forma-file'] = Date.now();
        renderDataCenter(); renderDashboard();
        toast('Forma snapshot saved to '+ap.name+' ('+figs.length+' figures)');
      }catch(e){ toast('Could not read '+rec.name); }
    };
    try{ rd.readAsText(rec.file); }catch(e){ toast('Could not read '+rec.name); }
  }
  function dcSendFile(id){
    var rec = dcFiles.find(function(x){return x.id===id;});
    if(!rec) return;
    var sel = document.getElementById('dc-target-'+id);
    var val = sel ? sel.value : rec.options[0][0];
    if(val==='forma-file'){ dcSaveFormaSnapshot(id); return; }
    var modId = val, role = '';
    if(val==='midp-acc'){ modId='midp'; role='midp-acc'; }
    if(val==='midp-list'){ modId='midp'; role='midp-list'; }
    switchView(modId);
    sendFilesToModule(modId, [rec.file], role, function(){ rec.sent[val]=Date.now(); renderDataCenter(); });
  }
  function dcSendAllHtml(){
    var htmls = dcFiles.filter(function(x){ return x.key==='html'; });
    if(!htmls.length){ toast('No HTML reports staged'); return; }
    var files = htmls.map(function(x){return x.file;});
    sendFilesToModule('naming', files.slice(), '', function(){
      htmls.forEach(function(x){ x.sent['naming']=Date.now(); });
      renderDataCenter();
      sendFilesToModule('qaqc', files.slice(), '', function(){
        htmls.forEach(function(x){ x.sent['qaqc']=Date.now(); });
        renderDataCenter();
      });
    });
  }
  function dcSendAllCsv(){
    var csvs = dcFiles.filter(function(x){ return x.key==='csv'; });
    if(!csvs.length){ toast('No CSV schedules staged'); return; }
    var files = csvs.map(function(x){return x.file;});
    sendFilesToModule('workset', files.slice(), '', function(){
      csvs.forEach(function(x){ x.sent['workset']=Date.now(); });
      renderDataCenter();
      sendFilesToModule('parameters', files.slice(), '', function(){
        csvs.forEach(function(x){ x.sent['parameters']=Date.now(); });
        renderDataCenter();
      });
    });
    switchView('workset');
  }
  /* ---------------- MODON export import (deliverables only) ---------------- */
  // Reads the F12-console modon-export.json. Auth keys (token/user/email)
  // are never touched. MODON stages (50%CD…) have no 1:1 Hub gate, so only
  // the deliverable baseline crosses: name keeps DP + stage for context.
  var modonStaged = null;
  var MODON_STATUS = {Approved:'Submitted', Submitted:'Submitted', 'In Progress':'In Progress', Delayed:'Delayed', 'Not Started':'Upcoming'};
  function modonToDeliverable(row){
    var name = String((row && row.deliverable) || '').trim();
    if(!name) return null;
    var dp = String(row.designPackage || '').trim();
    var stage = String(row.stage || '').trim();
    var due = null;
    var pf = String(row.plannedFinish || '');
    var m = /^(\d{4}-\d{2}-\d{2})/.exec(pf);
    if(m) due = m[1];
    return {
      name: name + (dp || stage ? ' — ' + [dp, stage].filter(Boolean).join(' ') : ''),
      discipline: String(row.ldc || '').trim(),
      due: due,
      status: MODON_STATUS[row.status] || 'Upcoming'
    };
  }
  function modonStatus(msg){ var el = document.getElementById('modon-status'); if(el) el.textContent = msg||''; }
  function dcModonPick(){ var i = document.getElementById('modon-file'); if(i){ i.value=''; i.click(); } }
  function dcModonFile(input){
    var f = input.files && input.files[0];
    if(!f) return;
    modonStatus('Reading…');
    var rd = new FileReader();
    rd.onload = function(){
      try{
        var obj = JSON.parse(String(rd.result||''));
        var rows = obj && obj.modon_gantt_schedule_data;
        if(!Array.isArray(rows)) throw new Error('no schedule in file');
        modonStaged = rows;
        var byStatus = {};
        rows.forEach(function(r){ var s = String(r.status||'?'); byStatus[s] = (byStatus[s]||0)+1; });
        document.getElementById('modon-preview').innerHTML =
          'Staged <strong>'+rows.length+'</strong> deliverables '+
          '('+Object.keys(byStatus).map(function(s){ return escapeHtml(s)+': '+byStatus[s]; }).join(' · ')+'). '+
          'Import copies them into the active project; duplicates are skipped.';
        modonStatus('Ready to import.');
      }catch(e){ modonStaged = null; modonStatus('Not a MODON export file.'); }
    };
    rd.readAsText(f);
    input.value = '';
  }
  function dcModonImport(){
    var p = activeProject();
    if(!p){ toast('Select a project first'); return; }
    if(!modonStaged){ toast('Choose a modon-export.json file first'); return; }
    var added = 0, skipped = 0;
    modonStaged.forEach(function(row){
      var d = modonToDeliverable(row);
      if(!d) return;
      var dup = state.deliverables.some(function(x){
        return x.project===p.id && x.name===d.name && (x.due||null)===d.due;
      });
      if(dup){ skipped++; return; }
      state.deliverables.push({id:uid('del'), project:p.id, name:d.name,
        discipline:d.discipline, due:d.due, status:d.status, created:Date.now()});
      added++;
    });
    persist('deliverables');
    logActivity('MODON import: '+added+' deliverable(s) into '+p.name+(skipped?' ('+skipped+' duplicates skipped)':''));
    if(currentView==='delivery') renderDeliverables();
    renderDashboard();
    modonStatus('Imported '+added+(skipped?' · '+skipped+' duplicates skipped':'')+'.');
    toast('Imported '+added+' deliverable(s)');
  }
  function renderDataCenter(){
    var host = document.getElementById('dc-registry');
    if(!host) return;
    if(!dcFiles.length){
      host.innerHTML = emptyState('\uD83D\uDCE5','No files staged',
        'Drop Model Checker HTML reports, CSV/JSON schedules or Excel workbooks above. Files stay in this browser tab\u2019s memory only \u2014 send them to a module, or re-drop after reload.',
        '');
      return;
    }
    host.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Send to</th><th></th><th>Status</th></tr></thead><tbody>'+
      dcFiles.map(function(r){
        var sent = Object.keys(r.sent).map(dcTargetLabel).join(', ');
        return '<tr><td><strong>'+escapeHtml(r.name)+'</strong></td>'+
          '<td>'+escapeHtml(r.kind)+'</td><td>'+dcFmtSize(r.size)+'</td>'+
          '<td><select id="dc-target-'+r.id+'" style="border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:.78rem;background:var(--white);color:var(--text);max-width:220px;">'+
            r.options.map(function(o){ return '<option value="'+o[0]+'">'+o[1]+'</option>'; }).join('')+'</select></td>'+
          '<td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="OHub.dcSendFile(\''+r.id+'\')">Send</button></td>'+
          '<td>'+(sent ? '<span class="badge badge-info">\u2713 '+escapeHtml(sent)+'</span>' : '<span class="badge badge-muted">staged</span>')+
          ' <button class="btn btn-ghost btn-sm" onclick="OHub.dcRemoveFile(\''+r.id+'\')">Remove</button></td></tr>';
      }).join('')+'</tbody></table></div>';
  }

  /* ---------------- score history (trend + portfolio) ---------------- */
  function snapshotHistory(pid){
    var sc = projectScores(pid);
    var health = computeHealth(pid);
    var entry = {ts:Date.now(), health:health.value, scores:{}};
    MODULES.forEach(function(m){
      var r = sc[m.id];
      entry.scores[m.id] = (r && typeof r.score==='number') ? r.score : null;
    });
    if(!state.history[pid]) state.history[pid] = [];
    state.history[pid].push(entry);
    if(state.history[pid].length>120) state.history[pid] = state.history[pid].slice(-120);
    persist('history');
  }
  var trendChart = null, compareChart = null;
  var TREND_COLORS = {midp:'#2563B8', naming:'#7FB3F0', qaqc:'#27AE60', workset:'#E67E22', parameters:'#4A5FBB', clash:'#8E9BB3'};
  function trendCardHtml(p){
    var h = state.history[p.id]||[];
    if(h.length<2){
      return '<div class="card" style="margin-bottom:18px;"><div class="card-head"><h3>Health trend</h3></div>'+
        '<p style="font-size:.83rem;color:var(--muted);">Record results more than once (run modules or enter results manually) to see health move over time.</p></div>';
    }
    return '<div class="card" style="margin-bottom:18px;"><div class="card-head"><h3>Health trend</h3><span class="hint">'+h.length+' snapshots</span></div>'+
      '<div style="position:relative;height:240px;"><canvas id="health-trend"></canvas></div></div>';
  }
  function drawTrend(p){
    var h = state.history[p.id]||[];
    if(h.length<2 || typeof Chart==='undefined') return;
    var el = document.getElementById('health-trend');
    if(!el) return;
    try{ if(trendChart) trendChart.destroy(); }catch(e){}
    var dark = !!state.dark;
    var tick = dark ? '#E7EDF7' : '#5D7494';
    var grid = dark ? '#233252' : '#D0DAE8';
    function fmtT(ts){ var d=new Date(ts); return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); }
    var ds = [{label:'Overall', data:h.map(function(s){return s.health;}), borderColor:'#F5A623', backgroundColor:'#F5A623', borderWidth:2.5, tension:.25, spanGaps:true}];
    MODULES.forEach(function(m){
      ds.push({label:m.label, data:h.map(function(s){ return (s.scores && s.scores[m.id]!=null) ? s.scores[m.id] : null; }),
        borderColor:TREND_COLORS[m.id]||'#8E9BB3', borderWidth:1.5, tension:.25, spanGaps:true});
    });
    try{
      trendChart = new Chart(el, {type:'line',
        data:{labels:h.map(function(s){return fmtT(s.ts);}), datasets:ds},
        options:{responsive:true, maintainAspectRatio:false,
          plugins:{legend:{position:'bottom', labels:{color:tick, boxWidth:12}}},
          scales:{y:{min:0, max:100, ticks:{color:tick}, grid:{color:grid}},
                  x:{ticks:{color:tick, maxTicksLimit:8}, grid:{display:false}}}}});
    }catch(e){}
  }

  /* ---------------- Autodesk Forma link (free, read-only) ---------------- */
  function getActiveProject(){
    var p = activeProject();
    return p ? {id:p.id, name:p.name, code:p.code} : null;
  }
  function renderFormaSettings(){
    if(!window.OForma) return;
    var c = window.OForma.cfg();
    var ci = document.getElementById('forma-client'), rg = document.getElementById('forma-region'),
        st = document.getElementById('forma-status');
    if(ci && document.activeElement!==ci) ci.value = c.clientId||'';
    if(rg) rg.value = c.region||'EMEA';
    if(st){
      if(!window.OForma.secureCtx()) st.textContent = 'Serve over HTTP for login (file:// cannot do OAuth).';
      else if(!c.clientId) st.textContent = 'Paste a Client ID to enable Connect.';
      else st.textContent = 'Ready \u2014 Connect opens Autodesk login.';
    }
  }
  function formaCardHtml(p){
    if(!window.OForma) return '';
    var L = null;
    try{ L = (window.OForma.links()||{})[p.id] || null; }catch(e){}
    var body = '';
    if(!window.OForma.isConfigured()){
      body = '<p style="font-size:.83rem;color:var(--muted);">Link a Forma project to see its live key figures beside your QA scores. Free setup, one Client ID.</p>'+
        '<button class="btn btn-outline btn-sm" onclick="OHub.switchView(\'settings\')">Set up in Settings</button>';
    } else if(!L){
      body = '<p style="font-size:.83rem;color:var(--muted);margin-bottom:8px;">Paste the Forma Project ID (last part of the Forma project URL) to link it to '+escapeHtml(p.name)+'.</p>'+
        '<div style="display:flex;gap:8px;flex-wrap:wrap;"><input type="text" id="forma-id-input" placeholder="Forma project ID" style="flex:1;min-width:180px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--white);color:var(--text);">'+
        '<button class="btn btn-primary btn-sm" onclick="OHub.formaLinkActive()">Link + fetch</button></div>';
    } else {
      var figs = (L.figures||[]).map(function(f){
        return '<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--light);padding:5px 0;font-size:.82rem;">'+
          '<span style="color:var(--muted);">'+escapeHtml(f.k)+'</span><strong>'+escapeHtml(f.v)+'</strong></div>';
      }).join('');
      body = '<div style="font-size:.85rem;margin-bottom:6px;"><strong>'+escapeHtml(L.name||(L.formaId||L.fileName||''))+'</strong> '+
        '<span class="badge badge-'+(L.source==='file'?'muted':'info')+'" style="font-size:.68rem;">'+(L.source==='file'?'file import':'live link')+'</span> '+
        '<span style="color:var(--muted);font-size:.74rem;">'+(L.updated?('synced '+fmtDateTime(L.updated)):'never synced')+'</span></div>'+
        (figs || '<p style="font-size:.8rem;color:var(--muted);">No figures returned.</p>')+
        '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">'+
        (L.source==='file'
          ? '<span style="font-size:.74rem;color:var(--muted);">Re-import the file in Data Center to update.</span>'
          : '<button class="btn btn-outline btn-sm" onclick="OHub.formaRefreshActive()">Refresh</button>')+
        '<button class="btn btn-ghost btn-sm" onclick="OHub.formaUnlinkActive()">Unlink</button></div>';
    }
    return '<div class="card" style="margin-bottom:18px;"><div class="card-head"><h3>Autodesk Forma</h3><span class="hint">live link</span></div>'+body+'</div>';
  }
  function formaLinkActive(){
    if(!window.OForma) return;
    var input = document.getElementById('forma-id-input');
    var fid = input ? input.value.trim() : '';
    if(!fid){ toast('Paste the Forma Project ID first'); return; }
    var ap = getActiveProject();
    if(!ap) return;
    window.OForma.linkProject(ap.id, fid);
    formaRefreshActive();
  }
  function formaRefreshActive(){
    if(!window.OForma) return;
    var ap = getActiveProject();
    if(!ap) return;
    window.OForma.refreshLink(ap.id).then(function(L){
      if(!L) toast('Login needed or fetch failed \u2014 check Settings');
      renderDashboard();
    }).catch(function(){ toast('Forma fetch failed \u2014 reconnect in Settings'); renderDashboard(); });
  }
  function formaUnlinkActive(){
    if(!window.OForma) return;
    var ap = getActiveProject();
    if(!ap) return;
    window.OForma.unlinkProject(ap.id);
    renderDashboard();
  }
  function renderReports(){
    var p = activeProject();
    var host = document.getElementById('reports-content');
    var reportDefs = [
      {label:'Delivery Verification report', view:'midp', note:'MIDP deliverable tracking, As-Built validation and file-exchange audit, exported from the Delivery Verification module.'},
      {label:'Naming Compliance report', view:'naming', note:'OCC naming-convention compliance across views, sheets, families and worksets, exported from the Naming Convention Checker.'},
      {label:'Model Quality report', view:'qaqc', note:'Model quality checks, discipline breakdown and trends, exported from the Model Quality module.'},
      {label:'Workset compliance report', view:'workset', note:'Workset naming and assignment compliance, exported from the Workset Validator.'},
      {label:'Parameter compliance report', view:'parameters', note:'LOIN parameter completeness, exported from the Parameter Validator.'},
      {label:'Clash report', view:'clash', note:'Open vs. resolved clashes, priority breakdown and export, from the Clash Analysis module.'}
    ];
    var cards = reportDefs.map(function(r){
      return '<div class="card">'+
        '<div class="card-head"><h3>'+r.label+'</h3></div>'+
        '<p style="font-size:.83rem;color:var(--muted);margin-bottom:14px;">'+r.note+'</p>'+
        '<button class="btn btn-outline" onclick="OHub.switchView(\''+r.view+'\')">Open '+r.label.replace(' report','')+' \u2192</button>'+
      '</div>';
    }).join('');
    host.innerHTML =
      '<div class="card" style="margin-bottom:18px;">'+
        '<div class="card-head"><h3>Executive export'+(p?(' \u2014 '+escapeHtml(p.name)):'')+'</h3></div>'+
        '<p style="font-size:.83rem;color:var(--muted);margin-bottom:14px;">One-click Hub summary across all validation areas, models, issues and deliverables. Module-native exports below remain untouched.</p>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px;">'+
          '<button class="btn btn-primary" onclick="OHub.exportHubExcel()">Hub Excel</button>'+
          '<button class="btn btn-outline" onclick="OHub.exportHubPdf()">Executive PDF</button>'+
        '</div>'+
        reportHistoryHtml()+
      '</div>'+
      '<div class="card" style="margin-bottom:18px;">'+
        '<div class="card-head"><h3>BIM Delivery Health summary'+(p?(' \u2014 '+escapeHtml(p.name)):'')+'</h3></div>'+
        (p ? qcSummaryTable(p) : '<p style="color:var(--muted);font-size:.85rem;">Select a project to see its summary.</p>')+
      '</div>'+
      '<p style="font-size:.78rem;color:var(--muted);margin-bottom:10px;">Each module keeps its own native Excel / CSV / PDF / HTML export \u2014 nothing was removed. Open a module below to generate that report exactly as before; this page just gives you one place to find them.</p>'+
      '<div class="grid grid-2">'+cards+'</div>';
  }
  function qcSummaryTable(p){
    var sc = projectScores(p.id);
    var health = computeHealth(p.id);
    var rows = MODULES.map(function(m){
      var rec = sc[m.id];
      var val = rec? rec.score : null;
      return '<tr><td>'+m.label+'</td><td>'+(val==null?'\u2014':val+'%')+'</td><td>'+(rec?(rec.issues||0):'\u2014')+'</td><td><span class="badge badge-'+toneBadge(tone(val))+'">'+statusLabel(val)+'</span></td></tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Validation area</th><th>Score</th><th>Issues</th><th>Status</th></tr></thead><tbody>'+rows+
      '<tr style="font-weight:700;"><td>Overall BIM Delivery Health</td><td colspan="2">'+(health.value==null?'\u2014':health.value+'%')+'</td><td><span class="badge badge-'+toneBadge(tone(health.value))+'">'+statusLabel(health.value)+'</span></td></tr>'+
      '</tbody></table></div>';
  }

  /* ---------------- Executive export (Hub-level summary) ---------------- */
  function stampName(){
    var d = new Date();
    function z(n){ return (n<10?'0':'')+n; }
    return d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+'-'+z(d.getHours())+z(d.getMinutes());
  }
  function logReport(kind){
    state.reports.unshift({kind:kind, ts:Date.now()});
    state.reports = state.reports.slice(0,10);
    persist('reports');
    if(currentView==='reports') renderReports();
  }
  function reportHistoryHtml(){
    if(!state.reports.length) return '<p style="font-size:.78rem;color:var(--muted);">No executive exports yet.</p>';
    return '<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;">'+state.reports.map(function(r){
      return '<div style="font-size:.78rem;color:var(--muted);">'+escapeHtml(r.kind)+' \u00b7 '+fmtDateTime(r.ts)+'</div>';
    }).join('')+'</div>';
  }
  function summaryRows(p){
    var sc = p ? projectScores(p.id) : {};
    var health = p ? computeHealth(p.id) : {value:null};
    var rows = MODULES.map(function(m){
      var rec = sc[m.id];
      return {area:m.label, score:(rec?rec.score:null), issues:(rec?(rec.issues||0):null),
              status:statusLabel(rec?rec.score:null), weight:(Number(state.weights[m.weightKey])||0)};
    });
    rows.push({area:'Overall BIM Delivery Health', score:health.value, issues:null,
               status:statusLabel(health.value), weight:null});
    return rows;
  }
  function exportHubExcel(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    if(typeof ExcelJS==='undefined'){ toast('Excel library did not load (offline?)'); return; }
    try{
      var wb = new ExcelJS.Workbook();
      wb.creator = 'Orascom BIM Hub';
      var ws = wb.addWorksheet('Hub Summary');
      ws.addRow(['Orascom BIM Delivery Hub \u2014 Executive Summary']);
      ws.addRow(['Project', p.code ? (p.code+' \u2014 '+p.name) : p.name]);
      ws.addRow(['Date', new Date().toLocaleString()]);
      ws.addRow([]);
      ws.addRow(['Validation area','Score %','Issues','Status','Weight %']);
      summaryRows(p).forEach(function(r){
        ws.addRow([r.area, r.score==null?'\u2014':r.score, r.issues==null?'\u2014':r.issues, r.status, r.weight==null?'\u2014':r.weight]);
      });
      var ms = wb.addWorksheet('Models');
      ms.addRow(['Model','Code','Discipline','Revision','Status','Owner']);
      projectModels(p.id).forEach(function(m){ ms.addRow([m.name,m.code||'',m.discipline||'',m.revision||'',m.status||'',m.owner||'']); });
      var is = wb.addWorksheet('Issues');
      is.addRow(['Description','Area','Model','Severity','Status','Source','Due']);
      state.issues.filter(function(i){return i.project===p.id;}).forEach(function(i){
        is.addRow([i.description,moduleLabel(i.module),i.model||'',i.severity,i.status,i.source||'manual',i.due||'']);
      });
      var dl = wb.addWorksheet('Deliverables');
      dl.addRow(['Deliverable','Discipline','Due','Status']);
      state.deliverables.filter(function(d){return d.project===p.id;}).forEach(function(d){
        dl.addRow([d.name,d.discipline||'',d.due||'',d.status]);
      });
      wb.xlsx.writeBuffer().then(function(buf){
        var blob = new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Orascom-Hub-'+(p.code||'Project')+'-'+stampName()+'.xlsx';
        document.body.appendChild(a); a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
        logActivity('Executive Excel exported for '+p.name, 'ok');
        logReport('Excel');
        toast('Excel exported');
      }).catch(function(err){ toast('Excel error: '+err.message); });
    }catch(err){ toast('Excel error: '+err.message); }
  }
  function exportHubPdf(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    if(!window.jspdf){ toast('PDF library did not load (offline?)'); return; }
    try{
      var doc = new window.jspdf.jsPDF();
      doc.setFontSize(16);
      doc.text('Orascom BIM Delivery Hub \u2014 Executive Summary', 14, 18);
      doc.setFontSize(10);
      doc.text('Project: '+(p.code ? (p.code+' \u2014 '+p.name) : p.name), 14, 26);
      doc.text('Date: '+new Date().toLocaleString(), 14, 32);
      doc.autoTable({startY:38, head:[['Validation area','Score','Issues','Status']],
        body: summaryRows(p).map(function(r){
          return [r.area, r.score==null?'\u2014':r.score+'%', r.issues==null?'\u2014':String(r.issues), r.status];
        })});
      var open = state.issues.filter(function(i){ return i.project===p.id && (i.status==='Open'||i.status==='In Progress'); }).slice(0,20);
      if(open.length){
        doc.autoTable({startY: doc.lastAutoTable.finalY+10, head:[['Open issue','Area','Severity']],
          body: open.map(function(i){ return [String(i.description).slice(0,90), moduleLabel(i.module), i.severity]; })});
      }
      doc.save('Orascom-Hub-'+(p.code||'Project')+'-'+stampName()+'.pdf');
      logActivity('Executive PDF exported for '+p.name, 'ok');
      logReport('PDF');
      toast('PDF exported');
    }catch(err){ toast('PDF error: '+err.message); }
  }
  function exportProjectJson(){
    var p = activeProject();
    if(!p){ toast('Select or add a project first'); return; }
    try{
      var data = {project:p, models:projectModels(p.id), scores:projectScores(p.id),
        issues:state.issues.filter(function(i){return i.project===p.id;}),
        deliverables:state.deliverables.filter(function(d){return d.project===p.id;}),
        gates:Object.keys(state.gates||{}).filter(function(k){return k.indexOf(p.id+'|')===0;}).reduce(function(o,k){o[k]=state.gates[k];return o;},{}),
        weights:state.weights, exported:new Date().toISOString()};
      var blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Orascom-Project-'+(p.code||'export')+'-'+stampName()+'.json';
      document.body.appendChild(a); a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 800);
      toast('Project JSON exported');
    }catch(err){ toast('Export failed'); }
  }

  /* ---------------- Cloud sync (Worker + KV) ---------------- */
  // Explicit Push/Pull of raw localStorage stores. Last write wins;
  // pull reloads the page so every view picks up the snapshot at once.
  var CLOUD_KEYS = ['projects','active','scores','weights','activity','issues',
    'thresholds','deliverables','models','dark','reports','history','tour',
    'sync','rollups','gates'];
  function cloudCfg(){
    return {
      url:(state.cloud.url||'').replace(/\/+$/,''),
      token:(state.cloud.token||''),
      workspace:((state.cloud.workspace||'main').trim()||'main')
    };
  }
  function cloudStatus(msg){ var el = document.getElementById('cloud-status'); if(el) el.textContent = msg||''; }
  function saveCloudSettings(){
    state.cloud.url = document.getElementById('cloud-url').value.trim();
    state.cloud.token = document.getElementById('cloud-token').value;
    state.cloud.workspace = document.getElementById('cloud-workspace').value.trim()||'main';
    persist('cloud');
    renderCloudLast();
  }
  function renderCloudLast(){
    var el = document.getElementById('cloud-last');
    if(!el) return;
    el.textContent = state.cloud.lastSync ? ('Last sync: '+new Date(state.cloud.lastSync).toLocaleString()) : 'Never synced on this browser.';
  }
  function renderCloudSettings(){
    document.getElementById('cloud-url').value = state.cloud.url||'';
    document.getElementById('cloud-token').value = state.cloud.token||'';
    document.getElementById('cloud-workspace').value = state.cloud.workspace||'main';
    renderCloudLast();
  }
  function cloudPush(){
    var c = cloudCfg();
    if(!c.url){ toast('Set the server URL first'); return; }
    if(!c.token){ toast('Paste the shared sync token first'); return; }
    cloudStatus('Pushing…');
    var snap = {};
    CLOUD_KEYS.forEach(function(k){ try{ var v = localStorage.getItem(LS[k]); if(v!=null) snap[LS[k]] = v; }catch(e){} });
    fetch(c.url+'/api/state?key='+encodeURIComponent(c.workspace), {
      method:'PUT', headers:{'Content-Type':'application/json','Authorization':'Bearer '+c.token},
      body: JSON.stringify({snapshot:snap})
    }).then(function(r){
      if(r.status===401) throw new Error('token rejected (401) — check the token');
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(j){
      if(!j.ok) throw new Error(j.error||'server refused');
      state.cloud.lastSync = Date.now(); persist('cloud'); renderCloudLast();
      cloudStatus('Pushed '+Object.keys(snap).length+' stores ('+Math.round((j.bytes||0)/1024)+' KB).');
      logActivity('Cloud push to workspace '+c.workspace, 'ok');
    }).catch(function(err){ cloudStatus('Push failed: '+err.message); });
  }
  function cloudPull(){
    var c = cloudCfg();
    if(!c.url){ toast('Set the server URL first'); return; }
    if(!c.token){ toast('Paste the shared sync token first'); return; }
    cloudStatus('Pulling…');
    fetch(c.url+'/api/state?key='+encodeURIComponent(c.workspace), {
      headers:{'Authorization':'Bearer '+c.token}
    }).then(function(r){
      if(r.status===401) throw new Error('token rejected (401) — check the token');
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(function(j){
      if(!j.ok) throw new Error(j.error||'server refused');
      if(!j.found){ cloudStatus('Workspace is empty — push from another browser first.'); return; }
      if(!confirm('Replace ALL Hub data in this browser with the cloud snapshot?')){ cloudStatus('Pull cancelled.'); return; }
      Object.keys(j.snapshot||{}).forEach(function(k){ try{ localStorage.setItem(k, j.snapshot[k]); }catch(e){} });
      state.cloud.lastSync = Date.now();
      try{ localStorage.setItem(LS.cloud, JSON.stringify(state.cloud)); }catch(e){}
      location.reload();
    }).catch(function(err){ cloudStatus('Pull failed: '+err.message); });
  }

  /* ---------------- Settings ---------------- */
  function renderSettings(){
    var w = state.weights;
    var total = MODULES.reduce(function(s,m){ return s + (Number(w[m.weightKey])||0); }, 0);
    var host = document.getElementById('settings-weights');
    host.innerHTML = MODULES.map(function(m){
      return '<div class="weight-row">'+
        '<label>'+m.label+'</label>'+
        '<input type="range" min="0" max="100" value="'+(w[m.weightKey]||0)+'" oninput="OHub.setWeight(\''+m.weightKey+'\', this.value)">'+
        '<span class="wv" id="wv-'+m.weightKey+'">'+(w[m.weightKey]||0)+'%</span>'+
      '</div>';
    }).join('') +
    '<div class="weight-total '+(Math.abs(total-100)>1?'bad':'')+'" id="weight-total">Total weighting: '+total+'%'+(Math.abs(total-100)>1?' \u2014 should sum to 100%':'')+'</div>'+
    '<div style="margin-top:12px;"><button class="btn btn-outline btn-sm" onclick="OHub.normalizeWeights()">Normalize to 100%</button> '+
    '<button class="btn btn-ghost btn-sm" onclick="OHub.resetWeights()">Reset to defaults</button></div>';

    var th = state.thresholds;
    var thHost = document.getElementById('settings-thresholds');
    thHost.innerHTML =
      '<div class="weight-row"><label>Good \u2265</label>'+
        '<input type="range" min="0" max="100" value="'+th.ok+'" oninput="OHub.setThreshold(\'ok\', this.value)">'+
        '<span class="wv" id="th-ok">'+th.ok+'%</span></div>'+
      '<div class="weight-row"><label>Attention \u2265</label>'+
        '<input type="range" min="0" max="100" value="'+th.warn+'" oninput="OHub.setThreshold(\'warn\', this.value)">'+
        '<span class="wv" id="th-warn">'+th.warn+'%</span></div>'+
      '<div style="font-size:.78rem;color:var(--muted);margin-top:6px;">Below '+th.warn+'% is labeled Critical. '+(th.warn>=th.ok? '<span style="color:var(--fail2);font-weight:700;">Attention threshold should be lower than Good.</span>':'')+'</div>';

    document.getElementById('settings-project-count').textContent = state.projects.length;
    document.getElementById('settings-issue-count').textContent = state.issues.length;
    document.getElementById('settings-deliverable-count').textContent = state.deliverables.length;
    var mc = document.getElementById('settings-model-count');
    if(mc) mc.textContent = state.models.length;
  }
  function setWeight(key, val){
    state.weights[key] = Number(val);
    persist('weights');
    document.getElementById('wv-'+key).textContent = val+'%';
    var total = MODULES.reduce(function(s,m){ return s + (Number(state.weights[m.weightKey])||0); }, 0);
    var totalEl = document.getElementById('weight-total');
    totalEl.textContent = 'Total weighting: '+total+'%'+(Math.abs(total-100)>1?' \u2014 should sum to 100%':'');
    totalEl.classList.toggle('bad', Math.abs(total-100)>1);
    renderDashboard(); renderQualityCenter();
  }
  function normalizeWeights(){
    var total = MODULES.reduce(function(s,m){ return s + (Number(state.weights[m.weightKey])||0); }, 0);
    if(total===0){ resetWeights(); return; }
    MODULES.forEach(function(m){
      state.weights[m.weightKey] = Math.round((Number(state.weights[m.weightKey])||0) / total * 100);
    });
    persist('weights');
    renderSettings(); renderDashboard(); renderQualityCenter();
    toast('Weights normalized to 100%');
  }
  function resetWeights(){
    state.weights = Object.assign({}, DEFAULT_WEIGHTS);
    persist('weights');
    renderSettings(); renderDashboard(); renderQualityCenter();
  }
  function setThreshold(key, val){
    state.thresholds[key] = Number(val);
    persist('thresholds');
    document.getElementById('th-'+key).textContent = val+'%';
    renderSettings(); renderDashboard(); renderQualityCenter(); renderProjects();
  }

  /* ---------------- Search ---------------- */
  var SEARCH_INDEX_STATIC = [
    {title:'Executive Dashboard', sub:'Home', view:'dashboard'},
    {title:'Projects', sub:'Portfolio', view:'projects'},
    {title:'Models', sub:'Portfolio', view:'models'},
    {title:'Data Center', sub:'Import once, push to modules', view:'datacenter'},
    {title:'Delivery Verification', sub:'Module', view:'midp'},
    {title:'Naming Convention', sub:'Module', view:'naming'},
    {title:'Model Quality', sub:'Module', view:'qaqc'},
    {title:'Workset Validator', sub:'Module', view:'workset'},
    {title:'Parameter Validator', sub:'Module', view:'parameters'},
    {title:'Clash Analysis', sub:'Module', view:'clash'},
    {title:'BIM Quality Center', sub:'Governance', view:'quality-center'},
    {title:'Reporting Center', sub:'Governance', view:'reports'},
    {title:'Delivery Overview', sub:'Governance', view:'delivery'},
    {title:'Settings', sub:'System', view:'settings'}
  ];
  function runSearch(q){
    q = q.trim().toLowerCase();
    var host = document.getElementById('search-results');
    if(!q){ host.classList.remove('show'); return; }
    var hits = SEARCH_INDEX_STATIC.filter(function(x){ return x.title.toLowerCase().indexOf(q)>-1; });
    state.projects.forEach(function(p){
      if((p.name||'').toLowerCase().indexOf(q)>-1 || (p.code||'').toLowerCase().indexOf(q)>-1){
        hits.push({title:p.name, sub:'Project '+(p.code||''), view:'projects', projectId:p.id});
      }
    });
    state.models.forEach(function(m){
      if((m.name||'').toLowerCase().indexOf(q)>-1){
        hits.push({title:m.name, sub:'Model \u00b7 '+((m.package?m.package+' \u00b7 ':'')+(m.discipline||'')), view:'models', projectId:m.project});
      }
    });
    state.issues.forEach(function(i){
      if((i.description||'').toLowerCase().indexOf(q)>-1){
        hits.push({title:i.description, sub:'Issue \u00b7 '+moduleLabel(i.module), view:'quality-center', projectId:i.project});
      }
    });
    state.deliverables.forEach(function(d){
      if((d.name||'').toLowerCase().indexOf(q)>-1){
        hits.push({title:d.name, sub:'Deliverable \u00b7 '+(d.status||''), view:'delivery', projectId:d.project});
      }
    });
    if(hits.length===0){
      host.innerHTML = '<div class="sr-empty">No matches in the Hub. (Search covers projects, issues, deliverables and navigation \u2014 not the internal data of an individual validator.)</div>';
    } else {
      host.innerHTML = hits.slice(0,12).map(function(h){
        return '<div class="search-hit" onclick="OHub.goToSearchHit(\''+h.view+'\',\''+(h.projectId||'')+'\')">'+
          '<span class="sh-title">'+escapeHtml(h.title)+'</span><span class="sh-sub">'+escapeHtml(h.sub)+'</span>'+
        '</div>';
      }).join('');
    }
    host.classList.add('show');
  }
  function goToSearchHit(view, projectId){
    if(projectId) setActiveProject(projectId);
    switchView(view);
    document.getElementById('global-search').value='';
    closeSearch();
  }
  function closeSearch(){ document.getElementById('search-results').classList.remove('show'); }

  /* ---------------- init ---------------- */
  function viewFromHash(){
    var h = (location.hash||'').replace(/^#\/?/, '');
    if(!h) return null;
    var known = ['dashboard','projects','models','datacenter','midp','naming','qaqc','workset','parameters','clash','quality-center','reports','delivery','settings'];
    return known.indexOf(h)>-1 ? h : null;
  }
  function init(){
    document.querySelectorAll('.nav-item[data-view]').forEach(function(item){
      item.addEventListener('click', function(){ switchView(item.getAttribute('data-view')); });
    });
    document.getElementById('project-picker-select').addEventListener('change', function(e){
      setActiveProject(e.target.value);
    });
    document.getElementById('global-search').addEventListener('input', function(e){ runSearch(e.target.value); });
    document.addEventListener('click', function(e){
      if(!e.target.closest('.search-wrap')) closeSearch();
    });
    // Lazy-load ACC cloud folders on expand (toggle doesn't bubble; capture it).
    document.addEventListener('toggle', function(e){
      var t = e.target;
      if(t && t.tagName==='DETAILS' && t.hasAttribute('data-acckey') && t.open){
        var key = t.getAttribute('data-acckey');
        var n = (typeof accCloud!=='undefined') ? accCloud.nodes[key] : null;
        if(n && !n.loaded){
          accCloudLoadKids(key).then(function(){ accCloudRefreshKids(key); })
            .catch(function(err){ toast('ACC: '+err.message); });
        }
      }
    }, true);
    document.getElementById('pm-form').addEventListener('submit', saveProjectForm);
    document.getElementById('mm-form').addEventListener('submit', saveModelForm);
    document.getElementById('sm-form').addEventListener('submit', saveScoreForm);
    document.getElementById('im-form').addEventListener('submit', saveIssueForm);
    document.getElementById('dm-form').addEventListener('submit', saveDeliverableForm);
    document.getElementById('menu-toggle').addEventListener('click', function(){
      document.querySelector('.sidebar').classList.toggle('open');
    });
    document.querySelectorAll('.view-toggle-btn').forEach(function(b){
      b.addEventListener('click', function(){ setProjectsView(b.getAttribute('data-mode')); });
    });

    refreshProjectPicker();
    window.addEventListener('hashchange', function(){
      var v = viewFromHash();
      if(v && v!==currentView) switchView(v);
    });
    var startView = viewFromHash() || 'dashboard';
    switchView(startView, {silent:true});
    try{ if(!localStorage.getItem(LS.tour)){ setTimeout(function(){ startTour(); }, 800); } }catch(e){}
    try{ if(syncConfig().auto && syncConfig().url){ setTimeout(function(){ syncFromServer(false); }, 2500); } }catch(e){}
  }
  document.addEventListener('DOMContentLoaded', init);

  /* expose */
  window.OHub = {
    switchView: switchView,
    setActiveProject: setActiveProject,
    openProjectModal: openProjectModal,
    closeProjectModal: closeProjectModal,
    deleteActiveProjectPrompt: deleteActiveProjectPrompt,
    cycleGate: cycleGate,
    boundaryPreview: boundaryPreview,
    boundaryPickFile: boundaryPickFile,
    boundaryFile: boundaryFile,
    boundaryClear: boundaryClear,
    plotAssign: plotAssign,
    gisAssignPlot: gisAssignPlot,
    gisSetMode: gisSetMode,
    gisSetBase: gisSetBase,
    gisSearch: gisSearch,
    gisFocusPlot: gisFocusPlot,
    gisFocusProject: gisFocusProject,
    zoneColorSet: zoneColorSet,
    gisNewProjectFromPlot: gisNewProjectFromPlot,
    gisStartDraw: gisStartDraw,
    gisFinishDraw: gisFinishDraw,
    gisCancelDraw: gisCancelDraw,
    openModelModal: openModelModal,
    programOpenPackage: programOpenPackage,
    closeModelModal: closeModelModal,
    deleteModel: deleteModel,
    seedDemo: seedDemo,
    dcPick: dcPick,
    dcModonPick: dcModonPick,
    dcModonFile: dcModonFile,
    dcModonImport: dcModonImport,
    dcAddFiles: dcAddFiles,
    dcDrop: dcDrop,
    dcDragOver: dcDragOver,
    dcSendFile: dcSendFile,
    dcRemoveFile: dcRemoveFile,
    dcSendAllHtml: dcSendAllHtml,
    dcSendAllCsv: dcSendAllCsv,
    dcSaveFormaSnapshot: dcSaveFormaSnapshot,
    accPickFolder: accPickFolder,
    accDirInput: accDirInput,
    accRescan: accRescan,
    accToggleFile: accToggleFile,
    accToggleFolder: accToggleFolder,
    accSelectAll: accSelectAll,
    accDownload: accDownload,
    accRegisterChecked: accRegisterChecked,
    accCloudConnect: accCloudConnect,
    accCloudLogout: accCloudLogout,
    accCloudHubChanged: accCloudHubChanged,
    accCloudProjChanged: accCloudProjChanged,
    accCloudCheckFile: accCloudCheckFile,
    accCloudCheckFolder: accCloudCheckFolder,
    accCloudSelectAll: accCloudSelectAll,
    accCloudSave: accCloudSave,
    accCloudRegister: accCloudRegister,
    modelToggleSel: modelToggleSel,
    modelSelAll: modelSelAll,
    modelDownloadSelection: modelDownloadSelection,
    runCheckSelection: runCheckSelection,
    runValidationNow: runValidationNow,
    saveSyncSettings: saveSyncSettings,
    saveCloudSettings: saveCloudSettings,
    cloudPush: cloudPush,
    cloudPull: cloudPull,
    testSyncServer: testSyncServer,
    syncFromServer: syncFromServer,
    ingestRollups: ingestRollups,
    getActiveProject: getActiveProject,
    renderFormaSettings: renderFormaSettings,
    formaLinkActive: formaLinkActive,
    formaRefreshActive: formaRefreshActive,
    formaUnlinkActive: formaUnlinkActive,
    exportHubExcel: exportHubExcel,
    exportHubPdf: exportHubPdf,
    exportProjectJson: exportProjectJson,
    toggleDark: toggleDark,
    startTour: startTour,
    nextTourStep: nextTourStep,
    prevTourStep: prevTourStep,
    endTour: endTour,
    openScoreModal: openScoreModal,
    closeScoreModal: closeScoreModal,
    openIssueModal: openIssueModal,
    closeIssueModal: closeIssueModal,
    openAcc: openAcc,
    updateIssueStatus: updateIssueStatus,
    deleteIssue: deleteIssue,
    openDeliverableModal: openDeliverableModal,
    closeDeliverableModal: closeDeliverableModal,
    updateDeliverableStatus: updateDeliverableStatus,
    deleteDeliverable: deleteDeliverable,
    setWeight: setWeight,
    normalizeWeights: normalizeWeights,
    resetWeights: resetWeights,
    setThreshold: setThreshold,
    setProjectsView: setProjectsView,
    goToSearchHit: goToSearchHit
  };
})();
