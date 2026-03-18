// vitest injects describe / it / beforeEach / expect globally — no imports needed
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// Minimal DOM / browser stubs so modules can be tested without a real browser.
// ─────────────────────────────────────────────────────────────────────────────

// localStorage stub
const _store = {};
const localStorage = {
  getItem:    k => Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null,
  setItem:    (k, v) => { _store[k] = String(v); },
  removeItem: k => { delete _store[k]; },
  clear:      () => { Object.keys(_store).forEach(k => delete _store[k]); },
};
globalThis.localStorage = localStorage;

// Minimal DOM stubs
globalThis.document = {
  getElementById: () => null,
  querySelector:  () => null,
  querySelectorAll: () => ({ forEach: () => {} }),
  createElement:  () => ({
    id: '', className: '', style: {}, innerHTML: '',
    addEventListener: () => {}, appendChild: () => {}, click: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    dataset: {},
  }),
  body: {
    appendChild: () => {},
    classList: { toggle: () => {} },
  },
};
globalThis.URL = {
  createObjectURL: () => 'blob:test',
  revokeObjectURL: () => {},
};
globalThis.Blob = class Blob { constructor(parts, opts) { this._parts = parts; this.type = opts?.type || ''; } };
globalThis.window = { scrollTo: () => {} };
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);

// ─────────────────────────────────────────────────────────────────────────────
// Stub global functions that modules call but we don't need to test here
// ─────────────────────────────────────────────────────────────────────────────
const _toasts = [];
globalThis.showToast    = (msg, type) => { _toasts.push({ msg, type }); };
globalThis.showConfirm  = async (msg) => true;
globalThis.esc          = s => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
globalThis.escAttr      = s => globalThis.esc(String(s || ''));

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory player DB
// ─────────────────────────────────────────────────────────────────────────────
let _playerDB = [];

globalThis.loadPlayerDB   = () => _playerDB.slice();
globalThis.savePlayerDB   = db => { _playerDB = db.slice(); };
globalThis.addPlayerToDB  = (name, gender) => {
  if (_playerDB.find(p => p.name === name && p.gender === gender)) return false;
  const p = { id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name, gender, totalPts: 0, tournaments: 0, wins: 0 };
  _playerDB.push(p);
  return true;
};
globalThis.upsertPlayerInDB = (data) => {
  const idx = _playerDB.findIndex(p => p.id === data.id ||
    (p.name.toLowerCase() === (data.name||'').toLowerCase() && p.gender === data.gender));
  if (idx !== -1) { _playerDB[idx] = { ..._playerDB[idx], ...data }; return _playerDB[idx]; }
  const p = { id: data.id || ('p_' + Date.now()), totalPts: 0, tournaments: 0, wins: 0, ...data };
  _playerDB.push(p);
  return p;
};
globalThis.removePlayerFromDB = id => { _playerDB = _playerDB.filter(p => p.id !== id); };

// ─────────────────────────────────────────────────────────────────────────────
// Minimal in-memory tournament store
// ─────────────────────────────────────────────────────────────────────────────
let _tournaments = [];
globalThis.getTournaments  = () => _tournaments.slice();
globalThis.saveTournaments = arr => { _tournaments = arr.slice(); };

// ─────────────────────────────────────────────────────────────────────────────
// domain helpers stubs
// ─────────────────────────────────────────────────────────────────────────────
globalThis.calculateRanking = place => {
  if (place === 1) return 100;
  if (place === 2) return 80;
  if (place === 3) return 60;
  return Math.max(0, 50 - place * 5);
};
globalThis.divisionToType = division => {
  if (division === 'Мужской') return 'M';
  if (division === 'Женский') return 'W';
  return 'Mix';
};
globalThis.formatTrnDate = iso => iso || '';

// _refreshRosterTrn stub
globalThis._refreshRosterTrn = () => {};

// syncPlayersFromRoster stub
globalThis.syncPlayersFromRoster = () => {};

// saveState stub
globalThis.tournamentMeta = { name: '', date: '' };
globalThis.saveState = () => {};

// ─────────────────────────────────────────────────────────────────────────────
// Load the modules under test by evaluating their source inline.
// Using eval avoids ESM vs CJS issues while keeping tests self-contained.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

