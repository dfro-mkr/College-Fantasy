// Fantasy College Basketball — client-side app with Stripe Checkout integration
// Fetches NCAA D1 scoreboard and provides a draft + live scoring engine.
// Adds Stripe checkout flow (serverless endpoints expected under /api/*)

const API_URL = 'https://ncaa-api.henrygd.me/scoreboard/basketball-men/d1';
const REFRESH_INTERVAL = 10000; // 10s

// DOM
const scoreboardEl = document.getElementById('scoreboard');
const lastUpdatedEl = document.getElementById('last-updated');
const sortSelect = document.getElementById('sort-select');
const refreshBtn = document.getElementById('refresh-btn');

const catButtons = document.querySelectorAll('.cat-btn');
const slotsContainer = document.querySelectorAll('.slot');
const resetBtn = document.getElementById('reset-draft');
const draftConfirm = document.getElementById('draft-confirm');
const closeConfirm = document.getElementById('close-confirm');

const countOffenseEl = document.getElementById('count-offense');
const countHybridEl = document.getElementById('count-hybrid');
const countDefenseEl = document.getElementById('count-defense');

const summaryList = document.getElementById('summary-list');
const offenseTotalEl = document.getElementById('offense-total');
const hybridTotalEl = document.getElementById('hybrid-total');
const defenseTotalEl = document.getElementById('defense-total');
const fantasyTotalEl = document.getElementById('fantasy-total');

const toastEl = document.getElementById('toast');
const BUY_PRO_BTN = document.getElementById('buy-pro');

let scoreboardData = []; // normalized games
let selectedCategory = 'offense'; // default pick type
let picks = loadPicks(); // structure {slotId: pickObj}
let gamesMap = {}; // map teamId -> { game, team, opponent, side }

const LIMITS = { offense: 2, hybrid: 2, defense: 1 };

// --------------------- localStorage helpers ---------------------
function savePicks(){
  try { localStorage.setItem('fcb_picks_v1', JSON.stringify(picks)); } catch(e){}
}
function loadPicks(){
  try {
    const raw = localStorage.getItem('fcb_picks_v1');
    return raw ? JSON.parse(raw) : {};
  } catch(e){ return {}; }
}
function clearPicks(){
  picks = {};
  savePicks();
}

// --------------------- small UI helpers ---------------------
function showToast(msg, isError=false, duration=2200){
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.background = isError ? 'linear-gradient(90deg,#3b0f0f,#2a0b0b)' : 'rgba(0,0,0,0.7)';
  toastEl.classList.remove('hidden');
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>{
    toastEl.classList.remove('show');
    toastEl.classList.add('hidden');
  }, duration);
}

// --------------------- API normalization utilities ---------------------
function extractGames(raw){
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.events)) return raw.events;
  if (Array.isArray(raw.games)) return raw.games;
  if (Array.isArray(raw.data)) return raw.data;
  return [];
}

function getTeamObj(game, side){
  const sPossible = [
    `${side}_team`,
    `${side}Team`,
    side,
  ];
  let team = null;
  for (const key of sPossible){
    if (game[key]) { team = game[key]; break; }
  }
  if (!team && game.teams && Array.isArray(game.teams)){
    team = game.teams.find(t => (t.side === side || t.homeAway === side || t.isHome === (side==='home')));
  }
  if (!team && game.competitors && Array.isArray(game.competitors)){
    const t = game.competitors.find(c => c.homeAway === side || c.homeAway === (side==='home' ? 'home' : 'away') || c.side === side);
    if (t) team = t;
  }
  if (!team) team = {};

  const id = team.id || team.team_id || team.teamId || team._id || team.school || team.name || team.abbrev || `${side}_${game.id || game.gameId || Math.random()}`;
  const name = team.name || team.school || team.team || team.school_name || team.displayName || team.title || team.fullName || team.display_name || '';
  const abbrev = team.abbrev || team.short || team.team_abbrev || team.school_abbrev || '';
  const score = Number(team.score ?? team.points ?? team.team_score ?? team.home_score ?? team.away_score ?? 0) || 0;
  return { id: String(id), name: String(name || abbrev || id), abbrev: String(abbrev || ''), score: Number(isNaN(score)?0:score), side };
}

