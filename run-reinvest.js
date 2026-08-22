
require("fs").readFileSync(".env","utf8").split("\n").forEach(function(l){
  l=l.trim(); if(!l||l[0]==="#") return;
  var i=l.indexOf("="); if(i>0) process.env[l.slice(0,i)]=l.slice(i+1);
});
var handler = require("./api/run-reinvest");
var req = {}, res = {
  status: function(c){ this._c=c; return this; },
  json: function(o){ console.log(JSON.stringify(o)); return this; }
};
handler(req, res).catch(function(e){ console.error(e); process.exit(1); });
