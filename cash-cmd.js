
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { loadState, saveState } = require("./lib/state");
var { execFileSync } = require("child_process");
(async function(){
  var text = process.argv.slice(2).join(" ").trim();
  var m = text.match(/^\/(in|out)\s+([0-9,]+)\s*(.*)$/i);
  if (!m) {
    execFileSync("curl",["-4","-s","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent("형식: /in 1000000 월급  또는  /out 500000")]);
    return;
  }
  var type = m[1].toLowerCase()==="in" ? "DEPOSIT" : "WITHDRAW";
  var amt = Number(String(m[2]).replace(/,/g,""));
  var note = (m[3]||"").trim();
  var state = await loadState();
  var ledger = state.cashLedger || {entries:[],totalDepositKrw:0,totalWithdrawKrw:0,netInvestedKrw:0};
  if (type==="DEPOSIT") ledger.totalDepositKrw=(ledger.totalDepositKrw||0)+amt;
  else ledger.totalWithdrawKrw=(ledger.totalWithdrawKrw||0)+amt;
  ledger.netInvestedKrw=(ledger.totalDepositKrw||0)-(ledger.totalWithdrawKrw||0);
  ledger.entries=ledger.entries||[];
  ledger.entries.push({id:"cmd_"+Date.now(),type:type,amountKrw:amt,note:note,at:new Date().toISOString(),date:new Date().toISOString().slice(0,10)});
  await saveState(Object.assign({},state,{cashLedger:ledger}));
  var msg = (type==="DEPOSIT"?"입금 ":"출금 ")+amt.toLocaleString("ko-KR")+"원 반영 / 기준원금 "+ledger.netInvestedKrw.toLocaleString("ko-KR")+"원";
  execFileSync("curl",["-4","-s","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(msg)]);
  console.log(JSON.stringify({ok:true,type:type,amt:amt,net:ledger.netInvestedKrw}));
})().catch(function(e){ console.error(e); process.exit(1); });
