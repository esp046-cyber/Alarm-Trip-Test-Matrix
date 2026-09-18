/* Alarm & Trip Test Matrix — offline-first PWA. Documentation tool only. */
(function () {
'use strict';

/* ---------------- storage ---------------- */
var DB = (function () {
  var db = null, NAME = 'atm-db', VER = 1;
  var STORES = ['projects', 'items', 'attempts', 'punch', 'meta'];
  function open() {
    return new Promise(function (res, rej) {
      if (db) return res(db);
      var r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = function (e) {
        var d = e.target.result;
        STORES.forEach(function (s) {
          if (!d.objectStoreNames.contains(s)) {
            var os = d.createObjectStore(s, { keyPath: 'id' });
            if (s !== 'meta' && s !== 'projects') os.createIndex('projectId', 'projectId');
          }
        });
      };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(new Error('Storage unavailable')); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), out = fn(t.objectStore(store));
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error || new Error('Write failed')); };
      });
    });
  }
  return {
    all: function (s) { return tx(s, 'readonly', function (o) { return o.getAll(); }); },
    get: function (s, id) { return tx(s, 'readonly', function (o) { return o.get(id); }); },
    put: function (s, v) { return tx(s, 'readwrite', function (o) { return o.put(v); }); },
    del: function (s, id) { return tx(s, 'readwrite', function (o) { return o.delete(id); }); },
    clear: function (s) { return tx(s, 'readwrite', function (o) { return o.clear(); }); },
    stores: STORES
  };
})();

/* ---------------- helpers ---------------- */
var S = { project: null, items: [], attempts: [], punch: [], projects: [], tab: 'dash', filter: {}, draft: null };
var $ = function (s, r) { return (r || document).querySelector(s); };
var uid = function (p) { return (p || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); };
function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nowISO() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
function fmt(v) { if (!v) return '—'; var d = new Date(v); return isNaN(d) ? v : d.toLocaleString(); }
function today() { return nowISO().slice(0, 10); }
function toast(m) {
  var t = $('#toast'); t.textContent = m; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
}
function confirmBox(msg) { return window.confirm(msg); }
function download(name, text, mime) {
  var b = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  var u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
}
function val(id) { var e = $('#' + id); return e ? e.value.trim() : ''; }
function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

var PRIORITIES = ['Critical', 'High', 'Medium', 'Low', 'Informational', 'Custom'];
var TYPES = ['ALARM', 'TRIP', 'SHUTDOWN', 'EQUIPMENT PROTECTION', 'PROCESS ALARM', 'SAFETY ALARM', 'CUSTOM'];
var CHECKLIST = ['Tag verified', 'Description verified', 'Setpoint verified', 'Engineering unit verified',
  'Priority verified', 'Activation verified', 'HMI/SCADA indication verified', 'Acknowledgement verified',
  'Reset verified', 'Expected equipment response verified', 'Actual response recorded', 'Test result recorded',
  'Comments completed', 'Witness/signature completed'];
var HMI_FIELDS = ['Alarm displayed', 'Tag correct', 'Description correct', 'Priority correct', 'Setpoint correct',
  'Colour/indicator correct', 'Timestamp correct', 'Acknowledgement indication', 'Reset indication', 'Trip indication'];
var SAFETY = 'This application is for alarm, trip, and commissioning documentation and workflow support only. ' +
  'Always follow approved project procedures, permits, engineering documents, site safety requirements, and authorised testing procedures. ' +
  'It does not control any PLC, DCS, SCADA or equipment.';

/* ---------------- data access ---------------- */
function loadProjects() { return DB.all('projects').then(function (p) { S.projects = p.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); }); }); }
function loadProject(id) {
  return DB.get('projects', id).then(function (p) {
    S.project = p || null;
    return DB.put('meta', { id: 'current', value: id || null });
  }).then(refreshData);
}
function refreshData() {
  if (!S.project) { S.items = []; S.attempts = []; S.punch = []; return Promise.resolve(); }
  var pid = S.project.id;
  return Promise.all([DB.all('items'), DB.all('attempts'), DB.all('punch')]).then(function (r) {
    var f = function (a) { return a.filter(function (x) { return x.projectId === pid; }); };
    S.items = f(r[0]); S.attempts = f(r[1]); S.punch = f(r[2]);
  });
}
function attemptsFor(itemId) {
  return S.attempts.filter(function (a) { return a.itemId === itemId; })
    .sort(function (a, b) { return a.n - b.n; });
}
function latest(itemId) { var a = attemptsFor(itemId); return a.length ? a[a.length - 1] : null; }
function statusOf(item) { var a = latest(item.id); return a ? a.result : 'PENDING'; }
function save(store, rec) { return DB.put(store, rec).then(refreshData); }

/* ---------------- shell ---------------- */
var TABS = [
  ['dash', 'Dashboard', '▦'], ['projects', 'Projects', '▣'], ['alarms', 'Alarms', '△'],
  ['trips', 'Trips', '⏻'], ['runner', 'Test', '▶'], ['punch', 'Punch', '✚'],
  ['reports', 'Reports', '🖨'], ['settings', 'Settings', '⚙']
];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(function (t) {
    return '<button data-tab="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') +
      '><b>' + t[2] + '</b>' + t[1] + '</button>';
  }).join('');
}
function go(tab, arg) { S.tab = tab; S.arg = arg; render(); }
function header() {
  var p = S.project;
  $('#ctx').textContent = p ? (p.name + ' · ' + (p.pid || 'no ID') + (p.sample ? ' · SAMPLE DATA' : '')) : 'No project open';
  $('#lamp').style.background = p ? 'var(--pass)' : 'var(--acc)';
}
function render() {
  header(); renderTabs();
  var v = $('#view');
  if (!S.project && ['dash', 'alarms', 'trips', 'runner', 'punch', 'reports'].indexOf(S.tab) >= 0) {
    v.innerHTML = '<div class="card"><h2>Open a project to begin</h2><p class="mute small">Every alarm, trip, test and punch item belongs to a project.</p>' +
      '<button class="pri wide" data-act="tab" data-tab="projects" style="margin-top:10px">Go to projects</button></div>' + safetyCard();
    return;
  }
  ({ dash: vDash, projects: vProjects, alarms: vMatrix, trips: vMatrix, runner: vRunner, punch: vPunch, reports: vReports, settings: vSettings }[S.tab] || vDash)(v);
  v.scrollIntoView({ block: 'start' });
}
function safetyCard() { return '<div class="card"><p class="note">' + SAFETY + '</p></div>'; }

/* ---------------- dashboard ---------------- */
function counts(kind) {
  var list = kind ? S.items.filter(function (i) { return i.kind === kind; }) : S.items;
  var c = { total: list.length, PASSED: 0, FAILED: 0, PENDING: 0, 'IN PROGRESS': 0, 'N/A': 0 };
  list.forEach(function (i) { c[statusOf(i)]++; });
  c.done = c.PASSED + c['N/A'];
  c.pct = c.total ? Math.round((c.PASSED + c['N/A'] + c.FAILED) / c.total * 100) : 0;
  return c;
}
function vDash(v) {
  var p = S.project, a = counts('alarm'), t = counts('trip'), o = counts();
  var doneToday = S.attempts.filter(function (x) { return (x.completed || '').slice(0, 10) === today(); }).length;
  var openPunch = S.punch.filter(function (x) { return x.status !== 'Closed'; }).length;
  var info = [['Project', p.name], ['Project ID', p.pid], ['Client', p.client], ['Site', p.site],
    ['System', p.system], ['Engineer', p.engineer], ['Date', p.date]];
  v.innerHTML =
    '<div class="card"><h2>' + esc(p.name) + '</h2>' + (p.sample ? '<span class="tag t-PENDING">SAMPLE DATA</span>' : '') +
      '<div class="grid" style="margin-top:10px">' + info.map(function (r) {
        return '<div><label style="margin:0">' + r[0] + '</label><div>' + esc(r[1] || '—') + '</div></div>'; }).join('') + '</div></div>' +
    '<div class="card"><div class="row sb"><h3>Overall progress</h3><b>' + o.pct + '%</b></div>' +
      '<div class="bar"><i style="width:' + o.pct + '%"></i></div>' +
      '<div class="stats" style="margin-top:12px">' +
      stat(o.total, 'Total tests') + stat(o.PASSED, 'Passed') + stat(o.FAILED, 'Failed') +
      stat(o.PENDING + o['IN PROGRESS'], 'Pending') + stat(o['N/A'], 'N/A') + '</div></div>' +
    subCard('Alarm testing', a) + subCard('Trip testing', t) +
    '<div class="card"><div class="stats">' + stat(openPunch, 'Open punch items') +
      stat(o.FAILED, 'Failed tests') + stat(doneToday, 'Recorded today') + '</div></div>' +
    '<div class="card"><h3>Quick actions</h3><div class="grid">' +
      btn('New alarm', 'newItem', 'data-kind="alarm"', 'pri') + btn('New trip', 'newItem', 'data-kind="trip"', 'pri') +
      tabBtn('Alarm matrix', 'alarms') + tabBtn('Trip matrix', 'trips') + tabBtn('Run a test', 'runner') +
      tabBtn('Punch list', 'punch') + tabBtn('Reports', 'reports') + '</div></div>' + safetyCard();
}
function stat(n, l) { return '<div class="stat"><b>' + n + '</b><span>' + l + '</span></div>'; }
function subCard(title, c) {
  return '<div class="card"><div class="row sb"><h3>' + title + '</h3><span class="mute small">' + c.pct + '% recorded</span></div>' +
    '<div class="bar"><i style="width:' + c.pct + '%"></i></div><div class="stats" style="margin-top:10px">' +
    stat(c.total, 'Total') + stat(c.PASSED, 'Passed') + stat(c.FAILED, 'Failed') +
    stat(c.PENDING + c['IN PROGRESS'], 'Pending') + '</div></div>';
}
function btn(label, act, attrs, cls) { return '<button class="' + (cls || '') + '" data-act="' + act + '" ' + (attrs || '') + '>' + label + '</button>'; }
function tabBtn(label, tab) { return '<button data-act="tab" data-tab="' + tab + '">' + label + '</button>'; }

