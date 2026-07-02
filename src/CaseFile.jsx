import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import THEMES from "./themes.json";

/* ---------------------------------------------------------
   ROW DEFINITIONS
--------------------------------------------------------- */
const ROWS_FULL = [
  { name: "Blue",       hex: "#2452c7" },
  { name: "Green",      hex: "#2f8f4e" },
  { name: "Orange",     hex: "#d9711a" },
  { name: "Pink",       hex: "#c4267a" },
  { name: "Black",      hex: "#16151a" },
  { name: "Light Blue", hex: "#3aa9d9" },
  { name: "Purple",     hex: "#6f3fc4" }
];
const SQUARE = { Blue:"🟦", Green:"🟩", Orange:"🟧", Pink:"🟪", Black:"⬛", "Light Blue":"🟦", Purple:"🟪" };

/* ---------------------------------------------------------
   SEEDED RNG
--------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------------------------------------------------
   DATE + DISPLAY HELPERS
--------------------------------------------------------- */
const EPOCH = new Date("2026-01-01T00:00:00Z");
const todayStr     = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const dailyCaseNumber = (ds) => Math.max(1, Math.floor((new Date(ds + "T00:00:00Z") - EPOCH) / 86400000) + 1);
const fmtTime    = (sec)  => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const seedToCode = (seed) => seed.toString(36).toUpperCase().padStart(6, "0");

/* ---------------------------------------------------------
   PERMUTATION + SOLVER
--------------------------------------------------------- */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) result.push([arr[i], ...p]);
  }
  return result;
}
const posOf = (perm, item) => perm.indexOf(item);
const permCache = {};
const allPermsFor = (n) => { if (!permCache[n]) permCache[n] = permutations([...Array(n).keys()]); return permCache[n]; };

function buildCluePool(sol, names, rows, freebieItem) {
  const n = rows.length, pool = [];
  const push = (text, check) => pool.push({ text, check });
  for (let r = 0; r < n; r++) {
    const i = sol[r], nm = names[i];
    // FIX: skip clues where the SUBJECT is the freebie — player already knows its location
    if (i === freebieItem) continue;
    push(`${nm} is in the ${rows[r].name} row.`, (p) => posOf(p, i) === r);
    if (r > 0)   { const j = sol[r-1]; push(`${nm} is directly below ${names[j]}.`,  (p) => posOf(p,i) === posOf(p,j)+1); }
    if (r < n-1) { const j = sol[r+1]; push(`${nm} is directly above ${names[j]}.`,  (p) => posOf(p,i) === posOf(p,j)-1); }
    if (r > 0)   push(`${nm} is directly below the ${rows[r-1].name} row.`, (p) => posOf(p,i) === r);
    if (r < n-1) push(`${nm} is directly above the ${rows[r+1].name} row.`, (p) => posOf(p,i) === r);
    if (r === 0 || r === n-1) push(`${nm} is in the first or last row.`, (p) => { const v=posOf(p,i); return v===0||v===n-1; });
    for (let r2 = 0; r2 < n; r2++) {
      if (Math.abs(r2-r) < 2) continue;
      const j = sol[r2];
      if (r2 < r) push(`${nm} is in one of the rows below ${names[j]}.`, (p) => posOf(p,i) > posOf(p,j));
      else        push(`${nm} is in one of the rows above ${names[j]}.`, (p) => posOf(p,i) < posOf(p,j));
    }
    for (let r2 = 0; r2 < n; r2++) {
      if (r2 === r) continue;
      if (r2 < r) push(`${nm} is in one of the rows below the ${rows[r2].name} row.`, (p) => posOf(p,i) > r2);
      else        push(`${nm} is in one of the rows above the ${rows[r2].name} row.`, (p) => posOf(p,i) < r2);
    }
    for (let a = 0; a < n; a++) for (let b = a+1; b < n; b++) {
      if (a < r && r < b) {
        const y=sol[a], z=sol[b];
        push(`${nm} is between ${names[y]} and ${names[z]}.`, (p) => {
          const pi=posOf(p,i), py=posOf(p,y), pz=posOf(p,z);
          return (py<pi&&pi<pz)||(pz<pi&&pi<py);
        });
      }
    }
  }
  return pool;
}