function getStatus(game){
  const s = game.status || game.game_status || game.state || game.period || game.status_detail || '';
  if (s) return String(s);
  const clock = game.clock || game.time || (game.game_clock && game.game_clock.timeRemaining) || '';
  const q = game.period || game.period_name || game.period_number || '';
  if (clock || q) return `${q || ''} ${clock || ''}`.trim();
  if (game.isFinal || game.status === 'final' || game.game_status === 'final') return 'Final';
  if (game.scheduled) return 'Scheduled';
  return 'TBD';
}

function normalizeGame(raw){
  const home = getTeamObj(raw, 'home');
  const away = getTeamObj(raw, 'away');

  if ((!home.name || !away.name) && raw.competitors && Array.isArray(raw.competitors) && raw.competitors.length >= 2){
    const c0 = raw.competitors[0];
    const c1 = raw.competitors[1];
    const t0 = { id: c0.id || c0.team_id || c0.name, name: c0.name || c0.school || c0.displayName || '', abbrev: c0.abbrev||c0.short||'', score: Number(c0.score||c0.points||0)||0, side:'away' };
    const t1 = { id: c1.id || c1.team_id || c1.name, name: c1.name || c1.school || c1.displayName || '', abbrev: c1.abbrev||c1.short||'', score: Number(c1.score||c1.points||0)||0, side:'home' };
    return {
      id: raw.id || raw.gameId || raw.game_id || Math.random(),
      home: t1,
      away: t0,
      status: getStatus(raw),
      totalScore: (t1.score||0)+(t0.score||0),
      raw
    };
  }

  if (home && !home.score && (raw.home_score || raw.home_points)) {
    home.score = Number(raw.home_score ?? raw.home_points ?? 0);
  }
  if (away && !away.score && (raw.away_score || raw.away_points)) {
    away.score = Number(raw.away_score ?? raw.away_points ?? 0);
  }

  const totalScore = (home.score || 0) + (away.score || 0);
  return {
    id: raw.id || raw.gameId || raw.game_id || Math.random(),
    home,
    away,
    status: getStatus(raw),
    totalScore,
    raw
  };
}

// --------------------- rendering ---------------------
function escapeHtml(str){
  return (str||'').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderScoreboard(){
  scoreboardEl.innerHTML = '';
  if (!scoreboardData.length){
    scoreboardEl.innerHTML = `<div class="loader">No games found.</div>`;
    return;
  }
  gamesMap = {}; // rebuild
  for (const game of scoreboardData){
    const gameEl = document.createElement('div');
    gameEl.className = 'game';

    const awayEl = document.createElement('div');
    awayEl.className = 'team away';
    awayEl.dataset.teamId = game.away.id;
    awayEl.innerHTML = `<div class="abbrev">${escapeHtml(game.away.abbrev || '')}</div><div class="name">${escapeHtml(game.away.name || '')}</div>`;

    const homeEl = document.createElement('div');
    homeEl.className = 'team home';
    homeEl.dataset.teamId = game.home.id;
    homeEl.innerHTML = `<div class="name">${escapeHtml(game.home.name || '')}</div><div class="abbrev">${escapeHtml(game.home.abbrev || '')}</div>`;

    const infoEl = document.createElement('div');
    infoEl.className = 'game-info';
    infoEl.innerHTML = `<div class="score away-score">${game.away.score ?? 0}</div><div class="status">${escapeHtml(game.status)}</div><div class="score home-score">${game.home.score ?? 0}</div>`;

    // Attach handlers
    awayEl.addEventListener('click', ()=> handleTeamClick(game, game.away, game.away && game.home));
    homeEl.addEventListener('click', ()=> handleTeamClick(game, game.home, game.home && game.away));

    gameEl.appendChild(awayEl);
    gameEl.appendChild(infoEl);
    gameEl.appendChild(homeEl);

    scoreboardEl.appendChild(gameEl);

    // Update gamesMap
    try {
      gamesMap[game.home.id] = { game, team: game.home, opponent: game.away, side: 'home' };
      gamesMap[game.away.id] = { game, team: game.away, opponent: game.home, side: 'away' };
    } catch(e){}
  }
}

// --------------------- user interactions ---------------------
function setActiveCategory(cat){
  selectedCategory = cat;
  catButtons.forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
}

catButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveCategory(btn.dataset.cat);
  });
});

