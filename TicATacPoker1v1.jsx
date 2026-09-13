import React, { Fragment, useState, useEffect, useCallback, useRef } from "react";
import { Preferences } from "@capacitor/preferences";
import Peer from "peerjs";
import QRCode from "qrcode";

// ─── Constants ────────────────────────────────────────────────────────────────
const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VNUM   = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const RED    = new Set(['♥','♦']);
const P_CLR  = ['#4B9EFF','#FF5F5F','#A855F7','#FFAD60']; // P1 (Blue), P2 (Red), P3 (Purple), P4 (Orange)
const TEAM_CLR = ['#4B9EFF', '#FF5F5F'];
const ROOM_PREFIX = 'tatp-'; // namespace so we don't collide with other apps on the public PeerJS broker
const APP_WEB_URL = (import.meta.env.VITE_WEB_APP_URL || 'https://beauchesnedave56-png.github.io/TicTacPoker/').replace(/\/+$/, '') + '/';
const DEFAULT_APK_DOWNLOAD_URL = 'https://github.com/beauchesnedave56-png/TicTacPoker/releases/latest/download/TicTacPoker.apk';
const APP_DOWNLOAD_URL = import.meta.env.VITE_APK_DOWNLOAD_URL || DEFAULT_APK_DOWNLOAD_URL;

function buildInviteUrl(roomCode) {
  return new URL(`?join=${encodeURIComponent(roomCode)}`, APP_WEB_URL).toString();
}

async function getLatestReleaseApkUrl() {
  try {
    const res = await fetch('https://api.github.com/repos/beauchesnedave56-png/TicTacPoker/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const data = await res.json();
    const apkAsset = Array.isArray(data.assets)
      ? data.assets.find(asset => /\.apk$/i.test(asset.name) || /apk/i.test(asset.name))
      : null;
    return apkAsset?.browser_download_url || APP_DOWNLOAD_URL;
  } catch {
    return APP_DOWNLOAD_URL;
  }
}

// Court code, lisible à l'oral/à l'écrit — évite les caractères ambigus (0/O, 1/I/L)
function makeRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

function buildDeck() {
  const deck = [];
  for (const s of SUITS)
    for (const v of VALUES)
      deck.push({ suit:s, value:v, id:`${v}${s}`, wild:false, steal:false });
  deck.push({ suit:'★', value:'JK', id:'JK1', wild:true,  label:'WILD',  steal:false });
  deck.push({ suit:'★', value:'JK', id:'JK2', wild:true,  label:'WILD',  steal:false });
  deck.push({ suit:'★', value:'JK', id:'JK3', wild:true,  label:'WILD',  steal:false });
  deck.push({ suit:'⚡', value:'ST', id:'ST1', steal:true, label:'STEAL', wild:false });
  deck.push({ suit:'⚡', value:'ST', id:'ST2', steal:true, label:'STEAL', wild:false });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ─── Poker Evaluator (3-card) ─────────────────────────────────────────────────
// Note : un JOKER est résolu en une carte précise (suite + valeur) dès qu'il est
// pioché, avant d'être posé (voir selectWildValue). Une carte placée sur une
// grille n'a donc plus jamais wild:true — pas besoin de chercher la meilleure
// combinaison possible ici, on évalue directement la main réelle.
function evaluate3(cards) {
  const filledIdx = [0,1,2].filter(i => cards[i]);
  if (filledIdx.length === 3) {
    const base = scoreHand(cards);
    if (base.name === 'Pair') {
      // La Paire n'implique que 2 des 3 cartes — on cherche lesquelles pour
      // exclure le kicker qui ne fait pas partie de la combinaison.
      let pairIdx = filledIdx;
      for (let a=0; a<3 && pairIdx===filledIdx; a++)
        for (let b=a+1; b<3 && pairIdx===filledIdx; b++)
          if (cards[a].value === cards[b].value) pairIdx = [a,b];
      return { ...base, comboIdx: pairIdx };
    }
    return { ...base, comboIdx: filledIdx };
  }
  if (filledIdx.length === 2 && cards[filledIdx[0]].value === cards[filledIdx[1]].value) {
    // Deux cartes de même rang déjà posées : le résultat final de cette ligne
    // ne peut être QUE Paire (si la 3e carte ne matche pas) ou Brelan (si elle
    // matche) — jamais moins. Le score de Paire est donc déjà garanti, on
    // le compte immédiatement plutôt que d'attendre que la ligne soit pleine.
    return { rank:3, name:'Pair', score:10, emoji:'✌️', guaranteed:true, comboIdx:filledIdx };
  }
  return { rank:0, name:'—', score:0, emoji:'', comboIdx:[] };
}

function scoreHand(cards) {
  const vals  = cards.map(c => VNUM[c.value]);
  const suits = cards.map(c => c.suit);
  const isFlush = suits[0]===suits[1] && suits[1]===suits[2];
  const sorted  = [...vals].sort((a,b) => a-b);
  const isStraight = (sorted[2]-sorted[1]===1 && sorted[1]-sorted[0]===1)
                  || JSON.stringify(sorted)==='[2,3,14]';
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v]||0)+1);
  const cv = Object.values(counts).sort((a,b) => b-a);
  const isRoyal = isFlush && vals.includes(14) && vals.includes(13) && vals.includes(12);
  // Même rang ET même couleur sur les 3 cartes = littéralement la même carte
  // répétée 3 fois. Impossible avec un jeu de 52 cartes classique — seul un
  // JOKER résolu en une carte précise permet ça, donc il en faut 3 sur la même
  // case exacte. Plus rare qu'une Straight Flush ou qu'un Mini Royal.
  if (isFlush && cv[0]===3) return { rank:9, name:'Perfect Trips',   score:200, emoji:'💎' };
  if (isRoyal)              return { rank:8, name:'Mini Royal',      score:150, emoji:'👑' };
  if (isFlush && isStraight)return { rank:7, name:'Straight Flush',  score:100, emoji:'🔥' };
  if (cv[0]===3)            return { rank:6, name:'Three of a Kind', score:60,  emoji:'🎯' };
  if (isStraight)           return { rank:5, name:'Straight',        score:30,  emoji:'📈' };
  if (isFlush)              return { rank:4, name:'Flush',           score:25,  emoji:'💧' };
  if (cv[0]===2)            return { rank:3, name:'Pair',            score:10,  emoji:'✌️' };
  return                    { rank:1, name:'High Card',              score:0,   emoji:'🃏' };
}

// Aperçu d'une main encore incomplète et incertaine (2 cartes posées sur 3) :
// tirage couleur ou tirage suite. Purement informatif, ne rapporte aucun point
// tant que la ligne n'est pas remplie — contrairement à la Paire (voir
// evaluate3), un tirage peut encore ne rien donner selon la 3e carte.
function previewHand(cards) {
  const filled = cards.filter(Boolean);
  if (filled.length !== 2) return null;
  const [a, b] = filled;
  if (a.value === b.value) return null; // géré par evaluate3 : déjà un score garanti
  if (a.suit === b.suit)   return { name:'Flush Draw', emoji:'💧' };
  const diff = Math.abs(VNUM[a.value] - VNUM[b.value]);
  if (diff >= 1 && diff <= 2) return { name:'Straight Draw', emoji:'📈' };
  return null;
}

function getLines(grid) {
  return [
    {cells:[0,1,2],label:'Row 1'},{cells:[3,4,5],label:'Row 2'},{cells:[6,7,8],label:'Row 3'},
    {cells:[0,3,6],label:'Col 1'},{cells:[1,4,7],label:'Col 2'},{cells:[2,5,8],label:'Col 3'},
    {cells:[0,4,8],label:'Diag ↘'},{cells:[2,4,6],label:'Diag ↗'},
  ].map(l => {
    const cards = l.cells.map(i=>grid[i]);
    const ev = evaluate3(cards);
    return { ...l, cards, ...ev, comboCells: (ev.comboIdx||[]).map(idx=>l.cells[idx]), preview: previewHand(cards) };
  });
}

function totalScore(grid) {
  return getLines(grid).reduce((s,l) => s + ((l.cards.every(Boolean) || l.guaranteed) ? l.score : 0), 0);
}

const HAND_CLR = {
  'Perfect Trips':'#00E5FF','Mini Royal':'#FFD700','Straight Flush':'#FF6B35','Three of a Kind':'#E74C3C',
  'Straight':'#A855F7','Flush':'#3B82F6','Pair':'#10B981','High Card':'#6B7280','—':'#374151',
  'Flush Draw':'#3B82F6','Straight Draw':'#A855F7',
};

const PROFILE_STORAGE_KEY = 'tatp-profile-v1';
const HISTORY_STORAGE_KEY = 'tatp-history-v1';

function createGuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function sanitizeProfileName(name, fallback = '') {
  const value = String(name ?? '').trim();
  if (!value) return fallback;
  return value.slice(0, 24);
}

function readJsonStorageSync(key, fallback) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function readJsonStorage(key, fallback) {
  try {
    const result = await Preferences.get({ key });
    if (result && result.value !== null && result.value !== undefined) {
      return JSON.parse(result.value);
    }
  } catch {
    // Fall back to localStorage when Preferences is unavailable or the native
    // storage cannot be read yet.
  }
  return readJsonStorageSync(key, fallback);
}

async function writeJsonStorage(key, value) {
  try {
    await Preferences.set({ key, value: JSON.stringify(value) });
  } catch {
    // Ignore native storage errors and fall back to browser storage below.
  }
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or browser privacy issues gracefully.
  }
}

function loadStoredProfile() {
  const fallback = { id: createGuid(), displayName: 'Player 1', createdAt: new Date().toISOString() };
  const stored = readJsonStorageSync(PROFILE_STORAGE_KEY, null);
  if (!stored || typeof stored !== 'object') return fallback;
  return {
    id: typeof stored.id === 'string' && stored.id ? stored.id : createGuid(),
    displayName: sanitizeProfileName(stored.displayName, 'Player 1'),
    createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : new Date().toISOString(),
  };
}

