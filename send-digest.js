
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
var { loadState, saveState } = require("./lib/state");
var { SHARE_LOT_SYMBOLS, MAIN_SYMBOLS } = require("./lib/config");
function curlJson(args){ return JSON.parse(execFileSync("curl",["-4","-s","--max-time","25"].concat(args),{encoding:"utf8"})||"{}"); }
function won(n){ return Math.round(Number(n)||0).toLocaleString("ko-KR"); }
function usd(n){ return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function num(v){ if(v==null||v==="") return 0; if(typeof v==="object") return Number(v.krw||v.usd||v.amount||v.value||0); return Number(v)||0; }
function daysBetween(a,b){
  try {
    var d1=new Date(a+"T00:00:00Z"), d2=new Date(b+"T00:00:00Z");
    return Math.max(0, Math.round((d2-d1)/86400000));
  } catch(e){ return 0; }
}
(async function(){
  var tok=curlJson(["-X","POST","https://openapi.tossinvest.com/oauth2/token","-H","Content-Type: application/x-www-form-urlencoded","-d","grant_type=client_credentials","-d","client_id="+process.env.TOSS_CLIENT_ID,"-d","client_secret="+process.env.TOSS_CLIENT_SECRET]);
  var auth="Authorization: Bearer "+tok.access_token, acc="X-Tossinvest-Account: 1";
  var hold=curlJson(["https://openapi.tossinvest.com/api/v1/holdings","-H",auth,"-H",acc]);
  var usdP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=USD","-H",auth,"-H",acc]);
  var krwP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=KRW","-H",auth,"-H",acc]);
  var fx=1400, fxAt="";
  try {
    var fxr=curlJson(["https://openapi.tossinvest.com/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW","-H",auth]);
    fx=Number((fxr.result&&fxr.result.rate)||1400)||1400;
    fxAt=(fxr.result&&fxr.result.validFrom)||"";
    if(fxAt) fxAt=fxAt.replace("T"," ").slice(0,16);
  } catch(e) {}
  var r=hold.result||{}, items=r.items||[];
  var usdCash=num((usdP.result||{}).cashBuyingPower), krwCash=num((krwP.result||{}).cashBuyingPower);
  var stockUsd=num(((r.marketValue||{}).amount||{}).usd), costUsd=num((r.totalPurchaseAmount||{}).usd);
  var pnlUsd=num(((r.profitLoss||{}).amount||{}).usd), rate=num((r.profitLoss||{}).rate)*100;
  var totalKrw=krwCash+(usdCash+stockUsd)*fx;
  var state=await loadState();
  var ledger=state.cashLedger||{};
  var net=Number(ledger.netInvestedKrw||0);
  if (!net) net = totalKrw; // 원장 없으면 현재 총자산으로 임시
  var pnlKrw=totalKrw-net, pct=net?(pnlKrw/net)*100:0;
  var today=new Date().toISOString().slice(0,10);

  // 보유 감지 시 startDate 없으면 오늘로 시드 (첫 구간)
  state.positionMeta = state.positionMeta || {};
  var metaChanged=false;
  items.forEach(function(it){
    var sym=it.symbol;
    if (!sym) return;
    var pm=state.positionMeta[sym]||{};
    if (!pm.startDate && num(it.quantity)>0) {
      pm.startDate = today;
      state.positionMeta[sym]=pm;
      metaChanged=true;
    }
  });
  if (metaChanged) { try { await saveState(state); } catch(e){} }

  var rows=items.map(function(it){
    var qty=num(it.quantity), avg=num(it.averagePurchasePrice), last=num(it.lastPrice);
    var cost=avg*qty, p=cost>0?((last*qty-cost)/cost)*100:0;
    return {symbol:it.symbol,qty:qty,avg:avg,last:last,p:p};
  }).sort(function(a,b){return b.p-a.p;});

  var lines=[];
  lines.push("에버라이징 "+today);
  lines.push("총자산 "+won(totalKrw)+"원");
  lines.push("기준원금 "+won(net)+"원");
  lines.push("계좌손익 "+(pnlKrw>=0?"+":"")+won(pnlKrw)+"원 ("+(pct>=0?"+":"")+pct.toFixed(2)+"%)");
  lines.push("달러 $"+usd(usdCash)+" / 원화 "+won(krwCash)+"원");
  lines.push("주식 $"+usd(stockUsd)+" / 원금 $"+usd(costUsd)+" / "+(pnlUsd>=0?"+":"")+usd(pnlUsd)+" ("+(rate>=0?"+":"")+rate.toFixed(2)+"%)");
  lines.push("환율 "+fx+(fxAt?(" ("+fxAt+")"):""));

  // 환전 원장 요약
  var fxs = ledger.fxEntries || [];
  if (fxs.length) {
    var sumKrw=fxs.reduce(function(s,e){return s+Number(e.krw||0);},0);
    var sumUsd=fxs.reduce(function(s,e){return s+Number(e.usd||0);},0);
    var avg=sumUsd>0?sumKrw/sumUsd:0;
    var last=fxs[fxs.length-1];
    lines.push("");
    lines.push("환전 누적 "+won(sumKrw)+"원 / $"+sumUsd.toFixed(2)+" (평균 "+avg.toFixed(2)+", "+fxs.length+"건)");
    lines.push("최근 환전 "+last.date+" "+won(last.krw)+"원 / $"+Number(last.usd).toFixed(2)+" @ "+last.rate);
  } else {
    lines.push("");
    lines.push("환전 기록 없음 → /환전 원화 달러 환율 일자");
  }

  lines.push("");
  lines.push("보유");
  rows.forEach(function(x){
    var pm = state.positionMeta[x.symbol] || {};
    var stats = (state.tradeStats && state.tradeStats[x.symbol]) || {};
    var by = stats.byRule || {};
    var start = pm.startDate || "-";
    var d = start!=="-" ? daysBetween(start, today) : 0;
    // 5종 모으기: 시작일 이후 경과일 ≈ 회차 추정 (주말 포함 대략, 안내용)
    var isLot = SHARE_LOT_SYMBOLS.indexOf(x.symbol)>=0;
    var extra = "";
    if (isLot) {
      extra = " 온주 "+Math.floor(x.qty)+"/15";
    } else {
      extra = " 시작 "+start+" · 약"+d+"회차";
    }
    var ruleHits = ["R1:"+(by.RULE1_COST||0), "R2:"+(by.RULE2_BOOST||0), "R3:"+(by.RULE3_BREAKSTOP||0), "R4:"+(by.RULE4_ATH_TRAIL||0)].join(" ");
    lines.push(x.symbol+" "+(x.p>=0?"+":"")+x.p.toFixed(2)+"% "+usd(x.last)+" /평단 "+usd(x.avg)+extra);
    lines.push("  규칙누적 "+ruleHits+(stats.count?(" ·매도"+stats.count+"회"):""));
  });

  lines.push("");
  try {
    var lb = state.lotBudget || {};
    var g = lb.GDXU || {};
    var u = lb.UBOT || {};
    lines.push("예산통장 GDXU "+won(g.krw||0)+"원 / UBOT "+won(u.krw||0)+"원");
  } catch(e){}
  lines.push("5종 모으기 · GDXU/UBOT 예산 · 매도승인시 시작일 리셋");

  curlJson(["-X","POST","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(lines.join("\n"))]);
  console.log(JSON.stringify({ok:true,n:rows.length,fxn:(fxs||[]).length}));
})().catch(function(e){ console.error(e); process.exit(1); });
