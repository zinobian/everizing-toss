
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var { execFileSync } = require("child_process");
function curlJson(args){
  return JSON.parse(execFileSync("curl",["-4","-s","--max-time","20"].concat(args),{encoding:"utf8"})||"{}");
}
var fs=require("fs");
var offsetFile="/tmp/tg-offset";
var offset=0;
try { offset=Number(fs.readFileSync(offsetFile,"utf8")||0); } catch(e){}
var data=curlJson(["https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/getUpdates?timeout=0&offset="+offset]);
var updates=data.result||[];
updates.forEach(function(u){
  offset=u.update_id+1;
  if (u.callback_query) {
    execFileSync("node",["handle-callback.js", JSON.stringify(u)],{cwd:"/home/ubuntu/everizing-toss",stdio:"inherit"});
    return;
  }
  var msg=u.message||{};
  var text=(msg.text||"").trim();
  var chat=String((msg.chat&&msg.chat.id)||"");
  if (chat && chat!==String(process.env.TELEGRAM_CHAT_ID)) return;
  if (text==="/port" || text==="/start") {
    execFileSync("node",["send-digest.js"],{cwd:"/home/ubuntu/everizing-toss",stdio:"inherit"});
  }
  if (text==="/cash") {
    execFileSync("node",["send-digest.js"],{cwd:"/home/ubuntu/everizing-toss",stdio:"inherit"});
  }
  if (text.indexOf("/in ")===0 || text.indexOf("/out ")===0) {
    execFileSync("node",["cash-cmd.js", text],{cwd:"/home/ubuntu/everizing-toss",stdio:"inherit"});
  }
});
fs.writeFileSync(offsetFile,String(offset));
console.log(JSON.stringify({ok:true,n:updates.length,offset:offset}));
