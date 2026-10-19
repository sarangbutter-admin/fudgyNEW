#!/usr/bin/env node
/* Builds the two websites from src/:
     site/        customer shop  (no admin code, no admin links)
     admin-site/  team sign-in + admin (owner & staff)
   Run:  node tools/build.js     (then commit site/ and admin-site/) */
const fs=require('fs'),path=require('path'),vm=require('vm');
const chunks=require('./chunks.js');
const R=p=>path.join(__dirname,'..',p),rd=p=>fs.readFileSync(R(p),'utf8');
const wr=(p,s)=>{fs.mkdirSync(path.dirname(R(p)),{recursive:true});fs.writeFileSync(R(p),s)};
const must=(s,a,b,what)=>{if(!s.includes(a))throw new Error('build: patch target missing: '+what);return s.replace(a,b)};

/* ---------------- app.js ---------------- */
const SRC=rd('src/app.js'),CH=chunks(SRC);
const ADM0=CH.find(c=>/^\/\* =+ ADMIN =+ \*\/$/.test(c.text.trim())).from;
const TAIL0=CH.find(c=>/^\/\* --- routing between shop and admin --- \*\/$/.test(c.text.trim())).from;
const inAdm=c=>c.from>=ADM0&&c.from<TAIL0;
const KEEP=new Set(['toast','armed','stLabel','NF_TYPES','nfIcon','bcActive','activeBroadcasts','VIS_KEY','VIS','trackVisit','AFF_KEY','affDone','affCapture','AF','AF_SRC','AF_ST','AF_STATUS','afChip','afRange','afShop','afLink','afPeriodHTML','afKpis','afDashHTML','affLoadRep','affLoadProds','afClick','afLinkUpd','afDate','affRender','AFF_START',
 'msgText','logMsg','chanList','MQ_FONTS','MQ_SIZE','mqFace','mqEnsureFont','mqFamily','mqSeq','renderMarquee','mqBuild','mqFit',
 'LP_DEFAULT_SVG','defaultPage','deepFill','LP_STACK','SOC_KINDS','SOC_SVG','SOC_NAME','socialUrl','socialsHTML','safeUrl','safeMedia','lpFaces','lpEnsureFonts','lpFamily','videoHTML','HERO_SPOTS','HERO_FX','heroCkShow','heroCkN','heroCkx','heroFloats','heroFill','heroShapes','heroList','heroNorm','ytId','vimeoId','isVideoSrc','HERO_BP','HR_RATIO','HB_SHAPES','HB_FX','heroCar','heroMsg','heroRatio','heroLayout','heroRz','HEX_OK','HDR_SHAPES','HDR_ISHAPES','HDR_BAR','applyHeader','favKey','lpFavicon','renderLanding','sig','lastSig']);
const decl=t=>{let m;if((m=t.match(/^(?:async\s+)?function\s*\*?\s*(\w+)/)))return[m[1]];
  if((m=t.match(/^(?:const|let|var)\s+([^=;]+?)\s*=/m)))return m[1].match(/[\w$]+/g)||[];return[]};
