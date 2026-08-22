
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
var { loadState, saveState } = require("./lib/state");
function curlJson(args) {
  var out = execFileSync("curl", ["-4","-s","--max-time","25"].concat(args), {encoding:"utf8"});
  return JSON.parse(out || "{}");
}
function won(n){ return Math.round(Number(n)||0).toLocaleString("ko-KR"); }
function usd(n){ return Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }
(async function(){
  var tok = curlJson(["-X","POST","https://openapi.tossinvest.com/oauth2/token","-H","Content-Type: application/x-www-form-urlencoded","-d","grant_type=client_credentials","-d","client_id="+process.env.TOSS_CLIENT_ID,"-d","client_secret="+process.env.TOSS_CLIENT_SECRET]);
  var token = tok.access_token;
  var auth = "Authorization: Bearer "+token;
  var acc = "X-Tossinvest-Account: 1";
  var hold = curlJson(["https://openapi.tossinvest.com/api/v1/holdings","-H",auth,"-H",acc]);
  var usdP = curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=USD","-H",auth,"-H",acc]);
  var krwP = curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=KRW","-H",auth,"-H",acc]);
  var fx = 1400;
  try {
    var fxr = curlJson(["https://openapi.tossinvest.com/api/v1/exchange-rate","-H",auth]);
    fx = Number((fxr.result && (fxr.result.usdKrw || fxr.result.rate || fxr.result.dealBaseRate)) || fxr.usdKrw || fx) || 1400;
  } catch(e) {}
  var r = hold.result || {};
  var usdCash = Number((usdP.result||{}).cashBuyingPower || 0);
  var krwCash = Number((krwP.result||{}).cashBuyingPower || 0);
  var stockUsd = Number((((r.marketValue||{}).amount||{}).usd) || 0);
  var costUsd = Number(((r.totalPurchaseAmount||{}).usd) || 0);
  var pnlUsd = Number((((r.profitLoss||{}).amount||{}).usd) || 0);
  var rate = Number((r.profitLoss||{}).rate || 0) * 100;
  var totalKrw = krwCash + (usdCash + stockUsd) * fx;
  var state = await loadState();
  var ledger = state.cashLedger || { entries:[], totalDepositKrw:0, totalWithdrawKrw:0, netInvestedKrw:0 };
  if (!ledger.netInvestedKrw) {
    ledger.totalDepositKrw = Math.round(totalKrw);
    ledger.totalWithdrawKrw = 0;
    ledger.netInvestedKrw = Math.round(totalKrw);
    ledger.entries = ledger.entries || [];
    ledger.entries.push({ id:"cash_baseline", type:"DEPOSIT", amountKrw:Math.round(totalKrw), note:"기준원금(토스총자산)", at:new Date().toISOString(), date:new Date().toISOString().slice(0,10) });
    await saveState(Object.assign({}, state, { cashLedger: ledger }));
  }
  var net = ledger.netInvestedKrw || 0;
  var pnlKrw = totalKrw - net;
  var pct = net ? (pnlKrw / net) * 100 : 0;
  var text = [
    "은행흐름",
    "총자산 "+won(totalKrw)+"원",
    "기준원금 "+won(net)+"원",
    "계좌손익 "+(pnlKrw>=0?"+":"")+won(pnlKrw)+"원 ("+(pct>=0?"+":"")+pct.toFixed(2)+"%)",
    "달러현금 $"+usd(usdCash)+" / 원화 "+won(krwCash)+"원",
    "주식평가 $"+usd(stockUsd)+" 원금 $"+usd(costUsd)+" 손익 $"+(pnlUsd>=0?"+":"")+usd(pnlUsd)+" ("+(rate>=0?"+":"")+rate.toFixed(2)+"%)",
    "환율 "+fx
  ].join("\n");
  curlJson(["-X","POST","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(text)]);
  console.log(JSON.stringify({ok:true,totalKrw:Math.round(totalKrw),net:net,fx:fx}));
})().catch(function(e){ console.error(e); process.exit(1); });
