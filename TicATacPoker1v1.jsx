import { useState, useEffect, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const SUITS  = ['♠','♥','♦','♣'];
const VALUES = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const VNUM   = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14};
const RED    = new Set(['♥','♦']);
const P_CLR  = ['#4B9EFF','#FF5F5F'];

function buildDeck() {
  const deck = [];
  for (const s of SUITS)
    for (const v of VALUES)
      deck.push({ suit:s, value:v, id:`${v}${s}`, wild:false, steal:false, remove:false });
  deck.push({ suit:'★', value:'JK', id:'JK1', wild:true,  label:'WILD', steal:false,  remove:false  });
  deck.push({ suit:'★', value:'JK', id:'JK2', wild:true,  label:'WILD', steal:false,  remove:false  });
  deck.push({ suit:'⚡', value:'ST', id:'ST1', steal:true, label:'STEAL', wild:false, remove:false });
  deck.push({ suit:'🗑', value:'RM', id:'RM1', remove:true, label:'REMOVE', wild:false, steal:false });
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
function evaluate3(cards) {
  if (!cards || cards.length !== 3 || cards.some(c => !c))
    return { rank:0, name:'—', score:0, emoji:'' };
  const naturals = cards.filter(c => !c.wild);
  const wilds    = cards.filter(c =>  c.wild);
  if (wilds.length === 3) return { rank:9, name:'3 Wilds!', score:200, emoji:'🃏' };
  if (wilds.length > 0) {
    let best = { rank:0, name:'High Card', score:0, emoji:'🃏' };
    for (const s of SUITS) for (const v of VALUES) {
      const sub = [...naturals, {suit:s,value:v}];
      if (wilds.length === 2) {
        for (const s2 of SUITS) for (const v2 of VALUES) {
          const r = scoreHand([...naturals,{suit:s,value:v},{suit:s2,value:v2}]);
          if (r.rank > best.rank) best = r;
        }
      } else {
        const r = scoreHand(sub);
        if (r.rank > best.rank) best = r;
      }
    }
    return best;
  }
  return scoreHand(cards);
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
  if (isRoyal)              return { rank:8, name:'Mini Royal',      score:150, emoji:'👑' };
  if (isFlush && isStraight)return { rank:7, name:'Straight Flush',  score:100, emoji:'🔥' };
  if (cv[0]===3)            return { rank:6, name:'Three of a Kind', score:60,  emoji:'🎯' };
  if (isStraight)           return { rank:5, name:'Straight',        score:30,  emoji:'📈' };
  if (isFlush)              return { rank:4, name:'Flush',           score:25,  emoji:'💧' };
  if (cv[0]===2)            return { rank:3, name:'Pair',            score:10,  emoji:'✌️' };
  return                    { rank:1, name:'High Card',              score:0,   emoji:'🃏' };
}

function getLines(grid) {
  return [
    {cells:[0,1,2],label:'Row 1'},{cells:[3,4,5],label:'Row 2'},{cells:[6,7,8],label:'Row 3'},
    {cells:[0,3,6],label:'Col 1'},{cells:[1,4,7],label:'Col 2'},{cells:[2,5,8],label:'Col 3'},
    {cells:[0,4,8],label:'Diag ↘'},{cells:[2,4,6],label:'Diag ↗'},
  ].map(l => ({ ...l, cards:l.cells.map(i=>grid[i]), ...evaluate3(l.cells.map(i=>grid[i])) }));
}

function totalScore(grid) {
  return getLines(grid).reduce((s,l) => s + (l.cards.every(Boolean) ? l.score : 0), 0);
}

const HAND_CLR = {
  'Mini Royal':'#FFD700','Straight Flush':'#FF6B35','Three of a Kind':'#E74C3C',
  'Straight':'#A855F7','Flush':'#3B82F6','Pair':'#10B981','High Card':'#6B7280','—':'#374151',
};

// ─── Card Visual ──────────────────────────────────────────────────────────────
function CardEl({ card, onClick, glowing, dimmed, selected, size='md' }) {
  if (!card) return null;
  const isRed = RED.has(card.suit);
  const sp    = card.wild || card.steal || card.remove;
  const d     = size==='sm' ? {w:44,h:62,fs:10,sf:16}
              : size==='lg' ? {w:74,h:104,fs:13,sf:30}
                            : {w:62,h:86,fs:11,sf:22};
  const bg  = card.wild   ? 'linear-gradient(145deg,#1a1a2e,#16213e)'
            : card.steal  ? 'linear-gradient(145deg,#2d1b4e,#1a0f2e)'
            : card.remove ? 'linear-gradient(145deg,#3d2d1b,#2d1f10)'
                          : 'linear-gradient(145deg,#fff,#f0f0f0)';
  const clr = card.wild   ? '#FFD700'
            : card.steal  ? '#FF6B35'
            : card.remove ? '#D4691E'
            : isRed       ? '#C0392B'
                          : '#1a1a2e';
  return (
    <div onClick={onClick} style={{
      width:d.w, height:d.h, background:bg, borderRadius:7, flexShrink:0,
      boxShadow: selected ? `0 0 0 3px #FFD700,0 6px 20px rgba(0,0,0,.5)`
               : glowing  ? `0 0 14px 3px rgba(255,210,0,.55),0 3px 10px rgba(0,0,0,.4)`
                          : `0 3px 8px rgba(0,0,0,.4)`,
      border: selected ? '1px solid #FFD700' : '1px solid rgba(255,255,255,.2)',
      opacity: dimmed ? .45 : 1,
      cursor: onClick ? 'pointer' : 'default',
      position:'relative', fontFamily:'Georgia,serif', userSelect:'none',
      color:clr, overflow:'hidden', transition:'transform .15s,box-shadow .15s',
    }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.transform='scale(1.09) translateY(-4px)'; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform=''; }}
    >
      <div style={{position:'absolute',top:3,left:4,lineHeight:1,fontSize:d.fs,fontWeight:'bold'}}>
        {sp ? <span style={{fontSize:d.fs-1}}>{card.label}</span>
            : <><div>{card.value}</div><div style={{marginTop:-1}}>{card.suit}</div></>}
      </div>
      <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',fontSize:d.sf,opacity:.9}}>
        {card.wild ? '🃏' : card.steal ? '⚡' : card.remove ? '🗑' : card.suit}
      </div>
      {!sp && <div style={{position:'absolute',bottom:3,right:4,lineHeight:1,fontSize:d.fs,fontWeight:'bold',transform:'rotate(180deg)'}}>
        <div>{card.value}</div><div style={{marginTop:-1}}>{card.suit}</div>
      </div>}
      <div style={{position:'absolute',top:0,left:0,right:0,height:'38%',
        background:'linear-gradient(to bottom,rgba(255,255,255,.18),transparent)',
        borderRadius:'7px 7px 0 0',pointerEvents:'none'}}/>
    </div>
  );
}

