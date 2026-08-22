
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { loadState, saveState } = require("./lib/state");
var { execFileSync } = require("child_process");
function tg(msg){
  execFileSync("curl",["-4","-s","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(msg)]);
}
function won(n){ return Math.round(Number(n)||0).toLocaleString("ko-KR"); }
(async function(){
  var text = process.argv.slice(2).join(" ").trim();
  var state = await loadState();
  var ledger = state.cashLedger || {entries:[],totalDepositKrw:0,totalWithdrawKrw:0,netInvestedKrw:0,fxEntries:[]};
  ledger.entries = ledger.entries || [];
  ledger.fxEntries = ledger.fxEntries || [];

  // /in 1000000 메모
  var mIn = text.match(/^\/(in|입금)\s+([0-9,.]+)\s*(.*)$/i);
  // /out 500000 메모
  var mOut = text.match(/^\/(out|출금)\s+([0-9,.]+)\s*(.*)$/i);
  // /fx 3000000 2150.50 1395.0 2026-08-15   (원화 달러 환율 [일자])
  // /환전 동일
  var mFx = text.match(/^\/(fx|환전)\s+([0-9,.]+)\s+([0-9,.]+)\s+([0-9,.]+)\s*([0-9-]{10})?\s*(.*)$/i);

  if (mIn) {
    var amt = Number(String(mIn[2]).replace(/,/g,""));
    var note = (mIn[3]||"").trim();
    ledger.totalDepositKrw = (ledger.totalDepositKrw||0)+amt;
    ledger.netInvestedKrw = (ledger.totalDepositKrw||0)-(ledger.totalWithdrawKrw||0);
    ledger.entries.push({id:"in_"+Date.now(),type:"DEPOSIT",amountKrw:amt,note:note,at:new Date().toISOString(),date:new Date().toISOString().slice(0,10)});
    await saveState(Object.assign({},state,{cashLedger:ledger}));
    tg("입금 "+won(amt)+"원 반영\n기준원금 "+won(ledger.netInvestedKrw)+"원"+(note?"\n"+note:""));
    console.log(JSON.stringify({ok:true,type:"DEPOSIT",amt:amt}));
    return;
  }
  if (mOut) {
    var amt2 = Number(String(mOut[2]).replace(/,/g,""));
    var note2 = (mOut[3]||"").trim();
    ledger.totalWithdrawKrw = (ledger.totalWithdrawKrw||0)+amt2;
    ledger.netInvestedKrw = (ledger.totalDepositKrw||0)-(ledger.totalWithdrawKrw||0);
    ledger.entries.push({id:"out_"+Date.now(),type:"WITHDRAW",amountKrw:amt2,note:note2,at:new Date().toISOString(),date:new Date().toISOString().slice(0,10)});
    await saveState(Object.assign({},state,{cashLedger:ledger}));
    tg("출금 "+won(amt2)+"원 반영\n기준원금 "+won(ledger.netInvestedKrw)+"원"+(note2?"\n"+note2:""));
    console.log(JSON.stringify({ok:true,type:"WITHDRAW",amt:amt2}));
    return;
  }
  if (mFx) {
    var krw = Number(String(mFx[2]).replace(/,/g,""));
    var usd = Number(String(mFx[3]).replace(/,/g,""));
    var rate = Number(String(mFx[4]).replace(/,/g,""));
    var date = (mFx[5]||new Date().toISOString().slice(0,10)).trim();
    var note3 = (mFx[6]||"").trim();
    if (!(krw>0 && usd>0 && rate>0)) {
      tg("형식: /환전 원화 달러 환율 [일자]\n예: /환전 3000000 2158.27 1390.0 2026-08-15");
      return;
    }
    ledger.fxEntries.push({
      id:"fx_"+Date.now(),
      date: date,
      krw: krw,
      usd: usd,
      rate: rate,
      note: note3,
      at: new Date().toISOString()
    });
    // 환전은 입금과 별개 원장. 기준원금은 입금/출금만. 환전 합계만 별도 표시
    await saveState(Object.assign({},state,{cashLedger:ledger}));
    var sumKrw = ledger.fxEntries.reduce(function(s,e){return s+Number(e.krw||0);},0);
    var sumUsd = ledger.fxEntries.reduce(function(s,e){return s+Number(e.usd||0);},0);
    var avg = sumUsd>0 ? (sumKrw/sumUsd) : rate;
    tg(
      "환전 기록\n"+
      date+"\n"+
      "원화 "+won(krw)+"원\n"+
      "달러 $"+usd.toFixed(2)+"\n"+
      "환율 "+rate+"\n"+
      (note3?note3+"\n":"")+
      "누적 환전 "+won(sumKrw)+"원 / $"+sumUsd.toFixed(2)+" (평균 "+avg.toFixed(2)+")"
    );
    console.log(JSON.stringify({ok:true,type:"FX",krw:krw,usd:usd,rate:rate,date:date}));
    return;
  }

  tg("형식\n/in 1000000 메모\n/out 500000 메모\n/환전 3000000 2158.27 1390.0 2026-08-15");
})().catch(function(e){ console.error(e); process.exit(1); });
