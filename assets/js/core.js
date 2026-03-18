'use strict';

// Shared app state, player store and tournament store are loaded before core.js.
function setPlayersGender(g) {
  playersGender = g;
  playersSearch = '';
  const inp = document.getElementById('plr-search-inp');
  if (inp) inp.value = '';
  refreshPlayersScreen();
}
let _plrSearchTimer = null;
function setPlayersSearch(val) {
  playersSearch = val;
  clearTimeout(_plrSearchTimer);
  _plrSearchTimer = setTimeout(refreshPlayersScreen, 150);
}
function setPlayersSort(key) {
  playersSort = key;
  refreshPlayersScreen();
}
function refreshPlayersScreen() {
  const s = document.getElementById('screen-players');
  if (s && s.classList.contains('active')) s.innerHTML = renderPlayers();
}

// ── ROSTER AUTOCOMPLETE ─────────────────────────────────────
let _rcAcInputId = null;

function rosterAcShow(inp) {
  const q = inp.value.trim().toLowerCase();
  if (!q || q.length < 1) { rosterAcHide(); return; }
  const g  = inp.classList.contains('men-input') ? 'M' : 'W';
  const db = loadPlayerDB();
  const hits = db
    .filter(p => p.gender === g && p.name.toLowerCase().includes(q))
    .sort((a,b) => (b.totalPts||0) - (a.totalPts||0))
    .slice(0, 7);
  if (!hits.length) { rosterAcHide(); return; }

  let dd = document.getElementById('rc-autocomplete');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'rc-autocomplete';
    document.body.appendChild(dd);
  }
  const rect = inp.getBoundingClientRect();
  dd.style.top    = (rect.bottom + 2) + 'px';
  dd.style.left   = rect.left + 'px';
  dd.style.width  = Math.max(rect.width, 180) + 'px';
  _rcAcInputId = inp.id;

  dd.innerHTML = hits.map(p => `
    <div class="rc-ac-item" onmousedown="rosterAcPick('${escAttr(p.name)}')">
      <span class="rc-ac-name">${esc(p.name)}</span>
      <span class="rc-ac-meta">${p.tournaments||0}т · ${p.totalPts||0}оч</span>
    </div>`).join('<div class="rc-ac-sep"></div>');
  dd.style.display = 'block';
}

function rosterAcHide() {
  const dd = document.getElementById('rc-autocomplete');
  if (dd) dd.remove();
  _rcAcInputId = null;
}

function rosterAcPick(name) {
  if (_rcAcInputId) {
    const inp = document.getElementById(_rcAcInputId);
    if (inp) { inp.value = name; inp.dispatchEvent(new Event('change')); }
  }
  rosterAcHide();
}

// Close autocomplete on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#rc-autocomplete') && !e.target.classList.contains('rc-inp'))
    rosterAcHide();
});

// ── ROSTER PLAYER DB MANAGEMENT ────────────────────────────
let rosterDbTab = 'M';

function setRosterDbTab(g) {
  rosterDbTab = g;
  _refreshRdb();
}
function _refreshRdb() {
  const el = document.getElementById('roster-db-section');
  if (el) el.innerHTML = _rdbBodyHtml();
}
function rdbAdd() {
  const inp = document.getElementById('rdb-add-inp');
  const name = (inp?.value || '').trim();
  if (!name) { showToast('⚠️ Введите фамилию'); return; }
  if (name.length > 50) { showToast('⚠️ Фамилия не должна превышать 50 символов'); return; }
  if (addPlayerToDB(name, rosterDbTab)) {
    inp.value = ''; _refreshRdb();
    showToast('✅ ' + name + ' добавлен');
  } else { showToast('⚠️ Уже в базе'); }
}
function rdbRemove(id) {
  removePlayerFromDB(id); _refreshRdb();
}
function rdbSetPts(id, val) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) { p.totalPts = Math.max(0, parseInt(val)||0); savePlayerDB(db); }
}
function rdbSetTrn(id, val) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) { p.tournaments = Math.max(0, parseInt(val)||0); savePlayerDB(db); }
}
function rdbAdjPts(id, d) {
  const db = loadPlayerDB();
  const p = db.find(x => x.id == id);
  if (p) {
    p.totalPts = Math.max(0, (p.totalPts||0) + d);
    savePlayerDB(db); _refreshRdb();
  }
}

function _rdbBodyHtml() {
  const allDb = loadPlayerDB();
  const db    = allDb.filter(p => p.gender === rosterDbTab)
                     .sort((a,b) => (b.totalPts||0) - (a.totalPts||0));
  const rankCls = i => i===0?'g':i===1?'s':i===2?'b':'';
  const medal   = i => i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1;

  const rows = db.length ? db.map((p,i) => `
    <div class="rdb-row">
      <span class="rdb-rank ${rankCls(i)}">${medal(i)}</span>
      <span class="rdb-name" onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')"
        title="Открыть карточку">${esc(p.name)}</span>
      <span title="Турниров" style="color:var(--muted);font-size:9px;flex-shrink:0">🏆</span>
      <input class="rdb-trn-inp" type="number" min="0" value="${p.tournaments||0}"
        onchange="rdbSetTrn(${p.id},this.value)" onblur="rdbSetTrn(${p.id},this.value)"
        title="Кол-во турниров">
      <span title="Очки" style="color:var(--muted);font-size:9px;flex-shrink:0">⚡</span>
      <div class="rdb-pts-wrap">
        <button class="rdb-adj" onclick="rdbAdjPts(${p.id},-5)" title="-5">−</button>
        <input class="rdb-pts-inp" type="number" min="0" value="${p.totalPts||0}"
          onchange="rdbSetPts(${p.id},this.value)" onblur="rdbSetPts(${p.id},this.value)"
          title="Очки">
        <button class="rdb-adj" onclick="rdbAdjPts(${p.id},+5)" title="+5">+</button>
      </div>
      <button class="rdb-del" onclick="rdbRemove(${p.id})" title="Удалить">✕</button>
    </div>`).join('')
    : `<div class="rdb-empty">Нет игроков. Добавьте выше.</div>`;

  const mCnt = allDb.filter(p=>p.gender==='M').length;
  const wCnt = allDb.filter(p=>p.gender==='W').length;

  return `
    <div class="rdb-hdr">
      <span class="rdb-title">👤 БАЗА <span>ИГРОКОВ</span></span>
      <div class="rdb-tabs">
        <button class="rdb-tab ${rosterDbTab==='M'?'active':''}" onclick="setRosterDbTab('M')">🏋️ М (${mCnt})</button>
        <button class="rdb-tab ${rosterDbTab==='W'?'active':''}" onclick="setRosterDbTab('W')">👩 Ж (${wCnt})</button>
      </div>
    </div>
    <div class="rdb-add-row">
      <input class="rdb-add-inp" id="rdb-add-inp" type="text"
        placeholder="${rosterDbTab==='M'?'Фамилия (мужской)':'Фамилия (женский)'}"
        onkeydown="if(event.key==='Enter')rdbAdd()">
      <button class="rdb-add-btn" onclick="rdbAdd()">+ Добавить</button>
    </div>
    <div class="rdb-list">${rows}</div>`;
}