function filterPerms(perms, clues, lr, li) {
  return perms.filter((p) => {
    if (lr !== null && p[lr] !== li) return false;
    return clues.every((c) => c.check(p));
  });
}

function generatePuzzle(seed, rowCount = 7) {
  const rng  = mulberry32(seed);
  const rows = ROWS_FULL.slice(0, rowCount);
  const n    = rowCount;
  const AP   = allPermsFor(n);
  const theme       = THEMES[Math.floor(rng() * THEMES.length)];
  const chosen      = seededShuffle(theme.items, rng).slice(0, n);
  const sol         = seededShuffle([...Array(n).keys()], rng);
  const freebieRow  = Math.floor(rng() * n);
  const freebieItem = sol[freebieRow];
  // Pass freebieItem so buildCluePool skips it as a subject
  const pool = seededShuffle(buildCluePool(sol, chosen, rows, freebieItem), rng);
  let remaining = filterPerms(AP, [], freebieRow, freebieItem);
  const active = [];
  for (const clue of pool) {
    if (remaining.length <= 1) break;
    const next = remaining.filter((p) => clue.check(p));
    if (next.length < remaining.length) { active.push(clue); remaining = next; }
  }
  if (remaining.length > 1) {
    for (let r = 0; r < n; r++) {
      if (r === freebieRow || remaining.length <= 1) continue;
      const i = sol[r];
      const clue = { text:`${chosen[i]} is in the ${rows[r].name} row.`, check:(p) => posOf(p,i)===r };
      active.push(clue); remaining = remaining.filter((p) => clue.check(p));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = active.length-1; i >= 0; i--) {
      const trial = [...active.slice(0,i), ...active.slice(i+1)];
      if (filterPerms(AP, trial, freebieRow, freebieItem).length === 1) { active.splice(i,1); changed=true; }
    }
  }
  // Pad to minimum 5 with redundant-but-true clues
  if (active.length < 5) {
    for (const clue of pool) {
      if (active.length >= 5) break;
      if (!active.some((a) => a.text === clue.text)) active.push(clue);
    }
  }
  return { seed, rowCount:n, rows, theme:theme.label, singular:theme.singular, items:chosen, solution:sol, freebieRow, clues:seededShuffle(active,rng).map((c)=>c.text) };
}

/* ---------------------------------------------------------
   LOCAL STORAGE
--------------------------------------------------------- */
const LS_STATE = "lineup_state_v2"; // bumped version — clears stale saved state
const LS_STATS = "lineup_stats_v1";
function loadJSON(key, fallback) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* silent */ }
}