function loadStoredHistory() {
  const stored = readJsonStorageSync(HISTORY_STORAGE_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

// ─── Card Visual ──────────────────────────────────────────────────────────────
function CardEl({ card, onClick, glowing, dimmed, selected, size='md', highlight, highlightColor }) {
  if (!card) return null;
  const isRed = RED.has(card.suit);
  const sp    = card.wild || card.steal;
  const hc    = highlightColor || '#FFD700';
  const d     = size==='sm' ? {w:'clamp(30px,10vw,44px)',fs:9,sf:14,rf:16}
              : size==='lg' ? {w:'clamp(40px,13vw,66px)',fs:11,sf:23,rf:25}
                            : {w:'clamp(36px,11.5vw,58px)',fs:9,sf:18,rf:20};
  const bg  = card.wild   ? 'linear-gradient(145deg,#1a1a2e,#16213e)'
            : card.steal  ? 'linear-gradient(145deg,#2d1b4e,#1a0f2e)'
                          : 'linear-gradient(145deg,#eef6fc,#d2e5f2)';
  const clr = card.wild   ? '#FFD700'
            : card.steal  ? '#FF6B35'
            : isRed       ? '#A93B57'
                          : '#2C3E50';
  return (
    <div onClick={onClick} style={{
      width:d.w, aspectRatio:'0.712', background:bg, borderRadius:10, flexShrink:0,
      boxShadow: highlight ? `0 12px 22px rgba(0,0,0,.5), 0 0 18px 4px ${hc}90`
               : selected  ? `0 0 0 3px #FFD700,0 6px 20px rgba(0,0,0,.5)`
               : glowing   ? `0 0 14px 3px rgba(255,210,0,.55),0 3px 10px rgba(0,0,0,.4)`
                           : `0 3px 8px rgba(0,0,0,.35)`,
      border: highlight ? `3px solid ${hc}`
            : selected  ? '1px solid #FFD700'
            : card.fromWild ? '1px solid rgba(255,215,0,.55)'
                            : '1px solid rgba(255,255,255,.5)',
      opacity: dimmed ? .45 : 1,
      cursor: onClick ? 'pointer' : 'default',
      position:'relative', fontFamily:'Georgia,serif', userSelect:'none',
      color:clr, overflow:'hidden', transition:'box-shadow .18s,border-color .18s',
      zIndex: highlight ? 5 : 1,
    }}
    >
      {sp ? (
        <>
          <div style={{position:'absolute',top:3,left:4,lineHeight:1,fontSize:d.fs,fontWeight:'bold'}}>
            <span style={{fontSize:d.fs-1}}>{card.label}</span>
          </div>
          <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',fontSize:d.sf,opacity:.9}}>
            {card.wild ? '🃏' : '⚡'}
          </div>
        </>
      ) : (
        <div style={{position:'absolute',top:'8%',left:'12%',lineHeight:1.05,textAlign:'left'}}>
          <div style={{fontSize:d.rf,fontWeight:'bold'}}>{card.value}</div>
          <div style={{fontSize:d.rf-7,marginTop:2}}>{card.suit}</div>
        </div>
      )}
      <div style={{position:'absolute',top:0,left:0,right:0,height:'38%',
        background:'linear-gradient(to bottom,rgba(255,255,255,.4),transparent)',
        borderRadius:'10px 10px 0 0',pointerEvents:'none'}}/>
      {card.fromWild && <div style={{position:'absolute',bottom:2,left:3,fontSize:d.fs-2,opacity:.7}}>🃏</div>}
    </div>
  );
}

function EmptyCell({ onClick, canPlace }) {
  return (
    <div onClick={canPlace ? onClick : undefined}
      style={{
        width:'clamp(36px,11.5vw,58px)', aspectRatio:'0.712', borderRadius:10,
        border:'2px dashed rgba(255,255,255,.16)',
        background:'rgba(255,255,255,.03)',
        cursor: canPlace ? 'pointer' : 'default',
        display:'flex', alignItems:'center', justifyContent:'center',
        transition:'all .15s',
      }}
      onMouseOver={e=>{ if(canPlace){ e.currentTarget.style.borderColor='rgba(255,215,0,.85)'; e.currentTarget.style.background='rgba(255,215,0,.1)'; }}}
      onMouseOut={e=>{ e.currentTarget.style.borderColor='rgba(255,255,255,.16)'; e.currentTarget.style.background='rgba(255,255,255,.03)'; }}
    >
      {canPlace && <span style={{color:'rgba(255,215,0,.55)',fontSize:20,fontWeight:'bold'}}>+</span>}
    </div>
  );
}

function PlayerGrid({ grid, onPlace, canPlace, stealMode, onSteal, isActive, label, score, color }) {
  const [hoverLine, setHoverLine] = useState(null); // { cells, comboCells, name, label } | null
  const [flashLines, setFlashLines] = useState([]);  // [{ comboCells, name }]
  const prevCellsRef = useRef(new Set());

  const scoringLines = getLines(grid).filter(l => (l.cards.every(Boolean) || l.guaranteed) && l.score > 0);

  useEffect(() => {
    const currentCells = new Set(scoringLines.flatMap(l => l.comboCells));
    const newlyDoneLines = scoringLines.filter(l => l.comboCells.some(c => !prevCellsRef.current.has(c)));
    prevCellsRef.current = currentCells;
    if (newlyDoneLines.length) {
      setFlashLines(newlyDoneLines.map(l => ({ comboCells:l.comboCells, name:l.name })));
      const t = setTimeout(() => setFlashLines([]), 1300);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid]);

  // Carte -> couleur de surbrillance (halo teinté selon le type de main).
  // Seules les cartes qui composent réellement la combinaison s'illuminent —
  // pour une Paire, le kicker qui ne matche pas reste normal.
  const highlightMap = new Map();
  flashLines.forEach(l => l.comboCells.forEach(c => highlightMap.set(c, HAND_CLR[l.name]||'#FFD700')));
  if (hoverLine) hoverLine.comboCells.forEach(c => highlightMap.set(c, HAND_CLR[hoverLine.name]||'#FFD700'));

  const startHover = l => setHoverLine({ cells:l.cells, comboCells:l.comboCells, name:l.name, label:l.label });
  const endHover   = () => setHoverLine(null);

  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
      <div style={{
        padding:'3px 14px', borderRadius:20,
        background: isActive ? `${color}28` : 'rgba(255,255,255,.05)',
        border: isActive ? `1px solid ${color}` : '1px solid rgba(255,255,255,.1)',
        color: isActive ? color : '#9CA3AF',
        fontSize:12, letterSpacing:2, fontWeight:'bold',
        boxShadow: isActive ? `0 0 16px ${color}60` : 'none',
        animation: isActive ? 'turnPulse 1.8s ease-in-out infinite' : 'none',
        transition:'all .3s',
      }}>{label}</div>

      <div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'center',minHeight:16,maxWidth:210}}>
        {scoringLines.map((l,idx) => (
          <span key={idx} title={`${l.label}: ${l.name} (+${l.score})`}
            onMouseEnter={()=>startHover(l)}
            onMouseLeave={endHover}
            style={{
              display:'inline-flex', alignItems:'center', justifyContent:'center',
              width:18, height:18, borderRadius:6, fontSize:10, cursor:'default',
              background:`${HAND_CLR[l.name]||'#6B7280'}25`,
              border:`1px solid ${HAND_CLR[l.name]||'#6B7280'}90`,
              transition:'transform .15s',
              transform: hoverLine&&hoverLine.label===l.label ? 'scale(1.25)' : 'none',
            }}>{l.emoji}</span>
        ))}
      </div>

      <div style={{
        background:'rgba(0,0,0,.28)',
        border: isActive ? `2px solid ${color}` : '2px solid rgba(255,255,255,.08)',
        borderRadius:16, padding:10,
        boxShadow: isActive ? `0 0 34px ${color}45` : 'none',
        animation: isActive ? 'turnPulse 1.8s ease-in-out infinite' : 'none',
        transition:'all .3s',
      }}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,clamp(36px,11.5vw,58px))',gap:'clamp(3px,1.2vw,7px)'}}>
          {grid.map((card,i) => {
            const cellLines = scoringLines.filter(l=>l.cells.includes(i));
            return (
              <div key={i} style={{position:'relative'}}
                onMouseEnter={()=>{ if (card && cellLines.length) startHover(cellLines[0]); }}
                onMouseLeave={endHover}
              >
                {card
                  ? <>
                      <CardEl card={card} size='md' highlight={highlightMap.has(i)} highlightColor={highlightMap.get(i)} />
                      {stealMode && (
                        <div onClick={() => onSteal(i)} style={{
                          position:'absolute', inset:0, borderRadius:7, cursor:'pointer',
                          background:'rgba(255,107,53,.35)', border:'2px solid #FF6B35',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:26, animation:'stGlow 1.2s infinite', zIndex:10,
                        }}>⚡</div>
                      )}
                    </>
                  : <EmptyCell canPlace={canPlace} onClick={() => onPlace(i)} />
                }
              </div>
            );
          })}
        </div>
      </div>

      <div style={{color:'#FFD700',fontSize:20,fontWeight:'bold',fontFamily:'Georgia,serif'}}>
        {score} pts
      </div>
    </div>
  );
}

