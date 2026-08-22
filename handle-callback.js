
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

  // 1) 실제 매도 주문
  var orderResult;
  try {
    orderResult = await toss.createSellOrder({
      symbol: pending.symbol,
      quantity: String(pending.quantity),
      orderType: "MARKET",
      clientOrderId: "evz_"+approvalId
    });
  } catch (e) {
    await tg.answerCallback(callback.id, "매도 실패");
    await tg.editMessage(
      callback.message.chat.id,
      callback.message.message_id,
      "매도 실패\n"+pending.symbol+" / "+pending.rule+"\n"+String(e.message||e).slice(0,200)
    );
    console.log(JSON.stringify({ok:false,action:"sell_failed",error:String(e.message||e)}));
    return; // 재투자·대여랏 생성 안 함
  }

  // 2) 주문 성공 후에만 상태 반영
  var state = await loadState();
  var approxProceeds = Number(pending.quantity) * Number(pending.lastPrice || 0);
  state.reinvestSchedules = state.reinvestSchedules || [];
  state.hostedLots = state.hostedLots || [];

  var moneyFlowNote = "";

  if (pending.rule === "RULE4_ATH_TRAIL") {
    // 시가 근사: 보유수량 × 해당 종목 최근가 (가능하면 API, 실패 시 pending 가격)
    var marketValues = {};
    var priceMap = {};
    try {
      var prices = await toss.getPrices(MAIN_SYMBOLS);
      var list = prices && prices.result ? prices.result : (Array.isArray(prices) ? prices : []);
      list.forEach(function(p){ if (p && p.symbol) priceMap[p.symbol] = Number(p.lastPrice||p.price||0); });
    } catch (_) {}
    MAIN_SYMBOLS.forEach(function(s){
      var qty = (state.positions && state.positions[s] && state.positions[s].quantity) || 0;
      var px = priceMap[s] || (s === pending.symbol ? Number(pending.lastPrice||0) : 0);
      marketValues[s] = Number(qty) * Number(px);
    });
    // 매도 직후 해당 종목 평가액은 0에 가깝게
    marketValues[pending.symbol] = 0;

    var wf = waterfill(approxProceeds, buildWaterfillTargets(pending.symbol, marketValues, {}));
    wf.allocations.forEach(function(alloc){
      state.hostedLots.push(createHostedLot({
        origin: pending.symbol,
        host: alloc.symbol,
        principal: alloc.amount
      }));
      state.reinvestSchedules.push(createReinvestSchedule(alloc.amount, alloc.symbol, "RULE4_HOSTED"));
    });
    if (wf.remainder > 1) {
      state.reinvestSchedules.push(createReinvestSchedule(wf.remainder, "TECL", "CASH_PARKING"));
    }
    moneyFlowNote = "규칙4 워터필 "+wf.allocations.length+"종목"+(wf.remainder>1?" +TECL주차":"");
  } else {
    // 규칙1·2·3: 자기 종목 15일 재투자
    state.reinvestSchedules.push(createReinvestSchedule(approxProceeds, pending.symbol, pending.rule));
    moneyFlowNote = "15일 재투자 → "+pending.symbol;
  }

  recordTrade(state, {
    symbol: pending.symbol,
    side: "SELL",
    rule: pending.rule,
    quantity: pending.quantity,
    price: pending.lastPrice,
    amount: approxProceeds,
    note: "승인매도 "+pending.rule
  });

  await saveState(state);
  await clearPendingApproval(approvalId);

  await tg.answerCallback(callback.id, "매도 주문 완료");
  await tg.editMessage(
    callback.message.chat.id,
    callback.message.message_id,
    "매도 실행 완료\n"+pending.symbol+" / "+pending.rule+
    "\n수량 "+pending.quantity+
    "\n"+moneyFlowNote
  );
  console.log(JSON.stringify({
    ok:true,
    action:"approved",
    order: orderResult && orderResult.result || orderResult,
    moneyFlow: moneyFlowNote
  }));
})().catch(function(e){ console.error(e); process.exit(1); });
