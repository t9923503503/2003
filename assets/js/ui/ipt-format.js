'use strict'; // ── IPT Mixed — rotation schedule & scoring logic ──

// ════════════════════════════════════════════════════════════════
// Rotation schedule: 8 players (indices 0..7), 4 rounds, 2 courts
// IPT_SCHEDULE[round][court] = { t1: [idx,idx], t2: [idx,idx] }
// Properties: each player has 4 unique partners; opponents ≤ 2 times.
// ════════════════════════════════════════════════════════════════
const IPT_SCHEDULE = [
  // Round 0
  [ { t1:[0,1], t2:[2,3] }, { t1:[4,5], t2:[6,7] } ],
  // Round 1
  [ { t1:[0,2], t2:[4,6] }, { t1:[1,3], t2:[5,7] } ],
  // Round 2
  [ { t1:[0,4], t2:[1,6] }, { t1:[2,7], t2:[3,5] } ],
  // Round 3
  [ { t1:[0,7], t2:[2,5] }, { t1:[1,4], t2:[3,6] } ],
];

/**
 * Map 8 participant IDs to the rotation schedule.
 * @param {string[]} participants — exactly 8 player IDs
 * @returns {Array} rounds array ready for trn.ipt.rounds
 */
function generateIPTRounds(participants) {
  return IPT_SCHEDULE.map((roundDef, rn) => ({
    num: rn,
    status: rn === 0 ? 'active' : 'waiting',
    courts: roundDef.map(def => ({
      team1:  def.t1.map(i => participants[i]),
      team2:  def.t2.map(i => participants[i]),
      score1: 0,
      score2: 0,
      status: rn === 0 ? 'active' : 'waiting',
    })),
  }));
}

/**
 * Build partner/opponent history from IPT rounds.
 * This is a foundation for future dynamic round generation with constraints:
 * - No repeat partners until all unique partner pairs are exhausted
 * - Opponent variety (minimize repeats)
 * @param {Array} rounds — trn.ipt.rounds
 * @returns {{partners: Record<string, number>, opponents: Record<string, number>}}
 */
function buildIPTMatchHistory(rounds) {
  const partners = {};
  const opponents = {};
  const pairKey = (a, b) => {
    const x = String(a), y = String(b);
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  (rounds || []).forEach(r => {
    (r.courts || []).forEach(c => {
      const t1 = c.team1 || [];
      const t2 = c.team2 || [];
      if (t1.length === 2) bump(partners, pairKey(t1[0], t1[1]));
      if (t2.length === 2) bump(partners, pairKey(t2[0], t2[1]));
      t1.forEach(a => t2.forEach(b => bump(opponents, pairKey(a, b))));
    });
  });
  return { partners, opponents };
}

/**
 * Phase-2 (optional): dynamic round generator.
 * Currently returns null to fall back to static IPT_SCHEDULE.
 */
function tryGenerateIPTRoundsDynamic(participants, matchHistory) {
  void participants; void matchHistory;
  return null;
}

/**
 * Check if a match is over given point limit and finish type.
 * @param {object} court — { score1, score2 }
 * @param {number} pointLimit
 * @param {'hard'|'balance'} finishType
 * @returns {boolean}
 */
function iptMatchFinished(court, pointLimit, finishType) {
  const s1 = court.score1, s2 = court.score2;
  if (finishType === 'balance') {
    if (s1 < pointLimit && s2 < pointLimit) return false;
    return Math.abs(s1 - s2) >= 2;
  }
  return s1 >= pointLimit || s2 >= pointLimit;
}

/**
 * Compute live standings from all rounds.
 * @param {object} trn — full tournament object
 * @returns {Array<{playerId, wins, diff, pts, matches, wr}>} sorted: wins → diff → pts
 */
function calcIPTStandings(trn) {
  const ipt = trn.ipt;
  if (!ipt) return [];
  const stats = {};

  const ensure = id => {
    if (!stats[id]) stats[id] = { playerId: id, wins: 0, diff: 0, pts: 0, matches: 0 };
  };

  ipt.rounds.forEach(round => {
    round.courts.forEach(court => {
      const { team1, team2, score1: s1, score2: s2 } = court;
      team1.forEach(ensure);
      team2.forEach(ensure);
      if (s1 === 0 && s2 === 0) return;
      const done = iptMatchFinished(court, ipt.pointLimit, ipt.finishType);
      team1.forEach(id => {
        stats[id].pts  += s1;
        stats[id].diff += s1 - s2;
        if (done && s1 > s2) stats[id].wins += 1;
        if (done) stats[id].matches += 1;
      });
      team2.forEach(id => {
        stats[id].pts  += s2;
        stats[id].diff += s2 - s1;
        if (done && s2 > s1) stats[id].wins += 1;
        if (done) stats[id].matches += 1;
      });
    });
  });

  return Object.values(stats)
    .map(s => ({ ...s, wr: s.matches ? (s.wins / s.matches) : 0 }))
    .sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins :
    b.diff !== a.diff ? b.diff - a.diff :
    b.pts  - a.pts
  );
}

