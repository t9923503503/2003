'use strict';

function setHomeTab(tab) {
  homeActiveTab = tab;
  if (tab !== 'archive') homeArchiveFormOpen = false;
  const s = document.getElementById('screen-home');
  if (s) s.innerHTML = renderHome();
}

// ── Manual past tournaments CRUD ───────────────────────────
// loadManualTournaments / saveManualTournaments defined above as shims over kotc3_tournaments
function submitManualTournament() {
  const v = id => document.getElementById(id)?.value;
  const name     = (v('arch-inp-name') || '').trim();
  const date     =  v('arch-inp-date') || '';
  const format   =  v('arch-inp-fmt')  || 'King of the Court';
  const division =  v('arch-inp-div')  || 'Мужской';
  if (!name || !date) { showToast('⚠️ Введите название и дату'); return; }

  const playerResults = [...homeArchiveFormPlayers].sort((a,b) => b.pts - a.pts);
  const playersCount  = playerResults.length || (parseInt(v('arch-inp-players')||'0')||0);
  const winner        = playerResults[0]?.name || (v('arch-inp-winner')||'').trim();

  // Save to archive
  const arr = loadManualTournaments();
  arr.unshift({ id: Date.now(), name, date, format, division,
    playersCount, winner, playerResults, source: 'manual' });
  saveManualTournaments(arr);

  // Sync players → playerDB (each player gets +1 tournament, +pts)
  if (playerResults.length) {
    syncPlayersFromTournament(
      playerResults.map(p => ({ name: p.name, gender: p.gender, totalPts: p.pts })),
      date
    );
    showToast(`✅ Турнир сохранён · ${playerResults.length} игроков в базу`);
  } else {
    showToast('✅ Турнир добавлен в архив');
  }

  homeArchiveFormOpen = false;
  homeArchiveFormPlayers = [];
  setHomeTab('archive');
}
function deleteManualTournament(id) {
  saveManualTournaments(loadManualTournaments().filter(t => t.id !== id));
  setHomeTab('archive');
}
function toggleArchiveForm() {
  homeArchiveFormOpen = !homeArchiveFormOpen;
  if (homeArchiveFormOpen) homeArchiveFormPlayers = [];
  const s = document.getElementById('screen-home');
  if (s) s.innerHTML = renderHome();
}

function setArchFormGender(g) {
  homeArchiveFormGender = g;
  // just update the buttons visually without full re-render
  ['M','W'].forEach(x => {
    const b = document.getElementById('arch-g-btn-'+x);
    if (b) b.className = 'arch-plr-g-btn' + (x===g?' sel-'+g:'');
  });
}

function addArchFormPlayer() {
  const nameEl = document.getElementById('arch-plr-inp');
  const ptsEl  = document.getElementById('arch-plr-pts-inp');
  const name   = (nameEl?.value || '').trim();
  const pts    = parseInt(ptsEl?.value || '0') || 0;
  if (!name) { showToast('⚠️ Введите фамилию'); return; }
  homeArchiveFormPlayers.push({ name, pts, gender: homeArchiveFormGender });
  homeArchiveFormPlayers.sort((a,b) => b.pts - a.pts);
  nameEl.value = ''; ptsEl.value = '';
  _refreshArchPlrList();
  nameEl.focus();
}

function removeArchFormPlayer(idx) {
  homeArchiveFormPlayers.splice(idx, 1);
  _refreshArchPlrList();
}

function _refreshArchPlrList() {
  const el = document.getElementById('arch-plr-list-wrap');
  if (el) el.innerHTML = _archPlrListHtml();
}