// ── Roster Tournament Manager ─────────────────────────────────
let rosterTrnFormOpen = false;
let rosterTrnEditId   = null; // string id of tournament being edited, null = new

function openTrnAdd() {
  rosterTrnFormOpen = true;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
  setTimeout(() => document.getElementById('trnf-name')?.focus(), 80);
}
function openTrnEdit(id) {
  rosterTrnFormOpen = true;
  rosterTrnEditId   = id;
  _refreshRosterTrn();
  setTimeout(() => document.getElementById('trnf-name')?.focus(), 80);
}
function closeTrnForm() {
  rosterTrnFormOpen = false;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
}

// ── Form submit: validate → create or update ──────────────────
function submitTournamentForm() {
  const g = id => (document.getElementById(id)?.value || '').trim();
  const formData = {
    name:     g('trnf-name'),
    date:     g('trnf-date'),
    time:     g('trnf-time'),
    location: g('trnf-loc'),
    format:   g('trnf-format'),
    division: g('trnf-div'),
    level:    g('trnf-level'),
    prize:    document.getElementById('trnf-prize-toggle')?.checked ? g('trnf-prize') : '',
    capacity: parseInt(document.getElementById('trnf-cap')?.value || '0', 10),
  };

  // Field → input id map (used for highlighting errors)
  const idMap = {
    name:'trnf-name', date:'trnf-date', time:'trnf-time',
    location:'trnf-loc', format:'trnf-format', division:'trnf-div',
    level:'trnf-level', prize:'trnf-prize', capacity:'trnf-cap',
  };

  // Clear previous error states before re-validating
  Object.values(idMap).forEach(id =>
    document.getElementById(id)?.classList.remove('trn-form-inp--error')
  );

  let firstError = null;
  const REQUIRED = ['name','date','time','location','format','division','level'];
  REQUIRED.forEach(field => {
    if (!formData[field]) {
      document.getElementById(idMap[field])?.classList.add('trn-form-inp--error');
      if (!firstError) firstError = 'Заполните поле «' + field + '»';
    }
  });
  if (document.getElementById('trnf-prize-toggle')?.checked && !formData.prize) {
    document.getElementById('trnf-prize')?.classList.add('trn-form-inp--error');
    if (!firstError) firstError = 'Заполните поле «Призовой фонд» или отключите его';
  }
  if (!formData.capacity || formData.capacity < 4 || formData.capacity > 999) {
    document.getElementById('trnf-cap')?.classList.add('trn-form-inp--error');
    if (!firstError) firstError = formData.capacity > 999
      ? 'Максимальная вместимость — 999 участников'
      : 'Минимальная вместимость — 4 участника';
  }
  if (firstError) { showToast(firstError, 'error'); return; }

  const arr = getTournaments();
  if (rosterTrnEditId !== null) {
    const idx = arr.findIndex(t => t.id === rosterTrnEditId);
    if (idx !== -1) {
      // Preserve immutable fields: participants, waitlist, winners, status, source
      arr[idx] = { ...arr[idx], ...formData };
    }
    showToast('Турнир обновлён', 'success');
  } else {
    arr.push({
      id: 't_' + Date.now(),
      ...formData,
      status:       'open',
      participants: [],
      waitlist:     [],
      winners:      [],
    });
    // Автоматически устанавливаем как текущий турнир
    tournamentMeta.name = formData.name;
    tournamentMeta.date = formData.date;
    saveState();
    showToast('Турнир добавлен и установлен как текущий', 'success');
  }

  saveTournaments(arr);
  rosterTrnFormOpen = false;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
}

// ── Admin actions ─────────────────────────────────────────────
/** Clone: copy all fields except id/participants/waitlist/winners, open pre-filled form */
function cloneTrn(id) {
  const src = getTournaments().find(t => t.id === id);
  if (!src) return;
  rosterTrnFormOpen = true;
  rosterTrnEditId   = null;
  _refreshRosterTrn();
  // Populate form fields after render (fields are injected via innerHTML)
  setTimeout(() => {
    const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
    set('trnf-name',   src.name + ' (копия)');
    set('trnf-date',   src.date);
    set('trnf-time',   src.time);
    set('trnf-loc',    src.location);
    set('trnf-format', src.format);
    set('trnf-div',    src.division);
    set('trnf-level',  src.level);
    if (src.prize) {
      const tog = document.getElementById('trnf-prize-toggle');
      if (tog) { tog.checked = true; tog.dispatchEvent(new Event('change')); }
      set('trnf-prize', src.prize);
    }
    set('trnf-cap',    src.capacity);
    document.getElementById('trnf-name')?.focus();
  }, 60);
}

