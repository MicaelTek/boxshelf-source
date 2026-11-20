// Interface language (Settings → Display → Language). Translates the UI as it's drawn instead of touching the strings in
// the code: text nodes and the placeholder / title / aria-label attributes whose whole text (trimmed) is in the chosen
// language's dictionary (renderer/locales/<lang>.js, window.BS_LOCALES[lang] = { strings: {en: tr}, rules: [[RegExp, tr]] }).
// Exact matches only, so game titles, paths and anything the player typed are never changed. English is the code itself:
// with ui.lang 'en' (or 'auto' on a non-matching system) this file does nothing. Text drawn on a canvas (the 3D museum,
// box spines) isn't covered. An element (or any ancestor) with data-no-i18n is left alone.
(function(){
"use strict";
const LS_KEY="bs-lang";
const ATTRS=["placeholder","title","aria-label","data-st"]; // data-st: the setup sidebar's status word, shown by CSS attr()
const SKIP=new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","SELECT","CODE","PRE","CANVAS","SVG"]);
let lang="en",dict=null,rules=[],obs=null,pending=new Set(),queued=false;
const memo=new Map(); // text → its pattern translation (or null): the shelf redraws the same strings over and over
// node → { o: original English, t: what we put there }: a node whose text is still our own translation is left alone,
// one the app rewrote is translated again, and switching back to English puts the originals back
const orig=new WeakMap(),attrOrig=new WeakMap();
const norm=s=>s.replace(/\s+/g," ").trim();

function supported(l){return !!(window.BS_LOCALES&&window.BS_LOCALES[l])}
function resolve(v){
  if(v&&v!=="auto")return supported(v)?v:"en";
  const nav=String(navigator.language||"").toLowerCase();
  if(nav.startsWith("pt")&&supported("pt-BR"))return "pt-BR";
  return "en";
}
function load(l){
  const L=l!=="en"&&window.BS_LOCALES&&window.BS_LOCALES[l];
  dict=null;rules=[];memo.clear();if(!L)return;
  dict=new Map();const s=L.strings||{};
  for(const k in s)if(s[k])dict.set(norm(k),s[k]);
  rules=(L.rules||[]).filter(r=>Array.isArray(r)&&r[0] instanceof RegExp);
  // patterns: {"Use your setup from Boxshelf {0}": "Use a configuração do Boxshelf {0}"}: each {n} matches any text, and
  // goes into the translation translated itself when the dictionary has it (a console or button name stays as it is)
  const P=L.patterns||{};
  for(const k in P){const to=P[k];if(!to)continue;
    const ks=norm(k),order=[];
    const src="^"+ks.split(/(\{\d\})/).map(p=>{const m=/^\{(\d)\}$/.exec(p);if(m){order.push(+m[1]);return "(.+?)"}return p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}).join("")+"$";
    if(!order.length)continue;
    let re;try{re=new RegExp(src)}catch{continue}
    rules.push([re,(...m)=>{const g={};order.forEach((n,i)=>{const v=m[i+1];g[n]=(dict.get(norm(v))||v)});return to.replace(/\{(\d)\}/g,(_,n)=>g[n]!=null?g[n]:"")}]);
  }
  // the most specific (longest literal text) first, so "{0} not found yet" wins over "{0} not found"
  rules.sort((a,b)=>b[0].source.replace(/\(\.\+\?\)/g,"").length-a[0].source.replace(/\(\.\+\?\)/g,"").length);
}
// one string: the dictionary first, then the pattern rules (anchored, so only a whole-string match counts)
function tr(src){
  if(!dict||!src)return null;
  const key=norm(src);if(!key||!/[A-Za-z]/.test(key))return null;
  let hit=dict.get(key);
  if(hit==null){
    if(memo.has(key))hit=memo.get(key);
    else{
      for(const [re,to] of rules){re.lastIndex=0;const m=re.exec(key);if(m&&m[0]===key){hit=typeof to==="function"?to(...m):key.replace(re,to);break}}
      if(memo.size>4000)memo.clear();memo.set(key,hit==null?null:hit);
    }
  }
  if(hit==null)return null;
  const lead=src.match(/^\s*/)[0],tail=src.match(/\s*$/)[0];return lead+hit+tail;
}
function skipped(el){
  for(let e=el;e&&e.nodeType===1;e=e.parentElement){
    if(SKIP.has(e.tagName.toUpperCase()))return true;
    if(e.hasAttribute("data-no-i18n")||e.isContentEditable)return true;
  }
  return false;
}
function doText(n){
  const cur=n.nodeValue,rec=orig.get(n);
  if(rec&&cur===rec.t)return; // still ours
  const src=cur; // new or rewritten by the app: this is the English
  if(!dict){if(rec&&cur===rec.t)n.nodeValue=rec.o;return}
  if(!n.parentElement||skipped(n.parentElement))return;
  const t=tr(src);
  if(t!=null&&t!==src){orig.set(n,{o:src,t});n.nodeValue=t}else orig.delete(n);
}
function doAttrs(el){
  if(skipped(el))return;
  let rec=attrOrig.get(el);
  for(const a of ATTRS){
    if(!el.hasAttribute(a))continue;
    const cur=el.getAttribute(a);
    if(rec&&rec[a]&&cur===rec[a].t)continue;
    const t=tr(cur);
    if(t!=null&&t!==cur){if(!rec){rec={};attrOrig.set(el,rec)}rec[a]={o:cur,t};el.setAttribute(a,t)}
    else if(rec)delete rec[a];
  }
}
function walk(root){
  if(!root)return;
  if(root.nodeType===3){doText(root);return}
  if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
  if(root.nodeType===1){if(skipped(root))return;doAttrs(root)}
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:n=>n.nodeType===1&&SKIP.has(n.tagName.toUpperCase())?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let n;while((n=w.nextNode())){if(n.nodeType===3)doText(n);else doAttrs(n)}
}
function flush(){
  queued=false;const list=[...pending];pending.clear();
  if(obs)obs.disconnect();
  try{for(const n of list)if(n.isConnected)walk(n)}finally{if(obs&&dict)observe()}
}
function queue(n){pending.add(n);if(!queued){queued=true;queueMicrotask(flush)}}
function observe(){
  if(!obs)obs=new MutationObserver(ms=>{for(const m of ms){
    if(m.type==="characterData")queue(m.target);
    else if(m.type==="attributes")queue(m.target);
    else for(const n of m.addedNodes)queue(n);
  }});
  obs.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
}
// back to English: every node we changed gets its original text again
function restore(root){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n;
  while((n=w.nextNode())){
    if(n.nodeType===3){const r=orig.get(n);if(r&&n.nodeValue===r.t)n.nodeValue=r.o;orig.delete(n)}
    else{const r=attrOrig.get(n);if(r){for(const a in r)if(n.getAttribute(a)===r[a].t)n.setAttribute(a,r[a].o);attrOrig.delete(n)}}
  }
}
function apply(v){
  const l=resolve(v);
  try{localStorage.setItem(LS_KEY,v||"auto")}catch{}
  if(l===lang&&(l==="en"||dict))return;
  if(obs)obs.disconnect();
  if(lang!=="en"&&document.documentElement)restore(document.documentElement);
  lang=l;load(l);
  if(document.documentElement)document.documentElement.lang=l==="en"?"en":l;
  if(dict){if(document.body)walk(document.body);observe()}
  window.dispatchEvent(new CustomEvent("bs-lang",{detail:{lang:l}}));
}

window.BsI18n={
  // the setting changed (Settings live preview, or the saved config on start)
  set:apply,
  get lang(){return lang},
  // for code that wants a string in the current language (falls back to the English)
  t:s=>{const r=tr(String(s==null?"":s));return r==null?s:r},
  languages:()=>[["auto","Automatic (system)"],["en","English"],...Object.keys(window.BS_LOCALES||{}).map(k=>[k,window.BS_LOCALES[k].name||k])],
};

// start: the last choice at once (so the first frame is already translated), then the saved config
let first="auto";try{first=localStorage.getItem(LS_KEY)||"auto"}catch{}
const go=()=>{apply(first);
  const api=window.boxshelf;
  if(api&&typeof api.getConfig==="function")Promise.resolve(api.getConfig()).then(r=>{const v=r&&r.config&&r.config.ui&&r.config.ui.lang;if(v&&v!==first)apply(v)}).catch(()=>{});
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go,{once:true});else go();
})();