resetBtn.addEventListener('click', () => {
  if (confirm('Reset your draft?')) {
    clearPicks();
    renderSlots();
    updateCounts();
    renderSummary();
    draftConfirm.classList.add('hidden');
    showToast('Draft reset');
  }
});

if (closeConfirm){
  closeConfirm.addEventListener('click', ()=>{
    draftConfirm.classList.add('hidden');
  });
}

function removePick(slotId){
  delete picks[slotId];
  savePicks();
  renderSlots();
  updateCounts();
  renderSummary();
  draftConfirm.classList.add('hidden');
}

function handleTeamClick(game, team, opponent){
  const pickObj = {
    id: team.id,
    name: team.name,
    abbrev: team.abbrev || '',
    category: selectedCategory,
    gameId: game.id,
    storedAt: Date.now()
  };

  if (Object.values(picks).some(p => p && p.id === pickObj.id)){
    showToast('You already picked that team.', true);
    return;
  }

  const slots = Array.from(document.querySelectorAll(`.slot[data-cat="${selectedCategory}"]`));
  const freeSlot = slots.find(s => !picks[s.dataset.slot]);
  if (!freeSlot){
    showToast(`No free ${selectedCategory} slots.`, true);
    return;
  }

  const currentCount = Object.values(picks).filter(p => p && p.category === selectedCategory).length;
  if (currentCount >= LIMITS[selectedCategory]){
    showToast(`You've already chosen ${LIMITS[selectedCategory]} ${selectedCategory} picks.`, true);
    return;
  }

  picks[freeSlot.dataset.slot] = pickObj;
  savePicks();
  renderSlots();
  updateCounts();
  renderSummary();
  checkDraftComplete();
  showToast(`${pickObj.name} added as ${pickObj.category}`);
}

function renderSlots(){
  for (const slotEl of slotsContainer){
    const id = slotEl.dataset.slot;
    const pick = picks[id];
    slotEl.innerHTML = '';
    if (pick){
      const pickEl = document.createElement('div');
      pickEl.className = 'pick';
      pickEl.innerHTML = `
        <div class="meta">
          <div class="team-name">${escapeHtml(pick.name)}</div>
          <div class="team-sub">${escapeHtml(pick.abbrev)} • ${pick.category}</div>
        </div>
        <div class="score-preview neon" title="Current contribution">--</div>
        <button class="remove" data-slot="${id}" title="Remove">✕</button>
      `;
      slotEl.appendChild(pickEl);
      const removeBtn = pickEl.querySelector('.remove');
      removeBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        removePick(id);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Click a team to add';
      slotEl.appendChild(empty);
    }
  }
}

function updateCounts(){
  const offense = Object.values(picks).filter(p => p && p.category === 'offense').length;
  const hybrid = Object.values(picks).filter(p => p && p.category === 'hybrid').length;
  const defense = Object.values(picks).filter(p => p && p.category === 'defense').length;
  countOffenseEl.textContent = `${offense}/${LIMITS.offense}`;
  countHybridEl.textContent = `${hybrid}/${LIMITS.hybrid}`;
  countDefenseEl.textContent = `${defense}/${LIMITS.defense}`;

  catButtons.forEach(btn=>{
    const cat = btn.dataset.cat;
    const cur = {offense,hybrid,defense}[cat];
    btn.classList.toggle('disabled', cur >= LIMITS[cat]);
  });
}

function checkDraftComplete(){
  const totalNeeded = LIMITS.offense + LIMITS.hybrid + LIMITS.defense;
  const current = Object.values(picks).filter(Boolean).length;
  if (current >= totalNeeded){
    draftConfirm.classList.remove('hidden');
    showToast('Draft complete!');
  }
}