/* ---------------- projects ---------------- */
var PF = [['name', 'Project name'], ['pid', 'Project ID'], ['client', 'Client'], ['site', 'Site'],
  ['plant', 'Plant / area'], ['system', 'System'], ['engineer', 'Engineer'], ['consultant', 'Consultant'],
  ['contractor', 'Contractor'], ['docNo', 'Document number'], ['rev', 'Revision'], ['date', 'Date']];
function vProjects(v) {
  v.innerHTML = '<div class="card"><div class="row sb"><h2>Projects</h2>' + btn('New project', 'projForm', '', 'pri sm') + '</div>' +
    (S.projects.length ? '' : '<p class="empty">No projects yet. Create one, or load the sample project from Settings.</p>') +
    S.projects.map(function (p) {
      return '<div class="item' + (S.project && S.project.id === p.id ? ' k-alarm' : '') + '">' +
        '<div class="hd"><div><code>' + esc(p.pid || '—') + '</code><div><b>' + esc(p.name) + '</b></div>' +
        '<div class="mute small">' + esc([p.client, p.site, p.system].filter(Boolean).join(' · ') || 'No client details') + '</div></div>' +
        (S.project && S.project.id === p.id ? '<span class="tag t-PASSED">Open</span>' : '') + '</div>' +
        '<div class="row" style="margin-top:8px">' +
        btn('Open', 'openProj', 'data-id="' + p.id + '"', 'sm pri') +
        btn('Edit', 'projForm', 'data-id="' + p.id + '"', 'sm') +
        btn('Duplicate', 'dupProj', 'data-id="' + p.id + '"', 'sm') +
        btn('Delete', 'delProj', 'data-id="' + p.id + '"', 'sm dang') + '</div></div>';
    }).join('') + '</div>';
}
function projForm(id) {
  var p = S.projects.filter(function (x) { return x.id === id; })[0] || { date: today(), tolerance: '' };
  modal(id ? 'Edit project' : 'New project',
    PF.map(function (f) {
      return '<label for="p_' + f[0] + '">' + f[1] + '</label><input id="p_' + f[0] + '" type="' +
        (f[0] === 'date' ? 'date' : 'text') + '" value="' + esc(p[f[0]] || '') + '">'; }).join('') +
    '<label for="p_tolerance">Default setpoint tolerance (optional, project-defined)</label>' +
    '<input id="p_tolerance" value="' + esc(p.tolerance || '') + '" placeholder="e.g. 0.5">' +
    '<button class="pri wide" data-act="saveProj" data-id="' + esc(id || '') + '" style="margin-top:14px">Save project</button>');
}
function saveProj(id) {
  if (!val('p_name')) return toast('Project name is required');
  var base = S.projects.filter(function (x) { return x.id === id; })[0] || { id: uid('prj') };
  PF.forEach(function (f) { base[f[0]] = val('p_' + f[0]); });
  base.tolerance = val('p_tolerance');
  base.checklist = base.checklist || CHECKLIST.slice();
  DB.put('projects', base).then(loadProjects).then(function () {
    return (!S.project || S.project.id === base.id) ? loadProject(base.id) : refreshData();
  }).then(function () { closeModal(); toast('Project saved'); go('projects'); });
}

/* ---------------- item form (alarm / trip) ---------------- */
var COMMON = [['itemId', 'ID', 'text'], ['tag', 'Tag number', 'text'], ['equipment', 'Equipment', 'text'],
  ['system', 'System', 'text'], ['area', 'Area', 'text'], ['desc', 'Description', 'text']];
