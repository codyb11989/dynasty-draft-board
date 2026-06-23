/* ============================================================
   Loyal Order of Water Buffaloes — Draft Board
   Single league. 100% client-side. No build step.
   Persists to localStorage; syncs across tabs on the same device.
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'ddb.state.v2';
  const OLD_KEY = 'ddb.state.v1';

  // The one league this board is for. Acts as the offline default; any data
  // you pull from MFL overrides it.
  const LEAGUE = {
    name: 'Loyal Order of Water Buffaloes',
    year: 2026,
    leagueId: '21931',
    rounds: 7,
    snake: false,
    teams: [
      { fid: '0001', name: 'Dang Lin-Wang Mikados' },
      { fid: '0002', name: "Swingin' Macaques" },
      { fid: '0003', name: 'Adobe Dick' },
      { fid: '0004', name: 'The Bearded Clams' },
      { fid: '0005', name: 'Bass to Mouth' },
      { fid: '0006', name: "It's a Five Year Plan" },
      { fid: '0007', name: 'Bro Montana' },
      { fid: '0008', name: 'The Pocket Dogs' },
      { fid: '0009', name: 'Fourth and 20' },
      { fid: '0010', name: 'The Vinegar Strokes' },
    ],
    order: ['0006', '0003', '0010', '0009', '0001', '0008', '0004', '0005', '0002', '0007'],
    owners: { '1-4': '0007', '1-5': '0007', '1-7': '0009', '1-8': '0009', '2-3': '0005', '2-7': '0002', '3-3': '0005', '4-0': '0009' },
  };

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  let state = loadState();

  function defaultBoard() {
    return {
      name: LEAGUE.name, year: LEAGUE.year, leagueId: LEAGUE.leagueId,
      teams: LEAGUE.teams.map((t) => ({ ...t })),
      order: LEAGUE.order.slice(),
      rounds: LEAGUE.rounds, snake: LEAGUE.snake,
      picks: {}, owners: { ...LEAGUE.owners },
      cursor: 1, updatedAt: 0,
    };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch (e) { /* fall through */ }
    // migrate from the old multi-board format if present
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
      if (old && old.boards) {
        const b = Object.values(old.boards).find((x) => x.leagueId === LEAGUE.leagueId) || Object.values(old.boards)[0];
        return normalizeState({ board: b, settings: old.settings, refData: old.refData });
      }
    } catch (e) { /* ignore */ }
    return normalizeState({});
  }
  function normalizeState(s) {
    s = s || {};
    s.settings = s.settings || {};
    s.refData = s.refData || {};
    s.refData.rookies = s.refData.rookies || {};
    s.board = normalizeBoard(s.board);
    return s;
  }
  function normalizeBoard(b) {
    const d = defaultBoard();
    if (!b || !b.teams || !b.order) return d;
    return Object.assign(d, b, {
      picks: b.picks || {}, owners: b.owners || {},
      teams: b.teams, order: b.order,
      updatedAt: b.updatedAt || 0,
    });
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save (storage full?)', true); }
  }
  const board = () => state.board;
  function touch() { state.board.updatedAt = Date.now(); save(); }

  // ---------- board math ----------
  function syncOrder(b) {
    const ids = new Set(b.teams.map((t) => t.fid));
    b.order = b.order.filter((id) => ids.has(id));
    for (const t of b.teams) if (!b.order.includes(t.fid)) b.order.push(t.fid);
  }
  const teamById = (b, fid) => b.teams.find((t) => t.fid === fid);
  const teamName = (b, fid) => (teamById(b, fid) || {}).name || '—';
  const cellKey = (r, slot) => `${r}-${slot}`;
  function pickInRound(b, round, slot) {
    const n = b.order.length;
    return (b.snake && round % 2 === 0) ? (n - slot) : (slot + 1);
  }
  const overallOf = (b, round, slot) => (round - 1) * b.order.length + pickInRound(b, round, slot);
  function sequence(b) {
    const n = b.order.length, seq = [];
    for (let r = 1; r <= b.rounds; r++) {
      const reverse = b.snake && r % 2 === 0;
      for (let i = 0; i < n; i++) {
        const slot = reverse ? n - 1 - i : i;
        seq.push({ round: r, slot, overall: (r - 1) * n + (i + 1), pickInRound: i + 1,
          origFid: b.order[slot], ownerFid: b.owners[cellKey(r, slot)] || b.order[slot], key: cellKey(r, slot) });
      }
    }
    return seq;
  }
  function pickAt(b, overall) {
    if (!b.order.length) return null;
    const seq = sequence(b);
    return seq[clamp(overall, 1, seq.length) - 1] || null;
  }
  function firstEmptyOverall(b) {
    const seq = sequence(b);
    for (const p of seq) if (!(b.picks[p.key] && b.picks[p.key].player)) return p.overall;
    return seq.length;
  }
  const madeCount = (b) => Object.values(b.picks).filter((p) => p && p.player).length;

  // ============================================================
  //  MFL parsing (paste-based; no direct fetch due to CORS)
  // ============================================================
  const mflUrl = (year, league, type) =>
    `https://api.myfantasyleague.com/${year}/export?TYPE=${type}&L=${encodeURIComponent(league)}&JSON=1`;
  const mflPlayersUrl = (year) =>
    `https://api.myfantasyleague.com/${year}/export?TYPE=players&DETAILS=1&JSON=1`;

  function parseLeague(data) {
    const lg = data && data.league;
    if (!lg) throw new Error('Not a TYPE=league response.');
    let fr = lg.franchises && lg.franchises.franchise;
    if (!fr) throw new Error('No franchises found.');
    if (!Array.isArray(fr)) fr = [fr];
    const teams = fr.map((f) => ({ fid: String(f.id), name: String(f.name || 'Team ' + f.id).trim() }))
      .sort((a, b) => a.fid.localeCompare(b.fid));
    return { name: String(lg.name || LEAGUE.name).trim(), teams };
  }

  // draftResults -> draft order, snake, traded picks, AND made picks (player ids -> names)
  function parseDraftResults(data, teams, playerIndex) {
    const dr = data && data.draftResults;
    if (!dr) throw new Error('Not a draftResults response.');
    let units = dr.draftUnit;
    if (!units) throw new Error('No draft data found.');
    if (!Array.isArray(units)) units = [units];
    let all = [];
    for (const u of units) { let dp = u.draftPick || []; if (!Array.isArray(dp)) dp = [dp]; all = all.concat(dp); }
    if (!all.length) throw new Error('Draft has no picks/slots yet.');

    const name2fid = {};
    for (const t of teams) name2fid[t.name.trim()] = t.fid;
    const tradedFrom = (p) => { const m = /traded from ([^.\]]+)/i.exec(p.comments || ''); return m ? name2fid[m[1].trim()] : null; };

    const byRound = {};
    for (const p of all) (byRound[p.round] ||= []).push(p);
    for (const r in byRound) byRound[r].sort((a, b) => (+a.pick) - (+b.pick));
    const keys = Object.keys(byRound).sort((a, b) => (+a) - (+b));
    const N = byRound[keys[0]].length;
    const rounds = Math.max(...keys.map(Number));
    const order = byRound[keys[0]].map((p) => tradedFrom(p) || p.franchise);

    let snake = false;
    if (byRound[keys[1]]) {
      const base2 = byRound[keys[1]].map((p) => tradedFrom(p) || p.franchise);
      snake = base2.join() === order.slice().reverse().join() && base2.join() !== order.join();
    }

    const owners = {}, picks = {};
    for (const rk of keys) {
      const R = Number(rk);
      for (const p of byRound[rk]) {
        const pos = Number(p.pick);
        const slot = (snake && R % 2 === 0) ? (N - pos) : (pos - 1);
        if (slot < 0 || slot >= N) continue;
        const key = cellKey(R, slot);
        if (p.franchise !== order[slot]) owners[key] = p.franchise;
        const pid = String(p.player || '').trim();
        if (pid) {
          const meta = playerIndex && playerIndex.get(pid);
          picks[key] = meta ? { player: meta.name, pos: meta.pos, nfl: meta.team } : { player: '#' + pid, pos: '', nfl: '' };
        }
      }
    }
    return { order, rounds, snake, owners, picks };
  }

  // ============================================================
  //  Rookie pool
  // ============================================================
  function mflFixName(n) {
    n = String(n || '').trim();
    if (n.includes(',')) { const m = n.split(/,(.+)/); return `${(m[1] || '').trim()} ${m[0].trim()}`.trim(); }
    return n;
  }
  function parsePlayersPool(data, year) {
    const pl = data && data.players && data.players.player;
    if (!pl) throw new Error('Not a TYPE=players response.');
    const arr = Array.isArray(pl) ? pl : [pl];
    const ys = String(year);
    const out = arr.filter((p) => String(p.draft_year) === ys).map((p) => ({
      id: String(p.id), name: mflFixName(p.name), pos: (p.position || '').toUpperCase(),
      team: (p.team || '').toUpperCase(), college: p.college || '',
    })).filter((p) => p.name);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }
  const rookiesFor = (year) => state.refData.rookies[String(year)] || null;
  function setRookies(year, list) { state.refData.rookies[String(year)] = list; save(); }
  async function ensureRookies(year) {
    if (rookiesFor(year)) return rookiesFor(year);
    try {
      const res = await fetch(`rookies-${year}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const list = Array.isArray(j) ? j : (j.players || []);
      if (list.length) { setRookies(year, list); return list; }
    } catch (e) { /* offline / file:// — typing still works */ }
    return null;
  }
  let _idxName = { key: null, map: new Map() };
  let _idxId = { key: null, map: new Map() };
  function rookieIndex(year) {
    const list = rookiesFor(year) || [], key = year + ':' + list.length;
    if (_idxName.key !== key) { const m = new Map(); for (const r of list) m.set(r.name.toLowerCase(), r); _idxName = { key, map: m }; }
    return _idxName.map;
  }
  function rookieIdIndex(year) {
    const list = rookiesFor(year) || [], key = year + ':' + list.length;
    if (_idxId.key !== key) { const m = new Map(); for (const r of list) if (r.id) m.set(String(r.id), r); _idxId = { key, map: m }; }
    return _idxId.map;
  }
  function usedPlayerNames(b) {
    const s = new Set();
    for (const k in b.picks) { const p = b.picks[k]; if (p && p.player) s.add(p.player.trim().toLowerCase()); }
    return s;
  }
  function renderRookieDatalist(b) {
    const dl = $('#rookieList'), hint = $('#rookieHint');
    const list = rookiesFor(b.year) || [];
    if (!list.length) {
      dl.innerHTML = '';
      if (hint) hint.innerHTML = 'Rookie list not loaded — typing still works. <span class="muted">Pull it in ⚙ Update / Settings.</span>';
      return;
    }
    const used = usedPlayerNames(b);
    const avail = list.filter((r) => !used.has(r.name.toLowerCase()));
    dl.innerHTML = avail.map((r) =>
      `<option value="${esc(r.name)}">${esc([r.pos, r.team, r.college].filter(Boolean).join(' · '))}</option>`).join('');
    if (hint) hint.innerHTML = `<b>${avail.length}</b> of ${list.length} ${b.year} rookies available · start typing to search`;
  }
  function setSelectPos(sel, pos) {
    pos = (pos || '').toUpperCase();
    if (!pos) { sel.value = ''; return; }
    let opt = [...sel.options].find((o) => o.value.toUpperCase() === pos);
    if (!opt) { opt = new Option(pos, pos); sel.add(opt); }
    sel.value = opt.value;
  }
  function autofillFromRookie(year, nameEl, posEl, nflEl) {
    const r = rookieIndex(year).get(nameEl.value.trim().toLowerCase());
    if (!r) return;
    if (posEl) setSelectPos(posEl, r.pos);
    if (nflEl) nflEl.value = r.team || '';
  }
  // positions with their own board color (offense + each defensive spot)
  const POS_COLORS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DT', 'DE', 'LB', 'CB', 'S']);
  const IDP_SET = new Set(['DB', 'DL', 'NT', 'EDGE', 'OLB', 'ILB', 'MLB', 'FS', 'SS', 'IDP']);
  function posClass(pos) {
    if (!pos) return '';
    pos = pos.toUpperCase();
    if (POS_COLORS.has(pos)) return 'pos-' + pos;
    if (pos === 'K') return 'pos-PK';
    if (pos === 'DEF' || pos === 'DST') return 'pos-DEF';
    if (IDP_SET.has(pos)) return 'pos-IDP';
    return '';
  }

  // ---------- NFL team helmets (real images in assets/helmets/, keyed by MFL team code) ----------
  // Canonical MFL codes that have a helmet image on disk.
  const HELMET_CODES = new Set([
    'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GBP',
    'HOU', 'IND', 'JAC', 'KCC', 'LAC', 'LAR', 'LVR', 'MIA', 'MIN', 'NEP', 'NOS', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SEA', 'SFO', 'TBB', 'TEN', 'WAS',
  ]);
  // Common alternate abbreviations (ESPN / nflverse / typed) -> the MFL code we store the file under.
  const HELMET_ALIAS = {
    GB: 'GBP', GNB: 'GBP', KC: 'KCC', KAN: 'KCC', NE: 'NEP', NWE: 'NEP', NO: 'NOS', NOR: 'NOS',
    SF: 'SFO', SAN: 'SFO', TB: 'TBB', TAM: 'TBB', LV: 'LVR', OAK: 'LVR', RAI: 'LVR',
    LA: 'LAR', RAM: 'LAR', STL: 'LAR', SD: 'LAC', SDC: 'LAC', JAX: 'JAC', JAG: 'JAC',
    WSH: 'WAS', WFT: 'WAS', ARZ: 'ARI', CLV: 'CLE', HST: 'HOU', BLT: 'BAL',
  };
  function helmetCode(team) {
    const t = (team || '').toUpperCase().trim();
    if (HELMET_CODES.has(t)) return t;
    return HELMET_ALIAS[t] || null;
  }
  function helmet(team) {
    const code = helmetCode(team);
    if (!code) return '';
    return `<img class="helmet" src="assets/helmets/${code}.png" alt="${esc(code)}" decoding="async" />`;
  }

  // ============================================================
  //  Rendering
  // ============================================================
  const el = {};
  function renderAll() {
    const b = board();
    $('#brandTitle').textContent = b.name;
    $('#brandSub').textContent = `${b.year} Rookie Draft · MFL ${b.leagueId}`;
    renderClock(b);
    renderBoard(b);
    renderTrades(b);
    renderOrder(b);
    renderRookieDatalist(b);
    if (!rookiesFor(b.year)) ensureRookies(b.year).then((l) => { if (l) renderRookieDatalist(b); });
  }

  function renderClock(b) {
    b.cursor = clamp(b.cursor || 1, 1, b.rounds * b.order.length);
    const p = pickAt(b, b.cursor);
    $('#clockPick').textContent = `${p.round}.${pad2(p.pickInRound)}`;
    $('#clockTeam').textContent = teamName(b, p.ownerFid);
    $('#clockOrig').textContent = p.ownerFid !== p.origFid
      ? `traded from ${teamName(b, p.origFid)} · overall #${p.overall}` : `overall #${p.overall}`;
    const cur = b.picks[p.key] || {};
    $('#clockPlayer').value = cur.player || '';
    $('#clockPos').value = cur.pos || '';
    $('#clockNfl').value = cur.nfl || '';
  }

  function renderBoard(b) {
    $('#boardName').textContent = b.name;
    const total = b.rounds * b.order.length;
    $('#boardProgress').textContent = `${madeCount(b)} / ${total} picks · ${b.order.length} teams · ${b.rounds} rounds`;
    const onClockKey = pickAt(b, b.cursor)?.key;

    let head = '<thead><tr><th class="corner">Team</th>';
    for (let r = 1; r <= b.rounds; r++) head += `<th>Round ${r}</th>`;
    head += '</tr></thead>';

    let body = '<tbody>';
    for (let slot = 0; slot < b.order.length; slot++) {
      const origFid = b.order[slot];
      body += `<tr><td class="team-col"><div class="team-name">${esc(teamName(b, origFid))}</div><div class="team-seed">Seed ${slot + 1}</div></td>`;
      for (let r = 1; r <= b.rounds; r++) {
        const key = cellKey(r, slot);
        const pick = b.picks[key];
        const ownerFid = b.owners[key] || origFid;
        const traded = ownerFid !== origFid;
        const pir = pickInRound(b, r, slot);
        const overall = overallOf(b, r, slot);
        const posCls = pick && pick.player ? posClass(pick.pos) : '';
        const cls = ['pick', posCls, traded ? 'traded' : '', pick && pick.player ? '' : 'empty', key === onClockKey ? 'onclock' : ''].filter(Boolean).join(' ');
        const sub = pick && pick.player
          ? [pick.pos && pick.pos !== 'OTHER' ? pick.pos : '', pick.nfl ? pick.nfl.toUpperCase() : ''].filter(Boolean).join(' · ') : '';
        const badge = traded ? `<span class="trade-badge" title="Now owned by ${esc(teamName(b, ownerFid))}">→ ${esc(teamName(b, ownerFid))}</span>` : '';
        const filled = pick && pick.player;
        const inner = filled
          ? `<div class="pick-row">${helmet(pick.nfl)}<div class="pick-text">
                <span class="player">${esc(pick.player)}</span>
                ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
              </div></div>${badge}`
          : `<span class="player">Add pick</span>${badge}`;
        body += `<td class="cell"><div class="${cls}" data-key="${key}" data-round="${r}" data-slot="${slot}" tabindex="0" role="button">
            <span class="pick-no" title="Overall #${overall}">${r}.${pad2(pir)}</span>${inner}
          </div></td>`;
      }
      body += '</tr>';
    }
    body += '</tbody>';
    $('#boardTable').innerHTML = head + body;
  }

  function renderTrades(b) {
    const seq = sequence(b);
    $('#tradePick').innerHTML = seq.map((p) =>
      `<option value="${p.key}">${p.round}.${pad2(p.pickInRound)} — ${esc(teamName(b, p.origFid))}${p.ownerFid !== p.origFid ? ' (→ ' + esc(teamName(b, p.ownerFid)) + ')' : ''}</option>`).join('');
    $('#tradeOwner').innerHTML = b.order.map((fid) => `<option value="${fid}">${esc(teamName(b, fid))}</option>`).join('');
    const traded = seq.filter((p) => p.ownerFid !== p.origFid);
    $('#tradeCount').textContent = traded.length ? String(traded.length) : '';
    $('#tradeList').innerHTML = traded.length
      ? traded.map((p) => `<li class="trade-item"><span class="ti-pick">${p.round}.${pad2(p.pickInRound)}</span>
          <span>${esc(teamName(b, p.origFid))}</span><span class="ti-arrow">→</span><strong>${esc(teamName(b, p.ownerFid))}</strong>
          <button class="btn ghost tiny ti-undo" data-key="${p.key}" type="button">Undo</button></li>`).join('')
      : '<li class="empty-list">No traded picks. Pull them from MFL, use the form above, or click any pick.</li>';
  }

  function renderOrder(b) {
    const list = $('#orderList'); if (!list) return;
    list.innerHTML = b.order.map((fid, i) => {
      const t = teamById(b, fid);
      return `<li class="order-row" draggable="true" data-fid="${fid}">
        <span class="order-handle" title="Drag to reorder">⠿</span><span class="order-seed">${i + 1}</span>
        <input class="order-name" value="${esc(t ? t.name : '')}" data-fid="${fid}" />
        <span class="order-arrows"><button type="button" data-act="up" title="Up">▲</button><button type="button" data-act="down" title="Down">▼</button></span>
      </li>`;
    }).join('');
  }

  // ============================================================
  //  Mutations
  // ============================================================
  function setPick(b, key, data) {
    if (!data || (!data.player && !data.pos && !data.nfl)) delete b.picks[key];
    else b.picks[key] = data;
    touch();
  }
  function setOwner(b, key, fid) {
    const slot = Number(key.split('-')[1]);
    if (!fid || fid === b.order[slot]) delete b.owners[key];
    else b.owners[key] = fid;
    touch();
  }
  function cleanupOwners(b) {
    const ids = new Set(b.teams.map((t) => t.fid));
    for (const k in b.owners) if (!ids.has(b.owners[k])) delete b.owners[k];
  }
  function remapSlots(b, mutate) {
    const before = b.order.slice();
    mutate();
    const after = b.order, oldIndexOf = (fid) => before.indexOf(fid);
    const np = {}, no = {};
    for (let r = 1; r <= b.rounds; r++) for (let ns = 0; ns < after.length; ns++) {
      const os = oldIndexOf(after[ns]); if (os < 0) continue;
      const ok = cellKey(r, os), nk = cellKey(r, ns);
      if (b.picks[ok]) np[nk] = b.picks[ok];
      if (b.owners[ok]) no[nk] = b.owners[ok];
    }
    b.picks = np; b.owners = no;
  }

  // ============================================================
  //  Pick modal
  // ============================================================
  const pickModal = $('#pickModal');
  let modalKey = null;
  function openPickModal(b, key) {
    modalKey = key;
    const [round, slot] = key.split('-').map(Number);
    const origFid = b.order[slot], pick = b.picks[key] || {}, ownerFid = b.owners[key] || origFid;
    $('#modalTitle').textContent = `Round ${round} · ${teamName(b, origFid)}`;
    $('#modalSub').innerHTML = `Pick <strong>${round}.${pad2(pickInRound(b, round, slot))}</strong> · overall #${overallOf(b, round, slot)}`;
    $('#mPlayer').value = pick.player || ''; $('#mPos').value = pick.pos || ''; $('#mNfl').value = pick.nfl || '';
    $('#mOwner').innerHTML = b.order.map((fid) =>
      `<option value="${fid}" ${fid === ownerFid ? 'selected' : ''}>${esc(teamName(b, fid))}${fid === origFid ? ' (original)' : ''}</option>`).join('');
    if (pickModal.showModal) pickModal.showModal(); else pickModal.setAttribute('open', '');
    setTimeout(() => $('#mPlayer').focus(), 30);
  }
  function closePickModal() { if (pickModal.open) pickModal.close(); modalKey = null; }
  function savePickModal() {
    const b = board(); if (!modalKey) return;
    setPick(b, modalKey, { player: $('#mPlayer').value.trim(), pos: $('#mPos').value, nfl: $('#mNfl').value.trim().toUpperCase() });
    setOwner(b, modalKey, $('#mOwner').value);
    closePickModal(); renderClock(b); renderBoard(b); renderTrades(b); renderRookieDatalist(b);
  }

  // ============================================================
  //  Imports (paste) + apply
  // ============================================================
  function onImportPaste() {
    const b = board(), status = $('#importStatus');
    let data;
    try { data = JSON.parse($('#importJson').value); }
    catch (e) { status.className = 'status err'; status.textContent = "That isn't valid JSON — copy the whole response."; return; }
    try {
      if (data.league) {
        applyLeague(parseLeague(data));
        status.className = 'status ok'; status.textContent = `Teams updated (${b.teams.length}).`;
      } else if (data.draftResults) {
        const parsed = parseDraftResults(data, b.teams, rookieIdIndex(b.year));
        applyDraft(parsed);
        const made = Object.keys(parsed.picks).length;
        status.className = 'status ok';
        status.textContent = `Draft updated — order, ${Object.keys(parsed.owners).length} trade(s)` + (made ? `, ${made} pick(s) made.` : '.');
      } else if (data.players) {
        const list = parsePlayersPool(data, b.year);
        if (!list.length) throw new Error(`No ${b.year} rookies in that data.`);
        setRookies(b.year, list); renderRookieDatalist(b);
        status.className = 'status ok'; status.textContent = `Rookie pool updated (${list.length}).`;
      } else throw new Error('Unrecognized — expected league, draftResults, or players JSON.');
      $('#importJson').value = '';
      toast('Updated from MFL');
    } catch (e) { status.className = 'status err'; status.textContent = 'Could not load: ' + e.message; }
  }
  function applyLeague(parsed) {
    const b = board(), byId = new Map(b.teams.map((t) => [t.fid, t]));
    for (const t of parsed.teams) { if (byId.has(t.fid)) byId.get(t.fid).name = t.name; else b.teams.push({ ...t }); }
    if (parsed.name) b.name = parsed.name;
    syncOrder(b); touch(); renderAll();
  }
  function applyDraft(parsed) {
    const b = board(), ids = new Set(b.teams.map((t) => t.fid));
    if (!parsed.order.length || parsed.order.length !== b.teams.length || !parsed.order.every((f) => ids.has(f)))
      throw new Error("draft order doesn't match the league's teams.");
    b.rounds = clamp(parsed.rounds || b.rounds, 1, 40);
    b.snake = !!parsed.snake;
    remapSlots(b, () => { b.order = parsed.order.slice(); });
    const own = {}; for (const k in parsed.owners) if (ids.has(parsed.owners[k])) own[k] = parsed.owners[k];
    b.owners = own;
    for (const k in parsed.picks) b.picks[k] = parsed.picks[k]; // merge made picks
    b.cursor = firstEmptyOverall(b);
    touch(); renderAll();
    $('#roundsInput').value = b.rounds; $('#snakeInput').checked = b.snake;
  }

  // ============================================================
  //  Cross-tab sync (same device) + file download helpers
  // ============================================================
  function onStorage(e) {
    if (e.key !== STORE_KEY || !e.newValue) return;
    try { state = normalizeState(JSON.parse(e.newValue)); renderAll(); } catch (err) { /* ignore */ }
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function csvRow(cells) {
    return cells.map((v) => {
      const s = String(v ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',');
  }
  function downloadCSV(name, rows) {
    const text = rows.map(csvRow).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  // ============================================================
  //  CSV exports
  // ============================================================
  // MFL post-draft import format: round,pick,franchise,player
  // "pick" = chronological pick number within the round (matches MFL's draftResults schema).
  // "player" = MFL player ID looked up from the rookie pool; blank if the player isn't in the pool.
  function exportMFLCsv() {
    const b = board();
    const rIdx = rookieIndex(b.year);
    const rows = [['round', 'pick', 'franchise', 'player']];
    let missing = 0;
    for (const p of sequence(b)) {
      const pick = b.picks[p.key];
      if (!pick || !pick.player) continue;
      const meta = rIdx.get(pick.player.trim().toLowerCase());
      const pid = meta ? meta.id : '';
      if (!pid) missing++;
      rows.push([p.round, p.pickInRound, p.ownerFid, pid]);
    }
    downloadCSV(`${b.name.replace(/[^a-z0-9]+/gi, '_')}_${b.year}_mfl_import.csv`, rows);
    if (missing) toast(`MFL CSV: ${missing} player(s) had no MFL ID — those rows have a blank player column.`, true);
    else toast('MFL import CSV exported');
  }

  // Detailed results: all pick slots with player info and ownership
  function exportDetailedCsv() {
    const b = board();
    const rows = [['Overall', 'Round', 'Pick', 'Player', 'Position', 'NFLTeam', 'Owner', 'OriginalOwner']];
    for (const p of sequence(b)) {
      const pick = b.picks[p.key] || {};
      rows.push([
        p.overall, p.round, p.pickInRound,
        pick.player || '', pick.pos || '', pick.nfl || '',
        teamName(b, p.ownerFid),
        p.ownerFid !== p.origFid ? teamName(b, p.origFid) : '',
      ]);
    }
    downloadCSV(`${b.name.replace(/[^a-z0-9]+/gi, '_')}_${b.year}_draft_results.csv`, rows);
    toast('Draft results CSV exported');
  }

  // ============================================================
  //  Fullscreen / focus mode
  // ============================================================
  function setFocus(on) {
    document.body.classList.toggle('board-focus', on);
    $$('#fullscreenBtn, #fullscreenBtn2').forEach((btn) => { btn.textContent = on ? '⤢ Exit full screen' : '⛶ Full screen'; });
    if (on) { document.documentElement.requestFullscreen?.().catch(() => {}); }
    else if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); }
    const cell = $('.pick.onclock'); cell?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  const toggleFocus = () => setFocus(!document.body.classList.contains('board-focus'));

  // ============================================================
  //  Settings
  // ============================================================
  function openSettings() {
    const b = board();
    $('#urlTeams').href = mflUrl(b.year, b.leagueId, 'league');
    $('#urlDraft').href = mflUrl(b.year, b.leagueId, 'draftResults');
    $('#urlRookies').href = mflPlayersUrl(b.year);
    $('#roundsInput').value = b.rounds; $('#snakeInput').checked = b.snake;
    renderOrder(b);
    const m = $('#settingsModal');
    if (m.showModal) m.showModal(); else m.setAttribute('open', '');
  }
  function onReset() {
    if (!confirm('Reset the board to league defaults? This clears all entered picks and trades on THIS device.')) return;
    state.board = defaultBoard(); save(); renderAll();
    toast('Reset to league defaults');
  }
  function onExport() {
    const b = board();
    download(`${b.name.replace(/[^a-z0-9]+/gi, '_')}_${b.year}.json`, JSON.stringify(b, null, 2));
  }
  function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imp = JSON.parse(reader.result);
        if (!imp.teams || !imp.order) throw new Error('Not a board file');
        state.board = normalizeBoard(imp); touch(); renderAll();
        toast('Board imported');
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    reader.readAsText(file); e.target.value = '';
  }

  // ============================================================
  //  Toast
  // ============================================================
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('err', isErr); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ============================================================
  //  Events
  // ============================================================
  function bind() {
    // header / fullscreen
    $$('#fullscreenBtn, #fullscreenBtn2').forEach((b) => b.addEventListener('click', toggleFocus));
    $('#settingsBtn').addEventListener('click', openSettings);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('board-focus') && !pickModal.open && !$('#settingsModal').open) setFocus(false); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('board-focus')) setFocus(false); });

    // collapsible trades
    $('#tradesToggle').addEventListener('click', () => {
      const s = $('#tradesSection'); s.classList.toggle('collapsed');
      $('#tradesToggle').setAttribute('aria-expanded', String(!s.classList.contains('collapsed')));
    });

    // clock
    $('#clockForm').addEventListener('submit', onClockSubmit);
    $('#clockPrev').addEventListener('click', () => moveCursor(-1));
    $('#clockNext').addEventListener('click', () => moveCursor(1));
    $('#clockUndo').addEventListener('click', onClockClear);
    $('#clockPlayer').addEventListener('input', () => autofillFromRookie(board().year, $('#clockPlayer'), $('#clockPos'), $('#clockNfl')));

    // board
    $('#boardTable').addEventListener('click', (e) => {
      const cell = e.target.closest('.pick'); if (!cell) return;
      const b = board();
      b.cursor = pickAt(b, overallOf(b, +cell.dataset.round, +cell.dataset.slot)).overall; touch(); renderClock(b);
      openPickModal(b, cell.dataset.key);
    });
    $('#boardTable').addEventListener('keydown', (e) => {
      const cell = e.target.closest('.pick'); if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cell.click(); }
    });

    // pick modal
    $('#mPlayer').addEventListener('input', () => autofillFromRookie(board().year, $('#mPlayer'), $('#mPos'), $('#mNfl')));
    $('#mSave').addEventListener('click', savePickModal);
    $('#mCancel').addEventListener('click', closePickModal);
    $('#modalClose').addEventListener('click', closePickModal);
    $('#mClear').addEventListener('click', () => { const b = board(); if (modalKey) { setPick(b, modalKey, null); closePickModal(); renderClock(b); renderBoard(b); renderRookieDatalist(b); } });
    $('#pickForm').addEventListener('submit', (e) => { e.preventDefault(); savePickModal(); });

    // trades
    $('#tradeForm').addEventListener('submit', (e) => {
      e.preventDefault(); const b = board();
      setOwner(b, $('#tradePick').value, $('#tradeOwner').value);
      renderBoard(b); renderTrades(b); renderClock(b); toast('Trade applied');
    });
    $('#tradeList').addEventListener('click', (e) => {
      const btn = e.target.closest('.ti-undo'); if (!btn) return;
      const b = board(); setOwner(b, btn.dataset.key, null); renderBoard(b); renderTrades(b); renderClock(b);
    });
    $('#tradeQuickBtn').addEventListener('click', () => {
      $('#tradesSection').classList.remove('collapsed');
      $('#tradesSection').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#tradePick').focus();
    });

    // board actions
    $('#printBtn').addEventListener('click', () => window.print());

    // order editor (in settings)
    $('#orderList').addEventListener('click', onOrderClick);
    $('#orderList').addEventListener('change', onOrderRename);
    $('#roundsInput').addEventListener('change', (e) => { const b = board(); b.rounds = clamp(parseInt(e.target.value, 10) || 7, 1, 40); e.target.value = b.rounds; touch(); renderAll(); });
    $('#snakeInput').addEventListener('change', (e) => { board().snake = e.target.checked; touch(); renderAll(); });
    wireDrag();

    // settings: imports
    $('#importLoadBtn').addEventListener('click', onImportPaste);
    $('#settingsModal').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]'); if (!c) return;
      const href = $('#' + c.dataset.copy).href; navigator.clipboard?.writeText(href).then(() => toast('URL copied'));
    });

    // settings: backup
    $('#exportBtn').addEventListener('click', onExport);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', onImportFile);
    $('#resetBtn').addEventListener('click', onReset);
    $('#exportMFLBtn').addEventListener('click', exportMFLCsv);
    $('#exportDetailedBtn').addEventListener('click', exportDetailedCsv);
    $('#settingsClose').addEventListener('click', () => $('#settingsModal').close());
    $('#settingsDone').addEventListener('click', () => $('#settingsModal').close());

    // close modals on backdrop
    for (const m of [pickModal, $('#settingsModal')]) m.addEventListener('click', (e) => { if (e.target === m) m.close(); });

    // cross-tab sync (same device)
    window.addEventListener('storage', onStorage);
  }

  // ---- clock handlers ----
  function onClockSubmit(e) {
    e.preventDefault();
    const b = board(); const p = pickAt(b, b.cursor);
    const player = $('#clockPlayer').value.trim();
    if (!player) { $('#clockPlayer').focus(); return; }
    setPick(b, p.key, { player, pos: $('#clockPos').value, nfl: $('#clockNfl').value.trim().toUpperCase() });
    b.cursor = firstEmptyOverall(b); touch();
    renderClock(b); renderBoard(b); renderRookieDatalist(b);
    $('#clockPlayer').focus(); scrollOnClock();
  }
  function onClockClear() { const b = board(); setPick(b, pickAt(b, b.cursor).key, null); renderClock(b); renderBoard(b); renderRookieDatalist(b); }
  function moveCursor(d) { const b = board(); b.cursor = clamp(b.cursor + d, 1, b.rounds * b.order.length); touch(); renderClock(b); renderBoard(b); scrollOnClock(); }
  function scrollOnClock() { $('.pick.onclock')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }

  // ---- order handlers ----
  function onOrderClick(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const b = board(), fid = e.target.closest('.order-row').dataset.fid, idx = b.order.indexOf(fid), act = btn.dataset.act;
    if (act === 'up' && idx > 0) remapSlots(b, () => { const o = b.order;[o[idx], o[idx - 1]] = [o[idx - 1], o[idx]]; });
    else if (act === 'down' && idx < b.order.length - 1) remapSlots(b, () => { const o = b.order;[o[idx], o[idx + 1]] = [o[idx + 1], o[idx]]; });
    touch(); renderAll();
  }
  function onOrderRename(e) {
    if (!e.target.classList.contains('order-name')) return;
    const t = teamById(board(), e.target.dataset.fid);
    if (t) { t.name = e.target.value.trim() || t.name; touch(); renderAll(); }
  }
  function wireDrag() {
    const listEl = $('#orderList'); let dragFid = null;
    listEl.addEventListener('dragstart', (e) => { const r = e.target.closest('.order-row'); if (!r) return; dragFid = r.dataset.fid; r.classList.add('dragging'); });
    listEl.addEventListener('dragend', (e) => { e.target.closest('.order-row')?.classList.remove('dragging'); $$('.order-row', listEl).forEach((r) => r.classList.remove('drop-target')); });
    listEl.addEventListener('dragover', (e) => { e.preventDefault(); const r = e.target.closest('.order-row'); $$('.order-row', listEl).forEach((x) => x.classList.remove('drop-target')); if (r && r.dataset.fid !== dragFid) r.classList.add('drop-target'); });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault(); const r = e.target.closest('.order-row'), b = board(); if (!r || !dragFid) return;
      const from = b.order.indexOf(dragFid), to = b.order.indexOf(r.dataset.fid);
      if (from < 0 || to < 0 || from === to) return;
      remapSlots(b, () => { const [m] = b.order.splice(from, 1); b.order.splice(to, 0, m); });
      dragFid = null; touch(); renderAll();
    });
  }

  // ============================================================
  //  init
  // ============================================================
  function init() {
    bind();
    renderAll();
    ensureRookies(board().year).then((l) => { if (l) renderRookieDatalist(board()); });
  }
  init();
})();