// --------------------- scoring engine ---------------------
function computeScoring(){
  const items = [];
  let offenseTotal = 0, hybridTotal = 0, defenseTotal = 0;

  for (const [slot, pick] of Object.entries(picks)){
    if (!pick) continue;
    const mapping = gamesMap[pick.id] || null;
    let teamScore = 0, oppScore = 0, status = 'N/A';
    if (mapping && mapping.team){
      teamScore = Number(mapping.team.score || 0);
      oppScore = Number(mapping.opponent.score || 0);
      status = mapping.game.status || 'Live';
    } else {
      const found = scoreboardData.find(g => g.id === pick.gameId || g.home.id === pick.id || g.away.id === pick.id);
      if (found){
        const side = (found.home.id === pick.id) ? 'home' : 'away';
        const team = side === 'home' ? found.home : found.away;
        const opp = side === 'home' ? found.away : found.home;
        teamScore = Number(team.score || 0);
        oppScore = Number(opp.score || 0);
        status = found.status || 'N/A';
      }
    }

    let contribution = 0;
    if (pick.category === 'offense'){
      contribution = teamScore;
      offenseTotal += contribution;
    } else if (pick.category === 'hybrid'){
      const margin = teamScore - oppScore;
      contribution = margin;
      hybridTotal += contribution;
    } else if (pick.category === 'defense'){
      const allowed = oppScore;
      contribution = -allowed;
      defenseTotal += contribution;
    }

    items.push({
      slot,
      name: pick.name,
      abbrev: pick.abbrev,
      category: pick.category,
      teamScore,
      oppScore,
      contribution,
      status
    });
  }

  const fantasyTotal = offenseTotal + hybridTotal + defenseTotal;
  return { items, offenseTotal, hybridTotal, defenseTotal, fantasyTotal };
}

function renderSummary(){
  const { items, offenseTotal, hybridTotal, defenseTotal, fantasyTotal } = computeScoring();

  summaryList.innerHTML = '';
  if (!items.length){
    summaryList.innerHTML = '<div class="muted">No picks yet — add teams to see live scoring.</div>';
  } else {
    const order = { offense: 0, hybrid: 1, defense: 2 };
    items.sort((a,b) => order[a.category] - order[b.category]);
    for (const it of items){
      const itemEl = document.createElement('div');
      itemEl.className = 'summary-item';
      const left = document.createElement('div');
      left.className = 'left';
      left.innerHTML = `<div class="team-name">${escapeHtml(it.name)} <span class="muted">(${escapeHtml(it.abbrev)})</span></div><div class="muted small">${escapeHtml(it.category)} • ${escapeHtml(it.status)}</div>`;
      const right = document.createElement('div');
      const plus = it.contribution >= 0 ? '+' : '';
      right.innerHTML = `<div class="mut neon">${plus}${it.contribution}</div><div class="muted small">${it.teamScore} / ${it.oppScore}</div>`;
      itemEl.appendChild(left);
      itemEl.appendChild(right);
      summaryList.appendChild(itemEl);
    }
  }

  offenseTotalEl.textContent = String(offenseTotal);
  hybridTotalEl.textContent = String(hybridTotal);
  defenseTotalEl.textContent = String(defenseTotal);
  fantasyTotalEl.textContent = String(fantasyTotal);

  for (const slotEl of slotsContainer){
    const id = slotEl.dataset.slot;
    const pick = picks[id];
    const preview = slotEl.querySelector('.score-preview');
    if (preview){
      const itm = (items.find(i => i.slot === id) || {});
      const val = itm.contribution;
      preview.textContent = (typeof val === 'number') ? (val >= 0 ? `+${val}` : `${val}`) : '--';
    }
  }
}

// --------------------- fetch & refresh ---------------------
let refreshTimer = null;
let isFetching = false;

