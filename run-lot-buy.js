
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
var { isUsTradingDay } = require("./lib/trading-day");
var { SHARE_LOT_SYMBOLS, TICKERS } = require("./lib/config");
var { ensureBudget, creditIfNeeded, decideBuy } = require("./lib/lot-budget");
var { loadState, saveState } = require("./lib/state");
var phase = process.argv[2] || "first";
function curlJson(args) {
  var out = execFileSync("curl", ["-4","-s","--max-time","25"].concat(args), {encoding:"utf8"});
  return JSON.parse(out || "{}");
}
function token() {
  var t = curlJson(["-X","POST","https://openapi.tossinvest.com/oauth2/token","-H","Content-Type: application/x-www-form-urlencoded","-d","grant_type=client_credentials","-d","client_id="+process.env.TOSS_CLIENT_ID,"-d","client_secret="+process.env.TOSS_CLIENT_SECRET]);
  if (!t.access_token) throw new Error("token fail "+JSON.stringify(t).slice(0,200));
  return t.access_token;
}
(async function(){
  var logs = [];
  var now = new Date();
  if (!isUsTradingDay(now) && phase === "first") {
    console.log(JSON.stringify({ok:true,phase,logs:["미국 휴장 → 예산매수 스킵"]}));
    return;
  }
  var tk = token();
  var auth = "Authorization: Bearer "+tk;
  var acc = "X-Tossinvest-Account: 1";
  var state = await loadState();
  var lotBudget = ensureBudget(state);
  var tradingDate = now.toISOString().slice(0,10);
  if (phase === "first") logs.push.apply(logs, creditIfNeeded(lotBudget, tradingDate));
  var prices = curlJson(["https://openapi.tossinvest.com/api/v1/prices?symbols="+SHARE_LOT_SYMBOLS.join(","),"-H",auth]);
  var priceMap = {};
  (prices.result||[]).forEach(function(p){ priceMap[p.symbol]=Number(p.lastPrice); });
  var usd = curlJson(["https://openapi.tossinvest.com/api/v1/buying-power?currency=USD","-H",auth,"-H",acc]);
  var usdCash = Number((usd.result||{}).cashBuyingPower||0);
  var fx = 1400;
  try {
    var fxr = curlJson(["https://openapi.tossinvest.com/api/v1/exchange-rate","-H",auth]);
    fx = Number((fxr.result&& (fxr.result.usdKrw||fxr.result.rate)) || fxr.usdKrw || fx) || 1400;
  } catch(e) {}
  for (var i=0;i<SHARE_LOT_SYMBOLS.length;i++){
    var sym = SHARE_LOT_SYMBOLS[i];
    var slot = lotBudget[sym];
    var last = priceMap[sym];
    var shareKrw = last ? last * fx : 0;
    var candles = curlJson(["https://openapi.tossinvest.com/api/v1/candles?symbol="+sym+"&interval=1d&count=5","-H",auth]);
    var cs = (candles.result && candles.result.candles) || candles.candles || [];
    var prevClose = cs.length>=2 ? Number(cs[1].closePrice||cs[cs.length-2].closePrice) : 0;
    if (phase==="retry"){
      if(!slot.pendingOrderId){ logs.push(sym+" 재시도 없음"); continue; }
      var cxl = curlJson(["-X","POST","https://openapi.tossinvest.com/api/v1/orders/"+slot.pendingOrderId+"/cancel","-H",auth,"-H",acc]);
      logs.push(sym+" 취소 "+JSON.stringify(cxl).slice(0,80));
      if (slot.reservedKrw){ slot.krw += Number(slot.reservedKrw); slot.reservedKrw=0; }
      slot.pendingOrderId=null;
    }
    var d = decideBuy({ lastPrice:last, prevClose:prevClose, shareKrw:shareKrw, budgetKrw:slot.krw });
    logs.push(sym+" "+d.action+" "+d.reason);
    if (d.action!=="BUY") continue;
    if (usdCash < last){ logs.push(sym+" 달러부족 $"+usdCash); continue; }
    var body = JSON.stringify({symbol:sym,side:"BUY",orderType:"LIMIT",quantity:"1",price:String(d.limit),timeInForce:"DAY",clientOrderId:("lot-"+sym+"-"+tradingDate+"-"+phase).slice(0,36)});
    var order = curlJson(["-X","POST","https://openapi.tossinvest.com/api/v1/orders","-H",auth,"-H",acc,"-H","Content-Type: application/json","-d",body]);
    logs.push(sym+" order "+JSON.stringify(order).slice(0,180));
    slot.pendingOrderId = (order.result&&order.result.orderId)||order.orderId||null;
    slot.lastBuyDate = tradingDate;
    slot.reservedKrw = shareKrw;
    slot.krw = Math.max(0, Number(slot.krw)-shareKrw);
    curlJson(["-X","POST","https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/sendMessage","-d","chat_id="+process.env.TELEGRAM_CHAT_ID,"-d","text="+encodeURIComponent(sym+" 예산매수 1주 $"+d.limit+" 잔여예산 "+Math.round(slot.krw)+"원")]);
  }
  await saveState(Object.assign({}, state, {lotBudget:lotBudget}));
  console.log(JSON.stringify({ok:true,phase:phase,logs:logs}));
})().catch(function(e){ console.error(e); process.exit(1); });
