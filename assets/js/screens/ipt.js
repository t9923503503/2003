'use strict'; // ── IPT Match screen rendering ──

let _iptActiveTrnId = null;

// ── Entry point ───────────────────────────────────────────────
/**
 * Open IPT screen for a given tournament.
 * Generates rounds on first open if not yet done.
 */
function openIPT(trnId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn) return;

  if (!trn.ipt?.rounds) {
    if ((trn.participants || []).length < 8) {
      showToast('❌ Для IPT нужно минимум 8 участников', 'error');
      return;
    }
    if (!trn.ipt) trn.ipt = {};
    // Validate / default pointLimit (allow any integer >= 1)
    const lim = parseInt(String(trn.ipt.pointLimit ?? ''), 10);
    trn.ipt.pointLimit   = Number.isFinite(lim) && lim >= 1 ? lim : 21;
    trn.ipt.finishType   = trn.ipt.finishType  || 'hard';
    trn.ipt.currentRound = 0;
    trn.ipt.rounds       = generateIPTRounds(trn.participants.slice(0, 8));
    if (trn.status !== 'finished') trn.status = 'active';
    saveTournaments(arr);
  }

  _iptActiveTrnId = trnId;
  try { localStorage.setItem('kotc3_ipt_active', trnId); } catch(e) {}
  document.getElementById('td-modal')?.remove();
  switchTab('ipt');
}

// ── Main render ───────────────────────────────────────────────
function renderIPT() {
  const trnId = _iptActiveTrnId
    || (typeof localStorage !== 'undefined' ? localStorage.getItem('kotc3_ipt_active') : null);

  if (!trnId) {
    return `<div class="ipt-wrap"><div class="ipt-empty">
      <div style="font-size:3rem">🏐</div>
      <div>Нет активного IPT турнира</div>
      <button class="ipt-btn-back" onclick="switchTab('home')">← Список турниров</button>
    </div></div>`;
  }

  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) {
    return `<div class="ipt-wrap"><div class="ipt-empty">Турнир не найден.</div></div>`;
  }
  _iptActiveTrnId = trnId;

  const ipt  = trn.ipt;
  const db   = loadPlayerDB();
  const curR = ipt.currentRound || 0;

  // Round navigation
  const roundNav = ipt.rounds.map((r, i) => {
    const isCur  = i === curR;
    const isDone = r.status === 'finished';
    const isWait = r.status === 'waiting';
    return `<button class="ipt-rnd-btn${isCur?' active':''}${isDone?' done':''}"
      ${isWait ? 'disabled title="Завершите предыдущий раунд"' : ''}
      onclick="setIPTRound(${i})"
    ><span class="rn-num">${i+1}</span><span class="rn-lbl">РАУНД</span></button>`;
  }).join('');

  // Courts for displayed round
  const dispRound = ipt.rounds[curR];
  const courtsHtml = dispRound.courts.map((c, cn) =>
    _renderIPTCourt(trn, ipt, dispRound, c, cn, db)
  ).join('');

  // Action buttons
  const allCourtsFinished = dispRound.courts.every(c => c.status === 'finished');
  const isLastRound    = curR === ipt.rounds.length - 1;
  const allRoundsDone  = ipt.rounds.every(r => r.status === 'finished');

  const actionHtml = trn.status !== 'finished' ? `<div class="ipt-actions">
    ${allCourtsFinished && !isLastRound && dispRound.status !== 'finished'
      ? `<button class="ipt-btn-next" onclick="finishIPTRound('${escAttr(trnId)}')">▶ Следующий раунд</button>`
      : ''}
    ${allRoundsDone
      ? `<button class="ipt-btn-finish" onclick="finishIPT('${escAttr(trnId)}')">🏆 Завершить турнир</button>`
      : ''}
  </div>` : '';

  const statusBadge = trn.status === 'finished'
    ? '<span class="ipt-status-done">🏆 ЗАВЕРШЁН</span>' : '';

  return `<div class="ipt-wrap">
    <div class="ipt-header">
      <button class="ipt-btn-back" onclick="switchTab('home')">← Назад</button>
      <div class="ipt-title-row">
        <span class="ipt-title">🏐 IPT MIXED</span>${statusBadge}
      </div>
      <div class="ipt-trnname">${esc(trn.name)}</div>
      <div class="ipt-meta">⚡ Лимит очков: <b>${ipt.pointLimit}</b> &nbsp;·&nbsp; ${ipt.finishType === 'balance' ? '±2 победа' : 'Жёсткий лимит'}</div>
    </div>
    <div class="ipt-round-nav">${roundNav}</div>
    <div class="ipt-courts-wrap">${courtsHtml}</div>
    ${_renderIPTStandings(trn, db)}
    ${actionHtml}
  </div>`;
}