async function fetchScoreboard(){
  if (isFetching) return;
  isFetching = true;
  try {
    const res = await fetch(API_URL + (API_URL.includes('?') ? '&' : '?') + 'r=' + Date.now());
    const json = await res.json();
    const rawGames = extractGames(json);
    const normalized = rawGames.map(normalizeGame);

    const sortBy = sortSelect.value || 'time';
    if (sortBy === 'score'){
      normalized.sort((a,b) => (b.totalScore || 0) - (a.totalScore || 0));
    } else if (sortBy === 'alpha'){
      normalized.sort((a,b) => {
        const nameA = (a.home.name || '') + (a.away.name || '');
        const nameB = (b.home.name || '') + (b.away.name || '');
        return nameA.localeCompare(nameB);
      });
    } else {
      normalized.sort((a,b) => {
        const sA = String(a.status || '').toLowerCase();
        const sB = String(b.status || '').toLowerCase();
        if (sA.includes('final') && !sB.includes('final')) return 1;
        if (sB.includes('final') && !sA.includes('final')) return -1;
        return 0;
      });
    }

    scoreboardData = normalized;
    renderScoreboard();
    lastUpdatedEl.textContent = new Date().toLocaleTimeString();
    computeAndRender();
  } catch (err){
    console.error('Fetch failed', err);
    showToast('Failed to load scoreboard', true);
  } finally {
    isFetching = false;
  }
}

function computeAndRender(){
  renderSummary();
}

refreshBtn.addEventListener('click', ()=> {
  fetchScoreboard();
  showToast('Refreshing scoreboard...');
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchScoreboard, REFRESH_INTERVAL);
  }
});

sortSelect.addEventListener('change', () => {
  fetchScoreboard();
});

// --------------------- Stripe Checkout integration ---------------------
function setProUnlocked(){
  localStorage.setItem('fcb_pro_unlocked', '1');
  showToast('Pro unlocked — enjoy!');
  reflectProStatus();
}

function isProUnlocked(){
  return !!localStorage.getItem('fcb_pro_unlocked');
}

function reflectProStatus(){
  if (!BUY_PRO_BTN) return;
  if (isProUnlocked()){
    BUY_PRO_BTN.textContent = 'Pro Unlocked';
    BUY_PRO_BTN.classList.add('ghost');
    BUY_PRO_BTN.disabled = true;
  } else {
    BUY_PRO_BTN.textContent = 'Unlock Pro';
    BUY_PRO_BTN.disabled = false;
    BUY_PRO_BTN.classList.remove('ghost');
  }
}

async function startCheckout(){
  if (!BUY_PRO_BTN) return;
  try {
    BUY_PRO_BTN.disabled = true;
    showToast('Starting checkout...');
    const resp = await fetch('/api/create-checkout-session', { method: 'POST', headers: { 'content-type':'application/json' } });
    const data = await resp.json();
    if (!resp.ok){ throw new Error(data.error || 'Failed to create session'); }
    if (data.url){
      window.location = data.url;
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (err){
    console.error('checkout error', err);
    showToast('Checkout failed', true);
    BUY_PRO_BTN.disabled = false;
  }
}

// Verify session on return
async function handleReturnFromStripe(){
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success' && params.get('session_id')){
    const sessionId = params.get('session_id');
    try {
      showToast('Verifying payment…');
      const res = await fetch(`/api/verify-session?session_id=${encodeURIComponent(sessionId)}`);
      const json = await res.json();
      if (res.ok && json.paid){
        setProUnlocked();
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        showToast('Payment not verified', true);
      }
    } catch (err){
      console.error('verify error', err);
      showToast('Verification failed', true);
    }
  }
}

if (BUY_PRO_BTN){
  BUY_PRO_BTN.addEventListener('click', (e) => {
    e.preventDefault();
    startCheckout();
  });
}

// --------------------- initialize ---------------------
function init(){
  renderSlots();
  updateCounts();
  renderSummary();
  fetchScoreboard();
  refreshTimer = setInterval(fetchScoreboard, REFRESH_INTERVAL);
  setInterval(()=> { renderSummary(); }, 1500);
  reflectProStatus();
  handleReturnFromStripe();
}

init();
