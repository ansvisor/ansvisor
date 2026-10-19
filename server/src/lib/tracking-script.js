/**
 * The tracking snippet (t.js), built from the AI source list (AT-004) so the
 * snippet counts exactly what the Google Analytics sync counts, the same
 * way: a referrer host that is a listed host or one of its subdomains, else
 * a utm_source tag matched the same way (ChatGPT adds utm_source=chatgpt.com
 * to its links). A source with a referrerPath (Bing's /ck/a, its Copilot
 * answers) counts only when the referrer carries that path.
 *
 * It sends the source's key, not the host it saw, so chat.openai.com and
 * chatgpt.com are stored as one engine, and the list's version, stored with
 * the visit.
 *
 * Plain ES5 apart from URL / URLSearchParams, as before: it runs on the
 * customer's pages, in whatever browser their visitors have.
 */

import { AI_SOURCES, AI_SOURCES_VERSION } from './ai-sources.js';

/** The list in the snippet's compact shape: k key, h hosts, a aliases, p referrer path, u 0 = not by utm. */
export function snippetSources() {
  return AI_SOURCES.map((source) => ({
    k: source.key,
    h: source.hosts,
    a: source.aliases,
    ...(source.referrerPath ? { p: source.referrerPath } : {}),
    ...(source.utm === false ? { u: 0 } : {}),
  }));
}

export function buildTrackingScript() {
  return `(function(){
if(window.__at)return;
var S=${JSON.stringify(snippetSources())},V=${JSON.stringify(AI_SOURCES_VERSION)};
var r=document.referrer,h="";
try{h=new URL(r).hostname}catch(e){}
function m(x,utm){
x=String(x||"").replace(/^\\s+|\\s+$/g,"").toLowerCase().replace(/^www\\./,"");
if(!x)return"";
for(var i=0;i<S.length;i++){
var e=S[i];
if(utm?e.u===0:e.p&&r.indexOf(e.p)===-1)continue;
if(e.a.indexOf(x)!==-1)return e.k;
for(var j=0;j<e.h.length;j++){var d=e.h[j];if(x===d||x.slice(-d.length-1)==="."+d)return e.k}
}
return"";
}
var pf=m(h,false);
if(!pf){try{pf=m(new URLSearchParams(location.search).get("utm_source"),true)}catch(e){}}
if(!pf)return;
window.__at=1;
var c=document.currentScript,k=c.getAttribute("data-t"),o=c.src.replace(/\\/t\\.js(\\?.*)?$/,"");
var b=JSON.stringify({u:location.href,r:r,s:pf,v:V,a:navigator.userAgent,t:Date.now(),l:navigator.language,d:screen.width+"x"+screen.height});
var x=o+"/track/"+k;
if(navigator.sendBeacon)navigator.sendBeacon(x,new Blob([b],{type:"text/plain;charset=UTF-8"}));
else fetch(x,{method:"POST",body:b,headers:{"Content-Type":"text/plain;charset=UTF-8"},keepalive:!0}).catch(function(){});
})();
`;
}