/** Finish: open results form (user records winners, then saves + marks finished) */
function finishTrn(id) {
  openResultsForm(id);
}

// ── Results Form ──────────────────────────────────────────────
// Single state object — avoids stale closures and window pollution
let _resState = null;

// ── O(1) player lookup cache ──────────────────────────────────
function _buildPlayerMap() {
  const map = new Map();
  loadPlayerDB().forEach(p => map.set(p.id, p));
  return map;
}

const PRESETS = {
  standard: { label:'Стандарт', pts:[100,80,60] },
  major:    { label:'Major',    pts:[150,120,90] },
  custom:   { label:'Кастом',   pts:null },
};

function openResultsForm(trnId) {
  const trn = getTournaments().find(t => t.id === trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }
  // Auto-sync roster → playerDB if DB is empty
  if (loadPlayerDB().length === 0) syncPlayersFromRoster();

  const hasResults = Array.isArray(trn.winners) && trn.winners.length > 0
                     && typeof trn.winners[0] === 'object';

  // Default preset detection from existing data
  let defaultPreset = 'standard';
  if (hasResults) {
    const pts = trn.winners.map(w => w.points).join(',');
    if (pts === '100,80,60') defaultPreset = 'standard';
    else if (pts === '150,120,90') defaultPreset = 'major';
    else defaultPreset = 'custom';
  }

  _resState = {
    trnId,
    newPlayerSlotIdx: null,
    preset: defaultPreset,
    trnType: trn.ratingType || divisionToType(trn.division),
    slots: hasResults
      ? trn.winners.map(w => ({ ...w, playerIds: [...w.playerIds] }))
      : [
          { place: 1, playerIds: [], points: 100 },
          { place: 2, playerIds: [], points: 80  },
          { place: 3, playerIds: [], points: 60  },
        ],
  };

  document.getElementById('results-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id        = 'results-modal';
  overlay.className = 'res-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeResultsModal(); });

  const isEdit = hasResults;
  const partCount = (trn.participants || []).length;
  const partChip  = partCount
    ? `<span class="res-participants-chip">👥 ${partCount} участников в турнире</span>` : '';

  overlay.innerHTML = `
    <div class="res-modal" role="dialog" aria-modal="true">
      <div class="res-modal-hdr">
        <div>
          <div class="res-modal-title">${isEdit ? '✏️ Редактировать результаты' : '🏆 Завершить турнир'}</div>
          <div class="res-modal-sub">${esc(trn.name)} · ${trn.date}</div>
        </div>
        <button class="res-modal-close" onclick="closeResultsModal()">✕</button>
      </div>
      <div class="res-modal-body">
        ${partChip}
        <!-- Tournament type selector for rating -->
        <div class="res-type-row">
          <span class="res-type-lbl">🏆 Тип турнира (рейтинг):</span>
          <div class="res-type-btns" id="res-type-btns">
            <button class="res-type-btn ${_resState.trnType==='M'?'active':''}"
              onclick="resSetTrnType('M')">🏋️ М</button>
            <button class="res-type-btn ${_resState.trnType==='W'?'active':''}"
              onclick="resSetTrnType('W')">👩 Ж</button>
            <button class="res-type-btn ${_resState.trnType==='Mix'?'active':''}"
              onclick="resSetTrnType('Mix')">🤝 Микст</button>
          </div>
        </div>
        <!-- Points presets -->
        <div class="res-presets" id="res-presets">
          ${Object.entries(PRESETS).map(([key, p]) => `
            <button class="res-preset-btn ${defaultPreset === key ? 'active' : ''}"
              onclick="resApplyPreset('${key}')"
              id="res-preset-${key}">
              ${p.label}
              ${p.pts ? `<span class="res-preset-pts">${p.pts.join('/')}</span>` : '<span class="res-preset-pts">свои очки</span>'}
            </button>`).join('')}
        </div>
        <!-- Completion progress -->
        <div class="res-progress" id="res-progress">
          <div class="res-progress-dot" id="rpd-0"></div>
          <div class="res-progress-dot" id="rpd-1"></div>
          <div class="res-progress-dot" id="rpd-2"></div>
          <span class="res-progress-lbl" id="res-progress-lbl">Заполните все 3 призовых места</span>
        </div>
        <div id="res-slots-wrap"></div>
        <div class="res-total">Всего очков: <b id="res-total-pts">0</b></div>
        <div id="res-new-player-wrap"></div>
      </div>
      <div class="res-modal-footer">
        ${!isEdit ? `<button class="res-btn-skip" onclick="finishTrnNoResults('${escAttr(trnId)}')">
          Без результатов
        </button>` : ''}
        <button class="res-btn-save" id="res-btn-save" disabled onclick="saveResults()">
          ${isEdit ? '💾 Сохранить изменения' : '💾 Сохранить и завершить'}
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _reRenderSlots();
}

function closeResultsModal() {
  document.getElementById('results-modal')?.remove();
  _resState = null;
}
function resSetTrnType(type) {
  if (!_resState) return;
  _resState.trnType = type;
  document.querySelectorAll('.res-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.includes(
      type === 'M' ? 'М' : type === 'W' ? 'Ж' : 'Микст'
    ));
  });
}

/** Mark finished without recording results */
async function finishTrnNoResults(trnId) {
  if (!await showConfirm('Завершить турнир без записи результатов?')) return;
  const arr = getTournaments();
  const t   = arr.find(t => t.id === trnId);
  if (t) { t.status = 'finished'; saveTournaments(arr); }
  closeResultsModal();
  _refreshRosterTrn();
  showToast('Турнир завершён', 'success');
}

// ── Slots render ──────────────────────────────────────────────
function _reRenderSlots() {
  const el = document.getElementById('res-slots-wrap');
  if (!el || !_resState) return;

  // Participants-first: only show tournament participants in dropdowns;
  // fall back to full DB if no participants recorded yet.
  const allDb     = loadPlayerDB().sort((a,b) => a.name.localeCompare(b.name, 'ru'));
  const trn       = getTournaments().find(t => t.id === _resState.trnId);
  const partIds   = new Set(trn?.participants || []);
  const playerPool = partIds.size > 0
    ? allDb.filter(p => partIds.has(p.id))
    : allDb;

  const allSelectedIds = _resState.slots.flatMap(s => s.playerIds);
  el.innerHTML = _resState.slots.map((slot, idx) =>
    _slotHtml(slot, idx, playerPool, allDb, allSelectedIds)
  ).join('');

  // Sync total points
  const totalEl = document.getElementById('res-total-pts');
  if (totalEl) totalEl.textContent = _resState.slots
    .reduce((s, w) => s + (w.playerIds.length > 0 ? w.points : 0), 0);

  // Hard validation: all 3 places must have ≥1 player
  const filled = _resState.slots.filter(s => s.playerIds.length > 0).length;
  const saveBtn = document.getElementById('res-btn-save');
  if (saveBtn) saveBtn.disabled = filled < 3;

  // Progress dots
  _resState.slots.forEach((s, i) => {
    const dot = document.getElementById('rpd-' + i);
    if (dot) dot.classList.toggle('done', s.playerIds.length > 0);
  });
  const lblEl = document.getElementById('res-progress-lbl');
  if (lblEl) {
    if (filled === 3) {
      lblEl.textContent = '✓ Готово — все три места заполнены';
      lblEl.className   = 'res-progress-lbl all-done';
    } else {
      lblEl.textContent = `Заполнено ${filled}/3 призовых мест`;
      lblEl.className   = 'res-progress-lbl';
    }
  }
}

function _slotHtml(slot, idx, playerPool, allMap, allSelectedIds) {
  const MEDALS    = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const medal     = MEDALS[slot.place] || ('#' + slot.place);
  const canAdd    = slot.playerIds.length < 2;
  const available = playerPool.filter(p => !allSelectedIds.includes(p.id));
  const isCustom  = _resState.preset === 'custom';

  const badges = slot.playerIds.map(id => {
    const p = allMap.get(id);
    return `<span class="res-badge">
      <button class="player-tap" onclick="showPlayerCard('${escAttr(p?.name||'')}','${escAttr(p?.gender||'M')}')"
        style="color:inherit;font-size:inherit">${esc(p?.name || '?')}</button>
      <button class="res-badge-rm" onclick="resRemovePlayer(${idx},'${id}')" aria-label="Убрать">×</button>
    </span>`;
  }).join('');

  const selectRow = canAdd ? `
    <div class="res-sel-row">
      <input class="res-search-inp" type="text" placeholder="Поиск..."
        id="res-search-${idx}" oninput="resFilterPlayers(${idx})">
      <select class="res-sel" id="res-sel-${idx}" onchange="resAddPlayer(${idx}, this.value)">
        <option value="">— выбрать —</option>
        ${available.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
      </select>
      <button class="res-new-btn" onclick="resOpenNewPlayerForm(${idx})" title="Создать нового">🆕</button>
    </div>` : `<div class="res-slot-full">Слот заполнен (max 2)</div>`;

  return `
    <div class="res-slot ${slot.place === 1 ? 'res-slot--gold' : ''}">
      <div class="res-slot-hdr">
        <span class="res-slot-place">${medal} ${slot.place} место</span>
        <div class="res-pts-wrap">
          <label class="res-pts-label">очков</label>
          <input class="res-pts-inp" type="number" min="0" max="9999"
            value="${slot.points}"
            ${isCustom ? '' : 'readonly style="opacity:.7;cursor:default"'}
            onchange="resChangePoints(${idx}, this.value)">
        </div>
      </div>
      <div class="res-slot-players">
        ${badges || '<span class="res-slot-empty">Не выбрано</span>'}
      </div>
      ${selectRow}
    </div>`;
}

// ── Slot actions (called from onclick attributes) ─────────────
function resAddPlayer(slotIdx, playerId) {
  if (!playerId || !_resState) return;
  const slot = _resState.slots[slotIdx];
  if (slot.playerIds.length >= 2) {
    showToast('Максимум 2 игрока в слоте', 'error'); return;
  }
  if (_resState.slots.flatMap(s => s.playerIds).includes(playerId)) {
    showToast('Игрок уже назначен в другой слот', 'error'); return;
  }
  slot.playerIds.push(playerId);
  _reRenderSlots();
}

function resRemovePlayer(slotIdx, playerId) {
  if (!_resState) return;
  _resState.slots[slotIdx].playerIds =
    _resState.slots[slotIdx].playerIds.filter(id => id !== playerId);
  _reRenderSlots();
}

function resChangePoints(slotIdx, val) {
  if (!_resState) return;
  _resState.slots[slotIdx].points = Math.max(0, parseInt(val) || 0);
  const totalEl = document.getElementById('res-total-pts');
  if (totalEl) totalEl.textContent = _resState.slots
    .reduce((s, w) => s + (w.playerIds.length > 0 ? w.points : 0), 0);
}

/** Apply a points preset (standard / major / custom) */
function resApplyPreset(key) {
  if (!_resState) return;
  _resState.preset = key;
  const preset = PRESETS[key];
  if (preset?.pts) {
    _resState.slots.forEach((s, i) => { if (preset.pts[i] !== undefined) s.points = preset.pts[i]; });
  }
  // Update active button
  Object.keys(PRESETS).forEach(k => {
    document.getElementById('res-preset-' + k)?.classList.toggle('active', k === key);
  });
  _reRenderSlots();
}

/** Filter <select> options without re-rendering the whole slot */
function resFilterPlayers(slotIdx) {
  const q   = (document.getElementById('res-search-' + slotIdx)?.value || '').toLowerCase();
  const sel = document.getElementById('res-sel-' + slotIdx);
  if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    opt.hidden = q.length > 0 && opt.value !== '' && !opt.text.toLowerCase().includes(q);
  });
}

// ── Inline new player form (no prompt(), no extra modal) ──────
function resOpenNewPlayerForm(slotIdx) {
  if (!_resState) return;
  _resState.newPlayerSlotIdx = slotIdx;
  // Pre-select gender from tournament division
  const trn  = getTournaments().find(t => t.id === _resState.trnId);
  const defG = trn?.division === 'Мужской' ? 'M'
             : trn?.division === 'Женский' ? 'W' : 'M';
  const wrap = document.getElementById('res-new-player-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="res-new-player-form">
      <div class="res-new-player-title">Добавить нового игрока в базу</div>
      <div class="res-new-player-row">
        <input class="res-new-inp" id="res-new-name" type="text"
          placeholder="Имя Фамилия"
          onkeydown="if(event.key==='Enter')resCreateNewPlayer()">
        <select class="res-new-gender" id="res-new-gender">
          <option value="M" ${defG === 'M' ? 'selected' : ''}>М</option>
          <option value="W" ${defG === 'W' ? 'selected' : ''}>Ж</option>
        </select>
        <button class="res-new-confirm" onclick="resCreateNewPlayer()">Добавить</button>
        <button class="res-new-cancel" onclick="resCloseNewPlayerForm()">✕</button>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('res-new-name')?.focus(), 30);
}

function resCloseNewPlayerForm() {
  const wrap = document.getElementById('res-new-player-wrap');
  if (wrap) wrap.innerHTML = '';
  if (_resState) _resState.newPlayerSlotIdx = null;
}

function resCreateNewPlayer() {
  if (!_resState) return;
  const name   = (document.getElementById('res-new-name')?.value || '').trim();
  const gender = document.getElementById('res-new-gender')?.value || 'M';
  if (!name) { showToast('Введите имя игрока', 'error'); return; }
  const db = loadPlayerDB();
  if (db.find(p => p.name.toLowerCase() === name.toLowerCase() && p.gender === gender)) {
    showToast('Игрок уже есть в базе', 'error'); return;
  }
  const newPlayer = upsertPlayerInDB({
    id:          'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    gender,
    status:      'active',
  });

  // Auto-assign to the target slot
  const slotIdx = _resState.newPlayerSlotIdx;
  if (slotIdx !== null) {
    const slot = _resState.slots[slotIdx];
    if (slot && slot.playerIds.length < 2) slot.playerIds.push(newPlayer.id);
  }
  resCloseNewPlayerForm();
  _reRenderSlots();
  showToast(name + ' добавлен в базу', 'success');
}

// ── Save results ──────────────────────────────────────────────
function saveResults() {
  if (!_resState) return;

  // Hard validation: all 3 places must be filled
  const filledCount = _resState.slots.filter(s => s.playerIds.length > 0).length;
  if (filledCount < 3) {
    showToast('Заполните все 3 призовых места', 'error'); return;
  }

  const arr = getTournaments();
  const trn = arr.find(t => t.id === _resState.trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }

  const isFirstSave = trn.status !== 'finished';
  const filled      = _resState.slots.filter(s => s.playerIds.length > 0);

  // Save rating type chosen by user
  trn.ratingType = _resState.trnType || divisionToType(trn.division);

  // Audit log — black box
  if (!Array.isArray(trn.history)) trn.history = [];
  trn.history.push({
    timestamp:       new Date().toISOString(),
    action:          isFirstSave ? 'finished' : 'edited',
    winnersSnapshot: JSON.parse(JSON.stringify(filled)),
  });

  trn.winners    = filled;
  trn.status     = 'finished';
  trn.finishedAt = trn.finishedAt || new Date().toISOString();
  saveTournaments(arr);

  // Full recalc — idempotent, safe for edits, no double-counting
  recalcAllPlayerStats(/*silent*/ true);
  closeResultsModal();
  _refreshRosterTrn();
  showToast(isFirstSave ? '🏆 Турнир завершён!' : '✏️ Результаты обновлены!', 'success');
}

/**
 * Recalculate ALL player stats from scratch by replaying every finished
 * tournament. Handles both kotc3_tournaments (new system) and kotc3_history
 * (old King of Court system). Call after bulk imports, data repairs, or edits.
 * @param {boolean} silent — skip the success toast (used after saveResults)
 */
function recalcAllPlayerStats(silent = false) {
  const db          = loadPlayerDB();
  const tournaments = getTournaments();
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e) {}

  // Reset counters — keep identity fields intact
  db.forEach(p => {
    p.tournaments = 0; p.totalPts = 0; p.wins = 0;
    p.ratingM = 0; p.ratingW = 0; p.ratingMix = 0;
    p.tournamentsM = 0; p.tournamentsW = 0; p.tournamentsMix = 0;
  });

  // ── New system: kotc3_tournaments ────────────────────────
  tournaments
    .filter(t => t.status === 'finished' && Array.isArray(t.winners))
    .forEach(t => {
      const tType = t.ratingType || divisionToType(t.division);
      t.winners.forEach(slot => {
        if (typeof slot !== 'object' || !Array.isArray(slot.playerIds)) return;
        const ratingPts = calculateRanking(slot.place);
        slot.playerIds.forEach(id => {
          const p = db.find(p => p.id === id);
          if (!p) return;
          p.tournaments = (p.tournaments || 0) + 1;
          p.totalPts    = (p.totalPts    || 0) + (Number(slot.points) || 0);
          p.wins        = (p.wins        || 0) + (slot.place === 1 ? 1 : 0);
          if (tType === 'M')      { p.ratingM   = (p.ratingM   ||0)+ratingPts; p.tournamentsM++; }
          else if (tType === 'W') { p.ratingW   = (p.ratingW   ||0)+ratingPts; p.tournamentsW++; }
          else                    { p.ratingMix = (p.ratingMix ||0)+ratingPts; p.tournamentsMix++; }
          if (t.date > (p.lastSeen || '')) p.lastSeen = t.date;
        });
      });
    });

  // ── Old system: kotc3_history — place by sorted position ─
  // King of Court events mix M and W — credit each player in their own gender column
  history.forEach(snap => {
    if (!Array.isArray(snap.players) || !snap.players.length) return;
    const genders = new Set(snap.players.map(p => p.gender).filter(Boolean));
    const isMixed = genders.size > 1;
    snap.players.forEach((sp, idx) => {
      const p = db.find(d =>
        d.name.toLowerCase() === (sp.name||'').toLowerCase() && d.gender === sp.gender
      );
      if (!p) return;
      const ratingPts = calculateRanking(idx + 1); // sorted desc → idx 0 = 1st place
      p.tournaments = (p.tournaments || 0) + 1;
      p.totalPts    = (p.totalPts    || 0) + (sp.totalPts || 0);
      p.wins        = (p.wins        || 0) + (idx === 0 ? 1 : 0);
      // Mixed KotC: credit in player's own gender column so М/Ж tabs show data
      const tType = isMixed ? sp.gender : (genders.has('W') ? 'W' : 'M');
      if (tType === 'M')      { p.ratingM   = (p.ratingM   ||0)+ratingPts; p.tournamentsM++; }
      else if (tType === 'W') { p.ratingW   = (p.ratingW   ||0)+ratingPts; p.tournamentsW++; }
      else                    { p.ratingMix = (p.ratingMix ||0)+ratingPts; p.tournamentsMix++; }
      if (snap.date > (p.lastSeen || '')) p.lastSeen = snap.date;
    });
  });

  savePlayerDB(db);
  if (!silent) showToast('Статистика пересчитана', 'success');
}

/** Delete: remove by id with confirmation */
async function deleteTrn(id) {
  if (!await showConfirm('Удалить турнир? Действие необратимо.')) return;
  saveTournaments(getTournaments().filter(t => t.id !== id));
  _refreshRosterTrn();
  showToast('Турнир удалён', 'success');
}

// ══ Participants Manager ══════════════════════════════════════
let _ptTrnId = null;
let _ptSearch = '';

function openParticipantsModal(trnId) {
  _ptTrnId = trnId;
  _ptSearch = '';
  document.getElementById('pt-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'pt-modal';
  overlay.className = 'pt-overlay';
  overlay.innerHTML = '<div class="pt-modal" id="pt-modal-inner"></div>';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeParticipantsModal(); });
  document.body.appendChild(overlay);
  _renderPtModal();
}

function closeParticipantsModal() {
  document.getElementById('pt-modal')?.remove();
  _ptTrnId = null;
  _refreshRosterTrn();
}

function _renderPtModal() {
  const inner = document.getElementById('pt-modal-inner');
  if (!inner) return;
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) { closeParticipantsModal(); return; }

  const db = loadPlayerDB();
  const parts  = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const wlist  = (trn.waitlist    || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const allIds = new Set([...(trn.participants||[]), ...(trn.waitlist||[])]);
  const free   = trn.capacity - parts.length;
  const pct    = Math.min(parts.length / (trn.capacity||1) * 100, 100);
  const isFull = parts.length >= trn.capacity;

  // Search results — show all if empty, filter if query
  const q = _ptSearch.trim().toLowerCase();
  const filtered = q
    ? db.filter(p => p.name.toLowerCase().includes(q))
    : db;
  // Sort alphabetically by name
  const searchResults = filtered
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .slice(0, q ? 10 : 20); // Show 10 if search, 20 if no query

  const gLabel = p => p.gender === 'M' ? 'М' : 'Ж';

  const srHtml = searchResults.length ? `
    <div class="pt-search-results">
      ${searchResults.map(p => {
        const alreadyIn = allIds.has(p.id);
        return `<div class="pt-sr-item" onclick="${alreadyIn ? '' : `ptAddPlayer('${escAttr(p.id)}')`}"
          style="${alreadyIn ? 'opacity:.45;cursor:default' : ''}">
          <span class="pt-sr-badge ${p.gender}">${gLabel(p)}</span>
          <span class="pt-sr-name">${esc(p.name)}</span>
          <span class="pt-sr-meta">${p.totalPts||0} оч. · ${p.tournaments||0} турн.</span>
          ${alreadyIn
            ? '<span class="pt-sr-badge in">✓ Добавлен</span>'
            : `<span style="color:var(--green);font-size:12px;flex-shrink:0">+ Добавить</span>`}
        </div>`;
      }).join('')}
    </div>` : '';

  const partsHtml = parts.length
    ? parts.map((p, i) => `
      <div class="pt-item">
        <span class="pt-item-num">${i+1}</span>
        <span class="pt-item-name">${esc(p.name)}</span>
        <span class="pt-item-g ${p.gender}">${gLabel(p)}</span>
        <button class="pt-item-del" onclick="ptRemoveParticipant('${escAttr(p.id)}')" title="Убрать">✕</button>
      </div>`).join('')
    : '<div class="pt-empty">Участников нет. Найдите игрока выше.</div>';

  const wlistHtml = wlist.length
    ? wlist.map((p, i) => `
      <div class="pt-item">
        <span class="pt-item-num">⏳</span>
        <span class="pt-item-name">${esc(p.name)}</span>
        <span class="pt-item-g ${p.gender}">${gLabel(p)}</span>
        ${!isFull
          ? `<button class="pt-item-promote" onclick="ptPromoteWaitlist('${escAttr(p.id)}')">→ Добавить</button>`
          : ''}
        <button class="pt-item-del" onclick="ptRemoveWaitlist('${escAttr(p.id)}')" title="Убрать">✕</button>
      </div>`).join('')
    : '<div class="pt-empty">Лист ожидания пуст.</div>';

  inner.innerHTML = `
    <div class="pt-hdr">
      <div class="pt-hdr-info">
        <div class="pt-hdr-title">👥 Участники</div>
        <div class="pt-hdr-sub">${esc(trn.name)} · ${free > 0 ? `Свободно ${free} мест` : '⛔ Заполнен'}</div>
      </div>
      <button class="pt-close" onclick="closeParticipantsModal()">✕</button>
    </div>
    <div class="pt-body">
      <div class="pt-cap-bar"><div class="pt-cap-fill${isFull?' full':''}" style="width:${pct}%"></div></div>

      <!-- Search -->
      <div class="pt-search-wrap">
        <span class="pt-search-ico">🔍</span>
        <input class="pt-search-inp" id="pt-search-inp" type="search"
          placeholder="Поиск игрока в базе…" value="${esc(_ptSearch)}"
          oninput="ptSetSearch(this.value)" autocomplete="off">
      </div>
      ${srHtml}

      <!-- Participants -->
      <div>
        <div class="pt-section-hdr">
          <span class="pt-section-ttl">Участники</span>
          <span class="pt-section-cnt">${parts.length}/${trn.capacity}</span>
        </div>
        <div class="pt-list">${partsHtml}</div>
      </div>

      <!-- Waitlist -->
      ${wlist.length > 0 ? `
      <div>
        <div class="pt-section-hdr">
          <span class="pt-section-ttl">📋 Лист ожидания</span>
          <span class="pt-section-cnt">${wlist.length}</span>
        </div>
        <div class="pt-list">${wlistHtml}</div>
      </div>` : ''}
    </div>
    <div class="pt-footer">
      <button class="pt-btn-export" onclick="ptExportCSV('${escAttr(_ptTrnId)}')">📥 Экспорт CSV</button>
      <button class="pt-btn-import" onclick="document.getElementById('pt-import-file').click()">📤 Импорт CSV</button>
      <input type="file" id="pt-import-file" accept=".csv" style="display:none" onchange="ptImportCSV(event)">
      <button class="pt-btn-close" onclick="closeParticipantsModal()">Закрыть</button>
    </div>`;

  // Attach search event handlers
  const inp = document.getElementById('pt-search-inp');
  if (inp) {
    // Remove old listeners
    inp.removeEventListener('input', ptSearchHandler);
    inp.removeEventListener('focus', ptFocusHandler);

    // Add new listeners
    inp.addEventListener('input', ptSearchHandler);
    inp.addEventListener('focus', ptFocusHandler);

    // Keep focus if was searching
    if (_ptSearch) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }
}

function ptFocusHandler(e) {
  // Show all players when input is focused
  if (!_ptSearch) {
    _renderPtModal();
  }
}

function ptSearchHandler(e) {
  ptSetSearch(e.target?.value || '');
}

// ── CSV Export ────────────────────────────────────────────────
function ptExportCSV(trnId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn) { showToast('Турнир не найден', 'error'); return; }

  const db = loadPlayerDB();
  const parts = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);

  // CSV header
  const csv = ['Фамилия,Пол'];

  // Rows (escape quotes and CSV formula injection)
  const csvSafe = s => {
    let v = String(s).replace(/"/g, '""');
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return `"${v}"`;
  };
  parts.forEach(p => {
    const gender = p.gender === 'M' ? 'М' : 'Ж';
    csv.push(`${csvSafe(p.name)},${gender}`);
  });

  // Download
  const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `ростер_${trn.name}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  showToast('CSV скачан', 'success');
}

// ── CSV Import ────────────────────────────────────────────────
function ptImportCSV(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const text = e.target?.result || '';
      const lines = text.trim().split('\n');
      if (lines.length < 2) throw new Error('Файл пуст или некорректен');

      const db = loadPlayerDB();
      const arr = getTournaments();
      const trn = arr.find(t => t.id === _ptTrnId);
      if (!trn) throw new Error('Турнир не найден');

      // Skip header (line 0), process data (lines 1+)
      let added = 0;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV: "Фамилия",Пол or Фамилия,Пол
        const match = line.match(/^"?([^",]+)"?,([МЖ])/);
        if (!match) continue;

        const name = match[1].trim();

        // Find player in DB
        const player = db.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!player) {
          console.warn(`Игрок "${name}" не найден в базе`);
          continue;
        }

        // Add if not already there
        if (!trn.participants.includes(player.id) && !trn.waitlist.includes(player.id)) {
          if (trn.participants.length < trn.capacity) {
            trn.participants.push(player.id);
          } else {
            trn.waitlist = trn.waitlist || [];
            trn.waitlist.push(player.id);
          }
          added++;
        }
      }

      saveTournaments(arr);
      _renderPtModal();
      showToast(`Импортировано ${added} игроков`, 'success');
    } catch (err) {
      console.error('CSV Import error:', err);
      showToast('❌ Ошибка при импорте: ' + err.message, 'error');
    }

    // Reset file input
    event.target.value = '';
  };
  reader.readAsText(file);
}

