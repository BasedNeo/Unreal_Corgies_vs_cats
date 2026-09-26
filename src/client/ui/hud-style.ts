// OWNER: L5 (juice). Comic-panel HUD stylesheet: warm-black ink outlines, offset ink shadows, halftone accents,
// chunky rounded display type. Everything is sized in `--u` (1 at 1280×720, 2 at 2560×1440) so the HUD reads
// the same at every resolution. Colors mirror src/client/style/style-tokens.js (PALETTE).
import { PALETTE } from '../style/style-tokens.js';
import { FONT_BODY, FONT_COMIC, FONT_DISPLAY } from './fonts';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const u = (n: number) => `calc(var(--u)*${n})`;

export const HUD_CSS = `
#cvc-hud{position:absolute;inset:0;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;
  --u:max(0.6px,min(calc(100vw / 1280),calc(100vh / 720)));
  --ink:${hex(PALETTE.ink)};--paper:#f6ecd8;--paper2:#ecdcbc;--corgi:${hex(PALETTE.teamCorgis)};--corgi2:${hex(PALETTE.teamCorgisTrim)};
  --cat:${hex(PALETTE.teamCats)};--cat2:${hex(PALETTE.teamCatsTrim)};--gold:#ffd04a;--hot:#ff9b3d;--red:#e8453c;--lime:#8fd14a;--tennis:${hex(PALETTE.tennisBall)};
  font-family:${FONT_DISPLAY};color:var(--paper);font-size:${u(16)};line-height:1.1;letter-spacing:.01em}
#cvc-hud .interactive{pointer-events:auto}
#cvc-hud svg{display:block}
#cvc-hud .ico{width:100%;height:100%}
#cvc-hud .glyph{width:${u(26)};height:${u(26)}}
#cvc-hud .t0{--team:var(--corgi);--team2:var(--corgi2)}
#cvc-hud .t1{--team:var(--cat);--team2:var(--cat2)}
#cvc-hud .ink-text{color:var(--paper);-webkit-text-stroke:${u(2.4)} var(--ink);paint-order:stroke fill;text-shadow:0 ${u(3)} 0 var(--ink)}
#cvc-hud .panel{position:relative;background:var(--paper);color:var(--ink);border:${u(3)} solid var(--ink);border-radius:${u(12)};box-shadow:${u(4)} ${u(5)} 0 var(--ink)}
#cvc-hud .halftone::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(circle,rgba(26,18,12,.2) 27%,transparent 30%) 0 0/${u(7)} ${u(7)};
  -webkit-mask:linear-gradient(135deg,transparent 45%,#000 100%);mask:linear-gradient(135deg,transparent 45%,#000 100%)}
#cvc-hud .hidden{display:none!important}

/* ---------- debug line ---------- */
#cvc-hud .dbg{position:absolute;left:${u(10)};top:${u(8)};font:${u(11)}/1.2 ui-monospace,monospace;color:#fff;opacity:.55;text-shadow:0 1px 0 #000}

/* ---------- match bar ---------- */
#cvc-hud .mb{position:absolute;top:${u(12)};left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:0;filter:drop-shadow(${u(3)} ${u(4)} 0 var(--ink))}
#cvc-hud .mb-team{display:flex;align-items:center;gap:${u(10)};padding:${u(4)} ${u(16)};background:var(--team);border:${u(3)} solid var(--ink);transform:skewX(-12deg);min-width:${u(150)}}
#cvc-hud .mb-team>*{transform:skewX(12deg)}
#cvc-hud .mb-team.t0{justify-content:flex-end;border-radius:${u(10)} 0 0 ${u(10)};border-right:none}
#cvc-hud .mb-team.t1{justify-content:flex-start;border-radius:0 ${u(10)} ${u(10)} 0;border-left:none}
#cvc-hud .mb-name{font-size:${u(15)};color:var(--team2);-webkit-text-stroke:${u(1.2)} var(--ink);paint-order:stroke fill;letter-spacing:.06em}
#cvc-hud .mb-team.t1 .mb-name{color:#ffd9de}
#cvc-hud .mb-score{font-size:${u(34)};color:#fff;-webkit-text-stroke:${u(2.6)} var(--ink);paint-order:stroke fill;text-shadow:0 ${u(3)} 0 var(--ink);min-width:${u(34)};text-align:center}
#cvc-hud .mb-team.mine .mb-name::after{content:' ★';color:var(--gold)}
#cvc-hud .mb-mid{background:var(--paper);color:var(--ink);border:${u(3)} solid var(--ink);padding:${u(3)} ${u(16)} ${u(4)};text-align:center;min-width:${u(150)};position:relative;z-index:1;margin:0 ${u(-4)}}
#cvc-hud .mb-timer{font-size:${u(26)};letter-spacing:.04em}
#cvc-hud .mb-timer.warm{color:var(--hot)}
#cvc-hud .mb-timer.low{color:var(--red);animation:cvc-pulse 1s infinite}
#cvc-hud .mb-obj{font:600 ${u(11.5)}/1.2 ${FONT_BODY};max-width:${u(300)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.85}
#cvc-hud .mb-wave{position:absolute;top:${u(72)};left:50%;transform:translateX(-50%) rotate(-2deg);background:var(--gold);color:var(--ink);border:${u(2.5)} solid var(--ink);border-radius:${u(8)};padding:${u(1)} ${u(10)};font-size:${u(13)};letter-spacing:.08em;box-shadow:${u(2)} ${u(3)} 0 var(--ink)}

/* ---------- toasts / banners ---------- */
#cvc-hud .toasts{position:absolute;top:${u(104)};left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:${u(6)}}
#cvc-hud .toast{background:var(--ink);color:var(--paper);border:${u(2)} solid var(--paper);border-radius:${u(20)};padding:${u(4)} ${u(14)};font:600 ${u(13)} ${FONT_BODY};animation:cvc-toast 3.2s forwards}
#cvc-hud .bn{position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);pointer-events:none}
#cvc-hud .bn-burst{position:relative;padding:${u(26)} ${u(60)};background:var(--gold);clip-path:polygon(50% 0,58% 14%,74% 2%,74% 20%,94% 12%,86% 32%,100% 40%,86% 52%,100% 66%,82% 68%,90% 90%,70% 80%,62% 100%,50% 84%,38% 100%,30% 80%,10% 90%,18% 68%,0 66%,14% 52%,0 40%,14% 32%,6% 12%,26% 20%,26% 2%,42% 14%);
}
#cvc-hud .bn-ink{position:absolute;inset:${u(-8)};background:var(--ink);clip-path:inherit;z-index:-1}
#cvc-hud .bn-text{font-size:${u(56)};color:#fff;-webkit-text-stroke:${u(4)} var(--ink);paint-order:stroke fill;text-shadow:${u(4)} ${u(5)} 0 var(--ink);white-space:nowrap;transform:rotate(-3deg)}
#cvc-hud .bn.t0 .bn-burst{background:var(--corgi2)} #cvc-hud .bn.t1 .bn-burst{background:#ff8c95}

/* ---------- health + ability (bottom left) ---------- */
#cvc-hud .hp{position:absolute;left:${u(22)};bottom:${u(20)};display:flex;align-items:flex-end;gap:${u(10)}}
#cvc-hud .hp-badge{width:${u(62)};height:${u(62)};border-radius:50%;background:var(--team,var(--corgi));border:${u(3)} solid var(--ink);box-shadow:${u(3)} ${u(4)} 0 var(--ink);display:grid;place-items:center;color:var(--team2,var(--gold));flex:none;position:relative}
#cvc-hud .hp-badge .ico{width:72%;height:72%}
#cvc-hud .hp-body{display:flex;flex-direction:column;gap:${u(3)}}
#cvc-hud .hp-top{display:flex;align-items:baseline;gap:${u(6)};padding-left:${u(4)}}
#cvc-hud .hp-num{font-size:${u(38)};color:#fff;-webkit-text-stroke:${u(2.8)} var(--ink);paint-order:stroke fill;text-shadow:0 ${u(3)} 0 var(--ink);min-width:${u(62)}}
#cvc-hud .hp-max{font-size:${u(16)};color:var(--paper);-webkit-text-stroke:${u(1.5)} var(--ink);paint-order:stroke fill;opacity:.9}
#cvc-hud .hp-cls{margin-left:auto;font-size:${u(13)};letter-spacing:.08em;color:var(--paper);-webkit-text-stroke:${u(1.2)} var(--ink);paint-order:stroke fill}
#cvc-hud .hp-bar{position:relative;width:${u(250)};height:${u(20)};background:#2a1d14;border:${u(3)} solid var(--ink);border-radius:${u(6)};overflow:hidden;box-shadow:${u(3)} ${u(4)} 0 var(--ink);transform:skewX(-10deg)}
#cvc-hud .hp-bar>div{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:left center}
#cvc-hud .hp-ghost{background:#fff4dc}
#cvc-hud .hp-ghost.heal{background:#b6f07a}
#cvc-hud .hp-fill{background:linear-gradient(#a6ea5c 0 45%,#79c23d 46% 100%)}
#cvc-hud .hp-fill.mid{background:linear-gradient(#ffe07a 0 45%,#f2b22e 46% 100%)}
#cvc-hud .hp-fill.low{background:linear-gradient(#ff7b6b 0 45%,#e03a2f 46% 100%)}
#cvc-hud .hp-ticks{background:repeating-linear-gradient(90deg,transparent 0 calc(10% - ${u(2)}),rgba(26,18,12,.55) calc(10% - ${u(2)}) 10%)}
#cvc-hud .ab{position:relative;width:${u(58)};height:${u(58)};flex:none;margin-bottom:${u(2)}}
#cvc-hud .ab-core{position:absolute;inset:${u(5)};border-radius:50%;background:var(--paper);border:${u(3)} solid var(--ink);display:grid;place-items:center;color:var(--team,var(--corgi))}
#cvc-hud .ab-core .ico{width:66%;height:66%}
#cvc-hud .ab-ring{position:absolute;inset:0;transform:rotate(-90deg)}
#cvc-hud .ab-ring circle{fill:none;stroke-width:5}
#cvc-hud .ab-ring .bg{stroke:var(--ink)}
#cvc-hud .ab-ring .fg{stroke:var(--gold);stroke-linecap:round}
#cvc-hud .ab.cooling .ab-core{filter:grayscale(.85) brightness(.75)}
#cvc-hud .ab.ready .ab-core{animation:cvc-ready 1.6s infinite}
#cvc-hud .ab-key{position:absolute;right:${u(-6)};bottom:${u(-4)};background:var(--gold);color:var(--ink);border:${u(2.5)} solid var(--ink);border-radius:${u(6)};font-size:${u(13)};padding:0 ${u(5)};line-height:1.35}
#cvc-hud .ab-cd{position:absolute;inset:0;display:grid;place-items:center;font-size:${u(20)};color:#fff;-webkit-text-stroke:${u(2)} var(--ink);paint-order:stroke fill}

/* ---------- ammo (bottom right) ---------- */
#cvc-hud .am{position:absolute;right:${u(24)};bottom:${u(20)};display:flex;flex-direction:column;align-items:flex-end;gap:${u(4)}}
#cvc-hud .am-wpn{display:flex;align-items:center;gap:${u(6)};font-size:${u(13)};letter-spacing:.07em;color:var(--paper);-webkit-text-stroke:${u(1.2)} var(--ink);paint-order:stroke fill}
#cvc-hud .am-row{display:flex;align-items:baseline;gap:${u(6)}}
#cvc-hud .am-num{font-size:${u(46)};color:#fff;-webkit-text-stroke:${u(3)} var(--ink);paint-order:stroke fill;text-shadow:0 ${u(3)} 0 var(--ink)}
#cvc-hud .am-num.low{color:var(--hot)} #cvc-hud .am-num.empty{color:var(--red);animation:cvc-pulse .7s infinite}
#cvc-hud .am-mag{font-size:${u(20)};color:var(--paper);-webkit-text-stroke:${u(1.6)} var(--ink);paint-order:stroke fill}
#cvc-hud .am-pips{display:flex;flex-wrap:wrap-reverse;justify-content:flex-end;gap:${u(2.5)};max-width:${u(206)}}
#cvc-hud .am-pips i{width:${u(8)};height:${u(8)};border-radius:50%;background:var(--tennis);border:${u(1.6)} solid var(--ink)}
#cvc-hud .am-pips i.spent{background:#3a2c20;opacity:.7}
#cvc-hud .am-reload{display:flex;align-items:center;gap:${u(8)};background:var(--ink);border-radius:${u(8)};padding:${u(3)} ${u(8)};font-size:${u(13)};letter-spacing:.08em;color:var(--gold)}
#cvc-hud .am-rbar{width:${u(90)};height:${u(8)};background:#3a2c20;border-radius:${u(4)};overflow:hidden}
#cvc-hud .am-rbar i{display:block;height:100%;background:var(--gold);transform-origin:left;transform:scaleX(0)}
#cvc-hud .am-hint{font-size:${u(13)};color:var(--gold);-webkit-text-stroke:${u(1.2)} var(--ink);paint-order:stroke fill;animation:cvc-pulse .8s infinite}

/* ---------- crosshair, hit markers, damage direction ---------- */
#cvc-hud .xh{position:absolute;left:50%;top:50%;width:0;height:0}
#cvc-hud .xh i{position:absolute;background:#fff;box-shadow:0 0 0 ${u(1.6)} var(--ink);border-radius:${u(1)}}
#cvc-hud .xh .v{width:${u(3)};height:${u(9)};left:${u(-1.5)}}
#cvc-hud .xh .h{width:${u(9)};height:${u(3)};top:${u(-1.5)}}
#cvc-hud .xh .dot{width:${u(4)};height:${u(4)};left:${u(-2)};top:${u(-2)};border-radius:50%}
#cvc-hud .xh.dead{opacity:0}
#cvc-hud .hm{position:absolute;left:0;top:0;opacity:0}
#cvc-hud .hm i{position:absolute;width:${u(4)};height:${u(12)};left:${u(-2)};top:${u(-6)};background:#fff;box-shadow:0 0 0 ${u(1.6)} var(--ink);border-radius:${u(2)}}
#cvc-hud .hm.crit i{background:var(--gold);height:${u(15)};top:${u(-7.5)}}
#cvc-hud .hm.kill i{background:var(--red);width:${u(5)};height:${u(18)};top:${u(-9)};left:${u(-2.5)}}
#cvc-hud .dd{position:absolute;left:50%;top:50%;width:0;height:0}
#cvc-hud .dd>div{position:absolute;left:0;top:0;opacity:0}
#cvc-hud .dd svg{position:absolute;width:${u(120)};height:${u(44)};left:${u(-60)};top:${u(-170)}}

/* ---------- vignettes ---------- */
#cvc-hud .vig{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 45%,rgba(200,20,20,.55) 100%)}
#cvc-hud .vig-low{position:absolute;inset:0;opacity:0}
#cvc-hud .vig-low::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(160,0,0,.45) 100%);animation:cvc-pulse 1.1s infinite}

/* ---------- kill feed (top right) ---------- */
#cvc-hud .kf{position:absolute;right:${u(14)};top:${u(12)};display:flex;flex-direction:column;align-items:flex-end;gap:${u(5)}}
#cvc-hud .kf-e{display:flex;align-items:center;gap:${u(6)};background:rgba(26,18,12,.82);border:${u(2)} solid var(--ink);border-radius:${u(8)};padding:${u(3)} ${u(9)};font:700 ${u(13.5)}/1.25 ${FONT_BODY};animation:cvc-feed .3s cubic-bezier(.2,1.5,.4,1);box-shadow:${u(2)} ${u(3)} 0 rgba(26,18,12,.6)}
#cvc-hud .kf-e.me{background:var(--paper);color:var(--ink);border-color:var(--ink);box-shadow:${u(3)} ${u(3)} 0 var(--gold)}
#cvc-hud .kf-n{max-width:${u(150)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cvc-hud .kf-n.t0{color:#8fc1ff} #cvc-hud .kf-n.t1{color:#ff8c95}
#cvc-hud .kf-e.me .kf-n.t0{color:var(--corgi)} #cvc-hud .kf-e.me .kf-n.t1{color:var(--cat)}
#cvc-hud .kf-e .glyph{width:${u(24)};height:${u(24)}}
#cvc-hud .kf-e .glyph.star{width:${u(16)};height:${u(16)};margin-left:${u(-4)}}
#cvc-hud .kf-e.old{opacity:.0;transition:opacity .4s}

/* ---------- death screen ---------- */
#cvc-hud .ds{position:absolute;inset:0;display:grid;place-items:center}
#cvc-hud .ds-veil{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(26,18,12,.15) 30%,rgba(26,18,12,.7) 100%),radial-gradient(circle,rgba(26,18,12,.28) 26%,transparent 29%) 0 0/${u(9)} ${u(9)}}
#cvc-hud .ds-stack{position:relative;display:flex;flex-direction:column;align-items:center;gap:${u(16)};transform:translateY(${u(-30)})}
#cvc-hud .ds-title{font-size:${u(64)};color:#fff;-webkit-text-stroke:${u(4)} var(--ink);paint-order:stroke fill;text-shadow:${u(5)} ${u(6)} 0 var(--ink);transform:rotate(-3deg);animation:cvc-banner .45s cubic-bezier(.2,1.6,.4,1)}
#cvc-hud .ds-title b{color:var(--red);font-weight:inherit}
#cvc-hud .ds-card{display:flex;align-items:center;gap:${u(12)};padding:${u(10)} ${u(20)} ${u(10)} ${u(12)};transform:rotate(1.5deg)}
#cvc-hud .ds-by{font:700 ${u(14)} ${FONT_BODY};opacity:.7;letter-spacing:.05em}
#cvc-hud .ds-killer{font-size:${u(26)};color:var(--team)}
#cvc-hud .ds-icon{width:${u(48)};height:${u(48)};border-radius:50%;background:var(--team);border:${u(3)} solid var(--ink);display:grid;place-items:center;color:var(--team2)}
#cvc-hud .ds-icon .ico{width:74%;height:74%}
#cvc-hud .ds-quip{font:italic 700 ${u(15)} ${FONT_BODY};color:var(--paper);text-shadow:0 ${u(2)} 0 var(--ink)}
#cvc-hud .ds-count{position:relative;width:${u(96)};height:${u(96)};display:grid;place-items:center}
#cvc-hud .ds-count svg{position:absolute;inset:0;transform:rotate(-90deg)}
#cvc-hud .ds-count circle{fill:var(--paper);stroke:var(--ink);stroke-width:4}
#cvc-hud .ds-count .fg{fill:none;stroke:var(--gold);stroke-width:7;stroke-linecap:round}
#cvc-hud .ds-num{position:relative;font-size:${u(44)};color:var(--ink)}
#cvc-hud .ds-back{font-size:${u(15)};letter-spacing:.14em;color:var(--paper);-webkit-text-stroke:${u(1.4)} var(--ink);paint-order:stroke fill;margin-top:${u(-8)}}

/* ---------- scoreboard ---------- */
#cvc-hud .sb{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-.4deg);width:${u(980)};max-width:94vw;padding:${u(14)} ${u(18)} ${u(18)}}
#cvc-hud .sb-head{display:flex;align-items:baseline;justify-content:space-between;margin:0 ${u(4)} ${u(10)}}
#cvc-hud .sb-title{font-size:${u(30)};letter-spacing:.04em}
#cvc-hud .sb-meta{font:700 ${u(13)} ${FONT_BODY};opacity:.7}
#cvc-hud .sb-cols{display:grid;grid-template-columns:1fr 1fr;gap:${u(14)}}
#cvc-hud .sb-team{border:${u(3)} solid var(--ink);border-radius:${u(10)};overflow:hidden;background:#fffaf0}
#cvc-hud .sb-team header{display:flex;justify-content:space-between;align-items:center;background:var(--team);padding:${u(4)} ${u(12)};border-bottom:${u(3)} solid var(--ink)}
#cvc-hud .sb-tname{font-size:${u(22)};color:#fff;-webkit-text-stroke:${u(2)} var(--ink);paint-order:stroke fill;letter-spacing:.06em}
#cvc-hud .sb-tscore{font-size:${u(30)};color:#fff;-webkit-text-stroke:${u(2.4)} var(--ink);paint-order:stroke fill}
#cvc-hud .sb-team table{width:100%;border-collapse:collapse;font:700 ${u(13.5)}/1.2 ${FONT_BODY}}
#cvc-hud .sb-team th{font:${u(11)} ${FONT_DISPLAY};letter-spacing:.08em;opacity:.6;padding:${u(5)} ${u(6)} ${u(3)};text-align:right}
#cvc-hud .sb-team th.l{text-align:left}
#cvc-hud .sb-team td{padding:${u(4)} ${u(6)};border-top:${u(1)} solid rgba(26,18,12,.12)}
#cvc-hud .sb-team tr:nth-child(even) td{background:rgba(26,18,12,.035)}
#cvc-hud .sb-team td.num{text-align:right;font-variant-numeric:tabular-nums}
#cvc-hud .sb-team td.strong{font-family:${FONT_DISPLAY};font-size:${u(15)}}
#cvc-hud .sb-team td.dim{color:rgba(26,18,12,.5)}
#cvc-hud .sb-cls{width:${u(26)};color:var(--team)} #cvc-hud .sb-cls svg{width:${u(22)};height:${u(22)}}
#cvc-hud .sb-name{max-width:${u(170)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cvc-hud .sb-bot,#cvc-hud .sb-you{font:${u(10)} ${FONT_DISPLAY};letter-spacing:.06em;border:${u(1.5)} solid var(--ink);border-radius:${u(4)};padding:0 ${u(4)};margin-left:${u(6)};vertical-align:middle}
#cvc-hud .sb-bot{background:#e5dccb;opacity:.8} #cvc-hud .sb-you{background:var(--gold)}
#cvc-hud .sb-team tr.me td{background:rgba(255,208,74,.35)!important}
#cvc-hud .sb-empty{text-align:center;opacity:.5;padding:${u(14)}!important}

/* ---------- pause / click-to-play ---------- */
#cvc-hud .lk{position:absolute;inset:0;display:grid;place-items:center;background:rgba(13,26,20,.45);cursor:pointer}
#cvc-hud .lk-panel{padding:${u(18)} ${u(26)};text-align:center;transform:rotate(-1deg)}
#cvc-hud .lk-title{font-size:${u(40)};color:var(--gold);-webkit-text-stroke:${u(3)} var(--ink);paint-order:stroke fill;text-shadow:${u(3)} ${u(4)} 0 var(--ink)}
#cvc-hud .lk-sub{font:700 ${u(13)} ${FONT_BODY};opacity:.7;margin:${u(4)} 0 ${u(12)}}
#cvc-hud .keys{display:grid;grid-template-columns:repeat(4,auto);gap:${u(6)} ${u(14)};justify-content:center;font:700 ${u(12.5)} ${FONT_BODY}}
#cvc-hud .keys span{display:flex;align-items:center;gap:${u(6)}}
#cvc-hud kbd{font:${u(11.5)} ${FONT_DISPLAY};background:var(--ink);color:var(--paper);border-radius:${u(5)};padding:${u(2)} ${u(6)};box-shadow:0 ${u(2)} 0 #5b3a26;letter-spacing:.04em}
#cvc-hud .lk-btns{display:flex;gap:${u(10)};justify-content:center;margin-top:${u(14)}}

/* ---------- buttons & inputs (menus) ---------- */
#cvc-hud .btn{font:${u(17)} ${FONT_DISPLAY};letter-spacing:.05em;color:var(--ink);background:var(--paper);border:${u(3)} solid var(--ink);border-radius:${u(10)};padding:${u(8)} ${u(16)};box-shadow:${u(3)} ${u(4)} 0 var(--ink);cursor:pointer;transition:transform .08s,box-shadow .08s,background .12s}
#cvc-hud .btn:hover{background:#fff}
#cvc-hud .btn:active{transform:translate(${u(2)},${u(3)});box-shadow:${u(1)} ${u(1)} 0 var(--ink)}
#cvc-hud .btn.primary{background:var(--gold);font-size:${u(24)};padding:${u(10)} ${u(22)}}
#cvc-hud .btn.primary:hover{background:#ffdc70}
#cvc-hud .btn.small{font-size:${u(14)};padding:${u(5)} ${u(12)}}
#cvc-hud :is(.btn,.seg button,.cc,input,.tog):focus-visible,#cvc-hud [data-nav].nav-focus{outline:${u(4)} solid var(--gold);outline-offset:${u(3)}}
#cvc-hud input[type=text]{font:700 ${u(15)} ${FONT_BODY};color:var(--ink);background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(8)};padding:${u(6)} ${u(10)};width:100%;box-sizing:border-box;box-shadow:inset 0 ${u(2)} 0 rgba(26,18,12,.12)}
#cvc-hud .seg{display:flex;border:${u(3)} solid var(--ink);border-radius:${u(10)};overflow:hidden;box-shadow:${u(3)} ${u(4)} 0 var(--ink)}
#cvc-hud .seg button{flex:1;font:${u(15)} ${FONT_DISPLAY};letter-spacing:.05em;border:none;border-right:${u(3)} solid var(--ink);background:var(--paper);color:var(--ink);padding:${u(7)} ${u(10)};cursor:pointer}
#cvc-hud .seg button:last-child{border-right:none}
#cvc-hud .seg button[aria-checked=true]{background:var(--team,var(--gold));color:#fff;-webkit-text-stroke:${u(1.4)} var(--ink);paint-order:stroke fill}
#cvc-hud .seg button.auto[aria-checked=true]{background:var(--gold);color:var(--ink);-webkit-text-stroke:0}

/* ---------- main menu ---------- */
#cvc-hud .mm{position:absolute;inset:0;overflow:hidden;color:var(--ink)}
#cvc-hud .mm-bg{position:absolute;inset:0;background:
  radial-gradient(circle,rgba(26,18,12,.25) 26%,transparent 29%) 0 0/${u(10)} ${u(10)},
  linear-gradient(105deg,rgba(47,111,214,.88) 0 47%,rgba(26,18,12,.95) 47% 48.2%,rgba(201,52,74,.88) 48.2% 100%)}
#cvc-hud .mm-bg::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,transparent 30%,rgba(13,10,8,.55) 100%)}
#cvc-hud .mm-logo{position:absolute;left:50%;top:${u(44)};transform:translateX(-50%);display:flex;align-items:center;gap:${u(14)};white-space:nowrap}
#cvc-hud .mm-word{font-size:${u(78)};color:#fff;-webkit-text-stroke:${u(5)} var(--ink);paint-order:stroke fill;text-shadow:${u(6)} ${u(7)} 0 var(--ink);letter-spacing:.02em}
#cvc-hud .mm-word.l{color:var(--corgi2);transform:rotate(-4deg)} #cvc-hud .mm-word.r{color:#ffd9de;transform:rotate(3deg)}
#cvc-hud .mm-vs{position:relative;width:${u(96)};height:${u(96)};display:grid;place-items:center;font-size:${u(40)};color:var(--ink);transform:rotate(-8deg)}
#cvc-hud .mm-vs::before{content:'';position:absolute;inset:0;background:var(--gold);clip-path:polygon(50% 0,61% 22%,85% 15%,78% 39%,100% 50%,78% 61%,85% 85%,61% 78%,50% 100%,39% 78%,15% 85%,22% 61%,0 50%,22% 39%,15% 15%,39% 22%);filter:drop-shadow(0 0 0 var(--ink))}
#cvc-hud .mm-vs::after{content:'';position:absolute;inset:${u(-5)};background:var(--ink);clip-path:polygon(50% 0,61% 22%,85% 15%,78% 39%,100% 50%,78% 61%,85% 85%,61% 78%,50% 100%,39% 78%,15% 85%,22% 61%,0 50%,22% 39%,15% 15%,39% 22%);z-index:-1}
#cvc-hud .mm-vs span{position:relative;z-index:1}
#cvc-hud .mm-tag{position:absolute;left:50%;top:${u(152)};transform:translateX(-50%) rotate(-1deg);font:italic 800 ${u(15)} ${FONT_BODY};color:var(--paper);background:var(--ink);padding:${u(3)} ${u(14)};border-radius:${u(4)};white-space:nowrap}
#cvc-hud .mm-main{position:absolute;left:50%;top:${u(206)};transform:translateX(-50%);display:grid;grid-template-columns:${u(360)} ${u(640)};gap:${u(24)}}
#cvc-hud .mm-card{padding:${u(14)} ${u(16)} ${u(16)}}
#cvc-hud .mm-h{font-size:${u(20)};letter-spacing:.06em;margin:0 0 ${u(8)};display:flex;align-items:center;gap:${u(8)}}
#cvc-hud .mm-h small{font:700 ${u(11.5)} ${FONT_BODY};opacity:.55;letter-spacing:0}
#cvc-hud .mm-field{display:flex;flex-direction:column;gap:${u(5)};margin-bottom:${u(12)}}
#cvc-hud .mm-label{font-size:${u(12)};letter-spacing:.1em;opacity:.7}
#cvc-hud .mm-play{display:flex;flex-direction:column;gap:${u(10)};margin-top:${u(6)}}
#cvc-hud .mm-join{display:flex;gap:${u(8)};align-items:stretch}
#cvc-hud .mm-join input{flex:1;min-width:0}
#cvc-hud .mm-foot{position:absolute;left:0;right:0;bottom:${u(12)};display:flex;flex-wrap:wrap;justify-content:center;gap:${u(6)} ${u(14)};padding:0 ${u(16)};font:700 ${u(12)} ${FONT_BODY};color:var(--paper);text-shadow:0 1px 0 var(--ink);opacity:.9}
#cvc-hud .mm-foot span{white-space:nowrap}
#cvc-hud .cc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${u(10)}}
#cvc-hud .cc{position:relative;text-align:left;font:inherit;color:var(--ink);background:#fffaf0;border:${u(3)} solid var(--ink);border-radius:${u(10)};padding:${u(8)} ${u(10)} ${u(10)};box-shadow:${u(3)} ${u(3)} 0 var(--ink);cursor:pointer;display:grid;grid-template-columns:${u(40)} 1fr;column-gap:${u(8)};row-gap:${u(2)};align-items:center;transition:transform .1s}
#cvc-hud .cc:hover{transform:translateY(${u(-2)})}
#cvc-hud .cc[aria-checked=true]{background:var(--gold);transform:rotate(-1.5deg) scale(1.03);box-shadow:${u(4)} ${u(5)} 0 var(--ink)}
#cvc-hud .cc-icon{grid-row:span 2;width:${u(40)};height:${u(40)};border-radius:50%;background:var(--team,var(--corgi));border:${u(2.5)} solid var(--ink);display:grid;place-items:center;color:var(--team2,var(--gold))}
#cvc-hud .cc-icon .ico{width:74%;height:74%}
#cvc-hud .cc-name{font-size:${u(17)};letter-spacing:.03em}
#cvc-hud .cc-role{font:800 ${u(10)} ${FONT_BODY};letter-spacing:.06em;text-transform:uppercase;opacity:.6}
#cvc-hud .cc-blurb{grid-column:1/-1;font:600 ${u(11.5)}/1.3 ${FONT_BODY};opacity:.85;margin-top:${u(5)};min-height:${u(30)}}
#cvc-hud .cc-check{position:absolute;right:${u(-8)};top:${u(-8)};width:${u(22)};height:${u(22)};border-radius:50%;background:var(--lime);border:${u(2.5)} solid var(--ink);display:none;place-items:center;font-size:${u(13)}}
#cvc-hud .cc[aria-checked=true] .cc-check{display:grid}
#cvc-hud .st-row{display:grid;grid-template-columns:${u(150)} 1fr ${u(46)};align-items:center;gap:${u(12)};padding:${u(7)} 0;border-bottom:${u(1.5)} dashed rgba(26,18,12,.2)}
#cvc-hud .st-row:last-of-type{border-bottom:none}
#cvc-hud .st-name{font-size:${u(15)};letter-spacing:.04em}
#cvc-hud .st-val{font:800 ${u(13)} ${FONT_BODY};text-align:right;font-variant-numeric:tabular-nums}
#cvc-hud input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:${u(14)};background:transparent;cursor:pointer}
#cvc-hud input[type=range]::-webkit-slider-runnable-track{height:${u(10)};background:linear-gradient(90deg,var(--gold) var(--p,50%),#3a2c20 var(--p,50%));border:${u(2.5)} solid var(--ink);border-radius:${u(6)}}
#cvc-hud input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:${u(20)};height:${u(20)};margin-top:${u(-7.5)};border-radius:50%;background:var(--paper);border:${u(3)} solid var(--ink)}
#cvc-hud input[type=range]::-moz-range-track{height:${u(10)};background:linear-gradient(90deg,var(--gold) var(--p,50%),#3a2c20 var(--p,50%));border:${u(2.5)} solid var(--ink);border-radius:${u(6)}}
#cvc-hud input[type=range]::-moz-range-thumb{width:${u(16)};height:${u(16)};border-radius:50%;background:var(--paper);border:${u(3)} solid var(--ink)}
#cvc-hud .tog{justify-self:start;width:${u(58)};height:${u(28)};border-radius:${u(16)};border:${u(3)} solid var(--ink);background:#3a2c20;position:relative;cursor:pointer;padding:0}
#cvc-hud .tog::after{content:'';position:absolute;top:${u(2)};left:${u(2)};width:${u(18)};height:${u(18)};border-radius:50%;background:var(--paper);border:${u(2)} solid var(--ink);transition:transform .15s}
#cvc-hud .tog[aria-checked=true]{background:var(--lime)} #cvc-hud .tog[aria-checked=true]::after{transform:translateX(${u(29)})}
#cvc-hud .st-actions{display:flex;justify-content:space-between;align-items:center;margin-top:${u(12)}}
#cvc-hud .st-note{font:600 ${u(11.5)} ${FONT_BODY};opacity:.6}

/* ---------- U1: chat (right column, under the kill feed; above the ammo panel) ---------- */
#cvc-hud .u1-slot{display:contents}
#cvc-hud .ch{position:absolute;right:${u(22)};bottom:${u(150)};width:${u(380)};display:flex;flex-direction:column;align-items:stretch;gap:${u(6)}}
#cvc-hud .ch-log{display:flex;flex-direction:column;align-items:flex-end;gap:${u(3)};max-height:${u(176)};overflow:hidden;scrollbar-width:thin}
#cvc-hud .ch.open .ch-log{max-height:${u(250)};overflow-y:auto;align-items:stretch;background:rgba(26,18,12,.78);border:${u(2.5)} solid var(--ink);border-radius:${u(10)};padding:${u(6)} ${u(8)};box-shadow:${u(3)} ${u(4)} 0 rgba(26,18,12,.55);pointer-events:auto}
#cvc-hud .ch.empty .ch-log{display:none}
#cvc-hud .ch-l{max-width:100%;box-sizing:border-box;font:700 ${u(13.5)}/1.3 ${FONT_BODY};color:var(--paper);background:rgba(26,18,12,.72);border-radius:${u(8)};padding:${u(2.5)} ${u(9)};overflow-wrap:anywhere;text-shadow:0 ${u(1)} 0 var(--ink)}
#cvc-hud .ch.open .ch-l{background:none;padding:${u(1.5)} ${u(2)}}
#cvc-hud .ch-n{font:${u(13.5)} ${FONT_DISPLAY};letter-spacing:.03em;margin-right:${u(6)};color:#e8dcc4}
#cvc-hud .ch-n::after{content:':';color:var(--paper);opacity:.6}
#cvc-hud .ch-n.t0{color:#8fc1ff} #cvc-hud .ch-n.t1{color:#ff8c95}
#cvc-hud .ch-l.self .ch-t{color:#fff8e6}
#cvc-hud .ch-l.sys{font-style:italic;color:var(--gold);background:rgba(26,18,12,.6)}
#cvc-hud .ch-s{font:800 ${u(10)} ${FONT_BODY};letter-spacing:.06em;text-transform:uppercase;margin-left:${u(6)};opacity:.75}
#cvc-hud .ch-s:empty{display:none}
#cvc-hud .ch-l.pending{opacity:.62}
#cvc-hud .ch-l.failed .ch-t{text-decoration:line-through;opacity:.65} #cvc-hud .ch-l.failed .ch-s{color:#ff8c95;opacity:1}
#cvc-hud .ch-in{display:flex;align-items:center;gap:${u(8)};background:var(--paper);border:${u(3)} solid var(--ink);border-radius:${u(10)};box-shadow:${u(3)} ${u(4)} 0 var(--ink);padding:${u(4)} ${u(6)};pointer-events:auto}
#cvc-hud .ch-to{flex:none;font:${u(12)} ${FONT_DISPLAY};letter-spacing:.08em;background:var(--ink);color:var(--gold);border-radius:${u(6)};padding:${u(2)} ${u(7)}}
#cvc-hud .ch-in input.ch-field{flex:1;min-width:0;border:none;box-shadow:none;background:transparent;padding:${u(3)} ${u(2)};font:700 ${u(14.5)} ${FONT_BODY};outline:none}
#cvc-hud .ch-in:focus-within{outline:${u(3)} solid var(--gold);outline-offset:${u(2)}}
#cvc-hud .ch-cnt{flex:none;font:800 ${u(11)} ${FONT_BODY};color:var(--ink);opacity:.55;font-variant-numeric:tabular-nums}
#cvc-hud .ch-hint{align-self:flex-end;font:800 ${u(11)} ${FONT_BODY};letter-spacing:.06em;color:var(--paper);text-shadow:0 ${u(1.5)} 0 var(--ink);opacity:.9}
#cvc-hud .ch-hint.warn{color:#ffb4a8;opacity:1}

/* ---------- U1: first-match tips (bottom centre, below the character, never over the crosshair) ---------- */
#cvc-hud .tip{position:absolute;left:50%;bottom:${u(132)};transform:translateX(-50%);max-width:${u(640)};display:flex;align-items:center;gap:${u(10)};
  background:var(--paper);color:var(--ink);border:${u(3)} solid var(--ink);border-radius:${u(12)};box-shadow:${u(4)} ${u(5)} 0 var(--ink);padding:${u(6)} ${u(14)} ${u(6)} ${u(6)};
  font:700 ${u(14.5)}/1.35 ${FONT_BODY};white-space:nowrap}
#cvc-hud .tip-tag{flex:none;font:${u(13)} ${FONT_DISPLAY};letter-spacing:.1em;background:var(--gold);border:${u(2.5)} solid var(--ink);border-radius:${u(8)};padding:${u(2)} ${u(8)};transform:rotate(-4deg)}
#cvc-hud .tip-body kbd{margin:0 ${u(2)};font-size:${u(12)};vertical-align:${u(1)}}

/* ---------- U1: settings additions ---------- */
#cvc-hud .st-qn{display:flex;align-items:center;gap:${u(10)};margin:${u(4)} 0 ${u(2)};padding:${u(7)} ${u(10)};background:#fff4c9;border:${u(2.5)} solid var(--ink);border-radius:${u(9)};font:700 ${u(12.5)}/1.3 ${FONT_BODY}}
#cvc-hud .st-qn-i{font-size:${u(18)};line-height:1}
#cvc-hud .st-qn-t{flex:1}
#cvc-hud .st-qn .btn{flex:none;background:var(--gold)}
#cvc-hud .st-tips{justify-self:start}

/* ---------- U1: menu › online rooms ---------- */
#cvc-hud .mm-row{display:flex;gap:${u(10)}} #cvc-hud .mm-row .btn{flex:1}
#cvc-hud .rb .mm-h{justify-content:flex-start}
#cvc-hud .rb-srv{max-width:${u(300)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cvc-hud .rb-live{margin-left:auto;width:${u(12)};height:${u(12)};border-radius:50%;border:${u(2)} solid var(--ink);background:#c9c0ae}
#cvc-hud .rb-live.ready,#cvc-hud .rb-live.empty{background:var(--lime);animation:cvc-pulse 2s infinite}
#cvc-hud .rb-live.loading{background:var(--gold);animation:cvc-pulse .6s infinite}
#cvc-hud .rb-live.error,#cvc-hud .rb-live.offline,#cvc-hud .rb-live.bad-url{background:var(--red)} #cvc-hud .rb-live.busy{background:var(--hot)}
#cvc-hud .rb-box{border:${u(3)} solid var(--ink);border-radius:${u(10)};background:#fffaf0;overflow:hidden}
#cvc-hud .rb-head,#cvc-hud .rb-row{display:grid;grid-template-columns:1.3fr 1.45fr 1.05fr .85fr ${u(78)};align-items:center;gap:${u(8)};padding:${u(5)} ${u(10)}}
#cvc-hud .rb-head{font:${u(11)} ${FONT_DISPLAY};letter-spacing:.08em;opacity:.6;border-bottom:${u(2)} solid rgba(26,18,12,.18)}
#cvc-hud .rb-rows{max-height:${u(186)};overflow-y:auto}
#cvc-hud .rb-box.norows .rb-head{display:none}
#cvc-hud .rb-rows.stale{opacity:.5}
#cvc-hud .rb-row{font:700 ${u(13)} ${FONT_BODY};border-top:${u(1)} solid rgba(26,18,12,.1)}
#cvc-hud .rb-row:first-child{border-top:none}
#cvc-hud .rb-row:nth-child(even){background:rgba(26,18,12,.035)}
#cvc-hud .rb-name{font:${u(15)} ${FONT_DISPLAY};letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cvc-hud .rb-mode{opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cvc-hud .rb-pl{font-variant-numeric:tabular-nums;white-space:nowrap} #cvc-hud .rb-pl b{font:${u(16)} ${FONT_DISPLAY}}
#cvc-hud .rb-pl i{font-style:normal;font-size:${u(11)};opacity:.6;margin-left:${u(5)}}
#cvc-hud .rb-ph{justify-self:start;font:${u(10.5)} ${FONT_DISPLAY};letter-spacing:.07em;border:${u(2)} solid var(--ink);border-radius:${u(6)};padding:${u(1)} ${u(6)};background:#e5dccb}
#cvc-hud .rb-ph.live{background:var(--lime)} #cvc-hud .rb-ph.warmup{background:var(--gold)} #cvc-hud .rb-ph.ended{background:#d7cfc0;opacity:.8}
#cvc-hud .rb-row .btn{padding:${u(4)} ${u(8)};font-size:${u(13)}}
#cvc-hud .rb-row .btn:disabled{opacity:.45;cursor:default;box-shadow:none}
#cvc-hud .rb-row.sk i{display:block;height:${u(12)};border-radius:${u(6)};background:linear-gradient(90deg,rgba(26,18,12,.08),rgba(26,18,12,.18),rgba(26,18,12,.08)) 0 0/200% 100%;animation:cvc-shimmer 1.1s linear infinite}
#cvc-hud .rb-row.sk{height:${u(26)}}
#cvc-hud .rb-msg{display:flex;align-items:center;justify-content:space-between;gap:${u(10)};padding:${u(12)} ${u(12)};font:700 ${u(13)} ${FONT_BODY}}
#cvc-hud .rb-msg.warn{background:#ffe3dd;border-top:${u(2)} solid rgba(26,18,12,.15)}
#cvc-hud .rb-create{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:${u(10)};margin-top:${u(12)}}
#cvc-hud .rb-create input[type=text]{padding:${u(5)} ${u(9)}}
#cvc-hud .rb-unl{display:flex;align-items:center;gap:${u(6)};font:800 ${u(12)} ${FONT_BODY}}
#cvc-hud .rb-unl .tog{width:${u(46)};height:${u(24)}} #cvc-hud .rb-unl .tog::after{width:${u(14)};height:${u(14)}}
#cvc-hud .rb-unl .tog[aria-checked=true]::after{transform:translateX(${u(21)})}
#cvc-hud .rb-note{margin:${u(6)} 0 0 ${u(2)};font:600 ${u(11.5)} ${FONT_BODY};opacity:.6}
#cvc-hud .rb-note.on{opacity:.9;color:#7a4a00}
#cvc-hud .rb-foot{display:flex;justify-content:space-between;align-items:center;gap:${u(10)};margin-top:${u(10)};font:700 ${u(11.5)} ${FONT_BODY}}
#cvc-hud .rb-as{opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes cvc-shimmer{to{background-position:-200% 0}}

@keyframes cvc-pulse{0%,100%{opacity:1}50%{opacity:.45}}
@keyframes cvc-feed{0%{transform:translateX(${u(40)}) scale(.8);opacity:0}100%{transform:none;opacity:1}}
@keyframes cvc-toast{0%{opacity:0;transform:translateY(${u(-8)})}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0}}
@keyframes cvc-banner{0%{transform:scale(.2) rotate(-12deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes cvc-ready{0%,100%{box-shadow:0 0 0 0 rgba(255,208,74,.0)}50%{box-shadow:0 0 0 ${u(5)} rgba(255,208,74,.65)}}
@media (prefers-reduced-motion: reduce){#cvc-hud *{animation-duration:.01s!important;animation-iteration-count:1!important}}
`;

export function injectHudStyle(doc: Document = document): void {
  if (doc.getElementById('cvc-hud-style')) return;
  const s = doc.createElement('style');
  s.id = 'cvc-hud-style';
  s.textContent = HUD_CSS;
  doc.head.appendChild(s);
}

export { FONT_COMIC };