function _archPlrListHtml() {
  if (!homeArchiveFormPlayers.length)
    return '<div class="arch-plr-empty">Игроки не добавлены — очки не запишутся в базу</div>';
  return `<div class="arch-plr-count">${homeArchiveFormPlayers.length} игроков</div>
<div class="arch-plr-list">` +
    homeArchiveFormPlayers.map((p,i) => `
  <div class="arch-plr-row">
    <span class="arch-plr-row-rank">${MEDALS_3[i]||i+1}</span>
    <span class="arch-plr-row-name">${esc(p.name)}</span>
    <span class="arch-plr-row-g ${p.gender}">${p.gender==='M'?'М':'Ж'}</span>
    <span class="arch-plr-row-pts">${p.pts}</span>
    <button class="arch-plr-row-del" onclick="removeArchFormPlayer(${i})">✕</button>
  </div>`).join('') + '</div>';
}

function renderHome() {
  const T = loadUpcomingTournaments();
  const totalReg  = T.reduce((s,t) => s + t.participants.length, 0);
  const openCount = T.filter(t => t.status === 'open').length;

  // helpers
  const pct  = (r,c) => c ? Math.min(r/c*100, 100) : 0;
  const pcls = (r,c) => { if (!c) return 'g'; const p=r/c; return p>=1?'r':p>=.8?'y':'g'; };

  function cardHtml(t) {
    const c  = pcls(t.participants.length, t.capacity);
    const ac = t.status==='open' ? 'var(--gold)' : '#2a2a44';
    const div = t.division==='Мужской'?'♂':'♀';
    return `
<div class="trn-card" onclick="openTrnDetails('${escAttr(t.id)}')" style="cursor:pointer">
  <div class="trn-card-accent" style="background:${ac}"></div>
  <div class="trn-card-body">
    <div class="trn-card-head">
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
        <span class="trn-lv ${t.level}">${t.level.toUpperCase()}</span>
        <span style="font-size:10px;color:var(--muted);background:rgba(255,255,255,.06);
          padding:2px 7px;border-radius:6px">${esc(t.division)}</span>
      </div>
      <span class="trn-st ${t.status}">
        <span class="trn-st-dot"></span>
        ${t.status==='open'?'ОТКРЫТ':'ЗАПОЛНЕНО'}
      </span>
    </div>
    <div class="trn-fmt">👑 ${esc(t.format)}</div>
    <div class="trn-name">${esc(t.name)}</div>
    <div class="trn-meta">🕐 <span>${esc(t.date)}, ${esc(t.time)}</span></div>
    <div class="trn-meta">📍 <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${esc(t.location)}</span></div>
    ${t.prize ? `<div class="trn-prize">🏆 Призовой фонд: ${esc(t.prize)}</div>` : ''}
    <div class="trn-prog">
      <div class="trn-prog-hdr">
        <span class="trn-prog-lbl">Регистрация</span>
        <span class="trn-prog-val ${c}">${t.participants.length}/${t.capacity}</span>
      </div>
      <div class="trn-prog-bar">
        <div class="trn-prog-fill ${c}" style="width:${pct(t.participants.length,t.capacity)}%"></div>
      </div>
    </div>
    <button class="trn-btn ${t.status}"
      onclick="event.stopPropagation();openTrnDetails('${escAttr(t.id)}')">
      ${t.status==='open'?'⚡ Записаться':'📋 В лист ожидания'}
    </button>
  </div>
</div>`;
  }

  function calRow(t) {
    const c = t.status==='open' ? 'g' : 'r';
    return `
<div class="cal-row" onclick="showTournament('${escAttr(t.id)}')" style="cursor:pointer">
  <div class="cal-date-box">
    <div class="cal-dn">${t.dayNum}</div>
    <div class="cal-ds">${t.dayStr}</div>
  </div>
  <div class="cal-info">
    <div class="cal-info-name">${esc(t.name)}</div>
    <div class="cal-info-meta">
      <span>🕐 ${esc(t.time)}</span>
      <span class="trn-lv ${t.level}" style="font-size:9px;padding:1px 5px">${t.level.toUpperCase()}</span>
      <span>${esc(t.division)}</span>
    </div>
  </div>
  <div class="cal-right">
    <span class="trn-st ${t.status}" style="font-size:9px;padding:2px 6px">
      <span class="trn-st-dot"></span>${t.status==='open'?'ОТКРЫТ':'ЗАПОЛНЕНО'}
    </span>
    <span class="cal-slots ${c}">${t.participants.length}/${t.capacity}</span>
  </div>
</div>`;
  }

  // group by month for calendar
  const byMonth = {};
  T.forEach(t => { (byMonth[t.month] = byMonth[t.month]||[]).push(t); });
  const calHtml = Object.entries(byMonth).map(([m, ts]) => `
<div class="cal-month">
  <div class="cal-month-hdr">
    <span class="cal-month-title">${m}</span>
    <div class="cal-month-line"></div>
    <span class="cal-month-count">${ts.length} турн.</span>
  </div>
  ${ts.map(calRow).join('')}
</div>`).join('');

  const isS = homeActiveTab === 'schedule';
  const isC = homeActiveTab === 'calendar';
  const isA = homeActiveTab === 'archive';

  // ── Archive content builder ─────────────────────────────
  function archCardHtml(t) {
    const isApp = t.source === 'app';
    let dateStr = '—';
    dateStr = fmtDateLong(t.date);
    const winner = t.winner || (t.players && t.players[0] ? t.players[0].name : '');
    const cnt    = t.playersCount || (t.players ? t.players.length : 0);
    const rds    = t.rPlayed ? `🏐 ${t.rPlayed} раундов` : '';
    return `
<div class="arch-card">
  <div class="arch-card-accent"></div>
  <div class="arch-card-body">
    <div class="arch-card-top">
      <div>
        <div class="arch-name">${esc(t.name)}</div>
        <div class="arch-date">📅 ${dateStr}</div>
      </div>
      <div class="arch-badges">
        <span class="arch-src ${isApp?'app':'manual'}">${isApp?'📱 Приложение':'✏️ Вручную'}</span>
        ${!isApp?`<button class="arch-del-btn" onclick="deleteManualTournament(${t.id})" title="Удалить">✕</button>`:''}
      </div>
    </div>
    <div class="arch-meta">
      <span class="arch-chip">${esc(t.format||'King of the Court')}</span>
      <span class="arch-chip">${esc(t.division||'—')}</span>
      ${cnt?`<span class="arch-chip blue">👥 ${cnt} игроков</span>`:''}
      ${rds?`<span class="arch-chip blue">${rds}</span>`:''}
      ${winner?`<span class="arch-chip gold">🥇 ${esc(winner)}</span>`:''}
    </div>
    ${t.playerResults?.length>1 ? `
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:3px">
      ${t.playerResults.slice(0,5).map((p,i)=>{
        return `<span style="font-size:10px;padding:2px 7px;border-radius:5px;
          background:rgba(255,255,255,.05);border:1px solid #2a2a40;color:var(--muted)">
          ${MEDALS_3[i]||'·'} ${esc(p.name)} ${p.pts?`<b style="color:var(--gold)">${p.pts}</b>`:''}
        </span>`;
      }).join('')}
      ${t.playerResults.length>5?`<span style="font-size:10px;color:var(--muted)">+${t.playerResults.length-5}</span>`:''}
    </div>` : ''}
  </div>
</div>`;
  }

  const archiveHtml = (() => {
    const appT = (() => {
      try {
        return (JSON.parse(localStorage.getItem('kotc3_history')||'[]'))
          .map(t => ({...t, source:'app', playersCount:t.players?.length||0,
            winner: t.players?.[0]?.name||'',
            format: t.format||'King of the Court', division: t.division||'Смешанный'}));
      } catch(e){ return []; }
    })();
    const manT = loadManualTournaments();
    const all  = [...appT, ...manT].sort((a,b) => (b.date||'') > (a.date||'') ? 1 : -1);

    const formHtml = homeArchiveFormOpen ? `
<div class="arch-add-form">
  <div class="arch-form-title">✏️ Добавить прошедший турнир</div>
  <div class="arch-form-grid">
    <input class="arch-form-inp arch-form-full" id="arch-inp-name"
      type="text" placeholder="Название турнира *">
    <input class="arch-form-inp" id="arch-inp-date"
      type="date" value="${new Date().toISOString().split('T')[0]}">
    <select class="arch-form-sel" id="arch-inp-fmt">
      <option>King of the Court</option>
      <option>Round Robin</option>
      <option>Олимпийская система</option>
      <option>Другой</option>
    </select>
    <select class="arch-form-sel" id="arch-inp-div">
      <option>Мужской</option>
      <option>Женский</option>
      <option>Смешанный</option>
    </select>
  </div>

  <!-- Player results section -->
  <div class="arch-plr-section">
    <div class="arch-plr-section-title">👥 Результаты игроков (необязательно)</div>
    <div class="arch-plr-add-row">
      <input class="arch-form-inp arch-plr-name" id="arch-plr-inp"
        type="text" placeholder="Фамилия"
        onkeydown="if(event.key==='Enter')addArchFormPlayer()">
      <input class="arch-form-inp arch-plr-pts" id="arch-plr-pts-inp"
        type="number" min="0" max="999" placeholder="Очки"
        onkeydown="if(event.key==='Enter')addArchFormPlayer()">
      <div class="arch-plr-gender-wrap">
        <button id="arch-g-btn-M" class="arch-plr-g-btn sel-M" onclick="setArchFormGender('M')">М</button>
        <button id="arch-g-btn-W" class="arch-plr-g-btn" onclick="setArchFormGender('W')">Ж</button>
      </div>
      <button class="arch-plr-add-btn" onclick="addArchFormPlayer()">+</button>
    </div>
    <div id="arch-plr-list-wrap">${_archPlrListHtml()}</div>
  </div>

  <button class="arch-save-btn" onclick="submitManualTournament()">
    💾 Сохранить${homeArchiveFormPlayers.length ? ` (${homeArchiveFormPlayers.length} игроков → база)` : ' в архив'}
  </button>
</div>` : '';

    const listHtml = all.length === 0 ? `
<div class="arch-empty">
  <div class="arch-empty-icon">🏆</div>
  Архив пуст. Завершите турнир в приложении<br>или добавьте прошедший вручную.
</div>` : (() => {
      const appOnes = all.filter(t=>t.source==='app');
      const manOnes = all.filter(t=>t.source==='manual');
      let html = '';
      if (appOnes.length) {
        html += `<div class="arch-divider"><div class="arch-divider-line"></div><span class="arch-divider-txt">📱 Из приложения (${appOnes.length})</span><div class="arch-divider-line"></div></div>`;
        html += appOnes.map(archCardHtml).join('');
      }
      if (manOnes.length) {
        html += `<div class="arch-divider"><div class="arch-divider-line"></div><span class="arch-divider-txt">✏️ Добавлены вручную (${manOnes.length})</span><div class="arch-divider-line"></div></div>`;
        html += manOnes.map(archCardHtml).join('');
      }
      return html;
    })();

    return formHtml + listHtml;
  })();

  return `
<div class="home-wrap">
  <!-- Hero -->
  <div class="home-hero">
    <div class="home-badge">🔥 Сезон 2026 — уже открыт!</div>
    <div class="home-title">ДОМИНИРУЙ НА<br><span>КОРТЕ</span></div>
    <div class="home-subtitle">Записывайся на турниры, следи за рейтингом<br>и становись королём пляжного волейбола</div>
    <div class="home-stats">
      <div class="home-stat"><div class="home-stat-val">${T.length}</div><div class="home-stat-lbl">Турниров</div></div>
      <div class="home-stat"><div class="home-stat-val">${totalReg}+</div><div class="home-stat-lbl">Участников</div></div>
      <div class="home-stat"><div class="home-stat-val">${openCount}</div><div class="home-stat-lbl">Открыто</div></div>
    </div>
  </div>

  <!-- Player DB banner -->
  ${(() => {
    const db = loadPlayerDB();
    const total = db.length;
    const men   = db.filter(p=>p.gender==='M').length;
    const women = db.filter(p=>p.gender==='W').length;
    // pick up to 2 real names for avatars
    const topM = db.filter(p=>p.gender==='M').sort((a,b)=>(b.totalPts||0)-(a.totalPts||0))[0];
    const topW = db.filter(p=>p.gender==='W').sort((a,b)=>(b.totalPts||0)-(a.totalPts||0))[0];
    const av1  = topM ? topM.name.slice(0,2).toUpperCase() : '🏋️';
    const av2  = topW ? topW.name.slice(0,2).toUpperCase() : '👩';
    const av3  = total > 2 ? `+${total-2}` : '👤';
    return `
  <button class="plr-banner" onclick="switchTab('players')">
    <div class="plr-banner-avatars">
      <div class="plr-av" title="${topM?escAttr(topM.name):'Мужчины'}">${av1}</div>
      <div class="plr-av" title="${topW?escAttr(topW.name):'Женщины'}">${av2}</div>
      <div class="plr-av">${av3}</div>
    </div>
    <div class="plr-banner-body">
      <div class="plr-banner-title">👤 БАЗА <span>ИГРОКОВ</span></div>
      <div class="plr-banner-sub">Управляй составом · История · Статистика</div>
      <div class="plr-banner-pill">
        🏋️ ${men} муж &nbsp;·&nbsp; 👩 ${women} жен &nbsp;·&nbsp; Всего ${total}
      </div>
    </div>
    <div class="plr-banner-arrow">→</div>
  </button>`;
  })()}

  <!-- Epic Player Card -->
  <div class="player-showcase">
    <div class="epic-player-card">
      <div class="card-top-row">
        <div class="hex-border hex-avatar">
          <div class="hex-inner">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect fill='%23ff5e00' width='150' height='150'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='%23fff' font-family='sans-serif' font-size='28' font-weight='700'%3EPLAYER%3C/text%3E%3C/svg%3E" alt="Mamedov" class="avatar-img" loading="lazy">
          </div>
        </div>
        <div class="hex-border hex-logo">
          <div class="hex-inner">
            <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23111' width='100' height='100'/%3E%3Ctext x='50%25' y='54%25' dominant-baseline='middle' text-anchor='middle' fill='%23ff5e00' font-family='sans-serif' font-size='18' font-weight='700'%3ELOGO%3C/text%3E%3C/svg%3E" alt="Lyutye Logo" class="logo-img" loading="lazy">
          </div>
        </div>
      </div>
      <div class="player-identity">
        <h2 class="player-name">MAMEDOV</h2>
        <div class="player-level-hex">
          <div class="hex-inner">7</div>
        </div>
      </div>
      <div class="player-rank">РАНГ: 3850</div>
      <div class="badges-grid">
        <div class="badge badge-gold">🏆 KING OF COURT 2026</div>
        <div class="badge badge-fire">🔥 5 WIN STREAK</div>
        <div class="badge badge-ice">❄️ SNOW MASTER</div>
        <div class="badge badge-silver">🥈 2 SIDE OUT TOURNEY</div>
      </div>
      <div class="battle-history">
        <div class="history-header">
          <span>ПОСЛЕДНИЕ БИТВЫ</span>
          <span>ДАТА</span>
          <span>РЕЗУЛЬТАТ</span>
          <span>МЕСТО</span>
        </div>
        <div class="history-row row-win">
          <span class="tourney-name">DOUBLE TROUBLE</span>
          <span class="tourney-date">04.01.2026</span>
          <span class="tourney-tier">🥉 HARD</span>
          <span class="tourney-place">1</span>
        </div>
        <div class="history-row">
          <span class="tourney-name">KOTC</span>
          <span class="tourney-date">10.01.2026</span>
          <span class="tourney-tier">-</span>
          <span class="tourney-place">1</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="home-tabs">
    <button class="home-tab-btn ${isS?'active':''}" onclick="setHomeTab('schedule')" style="font-size:11px">
      ⚔️ РАСПИСАНИЕ
    </button>
    <button class="home-tab-btn ${isC?'active':''}" onclick="setHomeTab('calendar')" style="font-size:11px">
      📅 КАЛЕНДАРЬ
    </button>
    <button class="home-tab-btn ${isA?'active':''}" onclick="setHomeTab('archive')" style="font-size:11px">
      🏆 АРХИВ
    </button>
  </div>

  <!-- Schedule -->
  <div style="display:${isS?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">БЛИЖАЙШИЕ <span>ЧЕМПИОНАТЫ</span></span>
      <span class="home-sec-count">${T.length} событий</span>
    </div>
    <div class="home-grid">${T.map(cardHtml).join('')}</div>
  </div>

  <!-- Calendar -->
  <div style="display:${isC?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">КАЛЕНДАРЬ <span>СОБЫТИЙ</span></span>
      <span class="home-sec-count">Март — Апрель 2026</span>
    </div>
    ${calHtml}
  </div>

  <!-- Archive -->
  <div style="display:${isA?'block':'none'}">
    <div class="home-sec-hdr">
      <span class="home-sec-title">АРХИВ <span>ТУРНИРОВ</span></span>
    </div>
    <button class="arch-add-toggle" onclick="toggleArchiveForm()">
      ${homeArchiveFormOpen ? '− Свернуть форму' : '+ Добавить прошедший турнир'}
    </button>
    ${archiveHtml}
  </div>
</div>`;
}

