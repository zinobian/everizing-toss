
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
var { loadState, saveState } = require("./lib/state");
function curlJson(args){ return JSON.parse(execFileSync("curl",["-4","-s","--max-time","20"].concat(args),{encoding:"utf8"})||"{}"); }
function won(n){ return Math.round(Number(n)||0).toLocaleString("ko-KR"); }
(async function(){
  var tok=curlJson(["-X","POST","https://openapi.tossinvest.com/oauth2/token","-H","Content-Type: application/x-www-form-urlencoded","-d","grant_type=client_credentials","-d","client_id="+process.env.TOSS_CLIENT_ID,"-d","client_secret="+process.env.TOSS_CLIENT_SECRET]);
  var auth="Authorization: Bearer "+tok.access_token, acc="X-Tossinvest-Account: 1";
  var usdP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=USD","-H",auth,"-H",acc]);
  var krwP=curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=KRW","-H",auth,"-H",acc]);
  var usdCash=Number((usdP.result||{}).cashBuyingPower||0);
  var krwCash=Number((krwP.result||{}).cashBuyingPower||0);
  var state=await loadState();
  var prev=state.lastCashSnap;
  var msgs=[];
  if (prev) {
    var dUsd=usdCash-Number(prev.usdCash||0);
    var dKrw=krwCash-Number(prev.krwCash||0);
    if (dUsd>=20) msgs.push("달러입금 +$"+dUsd.toFixed(2));
    if (dUsd<=-20) msgs.push("달러출금 $"+dUsd.toFixed(2));
    if (dKrw>=10000) msgs.push("원화입금 +"+won(dKrw)+"원");
    if (dKrw<=-10000) msgs.push("원화출금 "+won(dKrw)+"원");
    if (msgs.length) {
      var ledger=state.cashLedger||{entries:[],totalDepositKrw:0,totalWithdrawKrw:0,netInvestedKrw:0};
      var fx=1391;
      try {
        var fxr=curlJson(["https://openapi.tossinvest.com/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW","-H",auth]);
        fx=Number((fxr.result&&fxr.result.rate)||fx);
      } catch(e){}
      var amt=Math.round(dUsd*fx + dKrw);
      if (amt>0){ ledger.totalDepositKrw=(ledger.totalDepositKrw||0)+amt; }
      if (amt<0){ ledger.totalWithdrawKrw=(ledger.totalWithdrawKrw||0)+Math.abs(amt); }
      ledger.netInvestedKrw=(ledger.totalDepositKrw||0)-(ledger.totalWithdrawKrw||0);
      ledger.entries=ledger.entries||[];
      ledger.entries.push({id:"auto_"+Date.now(),type:amt>=0?"DEPOSIT":"WITHDRAW",amountKrw:Math.abs(amt),note:msgs.join(", "),at:new Date().toISOString(),date:new Date().toISOString().slice(0,10)});
      state.cashLedger=ledger;
      curlJson(["-X","POST","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent("자금변동 "+msgs.join(" / "))]);
    }
  }
  state.lastCashSnap={usdCash:usdCash,krwCash:krwCash,at:new Date().toISOString()};
  await saveState(state);
  console.log(JSON.stringify({ok:true,usdCash:usdCash,krwCash:krwCash,events:msgs}));
})().catch(function(e){ console.error(e); process.exit(1); });
