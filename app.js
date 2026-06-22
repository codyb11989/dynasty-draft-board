/* ============================================================
   Dynasty Draft Board
   Pure client-side. Persists to localStorage. No build step.
   ============================================================ */
(() => {
  'use strict';

  const STORE_KEY = 'ddb.state.v1';
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'OTHER'];

  // ---------- tiny helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad2 = (n) => String(n).padStart(2, '0');
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  let state = loadState();
  state.settings ||= { proxy: '' };
  state.refData ||= { rookies: {} };
  state.refData.rookies ||= {};

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { console.warn('load failed', e); }
    return { version: 1, boards: {}, activeId: null, settings: { proxy: '' } };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save (storage full?)', true); }
  }
  const boards = () => state.boards;
  const active = () => state.boards[state.activeId] || null;

  // ---------- board model ----------
  function newBoard(partial = {}) {
    const id = 'b_' + uid();
    const b = {
      id,
      name: partial.name || 'New Draft Board',
      year: partial.year || new Date().getFullYear(),
      leagueId: partial.leagueId || '',
      teams: partial.teams || [],     // [{fid, name}]
      order: partial.order || [],     // [fid, ...] (round-1 order; index = slot)
      rounds: partial.rounds || 7,
      snake: partial.snake || false,
      picks: {},                      // "round-slot" -> {player,pos,nfl}
      owners: {},                     // "round-slot" -> fid (current owner if traded)
      cursor: 1,                      // overall pick the clock is on
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    syncOrder(b);
    return b;
  }

  // keep order array consistent with teams
  function syncOrder(b) {
    const ids = new Set(b.teams.map((t) => t.fid));
    b.order = b.order.filter((id) => ids.has(id));
    for (const t of b.teams) if (!b.order.includes(t.fid)) b.order.push(t.fid);
  }

  function teamById(b, fid) { return b.teams.find((t) => t.fid === fid); }
  function teamName(b, fid) { const t = teamById(b, fid); return t ? t.name : '—'; }
  const cellKey = (round, slot) => `${round}-${slot}`;

  // pickInRound for a given slot index, honoring snake
  function pickInRound(b, round, slot) {
    const n = b.order.length;
    return (b.snake && round % 2 === 0) ? (n - slot) : (slot + 1);
  }
  function overallOf(b, round, slot) {
    return (round - 1) * b.order.length + pickInRound(b, round, slot);
  }
  // build full ordered list of picks (draft sequence)
  function sequence(b) {
    const n = b.order.length;
    const seq = [];
    for (let r = 1; r <= b.rounds; r++) {
      const reverse = b.snake && r % 2 === 0;
      for (let i = 0; i < n; i++) {
        const slot = reverse ? n - 1 - i : i;
        seq.push({
          round: r, slot, overall: (r - 1) * n + (i + 1), pickInRound: i + 1,
          origFid: b.order[slot],
          ownerFid: b.owners[cellKey(r, slot)] || b.order[slot],
          key: cellKey(r, slot),
        });
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
    return seq.length; // all filled -> stay on last
  }
  function madeCount(b) {
    return Object.values(b.picks).filter((p) => p && p.player).length;
  }

  // ============================================================
  //  MFL import
  // ============================================================
  function mflUrl(year, league, type = 'league') {
    return `https://api.myfantasyleague.com/${year}/export?TYPE=${type}&L=${encodeURIComponent(league)}&JSON=1`;
  }

  // Parse an MFL `TYPE=league` payload into {name, teams[]}
  function parseLeague(data) {
    const lg = data && data.league;
    if (!lg) throw new Error('Not a valid MFL league response.');
    let fr = lg.franchises && lg.franchises.franchise;
    if (!fr) throw new Error('No franchises found in response.');
    if (!Array.isArray(fr)) fr = [fr];
    const teams = fr
      .map((f) => ({ fid: String(f.id), name: String(f.name || ('Team ' + f.id)).trim() }))
      .sort((a, b) => a.fid.localeCompare(b.fid));
    if (!teams.length) throw new Error('League has no teams.');
    return { name: String(lg.name || 'League').trim(), teams };
  }

  // Parse an MFL `TYPE=draftResults` payload into draft order + traded picks.
  // Needs the team list so we can map franchise IDs and trade-comment names.
  function parseDraftResults(data, teams) {
    const dr = data && data.draftResults;
    if (!dr) throw new Error('Not a draftResults response.');
    let units = dr.draftUnit;
    if (!units) throw new Error('No draft data found.');
    if (!Array.isArray(units)) units = [units];
    let picks = [];
    for (const u of units) {
      let dp = u.draftPick || [];
      if (!Array.isArray(dp)) dp = [dp];
      picks = picks.concat(dp);
    }
    if (!picks.length) throw new Error('Draft has no picks/slots yet.');

    const name2fid = {};
    for (const t of teams) name2fid[t.name.trim()] = t.fid;
    const tradedFrom = (p) => {
      const m = /traded from ([^.\]]+)/i.exec(p.comments || '');
      return m ? name2fid[m[1].trim()] : null;
    };

    // group by round, sort by pick number
    const byRound = {};
    for (const p of picks) (byRound[p.round] ||= []).push(p);
    for (const r in byRound) byRound[r].sort((a, b) => (+a.pick) - (+b.pick));
    const roundKeys = Object.keys(byRound).sort((a, b) => (+a) - (+b));
    const N = byRound[roundKeys[0]].length;
    const rounds = Math.max(...roundKeys.map(Number));

    // base (standings) order = round-1 owners with trades undone
    const r1 = byRound[roundKeys[0]];
    const order = r1.map((p) => tradedFrom(p) || p.franchise);

    // snake? compare de-traded round 2 to round 1 reversed
    let snake = false;
    if (byRound[roundKeys[1]]) {
      const baseR2 = byRound[roundKeys[1]].map((p) => tradedFrom(p) || p.franchise);
      snake = baseR2.join() === order.slice().reverse().join() && baseR2.join() !== order.join();
    }

    // current owners -> overrides keyed by round-slot
    const owners = {};
    for (const rk of roundKeys) {
      const R = Number(rk);
      for (const p of byRound[rk]) {
        const pos = Number(p.pick);
        const slot = (snake && R % 2 === 0) ? (N - pos) : (pos - 1);
        if (slot < 0 || slot >= N) continue;
        if (p.franchise !== order[slot]) owners[cellKey(R, slot)] = p.franchise;
      }
    }
    return { order, rounds, snake, owners };
  }

  async function proxyFetch(target) {
    const proxy = (state.settings.proxy || '').trim();
    const attempts = [];
    if (proxy) attempts.push(proxy.includes('{url}')
      ? proxy.replace('{url}', encodeURIComponent(target))
      : proxy + encodeURIComponent(target));
    // best-effort public fallbacks (often rate-limited; manual paste is the reliable path)
    attempts.push('https://api.allorigins.win/raw?url=' + encodeURIComponent(target));
    attempts.push('https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(target));
    let lastErr;
    for (const url of attempts) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = JSON.parse(await res.text());
        if (data.error) throw new Error(typeof data.error === 'string' ? data.error : 'MFL error');
        return data;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('All fetch attempts failed.');
  }

  async function fetchLeague(year, league) {
    return parseLeague(await proxyFetch(mflUrl(year, league, 'league')));
  }

  // ============================================================
  //  Rookie pool (available-player list for "Add pick")
  // ============================================================
  function mflFixName(n) {
    n = String(n || '').trim();
    if (n.includes(',')) { const m = n.split(/,(.+)/); return `${(m[1] || '').trim()} ${m[0].trim()}`.trim(); }
    return n;
  }
  // Parse a raw MFL TYPE=players payload -> [{name,pos,team,college}] for that season's rookies.
  function parsePlayersPool(data, year) {
    const pl = data && data.players && data.players.player;
    if (!pl) throw new Error('Not a TYPE=players response.');
    const arr = Array.isArray(pl) ? pl : [pl];
    const ys = String(year);
    const out = arr
      .filter((p) => String(p.draft_year) === ys)
      .map((p) => ({ name: mflFixName(p.name), pos: (p.position || '').toUpperCase(), team: (p.team || '').toUpperCase(), college: p.college || '' }))
      .filter((p) => p.name);
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  const rookiesFor = (year) => state.refData.rookies[String(year)] || null;
  function setRookies(year, list) { state.refData.rookies[String(year)] = list; save(); }

  // Load the bundled rookies-<year>.json (best effort; needs the site to be served, not file://).
  async function ensureRookies(year) {
    if (rookiesFor(year)) return rookiesFor(year);
    try {
      const res = await fetch(`rookies-${year}.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const list = Array.isArray(j) ? j : (j.players || []);
      if (list.length) { setRookies(year, list); return list; }
    } catch (e) { /* offline / file:// — datalist stays empty, typing still works */ }
    return null;
  }

  let _rookieIdx = { key: null, map: new Map() };
  function rookieIndex(year) {
    const list = rookiesFor(year) || [];
    const key = year + ':' + list.length;
    if (_rookieIdx.key !== key) {
      const m = new Map();
      for (const r of list) m.set(r.name.toLowerCase(), r);
      _rookieIdx = { key, map: m };
    }
    return _rookieIdx.map;
  }
  function usedPlayerNames(b) {
    const s = new Set();
    for (const k in b.picks) { const p = b.picks[k]; if (p && p.player) s.add(p.player.trim().toLowerCase()); }
    return s;
  }
  // Populate the shared <datalist> with rookies not yet drafted on this board.
  function renderRookieDatalist(b) {
    const dl = $('#rookieList'), hint = $('#rookieHint'), pool = $('#poolStatus');
    const list = rookiesFor(b.year) || [];
    if (!list.length) {
      dl.innerHTML = '';
      if (hint) hint.innerHTML = 'No rookie list loaded — typing still works. <span class="muted">Load it in ⚙ Settings.</span>';
      if (pool) pool.textContent = `No rookie list loaded for ${b.year}.`;
      return;
    }
    const used = usedPlayerNames(b);
    const avail = list.filter((r) => !used.has(r.name.toLowerCase()));
    dl.innerHTML = avail.map((r) =>
      `<option value="${esc(r.name)}">${esc([r.pos, r.team, r.college].filter(Boolean).join(' · '))}</option>`).join('');
    if (hint) hint.innerHTML = `<b>${avail.length}</b> of ${list.length} ${b.year} rookies available · start typing to search`;
    if (pool) pool.textContent = `${list.length} ${b.year} rookies loaded (${avail.length} still available).`;
  }

  // When a player name matches a known rookie, fill in position + NFL team.
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

  // Map any position (incl. IDP) to a board color class.
  const IDP_SET = new Set(['DT', 'DE', 'LB', 'CB', 'S', 'DB', 'DL', 'NT', 'EDGE', 'OLB', 'ILB', 'MLB', 'FS', 'SS', 'IDP']);
  function posClass(pos) {
    if (!pos) return '';
    pos = pos.toUpperCase();
    if (['QB', 'RB', 'WR', 'TE'].includes(pos)) return 'pos-' + pos;
    if (pos === 'PK' || pos === 'K') return 'pos-PK';
    if (pos === 'DEF' || pos === 'DST') return 'pos-DEF';
    if (IDP_SET.has(pos)) return 'pos-IDP';
    return '';
  }

  // ============================================================
  //  Rendering
  // ============================================================
  const el = {
    main: $('#main'),
    emptyState: $('#emptyState'),
    boardSelect: $('#boardSelect'),
    brandSub: $('#brandSub'),
    setupSection: $('#setupSection'),
    clockSection: $('#clockSection'),
    boardSection: $('#boardSection'),
    tradesSection: $('#tradesSection'),
    orderList: $('#orderList'),
    boardTable: $('#boardTable'),
    boardName: $('#boardName'),
    boardProgress: $('#boardProgress'),
    // clock
    clockPick: $('#clockPick'),
    clockTeam: $('#clockTeam'),
    clockOrig: $('#clockOrig'),
    clockPlayer: $('#clockPlayer'),
    clockPos: $('#clockPos'),
    clockNfl: $('#clockNfl'),
    // trades
    tradePick: $('#tradePick'),
    tradeOwner: $('#tradeOwner'),
    tradeList: $('#tradeList'),
    tradeCount: $('#tradeCount'),
  };

  function renderAll() {
    const hasBoards = Object.keys(boards()).length > 0;
    el.emptyState.classList.toggle('hidden', hasBoards);
    for (const s of [el.setupSection, el.clockSection, el.boardSection, el.tradesSection]) {
      s.classList.toggle('hidden', !hasBoards);
    }
    renderBoardSelect();
    const b = active();
    if (!b) return;
    el.brandSub.textContent = `${b.name} · ${b.year}` + (b.leagueId ? ` · MFL ${b.leagueId}` : '');
    renderSetup(b);
    renderClock(b);
    renderBoard(b);
    renderTrades(b);
    renderRookieDatalist(b);
    // lazily fetch the bundled rookie file the first time we see this season
    if (!rookiesFor(b.year)) {
      ensureRookies(b.year).then((list) => { if (list && state.activeId === b.id) renderRookieDatalist(b); });
    }
  }

  function renderBoardSelect() {
    const ids = Object.keys(boards());
    el.boardSelect.innerHTML = ids.map((id) =>
      `<option value="${id}" ${id === state.activeId ? 'selected' : ''}>${esc(boards()[id].name)}</option>`
    ).join('') || '<option>—</option>';
  }

  // ---- setup / order ----
  function renderSetup(b) {
    $('#mflYear').value = b.year;
    $('#mflLeague').value = b.leagueId || '';
    $('#roundsInput').value = b.rounds;
    $('#snakeInput').checked = b.snake;
    renderOrder(b);
  }

  function renderOrder(b) {
    el.orderList.innerHTML = b.order.map((fid, i) => {
      const t = teamById(b, fid);
      return `<li class="order-row" draggable="true" data-fid="${fid}">
        <span class="order-handle" title="Drag to reorder">⠿</span>
        <span class="order-seed">${i + 1}</span>
        <input class="order-name" value="${esc(t ? t.name : '')}" data-fid="${fid}" />
        <span class="order-arrows">
          <button type="button" data-act="up" title="Move up">▲</button>
          <button type="button" data-act="down" title="Move down">▼</button>
        </span>
        <button class="order-del" type="button" data-act="del" title="Remove team">✕</button>
      </li>`;
    }).join('');
  }

  // ---- clock ----
  function renderClock(b) {
    if (!b.order.length) {
      el.clockPick.textContent = '—';
      el.clockTeam.textContent = 'Add teams to begin';
      el.clockOrig.textContent = '';
      return;
    }
    b.cursor = clamp(b.cursor || 1, 1, b.rounds * b.order.length);
    const p = pickAt(b, b.cursor);
    el.clockPick.textContent = `${p.round}.${pad2(p.pickInRound)}`;
    el.clockTeam.textContent = teamName(b, p.ownerFid);
    el.clockOrig.textContent = p.ownerFid !== p.origFid
      ? `traded from ${teamName(b, p.origFid)} · overall #${p.overall}`
      : `overall #${p.overall}`;
    const cur = b.picks[p.key] || {};
    el.clockPlayer.value = cur.player || '';
    el.clockPos.value = cur.pos || '';
    el.clockNfl.value = cur.nfl || '';
  }

  // ---- board ----
  function renderBoard(b) {
    el.boardName.textContent = b.name;
    const total = b.rounds * b.order.length;
    el.boardProgress.textContent = b.order.length
      ? `${madeCount(b)} / ${total} picks · ${b.order.length} teams · ${b.rounds} rounds`
      : 'No teams yet';

    if (!b.order.length) { el.boardTable.innerHTML = ''; return; }

    const onClockKey = pickAt(b, b.cursor)?.key;

    // header
    let head = '<thead><tr><th class="corner">Team</th>';
    for (let r = 1; r <= b.rounds; r++) head += `<th>Round ${r}</th>`;
    head += '</tr></thead>';

    // body: one row per slot (draft order)
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
        const cls = ['pick', posCls, traded ? 'traded' : '', pick && pick.player ? '' : 'empty',
          key === onClockKey ? 'onclock' : ''].filter(Boolean).join(' ');
        const sub = pick && pick.player
          ? [pick.pos && pick.pos !== 'OTHER' ? pick.pos : '', pick.nfl ? pick.nfl.toUpperCase() : '']
              .filter(Boolean).join(' · ')
          : '';
        const badge = traded
          ? `<span class="trade-badge" title="Now owned by ${esc(teamName(b, ownerFid))}">→ ${esc(teamName(b, ownerFid))}</span>`
          : '';
        body += `<td class="cell">
          <div class="${cls}" data-key="${key}" data-round="${r}" data-slot="${slot}" tabindex="0" role="button">
            <span class="pick-no" title="Overall #${overall}">${r}.${pad2(pir)}</span>
            <span class="player">${pick && pick.player ? esc(pick.player) : 'Add pick'}</span>
            ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}
            ${badge}
          </div>
        </td>`;
      }
      body += '</tr>';
    }
    body += '</tbody>';
    el.boardTable.innerHTML = head + body;
  }

  // ---- trades ----
  function renderTrades(b) {
    // pick selector
    const seq = sequence(b);
    el.tradePick.innerHTML = seq.map((p) =>
      `<option value="${p.key}">${p.round}.${pad2(p.pickInRound)} — ${esc(teamName(b, p.origFid))}${p.ownerFid !== p.origFid ? ' (→ ' + esc(teamName(b, p.ownerFid)) + ')' : ''}</option>`
    ).join('');
    el.tradeOwner.innerHTML = b.order.map((fid) =>
      `<option value="${fid}">${esc(teamName(b, fid))}</option>`).join('');

    // list of traded picks
    const traded = seq.filter((p) => p.ownerFid !== p.origFid);
    el.tradeCount.textContent = traded.length ? String(traded.length) : '';
    el.tradeList.innerHTML = traded.length
      ? traded.map((p) =>
        `<li class="trade-item">
          <span class="ti-pick">${p.round}.${pad2(p.pickInRound)}</span>
          <span>${esc(teamName(b, p.origFid))}</span>
          <span class="ti-arrow">→</span>
          <strong>${esc(teamName(b, p.ownerFid))}</strong>
          <button class="btn ghost tiny ti-undo" data-key="${p.key}" type="button">Undo</button>
        </li>`).join('')
      : '<li class="empty-list">No traded picks yet. Use the form above or click any pick on the board.</li>';
  }

  // ============================================================
  //  Mutations
  // ============================================================
  function touch(b) { b.updatedAt = Date.now(); save(); }

  function setPick(b, key, data) {
    if (!data || (!data.player && !data.pos && !data.nfl)) delete b.picks[key];
    else b.picks[key] = data;
    touch(b);
  }
  function setOwner(b, key, fid) {
    const [round, slot] = key.split('-').map(Number);
    const orig = b.order[slot];
    if (!fid || fid === orig) delete b.owners[key];
    else b.owners[key] = fid;
    touch(b);
  }

  // ============================================================
  //  Pick modal
  // ============================================================
  const pickModal = $('#pickModal');
  let modalKey = null;

  function openPickModal(b, key) {
    modalKey = key;
    const [round, slot] = key.split('-').map(Number);
    const origFid = b.order[slot];
    const pick = b.picks[key] || {};
    const ownerFid = b.owners[key] || origFid;
    $('#modalTitle').textContent = `Round ${round} · ${esc(teamName(b, origFid))}`;
    $('#modalSub').innerHTML = `Pick <strong>${round}.${pad2(pickInRound(b, round, slot))}</strong> · overall #${overallOf(b, round, slot)}`;
    $('#mPlayer').value = pick.player || '';
    $('#mPos').value = pick.pos || '';
    $('#mNfl').value = pick.nfl || '';
    $('#mOwner').innerHTML = b.order.map((fid) =>
      `<option value="${fid}" ${fid === ownerFid ? 'selected' : ''}>${esc(teamName(b, fid))}${fid === origFid ? ' (original)' : ''}</option>`).join('');
    if (typeof pickModal.showModal === 'function') pickModal.showModal();
    else pickModal.setAttribute('open', '');
    setTimeout(() => $('#mPlayer').focus(), 30);
  }
  function closePickModal() {
    if (pickModal.open) pickModal.close();
    modalKey = null;
  }
  function savePickModal() {
    const b = active();
    if (!b || !modalKey) return;
    setPick(b, modalKey, {
      player: $('#mPlayer').value.trim(),
      pos: $('#mPos').value,
      nfl: $('#mNfl').value.trim().toUpperCase(),
    });
    setOwner(b, modalKey, $('#mOwner').value);
    closePickModal();
    renderClock(b); renderBoard(b); renderTrades(b); renderRookieDatalist(b);
  }

  // ============================================================
  //  Toast
  // ============================================================
  let toastTimer;
  function toast(msg, isErr = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ============================================================
  //  Event wiring
  // ============================================================
  function bind() {
    // ---- board switching ----
    el.boardSelect.addEventListener('change', (e) => {
      state.activeId = e.target.value; save(); renderAll();
    });
    $('#newBoardBtn').addEventListener('click', createBoardFlow);
    $('#emptyCreateBtn').addEventListener('click', createBoardFlow);
    $('#loadMineBtn').addEventListener('click', loadBundledLeague);

    // ---- collapsibles ----
    for (const [btn, sec] of [['#setupToggle', '#setupSection'], ['#tradesToggle', '#tradesSection']]) {
      $(btn).addEventListener('click', () => {
        const s = $(sec);
        s.classList.toggle('collapsed');
        $(btn).setAttribute('aria-expanded', String(!s.classList.contains('collapsed')));
      });
    }

    // ---- MFL fetch ----
    $('#fetchBtn').addEventListener('click', onFetch);
    $('#manualToggleBtn').addEventListener('click', () => {
      const box = $('#manualBox');
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) updateManualLink();
    });
    $('#mflYear').addEventListener('input', updateManualLink);
    $('#mflLeague').addEventListener('input', updateManualLink);
    $('#copyUrlBtn').addEventListener('click', () => {
      navigator.clipboard?.writeText($('#mflUrl').href).then(() => toast('Teams URL copied'));
    });
    $('#copyDraftUrlBtn').addEventListener('click', () => {
      navigator.clipboard?.writeText($('#mflDraftUrl').href).then(() => toast('Draft URL copied'));
    });
    $('#parseManualBtn').addEventListener('click', onParseManual);

    // ---- quick start / format ----
    $('#quickStartBtn').addEventListener('click', onQuickStart);
    $('#roundsInput').addEventListener('change', (e) => {
      const b = active(); if (!b) return;
      b.rounds = clamp(parseInt(e.target.value, 10) || 7, 1, 40);
      e.target.value = b.rounds; touch(b); renderClock(b); renderBoard(b); renderTrades(b);
    });
    $('#snakeInput').addEventListener('change', (e) => {
      const b = active(); if (!b) return;
      b.snake = e.target.checked; touch(b); renderClock(b); renderBoard(b); renderTrades(b);
    });

    // ---- order list ----
    el.orderList.addEventListener('click', onOrderClick);
    el.orderList.addEventListener('change', onOrderRename);
    el.orderList.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('order-name') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    wireDrag();

    // ---- clock ----
    $('#clockForm').addEventListener('submit', onClockSubmit);
    $('#clockPrev').addEventListener('click', () => moveCursor(-1));
    $('#clockNext').addEventListener('click', () => moveCursor(1));
    $('#clockUndo').addEventListener('click', onClockClear);
    $('#clockPlayer').addEventListener('input', () => {
      const b = active(); if (b) autofillFromRookie(b.year, $('#clockPlayer'), $('#clockPos'), $('#clockNfl'));
    });

    // ---- board interactions ----
    el.boardTable.addEventListener('click', (e) => {
      const cell = e.target.closest('.pick');
      if (!cell) return;
      const b = active(); if (!b) return;
      // single click -> put clock on this pick AND open editor
      const p = pickAt(b, overallOf(b, +cell.dataset.round, +cell.dataset.slot));
      b.cursor = p.overall; touch(b); renderClock(b);
      openPickModal(b, cell.dataset.key);
    });
    el.boardTable.addEventListener('keydown', (e) => {
      const cell = e.target.closest('.pick');
      if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cell.click(); }
    });

    // ---- pick modal ----
    $('#mPlayer').addEventListener('input', () => {
      const b = active(); if (b) autofillFromRookie(b.year, $('#mPlayer'), $('#mPos'), $('#mNfl'));
    });
    $('#mSave').addEventListener('click', savePickModal);
    $('#mCancel').addEventListener('click', closePickModal);
    $('#modalClose').addEventListener('click', closePickModal);
    $('#mClear').addEventListener('click', () => {
      const b = active(); if (!b || !modalKey) return;
      setPick(b, modalKey, null);
      closePickModal(); renderClock(b); renderBoard(b); renderRookieDatalist(b);
    });
    $('#pickForm').addEventListener('submit', (e) => { e.preventDefault(); savePickModal(); });

    // ---- trades ----
    $('#tradeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const b = active(); if (!b) return;
      setOwner(b, el.tradePick.value, el.tradeOwner.value);
      renderBoard(b); renderTrades(b); renderClock(b);
      toast('Trade applied');
    });
    el.tradeList.addEventListener('click', (e) => {
      const btn = e.target.closest('.ti-undo'); if (!btn) return;
      const b = active(); if (!b) return;
      setOwner(b, btn.dataset.key, null);
      renderBoard(b); renderTrades(b); renderClock(b);
    });
    $('#tradeQuickBtn').addEventListener('click', () => {
      $('#tradesSection').classList.remove('collapsed');
      $('#tradesToggle').setAttribute('aria-expanded', 'true');
      $('#tradesSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.tradePick.focus();
    });

    // ---- board actions ----
    $('#printBtn').addEventListener('click', () => window.print());

    // ---- settings ----
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#settingsClose').addEventListener('click', () => $('#settingsModal').close());
    $('#settingsDone').addEventListener('click', () => $('#settingsModal').close());
    $('#proxyInput').addEventListener('change', (e) => {
      state.settings.proxy = e.target.value.trim(); save();
    });
    $('#exportBtn').addEventListener('click', onExport);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', onImportFile);
    $('#renameBoardBtn').addEventListener('click', onRenameBoard);
    $('#deleteBoardBtn').addEventListener('click', onDeleteBoard);
    $('#reloadPoolBtn').addEventListener('click', onReloadPool);
    $('#pastePoolBtn').addEventListener('click', () => { $('#poolPasteBox').classList.toggle('hidden'); updatePoolUrl(); });
    $('#loadPoolBtn').addEventListener('click', onLoadPoolPaste);

    // close modals on backdrop click
    for (const m of [pickModal, $('#settingsModal')]) {
      m.addEventListener('click', (e) => { if (e.target === m) m.close(); });
    }
    // keyboard: in clock player, Enter submits (handled by form). Esc closes modal automatically.
  }

  // ---------- create / quick start ----------
  function createBoardFlow() {
    const b = newBoard({ name: 'Draft Board ' + (Object.keys(boards()).length + 1) });
    boards()[b.id] = b;
    state.activeId = b.id;
    save(); renderAll();
    $('#setupSection').classList.remove('collapsed');
    $('#mflLeague').focus();
  }

  // One-click: load the bundled league board file shipped alongside the app.
  async function loadBundledLeague() {
    const btn = $('#loadMineBtn');
    btn.disabled = true;
    try {
      const res = await fetch('loyal-order-2026.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const imp = await res.json();
      if (!imp.teams || !imp.order) throw new Error('not a board file');
      // already loaded once? just switch to it instead of duplicating
      const existing = Object.values(boards()).find((b) => b.leagueId === imp.leagueId && b.year === imp.year);
      if (existing) {
        state.activeId = existing.id; save(); renderAll();
        toast('Switched to your league'); return;
      }
      imp.id = 'b_' + uid();
      boards()[imp.id] = imp; state.activeId = imp.id;
      save(); renderAll();
      $('#setupSection').classList.add('collapsed');
      $('#setupToggle').setAttribute('aria-expanded', 'false');
      toast('Loaded Loyal Order of Water Buffaloes');
    } catch (e) {
      toast('Could not load the file (' + e.message + '). Serve the folder or use ⚙ → Import JSON.', true);
    } finally {
      btn.disabled = false;
    }
  }

  function ensureBoard() {
    if (!active()) {
      const b = newBoard();
      boards()[b.id] = b; state.activeId = b.id; save();
    }
    return active();
  }

  function onQuickStart() {
    const b = ensureBoard();
    const n = clamp(parseInt($('#quickTeams').value, 10) || 12, 2, 32);
    b.teams = Array.from({ length: n }, (_, i) => ({ fid: 'T' + pad2(i + 1), name: 'Team ' + (i + 1) }));
    b.order = b.teams.map((t) => t.fid);
    b.picks = {}; b.owners = {}; b.cursor = 1;
    b.rounds = clamp(parseInt($('#roundsInput').value, 10) || 7, 1, 40);
    b.snake = $('#snakeInput').checked;
    touch(b); renderAll();
    toast(`${n} teams created`);
  }

  // ---------- MFL handlers ----------
  function updateManualLink() {
    const year = $('#mflYear').value || new Date().getFullYear();
    const league = $('#mflLeague').value.trim() || 'LEAGUEID';
    const lu = mflUrl(year, league, 'league');
    const du = mflUrl(year, league, 'draftResults');
    $('#mflUrl').href = lu; $('#mflUrl').textContent = 'Teams (TYPE=league) ↗';
    $('#mflDraftUrl').href = du; $('#mflDraftUrl').textContent = 'Draft order & trades (TYPE=draftResults) ↗';
  }

  async function onFetch() {
    const b = ensureBoard();
    const year = parseInt($('#mflYear').value, 10);
    const league = $('#mflLeague').value.trim();
    const status = $('#fetchStatus');
    if (!year || !league) { status.className = 'status err'; status.textContent = 'Enter a season and league ID first.'; return; }
    status.className = 'status busy'; status.textContent = 'Fetching from MyFantasyLeague…';
    $('#fetchBtn').disabled = true;
    try {
      const { name, teams } = await fetchLeague(year, league);
      applyLeague(b, { name, teams, year, league });
      let msg = `Loaded ${teams.length} teams from "${name}".`;
      // also try the draft (order + trades) — non-fatal if it fails
      try {
        const draft = parseDraftResults(await proxyFetch(mflUrl(year, league, 'draftResults')), b.teams);
        applyDraft(b, draft);
        msg += ` Draft order set; ${Object.keys(draft.owners).length} traded pick(s) imported.`;
      } catch (e) {
        msg += ' (Draft order not auto-fetched — paste step 2 if you want trades.)';
      }
      status.className = 'status ok'; status.textContent = msg;
      toast('Imported from MFL');
    } catch (e) {
      status.className = 'status err';
      status.innerHTML = `Auto-fetch failed (${esc(e.message)}). Use <strong>Paste data manually</strong> — it always works.`;
      $('#manualBox').classList.remove('hidden');
      updateManualLink();
    } finally {
      $('#fetchBtn').disabled = false;
    }
  }

  // Auto-detects whether the pasted JSON is a league or a draftResults payload.
  function onParseManual() {
    const b = ensureBoard();
    const status = $('#fetchStatus');
    let data;
    try { data = JSON.parse($('#manualJson').value); }
    catch (e) { status.className = 'status err'; status.textContent = "That isn't valid JSON. Copy the whole response and try again."; return; }
    try {
      if (data.draftResults) {
        if (!b.teams.length) throw new Error('Load your teams first (step 1), then paste the draft.');
        const draft = parseDraftResults(data, b.teams);
        applyDraft(b, draft);
        status.className = 'status ok';
        status.textContent = `Draft imported — ${b.order.length}-team ${b.snake ? 'snake' : 'linear'} order, ${b.rounds} rounds, ${Object.keys(draft.owners).length} traded pick(s).`;
      } else if (data.league) {
        const { name, teams } = parseLeague(data);
        applyLeague(b, {
          name, teams,
          year: parseInt($('#mflYear').value, 10) || b.year,
          league: $('#mflLeague').value.trim() || b.leagueId,
        });
        status.className = 'status ok';
        status.textContent = `Loaded ${teams.length} teams from "${name}". Now paste the draft data (step 2) for order + trades.`;
      } else {
        throw new Error('Unrecognized — expected an MFL league or draftResults response.');
      }
      $('#manualJson').value = '';
      toast('Imported');
    } catch (e) {
      status.className = 'status err';
      status.textContent = 'Could not import: ' + e.message;
    }
  }

  function applyLeague(b, { name, teams, year, league }) {
    const existing = madeCount(b) > 0;
    b.teams = teams;
    syncOrder(b);
    b.year = year; b.leagueId = String(league);
    if (b.name.startsWith('Draft Board') || b.name === 'New Draft Board') b.name = name;
    if (!existing) { b.picks = {}; b.owners = {}; b.cursor = 1; }
    b.rounds = clamp(parseInt($('#roundsInput').value, 10) || b.rounds, 1, 40);
    b.snake = $('#snakeInput').checked;
    touch(b); renderAll();
  }

  // Apply parsed draftResults: draft order, rounds, snake, and traded picks.
  function applyDraft(b, parsed) {
    const ids = new Set(b.teams.map((t) => t.fid));
    if (!parsed.order.length || parsed.order.length !== b.teams.length || !parsed.order.every((fid) => ids.has(fid))) {
      throw new Error("Draft data doesn't match the loaded teams — load this league's teams first (step 1).");
    }
    b.rounds = clamp(parsed.rounds || b.rounds, 1, 40);
    b.snake = !!parsed.snake;
    // move any already-entered picks with their teams as slots change
    remapSlots(b, () => { b.order = parsed.order.slice(); });
    // MFL is authoritative for pre-draft trades (keyed in the new slot coordinates)
    const own = {};
    for (const k in parsed.owners) if (ids.has(parsed.owners[k])) own[k] = parsed.owners[k];
    b.owners = own;
    b.cursor = clamp(b.cursor || 1, 1, Math.max(1, b.rounds * b.order.length));
    touch(b); renderAll();
    // reflect imported format in the setup controls
    $('#roundsInput').value = b.rounds;
    $('#snakeInput').checked = b.snake;
  }

  // ---------- order handlers ----------
  function onOrderClick(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const b = active(); if (!b) return;
    const row = e.target.closest('.order-row');
    const fid = row.dataset.fid;
    const idx = b.order.indexOf(fid);
    const act = btn.dataset.act;
    if (act === 'up' && idx > 0) { swapOrder(b, idx, idx - 1); }
    else if (act === 'down' && idx < b.order.length - 1) { swapOrder(b, idx, idx + 1); }
    else if (act === 'del') {
      if (b.teams.length <= 2) { toast('A draft needs at least 2 teams', true); return; }
      if (!confirm('Remove this team? Their picks in every round will be cleared.')) return;
      b.teams = b.teams.filter((t) => t.fid !== fid);
      remapSlots(b, () => { b.order = b.order.filter((id) => id !== fid); });
      cleanupOwners(b);
      b.cursor = clamp(b.cursor, 1, Math.max(1, b.rounds * b.order.length));
    }
    touch(b); renderOrder(b); renderClock(b); renderBoard(b); renderTrades(b);
  }
  function swapOrder(b, i, j) {
    // moving a team changes slot indices; remap picks/owners by slot
    remapSlots(b, () => { const o = b.order; [o[i], o[j]] = [o[j], o[i]]; });
  }
  function onOrderRename(e) {
    if (!e.target.classList.contains('order-name')) return;
    const b = active(); if (!b) return;
    const t = teamById(b, e.target.dataset.fid);
    if (t) { t.name = e.target.value.trim() || t.name; touch(b); renderClock(b); renderBoard(b); renderTrades(b); }
  }
  // drop any owner-override pointing at a team that no longer exists
  function cleanupOwners(b) {
    const ids = new Set(b.teams.map((t) => t.fid));
    for (const key of Object.keys(b.owners)) if (!ids.has(b.owners[key])) delete b.owners[key];
  }

  // Remap picks/owners keyed by slot when the order array is mutated.
  function remapSlots(b, mutate) {
    const before = b.order.slice();
    mutate();
    const after = b.order;
    // map: new slot index -> old slot index (by fid identity)
    const oldIndexOf = (fid) => before.indexOf(fid);
    const newPicks = {}, newOwners = {};
    for (let r = 1; r <= b.rounds; r++) {
      for (let ns = 0; ns < after.length; ns++) {
        const os = oldIndexOf(after[ns]);
        if (os < 0) continue;
        const oldKey = cellKey(r, os), newKey = cellKey(r, ns);
        if (b.picks[oldKey]) newPicks[newKey] = b.picks[oldKey];
        if (b.owners[oldKey]) newOwners[newKey] = b.owners[oldKey];
      }
    }
    b.picks = newPicks; b.owners = newOwners;
  }

  // drag & drop reordering
  function wireDrag() {
    let dragFid = null;
    el.orderList.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.order-row'); if (!row) return;
      dragFid = row.dataset.fid; row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.orderList.addEventListener('dragend', (e) => {
      e.target.closest('.order-row')?.classList.remove('dragging');
      $$('.order-row', el.orderList).forEach((r) => r.classList.remove('drop-target'));
    });
    el.orderList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const row = e.target.closest('.order-row');
      $$('.order-row', el.orderList).forEach((r) => r.classList.remove('drop-target'));
      if (row && row.dataset.fid !== dragFid) row.classList.add('drop-target');
    });
    el.orderList.addEventListener('drop', (e) => {
      e.preventDefault();
      const row = e.target.closest('.order-row');
      const b = active();
      if (!row || !b || !dragFid) return;
      const from = b.order.indexOf(dragFid);
      const to = b.order.indexOf(row.dataset.fid);
      if (from < 0 || to < 0 || from === to) return;
      remapSlots(b, () => { const [m] = b.order.splice(from, 1); b.order.splice(to, 0, m); });
      dragFid = null;
      touch(b); renderOrder(b); renderClock(b); renderBoard(b); renderTrades(b);
    });
  }

  // ---------- clock handlers ----------
  function onClockSubmit(e) {
    e.preventDefault();
    const b = active(); if (!b || !b.order.length) return;
    const p = pickAt(b, b.cursor);
    const player = el.clockPlayer.value.trim();
    if (!player) { el.clockPlayer.focus(); return; }
    setPick(b, p.key, { player, pos: el.clockPos.value, nfl: el.clockNfl.value.trim().toUpperCase() });
    // advance to next empty pick
    b.cursor = firstEmptyOverall(b);
    touch(b);
    renderClock(b); renderBoard(b); renderRookieDatalist(b);
    el.clockPlayer.focus();
    // keep on-clock cell visible
    scrollOnClockIntoView();
  }
  function onClockClear() {
    const b = active(); if (!b) return;
    const p = pickAt(b, b.cursor);
    setPick(b, p.key, null);
    renderClock(b); renderBoard(b); renderRookieDatalist(b);
  }
  function moveCursor(delta) {
    const b = active(); if (!b || !b.order.length) return;
    b.cursor = clamp(b.cursor + delta, 1, b.rounds * b.order.length);
    touch(b); renderClock(b); renderBoard(b); scrollOnClockIntoView();
  }
  function scrollOnClockIntoView() {
    const cell = $('.pick.onclock');
    cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // ---------- settings / data ----------
  function openSettings() {
    $('#proxyInput').value = state.settings.proxy || '';
    const b = active(); if (b) { renderRookieDatalist(b); updatePoolUrl(); }
    $('#poolPasteBox').classList.add('hidden');
    const m = $('#settingsModal');
    if (typeof m.showModal === 'function') m.showModal(); else m.setAttribute('open', '');
  }
  function updatePoolUrl() {
    const b = active(); if (!b) return;
    $('#poolUrl').href = `https://api.myfantasyleague.com/${b.year}/export?TYPE=players&DETAILS=1&JSON=1`;
  }
  async function onReloadPool() {
    const b = active(); if (!b) return;
    delete state.refData.rookies[String(b.year)]; save();
    const list = await ensureRookies(b.year);
    renderRookieDatalist(b);
    toast(list ? `Loaded ${list.length} ${b.year} rookies` : 'Could not load — serve the site or paste manually', !list);
  }
  function onLoadPoolPaste() {
    const b = active(); if (!b) return;
    try {
      const list = parsePlayersPool(JSON.parse($('#poolJson').value), b.year);
      if (!list.length) throw new Error(`No ${b.year} rookies found in that data.`);
      setRookies(b.year, list);
      renderRookieDatalist(b);
      $('#poolJson').value = '';
      $('#poolPasteBox').classList.add('hidden');
      toast(`Loaded ${list.length} ${b.year} rookies`);
    } catch (e) { toast('Could not load: ' + e.message, true); }
  }
  function onExport() {
    const b = active(); if (!b) return;
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${b.name.replace(/[^a-z0-9]+/gi, '_')}_${b.year}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imp = JSON.parse(reader.result);
        if (!imp.teams || !imp.order) throw new Error('Not a board file');
        imp.id = 'b_' + uid();
        boards()[imp.id] = imp; state.activeId = imp.id;
        save(); renderAll(); $('#settingsModal').close();
        toast('Board imported');
      } catch (err) { toast('Import failed: ' + err.message, true); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }
  function onRenameBoard() {
    const b = active(); if (!b) return;
    const name = prompt('Board name:', b.name);
    if (name && name.trim()) { b.name = name.trim(); touch(b); renderAll(); }
  }
  function onDeleteBoard() {
    const b = active(); if (!b) return;
    if (!confirm(`Delete "${b.name}"? This cannot be undone.`)) return;
    delete boards()[b.id];
    state.activeId = Object.keys(boards())[0] || null;
    save(); $('#settingsModal').close(); renderAll();
  }

  // ============================================================
  //  init
  // ============================================================
  function init() {
    if (!state.activeId || !boards()[state.activeId]) {
      state.activeId = Object.keys(boards())[0] || null;
    }
    bind();
    renderAll();
  }
  init();
})();
