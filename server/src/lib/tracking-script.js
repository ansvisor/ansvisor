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
 * 404), while "How we fixed our 404s" is an ordinary page.
 *
 * The beacon goes a moment after the page has loaded, so such an app has
 * set its title, or as the visitor leaves, whichever comes first; with the
 * address and time the visit landed with.
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
var u=location.href,t0=Date.now(),st=0,sent=0;
try{var n=performance.getEntriesByType("navigation")[0];st=n&&n.responseStatus||0}catch(e){}
function send(){
if(sent)return;sent=1;
var ti=document.title||"",nf=0;
if(!st){if(/(^|[^0-9])404([^0-9]|$)|not found/i.test(ti))nf=1}
else if(st>199&&st<300&&/(^|[|:\\u00b7\\u2022\\u2013\\u2014-]\\s*)(404 page not found|404 not found|404 error|error 404|page not found|not found|404)\\s*([|:\\u00b7\\u2022\\u2013\\u2014-]|$)/i.test(ti))nf=1;
var b=JSON.stringify({u:u,r:r,s:pf,v:V,a:navigator.userAgent,t:t0,l:navigator.language,d:screen.width+"x"+screen.height,st:st,nf:nf});
var x=o+"/track/"+k;
if(navigator.sendBeacon)navigator.sendBeacon(x,new Blob([b],{type:"text/plain;charset=UTF-8"}));
else fetch(x,{method:"POST",body:b,headers:{"Content-Type":"text/plain;charset=UTF-8"},keepalive:!0}).catch(function(){});
}
function later(){setTimeout(send,1500)}
if(document.readyState==="complete")later();else window.addEventListener("load",later);
window.addEventListener("pagehide",send);
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")send()});
})();
`;
}