const shopClock=`let lastSig=sig();\nsetInterval(()=>{const now=Date.now(),s=sig(now);if(s!==lastSig)renderStore();else updateFlash(now);lastSig=s},1000);`;
const customerRoute=`function route(){
  if(view===null&&SBH.on&&!SBH.loaded){view="store";SBH.loadShop();return}
  view="store";document.body.classList.add("in-store");
  trackVisit();closeReviews();expireOrders();sanitizeCart();renderBag();renderEditBar();renderStoreStatic();renderStore();
  if(location.hash==="#shop")window.scrollTo(0,0);
}`;
let cust=[];
for(const c of CH){
  if(c.from>=TAIL0){cust.push(c);continue}
  if(!inAdm(c)){cust.push(c);continue}
  const n=decl(c.text);if(n.length&&n.every(x=>KEEP.has(x)||['lastSig'].includes(x)))cust.push(c);
}
let out=cust.map(c=>{
  let t=c.text;
  if(c.from>=TAIL0){
    if(/^function route\(\)/.test(t))return customerRoute;
    if(/^addEventListener\("hashchange",route\)/.test(t))return t;
    if(/getElementById\("signOut"\)|\$\("#signOut"\)/.test(t))return '';
    if(/^addEventListener\("storage"/.test(t))return 'addEventListener("storage",e=>{if(SBH.on)return;if(e.key===DB_KEY){loadDB();view=null;route()}});';
    return t;
  }
  if(/^function sweepOrders/.test(t))t=must(t,'\n  else if(view==="admin")renderAdmin();','','sweepOrders');
  if(/document\.addEventListener\("keydown",e=>\{if\(e\.key!=="Escape"\)/.test(t))t=must(t,'if(!$("#drawer").hidden)closeDrawer();closeModal();','','keydown');
  return t;
}).join('\n');
// keep the countdown clock for sales (shop side only)
out=out.replace(/(const sig *= *\(now=Date\.now\(\)\)[^\n]*\n)let lastSig=sig\(\);\n/,'$1');
out+='\n'+shopClock+'\n';
// route() is called at the very end of the file; closeModal is only defined for the admin, so give the shop a tiny version
// strip header comment about mock backend is fine to keep
out=must(out,'localStorage.getItem(STAFF_KEY)||','','STAFF_KEY use');
out=must(out,',STAFF_KEY="delidome-staff-v1"','','STAFF_KEY def');
out=out.replace('/* --- routing between shop and admin --- */\n','');
wr('site/app.js',out);

/* admin: everything, but always the admin screen */
let adm=SRC;
const routeStart=SRC.indexOf('let view=null;\nfunction route(){');
const routeEnd=SRC.indexOf('addEventListener("hashchange",route);');
if(routeStart<0||routeEnd<0)throw new Error('route not found');
adm=SRC.slice(0,routeStart)+`let view=null;
function route(){
  if(view==="admin")return;
  view="admin";
  $("#storeView").hidden=true;$("#adminView").hidden=false;document.body.classList.remove("in-store");
  closeSheet();closeMO();
  if(SBH.on&&!SBH.adminReady()){SBH.enterAdmin();return}
  expireOrders();renderAdmin();window.scrollTo(0,0);alScan();
}
{const v=$("#viewShop"),u=String((window.DELIDOME_CONFIG||{}).shopUrl||"");if(v&&/^https:\\/\\/[^\\s"'<>]+$/.test(u)){v.href=u;v.style.display=""}}
`+SRC.slice(routeEnd);
adm=must(adm,'addEventListener("hashchange",route);','','hashchange');
wr('admin-site/app.js',adm);

/* ---------------- sb.js ---------------- */
const SB=rd('src/sb.js');
const cleanSb=t=>t.replace('loaded: false, admin: false }','loaded: false }').replace(/ \|\| H\.admin/g,'').replace(/H\.admin \|\| /g,'').replace(/ && !H\.admin/g,'');
const sbCut=SB.indexOf('  /* ================= owner: sign-in ================= */');
const sbEnd=SB.lastIndexOf('  H.flush = flush;');
if(sbCut<0||sbEnd<0)throw new Error('sb.js markers not found');
wr('site/sb.js',cleanSb(SB.slice(0,sbCut)).replace('Owner: sign in, load everything, auto-save every change, poll for new orders\n','').replace('   - Owner: sign in, load everything, auto-save every change, poll for new orders\n','')+'})();\n');
wr('admin-site/sb.js',SB);

/* ---------------- backend.js ---------------- */
const BK=rd('src/backend.js');
wr('admin-site/backend.js',BK);
// customer site gets the same file: affiliators sign in on the shop at /#partner (the server only lets affiliator accounts see their own numbers)
wr('site/backend.js',BK);

/* ---------------- html / css / misc ---------------- */
let html=rd('src/index.html');
const aS=html.indexOf('<!-- ================= ADMIN ================= -->');
const aE=html.indexOf('<script',aS);
if(aS<0||aE<0)throw new Error('admin markup markers not found');
const adminBlock=html.slice(aS,aE);
const toastEl=(adminBlock.match(/<div[^>]*id="toast"[^>]*><\/div>/)||[])[0];if(!toastEl)throw new Error('toast element not found');
let shopHtml=html.slice(0,aS)+toastEl+'\n'+html.slice(aE);
shopHtml=shopHtml.replace(/\s*<a class="adminlink" href="#admin" aria-label="Admin">Admin<\/a>/,'').replace(/ <a href="#admin">Shop admin<\/a>/,'');
wr('site/index.html',shopHtml);
wr('admin-site/index.html',html.replace('<a class="btn btn-white btn-sm viewshop" href="#shop">View shop →</a>','<a class="btn btn-white btn-sm viewshop" id="viewShop" href="#" target="_blank" rel="noopener noreferrer" style="display:none">View shop ↗</a>').replace('<title>Delidome Cookie Boxes</title>','<title>Team sign in</title>\n<meta name="robots" content="noindex, nofollow">').replace(/<link rel="preconnect"[^>]*>\n?/g,''));
fs.copyFileSync(R('src/styles.css'),R('admin-site/styles.css'));
{ // map library for the courier pin (shop only), copied as-is
  const cp=(d)=>{for(const f of fs.readdirSync(R('src/'+d),{withFileTypes:true})){if(f.isDirectory()){fs.mkdirSync(R('site/'+d+'/'+f.name),{recursive:true});cp(d+'/'+f.name)}else{fs.mkdirSync(R('site/'+d),{recursive:true});fs.copyFileSync(R('src/'+d+'/'+f.name),R('site/'+d+'/'+f.name))}}};
  cp('vendor/leaflet');
}
{ // customer css: drop single-line rules that only style things the shop never renders
  const shopText=shopHtml+out+rd('site/sb.js');
  const used=t=>new RegExp('(^|[^\\w-])'+t.replace(/[-]/g,'\\-')+'(?![\\w-])').test(shopText);
  const css=rd('src/styles.css').split('\n');const start=css.findIndex(l=>/^\/\* =+ Admin =+ \*\/$/.test(l));
  const keep=css.filter((l,i)=>{
    if(i<start&&!/adminlink/.test(l))return true;
    if(/^\s*(\/\*|\}|@)/.test(l)&&!/^@media[^{]*\{.*\}\s*$/.test(l))return true;       // comments, block ends, multi-line at-rules
    const head=l.replace(/^@media[^{]*\{/,'');
    const sels=(head.match(/[.#][A-Za-z_][\w-]*/g)||[]).filter(x=>!/^\.\d/.test(x));
    if(!/\{/.test(l)||!sels.length)return true;
    const bodyless=head.split('{')[0];const tokens=(bodyless.match(/[.#][A-Za-z_][\w-]*/g)||[]);
    if(!tokens.length)return true;
    return tokens.some(t=>used(t.slice(1)));
  });
  let o=keep.filter(l=>!/^\/\*.*\b(admin|owner|sign-in|team|staff|activity|password|editor)\b.*\*\/$/i.test(l.trim())).join('\n').replace(/\.adminlink(?:::before)?\{[^}]*\}/g,'').replace(/and a shop admin \(sidebar \+ panels\) sharing one mock data store/,'');
  wr('site/styles.css',o);
}
for(const f of ['404.html','robots.txt']){fs.copyFileSync(R('src/'+f),R('site/'+f))}
wr('site/config.js',rd('src/config.js').replace(/,\n  \/\/ team site only[^\n]*\n  shopUrl:[^\n]*\n/,'\n'));
fs.copyFileSync(R('src/config.js'),R('admin-site/config.js'));
wr('admin-site/robots.txt','User-agent: *\nDisallow: /\n');
wr('admin-site/404.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Not found</title></head><body><p>Not found.</p></body></html>\n');
{ // admin netlify.toml: same security headers, plus "don't index, don't cache, don't leak the address"
  let t=rd('netlify.toml');
  const hdr=t.indexOf('# Security headers');if(hdr<0)throw new Error('netlify.toml headers');
  t=`# Netlify settings for the TEAM / ADMIN site (Base directory: admin-site). Generated by tools/build.js.
[build]
  publish = "."
  command = ""
  # Cost control (exit 0 = skip): never build "main"; skip pushes that didn't change admin-site/.
  ignore = "test \\"$BRANCH\\" = \\"main\\" || ( test -n \\"$CACHED_COMMIT_REF\\" && test \\"$CACHED_COMMIT_REF\\" != \\"$COMMIT_REF\\" && git diff --quiet \\"$CACHED_COMMIT_REF\\" \\"$COMMIT_REF\\" -- . )"


# Production deploys cost credits, so they are never built automatically. Use branch deploys (free).
[context.production]
  ignore = "exit 0"

`+t.slice(hdr).replace('Referrer-Policy = "strict-origin-when-cross-origin"','Referrer-Policy = "no-referrer"\n    X-Robots-Tag = "noindex, nofollow, noarchive"\n    Cache-Control = "no-store"')
    .replace(/\n\[\[headers\]\]\n  for = "\/index\.html"[\s\S]*$/,'\n');
  wr('admin-site/netlify.toml',t);
}
console.log('built: site/app.js',out.length,'bytes, admin-site/app.js',adm.length,'bytes');