function loadModule(relPath) {
  const src = readFileSync(path.join(root, relPath), 'utf8');
  // Strip 'use strict' directive so it doesn't prevent global assignment
  const stripped = src.replace(/^\s*'use strict'[;]?/m, '');
  // eslint-disable-next-line no-eval
  (0, eval)(stripped);
}

// Load in dependency order — same as APP_SCRIPT_ORDER
loadModule('assets/js/ui/results-form.js');        // defines _buildPlayerMap, PRESETS, _resState, etc.
loadModule('assets/js/ui/stats-recalc.js');        // defines recalcAllPlayerStats
loadModule('assets/js/ui/tournament-form.js');     // defines submitTournamentForm, rosterTrnFormOpen, etc.
loadModule('assets/js/ui/participants-modal.js');  // defines ptAddPlayer, ptExportCSV, etc.

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function resetDB() {
  _playerDB = [];
  _tournaments = [];
  _toasts.length = 0;
  localStorage.clear();
}

function makeTrn(overrides = {}) {
  return {
    id: 't_test_' + Date.now(),
    name: 'Тест Турнир',
    date: '2026-03-18',
    time: '10:00',
    location: 'Пляж',
    format: 'King of Court',
    division: 'Мужской',
    level: 'medium',
    prize: '',
    capacity: 16,
    status: 'open',
    participants: [],
    waitlist: [],
    winners: [],
    ...overrides,
  };
}