let _ptSearchTimer = null;
function ptSetSearch(val) {
  _ptSearch = val;
  clearTimeout(_ptSearchTimer);
  _ptSearchTimer = setTimeout(_renderPtModal, 150);
}

function ptAddPlayer(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  if (trn.participants.includes(playerId) || trn.waitlist.includes(playerId)) return;

  if (trn.participants.length < trn.capacity) {
    trn.participants.push(playerId);
    if (trn.participants.length >= trn.capacity) trn.status = 'full';
  } else {
    trn.waitlist.push(playerId);
    showToast('Места закончились — добавлен в лист ожидания', 'info');
  }
  saveTournaments(arr);
  _renderPtModal();
}

function ptRemoveParticipant(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  trn.participants = trn.participants.filter(id => id !== playerId);
  if (trn.status === 'full' && trn.participants.length < trn.capacity) trn.status = 'open';
  saveTournaments(arr);
  _renderPtModal();
}

function ptRemoveWaitlist(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  trn.waitlist = trn.waitlist.filter(id => id !== playerId);
  saveTournaments(arr);
  _renderPtModal();
}

function ptPromoteWaitlist(playerId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === _ptTrnId);
  if (!trn) return;
  if (trn.participants.length >= trn.capacity) {
    showToast('Нет свободных мест', 'error'); return;
  }
  trn.waitlist     = trn.waitlist.filter(id => id !== playerId);
  trn.participants.push(playerId);
  if (trn.participants.length >= trn.capacity) trn.status = 'full';
  saveTournaments(arr);
  _renderPtModal();
  showToast('Игрок переведён в участники', 'success');
}

