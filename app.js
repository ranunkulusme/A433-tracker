// ─── CONSTANTS ───────────────────────────────────────────────
const COUPON_PER_PUZZLE = 500;
const PUZZLES_PER_LEVEL = 5;
const MAX_LEVEL = 180;

// ─── STATE ───────────────────────────────────────────────────
let state = {
  version: 3,
  officerCatalog: [],
  players: [],    // { id, name, officers: [{id, name, level, coupons}] }
  eventTypes: [], // { id, name, color, places: [{place, label, coupons}] }
  events: [],     // { id, typeId, dateFrom, dateTo, assignments: [{place, playerId, officerId, actualCoupons?}], note }
  stockHistory: [],
  currentRole: 'r5',
  currentPlayerId: null,
  nextId: 1,
};

// ─── STORAGE ─────────────────────────────────────────────────
function save() {
  try { localStorage.setItem('kow_v2', JSON.stringify(state)); } catch(e) {}
}
function load() {
  try {
    const raw = localStorage.getItem('kow_v2');
    if (raw) state = migrateState(JSON.parse(raw));
  } catch(e) {}
  if (!state.players.length && !state.eventTypes.length) seedDemo();
  state = migrateState(state);
  save();
}

function seedDemo() {
  state.eventTypes = [
    {
      id: state.nextId++, name: 'Король Войны', color: '#8b5cf6',
      places: [
        { place: 1, label: '🥇 1 место',  coupons: 12500 },
        { place: 2, label: '🥈 2 место',  coupons: 6500  },
        { place: 3, label: '🥉 3 место',  coupons: 3500  },
        { place: 4, label: '4–10 место',  coupons: 2750  },
      ]
    },
    {
      id: state.nextId++, name: 'Мощные Силы', color: '#06b6d4',
      places: [
        { place: 1, label: '🥇 1 место',  coupons: 12500 },
        { place: 2, label: '🥈 2 место',  coupons: 6500  },
        { place: 3, label: '🥉 3 место',  coupons: 3500  },
        { place: 4, label: '4–10 место',  coupons: 2750  },
      ]
    },
  ];
  state.players = [
    { id: state.nextId++, name: 'Командор',    officers: [{ id:'o1', name:'Адмирал Нейтон', level:8,  coupons:750  }, { id:'o2', name:'Генерал Рекс',   level:2, coupons:0    }] },
    { id: state.nextId++, name: 'Морской Волк',officers: [{ id:'o3', name:'Капитан Блэк',   level:3,  coupons:2200 }] },
    { id: state.nextId++, name: 'Шторм',       officers: [{ id:'o4', name:'Адмирал Нейтон', level:22, coupons:1500 }] },
    { id: state.nextId++, name: 'Флотоводец',  officers: [{ id:'o5', name:'Генерал Рекс',   level:1,  coupons:500  }, { id:'o6', name:'Капитан Блэк', level:0, coupons:0 }] },
    { id: state.nextId++, name: 'Навигатор',   officers: [{ id:'o7', name:'Адмирал Нейтон', level:35, coupons:0   }] },
  ];
  const kwId = state.eventTypes[0].id, msId = state.eventTypes[1].id;
  state.events = [
    {
      id: state.nextId++, typeId: kwId, dateFrom: '2025-06-02', dateTo: '2025-06-08', note: '',
      assignments: [
        { place:1, playerId:3, officerId:'o4' },
        { place:2, playerId:1, officerId:'o1' },
        { place:3, playerId:2, officerId:'o3' },
        { place:4, playerId:5, officerId:'o7' },
      ]
    },
    {
      id: state.nextId++, typeId: msId, dateFrom: '2025-06-09', dateTo: '2025-06-15', note: '',
      assignments: [
        { place:1, playerId:5, officerId:'o7' },
        { place:2, playerId:3, officerId:'o4' },
        { place:3, playerId:4, officerId:'o5' },
      ]
    },
    {
      id: state.nextId++, typeId: kwId, dateFrom: '2025-06-23', dateTo: '2025-06-29', note: 'Предстоящий',
      assignments: [
        { place:1, playerId:5, officerId:'o7' },
        { place:2, playerId:3, officerId:'o4' },
        { place:3, playerId:2, officerId:'o3' },
      ]
    },
  ];
  state = migrateState(state);
  save();
}

// ─── MATH ────────────────────────────────────────────────────
function totalPuzzles(o) { return o.level * PUZZLES_PER_LEVEL + Math.floor(o.coupons / COUPON_PER_PUZZLE); }
function pct(v, m) { return Math.min(100, Math.round(v / Math.max(1,m) * 100)); }
function fmtNum(value, digits=0) {
  return (Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u00a0/g, ' ');
}
function fmtOne(value) { return fmtNum(value, 1); }
function getPlayer(id) { return state.players.find(p => p.id === id); }
function getEventType(id) { return state.eventTypes.find(t => t.id === id); }
function getEvent(id) { return state.events.find(e => e.id === id); }
function getCatalogOfficer(id) { return state.officerCatalog.find(o => o.id === id); }
function officerLabel(officer) {
  const catalog = getCatalogOfficer(officer?.catalogId);
  return catalog?.name || officer?.name || '—';
}
function playerLink(player) {
  if (!player) return '—';
  return `<button class="text-link" onclick="event.stopPropagation();navigate('player_detail',{id:${player.id}})">${player.name}</button>`;
}
function officerLink(officer) {
  const catalog = getCatalogOfficer(officer?.catalogId);
  if (!catalog) return officerLabel(officer);
  return `<button class="text-link" onclick="event.stopPropagation();navigate('officer_detail',{id:'${catalog.id}'})">${catalog.name}</button>`;
}
function catalogOfficerLink(officer) {
  return `<button class="text-link" onclick="event.stopPropagation();navigate('officer_detail',{id:'${officer.id}'})">${officer.name}</button>`;
}
function canManage() { return state.currentRole === 'r4' || state.currentRole === 'r5'; }
function canSeeStock(playerId) { return canManage() || state.currentPlayerId === playerId; }
function placeInfo(eventType, place, eventDate=null) {
  if (!eventType) return null;
  const places = eventDate ? resolveEventPlaces(eventType, eventDate) : eventType.places;
  // places[last] covers everything from that place onward
  const found = places.find(p => p.place === place);
  if (found) return found;
  const last = [...places].sort((a,b) => a.place - b.place).findLast(p => p.place <= place);
  return last || places[places.length - 1];
}

function applyEvent(officer, couponAmount) {
  const catalog = getCatalogOfficer(officer.catalogId);
  if (Number(catalog?.couponPerPuzzle) === 0) return { level: officer.level, coupons: officer.coupons };
  const couponPerPuzzle = Number(catalog?.couponPerPuzzle) || COUPON_PER_PUZZLE;
  const newCoupons = officer.coupons + couponAmount;
  const totalPuz = officer.level * PUZZLES_PER_LEVEL + Math.floor(newCoupons / couponPerPuzzle);
  const newLevel = Math.min(Math.floor(totalPuz / PUZZLES_PER_LEVEL), MAX_LEVEL);
  const remainder = newCoupons % (couponPerPuzzle * PUZZLES_PER_LEVEL);
  return { level: newLevel, coupons: remainder };
}

// ─── UI HELPERS ──────────────────────────────────────────────
const TANK_ICON = `<svg class="badge-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block;vertical-align:-2px"><rect x="14" y="8" width="8" height="2" rx="0.5"/><path d="M7 11h8V9a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2z"/><path d="M4 14l1.5-3h13l1.5 3H4z"/><rect x="2" y="14" width="20" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="17" r="1.3"/><circle cx="10" cy="17" r="1.3"/><circle cx="14" cy="17" r="1.3"/><circle cx="18" cy="17" r="1.3"/></svg>`;

function troopBadge(type) {
  const map = {
    'Пехота': { cls: 'badge-troop-infantry', icon: '🪖' },
    'Танк': { cls: 'badge-troop-tank', icon: TANK_ICON },
    'ПТ': { cls: 'badge-troop-td', icon: '🎯' },
    'Гарнизон': { cls: 'badge-troop-garrison', icon: '🏰' },
    'Осада': { cls: 'badge-troop-siege', icon: '💥' },
  };
  const info = map[type];
  if (!info) return `<span class="badge badge-none">${type || '—'}</span>`;
  return `<span class="badge ${info.cls}">${info.icon} ${type}</span>`;
}

function evBadge(et) {
  if (!et) return `<span class="badge badge-none">—</span>`;
  return `<span class="badge" style="background:${et.color}22;color:${et.color};border:1px solid ${et.color}44">${et.name}</span>`;
}

function toast(msg, type='success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✕',info:'ℹ'}[type]||'✓'}</span><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>el.remove(), 3500);
}