function renderHistory() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('kotc3_history') || '[]'); } catch(e){}

  let html = `<div class="hist-section-title">📚 АРХИВ ТУРНИРОВ</div>`;

  if (!history.length) {
    html += `<div class="hist-empty">Нет завершённых турниров.<br>Нажмите «Завершить турнир» в Ростере.</div>`;
    return html;
  }

  html += history.map(t => {
    const dateStr = fmtDateLong(t.date);
    const top = t.players.slice(0,5);
    return `<div class="hist-card">
      <div class="hist-hdr">
        <div>
          <div class="hist-name">${esc(t.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">📅 ${dateStr}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:flex-start">
          <button class="btn-gsh-hist" id="gsh-btn-${t.id}" onclick="exportToSheetsFromHistory(${t.id})" title="Экспорт в Google Sheets">📊 Sheets</button>
          <button class="btn-pdf-hist" onclick="exportTournamentPDF(${t.id})">📄 PDF</button>
          <button class="btn-del-hist" onclick="deleteHistory(${t.id})">✕</button>
        </div>
      </div>
      <div class="hist-meta-row">
        <span class="hist-chip">👥 ${t.players.length} игроков</span>
        <span class="hist-chip">🏐 ${t.rPlayed} раундов</span>
        <span class="hist-chip">⚡ ${t.totalScore} очков</span>
        <span class="hist-chip">🏟 ${t.nc} корт(а) × ${t.ppc}</span>
      </div>
      <div class="hist-podium">
        ${top.map((p,i) => `<div class="hist-row">
          <span class="hist-place-num">${MEDALS_5[i]||i+1}</span>
          <span class="hist-p-name">${p.gender==='M'?'🏋️':'👩'} ${esc(p.name)}</span>
          <span style="font-size:10px;color:var(--muted)">${p.courtName||''}</span>
          <span class="hist-p-pts">${p.totalPts} оч</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');

  return html;
}