/* ---------------------------------------------------------
   COMPONENT
--------------------------------------------------------- */
export default function CaseFile() {
  const stats      = useRef(loadJSON(LS_STATS, { streak:0, lastWinDate:null, totalSolved:0, totalPlayed:0 }));
  const savedState = useRef(loadJSON(LS_STATE, null));

  const initial = useMemo(() => {
    const s = savedState.current, today = todayStr();
    if (s && s.mode === "daily" && s.dateKey === today) return s;
    if (s && s.mode === "daily" && s.dateKey !== today) {
      if (stats.current.lastWinDate !== yesterdayStr() && stats.current.lastWinDate !== today) {
        stats.current.streak = 0; saveJSON(LS_STATS, stats.current);
      }
    }
    if (s && s.mode === "practice") return s;
    const seed = hashSeed("daily-" + today);
    stats.current.totalPlayed += 1; saveJSON(LS_STATS, stats.current);
    return { mode:"daily", dateKey:today, seed, rowCount:7, placements:null, struck:[], won:false, startedAt:Date.now(), pauseOffset:0 };
  }, []);

  const [mode,       setMode]       = useState(initial.mode);
  const [rowCount,   setRowCount]   = useState(initial.rowCount || 7);
  const [puzzle,     setPuzzle]     = useState(() => generatePuzzle(initial.seed, initial.rowCount || 7));
  const [placements, setPlacements] = useState(() => {
    if (initial.placements && initial.placements.length === (initial.rowCount || 7)) return initial.placements;
    const arr = Array(initial.rowCount || 7).fill(null);
    arr[puzzle.freebieRow] = puzzle.solution[puzzle.freebieRow];
    return arr;
  });
  const [struck,    setStruck]    = useState(() => new Set(initial.struck || []));
  const [selected,  setSelected]  = useState(null);
  const [wrongRows, setWrongRows] = useState(new Set());
  const [won,       setWon]       = useState(!!initial.won);
  const [elapsed,   setElapsed]   = useState(initial.won ? (initial.finishedAt - initial.startedAt - (initial.pauseOffset||0)) / 1000 : 0);
  const [copied,    setCopied]    = useState(false);
  // dateKey and caseNum are derived live — never frozen at mount, never null
  const [dateKey, setDateKey]     = useState(todayStr);
  const caseNum = mode === "daily" ? dailyCaseNumber(dateKey) : null;

  const startedAt   = useRef(initial.startedAt || Date.now());
  const pauseOffset = useRef(initial.pauseOffset || 0);
  const hiddenAt    = useRef(null);

  /* ---- load a puzzle imperatively ---- */
  const loadPuzzle = useCallback((seed, rc, newMode, newDateKey) => {
    const p = generatePuzzle(seed, rc);
    const arr = Array(rc).fill(null);
    arr[p.freebieRow] = p.solution[p.freebieRow];
    setPuzzle(p); setPlacements(arr); setStruck(new Set());
    setSelected(null); setWrongRows(new Set()); setWon(false); setElapsed(0);
    startedAt.current   = Date.now();
    pauseOffset.current = 0;
    hiddenAt.current    = null;
    setMode(newMode);
    if (newDateKey) setDateKey(newDateKey);
  }, []);

  /* ---- TIMER + date-change detection on focus/visibility ---- */
  useEffect(() => {
    const onShow = () => {
      // Resume timer
      if (hiddenAt.current !== null) {
        pauseOffset.current += Date.now() - hiddenAt.current;
        hiddenAt.current = null;
      }
      // Date changed while app was backgrounded — load fresh daily
      const today = todayStr();
      if (mode === "daily" && today !== dateKey) {
        const seed = hashSeed("daily-" + today);
        stats.current.totalPlayed += 1; saveJSON(LS_STATS, stats.current);
        loadPuzzle(seed, 7, "daily", today);
      }
    };

    const onHide = () => { hiddenAt.current = Date.now(); };

    const onVisibility = () => { document.hidden ? onHide() : onShow(); };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onShow);
    window.addEventListener("blur",  onHide);

    const tick = setInterval(() => {
      if (!document.hidden) {
        setElapsed((Date.now() - startedAt.current - pauseOffset.current) / 1000);
      }
    }, 1000);

    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("blur",  onHide);
    };
  }, [won, mode, dateKey, loadPuzzle]);

  /* ---- Persist board state ---- */
  useEffect(() => {
    saveJSON(LS_STATE, {
      mode, dateKey,
      seed: puzzle.seed,
      rowCount,
      placements,
      struck: [...struck],
      won,
      startedAt:   startedAt.current,
      pauseOffset: pauseOffset.current,
      finishedAt:  won ? startedAt.current + elapsed * 1000 + pauseOffset.current : null
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements, struck, won, mode, puzzle.seed, rowCount, dateKey]);

  /* ---- Puzzle helpers ---- */
  const trayItems = useMemo(() => {
    const placed = new Set(placements.filter((p) => p !== null));
    return puzzle.items.map((_, idx) => idx).filter((idx) => !placed.has(idx));
  }, [placements, puzzle]);

  const allFilled = placements.every((p) => p !== null);

  const newPracticeCase = () => loadPuzzle(Math.floor(Math.random() * 2**31), rowCount, "practice", null);
  const switchRowCount  = (rc) => { setRowCount(rc); loadPuzzle(Math.floor(Math.random() * 2**31), rc, "practice", null); };
  const goToDaily       = () => { const today = todayStr(); loadPuzzle(hashSeed("daily-" + today), 7, "daily", today); };

  const tapTray = (idx) => { if (won) return; setSelected((s) => s === idx ? null : idx); };
  const tapRow  = (r) => {
    if (won || r === puzzle.freebieRow) return;
    setWrongRows(new Set());
    setPlacements((prev) => {
      const next = [...prev];
      if (selected !== null) { next[r] = selected; setSelected(null); }
      else if (next[r] !== null) next[r] = null;
      return next;
    });
  };
  const toggleClue = (i) => setStruck((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const checkSolution = () => {
    if (!allFilled) return;
    const bad = new Set();
    placements.forEach((item, r) => { if (item !== puzzle.solution[r]) bad.add(r); });
    if (bad.size === 0) {
      const finalElapsed = (Date.now() - startedAt.current - pauseOffset.current) / 1000;
      setElapsed(finalElapsed);
      setWon(true); setWrongRows(new Set());
      const today = todayStr(), st = stats.current;
      st.totalSolved += 1;
      if (mode === "daily" && st.lastWinDate !== today) {
        st.streak = st.lastWinDate === yesterdayStr() ? st.streak + 1 : 1;
        st.lastWinDate = today;
      }
      saveJSON(LS_STATS, st);
    } else { setWrongRows(bad); }
  };

  const shareResults = async () => {
    const squares = puzzle.rows.map((r) => SQUARE[r.name] || "⬜").join("");
    const label   = mode === "daily" ? `Daily Case #${caseNum}` : `Practice Case P-${seedToCode(puzzle.seed)}`;
    const text    = `🕵️ THE LINEUP — ${label}\n${squares}\n✅ Solved in ${fmtTime(elapsed)} · ${struck.size}/${puzzle.clues.length} evidence used\n`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* silent */ }
  };

  /* ---- Render ---- */
  return (
    <div style={S.page}>
      <div style={S.folder}>
        <div style={S.tape} />

        <div style={S.modeTabs}>
          <button onClick={goToDaily}       style={{...S.tab, ...(mode==="daily"    ? S.tabActive : {})}}>Daily Case</button>
          <button onClick={newPracticeCase} style={{...S.tab, ...(mode==="practice" ? S.tabActive : {})}}>Practice</button>
        </div>

        <div style={S.headerRow}>
          <div>
            <div style={S.eyebrow}>
              CONFIDENTIAL · {mode === "daily" ? `DAILY CASE No. ${caseNum}` : `PRACTICE CASE P-${seedToCode(puzzle.seed)}`}
            </div>
            <h1 style={S.title}>THE LINEUP</h1>
            <div style={S.subject}>Subject category: {puzzle.theme}</div>
          </div>
          {mode === "practice" && <button style={S.newBtn} onClick={newPracticeCase}>New Case ⟳</button>}
        </div>

        <div style={S.statRow}>
          <span>🔥 Streak: {stats.current.streak}</span>
          <span>✅ Solved: {stats.current.totalSolved}</span>
          <span>⏱ {fmtTime(elapsed)}</span>
        </div>

        {mode === "practice" && (
          <div style={S.rowCountRow}>
            {[5,6,7].map((rc) => (
              <button key={rc} onClick={() => switchRowCount(rc)} style={{...S.rcBtn, ...(rowCount===rc ? S.rcBtnActive : {})}}>{rc} rows</button>
            ))}
          </div>
        )}

        <p style={S.instructions}>
          Place each {puzzle.singular} into its row using the evidence below.
          Tap a name, then tap a row to place it. Tap a filled row to send it back.
        </p>

        <div style={S.grid}>
          {puzzle.rows.map((row, r) => {
            const itemIdx = placements[r], isFreebie = r === puzzle.freebieRow, isWrong = wrongRows.has(r);
            return (
              <div key={r} onClick={() => tapRow(r)} style={{...S.rowSlot, borderColor:isWrong?"#b3392c":"#3a342a", background:isWrong?"#3a1f1c":"#26221c", cursor:isFreebie?"default":"pointer"}}>
                <span style={{...S.swatch, background:row.hex}} />
                <span style={S.rowLabel}>{row.name}</span>
                <span style={S.rowDivider} />
                <span style={{...S.rowValue, opacity:itemIdx===null?0.35:1}}>{itemIdx!==null ? puzzle.items[itemIdx] : "—"}</span>
                {isFreebie && <span style={S.givenTag}>GIVEN</span>}
              </div>
            );
          })}
        </div>

        {trayItems.length > 0 && (
          <div style={S.tray}>
            {trayItems.map((idx) => (
              <button key={idx} onClick={() => tapTray(idx)} style={{...S.chip, ...(selected===idx ? S.chipSelected : {})}}>{puzzle.items[idx]}</button>
            ))}
          </div>
        )}

        <div style={S.evidenceHeader}>EVIDENCE</div>
        <ol style={S.clueList}>
          {puzzle.clues.map((c, i) => (
            <li key={i} onClick={() => toggleClue(i)} style={{...S.clueItem, textDecoration:struck.has(i)?"line-through":"none", opacity:struck.has(i)?0.45:1}}>{c}</li>
          ))}
        </ol>

        <button onClick={checkSolution} disabled={!allFilled||won} style={{...S.checkBtn, opacity:!allFilled||won?0.4:1, cursor:!allFilled||won?"default":"pointer"}}>
          Check Solution
        </button>

        {wrongRows.size > 0 && (
          <div style={S.wrongNote}>{wrongRows.size} row{wrongRows.size>1?"s":""} don't match the evidence. Marked in red.</div>
        )}

        {won && (
          <div style={S.stampWrap}>
            <div style={S.stamp}>CASE SOLVED</div>
            <button style={S.shareBtn} onClick={shareResults}>{copied ? "Copied ✓" : "Share Results"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   STYLES
--------------------------------------------------------- */
const S = {
  page:           { minHeight:"100vh", background:"#121110", backgroundImage:"repeating-linear-gradient(0deg,rgba(255,255,255,0.015) 0px,rgba(255,255,255,0.015) 1px,transparent 1px,transparent 3px)", display:"flex", justifyContent:"center", padding:"28px 14px", fontFamily:"Georgia,'Times New Roman',serif", color:"#23201a" },
  folder:         { position:"relative", width:"100%", maxWidth:480, background:"#d9cba1", borderRadius:6, padding:"26px 20px 30px", boxShadow:"0 18px 40px rgba(0,0,0,0.5)", border:"1px solid #b8a877" },
  tape:           { position:"absolute", top:-10, left:"50%", transform:"translateX(-50%) rotate(-2deg)", width:110, height:24, background:"rgba(244,233,199,0.55)", border:"1px solid rgba(0,0,0,0.05)" },
  modeTabs:       { display:"flex", gap:6, marginBottom:14 },
  tab:            { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:11, fontWeight:700, letterSpacing:1, background:"transparent", color:"#8a5a2a", border:"1px solid #b8a877", borderRadius:4, padding:"6px 10px", cursor:"pointer" },
  tabActive:      { background:"#1c1a16", color:"#d9cba1", borderColor:"#1c1a16" },
  headerRow:      { display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 },
  eyebrow:        { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:11, letterSpacing:1.5, color:"#8a5a2a", fontWeight:700 },
  title:          { fontFamily:"'Arial Black',Impact,Haettenschweiler,sans-serif", fontSize:30, letterSpacing:1, margin:"2px 0 2px", color:"#1c1a16" },
  subject:        { fontSize:13, fontStyle:"italic", color:"#5a4f3a" },
  newBtn:         { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:12, fontWeight:700, background:"#1c1a16", color:"#d9cba1", border:"none", borderRadius:4, padding:"8px 10px", cursor:"pointer", whiteSpace:"nowrap" },
  statRow:        { display:"flex", gap:14, fontFamily:"ui-monospace,'Courier New',monospace", fontSize:11, color:"#5a4f3a", margin:"10px 0 2px", fontWeight:700 },
  rowCountRow:    { display:"flex", gap:6, marginTop:10 },
  rcBtn:          { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:11, fontWeight:700, background:"transparent", color:"#8a5a2a", border:"1px solid #b8a877", borderRadius:4, padding:"5px 9px", cursor:"pointer" },
  rcBtnActive:    { background:"#b3392c", color:"#f1e8cf", borderColor:"#b3392c" },
  instructions:   { fontSize:13, lineHeight:1.45, color:"#4a4030", margin:"12px 0 16px" },
  grid:           { display:"flex", flexDirection:"column", gap:6, marginBottom:14 },
  rowSlot:        { display:"flex", alignItems:"center", gap:10, border:"1.5px solid #3a342a", borderRadius:5, padding:"10px 12px", background:"#26221c", position:"relative", transition:"background 0.15s,border-color 0.15s" },
  swatch:         { width:16, height:16, borderRadius:3, flexShrink:0, border:"1px solid rgba(255,255,255,0.25)" },
  rowLabel:       { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:11, color:"#9a8f78", width:70, flexShrink:0 },
  rowDivider:     { width:1, height:18, background:"#3a342a" },
  rowValue:       { fontSize:15, fontWeight:700, color:"#f1e8cf", flex:1 },
  givenTag:       { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:9, fontWeight:700, color:"#c4267a", border:"1px solid #c4267a", borderRadius:3, padding:"2px 5px" },
  tray:           { display:"flex", flexWrap:"wrap", gap:8, marginBottom:18 },
  chip:           { fontFamily:"Georgia,serif", fontSize:13, fontWeight:700, background:"#f1e8cf", border:"1px solid #b8a877", borderRadius:4, padding:"8px 12px", cursor:"pointer", color:"#1c1a16" },
  chipSelected:   { background:"#c4267a", color:"#fff", borderColor:"#c4267a" },
  evidenceHeader: { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:12, fontWeight:700, letterSpacing:2, color:"#8a5a2a", borderTop:"1px dashed #b8a877", paddingTop:14, marginBottom:6 },
  clueList:       { margin:"0 0 18px", paddingLeft:20, display:"flex", flexDirection:"column", gap:7 },
  clueItem:       { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:13, lineHeight:1.4, color:"#2c2718", cursor:"pointer" },
  checkBtn:       { width:"100%", fontFamily:"'Arial Black',Impact,sans-serif", fontSize:14, letterSpacing:1, background:"#b3392c", color:"#f1e8cf", border:"none", borderRadius:5, padding:"13px 0", fontWeight:700 },
  wrongNote:      { marginTop:10, fontSize:12, color:"#b3392c", fontFamily:"ui-monospace,monospace", textAlign:"center" },
  stampWrap:      { display:"flex", flexDirection:"column", alignItems:"center", gap:12, marginTop:18 },
  stamp:          { fontFamily:"'Arial Black',Impact,Haettenschweiler,sans-serif", fontSize:26, letterSpacing:2, color:"#b3392c", border:"4px solid #b3392c", borderRadius:8, padding:"8px 18px", transform:"rotate(-6deg)", opacity:0.9 },
  shareBtn:       { fontFamily:"ui-monospace,'Courier New',monospace", fontSize:12, fontWeight:700, background:"#1c1a16", color:"#d9cba1", border:"none", borderRadius:4, padding:"10px 16px", cursor:"pointer" }
};