function openModal(id) {
  document.getElementById('overlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}
function closeAllModals() {
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('sidebar')?.classList.remove('open');
  document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'));
}
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open', sb.classList.contains('open'));
}
function setCurrentRole(role) {
  state.currentRole = role;
  save();
  navigate(currentPage, pageParams);
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('ru',{day:'numeric',month:'short',year:'numeric'});
}
function formatDateShort(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('ru',{day:'numeric',month:'short'});
}
function isEventActive(ev) {
  const now = new Date(); now.setHours(0,0,0,0);
  const f = new Date(ev.dateFrom+'T00:00:00');
  const t = new Date(ev.dateTo+'T00:00:00');
  return now >= f && now <= t;
}
function isEventUpcoming(ev) {
  const now = new Date(); now.setHours(0,0,0,0);
  const f = new Date(ev.dateFrom+'T00:00:00');
  return f > now;
}
function isEventPast(ev) { return !isEventActive(ev) && !isEventUpcoming(ev); }

// ─── NAVIGATION ──────────────────────────────────────────────
let currentPage = 'calendar';
let pageParams = {};

function navigate(page, params={}) {
  currentPage = page; pageParams = params;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.page===page));
  const titles = { calendar:'Календарь ивентов', players:'Игроки', officers:'Офицеры', officer_detail:'Офицер', event_types:'Настройка ивентов', event_detail:'Ивент', player_detail:'Игрок', calculator:'Калькулятор и Аналитика' };
  document.getElementById('page-title').textContent = titles[page] || page;
  document.getElementById('role-switch').value = state.currentRole;
  document.getElementById('content').innerHTML = '';
  ({calendar:renderCalendar, players:renderPlayers, officers:renderOfficers, officer_detail:()=>renderOfficerDetail(params.id), event_types:renderEventTypes, event_detail:()=>renderEventDetail(params.id), player_detail:()=>renderPlayerDetail(params.id), calculator:renderCalculator})[page]?.();
  document.getElementById('sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',e=>{ e.preventDefault(); navigate(el.dataset.page); });
});

