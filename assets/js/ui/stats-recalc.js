'use strict'; // ── Stats recalculation ──

// ── O(1) player lookup cache ──────────────────────────────────
function _buildPlayerMap() {
  const map = new Map();
  loadPlayerDB().forEach(p => map.set(p.id, p));
  return map;
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
