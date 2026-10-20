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
 * It also sends the landing page's HTTP status as the browser saw it, for
 * Broken AI links (AT-012): st, from the navigation entry, or 0 where the
 * browser doesn't report one (Safari); then nf is 1 when the page's title
 * reads "404" or "not found". With a 2xx, nf is 1 only when the title is
 * the not-found page's own ("404", "Page not found | Acme"): a single-page
 * app answers every path with 200 and shows its own not-found route (a soft
 * 404), while "How we fixed our 404s" is an ordinary page. Both patterns are
 * English only: "Seite nicht gefunden" reads as a working page.
 *
 * The visit's beacon goes at once, as it always has, so the visits counted
 * don't depend on the page loading. Such an app sets its title later, so
 * when the title didn't read not found, the snippet reads it again a moment
 * after load and, if it now does, sends k: "nf" for the address it landed
 * on: the server marks that visit's pageview, it doesn't count another
 * (gkhngyk on #1247).
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
var u=location.href,st=0,x=o+"/track/"+k;
try{var n=performance.getEntriesByType("navigation")[0];st=n&&n.responseStatus||0}catch(e){}
function post(d){
var b=JSON.stringify(d);
if(navigator.sendBeacon)navigator.sendBeacon(x,new Blob([b],{type:"text/plain;charset=UTF-8"}));
else fetch(x,{method:"POST",body:b,headers:{"Content-Type":"text/plain;charset=UTF-8"},keepalive:!0}).catch(function(){});
}
function nfOf(ti){
if(!st)return /(^|[^0-9])404([^0-9]|$)|not found/i.test(ti)?1:0;
return st>199&&st<300&&/(^|[|:\\u00b7\\u2022\\u2013\\u2014-]\\s*)(404 page not found|404 not found|404 error|error 404|page not found|not found|404)\\s*([|:\\u00b7\\u2022\\u2013\\u2014-]|$)/i.test(ti)?1:0;
}
var nf=nfOf(document.title||"");
post({u:u,r:r,s:pf,v:V,a:navigator.userAgent,t:Date.now(),l:navigator.language,d:screen.width+"x"+screen.height,st:st,nf:nf});
if(!nf&&(!st||st>199&&st<300)){
var again=function(){setTimeout(function(){if(nfOf(document.title||""))post({k:"nf",u:u,s:pf,a:navigator.userAgent,st:st})},1500)};
if(document.readyState==="complete")again();else window.addEventListener("load",again);
}
})();
`;
}
