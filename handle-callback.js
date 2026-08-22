
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { TossClient } = require("./lib/toss");
var { TelegramBot } = require("./lib/telegram");
var { getPendingApproval, clearPendingApproval, loadState, saveState, recordTrade } = require("./lib/state");
var { createReinvestSchedule, createHostedLot, buildWaterfillTargets, waterfill } = require("./lib/hosted-lots");
var { MAIN_SYMBOLS } = require("./lib/config");

var update = JSON.parse(process.argv[2] || "{}");
var callback = update.callback_query;
if (!callback) { console.log(JSON.stringify({ok:true,skip:true})); process.exit(0); }

(async function(){
  var tg = new TelegramBot({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
  var toss = new TossClient({
    clientId: process.env.TOSS_CLIENT_ID,
    clientSecret: process.env.TOSS_CLIENT_SECRET,
    accountSeq: Number(process.env.TOSS_ACCOUNT_SEQ || 1)
  });
  var data = callback.data || "";
  var parts = data.split(":");
  var action = parts[0], symbol = parts[1], rule = parts[2], approvalId = parts[3];

  if (action === "reject") {
    await clearPendingApproval(approvalId);
    await tg.answerCallback(callback.id, "거부되었습니다.");
    await tg.editMessage(callback.message.chat.id, callback.message.message_id, "거부됨\n"+symbol+" / "+rule);
    console.log(JSON.stringify({ok:true,action:"rejected"}));
    return;
  }
  if (action !== "approve") {
    await tg.answerCallback(callback.id, "알 수 없는 요청");
    console.log(JSON.stringify({ok:true,action:"unknown"}));
    return;
  }
  var pending = await getPendingApproval(approvalId);
  if (!pending) {
    await tg.answerCallback(callback.id, "이미 처리되었거나 만료된 요청입니다.");
    console.log(JSON.stringify({ok:false,error:"not_found"}));
    return;
  }
  var orderResult = await toss.createSellOrder({
    symbol: pending.symbol,
    quantity: String(pending.quantity),
    orderType: "MARKET",
    clientOrderId: "evz_"+approvalId
  });
  var state = await loadState();
  var approxProceeds = Number(pending.quantity) * Number(pending.lastPrice);
  state.reinvestSchedules = state.reinvestSchedules || [];
  state.hostedLots = state.hostedLots || [];
  if (pending.rule === "RULE4_ATH_TRAIL") {
    var marketValues = {};
    for (var s of MAIN_SYMBOLS) marketValues[s] = (state.positions && state.positions[s] && state.positions[s].quantity || 0) * (pending.lastPrice || 0);
    var wf = waterfill(approxProceeds, buildWaterfillTargets(pending.symbol, marketValues, {}));
    wf.allocations.forEach(function(alloc){
      state.hostedLots.push(createHostedLot({ origin: pending.symbol, host: alloc.symbol, principal: alloc.amount }));
      state.reinvestSchedules.push(createReinvestSchedule(alloc.amount, alloc.symbol, "RULE4_HOSTED"));
    });
    if (wf.remainder > 0) state.reinvestSchedules.push(createReinvestSchedule(wf.remainder, "TECL", "CASH_PARKING"));
  } else {
    state.reinvestSchedules.push(createReinvestSchedule(approxProceeds, pending.symbol, pending.rule));
  }
  recordTrade(state, { symbol: pending.symbol, side: "SELL", rule: pending.rule, quantity: pending.quantity, price: pending.lastPrice, amount: approxProceeds, note: "승인매도 "+pending.rule });
  await saveState(state);
  await clearPendingApproval(approvalId);
  await tg.answerCallback(callback.id, "매도 주문 완료");
  await tg.editMessage(callback.message.chat.id, callback.message.message_id, "매도 실행 완료\n"+pending.symbol+" / "+pending.rule);
  console.log(JSON.stringify({ok:true,action:"approved",order:orderResult&&orderResult.result||orderResult}));
})().catch(function(e){ console.error(e); process.exit(1); });