// ─── PAGE: CALENDAR ──────────────────────────────────────────
function renderCalendar() {
  const sorted = [...state.events].sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom));
  const active = sorted.filter(isEventActive);
  const upcoming = sorted.filter(isEventUpcoming);
  const past = sorted.filter(isEventPast);

  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Ивенты</div>
      ${canManage() ? `<button class="btn-primary" onclick="openEventModal()">+ Создать ивент</button>` : ''}
    </div>

    ${active.length ? `
    <div class="cal-section-label active-label">● Идут сейчас</div>
    <div class="cal-cards">${active.map(ev=>calCard(ev,'active')).join('')}</div>` : ''}

    ${upcoming.length ? `
    <div class="cal-section-label upcoming-label">◎ Предстоящие</div>
    <div class="cal-cards">${upcoming.map(ev=>calCard(ev,'upcoming')).join('')}</div>` : ''}

    ${past.length ? `
    <div class="cal-section-label past-label">◌ Прошедшие</div>
    <div class="cal-cards">${past.map(ev=>calCard(ev,'past')).join('')}</div>` : ''}

    ${!sorted.length ? `<div class="empty-state"><p>Ивентов нет. Создайте первый!</p></div>` : ''}
  `;
}

function calCard(ev, status) {
  const et = getEventType(ev.typeId);
  const color = et?.color || '#888';
  const assigned = ev.assignments.length;
  const totalPlaces = et ? et.places.length : 0;
  const statusLabels = { active:'● Идёт', upcoming:'◎ Скоро', past:'◌ Завершён' };
  const totalCoupons = ev.assignments.reduce((s,a)=>{
    const pi = placeInfo(et, a.place, ev.dateFrom);
    return s + (a.actualCoupons ?? pi?.coupons ?? 0);
  }, 0);

  // top 3 assigned players
  const top3 = ev.assignments.slice(0,3).map(a=>{
    const p = getPlayer(a.playerId);
    const pi = placeInfo(et, a.place, ev.dateFrom);
    return `<div class="cal-assign-row">
      <span class="cal-place">${pi?.label || `Место ${a.place}`}</span>
      <span class="cal-pname">${p ? playerLink(p) : '—'}</span>
      <span class="cal-pcoupons">${fmtNum(a.actualCoupons ?? pi?.coupons ?? 0)} купонов</span>
    </div>`;
  }).join('');

  return `<div class="cal-card" onclick="navigate('event_detail',{id:${ev.id}})" style="--ev-color:${color}">
    <div class="cal-card-header">
      <div>
        <div class="cal-card-name">${et?.name || '—'}</div>
        <div class="cal-card-dates">${formatDateShort(ev.dateFrom)} — ${formatDateShort(ev.dateTo)}</div>
      </div>
      <div style="text-align:right">
        <span class="cal-status ${status}">${statusLabels[status]}</span>
        <div class="cal-card-meta">${fmtNum(assigned)} назначений · ${fmtNum(totalCoupons)} купонов</div>
      </div>
    </div>
    ${top3 ? `<div class="cal-assigns">${top3}${ev.assignments.length > 3 ? `<div style="font-size:11px;color:var(--text3);padding:4px 0">+ ещё ${fmtNum(ev.assignments.length-3)} назначений</div>` : ''}</div>` : `<div class="slot-empty">Назначений нет</div>`}
    <div class="cal-card-footer">
      <span style="font-size:12px;color:var(--text3)">${ev.note || ''}</span>
      <div style="display:flex;gap:6px">
        ${canManage() ? `<button class="action-btn" onclick="event.stopPropagation();openEventModal(${ev.id})">✏️</button><button class="action-btn danger" onclick="event.stopPropagation();confirmDeleteEvent(${ev.id})">🗑</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ─── PAGE: EVENT DETAIL ──────────────────────────────────────
function renderEventDetail(eventId) {
  const ev = getEvent(eventId);
  if (!ev) { navigate('calendar'); return; }
  const et = getEventType(ev.typeId);
  const color = et?.color || '#888';
  const status = isEventActive(ev)?'active':isEventUpcoming(ev)?'upcoming':'past';
  const statusLabels = { active:'● Идёт сейчас', upcoming:'◎ Предстоящий', past:'◌ Завершён' };

  const assignMap = {};
  ev.assignments.forEach(a => assignMap[a.place] = a);

  // Build full place table from eventType places
  const maxPlace = Math.max(...(et?.places||[]).map(p=>p.place), ...ev.assignments.map(a=>a.place), 0);
  const rows = [];
  const seen = new Set();
  // All assignments
  const allPlaces = [...new Set([
    ...(et?.places||[]).map(p=>p.place),
    ...ev.assignments.map(a=>a.place)
  ])].sort((a,b)=>a-b);

  for (const pl of allPlaces) {
    const a = assignMap[pl];
    const pi = placeInfo(et, pl, ev.dateFrom);
    const p = a ? getPlayer(a.playerId) : null;
    const officer = a && p ? p.officers.find(o=>o.id===a.officerId) : null;
    const coupons = a?.actualCoupons ?? pi?.coupons ?? 0;
    const isConfirmed = a?.actualCoupons !== undefined;
    const r3Submit = state.currentRole === 'r3' && state.currentPlayerId && canR3SubmitResult({ event: ev, place: pl, nowIso: new Date().toISOString(), players: state.players });
    rows.push(`<tr>
      <td><strong style="font-size:15px">${pi?.label || `Место ${pl}`}</strong></td>
      <td><strong>${p ? playerLink(p) : '<span style="color:var(--text3)">Не назначен</span>'}</strong>${r3Submit ? ` <button class="action-btn" onclick="submitR3Result(${ev.id},${pl})">Это моё место</button>` : ''}</td>
      <td style="color:var(--text2)">${officer ? officerLink(officer) : '—'}</td>
      <td style="color:var(--text2)">Ур. ${officer?.level ?? '—'}</td>
      <td style="font-family:var(--mono);color:${isConfirmed?'var(--green)':'var(--text2)'};font-weight:600">
        ${fmtNum(coupons)}${isConfirmed?' ✓':''}
      </td>
    </tr>`);
  }

  const totalCoupons = ev.assignments.reduce((s,a)=>{
    const pi = placeInfo(et,a.place, ev.dateFrom);
    return s + (a.actualCoupons ?? pi?.coupons ?? 0);
  },0);

  const c = document.getElementById('content');
  c.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('calendar')">← Календарь</button>
    </div>

    <div class="event-detail-header" style="--ev-color:${color}">
      <div class="edh-left">
        <div class="edh-name">${et?.name || '—'}</div>
        <div class="edh-dates">📅 ${formatDate(ev.dateFrom)} — ${formatDate(ev.dateTo)}</div>
        ${ev.note ? `<div class="edh-note">${ev.note}</div>` : ''}
      </div>
      <div class="edh-right">
        <span class="cal-status ${status}">${statusLabels[status]}</span>
        <div class="edh-stat">${fmtNum(ev.assignments.length)} назначений</div>
        <div class="edh-stat">Итого купонов: <strong>${fmtNum(totalCoupons)}</strong></div>
      </div>
    </div>

    <div class="section-header" style="margin-top:24px">
      <div class="section-title">Таблица мест и назначений</div>
      <div style="display:flex;gap:8px">
        ${canManage() && isEventPast(ev) && !ev.accrued ? `<button class="btn-primary btn-sm" onclick="accrueEventRewards(${ev.id})">Начислить награды</button>` : ''}
        ${ev.accrued ? `<span class="badge badge-none">Начислено</span>` : ''}
        ${canManage() ? `<button class="btn-primary btn-sm" onclick="openEventModal(${ev.id})">✏️ Редактировать ивент</button>` : ''}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Место</th>
            <th>Игрок</th>
            <th>Офицер</th>
            <th>Уровень</th>
            <th>Купонов</th>
          </tr>
        </thead>
        <tbody>${rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">Назначений нет</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-header">
      <div class="section-title">Купоны по офицерам</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Офицер</th><th>Уровень до</th><th>Купонов</th><th>Пазлов</th><th>Уровень после</th></tr></thead>
        <tbody>
          ${ev.assignments.map(a=>{
            const p = getPlayer(a.playerId);
            const o = p?.officers.find(x=>x.id===a.officerId);
            const pi = placeInfo(et, a.place, ev.dateFrom);
            const coupons = a.actualCoupons ?? pi?.coupons ?? 0;
            if (!o) return '';
            const after = applyEvent(o, coupons);
            const gained = after.level - o.level;
            return `<tr>
              <td><strong>${p ? playerLink(p) : '—'}</strong></td>
              <td style="color:var(--text2)">${officerLink(o)}</td>
              <td style="font-family:var(--mono)">${fmtNum(o.level)}</td>
              <td style="font-family:var(--mono);color:var(--green)">+${fmtNum(coupons)}</td>
              <td style="font-family:var(--mono);color:var(--text2)">+${fmtNum(Math.floor(coupons/COUPON_PER_PUZZLE))}</td>
              <td style="font-family:var(--mono);font-weight:600">
                ${fmtNum(after.level)}${gained>0?` <span style="color:var(--green)">(+${fmtNum(gained)})</span>`:''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── PAGE: PLAYERS ───────────────────────────────────────────
function renderPlayers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Игроки (${state.players.length})</div>
      ${canManage() ? `<button class="btn-primary" onclick="openPlayerModal()">+ Добавить игрока</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Ранг</th><th>Сектор</th><th>Офицеры</th><th>Запасы</th><th></th></tr></thead>
        <tbody>
          ${!state.players.length ? `<tr><td colspan="6" class="empty-state"><p>Нет игроков</p></td></tr>` : ''}
          ${state.players.map(p=>{
            const rewards = dailyRewards(p.sector);
            const stock = canSeeStock(p.id) ? `${fmtNum(p.stock.coupons)} куп. · ${fmtNum(p.stock.puzzles)} пазл. · ${fmtNum(p.stock.chests)} сун.` : 'Скрыто';
            return `<tr>
              <td>
                <strong>${playerLink(p)}</strong>
                ${p.realName ? `<div style="color:var(--text3);font-size:12px">${p.realName}</div>` : ''}
              </td>
              <td><span class="badge badge-none">${p.rank}</span></td>
              <td style="color:var(--text2);font-size:12px">VIP ${fmtNum(p.sector.vipLevel)} · Конф. ${fmtNum(p.sector.confidentialityLevel)}<br>Сила ${fmtNum(p.sector.power)} · убийств ${fmtNum(p.sector.kills)} · очки ${fmtOne(p.sector.killPoints)}<br>+${fmtNum(rewards.puzzlesPerDay, 2)} пазл./день</td>
              <td>
                <div style="display:flex;flex-direction:column;gap:4px">
                  ${p.officers.map(o=>`
                    <div style="display:flex;align-items:center;gap:8px">
                      <span style="color:var(--text2);font-size:12px">${officerLink(o)}</span>
                      <span class="badge badge-none" style="font-size:10px">Ур. ${fmtNum(o.level)}</span>
                      <span style="font-size:11px;color:var(--text3)">${fmtNum(o.coupons)} купонов</span>
                      ${renderStars(o.stars)}
                    </div>`).join('')}
                </div>
              </td>
              <td style="font-family:var(--mono);font-size:12px">${stock}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${canManage() || state.currentPlayerId === p.id ? `<button class="action-btn" onclick="openPlayerModal(${p.id})">✏️</button>` : ''}
                  ${canManage() ? `<button class="action-btn danger" onclick="confirmDeletePlayer(${p.id})">🗑</button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStars(count=0) {
  return `<span class="stars">${Array.from({length:6},(_,i)=>{
    const star = i + 1;
    const cost = starCostFor(star);
    return `<span class="star-readonly ${count>=star?'active':''}" title="${star < 6 ? `${fmtNum(cost)} звезд до ${star}★` : `Итого ${fmtNum(cost)} звезд`}">${count>=star?'★':'☆'}</span>`;
  }).join('')}</span>`;
}

function renderPlayerDetail(playerId) {
  const p = getPlayer(playerId);
  if (!p) { navigate('players'); return; }
  const rewards = dailyRewards(p.sector);
  const history = state.stockHistory.filter(h=>h.playerId===p.id).slice(-8).reverse();
  const stockVisible = canSeeStock(p.id);
  const c = document.getElementById('content');
  c.innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('players')">← Игроки</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${p.name} ${p.realName ? `<span style="color:var(--text3)">· ${p.realName}</span>` : ''} <span class="player-meta-pill">VIP ${fmtNum(p.sector.vipLevel)}</span> <span class="player-meta-pill">Конф. ${fmtNum(p.sector.confidentialityLevel)}</span> <span class="player-meta-pill">Сила ${fmtNum(p.sector.power)}</span></div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">Ранг ${p.rank} · убито ${fmtNum(p.sector.kills)} · очки за убийство ${fmtOne(p.sector.killPoints)}</div>
      </div>
      ${canManage() || state.currentPlayerId === p.id ? `<button class="btn-primary btn-sm" onclick="openPlayerModal(${p.id})">Редактировать</button>` : ''}
    </div>
    ${stockVisible ? `
      <div class="stock-grid">
        <div class="stock-card"><div class="label">Купоны</div><div class="value">${fmtNum(p.stock.coupons)}</div></div>
        <div class="stock-card"><div class="label">Пазлы</div><div class="value">${fmtNum(p.stock.puzzles)}</div></div>
        <div class="stock-card"><div class="label">Сундуки</div><div class="value">${fmtNum(p.stock.chests)}</div></div>
        <div class="stock-card"><div class="label">Ежедневно</div><div class="value">+${fmtNum(rewards.puzzlesPerDay, 2)}</div></div>
      </div>
      <div class="section-header"><div class="section-title">Корректировка запасов</div></div>
      <div class="form-row form-row-3" style="margin-bottom:12px">
        <input type="number" id="stock-coupons" placeholder="Купоны" value="${p.stock.coupons}">
        <input type="number" id="stock-puzzles" placeholder="Пазлы" value="${p.stock.puzzles}">
        <input type="number" id="stock-chests" placeholder="Сундуки" value="${p.stock.chests}">
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <button class="btn-primary btn-sm" onclick="saveStockCorrection(${p.id})">Сохранить запасы</button>
        <button class="btn-ghost btn-sm" onclick="rollbackLastStock(${p.id})">Откатить последнюю</button>
      </div>` : `<div class="empty-state"><p>Запасы скрыты для роли ${state.currentRole}</p></div>`}
    <div class="section-header"><div class="section-title">Офицеры и прогноз</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Офицер</th><th>Тип</th><th>Поколение</th><th>Уровень</th><th>Звезды</th><th>До максимума</th><th>Сценарии</th></tr></thead>
        <tbody>${p.officers.map(o=>{
          const cat = getCatalogOfficer(o.catalogId);
          const forecast = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, events:state.events, eventTypes:state.eventTypes });
          const variants = forecastOfficerVariants({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, eventType:state.eventTypes[0]||{} });
          return `<tr><td><strong>${officerLink(o)}</strong></td><td>${cat ? troopBadge(cat.type) : '—'}</td><td>${cat ? fmtNum(cat.generation) : '—'}</td><td>${fmtNum(o.level)}</td><td>${renderStars(o.stars)}</td><td>${forecast.date || 'за пределами прогноза'}</td><td style="font-size:12px;color:var(--text2)">1: ${variants.top1.date||'—'} · 2: ${variants.top2.date||'—'} · 3: ${variants.top3.date||'—'} · 4-10: ${variants.top4to10.date||'—'}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <div class="section-header"><div class="section-title">История корректировок</div></div>
    <div class="table-wrap">
      <table><thead><tr><th>Дата</th><th>Было</th><th>Стало</th></tr></thead><tbody>
        ${history.map(h=>`<tr><td>${formatDate(h.date.slice(0,10))}</td><td>${fmtNum(h.before.coupons)}/${fmtNum(h.before.puzzles)}/${fmtNum(h.before.chests)}</td><td>${fmtNum(h.after.coupons)}/${fmtNum(h.after.puzzles)}/${fmtNum(h.after.chests)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">Нет корректировок</td></tr>'}
      </tbody></table>
    </div>
  `;
}

function saveStockCorrection(playerId) {
  const p = getPlayer(playerId);
  const before = {...p.stock};
  const after = {
    coupons: Math.max(0,parseInt(document.getElementById('stock-coupons').value)||0),
    puzzles: Math.max(0,parseInt(document.getElementById('stock-puzzles').value)||0),
    chests: Math.max(0,parseInt(document.getElementById('stock-chests').value)||0),
  };
  p.stock = after;
  state.stockHistory.push({ id:state.nextId++, playerId, date:new Date().toISOString(), before, after });
  save(); toast('Запасы обновлены'); renderPlayerDetail(playerId);
}

function rollbackLastStock(playerId) {
  const idx = state.stockHistory.map((h,i)=>h.playerId===playerId?i:-1).filter(i=>i>=0).pop();
  if (idx === undefined) { toast('Нет корректировок','error'); return; }
  const h = state.stockHistory[idx];
  getPlayer(playerId).stock = h.before;
  state.stockHistory.splice(idx,1);
  save(); toast('Откат выполнен','info'); renderPlayerDetail(playerId);
}

// ─── PAGE: OFFICERS ──────────────────────────────────────────
function renderOfficers() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Базовые офицеры (${state.officerCatalog.length})</div>
      ${canManage() ? `<button class="btn-primary" onclick="openOfficerCatalogModal()">+ Добавить офицера</button>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Имя</th><th>Тип</th><th>Поколение</th><th>Купонов за пазл</th><th>Медали</th><th></th></tr></thead>
        <tbody>${state.officerCatalog.map(o=>`<tr>
          <td><strong>${catalogOfficerLink(o)}</strong></td>
          <td>${troopBadge(o.type)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.generation)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.couponPerPuzzle)}</td>
          <td style="font-family:var(--mono)">${fmtNum(o.medalsBeforeTraining)}+${fmtNum(o.medalsTraining)}=${fmtNum(o.medalsTotal)}</td>
          <td>
            <div style="display:flex;gap:4px">
              ${canManage()?`<button class="action-btn" onclick="openOfficerCatalogModal('${o.id}')">✏️</button><button class="action-btn danger" onclick="confirmDeleteOfficerCatalog('${o.id}')">🗑</button>`:''}
            </div>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderOfficerDetail(catalogId) {
  const officer = getCatalogOfficer(catalogId);
  if (!officer) { navigate('officers'); return; }
  const users = officerUsage(catalogId, state.players);
  const eventRows = [];
  state.events.forEach(ev => {
    const et = getEventType(ev.typeId);
    ev.assignments.forEach(a => {
      const p = getPlayer(a.playerId);
      const po = p?.officers.find(o=>o.id===a.officerId && o.catalogId===catalogId);
      if (!p || !po) return;
      const pi = placeInfo(et, a.place, ev.dateFrom);
      eventRows.push({ ev, et, p, po, pi, coupons:a.actualCoupons ?? pi?.coupons ?? 0 });
    });
  });

  document.getElementById('content').innerHTML = `
    <div style="margin-bottom:20px">
      <button class="btn-ghost btn-sm" onclick="navigate('officers')">← Офицеры</button>
    </div>
    <div class="section-header">
      <div>
        <div class="section-title">${officer.name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          ${troopBadge(officer.type)}
          <span style="color:var(--text3);font-size:12px">поколение ${fmtNum(officer.generation)} · ${officer.couponPerPuzzle === 0 ? 'только пазлы' : `${fmtNum(officer.couponPerPuzzle)} купонов за пазл`}</span>
        </div>
      </div>
      ${canManage()?`<div style="display:flex;gap:8px"><button class="btn-primary btn-sm" onclick="openOfficerCatalogModal('${officer.id}')">Редактировать</button><button class="btn-danger btn-sm" onclick="confirmDeleteOfficerCatalog('${officer.id}')">Удалить</button></div>`:''}
    </div>
    <div class="stock-grid">
      <div class="stock-card"><div class="label">Медали до подготовки</div><div class="value">${fmtNum(officer.medalsBeforeTraining)}</div></div>
      <div class="stock-card"><div class="label">Медали подготовки</div><div class="value">${fmtNum(officer.medalsTraining)}</div></div>
      <div class="stock-card"><div class="label">Всего медалей</div><div class="value">${fmtNum(officer.medalsTotal)}</div></div>
    </div>

    <div class="section-header"><div class="section-title">Игроки, которые качают офицера</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Игрок</th><th>Уровень</th><th>Купоны</th><th>Звезды</th><th>Запасы</th><th>Прогноз</th></tr></thead>
        <tbody>${users.flatMap(p=>p.officers.filter(o=>o.catalogId===catalogId).map(o=>{
          const f = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog });
          return `<tr><td><strong>${playerLink(p)}</strong></td><td>${fmtNum(o.level)}</td><td>${fmtNum(o.coupons)}</td><td>${renderStars(o.stars)}</td><td>${canSeeStock(p.id)?`${fmtNum(p.stock.coupons)}/${fmtNum(p.stock.puzzles)}/${fmtNum(p.stock.chests)}`:'Скрыто'}</td><td>${f.date || 'за пределами прогноза'}</td></tr>`;
        })).join('') || '<tr><td colspan="6" class="empty-state">Никто не качает этого офицера</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section-header"><div class="section-title">История участия в ивентах</div></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Ивент</th><th>Даты</th><th>Место</th><th>Игрок</th><th>Купоны</th><th>Статус</th></tr></thead>
        <tbody>${eventRows.map(row=>`<tr><td>${row.et?.name||'—'}</td><td>${formatDateShort(row.ev.dateFrom)} — ${formatDateShort(row.ev.dateTo)}</td><td>${row.pi?.label||row.pi?.place||'—'}</td><td>${playerLink(row.p)}</td><td>${fmtNum(row.coupons)}</td><td>${row.ev.accrued?'Начислено':'Не начислено'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Ивентов нет</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ─── PAGE: CALCULATOR ────────────────────────────────────────
let calcActiveTab = 'personal';
let calcPlayerId = null;
let calcOfficerId = null;
let calcTargetLevel = 180;
let calcPlanned = { top1: 0, top2: 0, top3: 0, top4: 0 };
let matrixFilterType = 'all';
let matrixFilterGen = 'all';
let matrixSearch = '';
let matrixSortCol = 'deficit';
let matrixSortDir = 'asc';

function setCalcTab(tab) {
  calcActiveTab = tab;
  renderCalculator();
}

function setMatrixSearch(query) {
  matrixSearch = (query || '').toLowerCase().trim();
  renderCalculator();
}

function setMatrixSort(col) {
  if (matrixSortCol === col) {
    matrixSortDir = matrixSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    matrixSortCol = col;
    matrixSortDir = 'asc';
  }
  renderCalculator();
}

function setCalcPlayer(id) {
  calcPlayerId = id ? parseInt(id) : null;
  const p = getPlayer(calcPlayerId);
  calcOfficerId = p?.officers?.[0]?.id || null;
  renderCalculator();
}

function setCalcOfficer(id) {
  calcOfficerId = id;
  renderCalculator();
}

function setCalcTargetLevel(lvl) {
  calcTargetLevel = Math.max(1, Math.min(MAX_LEVEL, parseInt(lvl) || MAX_LEVEL));
  renderCalculator();
}

function changeCalcPlanned(tier, delta) {
  calcPlanned[tier] = Math.max(0, (calcPlanned[tier] || 0) + delta);
  renderCalculator();
}

function resetCalcPlanned() {
  calcPlanned = { top1: 0, top2: 0, top3: 0, top4: 0 };
  renderCalculator();
}

function setMatrixFilterType(type) {
  matrixFilterType = type;
  renderCalculator();
}

function setMatrixFilterGen(gen) {
  matrixFilterGen = gen;
  renderCalculator();
}

function renderCalculator() {
  if (!calcPlayerId && state.players.length) {
    calcPlayerId = state.players[0].id;
  }
  const player = getPlayer(calcPlayerId);
  if (!calcOfficerId && player?.officers?.length) {
    calcOfficerId = player.officers[0].id;
  }

  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="subnav">
      <button class="subnav-btn ${calcActiveTab==='personal'?'active':''}" onclick="setCalcTab('personal')">🎯 Персональный симулятор</button>
      <button class="subnav-btn ${calcActiveTab==='matrix'?'active':''}" onclick="setCalcTab('matrix')">📊 Сводная матрица гильдии</button>
    </div>
    ${calcActiveTab === 'personal' ? renderPersonalSimulator() : renderGuildMatrix()}
  `;
}

function renderPersonalSimulator() {
  const player = getPlayer(calcPlayerId);
  if (!player) return `<div class="empty-state"><p>Нет игроков для расчета</p></div>`;
  const officer = player.officers.find(o => o.id === calcOfficerId) || player.officers[0];
  const cat = officer ? getCatalogOfficer(officer.catalogId) : null;

  if (!officer || !cat) {
    return `
      <div class="form-row" style="margin-bottom:20px">
        <div class="form-group">
          <label>Игрок</label>
          <select onchange="setCalcPlayer(this.value)">
            ${state.players.map(p => `<option value="${p.id}" ${p.id===calcPlayerId?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="empty-state"><p>У игрока нет офицеров</p></div>
    `;
  }

  const today = new Date().toISOString().slice(0, 10);
  const def = calculateOfficerDeficit({
    officer,
    catalogItem: cat,
    player,
    targetLevel: calcTargetLevel,
    today,
  });

  const et = state.eventTypes[0];
  const resolvedPlaces = et ? resolveEventPlaces(et, today) : [];
  const top1Coupons = resolvedPlaces.find(p => p.place === 1)?.coupons || 12500;
  const top2Coupons = resolvedPlaces.find(p => p.place === 2)?.coupons || 6500;
  const top3Coupons = resolvedPlaces.find(p => p.place === 3)?.coupons || 3500;
  const top4Coupons = resolvedPlaces.find(p => p.place >= 4)?.coupons || 2750;

  const sim = simulateEventProgress({
    deficitPuzzles: def.deficitPuzzles,
    costPerPuzzle: def.costPerPuzzle,
    dailyIncome: def.dailyIncome,
    plannedEvents: [
      { coupons: top1Coupons, count: calcPlanned.top1 },
      { coupons: top2Coupons, count: calcPlanned.top2 },
      { coupons: top3Coupons, count: calcPlanned.top3 },
      { coupons: top4Coupons, count: calcPlanned.top4 },
    ],
    today,
  });

  const targetPuz = calcTargetLevel * PUZZLES_PER_LEVEL;
  const currentPuzTotal = def.currentPuzzles + def.stockPuzzles;
  const progressPct = Math.min(100, Math.round((currentPuzTotal / Math.max(1, targetPuz)) * 100));
  const simProgressPct = Math.min(100, Math.round(((currentPuzTotal + sim.puzzlesFromEvents) / Math.max(1, targetPuz)) * 100));

  return `
    <div class="sim-box" style="margin-bottom:20px">
      <div class="form-row form-row-3" style="margin-bottom:16px">
        <div class="form-group">
          <label>Игрок</label>
          <select onchange="setCalcPlayer(this.value)">
            ${state.players.map(p => `<option value="${p.id}" ${p.id===calcPlayerId?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Офицер</label>
          <select onchange="setCalcOfficer(this.value)">
            ${player.officers.map(o => `<option value="${o.id}" ${o.id===officer.id?'selected':''}>${officerLabel(o)} (ур. ${o.level})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Целевой уровень подготовки</label>
          <div style="display:flex;gap:6px">
            <input type="number" min="1" max="180" value="${calcTargetLevel}" onchange="setCalcTargetLevel(this.value)" style="width:80px">
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(60)">60</button>
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(120)">120</button>
            <button class="btn-ghost btn-sm" onclick="setCalcTargetLevel(180)">180</button>
          </div>
        </div>
      </div>

      <div class="stock-grid" style="margin-bottom:16px">
        <div class="stock-card">
          <div class="label">Текущий уровень</div>
          <div class="value" style="display:flex;align-items:center;gap:8px">
            <span>Ур. ${fmtNum(officer.level)} <span style="font-size:12px;color:var(--text3)">/ ${calcTargetLevel}</span></span>
            ${troopBadge(cat.type)}
          </div>
          <div style="margin-top:4px">${renderStars(officer.stars)}</div>
          <div style="font-size:11px;color:${def.starRequirement.isStarReady?'var(--green)':'var(--amber)'};margin-top:4px">
            ${def.starRequirement.isStarReady ? '★ Готов к максимальной подготовке' : '☆ Для 180 уровня требуется 6★'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Дефицит до цели</div>
          <div class="value">${fmtNum(def.deficitPuzzles)} <span style="font-size:12px;color:var(--text3)">пазлов</span></div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            ${def.costPerPuzzle > 0 ? `${fmtNum(def.deficitCoupons)} купонов` : 'Только пазлы'}
          </div>
        </div>
        <div class="stock-card">
          <div class="label">Ежедневный доход</div>
          <div class="value">+${fmtNum(def.dailyIncome, 2)} <span style="font-size:12px;color:var(--text3)">пазл/день</span></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">VIP ${player.sector.vipLevel} · Конф. ${player.sector.confidentialityLevel} · 1 сундук/день</div>
        </div>
        <div class="stock-card">
          <div class="label">Без ивентов</div>
          <div class="value" style="font-size:16px">${def.dateWithoutEvents || '—'}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:4px">
            ${def.daysWithoutEvents !== null ? `${fmtNum(def.daysWithoutEvents)} дней` : 'Недостижимо'}
          </div>
        </div>
      </div>

      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
          <span>Текущий прогресс подготовки</span>
          <span>${progressPct}%</span>
        </div>
        <div class="progress-container">
          <div class="progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
    </div>

    <div class="sim-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <strong style="font-size:15px">Симулятор участия в будущих ивентах</strong>
          <div style="font-size:12px;color:var(--text3)">Задайте планируемые призовые места для проверки ускорения прокачки</div>
        </div>
        <button class="btn-ghost btn-sm" onclick="resetCalcPlanned()">Сбросить симуляцию</button>
      </div>

      <div class="sim-counter-grid">
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥇 1 место</span>
            <span class="sim-counter-desc">+${fmtNum(top1Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top1', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top1}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top1', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥈 2 место</span>
            <span class="sim-counter-desc">+${fmtNum(top2Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top2', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top2}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top2', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">🥉 3 место</span>
            <span class="sim-counter-desc">+${fmtNum(top3Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top3', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top3}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top3', 1)">+</button>
          </div>
        </div>
        <div class="sim-counter-card">
          <div class="sim-counter-info">
            <span class="sim-counter-title">4–10 место</span>
            <span class="sim-counter-desc">+${fmtNum(top4Coupons)} купонов</span>
          </div>
          <div class="sim-counter-ctrl">
            <button class="sim-step-btn" onclick="changeCalcPlanned('top4', -1)">−</button>
            <span class="sim-counter-val">${calcPlanned.top4}</span>
            <button class="sim-step-btn" onclick="changeCalcPlanned('top4', 1)">+</button>
          </div>
        </div>
      </div>

      <div class="sim-result-banner">
        <div>
          <div class="sim-result-title">
            Прогноз с ивентами: <strong>${sim.simulatedDate || def.dateWithoutEvents || '—'}</strong>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">
            Остаток после ивентов: <strong>${fmtNum(sim.remainingDeficitPuzzles)}</strong> пазлов (${def.costPerPuzzle > 0 ? fmtNum(sim.remainingDeficitCoupons) + ' куп.' : 'только пазлы'})
          </div>
        </div>
        <div>
          ${sim.savedDays > 0 ? `<span class="sim-result-badge">⚡ Экономия: −${fmtNum(sim.savedDays)} дней (+${fmtNum(sim.puzzlesFromEvents)} пазл.)</span>` : `<span style="font-size:12px;color:var(--text3)">Призовые места не выбраны</span>`}
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
          <span>Прогресс с учетом симулированных наград</span>
          <span>${simProgressPct}%</span>
        </div>
        <div class="progress-container">
          <div class="progress-fill green" style="width:${simProgressPct}%"></div>
        </div>
      </div>
    </div>
  `;
}

function renderGuildMatrix() {
  const rows = [];
  const types = ['all', ...OFFICER_TYPES];
  const gens = ['all', ...Array.from(new Set(state.officerCatalog.map(c => String(c.generation)).filter(Boolean))).sort((a,b)=>Number(a)-Number(b))];

  state.players.forEach(p => {
    p.officers.forEach(o => {
      const cat = getCatalogOfficer(o.catalogId);
      if (!cat) return;
      if (matrixFilterType !== 'all' && cat.type !== matrixFilterType) return;
      if (matrixFilterGen !== 'all' && String(cat.generation) !== matrixFilterGen) return;

      if (matrixSearch) {
        const pName = (p.name || '').toLowerCase();
        const oName = (o.name || cat.name || '').toLowerCase();
        if (!pName.includes(matrixSearch) && !oName.includes(matrixSearch)) return;
      }

      const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player: p, targetLevel: MAX_LEVEL, includeStock: false });
      let recBadge = '<span class="badge badge-none">4–10 место</span>';
      if (def.deficitPuzzles === 0) recBadge = '<span class="badge badge-success">Максимум ✓</span>';
      else if (def.costPerPuzzle === 0) recBadge = '<span class="badge badge-none">Только пазлы</span>';
      else if (def.deficitCoupons >= 12500) recBadge = '<span class="badge" style="background:#f59e0b22;color:#d97706">🥇 1 место</span>';
      else if (def.deficitCoupons >= 6500) recBadge = '<span class="badge" style="background:#64748b22;color:#94a3b8">🥈 2 место</span>';
      else if (def.deficitCoupons >= 3500) recBadge = '<span class="badge" style="background:#b4530922;color:#d97706">🥉 3 место</span>';

      rows.push({
        player: p,
        officer: o,
        catalog: cat,
        def,
        recBadge,
      });
    });
  });

  rows.sort((a, b) => {
    let diff = 0;
    if (matrixSortCol === 'player') {
      diff = a.player.name.localeCompare(b.player.name);
    } else if (matrixSortCol === 'officer') {
      diff = (a.catalog.name || '').localeCompare(b.catalog.name || '');
    } else if (matrixSortCol === 'type') {
      diff = (a.catalog.type || '').localeCompare(b.catalog.type || '');
    } else if (matrixSortCol === 'generation') {
      diff = (Number(a.catalog.generation) || 0) - (Number(b.catalog.generation) || 0);
    } else if (matrixSortCol === 'level') {
      diff = (Number(a.officer.level) || 0) - (Number(b.officer.level) || 0);
    } else if (matrixSortCol === 'days') {
      const da = a.def.daysWithoutEvents !== null ? a.def.daysWithoutEvents : 999999;
      const db = b.def.daysWithoutEvents !== null ? b.def.daysWithoutEvents : 999999;
      diff = da - db;
    } else { // default 'deficit'
      diff = a.def.deficitPuzzles - b.def.deficitPuzzles;
    }
    return matrixSortDir === 'asc' ? diff : -diff;
  });

  function sortHeader(col, label) {
    const active = matrixSortCol === col;
    const arrow = active ? (matrixSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="sortable" onclick="setMatrixSort('${col}')">${label}<span class="sort-arrow">${arrow}</span></th>`;
  }

  return `
    <div class="section-header">
      <div class="section-title">Сводная матрица готовности офицеров (${rows.length})</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" placeholder="🔍 Поиск по игроку или офицеру..." value="${matrixSearch}" oninput="setMatrixSearch(this.value)" style="width:230px;padding:5px 9px;font-size:12px">
        <label style="font-size:12px;color:var(--text3)">Род войск:</label>
        <select style="width:130px;padding:4px 8px;font-size:12px" onchange="setMatrixFilterType(this.value)">
          ${types.map(t => `<option value="${t}" ${t===matrixFilterType?'selected':''}>${t==='all'?'Все войска':t}</option>`).join('')}
        </select>
        <label style="font-size:12px;color:var(--text3)">Поколение:</label>
        <select style="width:100px;padding:4px 8px;font-size:12px" onchange="setMatrixFilterGen(this.value)">
          ${gens.map(g => `<option value="${g}" ${g===matrixFilterGen?'selected':''}>${g==='all'?'Все':`Gen ${g}`}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${sortHeader('player', 'Игрок')}
            ${sortHeader('officer', 'Офицер')}
            ${sortHeader('type', 'Род войск')}
            ${sortHeader('generation', 'Поколение')}
            ${sortHeader('level', 'Уровень')}
            <th>Звёзды</th>
            ${sortHeader('deficit', 'Дефицит до 180')}
            <th>Склад</th>
            ${sortHeader('days', 'Без ивентов')}
            <th>Рекомендация</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${playerLink(r.player)}</strong></td>
              <td><strong>${officerLink(r.officer)}</strong></td>
              <td>${troopBadge(r.catalog.type)}</td>
              <td style="font-family:var(--mono)">${r.catalog.generation}</td>
              <td style="font-family:var(--mono)">Ур. ${fmtNum(r.officer.level)}</td>
              <td>${renderStars(r.officer.stars)}</td>
              <td style="font-family:var(--mono)">
                ${fmtNum(r.def.deficitPuzzles)} пазл.
                <div style="font-size:11px;color:var(--text3)">${r.def.costPerPuzzle > 0 ? `${fmtNum(r.def.deficitCoupons)} куп.` : 'только пазлы'}</div>
              </td>
              <td style="font-family:var(--mono);font-size:12px">
                ${canSeeStock(r.player.id) ? `${fmtNum(r.player.stock.coupons)} куп. / ${fmtNum(r.player.stock.puzzles)} пазл.` : 'Скрыто'}
              </td>
              <td style="font-size:12px">
                ${r.def.dateWithoutEvents || '—'}
                <div style="font-size:11px;color:var(--text3)">${r.def.daysWithoutEvents !== null ? `${fmtNum(r.def.daysWithoutEvents)} дн.` : '—'}</div>
              </td>
              <td>${r.recBadge}</td>
              <td>
                <button class="action-btn" onclick="setCalcPlayer(${r.player.id});setCalcOfficer('${r.officer.id}');setCalcTab('personal')" title="Открыть симулятор">🎯</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="11" class="empty-state">Нет офицеров по выбранным фильтрам</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

// ─── PAGE: EVENT TYPES ────────────────────────────────────────
function renderEventTypes() {
  const c = document.getElementById('content');
  c.innerHTML = `
    <div class="section-header">
      <div class="section-title">Типы ивентов</div>
      ${canManage() ? `<button class="btn-primary" onclick="openEventTypeModal()">+ Добавить тип</button>` : ''}
    </div>
    <div id="et-list">
      ${state.eventTypes.map(et=>renderEventTypeCard(et)).join('')}
    </div>
    ${!state.eventTypes.length ? `<div class="empty-state"><p>Нет типов ивентов</p></div>` : ''}
  `;
}

function renderEventTypeCard(et) {
  return `<div class="et-card" style="--ev-color:${et.color}">
    <div class="et-card-header">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="et-dot" style="background:${et.color}"></span>
        <strong>${et.name}</strong>
      </div>
      <div style="display:flex;gap:6px">
        ${canManage() ? `<button class="action-btn" onclick="openEventTypeModal(${et.id})">✏️ Редактировать</button><button class="action-btn danger" onclick="confirmDeleteEventType(${et.id})">🗑</button>` : ''}
      </div>
    </div>
    <table style="margin:0;font-size:13px">
      <thead><tr><th>Место</th><th>Название</th><th>Купонов</th><th>Пазлов</th></tr></thead>
      <tbody>
        ${et.places.map(pl=>`<tr>
          <td style="font-family:var(--mono)">${fmtNum(pl.place)}</td>
          <td>${pl.label}</td>
          <td style="font-family:var(--mono);color:var(--green)">${fmtNum(pl.coupons)}</td>
          <td style="font-family:var(--mono);color:var(--text2)">${fmtNum(Math.floor(pl.coupons/COUPON_PER_PUZZLE))}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

// ─── PLAYER MODAL ────────────────────────────────────────────
let editPlayerId = null;
let officerRows = [];

function openPlayerModal(playerId=null) {
  editPlayerId = playerId;
  document.getElementById('modal-player-title').textContent = playerId ? 'Редактировать игрока' : 'Новый игрок';
  const p = playerId ? getPlayer(playerId) : null;
  document.getElementById('fp-name').value = p?.name || '';
  document.getElementById('fp-real-name').value = p?.realName || '';
  document.getElementById('fp-rank').value = p?.rank || 'r3';
  document.getElementById('fp-vip').value = p?.sector?.vipLevel || 0;
  document.getElementById('fp-conf').value = p?.sector?.confidentialityLevel || 0;
  document.getElementById('fp-stock-coupons').value = p?.stock?.coupons || 0;
  document.getElementById('fp-stock-puzzles').value = p?.stock?.puzzles || 0;
  document.getElementById('fp-stock-chests').value = p?.stock?.chests || 0;
  document.getElementById('fp-power').value = p?.sector?.power || 0;
  document.getElementById('fp-kills').value = p?.sector?.kills || 0;
  document.getElementById('fp-kill-points').value = p?.sector?.killPoints || 0;
  officerRows = p ? p.officers.map(o=>({...o})) : [{ id:'new_'+Date.now(), catalogId:state.officerCatalog[0]?.id, level:0, coupons:0, stars:0 }];
  renderOfficerRows();
  openModal('modal-player');
}

function renderOfficerRows() {
  document.getElementById('fp-officers-list').innerHTML = officerRows.map((o,i)=>`
    <div class="officer-row">
      <select onchange="officerRows[${i}].catalogId=this.value">
        ${state.officerCatalog.map(co=>`<option value="${co.id}" ${co.id===o.catalogId?'selected':''}>${co.name}</option>`).join('')}
      </select>
      <input type="number" placeholder="Уровень" value="${o.level}" min="0" max="179" style="width:80px" oninput="officerRows[${i}].level=parseInt(this.value)||0">
      <input type="number" placeholder="Купонов" value="${o.coupons}" min="0" step="500" style="width:100px" oninput="officerRows[${i}].coupons=parseInt(this.value)||0">
      <span class="stars">${Array.from({length:6},(_,s)=>{
        const star = s + 1;
        const cost = starCostFor(star);
        const label = star < 6 ? `${fmtNum(cost)} звезд до ${star}★` : `Итого ${fmtNum(cost)} звезд`;
        return `<button type="button" class="star-btn ${(o.stars||0)>s?'active':''}" title="${label}" aria-label="${label}" onclick="setOfficerStars(${i},${star})">${(o.stars||0)>s?'★':'☆'}</button>`;
      }).join('')}</span>
      <button class="action-btn danger" onclick="officerRows.splice(${i},1);renderOfficerRows()">✕</button>
    </div>`).join('');
}

function addOfficerRow() {
  officerRows.push({ id:'new_'+Date.now(), catalogId:state.officerCatalog[0]?.id, level:0, coupons:0, stars:0 });
  renderOfficerRows();
}

function setOfficerStars(index, stars) {
  officerRows[index].stars = officerRows[index].stars === stars ? stars - 1 : stars;
  renderOfficerRows();
}

function savePlayer() {
  const name = document.getElementById('fp-name').value.trim();
  if (!name) { toast('Введите имя игрока','error'); return; }
  const realName = document.getElementById('fp-real-name').value.trim();
  const rank = document.getElementById('fp-rank').value;
  const sector = {
    vipLevel: Math.max(0,parseInt(document.getElementById('fp-vip').value)||0),
    confidentialityLevel: Math.max(0,parseInt(document.getElementById('fp-conf').value)||0),
    power: Math.max(0,parseInt(document.getElementById('fp-power').value)||0),
    kills: Math.max(0,parseInt(document.getElementById('fp-kills').value)||0),
    killPoints: Math.round(Math.max(0,parseFloat(document.getElementById('fp-kill-points').value)||0) * 10) / 10,
  };
  const stock = {
    coupons: Math.max(0,parseInt(document.getElementById('fp-stock-coupons').value)||0),
    puzzles: Math.max(0,parseInt(document.getElementById('fp-stock-puzzles').value)||0),
    chests: Math.max(0,parseInt(document.getElementById('fp-stock-chests').value)||0),
  };
  const officers = officerRows.filter(o=>o.catalogId).map(o=>({
    id: o.id.startsWith('new_') ? 'o'+state.nextId++ : o.id,
    catalogId: o.catalogId,
    name: getCatalogOfficer(o.catalogId)?.name || '',
    level: Math.max(0,Math.min(MAX_LEVEL-1,parseInt(o.level)||0)),
    coupons: Math.max(0,parseInt(o.coupons)||0),
    stars: Math.max(0,Math.min(6,parseInt(o.stars)||0)),
  }));
  if (editPlayerId) {
    Object.assign(getPlayer(editPlayerId), { name, realName, rank, sector, stock, officers });
    toast(`Игрок «${name}» обновлён`);
  } else {
    const id = state.nextId++;
    state.players.push({ id, name, realName, rank, sector, stock, officers });
    state.currentPlayerId ||= id;
    toast(`Игрок «${name}» добавлён`);
  }
  save(); closeAllModals(); navigate('players');
}

function confirmDeletePlayer(id) {
  const p = getPlayer(id);
  document.getElementById('confirm-text').textContent = `Удалить игрока «${p.name}»?`;
  document.getElementById('confirm-btn').onclick = ()=>{ state.players = state.players.filter(x=>x.id!==id); save(); closeAllModals(); toast('Удалено','info'); navigate('players'); };
  openModal('modal-confirm');
}

// ─── OFFICER CATALOG MODAL ───────────────────────────────────
let editCatalogOfficerId = null;

function openOfficerCatalogModal(id=null) {
  editCatalogOfficerId = id;
  const officer = id ? getCatalogOfficer(id) : null;
  document.getElementById('modal-officer-title').textContent = id ? 'Редактировать офицера' : 'Новый офицер';
  document.getElementById('fo-name').value = officer?.name || '';
  document.getElementById('fo-type').value = officer?.type || 'Танк';
  document.getElementById('fo-generation').value = officer?.generation || 7;
  document.getElementById('fo-coupon-per-puzzle').value = officer?.couponPerPuzzle ?? 500;
  openModal('modal-officer');
}

function saveOfficerCatalog() {
  const name = document.getElementById('fo-name').value.trim();
  if (!name) { toast('Введите имя офицера','error'); return; }
  const data = {
    name,
    type: document.getElementById('fo-type').value,
    generation: Math.max(1,parseInt(document.getElementById('fo-generation').value)||7),
    couponPerPuzzle: Math.max(0,parseInt(document.getElementById('fo-coupon-per-puzzle').value)||0),
    medalsBeforeTraining: 690,
    medalsTraining: 900,
    medalsTotal: 1590,
  };
  if (editCatalogOfficerId) Object.assign(getCatalogOfficer(editCatalogOfficerId), data);
  else state.officerCatalog.push({ id:'catalog-'+state.nextId++, ...data });
  save(); closeAllModals(); toast('Офицер сохранён'); navigate('officers');
}

function confirmDeleteOfficerCatalog(id) {
  const officer = getCatalogOfficer(id);
  const result = canDeleteOfficer(id, state.players);
  if (!result.ok) {
    toast(`Нельзя удалить: используют ${result.blockers.map(p=>p.name).join(', ')}`,'error');
    return;
  }
  document.getElementById('confirm-text').textContent = `Удалить офицера «${officer.name}»?`;
  document.getElementById('confirm-btn').onclick = ()=>{
    state.officerCatalog = state.officerCatalog.filter(o=>o.id!==id);
    save(); closeAllModals(); toast('Офицер удалён','info'); navigate('officers');
  };
  openModal('modal-confirm');
}

// ─── EVENT TYPE MODAL ─────────────────────────────────────────
let editEtId = null;
let etPlaceRows = [];

function openEventTypeModal(etId=null) {
  editEtId = etId;
  document.getElementById('modal-et-title').textContent = etId ? 'Редактировать тип' : 'Новый тип ивента';
  if (etId) {
    const et = getEventType(etId);
    document.getElementById('fet-name').value = et.name;
    document.getElementById('fet-color').value = et.color;
    etPlaceRows = et.places.map(p=>({...p}));
  } else {
    document.getElementById('fet-name').value = '';
    document.getElementById('fet-color').value = '#8b5cf6';
    etPlaceRows = [
      { place:1, label:'🥇 1 место', coupons:12500 },
      { place:2, label:'🥈 2 место', coupons:6500  },
      { place:3, label:'🥉 3 место', coupons:3500  },
      { place:4, label:'4–10 место', coupons:2750  },
    ];
  }
  renderEtPlaceRows();
  openModal('modal-et');
}

function renderEtPlaceRows() {
  document.getElementById('fet-places-list').innerHTML = etPlaceRows.map((pl,i)=>`
    <div class="officer-row">
      <input type="number" placeholder="Место" value="${pl.place}" min="1" style="width:60px" oninput="etPlaceRows[${i}].place=parseInt(this.value)||1">
      <input type="text" placeholder="Название" value="${pl.label}" style="flex:1" oninput="etPlaceRows[${i}].label=this.value">
      <input type="number" placeholder="Купонов" value="${pl.coupons}" min="0" step="500" style="width:100px" oninput="etPlaceRows[${i}].coupons=parseInt(this.value)||0">
      <button class="action-btn danger" onclick="etPlaceRows.splice(${i},1);renderEtPlaceRows()">✕</button>
    </div>`).join('');
}

function addEtPlaceRow() {
  const nextPlace = etPlaceRows.length ? Math.max(...etPlaceRows.map(p=>p.place))+1 : 1;
  etPlaceRows.push({ place:nextPlace, label:`Место ${nextPlace}`, coupons:0 });
  renderEtPlaceRows();
}

function saveEventType() {
  const name = document.getElementById('fet-name').value.trim();
  if (!name) { toast('Введите название','error'); return; }
  const color = document.getElementById('fet-color').value;
  const places = etPlaceRows.filter(p=>p.label.trim()).sort((a,b)=>a.place-b.place);
  if (!places.length) { toast('Добавьте хотя бы одно место','error'); return; }
  if (editEtId) {
    const et = getEventType(editEtId);
    const prizeHistory = [...(et.prizeHistory || []), { date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }];
    Object.assign(et, { name, color, places, prizeHistory });
    toast(`Тип «${name}» обновлён`);
  } else {
    state.eventTypes.push({ id:state.nextId++, name, color, places, prizeHistory:[{ date:new Date().toISOString().slice(0,10), places:places.map(p=>({...p})) }] });
    toast(`Тип «${name}» добавлен`);
  }
  save(); closeAllModals(); navigate('event_types');
}

function confirmDeleteEventType(id) {
  const et = getEventType(id);
  document.getElementById('confirm-text').textContent = `Удалить тип ивента «${et.name}»? Все ивенты этого типа потеряют привязку.`;
  document.getElementById('confirm-btn').onclick = ()=>{ state.eventTypes = state.eventTypes.filter(x=>x.id!==id); save(); closeAllModals(); toast('Удалено','info'); navigate('event_types'); };
  openModal('modal-confirm');
}

// ─── EVENT MODAL ─────────────────────────────────────────────
let editEventId = null;
let eventAssignments = []; // [{place, playerId, officerId, actualCoupons?}]

function openEventModal(eventId=null) {
  editEventId = eventId;
  document.getElementById('modal-event-title').textContent = eventId ? 'Редактировать ивент' : 'Новый ивент';

  // populate event type select
  const sel = document.getElementById('fe-type');
  sel.innerHTML = state.eventTypes.map(et=>`<option value="${et.id}">${et.name}</option>`).join('');

  if (eventId) {
    const ev = getEvent(eventId);
    sel.value = ev.typeId;
    document.getElementById('fe-from').value = ev.dateFrom;
    document.getElementById('fe-to').value = ev.dateTo;
    document.getElementById('fe-note').value = ev.note || '';
    eventAssignments = ev.assignments.map(a=>({...a}));
  } else {
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('fe-from').value = today;
    document.getElementById('fe-to').value = today;
    document.getElementById('fe-note').value = '';
    eventAssignments = [];
    // pre-populate from event type places
    if (state.eventTypes.length) {
      const et = getEventType(parseInt(sel.value));
      if (et) eventAssignments = resolveEventPlaces(et, today).map(p=>({ place:p.place, playerId:null, officerId:null, actualCoupons:p.coupons }));
    }
  }
  renderEventAssignments();
  openModal('modal-event');
}

function onEventTypeChange() {
  if (eventAssignments.some(a => a.playerId)) {
    if (!confirm('Сменить тип ивента? Текущие назначения игроков будут сброшены.')) {
      const currentEv = editEventId ? getEvent(editEventId) : null;
      document.getElementById('fe-type').value = currentEv?.typeId || state.eventTypes[0]?.id;
      return;
    }
  }
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  if (et) {
    const dateFrom = document.getElementById('fe-from').value || new Date().toISOString().slice(0,10);
    eventAssignments = resolveEventPlaces(et, dateFrom).map(p=>({ place:p.place, playerId:null, officerId:null, actualCoupons:p.coupons }));
  }
  renderEventAssignments();
}

function renderEventAssignments() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);

  document.getElementById('fe-assignments').innerHTML = eventAssignments.map((a,i)=>{
    const pi = placeInfo(et, a.place, document.getElementById('fe-from')?.value);
    const player = a.playerId ? getPlayer(a.playerId) : null;
    const officerOptions = player
      ? player.officers.map(o=>{
          const c = getCatalogOfficer(o.catalogId);
          const typeStr = c?.type ? `${c.type}, ` : '';
          return `<option value="${o.id}" ${o.id===a.officerId?'selected':''}>${officerLabel(o)} (${typeStr}ур.${fmtNum(o.level)})</option>`;
        }).join('')
      : '';

    let efficiencyBadge = `<span class="badge badge-none" style="font-size:10px">Свободно</span>`;
    if (a.playerId) {
      const o = player?.officers?.find(x => x.id === a.officerId) || player?.officers?.[0];
      const cat = o ? getCatalogOfficer(o.catalogId) : null;
      if (o && cat) {
        const couponsPrize = a.actualCoupons ?? pi?.coupons ?? 0;
        const def = calculateOfficerDeficit({ officer: o, catalogItem: cat, player, targetLevel: MAX_LEVEL });
        if (def.costPerPuzzle === 0) {
          efficiencyBadge = `<span class="badge badge-warning" style="font-size:10px" title="Офицер качается только пазлами!">Только пазлы</span>`;
        } else if (def.deficitCoupons < couponsPrize) {
          const overflow = couponsPrize - def.deficitCoupons;
          efficiencyBadge = `<span class="badge badge-warning" style="font-size:10px" title="Дефицит ${fmtNum(def.deficitCoupons)} куп.">Перерасход: +${fmtNum(overflow)}</span>`;
        } else {
          efficiencyBadge = `<span class="badge badge-success" style="font-size:10px" title="Дефицит ${fmtNum(def.deficitCoupons)} куп.">✓ 100% полезно</span>`;
        }
      }
    }

    return `<div class="assign-card">
      <span class="assign-place">${pi?.label || 'Место ' + a.place}</span>
      <input type="number" value="${a.actualCoupons ?? pi?.coupons ?? 0}" min="0" step="500" title="Фактические купоны" oninput="eventAssignments[${i}].actualCoupons=parseInt(this.value)||0;renderEventAssignments()">
      <select onchange="onAssignPlayerChange(${i},this.value)">
        <option value="">— Игрок —</option>
        ${state.players.map(p=>'<option value="' + p.id + '" ' + (p.id===a.playerId?'selected':'') + '>' + p.name + '</option>').join('')}
      </select>
      <select ${!player?'disabled':''} onchange="eventAssignments[${i}].officerId=this.value;renderEventAssignments()">
        <option value="">— Офицер —</option>
        ${officerOptions}
      </select>
      <div style="display:flex;align-items:center">${efficiencyBadge}</div>
      <button class="action-btn danger" onclick="eventAssignments.splice(${i},1);renderEventAssignments()">✕</button>
    </div>`;
  }).join('');
}

function onAssignPlayerChange(idx, val) {
  const playerId = val ? parseInt(val) : null;
  const player = playerId ? getPlayer(playerId) : null;
  eventAssignments[idx].playerId = playerId;
  eventAssignments[idx].officerId = player?.officers?.[0]?.id || null;
  renderEventAssignments();
}

function addAssignmentRow() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  const maxPlace = eventAssignments.length ? Math.max(...eventAssignments.map(a=>a.place)) : 0;
  const nextPlace = maxPlace + 1;
  eventAssignments.push({ place: nextPlace, playerId: null, officerId: null });
  renderEventAssignments();
}

function autoPickAssignments() {
  const etId = parseInt(document.getElementById('fe-type').value);
  const et = getEventType(etId);
  const eventDate = document.getElementById('fe-from')?.value || new Date().toISOString().slice(0, 10);
  eventAssignments = smartAutoPick({
    places: eventAssignments.length ? eventAssignments : resolveEventPlaces(et, eventDate),
    players: state.players,
    officerCatalog: state.officerCatalog,
    eventDate,
  });
  toast('Автоподбор выполнен (с защитой от перерасхода)');
  renderEventAssignments();
}

function saveEvent() {
  const typeId = parseInt(document.getElementById('fe-type').value);
  const dateFrom = document.getElementById('fe-from').value;
  const dateTo = document.getElementById('fe-to').value;
  const note = document.getElementById('fe-note').value.trim();

  if (!typeId) { toast('Выберите тип ивента','error'); return; }
  if (!dateFrom || !dateTo) { toast('Укажите даты','error'); return; }

  const assignments = eventAssignments.filter(a=>a.playerId).map(a=>({
    place: a.place,
    playerId: parseInt(a.playerId),
    officerId: a.officerId || null,
    actualCoupons: a.actualCoupons,
  }));

  if (editEventId) {
    Object.assign(getEvent(editEventId), { typeId, dateFrom, dateTo, note, assignments });
    toast('Ивент обновлён');
  } else {
    state.events.push({ id:state.nextId++, typeId, dateFrom, dateTo, note, assignments });
    toast('Ивент создан');
  }
  save(); closeAllModals(); navigate('calendar');
}

function confirmDeleteEvent(id) {
  const ev = getEvent(id);
  const et = getEventType(ev?.typeId);
  document.getElementById('confirm-text').textContent = `Удалить ивент «${et?.name||'?'}» (${formatDateShort(ev?.dateFrom)})?`;
  document.getElementById('confirm-btn').onclick = ()=>{ state.events = state.events.filter(x=>x.id!==id); save(); closeAllModals(); toast('Удалено','info'); navigate('calendar'); };
  openModal('modal-confirm');
}

function submitR3Result(eventId, place) {
  const ev = getEvent(eventId);
  const p = getPlayer(state.currentPlayerId);
  if (!ev || !p || !canR3SubmitResult({ event: ev, place, nowIso: new Date().toISOString(), players: state.players })) {
    toast('Место сейчас нельзя указать','error');
    return;
  }
  const best = [...p.officers].sort((a,b)=>{
    const ca = getCatalogOfficer(a.catalogId), cb = getCatalogOfficer(b.catalogId);
    return (cb?.generation||0) - (ca?.generation||0) || b.level - a.level;
  })[0];
  if (!best) { toast('У игрока нет офицеров','error'); return; }
  const et = getEventType(ev.typeId);
  const pi = placeInfo(et, place, ev.dateFrom);
  ev.assignments = ev.assignments.filter(a=>a.place!==place);
  ev.assignments.push({ place, playerId:p.id, officerId:best.id, actualCoupons:pi?.coupons||0, submittedBy:'r3' });
  save();
  toast('Место отправлено');
  renderEventDetail(eventId);
}

function accrueEventRewards(id) {
  const ev = getEvent(id);
  const et = getEventType(ev.typeId);
  ev.assignments.forEach(a => {
    const p = getPlayer(a.playerId);
    const o = p?.officers.find(x=>x.id===a.officerId);
    if (!p || !o) return;
    const pi = placeInfo(et, a.place, ev.dateFrom);
    const coupons = a.actualCoupons ?? pi?.coupons ?? 0;
    const before = {...p.stock};
    p.stock.coupons += coupons;
    const afterTraining = applyEvent(o, coupons);
    Object.assign(o, afterTraining);
    state.stockHistory.push({ id:state.nextId++, playerId:p.id, eventId:id, date:new Date().toISOString(), before, after:{...p.stock} });
  });
  ev.accrued = true;
  save();
  toast('Награды начислены');
  renderEventDetail(id);
}

// ─── EXPORT / IMPORT ─────────────────────────────────────────
function exportExcel() {
  if (typeof XLSX === 'undefined') { toast('XLSX не загружен','error'); return; }
  const wb = XLSX.utils.book_new();

  // Players sheet
  const pData = [['Игрок','Имя','Ранг','VIP','Конфиденциальность','Купоны','Пазлы','Сундуки','Сила','Убито','Очки за убийство']];
  state.players.forEach(p=>pData.push([p.name,p.realName,p.rank,p.sector.vipLevel,p.sector.confidentialityLevel,p.stock.coupons,p.stock.puzzles,p.stock.chests,p.sector.power,p.sector.kills,p.sector.killPoints]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pData), 'Игроки');

  const oData = [['Игрок','Офицер','Тип','Поколение','Уровень','Купонов','Звезды','Купонов за пазл']];
  state.players.forEach(p=>p.officers.forEach(o=>{
    const cat = getCatalogOfficer(o.catalogId);
    oData.push([p.name, officerLabel(o), cat?.type||'', cat?.generation||'', o.level, o.coupons, o.stars, cat?.couponPerPuzzle ?? COUPON_PER_PUZZLE]);
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(oData), 'Офицеры');

  const hData = [['Дата','Игрок','Купоны было','Пазлы было','Сундуки было','Купоны стало','Пазлы стало','Сундуки стало','Ивент']];
  state.stockHistory.forEach(h=>{
    const p = getPlayer(h.playerId);
    hData.push([h.date, p?.name||'', h.before.coupons, h.before.puzzles, h.before.chests, h.after.coupons, h.after.puzzles, h.after.chests, h.eventId||'']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hData), 'История');

  // Events sheet
  const eData = [['Ивент','Дата начала','Дата конца','Место','Игрок','Офицер','Купонов']];
  state.events.forEach(ev=>{
    const et = getEventType(ev.typeId);
    ev.assignments.forEach(a=>{
      const p = getPlayer(a.playerId);
      const o = p?.officers.find(x=>x.id===a.officerId);
      const pi = placeInfo(et,a.place, ev.dateFrom);
      eData.push([et?.name||'—', ev.dateFrom, ev.dateTo, pi?.label||`Место ${a.place}`, p?.name||'—', o?officerLabel(o):'—', a.actualCoupons??pi?.coupons??0]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eData), 'Ивенты');

  const fData = [['Игрок','Офицер','Дата максимума','Дней','1 место','2 место','3 место','4-10 место']];
  state.players.forEach(p=>p.officers.forEach(o=>{
    const f = forecastOfficer({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, events:state.events, eventTypes:state.eventTypes });
    const variants = forecastOfficerVariants({ today:new Date().toISOString().slice(0,10), officer:o, player:p, officerCatalog:state.officerCatalog, eventType:state.eventTypes[0]||{} });
    fData.push([p.name, officerLabel(o), f.date||'', f.days??'', variants.top1.date||'', variants.top2.date||'', variants.top3.date||'', variants.top4to10.date||'']);
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fData), 'Прогнозы');

  XLSX.writeFile(wb, `KoW_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel экспортирован!');
}

function importData() { document.getElementById('import-file').click(); }
function exportJson() {
  const blob = new Blob([JSON.stringify({ ...state, version: 3 }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `KoW_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('JSON экспортирован');
}
function handleImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const valid = validateImportData(data);
      if (valid.ok) { state = migrateState(data); save(); toast('Импортировано!'); navigate('calendar'); }
      else toast(valid.error,'error');
    } catch { toast('Ошибка чтения','error'); }
  };
  reader.readAsText(file); e.target.value='';
}

// ─── INIT ────────────────────────────────────────────────────
load();
navigate('calendar');
