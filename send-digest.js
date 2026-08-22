
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
var { loadState } = require("./lib/state");
var { SHARE_LOT_SYMBOLS } = require("./lib/config");
function curlJson(args){ return JSON.parse(execFileSync("curl",["-4","-s","--max-time","25"].concat(args),{encoding:"utf8"})||"{}"); }
function won(n){ return Math.round(Number(n)||0).toLocaleString("ko-KR"); }
function usd(n){ return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function num(v){ if(v==null||v==="") return 0; if(typeof v==="object") return Number(v.krw||v.usd||v.amount||v.value||0); return Number(v)||0; }
(async function(){
  var tok=curlJson(["-X","POST","https://openapi.tossinvest.com/oauth2/token","-H","Content-Type: application/x-www-form-urlencoded","-d","grant_type=client_credentials","-d","client_id="+process.env.TOSS_CLIENT_ID,"-d","client_secret="+process.env.TOSS_CLIENT_SECRET]);
  var auth="Authorization: Bearer "+tok.access_token, acc="X-Tossinvest-Account: 1";
  var hold=curlJson(["https://openapi.tossinvest.com/api/v1/holdings","-H",auth,"-H",acc]);
  var usdP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=USD","-H",auth,"-H",acc]);
  var krwP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=KRW","-H",auth,"-H",acc]);
  var fx=1400; try { var fxr=curlJson(["https://openapi.tossinvest.com/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW","-H",auth]); fx=Number((fxr.result&&fxr.result.rate)||1400)||1400; var fxAt=(fxr.result&&fxr.result.validFrom)||""; if(fxAt){ fxAt=fxAt.replace("T"," ").slice(0,16); } } catch(e) {}
  var r=hold.result||{}, items=r.items||[];
  var usdCash=num((usdP.result||{}).cashBuyingPower), krwCash=num((krwP.result||{}).cashBuyingPower);
  var stockUsd=num(((r.marketValue||{}).amount||{}).usd), costUsd=num((r.totalPurchaseAmount||{}).usd);
  var pnlUsd=num(((r.profitLoss||{}).amount||{}).usd), rate=num((r.profitLoss||{}).rate)*100;
  var totalKrw=krwCash+(usdCash+stockUsd)*fx;
  var state=await loadState();
  var net=Number((state.cashLedger||{}).netInvestedKrw||totalKrw);
  var pnlKrw=totalKrw-net, pct=net?(pnlKrw/net)*100:0;
  var rows=items.map(function(it){
    var qty=num(it.quantity), avg=num(it.averagePurchasePrice), last=num(it.lastPrice);
    var cost=avg*qty, p=cost>0?((last*qty-cost)/cost)*100:0;
    return {symbol:it.symbol,qty:qty,avg:avg,last:last,p:p};
  }).sort(function(a,b){return b.p-a.p;});
  var lines=["에버라이징 "+new Date().toISOString().slice(0,10),"총자산 "+won(totalKrw)+"원","기준원금 "+won(net)+"원","계좌손익 "+(pnlKrw>=0?"+":"")+won(pnlKrw)+"원 ("+(pct>=0?"+":"")+pct.toFixed(2)+"%)","달러 $"+usd(usdCash)+" / 원화 "+won(krwCash)+"원","주식 $"+usd(stockUsd)+" / 원금 $"+usd(costUsd)+" / "+(pnlUsd>=0?"+":"")+usd(pnlUsd)+" ("+(rate>=0?"+":"")+rate.toFixed(2)+"%)","환율 "+fx+(typeof fxAt!=="undefined"&&fxAt?(" ("+fxAt+")"):""),"","보유"];
  rows.forEach(function(x){
    var extra=SHARE_LOT_SYMBOLS.indexOf(x.symbol)>=0?(" 온주 "+Math.floor(x.qty)+"/15"):"";
    lines.push(x.symbol+" "+(x.p>=0?"+":"")+x.p.toFixed(2)+"%  "+usd(x.last)+" /평단 "+usd(x.avg)+extra);
  });
  lines.push(""); lines.push("5종목 일22만 모으기 · GDXU/UBOT 예산통장");
  curlJson(["-X","POST","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(lines.join("\n"))]);
  console.log(JSON.stringify({ok:true,n:rows.length}));
})().catch(function(e){ console.error(e); process.exit(1); });
