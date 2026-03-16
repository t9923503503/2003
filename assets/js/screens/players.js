'use strict';

function renderPlayers() {
  const db = loadPlayerDB();
  const g  = playersGender; // 'M' | 'W' | 'Mix'
  const q  = playersSearch.trim().toLowerCase();

  // Rating/tournament field names for current tab
  const ratingField = g === 'M' ? 'ratingM' : g === 'W' ? 'ratingW' : 'ratingMix';
  const trnField    = g === 'M' ? 'tournamentsM' : g === 'W' ? 'tournamentsW' : 'tournamentsMix';

  // Players for current tab
  const all = g === 'Mix'
    ? db.filter(p => (p.ratingMix||0) > 0 || (p.tournamentsMix||0) > 0)
    : db.filter(p => p.gender === g);

  const sortFn = playersSort === 'trn' ? (a,b) => (b[trnField]||0) - (a[trnField]||0)
               : playersSort === 'avg' ? (a,b) => {
                   const aa = (a[trnField]||0) > 0 ? (a[ratingField]||0)/(a[trnField]||0) : 0;
                   const ba = (b[trnField]||0) > 0 ? (b[ratingField]||0)/(b[trnField]||0) : 0;
                   return ba - aa;
                 }
               :                         (a,b) => (b[ratingField]||0) - (a[ratingField]||0);

  const allSorted = all.slice().sort(sortFn);
  const list = q ? allSorted.filter(p => p.name.toLowerCase().includes(q)) : allSorted;

  const totalM   = db.filter(p=>p.gender==='M').length;
  const totalW   = db.filter(p=>p.gender==='W').length;
  const totalMix = db.filter(p=>(p.ratingMix||0)>0||(p.tournamentsMix||0)>0).length;

  function rankClass(i){ return i===0?'gold':i===1?'silver':i===2?'bronze':''; }
  function medal(i){ return i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1; }

  const sortValOf = p => {
    if (playersSort === 'trn') return p[trnField]||0;
    if (playersSort === 'avg') return (p[trnField]||0) > 0
      ? ((p[ratingField]||0)/(p[trnField]||0)).toFixed(1) : '—';
    return p[ratingField]||0;
  };
  const sortLbl = playersSort === 'trn' ? 'турн.' : playersSort === 'avg' ? 'средн.' : 'рейт.';

  // Zone styling by rank position
  const zoneMeta = (rank) => {
    if (rank <= 10) return { cls: 'zone-hard',   lbl: 'HARD',   color: '#e94560' };
    if (rank <= 20) return { cls: 'zone-medium', lbl: 'MEDIUM', color: '#4DA8DA' };
    return              { cls: 'zone-lite',   lbl: 'LITE',   color: '#6ABF69' };
  };

  // Podium (only when not searching, 2+ players)
  const top3 = !q && allSorted.length >= 2;
  const podiumHtml = top3 ? (() => {
    const [p1, p2, p3] = allSorted;
    const pod = (p, cls, med) => p ? `
      <div class="plr-pod-item">
        <div class="plr-pod-col ${cls}">
          <span class="plr-pod-medal">${med}</span>
          <span class="plr-pod-name">${esc(p.name.split(' ')[0])}</span>
          <span class="plr-pod-pts ${cls}">${sortValOf(p)}</span>
          <span class="plr-pod-lbl">${sortLbl}</span>
        </div>
      </div>` : '';
    return `<div class="plr-podium">${pod(p2,'p2','🥈')}${pod(p1,'p1','🥇')}${pod(p3,'p3','🥉')}</div>`;
  })() : '';

  const itemsHtml = list.length === 0 ? `
    <div class="plr-empty">
      <div class="plr-empty-icon">${q ? '🔍' : g==='M'?'🏋️':g==='W'?'👩':'🤝'}</div>
      ${q ? `Нет совпадений для «${esc(q)}»`
          : g==='Mix' ? 'Нет игроков с рейтингом микст. Проведите микст-турнир.'
          : 'Нет игроков. Добавляйте и редактируйте через ⚙️ Ростер.'}
    </div>` : list.map((p, i) => {
      const zn     = zoneMeta(i + 1);
      const rPts   = p[ratingField] || 0;
      const tCount = p[trnField]    || 0;
      const avg    = tCount > 0 ? (rPts / tCount).toFixed(1) : '—';
      return `
    <div class="plr-item" style="border-left:3px solid ${zn.color}"
         onclick="showPlayerCard('${escAttr(p.name)}','${escAttr(p.gender)}')">
      <div class="plr-item-rank ${rankClass(i)}">${medal(i)}</div>
      <div class="plr-item-info">
        <div class="plr-item-name">${esc(p.name)}</div>
        <div class="plr-item-meta">
          <span>🏆 ${tCount} турн.</span>
          <span>⚡ ${rPts} рейт.</span>
          <span>📊 ${avg} ср.</span>
        </div>
      </div>
      <div class="plr-item-pts">
        <div class="plr-item-pts-val">${sortValOf(p)}</div>
        <div class="plr-item-pts-lbl">${sortLbl}</div>
      </div>
      <div class="plr-zone-badge ${zn.cls}">${zn.lbl}</div>
    </div>`;
    }).join('');

  return `
<div class="plr-wrap">
  <div class="plr-header">
    <div class="plr-title">🔥 РЕЙТИНГ ЛЮТЫХ ИГРОКОВ</div>
    <div class="plr-sub">Professional Points — места, зоны, статистика</div>
  </div>

  <!-- Stats chips -->
  <div class="plr-stats-row">
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalM}</div>
      <div class="plr-stat-chip-lbl">🏋️ Мужчин</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalW}</div>
      <div class="plr-stat-chip-lbl">👩 Женщин</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${totalMix}</div>
      <div class="plr-stat-chip-lbl">🤝 Микст</div>
    </div>
    <div class="plr-stat-chip">
      <div class="plr-stat-chip-val">${db.length}</div>
      <div class="plr-stat-chip-lbl">Всего</div>
    </div>
  </div>

  <!-- Tabs: М / Ж / Микст -->
  <div class="plr-tabs">
    <button class="plr-tab ${g==='M'?'active':''}" onclick="setPlayersGender('M')">🏋️ М (${totalM})</button>
    <button class="plr-tab ${g==='W'?'active':''}" onclick="setPlayersGender('W')">👩 Ж (${totalW})</button>
    <button class="plr-tab ${g==='Mix'?'active':''}" onclick="setPlayersGender('Mix')">🤝 Микст (${totalMix})</button>
  </div>

  <!-- Sort -->
  <div class="plr-sort-row">
    <button class="plr-sort-btn ${playersSort==='pts'?'active':''}" onclick="setPlayersSort('pts')">⚡ Рейтинг</button>
    <button class="plr-sort-btn ${playersSort==='avg'?'active':''}" onclick="setPlayersSort('avg')">📊 Средний</button>
    <button class="plr-sort-btn ${playersSort==='trn'?'active':''}" onclick="setPlayersSort('trn')">🏆 Турниры</button>
  </div>

  ${podiumHtml}

  <!-- Search -->
  <div class="plr-search-wrap">
    <span class="plr-search-icon">🔍</span>
    <input class="plr-search" id="plr-search-inp" type="search"
      placeholder="Поиск по имени…" value="${esc(playersSearch)}"
      oninput="setPlayersSearch(this.value)">
  </div>

  <!-- List -->
  <div class="plr-list">${itemsHtml}</div>
</div>`;
}