/**
 * Apply score delta to a team; auto-finishes match if limit reached.
 * Re-renders IPT screen if it's currently active.
 * @param {string} trnId
 * @param {number} roundNum
 * @param {number} courtNum
 * @param {1|2}    team
 * @param {1|-1}   delta
 */
function iptApplyScore(trnId, roundNum, courtNum, team, delta) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;

  const round = trn.ipt.rounds[roundNum];
  if (!round) return;
  const court = round.courts[courtNum];
  if (!court || court.status === 'finished') return;

  const key  = team === 1 ? 'score1' : 'score2';
  court[key] = Math.max(0, court[key] + delta);

  if (iptMatchFinished(court, trn.ipt.pointLimit, trn.ipt.finishType)) {
    court.status = 'finished';
    showToast(`✅ Матч завершён: ${court.score1} : ${court.score2}`, 'success');
    playScoreSound && playScoreSound(1);
  }

  saveTournaments(arr);
  _iptRerender();
}

/**
 * Mark current round finished, activate next round.
 */
function finishIPTRound(trnId) {
  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;
  const rn = trn.ipt.currentRound;
  trn.ipt.rounds[rn].status = 'finished';
  if (rn + 1 < trn.ipt.rounds.length) {
    trn.ipt.currentRound = rn + 1;
    trn.ipt.rounds[rn + 1].status = 'active';
    trn.ipt.rounds[rn + 1].courts.forEach(c => c.status = 'active');
    showToast(`▶ Раунд ${rn + 2} начат`, 'success');
  }
  saveTournaments(arr);
  _iptRerender();
}

/**
 * Finalize IPT: compute standings → write winners[] → mark finished.
 */
async function finishIPT(trnId) {
  const ok = await showConfirm('Завершить IPT турнир и зафиксировать результаты?');
  if (!ok) return;

  const arr = getTournaments();
  const trn = arr.find(t => t.id === trnId);
  if (!trn?.ipt) return;

  const standings = calcIPTStandings(trn);
  trn.status = 'finished';
  trn.winners = standings.map((s, i) => ({
    place:     i + 1,
    playerIds: [s.playerId],
    points:    calculateRanking(i + 1),
    iptStats:  { wins: s.wins, diff: s.diff, pts: s.pts, matches: s.matches, wr: s.wr },
  }));
  trn.history = trn.history || [];
  trn.history.push({ action: 'finished', ts: Date.now(), by: 'ipt' });

  saveTournaments(arr);
  recalcAllPlayerStats(false);
  switchTab('home');
  showToast('🏆 IPT турнир завершён! Результаты записаны.', 'success');
}

/** Internal: re-render IPT screen if it's active */
function _iptRerender() {
  if (activeTabId === 'ipt') {
    const s = document.getElementById('screen-ipt');
    if (s) s.innerHTML = renderIPT();
  }
}
