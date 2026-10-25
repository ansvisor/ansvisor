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
 * the visit. The landing URL goes whole: the server reads a surface from its
 * utm_medium (ChatGPT Shopping's feed links, #1283), so the snippet needn't
 * know the surfaces, and a cached older copy of it counts them too.
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
 * Conversions (CE-017, 00286), only on a brand that turned them on and
 * installed the tag with data-c="1": everything above stays as it was
 * without it, and nothing is kept in the browser. With it, a visitor who
 * came from an AI assistant gets a random id (ansvisor_v in localStorage,
 * with the first AI visit: source, page and time), and the snippet sends
 * the pages they go on to (k: "pv"), the forms they send and the site's
 * own ansvisor('conversion', …) calls (k: "cv"), each with that first
 * visit, for 30 days from it (first touch). The id is kept only once the
 * site says the visitor agreed (data-consent="wait", the default):
 * ansvisor('consent', 'granted'), or Google Consent Mode granting
 * analytics_storage. Until then events wait on the page; ansvisor('consent',
 * 'denied'), or Consent Mode taking analytics_storage back, deletes the id.
 * data-consent="always" keeps it at once, for a site whose own banner
 * covers it. Pages go without their query string, forms without anything
 * typed in them.
 *
 * Forms: one with an email field counts as a signup, unless it says
 * otherwise (data-ansvisor-goal="demo", "newsletter"…) or opts out
 * (data-ansvisor="off"); one with a password field (a login) counts only
 * when it says which goal it is. ansvisor() may be called before t.js
 * loads (from GTM, say) through the usual queue stub.
 *
 * Plain ES5 apart from URL / URLSearchParams, as before: it runs on the
 * customer's pages, in whatever browser their visitors have.
 */

/** The goals a conversion can be (traffic-events.js CONVERSION_GOALS). */
const GOALS = ['signup', 'demo', 'order', 'booking', 'newsletter', 'custom'];

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
var c=document.currentScript,cv=!!c&&c.getAttribute("data-c")==="1";
if(!pf&&!cv)return;
window.__at=1;
var k=c.getAttribute("data-t"),o=c.src.replace(/\\/t\\.js(\\?.*)?$/,"");
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
if(pf){
var nf=nfOf(document.title||"");
post({u:u,r:r,s:pf,v:V,a:navigator.userAgent,t:Date.now(),l:navigator.language,d:screen.width+"x"+screen.height,st:st,nf:nf});
if(!nf&&(!st||st>199&&st<300)){
var again=function(){setTimeout(function(){if(nfOf(document.title||""))post({k:"nf",u:u,s:pf,a:navigator.userAgent,st:st})},1500)};
if(document.readyState==="complete")again();else window.addEventListener("load",again);
}
}
if(!cv)return;
var G=${JSON.stringify(GOALS)},K="ansvisor_v",W=2592e6,now=Date.now();
var ok=c.getAttribute("data-consent")==="always",q=[],v=null,old=!1,last="";
function here(){return location.origin+location.pathname}
try{var j=JSON.parse(localStorage.getItem(K)||"null");if(j&&j.id&&j.f&&now-j.f.at<W){v=j;old=!0}}catch(e){}
if(!v&&pf){
var a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",id="",rb=null;
try{rb=crypto.getRandomValues(new Uint8Array(22))}catch(e){}
for(var i=0;i<22;i++)id+=a.charAt((rb?rb[i]:Math.floor(Math.random()*256))&63);
v={id:id,f:{s:pf,u:here(),at:now}};
}
function keep(){if(v)try{localStorage.setItem(K,JSON.stringify(v))}catch(e){}}
function send(d){if(!v)return;d.id=v.id;d.f=v.f;d.u=d.u||here();if(ok)post(d);else q.push(d)}
function grant(){if(ok&&!q.length){keep();return}ok=!0;keep();var w=q;q=[];for(var i=0;i<w.length;i++)post(w[i])}
function deny(){ok=!1;q=[];v=null;try{localStorage.removeItem(K)}catch(e){}}
function pv(){var p=here();if(p===last)return;last=p;send({k:"pv"})}
if(ok)keep();
if(old)pv();else last=here();
function cmd(t,a){
if(t==="consent"){if(a==="granted")grant();else if(a==="denied")deny();return}
if(t!=="conversion")return;
a=a||{};
var g=String(a.type||a.goal||"custom"),known=G.indexOf(g)!==-1,d={k:"cv",g:known?g:"custom",o:"call"};
if(a.label||!known)d.n=String(a.label||g).slice(0,80);
if(typeof a.value==="number")d.val=a.value;
if(a.currency)d.cur=String(a.currency);
if(typeof a.units==="number")d.q=a.units;
if(a.order!=null)d.ref=String(a.order);
send(d);
}
var Q=window.ansvisor&&window.ansvisor.q||[];
window.ansvisor=function(t,a){cmd(t,a)};
for(var i=0;i<Q.length;i++)cmd(Q[i][0],Q[i][1]);
function gcm(it){
if(!it||it[0]!=="consent"||!it[2]||!it[2].analytics_storage)return;
if(it[2].analytics_storage==="granted")grant();else if(it[1]==="update")deny();else ok=!1;
}
var dl=window.dataLayer;
if(dl&&dl.push){for(var i=0;i<dl.length;i++)gcm(dl[i]);var dp=dl.push;dl.push=function(){for(var i=0;i<arguments.length;i++)gcm(arguments[i]);return dp.apply(dl,arguments)}}
document.addEventListener("submit",function(e){
var f=e.target;
if(!v||!f||f.tagName!=="FORM"||f.getAttribute("data-ansvisor")==="off")return;
var g=f.getAttribute("data-ansvisor-goal");
if(!g){if(f.querySelector("input[type=password]")||!f.querySelector("input[type=email]"))return;g="signup"}
var d={k:"cv",g:G.indexOf(g)!==-1?g:"custom",o:"form"},n=f.getAttribute("data-ansvisor-label")||f.id||f.getAttribute("name");
if(n)d.n=String(n).slice(0,80);
send(d);
},!0);
var hp=window.history&&history.pushState;
if(hp)history.pushState=function(){var res=hp.apply(history,arguments);pv();return res};
window.addEventListener("popstate",pv);
})();
`;
}