// ══ Tournament Details Modal ══════════════════════════════════
function openTrnDetails(trnId) {
  document.getElementById('td-modal')?.remove();
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn) return;

  const db      = loadPlayerDB();
  const parts   = (trn.participants || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const wlist   = (trn.waitlist    || []).map(id => db.find(p => p.id === id)).filter(Boolean);
  const pct     = Math.min(parts.length / (trn.capacity||1) * 100, 100);
  const isFull  = trn.status === 'full' || parts.length >= trn.capacity;
  const isFinished = trn.status === 'finished';

  const pcls = (r,c) => { const p=r/c; return p>=1?'r':p>=.8?'y':'g'; };
  const c    = pcls(parts.length, trn.capacity);

  const LV_LABELS  = { hard:'ХАРД', medium:'СРЕДНИЙ', easy:'ЛАЙТ' };
  const ST_LABELS  = { open:'ОТКРЫТ', full:'ЗАПОЛНЕН', finished:'ЗАВЕРШЁН', cancelled:'ОТМЕНЁН' };
  const plrPills   = parts.slice(0, 8).map(p =>
    `<span class="td-plr-pill">${esc(p.name)}</span>`).join('');
  const moreParts  = parts.length > 8
    ? `<span class="td-plr-pill more">+${parts.length - 8}</span>` : '';

  const MEDALS = ['🥇','🥈','🥉'];
  const winnersHtml = isFinished && trn.winners?.length
    ? `<div class="td-section-ttl">🏆 Результаты</div>
       <div class="td-winners-list">
         ${trn.winners.map((slot, i) => {
           const names = (slot.playerIds || [])
             .map(id => db.find(p => p.id === id)?.name || '—')
             .join(', ');
           return `<div class="td-winner-row">
             <span class="td-winner-place">${MEDALS[slot.place-1] || slot.place}</span>
             <span class="td-winner-names">${esc(names)}</span>
             <span class="td-winner-pts">${slot.points} оч.</span>
           </div>`;
         }).join('')}
       </div>` : '';

  const wlistHtml = wlist.length && !isFinished
    ? `<div class="td-section-ttl">📋 Лист ожидания (${wlist.length})</div>
       <div class="td-plr-pills">
         ${wlist.slice(0,6).map(p=>`<span class="td-plr-pill">${esc(p.name)}</span>`).join('')}
         ${wlist.length>6?`<span class="td-plr-pill more">+${wlist.length-6}</span>`:''}
       </div>` : '';

  const overlay = document.createElement('div');
  overlay.id    = 'td-modal';
  overlay.className = 'td-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML = `
  <div class="td-modal">
    <div class="td-accent"></div>
    <div class="td-body">
      <div class="td-chips-row">
        <span class="td-chip lv-${trn.level || 'medium'}">${LV_LABELS[trn.level] || esc((trn.level||'').toUpperCase())}</span>
        <span class="td-chip">${esc(trn.division || '')}</span>
        <span class="td-chip st-${trn.status}">${ST_LABELS[trn.status] || trn.status}</span>
      </div>
      <div class="td-name">${esc(trn.name)}</div>
      <div class="td-info-row">🕐 <span>${formatTrnDate(trn.date)}${trn.time ? ', ' + esc(trn.time) : ''}</span></div>
      <div class="td-info-row">📍 <span>${esc(trn.location || '—')}</span></div>
      <div class="td-info-row">👑 <span>${esc(trn.format || 'King of the Court')}</span></div>
      ${trn.prize ? `<div class="td-prize-row">🏆 Призовой фонд: ${esc(trn.prize)}</div>` : ''}

      ${!isFinished ? `
      <div class="td-prog-wrap">
        <div class="td-prog-hdr">
          <span class="td-prog-lbl">Регистрация</span>
          <span class="td-prog-val ${c}">${parts.length}/${trn.capacity}</span>
        </div>
        <div class="td-prog-bar">
          <div class="td-prog-fill ${c}" style="width:${pct}%"></div>
        </div>
      </div>` : ''}

      ${winnersHtml}

      ${parts.length > 0 && !isFinished ? `
      <div class="td-section-ttl">👥 Участники (${parts.length})</div>
      <div class="td-plr-pills">${plrPills}${moreParts}</div>` : ''}

      ${wlistHtml}
    </div>
    <div class="td-footer">
      ${!isFinished
        ? `<button class="td-btn-reg ${isFull?'wait':''}" onclick="document.getElementById('td-modal')?.remove();openRegistrationModal('${escAttr(trn.id)}')">
            ${isFull ? '📋 В лист ожидания' : '⚡ Записаться'}
          </button>`
        : ''}
      <button class="td-btn-close" onclick="document.getElementById('td-modal')?.remove()">Закрыть</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}