// ── Court card ────────────────────────────────────────────────
function _renderIPTCourt(trn, ipt, round, court, cn, db) {
  const trnId    = trn.id;
  const rn       = round.num;
  const finished = court.status === 'finished';
  const waiting  = court.status === 'waiting';
  const s1 = court.score1, s2 = court.score2;
  const winner   = finished ? (s1 > s2 ? 1 : s2 > s1 ? 2 : 0) : 0;

  const n1 = court.team1.map(id => esc(db.find(p => p.id === id)?.name || '?'));
  const n2 = court.team2.map(id => esc(db.find(p => p.id === id)?.name || '?'));

  const colors   = ['#FFD700','#4DA8DA'];
  const color    = colors[cn] || '#6ABF69';
  const label    = cn === 0 ? '🏅 КОРТ A' : '🔷 КОРТ B';

  const dis1m = s1 <= 0 || finished || waiting ? 'disabled' : '';
  const dis1p = finished || waiting ? 'disabled' : '';
  const dis2m = s2 <= 0 || finished || waiting ? 'disabled' : '';
  const dis2p = finished || waiting ? 'disabled' : '';

  const teamHtml = (names, score, side, disM, disP, winnerSide) => `
    <div class="ipt-team${winnerSide ? ' ipt-team-win' : ''}">
      <div class="ipt-team-names">${names.join('<span class="ipt-amp"> + </span>')}</div>
      <div class="ipt-score-row">
        <button class="ipt-score-btn ipt-minus" ${disM}
          onclick="iptApplyScore('${escAttr(trnId)}',${rn},${cn},${side},-1)">−</button>
        <div class="ipt-score${winnerSide?' win':winner&&!winnerSide?' lose':''}">${score}</div>
        <button class="ipt-score-btn ipt-plus" ${disP}
          onclick="iptApplyScore('${escAttr(trnId)}',${rn},${cn},${side},1)">+</button>
      </div>
    </div>`;

  return `<div class="ipt-court${finished?' ipt-court-done':waiting?' ipt-court-wait':''}" style="--ipt-c:${color}">
    <div class="ipt-court-hdr">
      <span class="ipt-court-lbl">${label}</span>
      ${finished ? '<span class="ipt-court-badge">✅ ЗАВЕРШЕНО</span>' : ''}
      ${waiting  ? '<span class="ipt-court-badge wait">⏳ ОЖИДАНИЕ</span>' : ''}
    </div>
    <div class="ipt-matchup">
      ${teamHtml(n1, s1, 1, dis1m, dis1p, winner===1)}
      <div class="ipt-vs">VS</div>
      ${teamHtml(n2, s2, 2, dis2m, dis2p, winner===2)}
    </div>
  </div>`;
}

// ── Standings ─────────────────────────────────────────────────
function _renderIPTStandings(trn, db) {
  if (!db) db = loadPlayerDB();
  const list = calcIPTStandings(trn);
  if (!list.length) return '';

  const MEDALS = ['🥇','🥈','🥉'];
  const rows = list.map((s, i) => {
    const name    = db.find(p => p.id === s.playerId)?.name || '?';
    const medal   = MEDALS[i] || `<span class="ipt-rank-num">${i+1}</span>`;
    const diffStr = s.diff >= 0 ? `+${s.diff}` : `${s.diff}`;
    const dCls    = s.diff > 0 ? 'pos' : s.diff < 0 ? 'neg' : '';
    const wrPct   = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
    return `<tr class="${i < 3 ? 'ipt-top3' : ''}">
      <td class="ipt-st-rank">${medal}</td>
      <td class="ipt-st-name">${esc(name)}</td>
      <td class="ipt-st-wins">${s.wins}</td>
      <td class="ipt-st-matches">${s.matches}</td>
      <td class="ipt-st-wr">${wrPct}%</td>
      <td class="ipt-st-diff ${dCls}">${diffStr}</td>
      <td class="ipt-st-pts">${s.pts}</td>
    </tr>`;
  }).join('');

  return `<div class="ipt-standings">
    <div class="ipt-standings-ttl">📊 Таблица</div>
    <table class="ipt-standings-tbl">
      <thead><tr>
        <th>#</th><th>Игрок</th><th>В</th><th>M</th><th>WR</th><th>±</th><th>Оч</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── Round switch ──────────────────────────────────────────────
function setIPTRound(roundNum) {
  const trnId = _iptActiveTrnId
    || (typeof localStorage !== 'undefined' ? localStorage.getItem('kotc3_ipt_active') : null);
  if (!trnId) return;
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;
  trn.ipt.currentRound = roundNum;
  saveTournaments(arr);
  _iptRerender();
}