function makePlayer(overrides = {}) {
  return upsertPlayerInDB({
    id: 'p_' + Math.random().toString(36).slice(2),
    name: 'Игрок ' + Math.random().toString(36).slice(2, 5),
    gender: 'M',
    totalPts: 0,
    tournaments: 0,
    wins: 0,
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: recalcAllPlayerStats
// ─────────────────────────────────────────────────────────────────────────────
describe('recalcAllPlayerStats', () => {
  beforeEach(() => { resetDB(); });

  it('сбрасывает счётчики перед пересчётом', () => {
    const p = makePlayer({ totalPts: 999, tournaments: 99, wins: 10, ratingM: 500, tournamentsM: 50 });
    saveTournaments([]);
    recalcAllPlayerStats(true);
    const db = loadPlayerDB();
    const updated = db.find(x => x.id === p.id);
    assert.equal(updated.totalPts, 0);
    assert.equal(updated.tournaments, 0);
    assert.equal(updated.wins, 0);
    assert.equal(updated.ratingM, 0);
    assert.equal(updated.tournamentsM, 0);
  });

  it('суммирует очки из завершённых турниров', () => {
    const p = makePlayer({ name: 'Иванов', gender: 'M' });
    const trn = makeTrn({
      status: 'finished',
      division: 'Мужской',
      ratingType: 'M',
      winners: [
        { place: 1, playerIds: [p.id], points: 100 },
        { place: 2, playerIds: [], points: 80 },
        { place: 3, playerIds: [], points: 60 },
      ],
    });
    saveTournaments([trn]);
    recalcAllPlayerStats(true);
    const db = loadPlayerDB();
    const updated = db.find(x => x.id === p.id);
    assert.equal(updated.totalPts, 100);
    assert.equal(updated.tournaments, 1);
    assert.equal(updated.wins, 1);
    assert.equal(updated.ratingM, calculateRanking(1));
    assert.equal(updated.tournamentsM, 1);
  });

  it('идемпотентен — двойной вызов не дублирует очки', () => {
    const p = makePlayer({ name: 'Петров', gender: 'M' });
    const trn = makeTrn({
      status: 'finished',
      ratingType: 'M',
      winners: [{ place: 1, playerIds: [p.id], points: 100 }],
    });
    saveTournaments([trn]);
    recalcAllPlayerStats(true);
    recalcAllPlayerStats(true);
    const db = loadPlayerDB();
    const updated = db.find(x => x.id === p.id);
    assert.equal(updated.totalPts, 100, 'totalPts не должен дублироваться');
    assert.equal(updated.tournaments, 1, 'tournaments не должен дублироваться');
  });

  it('в silent=true не вызывает showToast', () => {
    _toasts.length = 0;
    saveTournaments([]);
    recalcAllPlayerStats(true);
    assert.equal(_toasts.length, 0);
  });

  it('в silent=false вызывает showToast', () => {
    _toasts.length = 0;
    saveTournaments([]);
    recalcAllPlayerStats(false);
    assert.equal(_toasts.length, 1);
    assert.ok(_toasts[0].msg.includes('пересчитан'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: submitTournamentForm
// ─────────────────────────────────────────────────────────────────────────────
describe('submitTournamentForm', () => {
  beforeEach(() => {
    resetDB();
    rosterTrnFormOpen = false;
    rosterTrnEditId   = null;
    // Mock getElementById to return filled inputs
    globalThis.document.getElementById = id => {
      const values = {
        'trnf-name':         { value: 'Кубок Пляжа', classList: { add: () => {}, remove: () => {} } },
        'trnf-date':         { value: '2026-03-18',  classList: { add: () => {}, remove: () => {} } },
        'trnf-time':         { value: '10:00',       classList: { add: () => {}, remove: () => {} } },
        'trnf-loc':          { value: 'Пляж',        classList: { add: () => {}, remove: () => {} } },
        'trnf-format':       { value: 'King of Court', classList: { add: () => {}, remove: () => {} } },
        'trnf-div':          { value: 'Мужской',     classList: { add: () => {}, remove: () => {} } },
        'trnf-level':        { value: 'medium',      classList: { add: () => {}, remove: () => {} } },
        'trnf-prize-toggle': { checked: false,       classList: { add: () => {}, remove: () => {} } },
        'trnf-prize':        { value: '',            classList: { add: () => {}, remove: () => {} } },
        'trnf-cap':          { value: '16',          classList: { add: () => {}, remove: () => {} } },
      };
      return values[id] || { value: '', classList: { add: () => {}, remove: () => {} } };
    };
    globalThis.document.querySelectorAll = () => ({ forEach: () => {} });
  });

  it('создаёт новый турнир при корректных данных', () => {
    saveTournaments([]);
    submitTournamentForm();
    const arr = getTournaments();
    assert.equal(arr.length, 1);
    assert.equal(arr[0].name, 'Кубок Пляжа');
    assert.equal(arr[0].status, 'open');
    assert.ok(Array.isArray(arr[0].participants));
    assert.ok(Array.isArray(arr[0].waitlist));
    assert.ok(Array.isArray(arr[0].winners));
  });

  it('показывает ошибку если capacity < 4', () => {
    const origGet = globalThis.document.getElementById;
    globalThis.document.getElementById = id => {
      if (id === 'trnf-cap') return { value: '2', classList: { add: () => {}, remove: () => {} } };
      return origGet(id);
    };
    _toasts.length = 0;
    submitTournamentForm();
    assert.ok(_toasts.some(t => t.type === 'error'));
  });

  it('редактирует существующий турнир при rosterTrnEditId !== null', () => {
    const existing = makeTrn({ id: 'edit_id', name: 'Старый турнир' });
    saveTournaments([existing]);
    rosterTrnEditId = 'edit_id';
    submitTournamentForm();
    const arr = getTournaments();
    assert.equal(arr.length, 1);
    assert.equal(arr[0].name, 'Кубок Пляжа');
    assert.equal(arr[0].id, 'edit_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: ptAddPlayer
// ─────────────────────────────────────────────────────────────────────────────
describe('ptAddPlayer', () => {
  beforeEach(() => {
    resetDB();
    globalThis.document.getElementById = id => {
      if (id === 'pt-modal-inner') return {
        innerHTML: '',
        querySelectorAll: () => ({ forEach: () => {} }),
        addEventListener: () => {},
        removeEventListener: () => {},
        focus: () => {},
        setSelectionRange: () => {},
      };
      return null;
    };
    // Override _renderPtModal to no-op to avoid DOM issues
    globalThis._renderPtModal = () => {};
  });

  it('добавляет игрока в participants если есть место', () => {
    const p = makePlayer({ name: 'Сидоров' });
    const trn = makeTrn({ capacity: 4 });
    saveTournaments([trn]);
    _ptTrnId = trn.id;
    ptAddPlayer(p.id);
    const arr = getTournaments();
    assert.ok(arr[0].participants.includes(p.id));
  });

  it('добавляет в waitlist если турнир заполнен', () => {
    const players = Array.from({ length: 4 }, (_, i) => makePlayer({ name: 'Игрок' + i }));
    const trn = makeTrn({
      capacity: 4,
      participants: players.map(p => p.id),
      status: 'full',
    });
    saveTournaments([trn]);
    const extra = makePlayer({ name: 'Экстра' });
    _ptTrnId = trn.id;
    ptAddPlayer(extra.id);
    const arr = getTournaments();
    assert.ok(arr[0].waitlist.includes(extra.id));
    assert.ok(_toasts.some(t => t.msg.includes('ожидания')));
  });

  it('не добавляет дубликата', () => {
    const p = makePlayer({ name: 'Дублирующий' });
    const trn = makeTrn({ capacity: 10, participants: [p.id] });
    saveTournaments([trn]);
    _ptTrnId = trn.id;
    ptAddPlayer(p.id);
    const arr = getTournaments();
    assert.equal(arr[0].participants.filter(id => id === p.id).length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: ptExportCSV
// ─────────────────────────────────────────────────────────────────────────────
describe('ptExportCSV', () => {
  let _lastBlob = null;
  let _lastFilename = null;

  beforeEach(() => {
    resetDB();
    _lastBlob = null;
    _lastFilename = null;
    globalThis.document.createElement = tag => {
      const el = {
        id: '', className: '', style: {}, innerHTML: '', href: '', download: '',
        addEventListener: () => {}, appendChild: () => {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
        dataset: {},
        click: () => {
          if (el.download) _lastFilename = el.download;
        },
      };
      return el;
    };
    globalThis.document.body.appendChild = el => {
      if (el.download) _lastFilename = el.download;
    };
    globalThis.document.body.removeChild = () => {};
    // Capture Blob contents
    globalThis.Blob = class Blob {
      constructor(parts, opts) {
        this._parts = parts;
        this.type = opts?.type || '';
        _lastBlob = this;
      }
    };
  });

  it('CSV начинается с правильного заголовка', () => {
    const p = makePlayer({ name: 'Тестов', gender: 'M' });
    const trn = makeTrn({ participants: [p.id] });
    saveTournaments([trn]);
    ptExportCSV(trn.id);
    assert.ok(_lastBlob, 'Blob должен быть создан');
    const content = _lastBlob._parts.join('');
    assert.ok(content.startsWith('Фамилия,Пол'), 'Первая строка — заголовок');
  });

  it('csvSafe защищает от formula injection', () => {
    const dangerous = makePlayer({ name: '=CMD|"/c calc"', gender: 'M' });
    const trn = makeTrn({ participants: [dangerous.id] });
    saveTournaments([trn]);
    ptExportCSV(trn.id);
    const content = _lastBlob._parts.join('');
    // Строка не должна начинаться с = без префикса-кавычки
    const dataLines = content.split('\n').slice(1);
    dataLines.forEach(line => {
      if (line.trim()) {
        // Содержимое в кавычках не должно начинаться с =
        const inner = line.replace(/^"|"$/g, '').replace(/""/g, '"');
        // После csvSafe опасные символы экранированы одинарной кавычкой
        assert.ok(!inner.startsWith('='), 'Formula injection защищена');
      }
    });
  });

  it('показывает ошибку если турнир не найден', () => {
    _toasts.length = 0;
    ptExportCSV('nonexistent_id');
    assert.ok(_toasts.some(t => t.type === 'error'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: resAddPlayer
// ─────────────────────────────────────────────────────────────────────────────
describe('resAddPlayer', () => {
  beforeEach(() => {
    resetDB();
    _resState = null;
    // Stub _reRenderSlots
    globalThis._reRenderSlots = () => {};
  });

  function initResState(trnId) {
    _resState = {
      trnId,
      newPlayerSlotIdx: null,
      preset: 'standard',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: [], points: 100 },
        { place: 2, playerIds: [], points: 80  },
        { place: 3, playerIds: [], points: 60  },
      ],
    };
  }

  it('добавляет игрока в слот', () => {
    const p = makePlayer({ name: 'Алексеев' });
    const trn = makeTrn();
    saveTournaments([trn]);
    initResState(trn.id);
    resAddPlayer(0, p.id);
    assert.ok(_resState.slots[0].playerIds.includes(p.id));
  });

  it('не позволяет добавить более 2 игроков в слот', () => {
    const p1 = makePlayer({ name: 'Первый' });
    const p2 = makePlayer({ name: 'Второй' });
    const p3 = makePlayer({ name: 'Третий' });
    const trn = makeTrn();
    saveTournaments([trn]);
    initResState(trn.id);
    resAddPlayer(0, p1.id);
    resAddPlayer(0, p2.id);
    _toasts.length = 0;
    resAddPlayer(0, p3.id);
    assert.equal(_resState.slots[0].playerIds.length, 2);
    assert.ok(_toasts.some(t => t.type === 'error'));
  });

  it('не позволяет добавить дубликат в другой слот', () => {
    const p = makePlayer({ name: 'Уникальный' });
    const trn = makeTrn();
    saveTournaments([trn]);
    initResState(trn.id);
    resAddPlayer(0, p.id);
    _toasts.length = 0;
    resAddPlayer(1, p.id);
    assert.ok(!_resState.slots[1].playerIds.includes(p.id));
    assert.ok(_toasts.some(t => t.type === 'error'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: saveResults
// ─────────────────────────────────────────────────────────────────────────────
describe('saveResults', () => {
  beforeEach(() => {
    resetDB();
    _resState = null;
    // Stub DOM methods needed by saveResults
    globalThis.document.getElementById = id => {
      if (id === 'results-modal') return { remove: () => {} };
      return null;
    };
    // Override recalcAllPlayerStats to track calls
    globalThis._recalcCalled = false;
    const orig = globalThis.recalcAllPlayerStats;
    globalThis.recalcAllPlayerStats = (silent) => {
      globalThis._recalcCalled = true;
      orig(silent);
    };
  });

  function initFullResState(trnId) {
    const p1 = makePlayer({ name: 'Золото' });
    const p2 = makePlayer({ name: 'Серебро' });
    const p3 = makePlayer({ name: 'Бронза' });
    _resState = {
      trnId,
      newPlayerSlotIdx: null,
      preset: 'standard',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: [p1.id], points: 100 },
        { place: 2, playerIds: [p2.id], points: 80  },
        { place: 3, playerIds: [p3.id], points: 60  },
      ],
    };
    return { p1, p2, p3 };
  }

  it('показывает ошибку если заполнено менее 3 мест', () => {
    const trn = makeTrn();
    saveTournaments([trn]);
    _resState = {
      trnId: trn.id,
      newPlayerSlotIdx: null,
      preset: 'standard',
      trnType: 'M',
      slots: [
        { place: 1, playerIds: [], points: 100 },
        { place: 2, playerIds: [], points: 80  },
        { place: 3, playerIds: [], points: 60  },
      ],
    };
    _toasts.length = 0;
    saveResults();
    assert.ok(_toasts.some(t => t.type === 'error'));
  });

  it('добавляет audit log запись', () => {
    const trn = makeTrn();
    saveTournaments([trn]);
    initFullResState(trn.id);
    saveResults();
    const arr = getTournaments();
    assert.ok(Array.isArray(arr[0].history));
    assert.equal(arr[0].history.length, 1);
    assert.equal(arr[0].history[0].action, 'finished');
  });

  it('вызывает recalcAllPlayerStats', () => {
    const trn = makeTrn();
    saveTournaments([trn]);
    initFullResState(trn.id);
    globalThis._recalcCalled = false;
    saveResults();
    assert.ok(globalThis._recalcCalled);
  });

  it('второй вызов создаёт audit log с action=edited', () => {
    const trn = makeTrn({ status: 'finished' });
    saveTournaments([trn]);
    initFullResState(trn.id);
    // Первое сохранение
    saveResults();
    // Второе сохранение (редактирование)
    const trn2 = getTournaments()[0];
    initFullResState(trn2.id);
    _resState.trnId = trn2.id; // ensure correct trnId
    // Восстанавливаем состояние как если бы турнир уже finished
    saveTournaments([{ ...trn2, status: 'finished' }]);
    const { p1, p2, p3 } = initFullResState(trn2.id);
    saveResults();
    const arr = getTournaments();
    const last = arr[0].history[arr[0].history.length - 1];
    assert.equal(last.action, 'edited');
  });
});