function LinePanel({ lines, color }) {
  const owned  = lines.filter((_,i) => i < 6);
  const groups = [
    { label:'ROWS',    items: owned.slice(0,3) },
    { label:'COLUMNS', items: owned.slice(3,6) },
    { label:'DIAGS',   items: lines.slice(6)   },
  ];
  return (
    <div style={{
      background:'rgba(0,0,0,.3)', border:`1px solid ${color}25`,
      borderRadius:12, padding:'10px 12px', width:'100%',
    }}>
      {groups.map(g => (
        <div key={g.label}>
          <div style={{color:'#6B7280',fontSize:9,letterSpacing:1,margin:'6px 0 3px'}}>{g.label}</div>
          {g.items.map((l,i) => {
            const complete = l.cards.every(Boolean);
            const scored   = complete || l.guaranteed;
            const previewClr = l.preview ? (HAND_CLR[l.preview.name]||'#6B7280') : null;
            const c = scored ? (HAND_CLR[l.name]||'#6B7280') : (previewClr || '#374151');
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', padding:'3px 6px', borderRadius:4, marginBottom:2,
                background: scored&&l.score>0 ? `${c}15` : 'transparent',
                borderLeft: scored&&l.score>0 ? `3px solid ${c}`
                          : (!scored&&l.preview) ? `3px dashed ${c}80`
                          : '3px solid transparent',
              }}>
                <span style={{color:'#9CA3AF',fontSize:9,width:44}}>{l.label}</span>
                <span style={{color:c,fontSize:9,flex:1,fontStyle:(!scored&&l.preview)?'italic':'normal',opacity:(!scored&&l.preview)?.85:1}}>
                  {scored ? `${l.emoji} ${l.name}${!complete?'…':''}` : l.preview ? `${l.preview.emoji} ${l.preview.name}…` : '—'}
                </span>
                <span style={{color:c,fontSize:10,fontWeight:'bold'}}>{scored&&l.score>0 ? `+${l.score}` : ''}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TicATacPoker() {
  // ── Réseau : écran de menu, hôte/invité, code de partie ──
  const [netScreen, setNetScreen] = useState('menu'); // menu | qr | hosting | joining | playing
  const [netMode,   setNetMode]   = useState('local'); // local | host | guest
  const [gameMode,  setGameMode]  = useState('1v1');   // 1v1 | 2v2
  const [profile,   setProfile]   = useState(() => loadStoredProfile());
  const [draftName, setDraftName]  = useState(() => loadStoredProfile().displayName);
  const [history,   setHistory]   = useState(() => loadStoredHistory());
  const [roomCode,  setRoomCode]  = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [connStatus,setConnStatus] = useState('idle'); // idle | connecting | connected | error
  const [connErr,   setConnErr]   = useState('');
  const peerRef = useRef(null);
  const connsRef = useRef([]); // Multiple connections for the host
  const [players,   setPlayers]   = useState([]); // { id, name, idx }
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [apkDownloadUrl, setApkDownloadUrl] = useState(APP_DOWNLOAD_URL);
  const [updateStatus, setUpdateStatus] = useState('');
  const playersRef = useRef([]);
  const liveRef = useRef({}); // toujours à jour après chaque rendu ; lu par les callbacks PeerJS pour éviter les closures périmées
  const [myPlayerIdx, setMyPlayerIdx] = useState(0); // assigned by host

  const [deck,     setDeck]     = useState([]);
  const [pool,     setPool]     = useState([null, null, null, null, null]); // always 5
  const [grids,    setGrids]    = useState([Array(9).fill(null), Array(9).fill(null)]);
  const [turn,     setTurn]     = useState(0);   // 0=P1, 1=P2, 2=P3, 3=P4
  const [phase,    setPhase]    = useState('picking'); // picking | placing | steal | wild-select
  const [held,     setHeld]     = useState(null);  // { card, poolIdx, fromSteal }
  const [stealTarget, setStealTarget] = useState(null); // which player's grid to steal from
  const [wildSelection, setWildSelection] = useState(null); // { color, symbol }
  const [gameOver, setGameOver] = useState(false);
  const [finalSc,  setFinalSc]  = useState([0,0,0,0]);
  const [log,      setLog]      = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const detailsRef = useRef(null);
  const historyWrittenRef = useRef(false);

  // Swappable view state (mobile-first)
  const [viewedPlayer, setViewedPlayer] = useState(myPlayerIdx);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const focusDelayRef = useRef(null);

  useEffect(() => {
    const m = window.matchMedia("(max-width: 768px)");
    const onChange = e => setIsMobile(e.matches);
    m.addEventListener("change", onChange);
    setIsMobile(m.matches);
    return () => m.removeEventListener("change", onChange);
  }, []);

  // Local / team-view switching is immediate and can react to steal phase changes.
  // For 1v1 mobile, the board flip must be tied to the actual turn change so the
  // opponent's placement animation has time to read before the view changes.
  useEffect(() => {
    if (gameOver) return;

    if (netMode === 'local') {
      setViewedPlayer(phase === 'steal' ? (turn + 1) % grids.length : turn);
      return;
    }

    const needsSwitch = isMobile || gameMode === '2v2';
    if (!needsSwitch || (gameMode === '1v1' && isMobile)) return;

    if (turn === myPlayerIdx && phase === 'steal') {
      setViewedPlayer((turn + 1) % grids.length);
    } else {
      setViewedPlayer(myPlayerIdx);
    }
  }, [turn, phase, netMode, gameOver, isMobile, gameMode, myPlayerIdx, grids.length]);

  useEffect(() => {
    if (gameOver || !isMobile || gameMode !== '1v1' || netMode === 'local') return;

    if (focusDelayRef.current) {
      clearTimeout(focusDelayRef.current);
      focusDelayRef.current = null;
    }

    const target = turn;
    const delay = turn === myPlayerIdx ? 0 : 1200;
    focusDelayRef.current = setTimeout(() => setViewedPlayer(target), delay);

    return () => {
      if (focusDelayRef.current) {
        clearTimeout(focusDelayRef.current);
        focusDelayRef.current = null;
      }
    };
  }, [turn, isMobile, gameMode, netMode, myPlayerIdx, gameOver]);

  // ── Envoyer l'état complet à l'adversaire (hôte uniquement, source de vérité) ──
  const broadcastState = useCallback((overrides={}) => {
    if (netMode !== 'host' || connsRef.current.length === 0) return;
    const fullState = {
      deck, pool, grids, turn, phase, held, stealTarget, gameOver, finalSc, log, gameMode, players,
      ...overrides,
    };
    connsRef.current.forEach(c => {
      if (c.open) c.send({ type:'state', payload: fullState });
    });
  }, [netMode, deck, pool, grids, turn, phase, held, stealTarget, gameOver, finalSc, log, gameMode, players]);

  // ── Appliquer un instantané d'état reçu de l'hôte (invité uniquement) ──
  const applyRemoteState = useCallback(payload => {
    if (payload.deck        !== undefined) setDeck(payload.deck);
    if (payload.pool        !== undefined) setPool(payload.pool);
    if (payload.grids       !== undefined) setGrids(payload.grids);
    if (payload.turn        !== undefined) setTurn(payload.turn);
    if (payload.phase       !== undefined) setPhase(payload.phase);
    if (payload.held        !== undefined) setHeld(payload.held);
    if (payload.stealTarget !== undefined) setStealTarget(payload.stealTarget);
    if (payload.gameOver    !== undefined) setGameOver(payload.gameOver);
    if (payload.finalSc     !== undefined) setFinalSc(payload.finalSc);
    if (payload.log         !== undefined) setLog(payload.log);
    if (payload.gameMode    !== undefined) setGameMode(payload.gameMode);
    if (payload.players     !== undefined) setPlayers(payload.players);
  }, []);

  // ── Envoyer une action à l'hôte (invité uniquement) ──
  const sendAction = (name, args=[]) => {
    // For guest, there is only one connection in connsRef
    const c = connsRef.current[0];
    if (c && c.open) c.send({ type:'action', name, args });
  };

  // ── Câblage commun d'une connexion PeerJS établie (côté hôte ET invité) ──
  const wireConnection = c => {
    c.on('open', () => {
      if (liveRef.current.netMode === 'host') {
        // Host: assign a player index to the new guest
        const hostPlayers = playersRef.current;
        const maxP = liveRef.current.gameMode === '2v2' ? 4 : (liveRef.current.gameMode === '1v1v1' ? 3 : 2);
        if (hostPlayers.length >= maxP) {
          c.send({ type: 'error', payload: { msg: 'This room is already full.' }});
          setTimeout(() => c.close(), 500);
          return;
        }

        connsRef.current.push(c);
        const newIdx = hostPlayers.length; // Host is 0, guests are 1, 2, 3
        const newPlayers = [...hostPlayers, { id: c.peer, idx: newIdx, name: `Player ${newIdx+1}` }];
        playersRef.current = newPlayers;
        setPlayers(newPlayers);
        setConnStatus('connected');
        setNetScreen('lobby');
        // Welcome the guest and tell them their index
        c.send({ type: 'welcome', payload: { myPlayerIdx: newIdx, gameMode: liveRef.current.gameMode, players: newPlayers }});
        // Update other guests about the new player
        connsRef.current.forEach(otherC => {
          if (otherC !== c && otherC.open) otherC.send({ type: 'state', payload: { players: newPlayers }});
        });
      } else {
        // Guest: wait for welcome message
        setConnStatus('connected');
        setNetScreen('lobby');
        connsRef.current = [c];
        c.send({ type: 'player-profile', payload: { name: sanitizeProfileName(profile.displayName, 'Player 1'), id: profile.id } });
      }
    });
    c.on('data', data => {
      const live = liveRef.current;
      if (data.type === 'welcome' && live.netMode === 'guest') {
        setMyPlayerIdx(data.payload.myPlayerIdx);
        setGameMode(data.payload.gameMode);
        setPlayers(data.payload.players);
        playersRef.current = data.payload.players;
      }
      if (data.type === 'player-profile' && live.netMode === 'host') {
        const guestName = sanitizeProfileName(data.payload.name, `Player ${playersRef.current.length + 1}`);
        const next = playersRef.current.map(player => (player.id === data.payload.id || player.id === c.peer)
          ? { ...player, name: guestName }
          : player);
        if (next.every(player => player.id !== data.payload.id && player.id !== c.peer)) {
          next.push({ id: data.payload.id || c.peer, idx: playersRef.current.length, name: guestName });
        }
        playersRef.current = next;
        setPlayers(next);
        connsRef.current.forEach(otherC => {
          if (otherC.open) otherC.send({ type: 'state', payload: { players: next } });
        });
      }
      if (data.type === 'error' && live.netMode === 'guest') {
        setConnStatus('error');
        setConnErr(data.payload.msg);
      }
      if (data.type === 'start') {
        setNetScreen('playing');
      }
      if (data.type === 'state' && live.netMode === 'guest') live.applyRemoteState(data.payload);
      if (data.type === 'action' && live.netMode === 'host')  live.handleRemoteAction(data);
    });
    c.on('close', () => {
      if (liveRef.current.netMode === 'host') {
        connsRef.current = connsRef.current.filter(conn => conn !== c);
        // Simplified: just show error for now if someone leaves
        setConnStatus('error');
        setConnErr("A player has disconnected.");
      } else {
        setConnStatus('error');
        setConnErr("Connection lost with the host.");
      }
    });
  };

  const startHosting = (fixedCode) => {
    setNetMode('host');
    setNetScreen('hosting');
    setConnStatus('connecting');
    const hostPlayer = { id: profile.id, idx: 0, name: sanitizeProfileName(profile.displayName, 'Player 1') };
    playersRef.current = [hostPlayer];
    setPlayers([hostPlayer]);
    setMyPlayerIdx(0);
    const code = fixedCode || makeRoomCode();
    const p = new Peer(ROOM_PREFIX + code);
    peerRef.current = p;
    p.on('open', () => { setRoomCode(code); setConnStatus('waiting'); });
    p.on('connection', c => wireConnection(c));
    p.on('error', err => {
      if (err.type === 'unavailable-id' && !fixedCode) { p.destroy(); startHosting(); return; }
      setConnStatus('error');
      setConnErr(err.type === 'network'
        ? 'Network error. Check your internet connection.'
        : 'Could not create the game room (Error: ' + err.type + ')');
    });
  };

  const handleQuickJoin = () => {
    const quickCode = 'QUICK';
    setNetMode('guest');
    setNetScreen('joining');
    setConnStatus('connecting');
    setJoinInput(quickCode);
    const p = new Peer();
    peerRef.current = p;
    p.on('open', () => {
      const c = p.connect(ROOM_PREFIX + quickCode, { reliable:true });
      wireConnection(c);
    });
    p.on('error', err => {
      if (err.type === 'peer-unavailable') {
        p.destroy();
        startHosting(quickCode);
      } else {
        setConnStatus('error');
        setConnErr('Quick Join failed: ' + err.type);
      }
    });
  };

  const startJoining = (fixedCode) => {
    const code = fixedCode || joinInput.trim().toUpperCase();
    if (!code) return;
    setNetMode('guest');
    setNetScreen('joining');
    setConnStatus('connecting');
    const p = new Peer();
    peerRef.current = p;
    p.on('open', () => {
      const c = p.connect(ROOM_PREFIX + code, { reliable:true });
      c.on('error', () => { setConnStatus('error'); setConnErr("Couldn't reach that game code. Check it and try again."); });
      wireConnection(c);
    });
    p.on('error', err => {
      setConnStatus('error');
      if (err.type === 'peer-unavailable') {
        setConnErr(`Room "${code}" not found. Check the code and try again.`);
      } else if (err.type === 'network') {
        setConnErr('Network error. Check your internet connection.');
      } else {
        setConnErr('Connection error: ' + err.type);
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    const loadApkUrl = async () => {
      const envOverride = import.meta.env.VITE_APK_DOWNLOAD_URL;
      if (envOverride) {
        if (!cancelled) setApkDownloadUrl(envOverride);
        return;
      }
      try {
        const latestUrl = await getLatestReleaseApkUrl();
        if (!cancelled) setApkDownloadUrl(latestUrl);
      } catch {
        if (!cancelled) setApkDownloadUrl(DEFAULT_APK_DOWNLOAD_URL);
      }
    };
    loadApkUrl();
    return () => { cancelled = true; };
  }, []);

  const qrShareUrl = roomCode ? buildInviteUrl(roomCode) : apkDownloadUrl;

  useEffect(() => {
    const joinCodeFromUrl = new URLSearchParams(window.location.search).get('join');
    if (joinCodeFromUrl) {
      setJoinInput(joinCodeFromUrl);
      startJoining(joinCodeFromUrl);
    }
  }, []);

  useEffect(() => {
    const target = qrShareUrl || apkDownloadUrl || APP_DOWNLOAD_URL;
    if (!target) {
      setQrCodeUrl('');
      return;
    }
    QRCode.toDataURL(target, {
      width: 150,
      margin: 1,
      color: { dark: '#0F172A', light: '#F8FAFC' },
      type: 'image/png',
    })
      .then(dataUrl => setQrCodeUrl(dataUrl))
      .catch(() => setQrCodeUrl(''));
  }, [qrShareUrl]);

  const handleUpdateRelease = async () => {
    setUpdateStatus('Checking for latest release...');
    try {
      const releaseUrl = await getLatestReleaseApkUrl();
      if (typeof window !== 'undefined') {
        const newTab = window.open(releaseUrl, '_blank', 'noopener,noreferrer');
        if (!newTab) {
          window.location.href = releaseUrl;
        }
      }
      setUpdateStatus('Latest release opened.');
    } catch {
      setUpdateStatus('Could not fetch the latest release right now.');
    }
  };

  const leaveGame = () => {
    connsRef.current.forEach(c => c.close());
    if (peerRef.current) peerRef.current.destroy();
    connsRef.current = []; peerRef.current = null;
    setNetScreen('menu'); setNetMode('local'); setConnStatus('idle'); setConnErr('');
    setRoomCode(''); setJoinInput(''); setPlayers([]); setMyPlayerIdx(0);
  };

  useEffect(() => () => { // cleanup on unmount
    connsRef.current.forEach(c => c.close());
    if (peerRef.current) peerRef.current.destroy();
  }, []);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    if (!showDetails) return;
    const handleOutside = e => {
      if (detailsRef.current && !detailsRef.current.contains(e.target)) setShowDetails(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showDetails]);

  useEffect(() => {
    void writeJsonStorage(PROFILE_STORAGE_KEY, profile);
  }, [profile]);

  const addLog = useCallback((msg, clr='#D1D5DB') => {
    setLog(p => [{msg,clr,id:Date.now()+Math.random()}, ...p].slice(0,50));
  },[]);

  const getPlayerNameBySlot = useCallback((slotIdx) => {
    if (netMode === 'local') {
      if (slotIdx === 0) return sanitizeProfileName(profile.displayName, 'Player 1');
      return `Player ${slotIdx + 1}`;
    }
    if (players[slotIdx]?.name) return players[slotIdx].name;
    return `Player ${slotIdx + 1}`;
  }, [netMode, players, profile.displayName]);

  const appendHistoryEntry = useCallback(() => {
    const numPlayers = gameMode === '2v2' ? 4 : (gameMode === '1v1v1' ? 3 : 2);
    const playerNames = Array.from({length:numPlayers}, (_, idx) => getPlayerNameBySlot(idx));
    const winnerIndex = finalSc.reduce((bestIdx, score, idx, arr) => score > arr[bestIdx] ? idx : bestIdx, 0);
    const winnerName = playerNames[winnerIndex] || 'Player 1';
    const summary = `${winnerName} won ${finalSc[winnerIndex]}-${finalSc.filter((_, idx) => idx !== winnerIndex).sort((a, b) => b - a)[0] ?? 0}`;
    const entry = {
      id: createGuid(),
      createdAt: new Date().toISOString(),
      gameMode,
      netMode,
      winnerName,
      summary,
      scores: finalSc.slice(0, numPlayers),
      players: playerNames,
    };
    setHistory(prev => [entry, ...prev].slice(0, 20));
  }, [finalSc, gameMode, getPlayerNameBySlot, netMode]);

  useEffect(() => {
    setDraftName(profile.displayName);
  }, [profile.displayName]);

  useEffect(() => {
    void writeJsonStorage(HISTORY_STORAGE_KEY, history);
  }, [history]);

  const saveProfile = () => {
    const nextName = sanitizeProfileName(draftName, '');
    const nextProfile = { ...profile, displayName: nextName, updatedAt: new Date().toISOString() };
    setProfile(nextProfile);
    void writeJsonStorage(PROFILE_STORAGE_KEY, nextProfile);

    if (netMode === 'guest' && connsRef.current[0]?.open) {
      connsRef.current[0].send({ type: 'player-profile', payload: { name: nextName || 'Player 1', id: nextProfile.id } });
    }
    if (netMode === 'host') {
      const updated = playersRef.current.map(player => (
        player.id === nextProfile.id || player.idx === 0
          ? { ...player, name: nextName || 'Player 1' }
          : player
      ));
      playersRef.current = updated;
      setPlayers(updated);
      connsRef.current.forEach(c => {
        if (c.open) c.send({ type: 'state', payload: { players: updated } });
      });
    }
  };

  useEffect(() => {
    if (!gameOver || historyWrittenRef.current) return;
    historyWrittenRef.current = true;
    appendHistoryEntry();
  }, [gameOver, appendHistoryEntry]);

  // Pull next card from deck into a pool slot
  const refill = (poolArr, deckArr, slotIdx) => {
    const p = [...poolArr], d = [...deckArr];
    p[slotIdx] = d.length > 0 ? d.shift() : null;
    return { pool:p, deck:d };
  };

  const startGame = useCallback(() => {
    if (netMode === 'guest') { sendAction('startGame'); return; }
    const d = buildDeck();
    const p = [null, null, null, null, null];
    const rem = [...d];
    for (let i=0; i<5; i++) if (rem.length) p[i] = rem.shift();
    const numPlayers = gameMode === '2v2' ? 4 : (gameMode === '1v1v1' ? 3 : 2);
    const newGrids = Array.from({length:numPlayers}, () => Array(9).fill(null));
    setDeck(rem); setPool(p);
    setGrids(newGrids);
    setTurn(0); setPhase('picking'); setHeld(null); setStealTarget(null); setWildSelection(null);
    setGameOver(false); setFinalSc(Array(numPlayers).fill(0)); setLog([]); historyWrittenRef.current = false;
    addLog(`🃏 New game! ${gameMode} Mode. ${getPlayerNameBySlot(0)} picks first.`,`#FFD700`);
    if (netMode === 'host') broadcastState({
      deck:rem, pool:p, grids:newGrids, turn:0, phase:'picking', held:null,
      stealTarget:null, gameOver:false, finalSc:Array(numPlayers).fill(0), log:[], gameMode
    });
  }, [addLog, netMode, broadcastState, gameMode]);

  // ── Pick a card from the pool ──
  const pickCard = (poolIdx) => {
    if (netMode === 'guest') { sendAction('pickCard', [poolIdx]); return; }
    if (phase !== 'picking' || gameOver || !pool[poolIdx]) return;
    const card = pool[poolIdx];
    const newHeld = { card, poolIdx, fromSteal: false };
    setHeld(newHeld);

    if (card.steal) {
      // Ask which player's grid to steal from — opposite team's grids
      // In 1v1: turn 0 steals from 1, turn 1 from 0.
      // In 2v2: Team A (0,2) steals from Team B (1,3).
      setPhase('steal');
      addLog(`⚡ P${turn+1} grabbed STEAL — click a card on opponent's grid!`, '#FF6B35');
      if (netMode === 'host') broadcastState({ held:newHeld, phase:'steal' });
    } else if (card.wild) {
      setPhase('wild-select');
      addLog(`${turn===0?'🔵 P1':'🔴 P2'} picked 🃏 WILD — choose color and symbol!`, P_CLR[turn]);
      if (netMode === 'host') broadcastState({ held:newHeld, phase:'wild-select' });
    } else {
      setPhase('placing');
      addLog(`${turn===0?'🔵 P1':'🔴 P2'} picked ${card.value+card.suit}.`, P_CLR[turn]);
      if (netMode === 'host') broadcastState({ held:newHeld, phase:'placing' });
    }
  };

  // ── Select wild card: step 1, choose suit ──
  const selectWildSuit = (suit) => {
    if (phase !== 'wild-select' || !held || gameOver) return;
    setWildSelection({ suit });
  };

  // ── Select wild card: step 2, choose value — this locks in one real card ──
  const selectWildValue = (value, remoteSuit) => {
    const suit = remoteSuit || wildSelection?.suit;
    if (phase !== 'wild-select' || !held || !suit || gameOver) return;
    if (netMode === 'guest') { sendAction('selectWildValue', [value, suit]); setWildSelection(null); return; }
    // The Joker becomes a genuine, concrete card from now on: it scores and
    // renders exactly like any other card of that suit/value (no more
    // auto-picking the best possible combo — the player commits to a choice).
    const finalCard = {
      ...held.card,
      suit, value,
      wild: false,
      fromWild: true, // cosmetic-only marker, doesn't affect scoring
      label: undefined,
    };
    const newHeld = { ...held, card: finalCard };
    setHeld(newHeld);
    setPhase('placing');
    addLog(`${turn===0?'🔵 P1':'🔴 P2'} turned 🃏 WILD into ${value}${suit}.`, P_CLR[turn]);
    setWildSelection(null);
    if (netMode === 'host') broadcastState({ held:newHeld, phase:'placing' });
  };

  const cancelWildSuit = () => setWildSelection(null);

  // ── Place held card on own grid ──
  const placeCard = (cellIdx) => {
    if (netMode === 'guest') { sendAction('placeCard', [cellIdx]); return; }
    if (phase !== 'placing' || !held || gameOver) return;
    if (grids[turn][cellIdx]) return;

    const newGrids = grids.map(g => [...g]);
    newGrids[turn][cellIdx] = held.card;

    let newPool = pool, newDeck = deck;
    if (!held.fromSteal) {
      // Only refill pool if card came from pool (not from steal)
      const refilled = refill(pool, deck, held.poolIdx);
      newPool = refilled.pool;
      newDeck = refilled.deck;
    }

    setGrids(newGrids); setPool(newPool); setDeck(newDeck);
    addLog(`${turn===0?'🔵 P1':'🔴 P2'} placed ${held.card.wild?'WILD':held.card.value+held.card.suit} on cell ${cellIdx+1}.`, P_CLR[turn]);

    const bothFull = newGrids.every(g => g.every(Boolean));
    if (bothFull) {
      const sc = newGrids.map(g => totalScore(g));
      setFinalSc(sc); setGameOver(true); setPhase('over'); setHeld(null);
      addLog(`🏁 Game over! P1: ${sc[0]} | P2: ${sc[1]}`, '#FFD700');
      addLog(sc[0]>sc[1]?'🏆 Player 1 wins!':sc[1]>sc[0]?'🏆 Player 2 wins!':'🤝 Tie!', '#FFD700');
      if (netMode === 'host') broadcastState({
        grids:newGrids, pool:newPool, deck:newDeck, finalSc:sc, gameOver:true, phase:'over', held:null,
      });
      return;
    }

    advanceTurn(newPool, newDeck, newGrids);
  };

  // ── Steal a card from opponent's grid ──
  const stealCard = (cellIdx, targetIdx) => {
    const target = targetIdx !== undefined ? targetIdx : stealTarget;
    if (netMode === 'guest') { sendAction('stealCard', [cellIdx, target]); return; }
    if (phase !== 'steal' || target === null || !held || gameOver) return;
    if (!grids[target][cellIdx]) return;

    const stolen = grids[target][cellIdx];
    const newGrids = grids.map(g => [...g]);
    newGrids[target][cellIdx] = null;

    const { pool:newPool, deck:newDeck } = refill(pool, deck, held.poolIdx);
    setGrids(newGrids); setPool(newPool); setDeck(newDeck);
    addLog(`⚡ P${turn+1} STOLE card from P${target+1}!`, '#FF6B35');

    // Now the stolen card is held and player must place it on their own grid
    const newHeld = { card: stolen, poolIdx: null, fromSteal: true };
    setHeld(newHeld);
    setPhase('placing');
    setStealTarget(null);
    if (netMode === 'host') broadcastState({
      grids:newGrids, pool:newPool, deck:newDeck, held:newHeld, phase:'placing', stealTarget:null,
    });
  };

  // ── Annuler la sélection en cours (remet la carte en jeu dans le pool) ──
  const unselectCard = () => {
    if (netMode === 'guest') { sendAction('unselectCard'); return; }
    if (!held || held.fromSteal || gameOver) return;
    // La carte tenue n'a jamais quitté le pool (elle n'est retirée qu'au moment
    // du placement), donc il suffit de revenir en phase "picking".
    setHeld(null);
    setPhase('picking');
    setWildSelection(null);
    addLog(`↩️ ${turn===0?'P1':'P2'} a reposé sa carte.`, '#9CA3AF');
    if (netMode === 'host') broadcastState({ held:null, phase:'picking' });
  };

  const advanceTurn = (newPool, newDeck, newGrids) => {
    const allFull = newGrids.every(g => g.every(Boolean));
    if (allFull) {
      const sc = newGrids.map(g => totalScore(g));
      setFinalSc(sc); setGameOver(true); setPhase('over'); setHeld(null);
      if (netMode === 'host') broadcastState({
        grids:newGrids, pool:newPool, deck:newDeck, finalSc:sc, gameOver:true, phase:'over', held:null,
      });
      return;
    }

    const numP = gameMode === '2v2' ? 4 : (gameMode === '1v1v1' ? 3 : 2);
    let nextTurn = (turn + 1) % numP;
    // Skip players whose grid is already full
    while (newGrids[nextTurn].every(Boolean)) {
      addLog(`⏭️ P${nextTurn+1}'s grid is full — skipping!`, '#FFD700');
      nextTurn = (nextTurn + 1) % numP;
    }

    setTurn(nextTurn); setPool(newPool); setDeck(newDeck); setGrids(newGrids);
    setPhase('picking'); setHeld(null); setStealTarget(null);
    if (netMode === 'host') broadcastState({
      turn:nextTurn, pool:newPool, deck:newDeck, grids:newGrids, phase:'picking', held:null, stealTarget:null,
    });
  };

  // ── Hôte : exécute une action reçue de l'invité, comme si elle venait d'un clic local ──
  function handleRemoteAction(msg) {
    switch (msg.name) {
      case 'pickCard':        pickCard(...msg.args); break;
      case 'placeCard':       placeCard(...msg.args); break;
      case 'stealCard':       stealCard(...msg.args); break;
      case 'selectWildValue': selectWildValue(...msg.args); break;
      case 'unselectCard':    unselectCard(); break;
      case 'startGame':       startGame(); break;
      default: break;
    }
  }

  // Tenu à jour après CHAQUE rendu (pas de tableau de dépendances) : c'est ce
  // que lisent les callbacks PeerJS enregistrés une seule fois, pour toujours
  // agir sur l'état et les fonctions les plus récents plutôt que sur une
  // closure figée au moment de la connexion.
  useEffect(() => {
    liveRef.current = { netMode, applyRemoteState, handleRemoteAction, startGame, gameMode, players: playersRef.current };
  });

  const scores = grids.map(g => totalScore(g));
  const lines  = grids.map(g => getLines(g));

  const grade  = s => s>=400?'S':s>=260?'A':s>=160?'B':s>=90?'C':s>=45?'D':'F';
  const gClr   = {S:'#FFD700',A:'#FF6B35',B:'#A855F7',C:'#3B82F6',D:'#10B981',F:'#6B7280'};

  const isSteal   = phase === 'steal';
  const canIAct = netMode === 'local' || (turn % players.length === myPlayerIdx);
  const isWild    = phase === 'wild-select';
  const turnClr   = P_CLR[turn];
  const turnName = getPlayerNameBySlot(turn);
  const phaseMsg  = phase==='picking'  ? `${turnName} — choose a card from the pool`
                  : phase==='placing'  ? `${turnName} — place your card on your grid`
                  : phase==='wild-select' ? `${turnName} — choose exactly which card your JOKER becomes`
                  : phase==='steal'    ? `${turnName} — click a card on the opponent's grid to steal!`
                  : 'Game Over';

  return (
    <div className="app-shell" style={{
      minHeight:'100vh', overflowX:'hidden', width:'100%',
      background:'radial-gradient(ellipse at 50% 0%,#1B5E3A 0%,#0F3D22 40%,#061A0F 100%)',
      display:'flex', flexDirection:'column', alignItems:'center',
      padding:'20px 12px 40px', fontFamily:"Georgia,'Times New Roman',serif",
    }}>
      <style>{`
        @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(255,215,0,.2);}50%{box-shadow:0 0 28px rgba(255,215,0,.6);}}
        @keyframes stGlow{0%,100%{box-shadow:0 0 10px rgba(255,107,53,.3);}50%{box-shadow:0 0 28px rgba(255,107,53,.8);}}
        @keyframes in{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pop{0%{transform:scale(.75);}60%{transform:scale(1.08);}100%{transform:scale(1);}}
        @keyframes panelIn{from{opacity:0;transform:translate(8px,-8px) scale(.97);}to{opacity:1;transform:translate(0,0) scale(1);}}
        @keyframes turnPulse{0%,100%{filter:brightness(1);}50%{filter:brightness(1.25);}}

        /* Mise en page des 3 colonnes (grille P1 / pool / grille P2) : empilées
           verticalement par défaut (téléphones, plié, déplié en portrait), et
           uniquement côte à côte quand il y a clairement la place — on évite
           ainsi le flex-wrap partiel où 2 colonnes tiennent et la 3e retombe
           toute seule en dessous. */
        .board-3col {
          display:flex; flex-direction:column; align-items:center;
          gap:12px; width:100%;
        }
        @media (min-width:768px) {
          .board-3col { flex-direction:row; justify-content:center; align-items:flex-start; gap:14px; width:auto; }
        }
        @media (max-height:700px) {
          .app-shell { padding-top:8px !important; padding-bottom:16px !important; }
          .app-title { margin-bottom:2px !important; }
          .app-subtitle { display:none; }
        }
      `}</style>

      {netScreen !== 'playing' && (
        <div style={{
          minHeight:'80vh', display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', gap:18, width:'100%', maxWidth:380, textAlign:'center',
        }}>
          <h1 style={{margin:0,fontSize:'clamp(1.4rem,6vw,2.1rem)',color:'#FFD700',
            letterSpacing:3,textShadow:'0 0 28px rgba(255,215,0,.45)',fontStyle:'italic'}}>
            ♠ TIC-A-TAC POKER ♠
          </h1>

          {netScreen === 'menu' && (
            <div style={{display:'flex',flexDirection:'column',gap:12,width:'100%'}}>
              {/* Mode Toggle */}
              <div style={{
                display:'flex', gap:4, background:'rgba(0,0,0,.3)', padding:4, borderRadius:12,
                border:'1px solid rgba(255,255,255,.1)', marginBottom:8, overflowX:'auto'
              }}>
                {['1v1', '1v1v1', '2v2'].map(m => (
                  <button key={m} onClick={() => setGameMode(m)} style={{
                    flex:1, padding:'8px 4px', borderRadius:8, border:'none', minWidth:60,
                    background: gameMode === m ? 'rgba(255,215,0,.15)' : 'transparent',
                    color: gameMode === m ? '#FFD700' : '#9CA3AF',
                    fontSize:11, fontWeight:'bold', cursor:'pointer', transition:'all .2s'
                  }}>{m}</button>
                ))}
              </div>

              <div style={{
                background:'rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.1)',
                borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:8,
              }}>
                <div style={{color:'#9CA3AF', fontSize:10, letterSpacing:2, textTransform:'uppercase'}}>Player profile</div>
                <input
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder="Player 1"
                  style={{
                    width:'100%', borderRadius:10, border:'1px solid rgba(255,255,255,.15)',
                    background:'rgba(255,255,255,.04)', color:'#F3F4F6', padding:'10px 12px',
                    fontSize:14, fontFamily:'Georgia,serif', outline:'none',
                  }}
                />
                <button onClick={saveProfile} style={{
                  padding:'8px 12px', borderRadius:8, border:'1px solid rgba(255,215,0,.4)',
                  background:'rgba(255,215,0,.08)', color:'#FFD700', fontSize:11, fontWeight:'bold',
                  cursor:'pointer', fontFamily:'Georgia,serif',
                }}>Save profile</button>
                <div style={{display:'flex', justifyContent:'space-between', gap:8, alignItems:'center'}}>
                  <span style={{color:'#6EAB80', fontSize:10, letterSpacing:1}}>ID</span>
                  <span style={{color:'#FFD700', fontSize:10, fontFamily:'monospace', overflowWrap:'anywhere'}}>{profile.id.slice(0, 12)}…</span>
                </div>
              </div>

              <button onClick={()=>{ setNetMode('local'); setNetScreen('playing'); startGame(); }} style={{
                padding:'16px 0',borderRadius:12,border:'1px solid rgba(255,215,0,.4)',
                background:'rgba(255,215,0,.08)',color:'#FFD700',fontSize:15,fontWeight:'bold',
                cursor:'pointer',fontFamily:'Georgia,serif',
              }}>🎮 Play Locally (pass &amp; play)</button>
              <button onClick={handleQuickJoin} style={{
                padding:'16px 0',borderRadius:12,border:'none',
                background:'linear-gradient(135deg,#FFD700,#FF8C00)',color:'#1A1A2E',fontSize:15,fontWeight:'bold',
                cursor:'pointer',fontFamily:'Georgia,serif',
              }}>⚡ Quick Join</button>
              <button onClick={startHosting} style={{
                padding:'16px 0',borderRadius:12,border:'1px solid rgba(255,215,0,.4)',
                background:'rgba(255,215,0,.08)',color:'#FFD700',fontSize:15,fontWeight:'bold',
                cursor:'pointer',fontFamily:'Georgia,serif',
              }}>📡 Host Online Game</button>
              <button onClick={()=>setNetScreen('joining')} style={{
                padding:'16px 0',borderRadius:12,border:'1px solid rgba(75,158,255,.5)',
                background:'rgba(75,158,255,.1)',color:'#4B9EFF',fontSize:15,fontWeight:'bold',
                cursor:'pointer',fontFamily:'Georgia,serif',
              }}>🔗 Join Online Game</button>
              <button onClick={() => setNetScreen('qr')} style={{
                padding:'10px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)',
                background:'rgba(255,255,255,.03)', color:'#FFD700', fontSize:11, fontWeight:'bold',
                cursor:'pointer', fontFamily:'Georgia,serif',
              }}>
                {roomCode ? 'Show join QR code' : 'Install / Join via QR'}
              </button>
              <button onClick={handleUpdateRelease} style={{
                padding:'10px 12px', borderRadius:10, border:'1px solid rgba(75,158,255,.5)',
                background:'rgba(75,158,255,.08)', color:'#4B9EFF', fontSize:11, fontWeight:'bold',
                cursor:'pointer', fontFamily:'Georgia,serif',
              }}>
                Update latest release
              </button>
              {updateStatus ? (
                <div style={{ color:'#6EAB80', fontSize:10, letterSpacing:1, textTransform:'uppercase' }}>
                  {updateStatus}
                </div>
              ) : null}
              <button onClick={() => setNetScreen('history')} style={{
                padding:'10px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,.12)',
                background:'rgba(255,255,255,.03)', color:'#FFD700', fontSize:11, fontWeight:'bold',
                cursor:'pointer', fontFamily:'Georgia,serif',
              }}>
                {history.length === 0 ? 'History is empty' : `View history (${history.length})`}
              </button>

              <p style={{color:'#6EAB80',fontSize:11,marginTop:8}}>
                Online play needs a brief internet connection to pair the two devices, then the game runs directly between you.
              </p>
            </div>
          )}

          {netScreen === 'qr' && (
            <div style={{display:'flex',flexDirection:'column',gap:14,width:'100%',alignItems:'stretch'}}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
                <div style={{color:'#9CA3AF', fontSize:10, letterSpacing:2, textTransform:'uppercase'}}>
                  {roomCode ? 'Join room QR' : 'Install / join QR'}
                </div>
                <button onClick={() => setNetScreen('menu')} style={{
                  background:'none', border:'1px solid rgba(255,255,255,.2)', borderRadius:8,
                  padding:'8px 12px', color:'#9CA3AF', fontSize:11, cursor:'pointer', fontFamily:'Georgia,serif',
                }}>← Back</button>
              </div>
              <div style={{background:'rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.08)', borderRadius:14, padding:18, display:'flex', flexDirection:'column', alignItems:'center', gap:12, textAlign:'center'}}>
                <div style={{ color:'#9CA3AF', fontSize:10, letterSpacing:2, textTransform:'uppercase' }}>
                  {roomCode ? 'Scan to join room' : 'Scan to install / join'}
                </div>
                <div style={{ width:180, height:180, borderRadius:14, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.12)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', boxShadow:'0 12px 24px rgba(0,0,0,.25)' }}>
                  {qrCodeUrl ? (
                    <img src={qrCodeUrl} alt="QR code" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  ) : (
                    <span style={{ color:'#9CA3AF', fontSize:11, letterSpacing:1 }}>Generating…</span>
                  )}
                </div>
                <div style={{ color:'#FFD700', fontSize:12, fontWeight:'bold', lineHeight:1.5 }}>
                  {roomCode ? `Room ${roomCode}` : APP_DOWNLOAD_URL ? 'Download the APK or open the join link' : 'Set VITE_APK_DOWNLOAD_URL to enable APK QR'}
                </div>
                <div style={{ color:'#C7D2FE', fontSize:10, fontFamily:'monospace', wordBreak:'break-all', lineHeight:1.5 }}>
                  {qrShareUrl || 'No APK URL configured yet'}
                </div>
              </div>
            </div>
          )}

          {netScreen === 'history' && (
            <div style={{display:'flex',flexDirection:'column',gap:14,width:'100%',alignItems:'stretch'}}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
                <div style={{color:'#9CA3AF', fontSize:10, letterSpacing:2, textTransform:'uppercase'}}>Game history</div>
                <button onClick={() => setNetScreen('menu')} style={{
                  background:'none', border:'1px solid rgba(255,255,255,.2)', borderRadius:8,
                  padding:'8px 12px', color:'#9CA3AF', fontSize:11, cursor:'pointer', fontFamily:'Georgia,serif',
                }}>← Back</button>
              </div>
              {history.length === 0 ? (
                <div style={{background:'rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.1)', borderRadius:12, padding:16, color:'#6B7280', fontSize:12, textAlign:'center'}}>
                  No games yet. Finish a match to save your history.
                </div>
              ) : (
                <div style={{display:'flex', flexDirection:'column', gap:8, maxHeight:'65vh', overflowY:'auto', paddingRight:4}}>
                  {history.map(item => (
                    <div key={item.id} style={{
                      background:'rgba(0,0,0,.25)', border:'1px solid rgba(255,255,255,.08)', borderRadius:12,
                      padding:'12px 12px', display:'flex', flexDirection:'column', gap:6, textAlign:'left',
                    }}>
                      <div style={{display:'flex', justifyContent:'space-between', gap:8, alignItems:'center'}}>
                        <span style={{color:'#FFD700', fontSize:11, fontWeight:'bold'}}>{item.gameMode}</span>
                        <span style={{color:'#6EAB80', fontSize:10}}>{new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</span>
                      </div>
                      <div style={{color:'#D1D5DB', fontSize:12, fontWeight:'bold'}}>{item.summary}</div>
                      <div style={{color:'#9CA3AF', fontSize:10}}>Players: {item.players.join(' · ')}</div>
                      <div style={{color:'#6EAB80', fontSize:10}}>Scores: {item.scores.join(' · ')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {netScreen === 'hosting' && (
            <div style={{display:'flex',flexDirection:'column',gap:14,width:'100%',alignItems:'center'}}>
              <p style={{color:'#9CA3AF',fontSize:13}}>Give this code to the other player:</p>
              {roomCode ? (
                <div style={{
                  fontSize:'clamp(1.8rem,10vw,2.6rem)',fontWeight:'bold',letterSpacing:6,color:'#FFD700',
                  background:'rgba(0,0,0,.4)',border:'2px solid rgba(255,215,0,.4)',borderRadius:14,
                  padding:'14px 10px',width:'100%',
                }}>{roomCode}</div>
              ) : (
                <div style={{color:'#9CA3AF',fontSize:13}}>Generating code…</div>
              )}
              {connStatus==='waiting' && <p style={{color:'#6EAB80',fontSize:12,animation:'glow 2s infinite'}}>⏳ Waiting for the other player to join…</p>}
              {connStatus==='error' && <p style={{color:'#FF6B6B',fontSize:12}}>⚠️ {connErr}</p>}
              <button onClick={leaveGame} style={{
                marginTop:6,background:'none',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,
                padding:'8px 20px',color:'#9CA3AF',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',
              }}>← Cancel</button>
            </div>
          )}

          {netScreen === 'joining' && (
            <div style={{display:'flex',flexDirection:'column',gap:14,width:'100%',alignItems:'center'}}>
              <p style={{color:'#9CA3AF',fontSize:13}}>Enter the code shown on the host's screen:</p>
              <input value={joinInput} onChange={e=>setJoinInput(e.target.value.toUpperCase())}
                placeholder="ABCDE" maxLength={5} autoCapitalize="characters"
                style={{
                  fontSize:'1.6rem',fontWeight:'bold',letterSpacing:6,textAlign:'center',color:'#FFD700',
                  background:'rgba(0,0,0,.4)',border:'2px solid rgba(75,158,255,.4)',borderRadius:14,
                  padding:'12px 10px',width:'100%',fontFamily:'Georgia,serif',
                }}
              />
              <button onClick={startJoining} disabled={connStatus==='connecting'} style={{
                padding:'12px 0',borderRadius:12,border:'none',width:'100%',
                background:'linear-gradient(135deg,#4B9EFF,#2E6FE0)',color:'#fff',fontSize:14,fontWeight:'bold',
                cursor: connStatus==='connecting' ? 'default' : 'pointer', opacity: connStatus==='connecting'?.6:1,
                fontFamily:'Georgia,serif',
              }}>{connStatus==='connecting' ? '⏳ Connecting…' : '🔗 Connect'}</button>
              {connStatus==='error' && <p style={{color:'#FF6B6B',fontSize:12}}>⚠️ {connErr}</p>}
              <button onClick={leaveGame} style={{
                marginTop:2,background:'none',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,
                padding:'8px 20px',color:'#9CA3AF',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',
              }}>← Back</button>
            </div>
          )}
          {netScreen === 'lobby' && (
            <div style={{display:'flex',flexDirection:'column',gap:16,width:'100%',alignItems:'center'}}>
              <div style={{background:'rgba(0,0,0,.4)', border:'2px solid rgba(255,215,0,.3)', borderRadius:16, padding:16, width:'100%'}}>
                <div style={{color:'#9CA3AF', fontSize:11, letterSpacing:2, marginBottom:12}}>GAME LOBBY · {gameMode} MODE</div>
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {players.map(p => (
                    <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,.05)', padding:'8px 12px', borderRadius:10}}>
                      <span style={{color:P_CLR[p.idx], fontWeight:'bold', fontSize:14}}>{p.name} {p.idx === myPlayerIdx && '(YOU)'}</span>
                      <span style={{fontSize:10, color:'#6EAB80'}}>● Ready</span>
                    </div>
                  ))}
                  {Array.from({length: (gameMode==='2v2'?4:gameMode==='1v1v1'?3:2) - players.length}).map((_, i) => (
                    <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,.2)', padding:'8px 12px', borderRadius:10, border:'1px dashed rgba(255,255,255,.1)'}}>
                      <span style={{color:'#6B7280', fontSize:13}}>Waiting for player…</span>
                    </div>
                  ))}
                </div>
              </div>

              {netMode === 'host' ? (
                <button onClick={() => {
                  connsRef.current.forEach(c => c.send({ type: 'start' }));
                  setNetScreen('playing');
                  startGame();
                }} style={{
                  padding:'16px 0',borderRadius:12,border:'none', width:'100%',
                  background:'linear-gradient(135deg,#FFD700,#FF8C00)',color:'#1A1A2E',fontSize:15,fontWeight:'bold',
                  cursor:'pointer',fontFamily:'Georgia,serif',
                }}>🚀 Start Game</button>
              ) : (
                <p style={{color:'#6EAB80',fontSize:12,animation:'glow 2s infinite'}}>⏳ Waiting for host to start…</p>
              )}

              <button onClick={leaveGame} style={{
                background:'none',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,
                padding:'8px 20px',color:'#9CA3AF',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',
              }}>← Leave</button>
            </div>
          )}
        </div>
      )}

      {netScreen === 'playing' && (<>

      {/* Navigation & Info Icons */}
      <div style={{ position:'fixed', top:16, left:16, zIndex:100, display:'flex', gap:8 }}>
        <button onClick={leaveGame} title="Back to Menu" style={{
          width:42, height:42, borderRadius:'50%',
          background:'rgba(0,0,0,.5)', border:'1px solid rgba(255,255,255,.2)',
          color:'#9CA3AF', fontSize:18, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 14px rgba(0,0,0,.4)', transition:'all .2s',
        }}
          onMouseEnter={e=>{ e.currentTarget.style.background='rgba(0,0,0,.7)'; e.currentTarget.style.borderColor='rgba(255,255,255,.4)'; }}
          onMouseLeave={e=>{ e.currentTarget.style.background='rgba(0,0,0,.5)'; e.currentTarget.style.borderColor='rgba(255,255,255,.2)'; }}
        >🏠</button>
      </div>

      <div style={{ position:'fixed', top:16, right:16, zIndex:100, display:'flex', gap:8 }}>
        <button onClick={startGame} title={gameOver?'New Game':'Restart'} style={{
          width:42, height:42, borderRadius:'50%',
          background:'rgba(0,0,0,.5)', border:'1px solid rgba(255,215,0,.4)',
          color:'#FFD700', fontSize:18, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 14px rgba(0,0,0,.4)', transition:'all .2s',
        }}
          onMouseEnter={e=>{ e.currentTarget.style.background='rgba(0,0,0,.7)'; e.currentTarget.style.transform='scale(1.1)'; }}
          onMouseLeave={e=>{ e.currentTarget.style.background='rgba(0,0,0,.5)'; e.currentTarget.style.transform='scale(1)'; }}
        >{gameOver?'▶':'↺'}</button>

        <div ref={detailsRef}>
          <button onClick={()=>setShowDetails(v=>!v)} title="Hands, scoring detail & game log" style={{
            width:42, height:42, borderRadius:'50%',
            background: showDetails ? 'linear-gradient(135deg,#FFD700,#FF8C00)' : 'rgba(0,0,0,.5)',
            border: showDetails ? '1px solid #FFD700' : '1px solid rgba(255,215,0,.4)',
            color: showDetails ? '#1A1A2E' : '#FFD700',
            fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 4px 14px rgba(0,0,0,.4)', transition:'all .2s',
          }}>📊</button>

        {/* Details panel — hidden by default, opened via the corner icon */}
        {showDetails && (
          <div style={{
            position:'fixed', top:64, right:16, zIndex:99, width:'min(300px, calc(100vw - 32px))', maxHeight:'calc(100vh - 84px)',
            overflowY:'auto', animation:'panelIn .18s ease-out',
            background:'rgba(10,26,17,.97)', border:'1px solid rgba(255,215,0,.3)',
            borderRadius:14, padding:12, boxShadow:'0 10px 34px rgba(0,0,0,.55)',
            display:'flex', flexDirection:'column', gap:10,
          }}>
            {grids.map((g, i) => (
              <div key={i}>
                <div style={{color:P_CLR[i],fontSize:10,letterSpacing:1,fontWeight:'bold', marginTop: i>0?8:0}}>PLAYER {i+1} · SCORING DETAIL</div>
                <LinePanel lines={lines[i]} color={P_CLR[i]} />
              </div>
            ))}

            {/* Card legend */}
            <div style={{
              background:'rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.07)',
              borderRadius:12,padding:'10px 12px',fontSize:10,
              color:'#D1D5DB',lineHeight:1.85,width:'100%',
            }}>
              <div style={{color:'#9CA3AF',letterSpacing:1,marginBottom:4,fontSize:9}}>HANDS</div>
              {[['💎','Perfect Trips',200],['👑','Mini Royal',150],['🔥','Straight Flush',100],['🎯','Three of a Kind',60],
                ['📈','Straight',30],['💧','Flush',25],['✌️','Pair',10],['🃏','High Card',0]].map(([e,n,s])=>(
                <div key={n} style={{display:'flex',justifyContent:'space-between'}}>
                  <span style={{color:HAND_CLR[n]||'#9CA3AF'}}>{e} {n}</span>
                  <span style={{color:'#6B7280'}}>{s>0?`+${s}`:'—'}</span>
                </div>
              ))}
              <div style={{marginTop:6,borderTop:'1px solid rgba(255,255,255,.08)',paddingTop:6}}>
                <div>🃏 <span style={{color:'#FFD700'}}>WILD</span> — becomes any card you pick</div>
                <div>⚡ <span style={{color:'#FF6B35'}}>STEAL</span> — steal opponent's card</div>
              </div>
            </div>

            {/* Game log — no nested scroll region here; the whole panel above
                already scrolls as one unit, avoiding overlapping double scrollbars */}
            <div style={{
              background:'rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.07)',
              borderRadius:10,padding:'8px 10px',width:'100%',
            }}>
              <div style={{color:'#6B7280',fontSize:9,letterSpacing:2,marginBottom:4}}>GAME LOG</div>
              {log.map(l => (
                <div key={l.id} style={{color:l.clr,fontSize:11,marginBottom:2,lineHeight:1.4,animation:'in .3s'}}>{l.msg}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>

      {/* Title */}
      <h1 className="app-title" style={{margin:'0 0 4px',fontSize:'clamp(1.3rem,4vw,2.3rem)',color:'#FFD700',
        letterSpacing:4,textShadow:'0 0 28px rgba(255,215,0,.45)',fontStyle:'italic',textAlign:'center'}}>
        ♠ TIC-A-TAC POKER ♠
      </h1>
      <p className="app-subtitle" style={{color:'#6EAB80',margin:'0 0 6px',fontSize:10,letterSpacing:2,textAlign:'center'}}>
        {netMode==='local'
        ? `LOCAL 1v1 · ${sanitizeProfileName(profile.displayName, 'Player 1')} VS ${getPlayerNameBySlot(1)} · SHARED 5-CARD POOL · WILD & STEAL CARDS`
        : `ONLINE 1v1 · YOU ARE ${sanitizeProfileName(profile.displayName, 'Player 1')} · ROOM ${roomCode || '—'}`}
      </p>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        {netMode !== 'local' && (
          <span style={{
            fontSize:10,color: connStatus==='connected' ? '#10B981' : '#FF6B6B',
            display:'flex',alignItems:'center',gap:4,
          }}>● {connStatus==='connected' ? 'Connected' : 'Disconnected'}</span>
        )}
      </div>

      {/* Grid Switcher Tabs (Mobile or Team Switcher) */}
      {!gameOver && netScreen === 'playing' && (
        <div style={{
          display:'flex', gap:8, marginBottom:16, width: isMobile ? 'min(360px, 94vw)' : '320px',
          background:'rgba(0,0,0,.3)', padding:4, borderRadius:12,
          border:'1px solid rgba(255,255,255,.1)',
        }}>
          {gameMode === '1v1' ? (
            isMobile && [0,1].map(p => (
              <button key={p} onClick={() => setViewedPlayer(p)} style={{
                flex:1, padding:'9px 0', borderRadius:8, border:'none',
                background: viewedPlayer === p ? 'rgba(255,215,0,.15)' : 'transparent',
                color: viewedPlayer === p ? '#FFD700' : '#9CA3AF',
                fontSize:11, fontWeight:'bold', cursor:'pointer',
                transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:6
              }}>
                P{p+1}
                {turn === p && <span style={{width:6,height:6,borderRadius:'50%',background:P_CLR[p],boxShadow:`0 0 6px ${P_CLR[p]}`}}/>}
              </button>
            ))
          ) : gameMode === '1v1v1' ? (
            [0,1,2].map(p => (
              <button key={p} onClick={() => setViewedPlayer(p)} style={{
                flex:1, padding:'9px 0', borderRadius:8, border:'none',
                background: viewedPlayer === p ? 'rgba(255,215,0,.15)' : 'transparent',
                color: viewedPlayer === p ? '#FFD700' : '#9CA3AF',
                fontSize:10, fontWeight:'bold', cursor:'pointer',
                transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:4
              }}>
                P{p+1}
                {turn === p && <span style={{width:5,height:5,borderRadius:'50%',background:P_CLR[p],boxShadow:`0 0 6px ${P_CLR[p]}`}}/>}
              </button>
            ))
          ) : (
            // 2v2 Mode
            isMobile ? (
              [0,1,2,3].map(p => (
                <button key={p} onClick={() => setViewedPlayer(p)} style={{
                  flex:1, padding:'9px 0', borderRadius:8, border:'none',
                  background: viewedPlayer === p ? 'rgba(255,215,0,.15)' : 'transparent',
                  color: viewedPlayer === p ? '#FFD700' : '#9CA3AF',
                  fontSize:9, fontWeight:'bold', cursor:'pointer',
                  transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:3
                }}>
                  P{p+1}
                  {turn === p && <span style={{width:5,height:5,borderRadius:'50%',background:P_CLR[p],boxShadow:`0 0 6px ${P_CLR[p]}`}}/>}
                </button>
              ))
            ) : (
              [0,1].map(t => (
                <button key={t} onClick={() => setViewedPlayer(t)} style={{
                  flex:1, padding:'9px 0', borderRadius:8, border:'none',
                  background: (viewedPlayer%2) === t ? 'rgba(255,215,0,.15)' : 'transparent',
                  color: (viewedPlayer%2) === t ? '#FFD700' : '#9CA3AF',
                  fontSize:11, fontWeight:'bold', cursor:'pointer',
                  transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:6
                }}>
                  {t === 0 ? 'Team A (P1+P3)' : 'Team B (P2+P4)'}
                  {(turn%2) === t && <span style={{width:6,height:6,borderRadius:'50%',background:TEAM_CLR[t],boxShadow:`0 0 6px ${TEAM_CLR[t]}`}}/>}
                </button>
              ))
            )
          )}
        </div>
      )}

      {netScreen === 'lobby' && (
        <div style={{display:'flex',flexDirection:'column',gap:16,width:'100%',maxWidth:380,alignItems:'center'}}>
          <div style={{background:'rgba(0,0,0,.4)', border:'2px solid rgba(255,215,0,.3)', borderRadius:16, padding:16, width:'100%'}}>
            <div style={{color:'#9CA3AF', fontSize:11, letterSpacing:2, marginBottom:12}}>GAME LOBBY · {gameMode} MODE</div>
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {players.map(p => (
                <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,.05)', padding:'8px 12px', borderRadius:10}}>
                  <span style={{color:P_CLR[p.idx], fontWeight:'bold', fontSize:14}}>{p.name} {p.idx === myPlayerIdx && '(YOU)'}</span>
                  <span style={{fontSize:10, color:'#6EAB80'}}>● Ready</span>
                </div>
              ))}
              {Array.from({length: (gameMode==='2v2'?4:gameMode==='1v1v1'?3:2) - players.length}).map((_, i) => (
                <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,.2)', padding:'8px 12px', borderRadius:10, border:'1px dashed rgba(255,255,255,.1)'}}>
                  <span style={{color:'#6B7280', fontSize:13}}>Waiting for player…</span>
                </div>
              ))}
            </div>
          </div>
          {netMode === 'host' ? (
            <button onClick={() => {
              connsRef.current.forEach(c => c.send({ type: 'start' }));
              setNetScreen('playing');
              startGame();
            }} style={{
              padding:'16px 0',borderRadius:12,border:'none', width:'100%',
              background:'linear-gradient(135deg,#FFD700,#FF8C00)',color:'#1A1A2E',fontSize:15,fontWeight:'bold',
              cursor:'pointer',fontFamily:'Georgia,serif',
            }}>🚀 Start Game</button>
          ) : (
            <p style={{color:'#6EAB80',fontSize:12,animation:'glow 2s infinite'}}>⏳ Waiting for host to start…</p>
          )}
          <button onClick={leaveGame} style={{
            background:'none',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,
            padding:'8px 20px',color:'#9CA3AF',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',
          }}>← Leave</button>
        </div>
      )}

      <div className="board-3col" style={{ gap: gameMode==='1v1v1' ? 8 : 14, flexDirection: isMobile ? 'column' : 'row' }}>

        {/* ── All Grids Logic ── */}
        {grids.map((g, i) => {
          // Visibility Logic
          let isVisible = false;
          if (isMobile) {
            isVisible = (viewedPlayer === i);
          } else {
            if (gameMode === '1v1') isVisible = true;
            else if (gameMode === '1v1v1') isVisible = true; // SHOW ALL 3 on Fold/Wide
            else if (gameMode === '2v2') {
              isVisible = (i % 2 === viewedPlayer % 2); // Show Teammates
            }
          }

          if (!isVisible) return null;

          return (
            <Fragment key={i}>
              <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'center',animation:'in .3s'}}>
                <PlayerGrid
                  grid={grids[i]} label={`${getPlayerNameBySlot(i)}${netMode!=='local'&&myPlayerIdx===i?' (YOU)':''}`} color={P_CLR[i]}
                  score={scores[i]} isActive={turn===i&&!gameOver}
                  canPlace={phase==='placing'&&turn===i&&!gameOver&&canIAct}
                  stealMode={isSteal && (gameMode==='2v2' ? (i%2 !== turn%2) : (i !== turn)) && canIAct}
                  onPlace={idx=>placeCard(idx)}
                  onSteal={idx=>stealCard(idx, i)}
                />
              </div>

              {/* Insert Pool in the Middle on Wide Screens */}
              {!isMobile && (
                (gameMode === '1v1' && i === 0) ||
                (gameMode === '1v1v1' && i === 1) ||
                (gameMode === '2v2' && i % 2 === 0 && i < 2)
              ) && (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, width:'auto' }}>
                  <div style={{
                    background:'rgba(0,0,0,.4)', border:'1px solid rgba(255,215,0,.22)',
                    borderRadius:14, padding:'10px 10px', textAlign:'center', width:'100%',
                    display:'flex', flexDirection:'column', alignItems:'center', gap:6
                  }}>
                    <div style={{ color:'#9CA3AF', fontSize:9, letterSpacing:1, opacity:0.8 }}>POOL ({deck.length})</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'clamp(3px,1.2vw,6px)', justifyContent:'center', alignItems:'center' }}>
                      {pool.map((card, idx) => (
                        <div key={card ? card.id : `slot-${idx}`} style={{ animation: card ? 'pop .3s ease-out' : 'none' }}>
                          {card
                            ? <CardEl card={card} size='md' glowing={phase==='picking'} selected={held?.poolIdx===idx} dimmed={held!=null && held.poolIdx!==idx && phase!=='picking'} onClick={phase==='picking'&&canIAct ? ()=>pickCard(idx) : undefined} />
                            : <div style={{ width:'clamp(36px,11.5vw,58px)', aspectRatio:'0.712', borderRadius:10, border:'2px dashed rgba(255,255,255,.1)', background:'rgba(255,255,255,.03)', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{color:'rgba(255,255,255,.12)',fontSize:20}}>—</span></div>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}

        {/* Center Pool for Mobile (Vertical stacking) */}
        {isMobile && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, width:'min(420px,94vw)' }}>
            <div style={{
              background:'rgba(0,0,0,.4)', border:'1px solid rgba(255,215,0,.22)',
              borderRadius:14, padding:'10px 8px', textAlign:'center', width:'100%',
              display:'flex', flexDirection:'column', alignItems:'center', gap:6
            }}>
              <div style={{ color:'#9CA3AF', fontSize:9, letterSpacing:1, opacity:0.8 }}>POOL ({deck.length})</div>
              <div style={{ display:'flex', flexDirection:'row', gap:'clamp(3px,1.2vw,6px)', justifyContent:'center', alignItems:'center' }}>
                {pool.map((card, idx) => (
                  <div key={card ? card.id : `slot-${idx}`} style={{ animation: card ? 'pop .3s ease-out' : 'none' }}>
                    {card
                      ? <CardEl card={card} size='lg' glowing={phase==='picking'} selected={held?.poolIdx===idx} dimmed={held!=null && held.poolIdx!==idx && phase!=='picking'} onClick={phase==='picking'&&canIAct ? ()=>pickCard(idx) : undefined} />
                      : <div style={{ width:'clamp(40px,13vw,66px)', aspectRatio:'0.712', borderRadius:10, border:'2px dashed rgba(255,255,255,.1)', background:'rgba(255,255,255,.03)', display:'flex', alignItems:'center', justifyContent:'center' }}><span style={{color:'rgba(255,255,255,.12)',fontSize:20}}>—</span></div>
                    }
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status — hidden during the plain "pick a card" phase; the active
          player's name pill and grid glow already show whose turn it is.
          Kept only when it holds an actual control (Joker picker, held card,
          steal prompt, game over). */}
      {phase !== 'picking' && (
      <div style={{
        background:'rgba(0,0,0,.45)',
        border:`1px solid ${isSteal?'rgba(255,107,53,.5)':isWild?'rgba(255,215,0,.5)':'rgba(255,215,0,.25)'}`,
        borderRadius:12, padding:'9px 22px', marginTop:16, marginBottom:16, textAlign:'center',
        animation: gameOver ? 'none' : isSteal ? 'stGlow 1.5s infinite' : isWild ? 'glow 2s infinite' : 'glow 2s infinite',
        minWidth:'min(300px, 100%)', maxWidth:'94vw',
      }}>
        {phase !== 'placing' && (
          <div style={{color:isSteal?'#FF6B35':isWild?'#FFD700':turnClr,fontSize:14,fontWeight:'bold'}}>{phaseMsg}</div>
        )}
        {isWild && !wildSelection && (canIAct ? (
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
            <div style={{color:'#9CA3AF',fontSize:11}}>Step 1 — Choose a Suit:</div>
            <div style={{display:'flex',gap:6,justifyContent:'center',flexWrap:'wrap'}}>
              {[
                {suit:'♠',color:'#E5E7EB',name:'Spades (Black)'},
                {suit:'♥',color:'#C0392B',name:'Hearts (Red)'},
                {suit:'♦',color:'#C0392B',name:'Diamonds (Red)'},
                {suit:'♣',color:'#E5E7EB',name:'Clubs (Black)'},
              ].map(s=>(
                <button key={s.suit} onClick={()=>selectWildSuit(s.suit)} style={{
                  padding:'8px 14px',borderRadius:6,border:'2px solid '+s.color+'80',
                  background:s.color+'15',color:s.color,fontSize:15,fontWeight:'bold',
                  cursor:'pointer',transition:'all .2s',title:s.name,
                }}
                  onMouseEnter={e=>{ e.currentTarget.style.background=s.color+'30'; e.currentTarget.style.boxShadow=`0 0 10px ${s.color}40`; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background=s.color+'15'; e.currentTarget.style.boxShadow='none'; }}
                >{s.suit}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{marginTop:10,color:'#6B7280',fontSize:11,fontStyle:'italic'}}>⏳ Waiting for opponent…</div>
        ))}
        {isWild && wildSelection && canIAct && (
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
            <div style={{color:'#9CA3AF',fontSize:11}}>
              Step 2 — Choose a Value for <span style={{color: RED.has(wildSelection.suit)?'#C0392B':'#fff'}}>{wildSelection.suit}</span>:
            </div>
            <div style={{display:'flex',gap:5,justifyContent:'center',flexWrap:'wrap',maxWidth:260}}>
              {VALUES.map(v=>(
                <button key={v} onClick={()=>selectWildValue(v)} style={{
                  padding:'6px 9px',borderRadius:6,border:'2px solid rgba(255,215,0,.5)',
                  background:'rgba(255,215,0,.1)',color:'#FFD700',fontSize:13,fontWeight:'bold',
                  cursor:'pointer',transition:'all .2s',
                }}
                  onMouseEnter={e=>{ e.currentTarget.style.background='rgba(255,215,0,.28)'; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background='rgba(255,215,0,.1)'; }}
                >{v}</button>
              ))}
            </div>
            <button onClick={cancelWildSuit} style={{
              alignSelf:'center',background:'none',border:'none',color:'#6B7280',
              fontSize:10,cursor:'pointer',textDecoration:'underline',fontFamily:'Georgia,serif',
            }}>← back to suit</button>
          </div>
        )}
      {held && phase==='placing' && (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <div style={{color:turnClr,fontSize:13,fontWeight:'bold'}}>
              {turn===0?'Player 1 🔵':'Player 2 🔴'}
            </div>
            {canIAct ? (
              <>
                <div style={{color:'#9CA3AF',fontSize:11}}>
                  Holding: <span style={{color:'#FFD700'}}>{held.card.value+held.card.suit}</span>{held.card.fromWild && <span style={{color:'#6B7280'}}> (from 🃏)</span>} → click your grid
                </div>
                {held.fromSteal
                  ? <div style={{color:'#6B7280',fontSize:9,fontStyle:'italic'}}>Stolen card — must be placed</div>
                  : <button onClick={unselectCard} style={{
                      padding:'4px 10px',borderRadius:4,border:'1px solid #FFD700',
                      background:'rgba(255,215,0,.1)',color:'#FFD700',fontSize:10,cursor:'pointer',
                      fontFamily:'Georgia,serif',transition:'all .2s',
                    }}
                      onMouseEnter={e=>{ e.currentTarget.style.background='rgba(255,215,0,.2)'; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background='rgba(255,215,0,.1)'; }}
                    >✕ Unselect Card</button>
                }
              </>
            ) : (
              <div style={{color:'#6B7280',fontSize:11,fontStyle:'italic'}}>⏳ Opponent is placing their card…</div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Game Over */}
      {gameOver && (
        <div style={{
          marginTop:24,background:'rgba(0,0,0,.55)',
          border:'2px solid rgba(255,215,0,.4)',borderRadius:20,
          padding:'22px 30px',textAlign:'center',animation:'in .5s',
          width: 'min(500px, 94vw)'
        }}>
          <div style={{color:'#9CA3AF',fontSize:11,letterSpacing:3,marginBottom:14}}>FINAL SCORES</div>
          <div style={{display:'flex',gap:12,justifyContent:'center',alignItems:'flex-start',flexWrap:'wrap'}}>
            {gameMode === '1v1' || gameMode === '1v1v1' ? (
              [0,1,2].map(p => {
                if (gameMode==='1v1' && p>1) return null;
                const g = grade(finalSc[p]);
                return (
                  <div key={p} style={{textAlign:'center', minWidth:80, padding:8, background:'rgba(255,255,255,.05)', borderRadius:12}}>
                    <div style={{color:P_CLR[p],fontSize:12,fontWeight:'bold',marginBottom:4}}>P{p+1}</div>
                    <div style={{color:gClr[g]||'#6B7280',fontSize:44,fontWeight:'bold',lineHeight:1}}>{g}</div>
                    <div style={{color:'#FFD700',fontSize:24,fontWeight:'bold'}}>{finalSc[p]}</div>
                  </div>
                );
              })
            ) : (
              <>
                <div style={{textAlign:'center', border:'1px solid rgba(75,158,255,.3)', padding:8, borderRadius:12}}>
                  <div style={{color:TEAM_CLR[0],fontSize:12,fontWeight:'bold',marginBottom:4}}>TEAM A</div>
                  <div style={{color:'#FFD700',fontSize:32,fontWeight:'bold'}}>{finalSc[0] + finalSc[2]}</div>
                  <div style={{display:'flex', gap:10, fontSize:10, color:'#9CA3AF', marginTop:4}}>
                    <span>P1: {finalSc[0]}</span>
                    <span>P3: {finalSc[2]}</span>
                  </div>
                </div>
                <div style={{fontSize:24, color:'#6B7280', alignSelf:'center'}}>vs</div>
                <div style={{textAlign:'center', border:'1px solid rgba(255,95,95,.3)', padding:8, borderRadius:12}}>
                  <div style={{color:TEAM_CLR[1],fontSize:12,fontWeight:'bold',marginBottom:4}}>TEAM B</div>
                  <div style={{color:'#FFD700',fontSize:32,fontWeight:'bold'}}>{finalSc[1] + finalSc[3]}</div>
                  <div style={{display:'flex', gap:10, fontSize:10, color:'#9CA3AF', marginTop:4}}>
                    <span>P2: {finalSc[1]}</span>
                    <span>P4: {finalSc[3]}</span>
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{marginTop:16,fontSize:22,color:'#FFD700',fontWeight:'bold'}}>
            {gameMode === '1v1' ? (
               finalSc[0]>finalSc[1]?'🏆 Player 1 Wins!':finalSc[1]>finalSc[0]?'🏆 Player 2 Wins!':'🤝 Tie Game!'
            ) : gameMode === '1v1v1' ? (
               finalSc[0]>finalSc[1] && finalSc[0]>finalSc[2] ? '🏆 Player 1 Wins!' :
               finalSc[1]>finalSc[0] && finalSc[1]>finalSc[2] ? '🏆 Player 2 Wins!' :
               finalSc[2]>finalSc[0] && finalSc[2]>finalSc[1] ? '🏆 Player 3 Wins!' : '🤝 Tie Game!'
            ) : (
               (finalSc[0]+finalSc[2]) > (finalSc[1]+finalSc[3]) ? '🏆 Team A Wins!' : (finalSc[1]+finalSc[3]) > (finalSc[0]+finalSc[2]) ? '🏆 Team B Wins!' : '🤝 Tie Game!'
            )}
          </div>
          <button onClick={startGame} style={{
            marginTop:16,background:'linear-gradient(135deg,#FFD700,#FF8C00)',
            border:'none',borderRadius:10,padding:'12px 36px',
            color:'#1A1A2E',fontWeight:'bold',fontSize:15,cursor:'pointer',
            fontFamily:'Georgia,serif',letterSpacing:1,
          }}>▶ Play Again</button>
          {netScreen === 'lobby' && (
            <div style={{display:'flex',flexDirection:'column',gap:16,width:'100%',alignItems:'center'}}>
              <div style={{background:'rgba(0,0,0,.4)', border:'2px solid rgba(255,215,0,.3)', borderRadius:16, padding:16, width:'100%'}}>
                <div style={{color:'#9CA3AF', fontSize:11, letterSpacing:2, marginBottom:12}}>GAME LOBBY · {gameMode} MODE</div>
                <div style={{display:'flex', flexDirection:'column', gap:8}}>
                  {players.map(p => (
                    <div key={p.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,.05)', padding:'8px 12px', borderRadius:10}}>
                      <span style={{color:P_CLR[p.idx], fontWeight:'bold', fontSize:14}}>{p.name} {p.idx === myPlayerIdx && '(YOU)'}</span>
                      <span style={{fontSize:10, color:'#6EAB80'}}>● Ready</span>
                    </div>
                  ))}
                  {Array.from({length: (gameMode==='2v2'?4:gameMode==='1v1v1'?3:2) - players.length}).map((_, i) => (
                    <div key={i} style={{display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(0,0,0,.2)', padding:'8px 12px', borderRadius:10, border:'1px dashed rgba(255,255,255,.1)'}}>
                      <span style={{color:'#6B7280', fontSize:13}}>Waiting for player…</span>
                    </div>
                  ))}
                </div>
              </div>

              {netMode === 'host' ? (
                <button onClick={() => {
                  connsRef.current.forEach(c => c.send({ type: 'start' }));
                  setNetScreen('playing');
                  startGame();
                }} style={{
                  padding:'16px 0',borderRadius:12,border:'none', width:'100%',
                  background:'linear-gradient(135deg,#FFD700,#FF8C00)',color:'#1A1A2E',fontSize:15,fontWeight:'bold',
                  cursor:'pointer',fontFamily:'Georgia,serif',
                }}>🚀 Start Game</button>
              ) : (
                <p style={{color:'#6EAB80',fontSize:12,animation:'glow 2s infinite'}}>⏳ Waiting for host to start…</p>
              )}

              <button onClick={leaveGame} style={{
                background:'none',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,
                padding:'8px 20px',color:'#9CA3AF',fontSize:12,cursor:'pointer',fontFamily:'Georgia,serif',
              }}>← Leave</button>
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}
