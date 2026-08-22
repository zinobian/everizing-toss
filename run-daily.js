require('fs').readFileSync('.env','utf8').split('\n').forEach(function(l){l=l.trim();if(!l||l[0]==='#')return;var i=l.indexOf('=');if(i>0)process.env[l.slice(0,i)]=l.slice(i+1);});
var h=require('./api/daily-signal');
h({},{status:function(){return this;},json:function(o){console.log(JSON.stringify(o));}}).catch(function(e){console.error(e);});


const { TossClient } = require("./lib/toss");
const { TelegramBot } = require("./lib/telegram");