function itemForm(kind, id) {
  var it = S.items.filter(function (x) { return x.id === id; })[0] ||
    { kind: kind, type: kind === 'trip' ? 'TRIP' : 'ALARM', priority: 'High', direction: 'Rising (high)', resetReq: 'Manual' };
  kind = it.kind;
  var f = COMMON.map(function (c) {
    return '<label for="i_' + c[0] + '">' + c[1] + '</label><input id="i_' + c[0] + '" value="' + esc(it[c[0]] || '') + '">';
  }).join('');
  f += sel('i_type', kind === 'trip' ? 'Trip type' : 'Alarm type', TYPES, it.type);
  f += sel('i_priority', 'Priority', PRIORITIES, it.priority);
  f += '<div class="grid"><div><label for="i_setpoint">Setpoint</label><input id="i_setpoint" inputmode="decimal" value="' + esc(it.setpoint || '') + '"></div>' +
    '<div><label for="i_unit">Engineering unit</label><input id="i_unit" value="' + esc(it.unit || '') + '"></div></div>';
  f += sel('i_direction', kind === 'trip' ? 'Trip direction' : 'Alarm direction',
    ['Rising (high)', 'Falling (low)', 'Deviation', 'Discrete / digital', 'Other'], it.direction);
  if (kind === 'alarm') {
    f += ta('i_expected', 'Expected alarm response', it.expected);
    f += ta('i_expectedState', 'Expected state at setpoint', it.expectedState);
  } else {
    f += ta('i_expected', 'Expected trip action', it.expected);
    f += ta('i_expectedSafe', 'Expected safe state', it.expectedSafe);
    f += ta('i_expectedAlarm', 'Expected associated alarm', it.expectedAlarm);
  }
  f += sel('i_resetReq', 'Reset requirement', ['Manual', 'Automatic', 'Other'], it.resetReq);
  f += ta('i_criteria', 'Acceptance criteria', it.criteria);
  f += '<div><label for="i_tol">Tolerance for this test (±, engineer defined)</label><input id="i_tol" inputmode="decimal" value="' +
    esc(it.tol !== undefined && it.tol !== null ? it.tol : (S.project.tolerance || '')) + '"></div>';
  f += ta('i_notes', 'Notes', it.notes);
  f += '<button class="pri wide" data-act="saveItem" data-kind="' + kind + '" data-id="' + esc(id || '') + '" style="margin-top:14px">Save ' + kind + '</button>';
  modal((id ? 'Edit ' : 'New ') + (kind === 'trip' ? 'trip' : 'alarm'), f);
}
function sel(id, label, opts, cur) {
  return '<label for="' + id + '">' + label + '</label><select id="' + id + '">' + opts.map(function (o) {
    return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
    (cur && opts.indexOf(cur) < 0 ? '<option selected>' + esc(cur) + '</option>' : '') + '</select>';
}
function ta(id, label, v) { return '<label for="' + id + '">' + label + '</label><textarea id="' + id + '">' + esc(v || '') + '</textarea>'; }
function saveItem(kind, id) {
  if (!val('i_itemId')) return toast('An ID is required');
  var it = S.items.filter(function (x) { return x.id === id; })[0] || { id: uid('itm'), projectId: S.project.id, kind: kind };
  ['itemId', 'tag', 'equipment', 'system', 'area', 'desc', 'type', 'priority', 'setpoint', 'unit', 'direction',
   'expected', 'expectedState', 'expectedSafe', 'expectedAlarm', 'resetReq', 'criteria', 'notes', 'tol']
    .forEach(function (k) { if ($('#i_' + k)) it[k] = val('i_' + k); });
  save('items', it).then(function () { closeModal(); toast('Saved'); render(); });
}

/* ---------------- matrices ---------------- */
function filtered(kind) {
  var q = (S.filter.q || '').toLowerCase(), st = S.filter.status, pr = S.filter.priority;
  return S.items.filter(function (i) {
    if (i.kind !== kind) return false;
    if (st && statusOf(i) !== st) return false;
    if (pr && i.priority !== pr) return false;
    if (!q) return true;
    return [i.itemId, i.tag, i.equipment, i.desc, i.area, i.type].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}
function vMatrix(v) {
  var kind = S.tab === 'trips' ? 'trip' : 'alarm', list = filtered(kind);
  var head = kind === 'alarm'
    ? ['Alarm ID', 'Tag', 'Description', 'Equipment', 'Setpoint', 'Unit', 'Priority', 'Expected', 'Actual', 'Ack', 'Reset', 'Result']
    : ['Trip ID', 'Tag', 'Equipment', 'Trigger', 'Setpoint', 'Unit', 'Expected trip', 'Actual trip', 'Safe state', 'Reset', 'Result'];
  v.innerHTML =
    '<div class="card"><div class="row sb"><h2>' + (kind === 'alarm' ? 'Alarm matrix' : 'Trip matrix') + '</h2>' +
      btn('New ' + kind, 'newItem', 'data-kind="' + kind + '"', 'pri sm') + '</div>' +
      '<input id="q" placeholder="Search ID, tag, equipment, description, area" value="' + esc(S.filter.q || '') + '">' +
      '<div class="seg" style="margin-top:8px">' + ['', 'PENDING', 'IN PROGRESS', 'PASSED', 'FAILED', 'N/A'].map(function (s) {
        return '<button data-act="fstatus" data-v="' + s + '" aria-pressed="' + ((S.filter.status || '') === s) + '">' + (s || 'All') + '</button>'; }).join('') + '</div>' +
      '<div class="seg" style="margin-top:6px">' + [''].concat(PRIORITIES).map(function (s) {
        return '<button data-act="fpri" data-v="' + s + '" aria-pressed="' + ((S.filter.priority || '') === s) + '">' + (s || 'Any priority') + '</button>'; }).join('') + '</div></div>' +
    (list.length ? '<div class="card tight"><div class="tblwrap"><table><thead><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '<th>Actions</th></tr></thead><tbody>' +
      list.map(function (i) { return rowFor(kind, i); }).join('') + '</tbody></table></div></div>'
      : '<div class="card"><p class="empty">No ' + kind + 's match. Add one, or clear the filters.</p></div>') +
    list.map(function (i) { return cardFor(i); }).join('');
}
function rowFor(kind, i) {
  var a = latest(i.id) || {}, r = a.result || 'PENDING';
  var cells = kind === 'alarm'
    ? [i.itemId, i.tag, i.desc, i.equipment, i.setpoint, i.unit, i.priority, i.expected, a.actualState, yn(a.ackDone), yn(a.resetOk)]
    : [i.itemId, i.tag, i.equipment, i.desc, i.setpoint, i.unit, i.expected, a.actualTrip, a.actualSafe, yn(a.resetOk)];
  return '<tr>' + cells.map(function (c) { return '<td>' + esc(c || '—') + '</td>'; }).join('') +
    '<td><span class="tag t-' + r.replace(/[ /]/g, '-') + '">' + r + '</span></td>' +
    '<td><button class="sm" data-act="run" data-id="' + i.id + '">Run test</button></td></tr>';
}
function yn(v) { return v === true ? 'YES' : v === false ? 'NO' : '—'; }
function cardFor(i) {
  var r = statusOf(i), n = attemptsFor(i.id).length;
  return '<div class="item k-' + i.kind + '"><div class="hd"><div><code>' + esc(i.itemId) + '</code> <span class="tag t-' + i.kind + '">' + esc(i.type) + '</span>' +
    '<div><b>' + esc(i.desc || '(no description)') + '</b></div>' +
    '<div class="mute small">' + esc([i.tag, i.equipment, i.area].filter(Boolean).join(' · ')) +
    ' — setpoint ' + esc(i.setpoint || '—') + ' ' + esc(i.unit || '') + ' · ' + esc(i.priority) + '</div></div>' +
    '<span class="tag t-' + r.replace(/[ /]/g, '-') + '">' + r + '</span></div>' +
    '<div class="row" style="margin-top:8px">' + btn('Run test', 'run', 'data-id="' + i.id + '"', 'sm pri') +
    btn('Edit', 'editItem', 'data-id="' + i.id + '"', 'sm') +
    btn('History (' + n + ')', 'hist', 'data-id="' + i.id + '"', 'sm') +
    btn('Delete', 'delItem', 'data-id="' + i.id + '"', 'sm dang') + '</div></div>';
}

/* ---------------- test runner ---------------- */
function vRunner(v) {
  if (S.arg) return testForm(v, S.arg);
  var list = S.items.filter(function (i) {
    var q = (S.filter.q || '').toLowerCase();
    return !q || [i.itemId, i.tag, i.equipment, i.desc].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  v.innerHTML = '<div class="card"><h2>Test runner</h2><p class="mute small">Pick the alarm or trip you are about to test. Perform the approved test, then record what you observed.</p>' +
    '<input id="q" placeholder="Search" value="' + esc(S.filter.q || '') + '"></div>' +
    (list.length ? list.map(cardFor).join('') : '<div class="card"><p class="empty">Nothing to test yet. Create an alarm or a trip first.</p></div>');
}
function startAttempt(itemId) {
  var prev = attemptsFor(itemId);
  var p = prev.length ? prev[prev.length - 1] : null;
  if (p && p.result === 'IN PROGRESS') { S.draft = p; return; }
  var it = S.items.filter(function (x) { return x.id === itemId; })[0];
  S.draft = {
    id: uid('att'), projectId: S.project.id, itemId: itemId, n: prev.length + 1,
    started: nowISO(), result: 'IN PROGRESS', tol: it.tol || S.project.tolerance || '',
    hmi: {}, checklist: {}, engineer: S.project.engineer || ''
  };
}
function testForm(v, itemId) {
  var it = S.items.filter(function (x) { return x.id === itemId; })[0];
  if (!it) { S.arg = null; return render(); }
  if (!S.draft || S.draft.itemId !== itemId) startAttempt(itemId);
  var a = S.draft, alarm = it.kind === 'alarm';
  var cl = (S.project.checklist || CHECKLIST);
  v.innerHTML =
    '<div class="card"><div class="row sb"><h2>' + esc(it.itemId) + ' — attempt #' + a.n + '</h2>' +
      btn('Back', 'tab', 'data-tab="' + (alarm ? 'alarms' : 'trips') + '"', 'sm ghost') + '</div>' +
      '<div class="mute small">' + esc(it.desc || '') + '</div>' +
      '<div class="grid" style="margin-top:8px">' +
      kv('Tag', it.tag) + kv('Equipment', it.equipment) + kv('Setpoint', (it.setpoint || '—') + ' ' + (it.unit || '')) +
      kv('Direction', it.direction) + kv('Priority', it.priority) + kv('Reset requirement', it.resetReq) + '</div>' +
      '<hr><b>Expected</b><p class="small">' + esc(it.expected || '—') + '</p>' +
      (alarm ? '' : '<p class="small"><b>Expected safe state:</b> ' + esc(it.expectedSafe || '—') + '</p>') +
      (it.criteria ? '<p class="small"><b>Acceptance criteria:</b> ' + esc(it.criteria) + '</p>' : '') + '</div>' +

    '<div class="card"><h3>Timestamps</h3><p class="mute small">Filled from this device. Edit any of them if the observed time differs.</p>' +
      '<div class="grid">' + tsF('started', 'Test start', a) + tsF('triggered', alarm ? 'Alarm trigger' : 'Trip trigger', a) +
      tsF('acked', 'Acknowledgement', a) + tsF('reset', 'Reset', a) + tsF('completed', 'Test completion', a) + '</div>' +
      '<div class="row" style="margin-top:8px">' + btn('Stamp trigger', 'stamp', 'data-f="triggered"', 'sm') +
      btn('Stamp ack', 'stamp', 'data-f="acked"', 'sm') + btn('Stamp reset', 'stamp', 'data-f="reset"', 'sm') + '</div></div>' +

    '<div class="card"><h3>Location</h3><p class="mute small">Tags where this test was physically performed — useful across large sites with several areas.</p>' +
      locBlock(a) + '</div>' +

    '<div class="card"><h3>Setpoint verification</h3>' +
      '<div class="grid">' +
      '<div><label>Configured setpoint</label><input value="' + esc((it.setpoint || '') + ' ' + (it.unit || '')) + '" readonly></div>' +
      '<div><label for="t_tested">Tested / actual trigger value</label><input id="t_tested" inputmode="decimal" value="' + esc(a.tested || '') + '"></div>' +
      '<div><label for="t_tol">Tolerance ± (' + esc(it.unit || 'unit') + ')</label><input id="t_tol" inputmode="decimal" value="' + esc(a.tol || '') + '"></div>' +
      '</div><div id="dev" class="note" style="margin-top:10px">' + devText(it, a) + '</div></div>' +

    '<div class="card"><h3>Priority verification</h3><div class="grid">' +
      '<div><label>Expected priority</label><input value="' + esc(it.priority) + '" readonly></div>' +
      '<div>' + sel('t_actualPriority', 'Actual priority observed', PRIORITIES.concat(['Not checked']), a.actualPriority || it.priority) + '</div></div></div>' +

    (alarm ?
      '<div class="card"><h3>Alarm activation</h3>' +
        '<div>' + sel('t_actualState', 'Actual alarm state', ['Activated', 'Not activated', 'Activated late', 'Spurious', 'Other'], a.actualState) + '</div>' +
        ta('t_actualResp', 'Actual response observed', a.actualResp) + '</div>' +
      '<div class="card"><h3>Acknowledgement</h3>' +
        ynF('activated', 'Alarm activated', a) + ynF('displayed', 'Alarm displayed on HMI', a) +
        ynF('ackDone', 'Alarm acknowledged', a) + ynF('stillActive', 'Alarm remained active after acknowledgement', a) +
        ta('t_ackExpected', 'Expected acknowledgement behaviour', a.ackExpected) +
        ta('t_ackActual', 'Actual acknowledgement behaviour', a.ackActual) + '</div>'
      :
      '<div class="card"><h3>Trip activation</h3>' +
        ta('t_actualTrip', 'Actual trip action observed', a.actualTrip) +
        ta('t_actualSafe', 'Actual safe state reached', a.actualSafe) +
        ynF('activated', 'Trip activated', a) + ynF('alarmRaised', 'Associated alarm raised', a) + '</div>') +

    '<div class="card"><h3>Reset</h3>' +
      ynF('causeRemoved', alarm ? 'Alarm condition removed' : 'Trip cause removed', a) +
      '<div>' + sel('t_resetType', 'Reset performed', ['Manual', 'Automatic', 'Other', 'Not required'], a.resetType || it.resetReq) + '</div>' +
      ynF('resetOk', 'Reset successful', a) + ynF('cleared', alarm ? 'Alarm cleared' : 'Equipment returned to expected state', a) +
      ta('t_resetExpected', 'Expected reset behaviour', a.resetExpected) +
      ta('t_resetActual', 'Actual reset behaviour', a.resetActual) + '</div>' +

    '<div class="card"><h3>HMI / SCADA verification</h3><p class="mute small">Observed on the operator display. Nothing is read from the control system.</p>' +
      HMI_FIELDS.map(function (f, ix) {
        var cur = (a.hmi || {})[ix] || '';
        return '<div style="margin-bottom:8px"><label style="margin-bottom:4px">' + f + '</label><div class="seg">' +
          ['PASS', 'FAIL', 'N/A'].map(function (r) {
            return '<button data-act="hmi" data-i="' + ix + '" data-v="' + r + '" aria-pressed="' + (cur === r) + '">' + r + '</button>'; }).join('') + '</div></div>';
      }).join('') + '</div>' +

    '<div class="card"><h3>Checklist</h3>' + cl.map(function (c, ix) {
      return '<div class="chk"><input type="checkbox" id="cl' + ix + '" data-act="cl" data-i="' + ix + '"' +
        ((a.checklist || {})[ix] ? ' checked' : '') + '><label for="cl' + ix + '">' + esc(c) + '</label></div>'; }).join('') + '</div>' +

    '<div class="card"><h3>Result</h3><div class="verdict">' +
      ['PASSED', 'FAILED', 'N/A'].map(function (r, ix) {
        return '<button class="' + 'pfn'[ix] + '" data-act="verdict" data-v="' + r + '" aria-pressed="' + (a.result === r) + '">' +
          (r === 'PASSED' ? 'PASS' : r === 'FAILED' ? 'FAIL' : 'N/A') + '</button>'; }).join('') + '</div>' +
      ta('t_comments', 'Comments', a.comments) +
      '<div id="failBox">' + (a.result === 'FAILED' ? failFields(a) : '') + '</div></div>' +

    '<div class="card"><h3>Sign-off</h3>' +
      '<div class="grid"><div><label for="t_engineer">Engineer</label><input id="t_engineer" value="' + esc(a.engineer || '') + '"></div>' +
      '<div><label for="t_witness">Client witness</label><input id="t_witness" value="' + esc(a.witness || '') + '"></div>' +
      '<div><label for="t_consultant">Consultant witness</label><input id="t_consultant" value="' + esc(a.consultant || '') + '"></div></div>' +
      ['sigEng', 'sigWit', 'sigCon'].map(function (k, ix) {
        var names = ['Engineer signature', 'Client witness signature', 'Consultant witness signature'];
        return '<div style="margin-top:10px"><label>' + names[ix] + '</label>' +
          (a[k] ? '<img class="sigimg" alt="' + names[ix] + '" src="' + a[k] + '">' : '') +
          '<div class="row" style="margin-top:6px">' + btn(a[k] ? 'Re-sign' : 'Sign', 'sign', 'data-k="' + k + '"', 'sm') +
          (a[k] ? btn('Clear', 'clearSig', 'data-k="' + k + '"', 'sm dang') : '') + '</div></div>'; }).join('') + '</div>' +

    '<div class="card"><button class="pri wide" data-act="saveTest">Save test record</button>' +
      '<button class="wide ghost" data-act="tab" data-tab="runner" style="margin-top:8px">Cancel</button></div>' + safetyCard();
}
function kv(k, v) { return '<div><label style="margin:0">' + k + '</label><div>' + esc(v || '—') + '</div></div>'; }
function tsF(f, label, a) { return '<div><label for="t_' + f + '">' + label + '</label><input id="t_' + f + '" type="datetime-local" value="' + esc(a[f] || '') + '"></div>'; }
function locBlock(a) {
  var l = a.location;
  if (!l) {
    return '<button class="wide" data-act="capLoc">Capture current location</button>' +
      '<p class="mute small" id="locMsg" style="margin-top:6px"></p>';
  }
  var mapUrl = 'https://www.google.com/maps?q=' + l.lat + ',' + l.lng;
  return '<div class="grid">' + kv('Latitude', l.lat.toFixed(6)) + kv('Longitude', l.lng.toFixed(6)) +
    kv('Accuracy', (l.accuracy ? Math.round(l.accuracy) + ' m' : '—')) + kv('Captured', fmt(l.captured)) + '</div>' +
    '<div class="row" style="margin-top:8px">' +
    '<a class="btn sm" href="' + esc(mapUrl) + '" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;text-align:center">View on map</a>' +
    btn('Recapture', 'capLoc', '', 'sm') + btn('Clear', 'clearLoc', '', 'sm dang') + '</div>' +
    '<p class="mute small" id="locMsg" style="margin-top:6px"></p>';
}
function captureLocation() {
  collectTest();
  var msg = $('#locMsg');
  if (!('geolocation' in navigator)) { if (msg) msg.textContent = 'This device does not support location.'; return; }
  if (msg) msg.textContent = 'Getting location…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    S.draft.location = {
      lat: pos.coords.latitude, lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy, captured: nowISO()
    };
    render(); toast('Location captured');
  }, function (err) {
    if (msg) msg.textContent = err.code === 1
      ? 'Location permission was denied. Allow location access in your browser/app settings to use this.'
      : 'Could not get a location fix. Move to an open area and try again.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}
function ynF(f, label, a) {
  return '<div style="margin-bottom:8px"><label style="margin-bottom:4px">' + label + '</label><div class="seg">' +
    [['YES', true], ['NO', false], ['—', null]].map(function (o) {
      return '<button data-act="yn" data-f="' + f + '" data-v="' + o[0] + '" aria-pressed="' + (a[f] === o[1]) + '">' + o[0] + '</button>'; }).join('') + '</div></div>';
}
function devText(it, a) {
  var c = num(it.setpoint), t = num(a.tested), tol = num(a.tol);
  if (c === null || t === null) return 'Enter a tested value to calculate deviation. Tolerance is defined by you, per project procedure — nothing is assumed.';
  var d = t - c, s = (d >= 0 ? '+' : '') + Math.round(d * 1e6) / 1e6 + ' ' + (it.unit || '');
  if (tol === null) return 'Deviation: ' + s + '. No tolerance entered, so no pass/fail judgement is made.';
  return 'Deviation: ' + s + ' · Tolerance: ±' + tol + ' ' + (it.unit || '') +
    ' · Within tolerance: ' + (Math.abs(d) <= Math.abs(tol) ? 'YES' : 'NO');
}
function failFields(a) {
  return '<hr>' + ta('t_failDesc', 'Failure description', a.failDesc) +
    ta('t_failExpected', 'Expected condition', a.failExpected) +
    ta('t_failActual', 'Actual condition', a.failActual) +
    ta('t_failCause', 'Possible cause', a.failCause) +
    ta('t_failAction', 'Corrective action', a.failAction) +
    ynF('retestRequired', 'Retest required', a) +
    '<button class="wide dang" data-act="punchFromTest" style="margin-top:8px">Create punch item from this failure</button>';
}
function collectTest() {
  var a = S.draft; if (!a) return null;
  ['started', 'triggered', 'acked', 'reset', 'completed'].forEach(function (f) { if ($('#t_' + f)) a[f] = val('t_' + f); });
  ['tested', 'tol', 'actualPriority', 'actualState', 'actualResp', 'actualTrip', 'actualSafe', 'ackExpected', 'ackActual',
   'resetType', 'resetExpected', 'resetActual', 'comments', 'engineer', 'witness', 'consultant',
   'failDesc', 'failExpected', 'failActual', 'failCause', 'failAction']
    .forEach(function (k) { if ($('#t_' + k)) a[k] = val('t_' + k); });
  return a;
}
function saveTest() {
  var a = collectTest(); if (!a) return;
  if (a.result === 'IN PROGRESS' && !confirmBox('No PASS / FAIL / N/A selected. Save as in progress?')) return;
  if (a.result !== 'IN PROGRESS' && !a.completed) a.completed = nowISO();
  a.modified = nowISO();
  save('attempts', a).then(function () {
    S.draft = null; S.arg = null; toast('Test record saved');
    go(S.items.filter(function (i) { return i.id === a.itemId; })[0].kind === 'trip' ? 'trips' : 'alarms');
  });
}

/* ---------------- history ---------------- */
function history(itemId) {
  var it = S.items.filter(function (x) { return x.id === itemId; })[0], list = attemptsFor(itemId);
  modal('Test history — ' + it.itemId,
    (list.length ? list.slice().reverse().map(function (a) {
      return '<div class="attempt"><div class="row sb"><b>Attempt #' + a.n + '</b>' +
        '<span class="tag t-' + a.result.replace(/[ /]/g, '-') + '">' + a.result + '</span></div>' +
        '<div class="mute small">' + fmt(a.completed || a.started) + ' · ' + esc(a.engineer || 'unsigned') + '</div>' +
        (a.tested ? '<p class="small">Tested value: ' + esc(a.tested) + ' ' + esc(it.unit || '') + '</p>' : '') +
        (a.location ? '<p class="small">Location: ' + a.location.lat.toFixed(5) + ', ' + a.location.lng.toFixed(5) +
          ' (±' + Math.round(a.location.accuracy || 0) + ' m)</p>' : '') +
        (a.failDesc ? '<p class="small">Failure: ' + esc(a.failDesc) + '</p>' : '') +
        (a.comments ? '<p class="small">' + esc(a.comments) + '</p>' : '') + '</div>';
    }).join('') : '<p class="empty">No attempts recorded yet.</p>') +
    '<button class="pri wide" data-act="run" data-id="' + itemId + '">' + (list.length ? 'Retest (new attempt)' : 'Run test') + '</button>' +
    '<p class="mute small" style="margin-top:8px">Each attempt is kept. Retesting never overwrites an earlier result.</p>');
}

/* ---------------- punch list ---------------- */
var PUNCH_ST = ['Open', 'In Progress', 'Closed'];
function vPunch(v) {
  var list = S.punch.slice().sort(function (a, b) { return (a.status === 'Closed') - (b.status === 'Closed'); });
  v.innerHTML = '<div class="card"><div class="row sb"><h2>Punch list</h2>' + btn('New punch item', 'punchForm', '', 'pri sm') + '</div>' +
    '<p class="mute small">Items stay open until you close them.</p></div>' +
    (list.length ? list.map(function (p) {
      return '<div class="item"><div class="hd"><div><code>' + esc(p.punchId) + '</code>' +
        '<div><b>' + esc(p.desc) + '</b></div><div class="mute small">' +
        esc([p.tag, p.equipment, p.priority, 'raised ' + (p.raised || '')].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="mute small">Responsible: ' + esc(p.owner || '—') + ' · Target: ' + esc(p.target || '—') + '</div></div>' +
        '<span class="tag t-' + esc(p.status) + '">' + esc(p.status) + '</span></div>' +
        '<div class="row" style="margin-top:8px">' + btn('Edit', 'punchForm', 'data-id="' + p.id + '"', 'sm') +
        btn('Delete', 'delPunch', 'data-id="' + p.id + '"', 'sm dang') + '</div></div>';
    }).join('') : '<div class="card"><p class="empty">No punch items. Failed tests can raise one automatically.</p></div>');
}
function punchForm(id, seed) {
  var p = S.punch.filter(function (x) { return x.id === id; })[0] || seed ||
    { punchId: 'P-' + String(S.punch.length + 1).padStart(3, '0'), raised: today(), status: 'Open', priority: 'High' };
  modal(id ? 'Edit punch item' : 'New punch item',
    inp('n_punchId', 'Punch ID', p.punchId) + inp('n_testId', 'Test ID', p.testId) + inp('n_refId', 'Alarm / trip ID', p.refId) +
    inp('n_tag', 'Tag', p.tag) + inp('n_equipment', 'Equipment', p.equipment) + ta('n_desc', 'Description', p.desc) +
    sel('n_priority', 'Priority', PRIORITIES, p.priority) + inp('n_owner', 'Responsible person', p.owner) +
    inp('n_raised', 'Date raised', p.raised, 'date') + inp('n_target', 'Target date', p.target, 'date') +
    sel('n_status', 'Status', PUNCH_ST, p.status) + ta('n_resolution', 'Resolution', p.resolution) +
    inp('n_closed', 'Close date', p.closed, 'date') +
    '<button class="pri wide" data-act="savePunch" data-id="' + esc(id || '') + '" style="margin-top:14px">Save punch item</button>');
}
function inp(id, label, v, type) {
  return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v || '') + '">';
}
function savePunch(id) {
  var p = S.punch.filter(function (x) { return x.id === id; })[0] || { id: uid('pch'), projectId: S.project.id };
  ['punchId', 'testId', 'refId', 'tag', 'equipment', 'desc', 'priority', 'owner', 'raised', 'target', 'status', 'resolution', 'closed']
    .forEach(function (k) { p[k] = val('n_' + k); });
  if (!p.desc) return toast('Describe the punch item before saving');
  save('punch', p).then(function () { closeModal(); toast('Punch item saved'); go('punch'); });
}
function punchFromTest() {
  var a = collectTest(), it = S.items.filter(function (x) { return x.id === a.itemId; })[0];
  punchForm(null, {
    punchId: 'P-' + String(S.punch.length + 1).padStart(3, '0'), testId: a.id, refId: it.itemId, tag: it.tag,
    equipment: it.equipment, desc: a.failDesc || ('Failed test — ' + (it.desc || it.itemId)), priority: it.priority,
    owner: a.engineer || S.project.engineer || '', raised: today(), status: 'Open'
  });
}

/* ---------------- CSV ---------------- */
var CSV_COLS = ['ID', 'Type', 'Tag', 'Equipment', 'Area', 'Description', 'Setpoint', 'Unit', 'Priority', 'Expected Response', 'Acceptance Criteria', 'Reset Requirement'];
function csvCell(v) { v = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCSV(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
function parseCSV(txt) {
  var rows = [], row = [], cur = '', q = false;
  txt = txt.replace(/^\uFEFF/, '');
  for (var i = 0; i < txt.length; i++) {
    var c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return c.trim() !== ''; }); });
}
function importCSV(file) {
  var fr = new FileReader();
  fr.onload = function () {
    var rows;
    try { rows = parseCSV(fr.result); } catch (e) { return toast('That file could not be read as CSV'); }
    if (rows.length < 2) return toast('The file has no data rows');
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = function (n) { return head.indexOf(n.toLowerCase()); };
    var errs = [], imported = 0, skipped = 0, pending = [];
    rows.slice(1).forEach(function (r, n) {
      var get = function (c) { var i = idx(c); return i < 0 ? '' : (r[i] || '').trim(); };
      var id = get('ID'), type = (get('Type') || 'ALARM').toUpperCase();
      if (!id) { skipped++; errs.push('Row ' + (n + 2) + ': missing ID'); return; }
      if (S.items.some(function (x) { return x.itemId === id; })) { skipped++; errs.push('Row ' + (n + 2) + ': ID ' + id + ' already exists'); return; }
      var kind = /TRIP|SHUTDOWN|PROTECTION/.test(type) ? 'trip' : 'alarm';
      pending.push({
        id: uid('itm'), projectId: S.project.id, kind: kind, itemId: id, type: type, tag: get('Tag'),
        equipment: get('Equipment'), area: get('Area'), desc: get('Description'), setpoint: get('Setpoint'),
        unit: get('Unit'), priority: get('Priority') || 'Medium', expected: get('Expected Response'),
        criteria: get('Acceptance Criteria'), resetReq: get('Reset Requirement') || 'Manual', direction: 'Rising (high)'
      });
      imported++;
    });
    Promise.all(pending.map(function (p) { return DB.put('items', p); })).then(refreshData).then(function () {
      modal('Import summary', '<div class="stats">' + stat(imported, 'Imported') + stat(skipped, 'Skipped') + stat(errs.length, 'Errors') + '</div>' +
        (errs.length ? '<hr><p class="small">Rows not imported:</p><ul class="small">' + errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
        '<button class="pri wide" data-act="closeModal" style="margin-top:12px">Done</button>');
      render();
    });
  };
  fr.onerror = function () { toast('The file could not be opened'); };
  fr.readAsText(file);
}
function exportMatrix(kind) {
  var rows = [CSV_COLS];
  S.items.filter(function (i) { return i.kind === kind; }).forEach(function (i) {
    rows.push([i.itemId, i.type, i.tag, i.equipment, i.area, i.desc, i.setpoint, i.unit, i.priority, i.expected, i.criteria, i.resetReq]);
  });
  download(S.project.pid + '-' + kind + '-matrix.csv', toCSV(rows), 'text/csv');
}
function exportResults(onlyFailed) {
  var rows = [['ID', 'Type', 'Tag', 'Equipment', 'Description', 'Setpoint', 'Unit', 'Attempt', 'Tested Value',
    'Tolerance', 'Deviation', 'Actual', 'Acknowledged', 'Reset OK', 'HMI Result', 'Result', 'Latitude', 'Longitude',
    'Accuracy (m)', 'Comments', 'Engineer', 'Completed']];
  S.items.forEach(function (i) {
    attemptsFor(i.id).forEach(function (a) {
      if (onlyFailed && a.result !== 'FAILED') return;
      var d = (num(i.setpoint) !== null && num(a.tested) !== null) ? Math.round((num(a.tested) - num(i.setpoint)) * 1e6) / 1e6 : '';
      var loc = a.location || {};
      rows.push([i.itemId, i.type, i.tag, i.equipment, i.desc, i.setpoint, i.unit, a.n, a.tested, a.tol, d,
        a.actualState || a.actualTrip || '', yn(a.ackDone), yn(a.resetOk), hmiSummary(a), a.result,
        loc.lat !== undefined ? loc.lat.toFixed(6) : '', loc.lng !== undefined ? loc.lng.toFixed(6) : '',
        loc.accuracy !== undefined ? Math.round(loc.accuracy) : '', a.comments, a.engineer, a.completed]);
    });
  });
  if (rows.length === 1) return toast('There are no matching test records to export');
  download(S.project.pid + (onlyFailed ? '-failed-tests.csv' : '-test-results.csv'), toCSV(rows), 'text/csv');
}
function exportPunch() {
  var rows = [['Punch ID', 'Test ID', 'Alarm/Trip ID', 'Tag', 'Equipment', 'Description', 'Priority', 'Responsible', 'Date Raised', 'Target Date', 'Status', 'Resolution', 'Close Date']];
  S.punch.forEach(function (p) { rows.push([p.punchId, p.testId, p.refId, p.tag, p.equipment, p.desc, p.priority, p.owner, p.raised, p.target, p.status, p.resolution, p.closed]); });
  if (rows.length === 1) return toast('The punch list is empty');
  download(S.project.pid + '-punch-list.csv', toCSV(rows), 'text/csv');
}
function hmiSummary(a) {
  var h = a.hmi || {}, v = Object.keys(h).map(function (k) { return h[k]; });
  if (!v.length) return '';
  return v.indexOf('FAIL') >= 0 ? 'FAIL' : v.indexOf('PASS') >= 0 ? 'PASS' : 'N/A';
}

/* ---------------- backup ---------------- */
function exportBackup() {
  Promise.all(DB.stores.map(function (s) { return DB.all(s); })).then(function (r) {
    var data = { app: 'alarm-trip-test-matrix', version: 1, exported: new Date().toISOString() };
    DB.stores.forEach(function (s, i) { data[s] = r[i]; });
    download('atm-backup-' + today() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('Backup exported');
  });
}
function importBackup(file) {
  var fr = new FileReader();
  fr.onload = function () {
    var d;
    try { d = JSON.parse(fr.result); } catch (e) { return toast('That file is not valid JSON'); }
    if (!d || d.app !== 'alarm-trip-test-matrix' || !Array.isArray(d.projects))
      return toast('That file is not a backup from this application');
    var n = (d.projects || []).length + (d.items || []).length + (d.attempts || []).length;
    if (!confirmBox('Restore ' + n + ' records? This replaces everything currently stored on this device.')) return;
    Promise.all(DB.stores.map(function (s) { return DB.clear(s); })).then(function () {
      var puts = [];
      DB.stores.forEach(function (s) { (d[s] || []).forEach(function (rec) { if (rec && rec.id) puts.push(DB.put(s, rec)); }); });
      return Promise.all(puts);
    }).then(loadProjects).then(function () {
      return loadProject(S.projects.length ? S.projects[0].id : null);
    }).then(function () { toast('Backup restored'); go('dash'); });
  };
  fr.readAsText(file);
}

/* ---------------- reports ---------------- */
function vReports(v) {
  v.innerHTML = '<div class="card"><h2>Reports</h2><p class="mute small">Reports open in a new tab, formatted for printing or saving as PDF.</p>' +
    '<div class="grid" style="margin-top:8px">' +
    btn('Alarm report', 'report', 'data-r="alarm"', 'pri') + btn('Trip report', 'report', 'data-r="trip"', 'pri') +
    btn('Alarm &amp; trip matrix', 'report', 'data-r="matrix"') + btn('Full test report', 'report', 'data-r="tests"') +
    btn('Punch list report', 'report', 'data-r="punch"') + '</div></div>' +
    '<div class="card"><h3>CSV export</h3><div class="grid">' +
    btn('Alarm matrix', 'csv', 'data-r="alarm"') + btn('Trip matrix', 'csv', 'data-r="trip"') +
    btn('Test results', 'csv', 'data-r="results"') + btn('Failed tests', 'csv', 'data-r="failed"') +
    btn('Punch list', 'csv', 'data-r="punch"') + '</div></div>' +
    '<div class="card"><h3>CSV import</h3><p class="mute small">Columns: ' + CSV_COLS.join(', ') + '</p>' +
    '<input type="file" id="csvFile" accept=".csv,text/csv"><button class="wide" data-act="doImportCSV" style="margin-top:8px">Import matrix</button></div>' + safetyCard();
}
function reportHTML(kind) {
  var p = S.project, rows = '', title = '';
  var head = '<h1>' + esc(kind === 'punch' ? 'Punch list' : kind === 'matrix' ? 'Alarm & trip matrix' :
    kind === 'tests' ? 'Alarm & trip test report' : (kind === 'alarm' ? 'Alarm test report' : 'Trip test report')) + '</h1>' +
    '<table class="info"><tbody>' +
    [['Project', p.name], ['Project ID', p.pid], ['Client', p.client], ['Site', p.site], ['Plant / area', p.plant],
     ['System', p.system], ['Engineer', p.engineer], ['Consultant', p.consultant], ['Contractor', p.contractor],
     ['Document number', p.docNo], ['Revision', p.rev], ['Date', p.date], ['Printed', new Date().toLocaleString()]]
      .map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1] || '—') + '</td></tr>'; }).join('') + '</tbody></table>';

  if (kind === 'punch') {
    rows = '<table><thead><tr>' + ['Punch ID', 'Ref', 'Tag', 'Equipment', 'Description', 'Priority', 'Responsible', 'Raised', 'Target', 'Status', 'Resolution', 'Closed']
      .map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      S.punch.map(function (x) {
        return '<tr>' + [x.punchId, x.refId, x.tag, x.equipment, x.desc, x.priority, x.owner, x.raised, x.target, x.status, x.resolution, x.closed]
          .map(function (c) { return '<td>' + esc(c || '—') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    return page(head + rows);
  }
  if (kind === 'matrix') {
    ['alarm', 'trip'].forEach(function (k) {
      rows += '<h2>' + (k === 'alarm' ? 'Alarms' : 'Trips') + '</h2><table><thead><tr>' +
        CSV_COLS.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '<th>Result</th></tr></thead><tbody>' +
        S.items.filter(function (i) { return i.kind === k; }).map(function (i) {
          return '<tr>' + [i.itemId, i.type, i.tag, i.equipment, i.area, i.desc, i.setpoint, i.unit, i.priority, i.expected, i.criteria, i.resetReq]
            .map(function (c) { return '<td>' + esc(c || '—') + '</td>'; }).join('') + '<td>' + statusOf(i) + '</td></tr>'; }).join('') + '</tbody></table>';
    });
    return page(head + rows);
  }
  var list = S.items.filter(function (i) { return kind === 'tests' ? true : i.kind === kind; });
  var c = counts(kind === 'tests' ? null : kind);
  rows += '<p class="sum">Total ' + c.total + ' · Passed ' + c.PASSED + ' · Failed ' + c.FAILED +
    ' · Pending ' + (c.PENDING + c['IN PROGRESS']) + ' · N/A ' + c['N/A'] + ' · Recorded ' + c.pct + '%</p>';
  list.forEach(function (i) {
    var att = attemptsFor(i.id), last = att.length ? att[att.length - 1] : null;
    rows += '<div class="blk"><h2>' + esc(i.itemId) + ' — ' + esc(i.desc || '') + '</h2>' +
      '<table class="info"><tbody>' +
      [['Type', i.type], ['Tag', i.tag], ['Equipment', i.equipment], ['Area', i.area],
       ['Setpoint', (i.setpoint || '—') + ' ' + (i.unit || '')], ['Priority', i.priority],
       ['Expected response', i.expected], ['Expected safe state', i.expectedSafe],
       ['Reset requirement', i.resetReq], ['Acceptance criteria', i.criteria]]
        .filter(function (r) { return r[1]; }).map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (!att.length) rows += '<p class="pend">No test recorded.</p>';
    att.forEach(function (a) {
      var dev = (num(i.setpoint) !== null && num(a.tested) !== null) ? Math.round((num(a.tested) - num(i.setpoint)) * 1e6) / 1e6 : null;
      rows += '<h3>Attempt #' + a.n + ' — <span class="r' + a.result.charAt(0) + '">' + a.result + '</span></h3>' +
        '<table class="info"><tbody>' +
        [['Tested value', a.tested], ['Tolerance', a.tol ? '±' + a.tol : ''], ['Deviation', dev === null ? '' : dev],
         ['Actual response', a.actualResp || a.actualTrip], ['Actual safe state', a.actualSafe],
         ['Actual priority', a.actualPriority], ['Acknowledged', a.ackDone === undefined ? '' : yn(a.ackDone)],
         ['Reset successful', a.resetOk === undefined ? '' : yn(a.resetOk)], ['HMI / SCADA', hmiSummary(a)],
         ['Trigger time', a.triggered && fmt(a.triggered)], ['Acknowledged at', a.acked && fmt(a.acked)],
         ['Reset at', a.reset && fmt(a.reset)], ['Completed', a.completed && fmt(a.completed)],
         ['Location', a.location && (a.location.lat.toFixed(6) + ', ' + a.location.lng.toFixed(6) +
           ' (±' + Math.round(a.location.accuracy || 0) + ' m)')],
         ['Comments', a.comments], ['Failure', a.failDesc], ['Corrective action', a.failAction],
         ['Engineer', a.engineer], ['Witness', a.witness]]
          .filter(function (r) { return r[1] !== '' && r[1] !== undefined && r[1] !== null && r[1] !== false; })
          .map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
        (a.sigEng || a.sigWit || a.sigCon ? '<div class="sigs">' +
          [['Engineer', a.sigEng, a.engineer], ['Client witness', a.sigWit, a.witness], ['Consultant', a.sigCon, a.consultant]]
            .filter(function (s) { return s[1]; }).map(function (s) {
              return '<div><img src="' + s[1] + '" alt="' + s[0] + ' signature"><div>' + s[0] + ': ' + esc(s[2] || '') + '</div></div>'; }).join('') + '</div>' : '');
    });
    rows += '</div>';
  });
  rows += '<div class="blk"><h2>Sign-off</h2><table class="sign"><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr>' +
    ['Engineer', 'Client witness', 'Consultant witness'].map(function (r) { return '<tr><td>' + r + '</td><td></td><td></td><td></td></tr>'; }).join('') + '</table></div>';
  return page(head + rows);
}
function page(body) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(S.project.name) + ' report</title><style>' +
    'body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:22px;max-width:1000px}' +
    'h1{font-size:19px;border-bottom:3px solid #111;padding-bottom:6px}h2{font-size:14px;margin:16px 0 6px}h3{font-size:12px;margin:10px 0 4px}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:10px}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top;font-size:11px}' +
    'th{background:#eee;width:auto}table.info th{width:180px}.blk{page-break-inside:avoid;border-top:1px solid #ccc;padding-top:8px;margin-top:14px}' +
    '.rP{color:#046b32;font-weight:bold}.rF{color:#a3120c;font-weight:bold}.rN{color:#555}.pend{color:#8a6100}' +
    '.sum{background:#f2f2f2;padding:6px 8px;border:1px solid #ccc}.sigs{display:flex;gap:14px;flex-wrap:wrap}.sigs img{height:70px;border:1px solid #999}' +
    '.foot{margin-top:20px;border-top:1px solid #999;padding-top:6px;font-size:10px;color:#444}' +
    '@media print{body{margin:10mm}}</style></head><body>' + body +
    '<p class="foot">' + SAFETY + '</p></body></html>';
}
function openReport(kind) {
  var w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to open reports');
  w.document.write(reportHTML(kind)); w.document.close();
  setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

/* ---------------- signatures ---------------- */
function signPad(key) {
  modal('Signature', '<canvas class="sig" id="pad"></canvas>' +
    '<div class="row" style="margin-top:10px">' + btn('Clear', 'padClear', '', 'sm') +
    btn('Save signature', 'padSave', 'data-k="' + key + '"', 'sm pri') + '</div>');
  var c = $('#pad'), r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  var x = c.getContext('2d'); x.scale(dpr, dpr); x.lineWidth = 2.4; x.lineCap = 'round'; x.strokeStyle = '#10222c';
  var drawing = false;
  function pt(e) { var b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
  c.addEventListener('pointerdown', function (e) { drawing = true; c.setPointerCapture(e.pointerId); var p = pt(e); x.beginPath(); x.moveTo(p[0], p[1]); });
  c.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pt(e); x.lineTo(p[0], p[1]); x.stroke(); });
  c.addEventListener('pointerup', function () { drawing = false; });
  signPad.clear = function () { x.clearRect(0, 0, c.width, c.height); };
  signPad.data = function () { return c.toDataURL('image/png'); };
}

/* ---------------- sample data ---------------- */
function loadSample() {
  var pid = uid('prj');
  var p = { id: pid, name: 'Water Treatment Plant Automation (SAMPLE)', pid: 'WTP-2026-001', client: 'City Water Authority',
    site: 'North Works', plant: 'Filtration', system: 'PLC-01 / SCADA', engineer: 'A. Engineer', consultant: 'Consultant Ltd',
    contractor: 'Automation Co', docNo: 'WTP-ATM-001', rev: '0', date: today(), tolerance: '0.5', sample: true, checklist: CHECKLIST.slice() };
  var items = [
    ['alarm', 'AL-001', 'LIT-101', 'Tank T-101', 'High tank level', '80', '%', 'High', 'Alarm activates at high level and is annunciated on the HMI.'],
    ['alarm', 'AL-002', 'PIT-101', 'Header', 'High discharge pressure', '8', 'bar', 'High', 'Alarm activates at high pressure.'],
    ['alarm', 'AHH-101', 'LIT-101', 'Tank T-101', 'High-high tank level', '90', '%', 'Critical', 'Alarm activates when level reaches the configured high-high condition.'],
    ['trip', 'TR-001', 'PSL-101', 'Pump P-101', 'Low-low suction pressure', '2.0', 'bar', 'Critical', 'Pump P-101 stops.'],
    ['trip', 'TR-002', 'TSHH-101', 'Blower B-101', 'High bearing temperature', '90', '\u00b0C', 'High', 'Blower B-101 stops.']
  ].map(function (r) {
    return { id: uid('itm'), projectId: pid, kind: r[0], itemId: r[1], tag: r[2], equipment: r[3], desc: r[4],
      setpoint: r[5], unit: r[6], priority: r[7], expected: r[8], type: r[0] === 'trip' ? 'TRIP' : 'ALARM',
      area: 'Filtration', system: 'PLC-01', direction: r[1] === 'TR-001' ? 'Falling (low)' : 'Rising (high)',
      expectedSafe: r[0] === 'trip' ? 'Equipment stopped, isolated and safe.' : '',
      resetReq: 'Manual', criteria: 'Response within approved procedure and tolerance.', tol: '0.5', sample: true };
  });
  DB.put('projects', p).then(function () { return Promise.all(items.map(function (i) { return DB.put('items', i); })); })
    .then(loadProjects).then(function () { return loadProject(pid); })
    .then(function () { toast('Sample project loaded'); go('dash'); });
}
function deleteSample() {
  if (!confirmBox('Delete every project and record marked as sample data?')) return;
  Promise.all([DB.all('projects'), DB.all('items'), DB.all('attempts'), DB.all('punch')]).then(function (r) {
    var ids = r[0].filter(function (p) { return p.sample; }).map(function (p) { return p.id; });
    var jobs = ids.map(function (id) { return DB.del('projects', id); });
    ['items', 'attempts', 'punch'].forEach(function (s, ix) {
      r[ix + 1].forEach(function (x) { if (ids.indexOf(x.projectId) >= 0) jobs.push(DB.del(s, x.id)); });
    });
    return Promise.all(jobs).then(function () { return ids; });
  }).then(function (ids) {
    return loadProjects().then(function () {
      return (S.project && ids.indexOf(S.project.id) >= 0) ? loadProject(S.projects.length ? S.projects[0].id : null) : refreshData();
    });
  }).then(function () { toast('Sample data deleted'); go('projects'); });
}

/* ---------------- settings ---------------- */
function vSettings(v) {
  var cl = (S.project && S.project.checklist) || CHECKLIST;
  v.innerHTML =
    '<div class="card"><h2>Data</h2><div class="grid">' +
      btn('Export full backup', 'exportBackup', '', 'pri') + btn('Load sample project', 'sample') +
      btn('Delete sample data', 'delSample', '', 'dang') + '</div>' +
      '<hr><label for="bkFile">Restore from backup file</label><input type="file" id="bkFile" accept=".json,application/json">' +
      '<button class="wide" data-act="doImportBackup" style="margin-top:8px">Import backup</button>' +
      '<p class="mute small">You will be asked to confirm before anything is replaced.</p></div>' +
    (S.project ? '<div class="card"><h2>Checklist for this project</h2><p class="mute small">One item per line.</p>' +
      '<textarea id="clist" style="min-height:230px">' + esc(cl.join('\n')) + '</textarea>' +
      '<button class="pri wide" data-act="saveChecklist" style="margin-top:8px">Save checklist</button></div>' : '') +
    '<div class="card"><h2>Storage</h2><p class="small mute">Everything is stored in this browser using IndexedDB and survives refresh, browser restart and app restart. Nothing is sent anywhere.</p>' +
      '<button class="wide dang" data-act="wipe">Erase all data on this device</button></div>' +
    '<div class="card"><h2>About</h2><p class="small">Alarm &amp; Trip Test Matrix — offline-first field tool for testing and commissioning.</p>' +
      '<p class="note">' + SAFETY + '</p></div>';
}

/* ---------------- modal ---------------- */
function modal(title, html) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }

/* ---------------- events ---------------- */
document.addEventListener('click', function (e) {
  var t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
  var act = t.dataset.act, id = t.dataset.id;
  try {
    switch (act) {
      case 'tab': S.arg = null; S.draft = t.dataset.tab === 'runner' ? S.draft : null; go(t.dataset.tab); break;
      case 'projForm': projForm(id); break;
      case 'saveProj': saveProj(id); break;
      case 'openProj': loadProject(id).then(function () { toast('Project opened'); go('dash'); }); break;
      case 'dupProj':
        var src = S.projects.filter(function (x) { return x.id === id; })[0];
        var copy = JSON.parse(JSON.stringify(src)); copy.id = uid('prj'); copy.name = src.name + ' (copy)'; copy.sample = false;
        DB.put('projects', copy).then(function () {
          return Promise.all(S.items.concat([]).filter(function (i) { return i.projectId === id; }).map(function (i) {
            var c = JSON.parse(JSON.stringify(i)); c.id = uid('itm'); c.projectId = copy.id; return DB.put('items', c); }));
        }).then(loadProjects).then(refreshData).then(function () { toast('Project duplicated'); go('projects'); });
        break;
      case 'delProj':
        if (!confirmBox('Delete this project with all its alarms, trips, tests and punch items? This cannot be undone.')) break;
        Promise.all([DB.all('items'), DB.all('attempts'), DB.all('punch')]).then(function (r) {
          var jobs = [DB.del('projects', id)];
          ['items', 'attempts', 'punch'].forEach(function (s, ix) {
            r[ix].forEach(function (x) { if (x.projectId === id) jobs.push(DB.del(s, x.id)); }); });
          return Promise.all(jobs);
        }).then(loadProjects).then(function () {
          return (S.project && S.project.id === id) ? loadProject(S.projects.length ? S.projects[0].id : null) : refreshData();
        }).then(function () { toast('Project deleted'); go('projects'); });
        break;
      case 'newItem': itemForm(t.dataset.kind); break;
      case 'editItem': itemForm(null, id); break;
      case 'saveItem': saveItem(t.dataset.kind, id); break;
      case 'delItem':
        if (!confirmBox('Delete this record and its test history?')) break;
        Promise.all([DB.del('items', id)].concat(attemptsFor(id).map(function (a) { return DB.del('attempts', a.id); })))
          .then(refreshData).then(function () { toast('Deleted'); render(); });
        break;
      case 'run': closeModal(); S.draft = null; go('runner', id); break;
      case 'hist': history(id); break;
      case 'fstatus': S.filter.status = t.dataset.v || null; render(); break;
      case 'fpri': S.filter.priority = t.dataset.v || null; render(); break;
      case 'yn':
        collectTest(); S.draft[t.dataset.f] = t.dataset.v === 'YES' ? true : t.dataset.v === 'NO' ? false : undefined; render(); break;
      case 'hmi':
        collectTest(); S.draft.hmi = S.draft.hmi || {}; S.draft.hmi[t.dataset.i] = t.dataset.v; render(); break;
      case 'cl': break;
      case 'stamp': collectTest(); S.draft[t.dataset.f] = nowISO(); render(); break;
      case 'capLoc': captureLocation(); break;
      case 'clearLoc': collectTest(); delete S.draft.location; render(); break;
      case 'verdict':
        collectTest(); S.draft.result = t.dataset.v;
        if (S.draft.result !== 'IN PROGRESS') S.draft.completed = S.draft.completed || nowISO();
        render(); break;
      case 'saveTest': saveTest(); break;
      case 'sign': collectTest(); signPad(t.dataset.k); break;
      case 'padClear': signPad.clear(); break;
      case 'padSave': S.draft[t.dataset.k] = signPad.data(); closeModal(); render(); toast('Signature saved'); break;
      case 'clearSig': collectTest(); delete S.draft[t.dataset.k]; render(); break;
      case 'punchForm': punchForm(id); break;
      case 'savePunch': savePunch(id); break;
      case 'punchFromTest': punchFromTest(); break;
      case 'delPunch': if (confirmBox('Delete this punch item?')) DB.del('punch', id).then(refreshData).then(render); break;
      case 'report': openReport(t.dataset.r); break;
      case 'csv':
        var r = t.dataset.r;
        if (r === 'alarm' || r === 'trip') exportMatrix(r);
        else if (r === 'results') exportResults(false);
        else if (r === 'failed') exportResults(true);
        else exportPunch();
        break;
      case 'doImportCSV':
        var f = $('#csvFile').files[0]; if (!f) return toast('Choose a CSV file first'); importCSV(f); break;
      case 'exportBackup': exportBackup(); break;
      case 'doImportBackup':
        var bf = $('#bkFile').files[0]; if (!bf) return toast('Choose a backup file first'); importBackup(bf); break;
      case 'sample': loadSample(); break;
      case 'delSample': deleteSample(); break;
      case 'saveChecklist':
        S.project.checklist = val('clist').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        DB.put('projects', S.project).then(function () { toast('Checklist saved'); }); break;
      case 'wipe':
        if (!confirmBox('Erase every project, test, punch item and signature stored on this device?')) break;
        Promise.all(DB.stores.map(function (s) { return DB.clear(s); })).then(loadProjects).then(function () {
          S.project = null; toast('All data erased'); go('projects'); }); break;
      case 'closeModal': closeModal(); break;
      default: if (t.dataset.tab) { S.arg = null; go(t.dataset.tab); }
    }
  } catch (err) { toast('Something went wrong with that action'); }
});
document.addEventListener('change', function (e) {
  if (e.target.dataset && e.target.dataset.act === 'cl' && S.draft) {
    S.draft.checklist = S.draft.checklist || {};
    S.draft.checklist[e.target.dataset.i] = e.target.checked;
  }
});
document.addEventListener('input', function (e) {
  if (e.target.id === 'q') { S.filter.q = e.target.value; var p = e.target.selectionStart; render();
    var n = $('#q'); if (n) { n.focus(); n.setSelectionRange(p, p); } }
  if ((e.target.id === 't_tested' || e.target.id === 't_tol') && S.draft) {
    S.draft.tested = val('t_tested'); S.draft.tol = val('t_tol');
    var it = S.items.filter(function (x) { return x.id === S.draft.itemId; })[0];
    if ($('#dev')) $('#dev').textContent = devText(it, S.draft);
  }
});
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

/* ---------------- network + boot ---------------- */
function netState() {
  var on = navigator.onLine, el = $('#net');
  el.classList.toggle('off', !on);
  $('#netTxt').textContent = on ? 'Online' : 'Offline';
  el.title = on ? 'Online' : 'Offline mode — changes are saved locally.';
  if (!on) toast('Offline mode — changes are saved locally.');
}
window.addEventListener('online', netState);
window.addEventListener('offline', netState);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        w && w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Update ready — close and reopen the app');
        });
      });
    }).catch(function () {});
  });
}

netState();
loadProjects()
  .then(function () { return DB.get('meta', 'current'); })
  .then(function (m) {
    var id = m && m.value;
    if (id && S.projects.some(function (p) { return p.id === id; })) return loadProject(id);
    S.tab = 'projects';
  })
  .then(render)
  .catch(function () {
    $('#view').innerHTML = '<div class="card"><h2>Storage is blocked</h2><p class="small">This browser is not allowing local storage. Turn off private browsing or allow site data, then reload.</p></div>';
  });
})();