function EmptyCell({ onClick, canPlace }) {
  return (
    <div onClick={canPlace ? onClick : undefined}
      style={{
        width:62, height:86, borderRadius:7,
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

function PlayerGrid({ grid, onPlace, canPlace, stealMode, onSteal, removeMode, onRemove, isActive, label, score, color }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
      <div style={{
        padding:'4px 16px', borderRadius:20,
        background: isActive ? `${color}28` : 'rgba(255,255,255,.05)',
        border: isActive ? `1px solid ${color}80` : '1px solid rgba(255,255,255,.1)',
        color: isActive ? color : '#9CA3AF',
        fontSize:13, letterSpacing:2, fontWeight:'bold',
        transition:'all .3s',
      }}>{label}</div>

      <div style={{
        background:'rgba(0,0,0,.28)',
        border: isActive ? `2px solid ${color}50` : '2px solid rgba(255,255,255,.08)',
        borderRadius:18, padding:14,
        boxShadow: isActive ? `0 0 30px ${color}20` : 'none',
        transition:'all .3s',
      }}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,62px)',gridTemplateRows:'repeat(3,86px)',gap:8}}>
          {grid.map((card,i) => (
            <div key={i} style={{position:'relative'}}>
              {card
                ? <>
                    <CardEl card={card} size='md' />
                    {stealMode && (
                      <div onClick={() => onSteal(i)} style={{
                        position:'absolute', inset:0, borderRadius:7, cursor:'pointer',
                        background:'rgba(255,107,53,.35)', border:'2px solid #FF6B35',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:26, animation:'stGlow 1.2s infinite',
                      }}>⚡</div>
                    )}
                    {removeMode && (
                      <div onClick={() => onRemove(i)} style={{
                        position:'absolute', inset:0, borderRadius:7, cursor:'pointer',
                        background:'rgba(212,105,30,.35)', border:'2px solid #D4691E',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:26, animation:'rmGlow 1.2s infinite',
                      }}>🗑</div>
                    )}
                  </>
                : <EmptyCell canPlace={canPlace} onClick={() => onPlace(i)} />
              }
            </div>
          ))}
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
            const done = l.cards.every(Boolean);
            const c = done ? (HAND_CLR[l.name]||'#6B7280') : '#374151';
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', padding:'3px 6px', borderRadius:4, marginBottom:2,
                background: done&&l.score>0 ? `${c}15` : 'transparent',
                borderLeft: done&&l.score>0 ? `3px solid ${c}` : '3px solid transparent',
              }}>
                <span style={{color:'#9CA3AF',fontSize:9,width:44}}>{l.label}</span>
                <span style={{color:c,fontSize:9,flex:1}}>{done ? `${l.emoji} ${l.name}` : '—'}</span>
                <span style={{color:c,fontSize:10,fontWeight:'bold'}}>{done&&l.score>0 ? `+${l.score}` : ''}</span>
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
  const [deck,     setDeck]     = useState([]);
  const [pool,     setPool]     = useState([null, null, null]); // always 3
  const [grids,    setGrids]    = useState([Array(9).fill(null), Array(9).fill(null)]);
  const [turn,     setTurn]     = useState(0);   // 0 = P1, 1 = P2
  const [phase,    setPhase]    = useState('picking'); // picking | placing | steal | wild-select
  const [held,     setHeld]     = useState(null);  // { card, poolIdx, fromSteal, fromRemove }
  const [stealTarget, setStealTarget] = useState(null); // which player's grid to steal from (0 or 1)
  const [wildSelection, setWildSelection] = useState(null); // { color, symbol }
  const [gameOver, setGameOver] = useState(false);
  const [finalSc,  setFinalSc]  = useState([0,0]);
  const [log,      setLog]      = useState([]);

  const addLog = useCallback((msg, clr='#D1D5DB') => {
    setLog(p => [{msg,clr,id:Date.now()+Math.random()}, ...p].slice(0,50));
  },[]);

  // Pull next card from deck into a pool slot
  const refill = (poolArr, deckArr, slotIdx) => {
    const p = [...poolArr], d = [...deckArr];
    p[slotIdx] = d.length > 0 ? d.shift() : null;
    return { pool:p, deck:d };
  };

  const startGame = useCallback(() => {
    const d = buildDeck();
    const p = [null, null, null];
    const rem = [...d];
    for (let i=0; i<3; i++) if (rem.length) p[i] = rem.shift();
    setDeck(rem); setPool(p);
    setGrids([Array(9).fill(null), Array(9).fill(null)]);
    setTurn(0); setPhase('picking'); setHeld(null); setStealTarget(null); setWildSelection(null);
    setGameOver(false); setFinalSc([0,0]); setLog([]);
    addLog('🃏 New game! Player 1 picks first.','#FFD700');
  }, [addLog]);

  useEffect(() => { startGame(); }, []);

  // ── Pick a card from the pool ──
  const pickCard = (poolIdx) => {
    if (phase !== 'picking' || gameOver || !pool[poolIdx]) return;
    const card = pool[poolIdx];
    setHeld({ card, poolIdx, fromSteal: false, fromRemove: false });

    if (card.steal) {
      // Ask which player's grid to steal from — opposite player's grid
      const opponent = 1 - turn;
      setStealTarget(opponent);
      setPhase('steal');
      addLog(`⚡ ${turn===0?'P1':'P2'} grabbed STEAL — click a card on opponent's grid!`, '#FF6B35');
    } else if (card.remove) {
      // Remove mode: player clicks one of their own cards to delete it
      setPhase('remove-own');
      addLog(`🗑 ${turn===0?'P1':'P2'} grabbed REMOVE — click one of your own cards to delete!`, '#D4691E');
    } else if (card.wild) {
      setPhase('wild-select');
      addLog(`${turn===0?'🔵 P1':'🔴 P2'} picked 🃏 WILD — choose color and symbol!`, P_CLR[turn]);
    } else {
      setPhase('placing');
      addLog(`${turn===0?'🔵 P1':'🔴 P2'} picked ${card.value+card.suit}.`, P_CLR[turn]);
    }
  };

  // ── Select wild card properties ──
  const selectWild = (symbol) => {
    if (phase !== 'wild-select' || !held || gameOver) return;
    // symbolColor is determined by the symbol itself
    const updatedCard = { ...held.card, suit: symbol };
    setHeld({ ...held, card: updatedCard });
    setPhase('placing');
    addLog(`${turn===0?'🔵 P1':'🔴 P2'} set WILD to ${symbol}.`, P_CLR[turn]);
    setWildSelection(null);
  };

  // ── Place held card on own grid ──
  const placeCard = (cellIdx) => {
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
      return;
    }

    advanceTurn(newPool, newDeck, newGrids);
  };

  // ── Remove a card from opponent's grid ──
  const stealCard = (cellIdx) => {
    if (phase !== 'steal' || stealTarget === null || !held || gameOver) return;
    if (!grids[stealTarget][cellIdx]) return;

    const stolen = grids[stealTarget][cellIdx];
    const newGrids = grids.map(g => [...g]);
    newGrids[stealTarget][cellIdx] = null;

    const { pool:newPool, deck:newDeck } = refill(pool, deck, held.poolIdx);
    setGrids(newGrids); setPool(newPool); setDeck(newDeck);
    addLog(`⚡ ${turn===0?'🔵 P1':'🔴 P2'} STOLE ${stolen.wild?'WILD':stolen.value+stolen.suit} from opponent!`, '#FF6B35');

    // Now the stolen card is held and player must place it on their own grid
    setHeld({ card: stolen, poolIdx: null, fromSteal: true, fromRemove: false });
    setPhase('placing');
    setStealTarget(null);
  };

  // ── Remove one of your own cards ──
  const removeOwnCard = (cellIdx) => {
    if (phase !== 'remove-own' || !held || gameOver) return;
    if (!grids[turn][cellIdx]) return;

    const deleted = grids[turn][cellIdx];
    const newGrids = grids.map(g => [...g]);
    newGrids[turn][cellIdx] = null;

    const { pool:newPool, deck:newDeck } = refill(pool, deck, held.poolIdx);
    setGrids(newGrids); setPool(newPool); setDeck(newDeck);
    addLog(`🗑 ${turn===0?'🔵 P1':'🔴 P2'} DELETED their own ${deleted.wild?'WILD':deleted.value+deleted.suit}!`, '#D4691E');

    // Remove action is complete, advance turn
    const bothFull = newGrids.every(g => g.every(Boolean));
    if (bothFull) {
      const sc = newGrids.map(g => totalScore(g));
      setFinalSc(sc); setGameOver(true); setPhase('over'); setHeld(null);
      addLog(`🏁 Game over! P1: ${sc[0]} | P2: ${sc[1]}`, '#FFD700');
      addLog(sc[0]>sc[1]?'🏆 Player 1 wins!':sc[1]>sc[0]?'🏆 Player 2 wins!':'🤝 Tie!', '#FFD700');
      return;
    }
    advanceTurn(newGrids, newPool, newDeck);
  };

  const advanceTurn = (newPool, newDeck, newGrids) => {
    const nextTurn = 1 - turn;
    // Check if next player still has empty cells; if both full, end game
    const bothFull = newGrids.every(g => g.every(Boolean));
    if (bothFull) {
      const sc = newGrids.map(g => totalScore(g));
      setFinalSc(sc); setGameOver(true); setPhase('over'); setHeld(null);
      return;
    }
    setTurn(nextTurn); setPhase('picking'); setHeld(null); setStealTarget(null);
  };

  const scores = grids.map(g => totalScore(g));
  const lines  = grids.map(g => getLines(g));

  const grade  = s => s>=400?'S':s>=260?'A':s>=160?'B':s>=90?'C':s>=45?'D':'F';
  const gClr   = {S:'#FFD700',A:'#FF6B35',B:'#A855F7',C:'#3B82F6',D:'#10B981',F:'#6B7280'};

  const isSteal   = phase === 'steal';
  const isRemove  = phase === 'remove-own';
  const isWild    = phase === 'wild-select';
  const turnClr   = P_CLR[turn];
  const phaseMsg  = phase==='picking'  ? `${turn===0?'Player 1 🔵':'Player 2 🔴'} — choose a card from the pool`
                  : phase==='placing'  ? `${turn===0?'Player 1 🔵':'Player 2 🔴'} — place your card on your grid`
                  : phase==='wild-select' ? `${turn===0?'Player 1 🔵':'Player 2 🔴'} — choose wild card color and symbol`
                  : phase==='steal'    ? `${turn===0?'Player 1 🔵':'Player 2 🔴'} — click a card on the opponent's grid to steal!`
                  : phase==='remove-own'   ? `${turn===0?'Player 1 🔵':'Player 2 🔴'} — click one of your own cards to delete!`
                  : 'Game Over';

  return (
    <div style={{
      minHeight:'100vh',
      background:'radial-gradient(ellipse at 50% 0%,#1B5E3A 0%,#0F3D22 40%,#061A0F 100%)',
      display:'flex', flexDirection:'column', alignItems:'center',
      padding:'20px 12px 40px', fontFamily:"Georgia,'Times New Roman',serif",
    }}>
      <style>{`
        @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(255,215,0,.2);}50%{box-shadow:0 0 28px rgba(255,215,0,.6);}}
        @keyframes stGlow{0%,100%{box-shadow:0 0 10px rgba(255,107,53,.3);}50%{box-shadow:0 0 28px rgba(255,107,53,.8);}}
        @keyframes rmGlow{0%,100%{box-shadow:0 0 10px rgba(212,105,30,.3);}50%{box-shadow:0 0 28px rgba(212,105,30,.8);}}
        @keyframes in{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pop{0%{transform:scale(.75);}60%{transform:scale(1.08);}100%{transform:scale(1);}}
      `}</style>

      {/* Title */}
      <h1 style={{margin:'0 0 4px',fontSize:'clamp(1.4rem,4vw,2.3rem)',color:'#FFD700',
        letterSpacing:4,textShadow:'0 0 28px rgba(255,215,0,.45)',fontStyle:'italic',textAlign:'center'}}>
        ♠ TIC-A-TAC POKER ♠
      </h1>
      <p style={{color:'#6EAB80',margin:'0 0 14px',fontSize:10,letterSpacing:2,textAlign:'center'}}>
        LOCAL 1v1 · EACH PLAYER HAS THEIR OWN GRID · SHARED 3-CARD POOL · WILD & STEAL CARDS
      </p>

      {/* Status */}
      <div style={{
        background:'rgba(0,0,0,.45)',
        border:`1px solid ${isSteal?'rgba(255,107,53,.5)':isRemove?'rgba(212,105,30,.5)':isWild?'rgba(255,215,0,.5)':'rgba(255,215,0,.25)'}`,
        borderRadius:12, padding:'9px 22px', marginBottom:16, textAlign:'center',
        animation: gameOver ? 'none' : isSteal ? 'stGlow 1.5s infinite' : isRemove ? 'rmGlow 1.5s infinite' : isWild ? 'glow 2s infinite' : 'glow 2s infinite',
        minWidth:300,
      }}>
        <div style={{color:isSteal?'#FF6B35':isRemove?'#D4691E':isWild?'#FFD700':turnClr,fontSize:14,fontWeight:'bold'}}>{phaseMsg}</div>
        {isWild && (
          <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
            <div style={{color:'#9CA3AF',fontSize:11}}>Choose a Symbol:</div>
            <div style={{display:'flex',gap:6,justifyContent:'center',flexWrap:'wrap'}}>
              {[
                {suit:'♠',color:'#1a1a2e',name:'Spades (Black)'},
                {suit:'♥',color:'#C0392B',name:'Hearts (Red)'},
                {suit:'♦',color:'#C0392B',name:'Diamonds (Red)'},
                {suit:'♣',color:'#1a1a2e',name:'Clubs (Black)'},
              ].map(s=>(
                <button key={s.suit} onClick={()=>selectWild(s.suit)} style={{
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
        )}
        {held && phase==='placing' && (
          <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
            <div style={{color:'#9CA3AF',fontSize:11}}>
              Holding: <span style={{color:'#FFD700'}}>{held.card.wild?'🃏 WILD':held.card.value+held.card.suit}</span> → click your grid
            </div>
            <button onClick={unselectCard} style={{
              padding:'4px 10px',borderRadius:4,border:'1px solid #FFD700',
              background:'rgba(255,215,0,.1)',color:'#FFD700',fontSize:10,cursor:'pointer',
              fontFamily:'Georgia,serif',transition:'all .2s',
            }}
              onMouseEnter={e=>{ e.currentTarget.style.background='rgba(255,215,0,.2)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.background='rgba(255,215,0,.1)'; }}
            >✕ Unselect Card</button>
          </div>
        )}
        <div style={{color:'#6EAB80',fontSize:10,marginTop:2}}>{deck.length} cards left in deck</div>
      </div>

      <div style={{display:'flex',gap:14,flexWrap:'wrap',justifyContent:'center',alignItems:'flex-start'}}>

        {/* ── P1 Grid + Lines ── */}
        <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'center'}}>
          <PlayerGrid
            grid={grids[0]} label="PLAYER 1" color={P_CLR[0]}
            score={scores[0]} isActive={turn===0&&!gameOver}
            canPlace={phase==='placing'&&turn===0&&!gameOver}
            stealMode={isSteal&&stealTarget===0}
            removeMode={isRemove&&turn===0}
            onPlace={i=>placeCard(i)}
            onSteal={i=>stealCard(i)}
            onRemove={i=>removeOwnCard(i)}
          />
          <LinePanel lines={lines[0]} color={P_CLR[0]} />
        </div>

        {/* ── Center Pool + Controls ── */}
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,width:200}}>

          {/* Pool */}
          <div style={{
            background:'rgba(0,0,0,.4)',border:'1px solid rgba(255,215,0,.22)',
            borderRadius:14,padding:'12px 14px',textAlign:'center',width:'100%',
          }}>
            <div style={{color:'#9CA3AF',fontSize:10,letterSpacing:2,marginBottom:10}}>
              CARD POOL · ALWAYS 3
            </div>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              {pool.map((card,i) => (
                <div key={card?card.id:`slot-${i}`} style={{animation:card?'pop .3s ease-out':'none'}}>
                  {card
                    ? <CardEl card={card} size='lg'
                        glowing={phase==='picking'}
                        selected={held?.poolIdx===i}
                        dimmed={held!=null && held.poolIdx!==i && phase!=='picking'}
                        onClick={phase==='picking' ? ()=>pickCard(i) : undefined}
                      />
                    : <div style={{width:74,height:104,borderRadius:7,
                        border:'2px dashed rgba(255,255,255,.1)',
                        background:'rgba(255,255,255,.03)',
                        display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{color:'rgba(255,255,255,.12)',fontSize:20}}>—</span>
                      </div>
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Restart */}
          <button onClick={startGame} style={{
            background:'linear-gradient(135deg,#FFD700,#FF8C00)',border:'none',
            borderRadius:10,padding:'10px 0',width:'100%',
            color:'#1A1A2E',fontWeight:'bold',fontSize:13,cursor:'pointer',
            letterSpacing:1,fontFamily:'Georgia,serif',
            boxShadow:'0 4px 18px rgba(255,215,0,.3)',transition:'transform .1s',
          }}
            onMouseEnter={e=>e.currentTarget.style.transform='scale(1.02)'}
            onMouseLeave={e=>e.currentTarget.style.transform=''}
          >{gameOver?'▶ New Game':'↺ Restart'}</button>

          {/* Card legend */}
          <div style={{
            background:'rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.07)',
            borderRadius:12,padding:'10px 12px',fontSize:10,
            color:'#D1D5DB',lineHeight:1.85,width:'100%',
          }}>
            <div style={{color:'#9CA3AF',letterSpacing:1,marginBottom:4,fontSize:9}}>HANDS</div>
            {[['👑','Mini Royal',150],['🔥','Straight Flush',100],['🎯','Three of a Kind',60],
              ['📈','Straight',30],['💧','Flush',25],['✌️','Pair',10],['🃏','High Card',0]].map(([e,n,s])=>(
              <div key={n} style={{display:'flex',justifyContent:'space-between'}}>
                <span style={{color:HAND_CLR[n]||'#9CA3AF'}}>{e} {n}</span>
                <span style={{color:'#6B7280'}}>{s>0?`+${s}`:'—'}</span>
              </div>
            ))}
            <div style={{marginTop:6,borderTop:'1px solid rgba(255,255,255,.08)',paddingTop:6}}>
              <div>🃏 <span style={{color:'#FFD700'}}>WILD</span> — acts as best card</div>
              <div>⚡ <span style={{color:'#FF6B35'}}>STEAL</span> — steal opponent's card</div>
              <div>🗑 <span style={{color:'#D4691E'}}>REMOVE</span> — delete your own card</div>
            </div>
          </div>

          {/* Game log */}
          <div style={{
            background:'rgba(0,0,0,.3)',border:'1px solid rgba(255,255,255,.07)',
            borderRadius:10,padding:'8px 10px',width:'100%',maxHeight:160,overflowY:'auto',
          }}>
            <div style={{color:'#6B7280',fontSize:9,letterSpacing:2,marginBottom:4}}>GAME LOG</div>
            {log.map(l => (
              <div key={l.id} style={{color:l.clr,fontSize:11,marginBottom:2,lineHeight:1.4,animation:'in .3s'}}>{l.msg}</div>
            ))}
          </div>
        </div>

        {/* ── P2 Grid + Lines ── */}
        <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'center'}}>
          <PlayerGrid
            grid={grids[1]} label="PLAYER 2" color={P_CLR[1]}
            score={scores[1]} isActive={turn===1&&!gameOver}
            canPlace={phase==='placing'&&turn===1&&!gameOver}
            stealMode={isSteal&&stealTarget===1}
            removeMode={isRemove&&turn===1}
            onPlace={i=>placeCard(i)}
            onSteal={i=>stealCard(i)}
            onRemove={i=>removeOwnCard(i)}
          />
          <LinePanel lines={lines[1]} color={P_CLR[1]} />
        </div>
      </div>

      {/* Game Over */}
      {gameOver && (
        <div style={{
          marginTop:24,background:'rgba(0,0,0,.55)',
          border:'2px solid rgba(255,215,0,.4)',borderRadius:20,
          padding:'22px 50px',textAlign:'center',animation:'in .5s',
        }}>
          <div style={{color:'#9CA3AF',fontSize:11,letterSpacing:3,marginBottom:14}}>FINAL SCORES</div>
          <div style={{display:'flex',gap:52,justifyContent:'center',alignItems:'center'}}>
            {[0,1].map(p => {
              const g = grade(finalSc[p]);
              return (
                <div key={p} style={{textAlign:'center'}}>
                  <div style={{color:P_CLR[p],fontSize:12,fontWeight:'bold',marginBottom:4}}>
                    {p===0?'PLAYER 1 🔵':'PLAYER 2 🔴'}
                  </div>
                  <div style={{color:gClr[g]||'#6B7280',fontSize:56,fontWeight:'bold',lineHeight:1}}>{g}</div>
                  <div style={{color:'#FFD700',fontSize:32,fontWeight:'bold'}}>{finalSc[p]}</div>
                  <div style={{color:'#9CA3AF',fontSize:11}}>pts</div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:16,fontSize:22,color:'#FFD700',fontWeight:'bold'}}>
            {finalSc[0]>finalSc[1]?'🏆 Player 1 Wins!':finalSc[1]>finalSc[0]?'🏆 Player 2 Wins!':'🤝 Tie Game!'}
          </div>
          <button onClick={startGame} style={{
            marginTop:16,background:'linear-gradient(135deg,#FFD700,#FF8C00)',
            border:'none',borderRadius:10,padding:'12px 36px',
            color:'#1A1A2E',fontWeight:'bold',fontSize:15,cursor:'pointer',
            fontFamily:'Georgia,serif',letterSpacing:1,
          }}>▶ Play Again</button>
        </div>
      )}
    </div>
  );
}
