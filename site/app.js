/* =====================================================================
   MOCK BACKEND
   Everything is saved in this browser (localStorage). When we move to
   Supabase, each collection below becomes a table:
     settings     (one row: currency, delivery_fee, delivery_km, cutoff_hour, closed_weekdays, time_slots, address, hours)
     box_sizes    (n, price, active)
     products     (id, name, description, art, surcharge, status: available|soldout|hidden, sort)
     addons       (id, name, description, price, active)
     flash_sales  (id, name, type: percent|amount, value, applies_to: all|<n>, starts_at, ends_at)
     orders       (id, code, created_at, customer, size, mode, day, time_slot, note, addons,
                   base, discount, sale_name, surcharge, addons_total, fee, total, status)
     order_items  (order_id, product_id, qty)
   ===================================================================== */
const DEFAULT_CATS=[{id:"classics",name:"Classics"},{id:"chocolate",name:"Chocolate"},{id:"specials",name:"Specials"}];
const CAT_OF={bb:"classics",oc:"classics",sm:"classics",dc:"chocolate",rv:"chocolate",rb:"chocolate",mt:"specials",lm:"specials",pb:"specials"};
const DB_KEY = "delidome-db-v1", CART_KEY = "delidome-cart-v1";
const ART = {
  bb:{label:"Classic chip",       dough:"#D19554", edge:"#97592A", chips:["#3B2214","#2A170C"], salt:true},
  dc:{label:"Cocoa",              dough:"#5A3322", edge:"#2E170D", chips:["#F2E5CE","#1A0C06"]},
  rv:{label:"Red velvet",         dough:"#B02736", edge:"#6E1520", chips:["#7A1220"], drizzle:"#FFF7EC"},
  mt:{label:"Matcha",             dough:"#9BB063", edge:"#5F7A35", chips:["#F7F0E0","#EFE4CC"], salt:true},
  rb:{label:"Dark with berries",  dough:"#41241A", edge:"#24120B", chips:["#E0405F","#F2E5CE"]},
  pb:{label:"Peanut butter",      dough:"#DDAA62", edge:"#A8743A", chips:["#4A2A1C","#E7BE73"]},
  sm:{label:"Marshmallow top",    dough:"#BC8148", edge:"#80501F", chips:["#2E170D"], mallow:true},
  oc:{label:"Oat",                dough:"#CC955C", edge:"#94602F", chips:["#EAD3A6","#7A4A26"]},
  lm:{label:"Lemon sugar",        dough:"#EBCB6B", edge:"#B8922E", chips:["#FFF8E1","#F5E3A0"], salt:true},
  ub:{label:"Ube",                dough:"#8E6BB8", edge:"#5B3F82", chips:["#F3E9FF","#3B2214"]}
};
const PLATES = ["#000096","#D9DCFA","#2328C8","#EEF0FF"];
const STATUSES = [["awaiting","Awaiting payment"],["review","Check payment"],["new","Payment confirmed"],["baking","Baking"],["ready","Ready / Out for delivery"],["completed","Delivered / Picked up"],["cancelled","Cancelled"]];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOW_LONG = ["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"];
/* --- utils --- */
const $ = s => document.querySelector(s);
const imgOk = s => /^(data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+|https:\/\/[^\s"'<>\\]+)$/i.test(String(s||"")) ? String(s) : "";
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const r2 = v => Math.round(v*100)/100;
const money = v => DB.settings.currency + r2(v).toFixed(2);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fromYmd = s => {const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const addDays = (d,n) => {const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const today0 = () => {const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate())};
const fmtDay = s => fromYmd(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
const fmtHour = h => h===0?"12am":h<12?h+"am":h===12?"12pm":(h-12)+"pm";
const fmtDT = ms => new Date(ms).toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
function fmtDur(ms){ms=Math.max(0,ms);const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,"0");return (d?d+"d ":"")+`${p(h)}:${p(m)}:${p(x)}`}
function fmtAgo(ms){const m=Math.round((Date.now()-ms)/60000);if(m<1)return "just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" hr ago";return Math.round(h/24)+" d ago"}
const fmtShort = ms => new Date(ms).toLocaleDateString("en-US",{month:"short",day:"numeric"});
const starStr = n => "★".repeat(n)+"☆".repeat(5-n);
const uid = () => Math.random().toString(36).slice(2,9);
const newCode = () => "DD-"+Math.random().toString(36).slice(2,6).toUpperCase();
function listJoin(a){return a.length<2?a.join(""):a.slice(0,-1).join(", ")+" or "+a[a.length-1]}
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
/* --- seed data --- */
function seedDB(){
  const now=Date.now(), H=3600e3;
  const db={v:1,
    settings:{currency:"$",tz:"Asia/Jakarta",deliveryFee:5,deliveryKm:10,samedayOn:false,samedayLeadH:3,samedayCutoff:15,samedayFee:8,samedayPayMin:60,minPayMin:30,rejPayMin:120,payCdColor:"#C8102E",payCdSize:"L",payCdFx:true,pickupOn:true,pickupLeadH:24,schedOn:true,schedLeadH:24,cutoffHour:20,closedWeekdays:[1],lowStockAt:10,customOn:true,customMin:14,customStep:2,customMax:48,customPer:3.25,payWindowH:24,complaintWindowH:24,waCountry:"62",payBank:"Example Bank\nAccount 123 456 7890\nName: Delidome Cookies",
      times:["10 to 11am","12 to 1pm","3 to 4pm","5 to 6pm"],
      address:"12 Example Street, Your City. Look for the blue dome sign.",
      hours:[["Tue to Fri","10am to 6pm"],["Saturday","9am to 5pm"],["Sunday","10am to 3pm"],["Monday","Closed"]]},
    sizes:[{n:4,price:16,active:true},{n:6,price:22,active:true},{n:12,price:40,active:true}],
    products:[
      {id:"bb",art:"bb",name:"Brown butter chip",desc:"Nutty brown butter dough, dark chocolate chunks, sea salt.",surcharge:0,status:"available"},
      {id:"dc",art:"dc",name:"Double cocoa",desc:"Dark cocoa dough packed with milk and white chocolate.",surcharge:0,status:"available"},
      {id:"rv",art:"rv",name:"Red velvet",desc:"Soft red velvet with a cream cheese swirl.",surcharge:0,status:"available"},
      {id:"mt",art:"mt",name:"Matcha white chip",desc:"Earthy matcha dough with white chocolate and a pinch of salt.",surcharge:.5,status:"available"},
      {id:"rb",art:"rb",name:"Raspberry dark",desc:"Dark chocolate dough with tart freeze-dried raspberry.",surcharge:1.5,status:"available"},
      {id:"pb",art:"pb",name:"Peanut butter cup",desc:"Peanut butter dough with chopped chocolate peanut cups.",surcharge:1,status:"available"},
      {id:"sm",art:"sm",name:"Toasted s'more",desc:"Graham dough, milk chocolate, toasted marshmallow top.",surcharge:1,status:"available"},
      {id:"oc",art:"oc",name:"Oat cinnamon",desc:"Chewy oats, brown sugar and a warm hit of cinnamon.",surcharge:0,status:"available"},
      {id:"lm",art:"lm",name:"Lemon sugar",desc:"Bright lemon zest rolled in crunchy sugar.",surcharge:0,status:"hidden"}
    ],
    addons:[
      {id:"wrap",name:"Gift wrap",desc:"Ribbon, tissue and a sticker seal.",price:3,active:true},
      {id:"card",name:"Greeting card",desc:"We handwrite your gift note on a card.",price:2,active:true},
      {id:"milk",name:"Fresh milk, 500 ml",desc:"Chilled, to go with the cookies.",price:4,active:true}
    ],
    sales:[
      {id:uid(),name:"Lunch rush",type:"percent",value:20,appliesTo:"all",start:now-15*60e3,end:now+105*60e3},
      {id:uid(),name:"Party box deal",type:"amount",value:8,appliesTo:"12",start:now+5*H,end:now+8*H},
      {id:uid(),name:"Opening week",type:"percent",value:15,appliesTo:"all",start:now-8*24*H,end:now-24*H}
    ],
    orders:[]
  };
  const STK={bb:48,dc:36,rv:24,mt:18,rb:9,pb:30,sm:6,oc:0,lm:20};
  db.products.forEach(p=>{p.track=true;p.stock=STK[p.id]??24});
  db.categories=DEFAULT_CATS.map(c=>({...c}));
  db.products.forEach(p=>{p.cat=CAT_OF[p.id]||"";p.reviews=[]});
  const D=86400e3,SR={bb:[["Rina A.",5,"Crisp edges, gooey middle. The sea salt on top is perfect.",2],["Budi S.",4,"Great flavor, a little sweet for me but my kids loved it.",5],["Maya T.",5,"Ordered a box of 12 for the office and they were gone by noon.",9]],
    dc:[["Kevin L.",5,"Deep chocolate and not too sweet.",3],["Sari W.",4,"Rich and fudgy. Needed a glass of milk!",6]],rv:[["Nadia P.",5,"The cream cheese swirl is the best part.",4]],mt:[["Dimas P.",4,"Earthy matcha taste, not bitter.",7]]};
  Object.entries(SR).forEach(([id,list])=>{db.products.find(p=>p.id===id).reviews=list.map(([user,stars,text,ago])=>({id:uid(),user,stars,text,at:now-ago*D,src:"owner",example:true}))});
  // example orders
  const r=rng(11), names=["Rina Ayu","Budi Santoso","Maya Tan","Kevin Lim","Sari Wulan","Dimas Pratama","Ayu Kirana","Joko Rahman","Lina Hartono","Nadia Putri"];
  const offsets=[-2,-1,0,0,1,1,1,2,2,3], sizes=[6,4,12,6,6,12,4,6,6,12];
  const avail=db.products.filter(p=>p.status==="available").map(p=>p.id);
  const t0=today0();
  names.forEach((name,i)=>{
    let d=addDays(t0,offsets[i]);while(db.settings.closedWeekdays.includes(d.getDay()))d=addDays(d,1);
    const size=sizes[i],box=[];for(let k=0;k<size;k++)box.push(avail[Math.floor(r()*avail.length)]);
    const mode=r()<.35?"delivery":"pickup",addons=[];if(r()<.35)addons.push("wrap");if(r()<.25)addons.push("card");
    const q=quote({size,box,mode,addons},db,{at:0});
    const status=offsets[i]<0?"completed":offsets[i]===0?(i%2?"ready":"baking"):(i%3===0?"baking":"new");
    const first=name.split(" ")[0].toLowerCase();
    db.orders.push({id:uid(),code:"DD-"+(1040+i),example:true,createdAt:Math.min(now-(10-i)*2.5*H, d.getTime()-6*H),
      customer:{name,email:first+"@example.com",phone:"0812-0000-"+String(1000+i*37).slice(-4),address:mode==="delivery"?"Example address "+(i+1):""},
      size,items:countItems(box),mode,day:ymd(d),time:db.settings.times[Math.floor(r()*db.settings.times.length)],
      note:i===4?"Birthday gift, please add a candle if you can.":"",addons,sale:"",
      base:q.base,discount:0,surcharge:q.surcharge,addonsTotal:q.addons,fee:q.fee,total:r2(q.total),status});
  });
  db.orders.sort((a,b)=>b.createdAt-a.createdAt);
  {const c=db.orders.find(o=>o.status==="completed");if(c)c.completedAt=now-3*H}
  return db;
}
function countItems(box){const c={};box.forEach(id=>{if(id)c[id]=(c[id]||0)+1});return c}
/* --- load / save --- */
let DB;
function defaultAnnouncer(){return {on:true,sticky:true,size:"M",cdColor:"#C8102E",cdBg:"#FFFFFF",cdFx:true,cdSize:"L",imgOn:true,imgFx:true,
  live:{text:"Flash sale: {name}. {off} {applies}.",label:"Ends in",bg:"#C8102E",ink:"#FFFFFF",img:""},
  soon:{text:"Coming up: {name}, {off} {applies}.",label:"Starts in",bg:"#EEF0FF",ink:"#000096",img:""},
  fdlive:{text:"{name}: free delivery on {applies}.",label:"Ends in",bg:"#0A6B34",ink:"#FFFFFF",img:""},
  fdsoon:{text:"Coming up: {name}, free delivery on {applies}.",label:"Starts in",bg:"#E6F7EC",ink:"#0A6B34",img:""},
  giftlive:{text:"🎁 {name}: free gifts with {applies}!",label:"Ends in",bg:"#FFE066",ink:"#000096",img:""},
  giftsoon:{text:"Coming up: {name}, free gifts with {applies}.",label:"Starts in",bg:"#FFF7D6",ink:"#000096",img:""},
  mq:{bg:"#000096",ink:"#FFFFFF",font:"display",fontData:"",fontName:"",size:"M",speed:"medium",sepOn:true,sepImg:""},
  custom:{on:false,text:"Free delivery this weekend!",label:"Ends in",endsAt:"",bg:"#000096",ink:"#FFFFFF",img:""}}}
function defaultMarquee(){return {on:true,texts:["Baked fresh every morning","Build a box your way","Pickup or local delivery","Order by 8pm for next-day cookies"],images:[],bg:"#000096",color:"#ffffff",font:"display",size:"M",speed:"medium",fontData:null,fontName:""}}
function defaultThanks(){return {logo:"",cookies:[],fx:true,amount:28,title:"Order placed",titleUpd:"Order updated",
  text:"Thanks, {name}! Your box of {size} is set for {mode} on {when}.",
  urgent:"Your cookies are waiting! Pay within {hours} to keep them.",
  cdLabel:"Time left to pay",payBtn:"Pay now & secure my cookies 🍪",trackBtn:"Track my order",buildBtn:"Build another box",
  bg:"#ffffff",accent:"#000096",cdColor:"#C8102E"}}
function defaultProofPop(){return {on:true,emoji:"🙏",img:"",cookies:[],fx:true,amount:36,
  title:"Thank you, {name}! ✅",
  text:"We have received your payment proof for order {code}. We will check it and confirm it shortly. You can follow the progress in My orders.",
  btn:"Track my order",bg:"#ffffff",accent:"#000096",ink:"#0B0B45"}}
function defaultAlerts(){return {on:true,sound:true,vol:70,repeat:false,stay:true,custom:"",customName:"",
  ev:{order:{on:true,snd:"register"},proof:{on:true,snd:"chime"},complaint:{on:true,snd:"alarm"},courier:{on:true,snd:"alarm"}}}}
function defaultLabel(){return {logo:"",qr:"",qrCaption:"",notes:"",warnOn:true,warn1:"UNBOXING WITH UNCUT VIDEO!",warn2:"CONTACT US IF SEAL BROKEN"}}
const SLOT_PRESETS=Array.from({length:23},(_,h)=>String(h).padStart(2,"0")+" to "+String(h+1).padStart(2,"0"));
function migrate(db){
  if(db.settings){const D={samedayOn:false,samedayLeadH:3,samedayCutoff:15,samedayFee:8,samedayPayMin:60,minPayMin:30,rejPayMin:120,payCdColor:"#C8102E",payCdSize:"L",payCdFx:true,pickupOn:true,pickupLeadH:24,schedOn:true,schedLeadH:24,samedayMsg:"Sorry Sameday closed Today.\nyour order will be send tomorrow.",samedayOk:"OK",samedayGo:"Continue with Sameday anyway",schedMaxDays:7,courierNoteOn:true,courierNote:"We need at least 3 hours of lead time. Once we have requested a courier, any delay or failed delivery is beyond our responsibility.",coWarnOn:true,coWarnEmoji:"⚠️",coWarnTitle:"Wait! Check your details",coWarnText:"Please make sure your name, WhatsApp number and address are correct before you place your order. We use them to send you updates and deliver your box.",coWarnOk:"Yes, my details are correct",coWarnBack:"Go back"};for(const k in D)if(db.settings[k]===undefined)db.settings[k]=D[k];
    if(!Array.isArray(db.settings.slots)){const hs=(db.settings.times||[]).map(slotStartMin).filter(m=>m!==null).map(m=>Math.floor(m/60));if(!hs.length)hs.push(10);db.settings.slots=SLOT_PRESETS.map((t,h)=>({t,on:true,limit:0})).filter((x,h)=>hs.includes(h))}
    db.settings.times=db.settings.slots.filter(x=>x.on).map(x=>x.t)}
  db.label=Object.assign(defaultLabel(),db.label||{});
  db.thanks=Object.assign(defaultThanks(),db.thanks||{});
  if(!Array.isArray(db.broadcasts))db.broadcasts=[];
  if(!Array.isArray(db.customers))db.customers=[];
  if(!db.badges||!Array.isArray(db.badges.list))db.badges=defaultBadges();
  if(db.badges.autoBest===undefined)db.badges.autoBest=true;if(!db.badges.bestTop)db.badges.bestTop=3;
  if(db.settings&&db.settings.menuSort===undefined)db.settings.menuSort="popular";
  if(!Array.isArray(db.coupons))db.coupons=[{id:"cp1",code:"WELCOME10",desc:"10% off your box",type:"percent",value:10,minSpend:0,appliesTo:"all",startsAt:"",endsAt:"",maxUses:0,onePerPhone:true,stack:true,show:true,on:true}];
  db.alerts=deepFill(defaultAlerts(),db.alerts);
  if(!Array.isArray(db.payMethods))db.payMethods=[{id:"pm1",name:"Bank transfer",details:(db.settings&&db.settings.payBank)||"Example Bank\nAccount 123 456 7890\nName: Delidome Cookies",img:"",on:true}];
  db.proofpop=Object.assign(defaultProofPop(),db.proofpop||{});
  if(db.page&&db.page.strip&&db.page.strip.mode){const st=db.page.strip,d=defaultPage().strip.items;
    db.page.strip={items:st.mode==="off"?d.map(x=>({...x,on:false})):st.mode==="custom"?String(st.text||"").split("\n").map(x=>x.trim()).filter(Boolean).map(t=>({t,on:true})):d}}
  db.page=deepFill(defaultPage(),db.page);
  if(!db.marquee)db.marquee=defaultMarquee();
  db.announcer=deepFill(defaultAnnouncer(),db.announcer);
  if(db.settings.complaintWindowH===undefined)db.settings.complaintWindowH=24;
  if(db.settings.waCountry===undefined)db.settings.waCountry="62";
  if(db.settings.payWindowH===undefined)Object.assign(db.settings,{payWindowH:24,payBank:"Example Bank\nAccount 123 456 7890\nName: Delidome Cookies"});
  if(db.settings.lowStockAt===undefined)db.settings.lowStockAt=10;
  if(db.settings.customOn===undefined)Object.assign(db.settings,{customOn:true,customMin:14,customStep:2,customMax:48,customPer:3.25});
  if(db.settings.fabGest===undefined)Object.assign(db.settings,{fabGest:true,fabBgType:"color",fabBg2:"#FF9F43",fabRing:"",fabImgSize:84,fabSizePx:58,fabOpacity:100,fabImg:"",rbImg:"",rbImg2:""});
  if(db.settings.guardOn===undefined)Object.assign(db.settings,{guardOn:true,guardClear:true,guardShuf:true,guardIcon:"🛡️",guardImg:"",
    guardClearTitle:"Clear your box?",guardClearText:"You already picked a courier. This will empty your whole box. Your courier choice stays.",guardClearOk:"Yes, clear it",guardClearNo:"Keep my box",
    guardShufTitle:"Shuffle your box?",guardShufText:"You already picked a courier. This swaps only the flavors we picked for you. The ones you chose yourself stay.",guardShufOk:"Yes, shuffle",guardShufNo:"Keep my box"});
  if(db.settings.rbOn===undefined)Object.assign(db.settings,{rbOn:true,rbIcon:"🎲",rbIcon2:"🔀",rbBg:"#FFD43B",rbFx:"wiggle",rbScroll:true,fabOn:true,fabIcon:"📦",fabText:"My box",fabTextOn:true,fabFx:"bounce",fabBg:"#FFD43B",fabInk:"#000096",fabHide:true});
  if(!Array.isArray(db.categories)){db.categories=DEFAULT_CATS.map(c=>({...c}));db.products.forEach(p=>{if(p.cat===undefined)p.cat=CAT_OF[p.id]||""})}
  db.products.forEach(p=>{if(p.cat===undefined)p.cat="";if(!Array.isArray(p.reviews))p.reviews=[]});
  db.products.forEach(p=>{if(p.track===undefined){p.track=true;p.stock=p.status==="soldout"?0:40}if(typeof p.stock!=="number")p.stock=0});
  return db;
}
function loadDB(){if(SBH.on){SBH.initDB();return}try{const s=JSON.parse(localStorage.getItem(DB_KEY)||"null");if(s&&s.v===1){DB=migrate(s);return}}catch(e){}DB=migrate(seedDB());saveDB()}
function saveDB(){const r=SBH.on?SBH.save():(()=>{try{localStorage.setItem(DB_KEY,JSON.stringify(DB));return true}catch(e){return false}})();if(typeof afterSave==="function")afterSave();return r}
/* --- pricing --- */
const prod = (id,db=DB) => db.products.find(p=>p.id===id);
const isFD=s=>s.type==="freedelivery";
const isGift=s=>s.type==="gifts";
function saleStatus(s,at=Date.now()){return at<s.start?"scheduled":at<s.end?"live":"ended"}
function saleDiscount(s,base){if(isFD(s)||isGift(s))return 0;return r2(s.type==="percent"?base*s.value/100:Math.min(s.value,base))}
function validCustom(n,db=DB){const t=db.settings;return !!t.customOn&&Number.isInteger(n)&&n>=t.customMin&&n<=t.customMax&&(n-t.customMin)%t.customStep===0&&!db.sizes.some(s=>s.n===n)}
function snapCustom(v,db=DB){const t=db.settings;v=Math.round(+v)||t.customMin;if(v<=t.customMin)return t.customMin;let n=t.customMin+Math.ceil((v-t.customMin)/t.customStep)*t.customStep;if(n>t.customMax)n=t.customMin+Math.floor((t.customMax-t.customMin)/t.customStep)*t.customStep;return n}
function basePrice(n,db=DB){const sz=db.sizes.find(s=>s.n===n);return sz?sz.price:validCustom(n,db)?r2(n*db.settings.customPer):0}
function bestSale(n,at=Date.now(),db=DB){
  const price=basePrice(n,db);if(!price)return null;
  return db.sales.filter(s=>!isFD(s)&&!isGift(s)&&saleStatus(s,at)==="live"&&(s.appliesTo==="all"||+s.appliesTo===n))
    .sort((a,b)=>saleDiscount(b,price)-saleDiscount(a,price))[0]||null;
}
/* --- gifts: a "Gifts" promo has a pool of gifts and rules per box size (a limit, specific or random). The server draws them when the payment proof is sent. --- */
const giftQty=g=>Math.max(1,Math.min(10,Math.round(+g.qty)||1));
const giftHasRules=s=>Array.isArray(s.rules)&&s.rules.length>0;
const giftRuleFor=(s,n)=>(s.rules||[]).find(r=>+r.from<=n&&n<=+r.to)||null;
function giftPlan(n,at=Date.now(),db=DB){
  const out=[];
  db.sales.forEach(s=>{
    if(!isGift(s)||saleStatus(s,at)!=="live")return;const r=giftRuleFor(s,n);if(!r)return;
    const ids=new Set(r.ids||[]),gs=(s.gifts||[]).filter(g=>g&&String(g.name||"").trim()&&ids.has(g.id));if(!gs.length)return;
    const lim=Math.max(1,Math.min(5,Math.round(+r.limit)||1)),rnd=r.mode==="random"&&gs.length>lim;
    out.push({sale:s,rule:r,mode:rnd?"random":"specific",limit:Math.min(lim,gs.length),gifts:rnd?gs:gs.slice(0,lim)});
  });
  return out;
}
/* demo mode (no server): the same pick, made in the browser */
function giftDrawLocal(o,db=DB,at=Date.now()){
  const out=[];
  giftPlan(o.size,at,db).forEach(x=>{const pool=x.gifts.slice();
    for(let i=0;i<x.limit&&pool.length;i++){const g=x.mode==="random"?pool.splice(Math.floor(Math.random()*pool.length),1)[0]:pool.shift();out.push({id:g.id,name:g.name,promo:x.sale.name,promoId:x.sale.id,random:x.mode==="random"})}});
  return out;
}
const giftImg=id=>{for(const s of DB.sales||[])for(const g of s.gifts||[])if(g&&g.id===id&&g.img)return g.img;return ""};
const giftChip=(g,extra="")=>{const im=g.img||giftImg(g.id);return `<span class="gc${extra}">${im?`<img src="${esc(imgOk(im))}" alt="" loading="lazy">`:`<i aria-hidden="true">🎁</i>`}<span>${esc(g.name)}${giftQty(g)>1?` ×${giftQty(g)}`:""}</span></span>`};
const giftCard=(g,extra="")=>{const im=g.img||giftImg(g.id);return `<span class="gcard${extra}">${im?`<img src="${esc(imgOk(im))}" alt="" loading="lazy">`:`<i aria-hidden="true">🎁</i>`}<b>${esc(g.name)}${giftQty(g)>1?` ×${giftQty(g)}`:""}</b><em>FREE</em></span>`};
const giftSurprise=n=>n>1?n+" surprise gifts":"1 surprise gift";
const giftLines=n=>giftPlan(n).flatMap(x=>x.mode==="random"?[`🎲 ${giftSurprise(x.limit)}`]:x.gifts.map(g=>`🎁 ${g.name}`));
const GIFT_NOTE="Gifts are subject to availability. Alternative gifts or a delayed shipment may happen.";
const giftsHTML=(o,cust)=>o.gifts&&o.gifts.length?`<div class="dsec"><h4>🎁 ${cust?"Your gifts":"Free gifts to pack"}</h4><div class="gl">${o.gifts.map(g=>giftChip(g,g.random?" rnd":"")).join("")}</div>${["new","baking","ready","completed"].includes(o.status)?"":`<p class="note" style="margin:8px 0 0">${cust?"Confirmed once we verify your payment.":"Pack it once the payment is confirmed."}</p>`}</div>`:cust&&o.status==="awaiting"&&giftPlan(o.size).length?`<div class="dsec"><h4>🎁 Your free gift</h4><p class="hint" style="margin:0">It's revealed as soon as you send your payment proof.</p></div>`:"";
/* --- optional courier prices from Biteship (does nothing unless the owner switches it on in Shop settings) --- */
const bsOn=(db=DB)=>!!(SBH.on&&db.settings&&db.settings.biteship&&db.settings.biteship.on);
const bsFallback=(db=DB)=>!(db.settings&&db.settings.biteship&&db.settings.biteship.fallback===false);
const bsShip=(c,at=Date.now(),db=DB)=>bsOn(db)&&c.mode==="delivery"&&c.ship&&c.ship.size===c.size&&+c.ship.exp>at?c.ship:null;
const bsPending=(c,db=DB)=>bsOn(db)&&c.mode==="delivery"&&!c.bsSkip&&!bsShip(c,Date.now(),db);
const BS_ST={confirmed:"Courier booked",scheduled:"Pickup scheduled",allocated:"Courier assigned",picking_up:"Courier is on the way to pick up",picked:"Picked up",dropping_off:"On the way to you",return_in_transit:"Returning",on_hold:"On hold",delivered:"Delivered",rejected:"Rejected by courier",disposed:"Disposed",courier_not_found:"No courier found",returned:"Returned",cancelled:"Booking cancelled",night_stop:"Stopped for the night (no driver before closing time)"};
const BS_FAIL=["courier_not_found","rejected","cancelled","returned","disposed"];
// customers can change the note and photo on their order page until a courier is booked
let PLE=null;
const placeEditable=o=>SBH.on&&o.mode==="delivery"&&["awaiting","review","new","baking"].includes(o.status)&&!(o.bship&&o.bship.biteshipId)&&(DB.settings.dnoteOn!==false||DB.settings.dphotoOn!==false);
function placeEditHTML(o){
  const p=o.place||{};if(!PLE||PLE.id!==o.id)PLE={id:o.id,note:p.note||"",img:undefined};
  const img=PLE.img==="remove"?"":PLE.img||(p.photo?p.img||"":""),loading=PLE.img===undefined&&p.photo&&!p.img;
  return `<div class="dsec"><h4>📍 Delivery details</h4><p class="note" style="margin:0 0 8px">Help the courier find you. You can change this until the courier is booked.</p>
    ${DB.settings.dnoteOn!==false?`<label class="af">Note for the driver<textarea class="in" id="plNote" rows="2" maxlength="200" placeholder="e.g. Green gate next to Indomaret, house no. 6, ring the bell">${esc(PLE.note)}</textarea></label>`:""}
    ${DB.settings.dphotoOn!==false?`<div class="af" style="margin-top:8px">Photo of your place<div class="colin" style="flex-wrap:wrap;margin-top:4px">${img?`<img class="placeprev" src="${esc(img)}" alt="Your place">`:loading?`<span class="note">Loading the photo…</span>`:""}<label class="ghost mqbtn">📷 ${img||loading?"Change photo":"Add photo"}<input type="file" accept="image/*" hidden id="plPhoto"></label>${img||loading?`<button class="ghost" type="button" data-plrm>Remove</button>`:""}</div><small class="note">Only the shop and you can see it.</small></div>`:""}
    <button class="btn btn-blue btn-sm" type="button" data-plsave="${o.id}" style="margin-top:10px">Save delivery details</button><p class="err" id="plErr" hidden></p></div>`;
}
const placeHTML=(o,cust)=>{if(cust&&placeEditable(o))return placeEditHTML(o);const p=o.place;if(!p||o.mode!=="delivery"||!(p.note||p.photo))return "";
  return `<div class="dsec"><h4>📍 Delivery details</h4>${p.note?`<p style="margin:0 0 6px"><b>Note for the driver:</b> ${esc(p.note)}</p>`:""}${p.photo?(p.img?`<a href="${esc(p.img)}" target="_blank" rel="noopener"><img class="placeprev big" src="${esc(p.img)}" alt="Photo of the delivery place"></a>`:`<p class="note">Loading the photo…</p>`):""}</div>`};
const bsBadge=o=>{const b=o.bship;if(!b||!b.courier||o.mode!=="delivery")return null;
  if(b.nightHold&&!b.biteshipId)return {t:"Searching again tomorrow",c:"wait"};
  if(b.failed)return {t:"Courier failed",c:"bad"};if(!b.biteshipId)return b.status==="cancelled"?{t:"Courier cancelled",c:"bad"}:{t:"Courier not booked",c:"wait"};
  const m={confirmed:["Searching driver","wait"],scheduled:["Pickup scheduled","wait"],allocated:["Driver assigned","go"],picking_up:["Driver on the way","go"],picked:["Picked up","go"],dropping_off:["On the way","go"],delivered:["Delivered","done"],on_hold:["On hold","bad"]}[b.status];
  return m?{t:m[0],c:m[1]}:{t:BS_ST[b.status]||b.status||"Booked",c:"wait"}};
const bsProof=(b,k)=>{const ov=b.proofOverride&&b.proofOverride[k];if(ov)return {urls:[ov],by:"shop"};const a=(b.proofs&&b.proofs[k])||[];return a.length?{urls:a,by:"courier"}:null};
const bsHTML=(o,adm)=>{const b=o.bship;if(!b||!b.courier||o.mode!=="delivery")return "";
  const booked=!!b.biteshipId,st=b.status?(BS_ST[b.status]||b.status):"",nm=esc((b.courierName||b.courier)+" "+(b.serviceName||b.service)),dr=b.driver;
  const fail=adm&&b.nightHold&&!booked?`<div class="oc-alert appr" style="margin:0 0 8px">🌙 No driver before closing time. Searching again automatically tomorrow at ${fmtHour(b.resumeH??9)}. You can still book now yourself.<div style="margin-top:6px"><button class="ghost" type="button" data-bsact="nohold" data-oid="${o.id}">Don't search tomorrow</button></div></div>`
    :adm&&b.failed?`<div class="oc-alert cmp" style="margin:0 0 8px">🛵 ${esc(st||"Courier failed")}. Book again below${b.retries?" (already retried once)":""}${b.nightErr?`<br><small>Tomorrow's automatic search didn't start: ${esc(b.nightErr)}</small>`:""}</div>`:"";
  const lines=!adm?`<dt>Courier</dt><dd>${nm}${b.eta?` · ${esc(b.eta)}`:""}</dd>${b.waybill?`<dt>Waybill</dt><dd>${esc(b.waybill)}</dd>`:""}`:`<dt>Courier</dt><dd>${nm}${b.eta?` · ${esc(b.eta)}`:""}</dd>${st?`<dt>Status</dt><dd><b>${esc(st)}</b>${b.statusAt?` <small class="note">${fmtAgo(b.statusAt)}</small>`:""}</dd>`:booked?"":`<dt>Status</dt><dd>${adm?"Not booked yet":"We'll call the courier when your cookies are ready"}</dd>`}
    ${dr&&(dr.name||dr.plate)?`<dt>Driver</dt><dd>${esc(dr.name||"")}${dr.plate?` · ${esc(dr.plate)}`:""}${dr.phone?` · <a href="tel:${esc(dr.phone)}">${esc(dr.phone)}</a>`:""}</dd>`:""}
    ${b.waybill?`<dt>Waybill</dt><dd>${esc(b.waybill)}</dd>`:""}${(adm?o._clink||b.link:b.link)&&booked?`<dt>Tracking</dt><dd><a href="${esc(safeUrl(adm?o._clink||b.link:b.link))}" target="_blank" rel="noopener">${adm?"Track the courier live (team only)":"Track the courier live"}</a></dd>`:""}
    ${adm&&b.price!==undefined?`<dt>Price</dt><dd>${money(b.price)} quoted${b.bookedPrice!==undefined&&b.bookedAt?` · ${money(b.bookedPrice)} booked`:""}</dd>`:""}`;
  const hist=(b.history||[]).length?`<ol class="bshist">${b.history.slice().reverse().map(h=>`<li><b>${esc(BS_ST[h.s]||h.s)}</b><small>${fmtDT(h.at)}${h.by==="shop"?" · by the shop":""}</small></li>`).join("")}</ol>`:"";
  const pf=k=>{const p=bsProof(b,k),lab=k==="pickup"?"Pickup proof":"Delivery proof";if(!p&&!adm)return "";
    return `<div class="bspf"><b>${lab}</b>${p?`<div class="bspf-imgs">${p.urls.map(u=>`<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener"><img src="${esc(safeUrl(u))}" alt="${lab}" loading="lazy"></a>`).join("")}</div><small class="note">${p.by==="shop"?"Added by the shop":"From the courier"}</small>`:`<small class="note">${adm?"None from the courier yet.":""}</small>`}
      ${adm&&ROLE()==="owner"?`<div class="colin" style="flex-wrap:wrap;gap:6px;margin-top:4px"><label class="ghost mqbtn">${b.proofOverride&&b.proofOverride[k]?"Replace":"Add / override"}<input type="file" accept="image/*" hidden data-bsproof="${k}" data-oid="${o.id}"></label>${b.proofOverride&&b.proofOverride[k]?`<button class="danger" type="button" data-bsproofrm="${k}" data-oid="${o.id}">Use courier's</button>`:""}</div>`:""}</div>`};
  const acts=adm?`<div class="colin" style="margin-top:10px;flex-wrap:wrap;gap:8px">${!booked?`<button class="btn btn-blue btn-sm" type="button" data-bsact="book" data-oid="${o.id}" ${bsReqOk(o)?"":'disabled title="Move the order to Baking first"'}>${b.failed||b.cancelledAt?"Book again":"Request pickup"}</button>`:`<button class="ghost" type="button" data-bsact="refresh" data-oid="${o.id}">Refresh status</button><button class="danger" type="button" data-bsact="cancel" data-oid="${o.id}">Cancel booking</button>`}</div><p class="note" id="bsMsg" hidden></p>`:"";
  return `<div class="dsec"><h4>🛵 Courier</h4>${fail}<dl class="dl">${lines}</dl>${acts}<div class="bspfs">${pf("pickup")}${pf("delivery")}</div>${hist?`<details class="bshd"${adm?"":" open"}><summary>Courier updates</summary>${hist}</details>`:""}</div>`};
const freeDelSale=(n,at=Date.now(),db=DB)=>db.sales.find(s=>isFD(s)&&saleStatus(s,at)==="live"&&(s.appliesTo==="all"||+s.appliesTo===n))||null;
const cpNorm=v=>String(v||"").toUpperCase().replace(/[^A-Z0-9_-]/g,"").slice(0,20);
const cpOff=c=>c.type==="percent"?`${c.value}% off`:c.type==="amount"?`${money(c.value)} off`:"Free delivery";
const cpUses=(code,db,excl)=>db.orders.filter(o=>o.coupon===code&&o.status!=="cancelled"&&o.id!==excl);
function cpState(c,db=DB,now=Date.now()){
  if(!c.on)return "off";
  const st=c.startsAt?new Date(c.startsAt).getTime():0,en=c.endsAt?new Date(c.endsAt).getTime():0;
  if(st&&now<st)return "scheduled";if(en&&now>=en)return "expired";
  if(c.maxUses>0&&cpUses(c.code,db).length>=c.maxUses)return "used";return "live"}
function couponCheck(code,c,db,{base,saleDisc,phone,excl}){
  code=cpNorm(code);const cp=(db.coupons||[]).find(x=>x.code===code);
  if(!cp)return {ok:false,err:"That code isn't valid. Check the spelling and try again."};
  const stt=cpState(cp,db);
  if(stt==="off"||stt==="expired")return {ok:false,err:"This coupon has expired."};
  if(stt==="scheduled")return {ok:false,err:"This coupon isn't active yet."};
  if(cp.maxUses>0&&cpUses(code,db,excl).length>=cp.maxUses)return {ok:false,err:"Sorry, this coupon has been fully claimed."};
  if(cp.appliesTo!=="all"&&+cp.appliesTo!==c.size)return {ok:false,err:`This coupon is for boxes of ${cp.appliesTo} only.`};
  if(cp.minSpend>0&&base<cp.minSpend)return {ok:false,err:`Spend at least ${money(cp.minSpend)} on the box to use this coupon.`};
  if(saleDisc>0&&!cp.stack)return {ok:false,err:"This coupon can't be combined with the flash sale."};
  if(cp.onePerPhone&&phone){const ph=String(phone).replace(/\D/g,"").replace(/^(0|62)/,"");if(cpUses(code,db,excl).some(o=>String(o.customer&&o.customer.phone||"").replace(/\D/g,"").replace(/^(0|62)/,"")===ph))return {ok:false,err:"You've already used this coupon."}}
  const room=Math.max(0,base-saleDisc);
  const discount=cp.type==="percent"?r2(room*cp.value/100):cp.type==="amount"?r2(Math.min(cp.value,room)):0;
  return {ok:true,coupon:cp,discount,freeDel:cp.type==="freedelivery"};
}
function quote(c,db=DB,{at=Date.now(),withDelivery=true}={}){
  const base=basePrice(c.size,db);
  const sale=at?bestSale(c.size,at,db):null,discount=sale?saleDiscount(sale,base):0;
  const surcharge=r2(c.box.reduce((a,id)=>a+(prod(id,db)?.surcharge||0),0));
  const addons=r2((c.addons||[]).reduce((a,id)=>{const x=db.addons.find(y=>y.id===id&&y.active);return a+(x?x.price:0)},0));
  const cp=c.coupon?couponCheck(c.coupon,c,db,{base,saleDisc:discount,phone:c.phone,excl:c.editId}):null;
  const couponDisc=cp&&cp.ok?cp.discount:0;
  const fdSale=at&&c.mode==="delivery"?freeDelSale(c.size,at,db):null;
  const shipQ=withDelivery?bsShip(c,at||Date.now(),db):null,noFee=!!fdSale||!!(cp&&cp.ok&&cp.freeDel);
  const feePending=withDelivery&&c.mode==="delivery"&&!noFee&&!shipQ&&bsPending(c,db);
  const fee=withDelivery&&c.mode==="delivery"&&!noFee?(shipQ?+shipQ.price:feePending?0:(c.speed==="sameday"?(db.settings.samedayFee??db.settings.deliveryFee):db.settings.deliveryFee)):0;
  return {ship:shipQ,feePending,base,sale,fdSale,discount,surcharge,addons,fee,coupon:cp&&cp.ok?cp.coupon:null,couponDisc,couponErr:cp&&!cp.ok?cp.err:"",total:r2(base-discount-couponDisc+surcharge+addons+fee)};
}
const saleOffText = s => isFD(s)?"Free delivery":isGift(s)?"Free gifts":s.type==="percent"?`${s.value}% off`:`${money(s.value)} off`;
function giftAppliesText(s){const ps=[...new Set(s.rules.map(r=>+r.from===+r.to&&DB.sizes.some(z=>z.n===+r.from)?`box of ${r.from}`:`custom boxes of ${r.from} to ${r.to}`))];
  return ps.length>1?ps.slice(0,-1).join(", ")+" and "+ps[ps.length-1]:ps[0]}
const saleAppliesText = s => isGift(s)&&giftHasRules(s)?giftAppliesText(s):s.appliesTo==="all"?"every box":`the box of ${s.appliesTo}`;
/* --- cookie drawing --- */
let gid=0;
function cookieSVG(f, seed){
  const r=rng(seed), id="g"+(gid++), N=30, pts=[];
  for(let i=0;i<N;i++){const a=i/N*Math.PI*2, rad=44+(r()-.5)*3.6;pts.push([50+Math.cos(a)*rad,50+Math.sin(a)*rad])}
  const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2];
  let d="M"+mid(pts[N-1],pts[0]).map(v=>v.toFixed(1)).join(" ");
  for(let i=0;i<N;i++){const p=pts[i],m=mid(p,pts[(i+1)%N]);d+=` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`}
  let s=`<svg class="ck" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx="45%" cy="40%" r="62%"><stop offset="0" stop-color="${f.dough}"/><stop offset=".72" stop-color="${f.dough}"/><stop offset="1" stop-color="${f.edge}"/></radialGradient></defs><path d="${d}Z" fill="url(#${id})"/>`;
  for(let i=0;i<7;i++){const a=r()*6.28,rr=r()*30;s+=`<ellipse cx="${(50+Math.cos(a)*rr).toFixed(1)}" cy="${(50+Math.sin(a)*rr).toFixed(1)}" rx="${(3+r()*5).toFixed(1)}" ry="${(1+r()*1.5).toFixed(1)}" fill="${f.edge}" opacity=".28" transform="rotate(${(r()*180).toFixed(0)} ${(50+Math.cos(a)*rr).toFixed(1)} ${(50+Math.sin(a)*rr).toFixed(1)})"/>`}
  const nChips=f.mallow?7:13;
  for(let i=0;i<nChips;i++){const a=r()*6.28,rr=Math.sqrt(r())*34,x=50+Math.cos(a)*rr,y=50+Math.sin(a)*rr,w=4+r()*5,h=3.5+r()*4;
    s+=`<rect x="${(x-w/2).toFixed(1)}" y="${(y-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.6" fill="${f.chips[i%f.chips.length]}" transform="rotate(${(r()*90).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`}
  if(f.mallow){for(let i=0;i<4;i++){const a=r()*6.28,rr=r()*22,x=50+Math.cos(a)*rr,y=50+Math.sin(a)*rr,R=8+r()*4;
    s+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${R.toFixed(1)}" fill="#FFF4E2"/><circle cx="${(x+R*.25).toFixed(1)}" cy="${(y+R*.3).toFixed(1)}" r="${(R*.55).toFixed(1)}" fill="#D8964A" opacity=".55"/>`}}
  if(f.drizzle){let p="M22 38";for(let i=0;i<6;i++){p+=` Q${30+i*9} ${i%2?30:70} ${34+i*9} ${i%2?62:40}`}
    s+=`<path d="${p}" stroke="${f.drizzle}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`}
  if(f.salt){for(let i=0;i<9;i++){const a=r()*6.28,rr=r()*30;s+=`<rect x="${(50+Math.cos(a)*rr).toFixed(1)}" y="${(50+Math.sin(a)*rr).toFixed(1)}" width="2" height="2" fill="#fff" opacity=".9" transform="rotate(${(r()*90).toFixed(0)} ${(50+Math.cos(a)*rr).toFixed(1)} ${(50+Math.sin(a)*rr).toFixed(1)})"/>`}}
  return s+"</svg>";
}
const seedOf = id => [...id].reduce((a,c)=>a+c.charCodeAt(0),0)*97+3;
const artOf = p => ART[p?.art]||ART.bb;
const plateColorOf = p => {const i=DB.products.indexOf(p);return PLATES[(i<0?DB.products.length:i)%PLATES.length]};
const DARK_PLATES = ["#000096","#2328C8"];
const hasImage = p => p.art!=="none" && !(p.art==="photo"&&!p.img);
const initials = n => (n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
function plateInner(p){
  if(p.art==="photo"&&p.img)return `<img class="ck ph${p.cutout?" cut":""}" src="${esc(imgOk(p.img))}" alt="" draggable="false">`;
  if(!hasImage(p))return "";
  return cookieSVG(artOf(p),seedOf(p.id));
}
const HEX6=/^(#[0-9a-f]{6}|transparent)$/i;
const lumOf=h=>{if(h==="transparent")return 1;const c=[1,3,5].map(i=>{const v=parseInt(h.slice(i,i+2),16)/255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const BG_DIRS={diag:"linear-gradient(135deg,",down:"linear-gradient(180deg,",right:"linear-gradient(90deg,",radial:"radial-gradient(circle,"};
// the circle behind a flavor: automatic colour, or the owner's own colour / gradient / picture / none
function plateBg(p,b){
  b=b||p.bg||{};const d=plateColorOf(p);let css,dark;
  if(b.type==="color"&&HEX6.test(b.c1||"")){css=`background:${b.c1}`;dark=lumOf(b.c1)<.3}
  else if(b.type==="gradient"&&HEX6.test(b.c1||"")&&HEX6.test(b.c2||"")){css=`background:${BG_DIRS[b.dir]||BG_DIRS.diag}${b.c1},${b.c2})`;dark=(lumOf(b.c1)+lumOf(b.c2))/2<.3}
  else if(b.type==="image"&&imgOk(b.img)){css=`background:#000096 url("${imgOk(b.img)}") center/cover no-repeat`;dark=true}
  else if(b.type==="none"){css="background:transparent";dark=false}
  else{css=`background:${d};${d==="#EEF0FF"?"box-shadow:inset 0 0 0 2px #000096":""}`;dark=DARK_PLATES.includes(d)}
  if(b.ring&&HEX6.test(b.ring))css+=`;box-shadow:inset 0 0 0 4px ${b.ring}`;
  const z=+b.size;if(z>=40&&z<=100)css+=`;--ck:${Math.round(z)}%`;
  return {css,dark};
}
function plateHTML(p,bgDraft){const g=plateBg(p,bgDraft);return `<div class="plate${g.dark?" dark":""}${hasImage(p)?"":" blank"}" style="${esc(g.css)}">${plateInner(p)}</div>`}
function crumbColors(p){
  if(p.art==="photo"&&p.tints)return {dough:p.tints[0],edge:p.tints[1],chips:[p.tints[2]]};
  if(!hasImage(p))return {dough:"#000096",edge:"#2328C8",chips:["#D9DCFA"]};
  return artOf(p);
}
/* ================= SHOP ================= */
loadDB();
const fresh = () => ({size:6, box:[], auto:[], step:1, mode:"pickup", speed:"scheduled", day:null, time:null, note:"", addons:[], coupon:"", ship:null, bsSkip:false, dnote:"", dphoto:""});
let S = fresh(), hadCart=false;
try{const s=JSON.parse(localStorage.getItem(CART_KEY)||"null");if(s&&Array.isArray(s.box)){S={...S,...s,step:s.step===2?2:1};hadCart=true;
  }}catch(e){}
const saveCart = () => {try{localStorage.setItem(CART_KEY,JSON.stringify({size:S.size,box:S.box,auto:S.auto,mode:S.mode,speed:S.speed,note:S.note,addons:S.addons,editId:S.editId||null,day:S.day,time:S.time,step:S.step,coupon:S.coupon||""}))}catch(e){}};
const activeSizes = () => DB.sizes.filter(s=>s.active).sort((a,b)=>a.n-b.n);
const heldOwn = id => {if(!S.editId||view!=="store")return 0;const o=DB.orders.find(x=>x.id===S.editId);return o&&o.holds&&o.status==="awaiting"?(o.items[id]||0):0};
const stockLeft = p => p&&p.track?Math.max(0,p.stock+heldOwn(p.id)):Infinity;
const isOut = p => !p||p.status==="soldout"||stockLeft(p)<=0;
const availProducts = () => DB.products.filter(p=>p.status==="available"&&stockLeft(p)>0);
const pickable = () => DB.products.filter(p=>p.status==="available"&&stockLeft(p)-countOf(p.id)>0);
const ratingOf = p => {const r=p.reviews||[],n=r.length;return {n,avg:n?r.reduce((a,x)=>a+x.stars,0)/n:0}};
const isLow = p => p.track&&p.status!=="hidden"&&p.stock<=DB.settings.lowStockAt;
function sanitizeCart(){
  if(S.ship&&(S.ship.size!==S.size||S.mode!=="delivery"||!bsOn()))S.ship=null;if(S.mode!=="delivery"||!bsOn())S.bsSkip=false;
  const sz=activeSizes();
  if(!sz.find(s=>s.n===S.size)&&!validCustom(S.size))S.size=(sz.find(s=>s.n===6)||sz[0]||{n:6}).n;
  const used={};
  {const was=S.auto||[],nb=[],au=[];
    for(let i=0;i<Math.min(S.box.length,S.size);i++){const id=S.box[i];let ok=false;
      if(id){const p=prod(id);if(p&&p.status==="available"){used[id]=(used[id]||0)+1;ok=used[id]<=stockLeft(p)}}
      nb.push(ok?id:null);au.push(ok&&!!was[i])}
    S.box=nb;S.auto=au}
  S.addons=(S.addons||[]).filter(id=>DB.addons.find(a=>a.id===id&&a.active));
  if(S.editId){const eo=DB.orders.find(x=>x.id===S.editId);if(!eo||eo.status!=="awaiting")S.editId=null}
  if(!full())S.step=1;
}
// the box keeps its spots: a removed cookie leaves an empty spot (null) that is filled again later, nothing moves up
const boxN = () => S.box.filter(Boolean).length;
const firstEmpty = () => {for(let i=0;i<S.size;i++)if(!S.box[i])return i;return -1};
const full = () => S.size>0 && boxN()===S.size;
const countOf = id => S.box.filter(x=>x===id).length;
const isAuto = i => !!(S.box[i]&&S.auto&&S.auto[i]);
const Q = () => quote(S,DB,{withDelivery:S.step===2});
const total = () => {const q=Q();return S.step===2?q.total:r2(q.total-q.addons)};
const TZS=["Asia/Jakarta","Asia/Makassar","Asia/Jayapura","Asia/Singapore","Asia/Kuala_Lumpur","Asia/Bangkok","Asia/Manila","Asia/Hong_Kong","Asia/Tokyo","Australia/Sydney","Europe/London","Europe/Paris","America/New_York","America/Chicago","America/Los_Angeles","UTC"];
// "now" on the shop's clock, so the day list matches what the server accepts wherever the visitor is
function shopNow(){
  if(SBH.on||DB.settings.tz){try{const p=new Intl.DateTimeFormat("en-CA",{timeZone:DB.settings.tz||"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).reduce((a,x)=>(a[x.type]=x.value,a),{});
    return {d:new Date(+p.year,+p.month-1,+p.day),h:+p.hour}}catch(e){}}
  const n=new Date();return {d:today0(),h:n.getHours()};
}
// the three ways to get an order: Sameday shipment, Pickup, Scheduled delivery (each can be switched off and has its own lead time)
const OPT_NAME={sameday:"Sameday shipment",pickup:"Pickup",scheduled:"Scheduled delivery"};
const optOf=c=>c.mode==="pickup"?"pickup":c.speed==="sameday"?"sameday":"scheduled";
const whenTxt=o=>o.mode!=="pickup"&&o.speed==="sameday"?(/after cut-off/.test(o.time||"")?"Sameday (ordered after the cut-off)":"Today (sameday)"):`${fmtDay(o.day)}, ${o.time}`;
const modeName=o=>o.mode==="pickup"?"Pickup":o.speed==="sameday"?"Sameday shipment":o.speed==="scheduled"?"Scheduled delivery":"Delivery";
const optLead=(k,s=DB.settings)=>Math.max(0,+(k==="sameday"?s.samedayLeadH:k==="pickup"?s.pickupLeadH:s.schedLeadH)||0);
const fmtLead=h=>h>=24&&h%24===0?`${h/24} day${h/24>1?"s":""}`:`${h} hour${h===1?"":"s"}`;
function samedayOpen(){const n=shopNow(),s=DB.settings;return !!s.samedayOn&&n.h<s.samedayCutoff&&!s.closedWeekdays.includes(n.d.getDay())}
function samedayLate(){const n=shopNow(),s=DB.settings;return !!s.samedayOn&&n.h>=s.samedayCutoff&&!s.closedWeekdays.includes(n.d.getDay())}
const optOn=k=>k==="sameday"?!!DB.settings.samedayOn:k==="pickup"?DB.settings.pickupOn!==false:DB.settings.schedOn!==false;
const optAvail=k=>k==="sameday"?samedayOpen()||(!!S.sdLate&&samedayLate()):optOn(k);
const schedDays=()=>Math.max(1,Math.min(60,Math.round(+DB.settings.schedMaxDays||7)));
function dayOptions(){
  const now=shopNow(),k=optOf(S);
  if(k==="sameday")return [now.d];
  let start=addDays(now.d,Math.floor((now.h+Math.ceil(optLead(k)))/24));if(now.h>=DB.settings.cutoffHour)start=addDays(start,1);
  if(k==="scheduled"&&ymd(start)<=ymd(now.d))start=addDays(now.d,1);   // scheduled delivery starts tomorrow at the earliest
  return Array.from({length:k==="scheduled"?schedDays():7},(_,i)=>addDays(start,i));
}
// keep the chosen option, day and time valid
function fixWhen(){
  if(!optAvail(optOf(S))){const k=["pickup","scheduled","sameday"].find(optAvail);if(k){S.mode=k==="pickup"?"pickup":"delivery";S.speed=k==="sameday"?"sameday":"scheduled"}}
  if(optOf(S)==="sameday"){S.day=ymd(shopNow().d);S.time="Same day";return}
  if(!dayOptions().some(d=>ymd(d)===S.day)){S.day=null;S.time=null}
  if(S.time&&!DB.settings.times.includes(S.time))S.time=null;
  if(S.time&&S.day&&slotTooSoon(S.day,S.time,optOf(S)))S.time=null;
  if(S.time&&S.day&&slotFull(S.day,S.time))S.time=null;
}
// ---- when must an order be paid? ----
// slotStartMin mirrors the server: "10 to 11am" -> 600 (minutes after midnight), null when it can't be read
function slotStartMin(p){
  p=String(p||"").toLowerCase();let m=p.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/),h1,m1,h2,m2,s1,s2;
  const mins=(h,mi,sf)=>(h%12+(sf==="pm"?12:0))*60+mi;
  if(!m){m=p.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);if(!m)return null;h1=+m[1];m1=+(m[2]||0);if(h1<1||h1>12||m1>59)return null;return mins(h1,m1,m[3])}
  h1=+m[1];m1=+(m[2]||0);s1=m[3];h2=+m[4];m2=+(m[5]||0);s2=m[6];
  if(h1>24||h2>24||m1>59||m2>59)return null;
  if(!s1&&!s2){if(h1>=24)return null;return h1*60+m1}
  if(h1<1||h1>12||h2<1||h2>12)return null;
  if(!s1){s1=s2;if(mins(h1,m1,s1)>mins(h2,m2,s2))s1=s2==="pm"?"am":"pm"}
  return mins(h1,m1,s1);
}
function shopNowT(){ // the shop's wall clock as a plain number, so day and time can be compared in the shop's time zone
  try{const p=new Intl.DateTimeFormat("en-CA",{timeZone:DB.settings.tz||"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).reduce((a,x)=>(a[x.type]=x.value,a),{});
    return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)}catch(e){const n=new Date();return Date.UTC(n.getFullYear(),n.getMonth(),n.getDate(),n.getHours(),n.getMinutes(),n.getSeconds())}
}
// a time slot with a daily limit is used up only by orders whose payment is confirmed
function slotUsed(day,t){if(DB.slotUse)return (DB.slotUse[day]||{})[t]||0;return DB.orders.filter(o=>o.day===day&&o.time===t&&o.paidAt&&o.status!=="cancelled").length}
function slotFull(day,t){const c=(DB.settings.slots||[]).find(x=>x.t===t),l=c&&+c.limit||0;return !!day&&l>0&&slotUsed(day,t)>=l}
const minPayMs=()=>Math.max(1,+DB.settings.minPayMin||30)*60e3;
const slotWall=(day,min)=>{const [y,m,d]=String(day).split("-").map(Number);return Date.UTC(y,m-1,d)+min*60e3};
const slotTooSoon=(day,time,k)=>{const m=slotStartMin(time);return m!==null&&!!day&&slotWall(day,m)<shopNowT()+optLead(k)*3600e3+minPayMs()};
// the pay deadline (real clock): the usual window, but never later than (pickup/delivery time - lead time); sameday gets a short window
function payDeadlineMs(c){
  const st=DB.settings,now=Date.now();let span=Math.max(1,+st.payWindowH||24)*3600e3;
  if(c.mode!=="pickup"&&c.speed==="sameday")span=Math.min(span,Math.max(minPayMs(),(+st.samedayPayMin||60)*60e3));
  else if(c.day){const m=slotStartMin(c.time),k=optOf(c);span=Math.min(span,slotWall(c.day,m===null?540:m)-shopNowT()-optLead(k)*3600e3)}
  return now+Math.max(minPayMs(),span);
}
const fmtSpan=ms=>{const m=Math.max(1,Math.round(ms/60e3)),h=Math.floor(m/60),r=m%60;return h?`${h} hour${h>1?"s":""}${r?` ${r} min`:""}`:`${r} min`};
function applyCdLook(){const st=DB.settings,r=document.documentElement;r.style.setProperty("--pcd",st.payCdColor||"#C8102E");r.style.setProperty("--pcdz",({M:1.1,L:1.4,XL:1.8})[st.payCdSize]||1.4);document.body.classList.toggle("pcd-fx",st.payCdFx!==false)}
let shopCat="all";
const catName = id => (DB.categories.find(c=>c.id===id)||{}).name||"";
/* --- badges, best sellers and menu order --- */
const BADGE_FONTS={display:["Bold display","var(--display)"],body:["Clean","var(--body)"],serif:["Serif",'Georgia,"Times New Roman",serif'],mono:["Typewriter",'ui-monospace,Menlo,Consolas,monospace'],hand:["Handwritten",'"Segoe Script","Bradley Hand","Comic Sans MS",cursive']};
const BADGE_FX={shine:"Shine",pulse:"Pulse",bounce:"Bounce",glow:"Glow",wiggle:"Wiggle",none:"No effect"};
function defaultBadges(){return {autoBest:true,bestTop:3,list:[
  {id:"best",text:"🔥 Best seller",font:"display",color:"#FFFFFF",bg:"#C8102E",fx:"shine"},
  {id:"wanted",text:"💛 Most wanted",font:"display",color:"#3B2200",bg:"#FFC53D",fx:"pulse"},
  {id:"seasonal",text:"🍂 Seasonal",font:"display",color:"#FFFFFF",bg:"#B5541B",fx:"glow"},
  {id:"new",text:"✨ New flavor",font:"display",color:"#FFFFFF",bg:"#000096",fx:"bounce"},
  {id:"limited",text:"⏳ Limited",font:"display",color:"#FFFFFF",bg:"#6B2BD9",fx:"wiggle"}]}}
const PAID_SET=["new","baking","ready","completed"];
// how many of each flavor were bought (last 90 days). Visitors get the totals from the server.
function soldMap(){
  if(DB.sold)return DB.sold;   // shop visitors get the totals from the server
  const m={},since=Date.now()-90*864e5;
  DB.orders.forEach(o=>{if(!PAID_SET.includes(o.status)||(o.createdAt||0)<since)return;Object.entries(o.items||{}).forEach(([k,n])=>m[k]=(m[k]||0)+n)});
  return m;
}
function bestIds(){const b=DB.badges;if(!b||!b.autoBest||!b.list.some(x=>x.id==="best"))return [];const sold=soldMap();
  return DB.products.filter(p=>p.status!=="hidden"&&(sold[p.id]||0)>0).sort((a,c)=>(sold[c.id]||0)-(sold[a.id]||0)).slice(0,Math.max(1,Math.min(10,+b.bestTop||3))).map(p=>p.id)}
function badgesOf(p,best){const ids=[...(p.badges||[])];if((best||bestIds()).includes(p.id)&&!ids.includes("best"))ids.unshift("best");
  return ids.map(id=>(DB.badges.list||[]).find(b=>b.id===id)).filter(Boolean)}
function badgeHTML(b){const f=(BADGE_FONTS[b.font]||BADGE_FONTS.display)[1],fx=BADGE_FX[b.fx]?b.fx:"shine";
  const css=`color:${HEX6.test(b.color||"")?b.color:"#FFFFFF"};background:${HEX6.test(b.bg||"")?b.bg:"#C8102E"};font-family:${f}`;
  return `<span class="bdg fx-${fx}" style="${esc(css)}">${esc(String(b.text||"").slice(0,24))}</span>`}
function menuOrder(list){const by=DB.settings.menuSort||"popular",sold=soldMap(),pos=new Map(DB.products.map((p,i)=>[p.id,i]));
  return list.slice().sort((a,b)=>(isOut(a)-isOut(b))||(by==="popular"?(sold[b.id]||0)-(sold[a.id]||0):0)||(pos.get(a.id)-pos.get(b.id)))}
function renderMenu(){
  const vis=DB.products.filter(p=>p.status!=="hidden");
  const groups=DB.categories.map(c=>({id:c.id,name:c.name,n:vis.filter(p=>p.cat===c.id).length})).filter(g=>g.n);
  const other=vis.filter(p=>!catName(p.cat)).length;
  if(other&&groups.length)groups.push({id:"none",name:"Other",n:other});
  if(shopCat!=="all"&&!groups.some(g=>g.id===shopCat))shopCat="all";
  $("#catBar").hidden=groups.length<2;
  $("#catBar").innerHTML=`<button class="fchip" type="button" data-scat="all" aria-pressed="${shopCat==="all"}">All</button>`+groups.map(g=>`<button class="fchip" type="button" data-scat="${g.id}" aria-pressed="${shopCat===g.id}">${esc(g.name)}</button>`).join("");
  const prods=menuOrder(shopCat==="all"||groups.length<2?vis:vis.filter(p=>shopCat==="none"?!catName(p.cat):p.cat===shopCat)),best=bestIds();
  $("#menuGrid").innerHTML = prods.map((p,i)=>{const bd=badgesOf(p,best).slice(0,2);
    const out=isOut(p),img=true,badge=p.surcharge>0?`<span class="xtra">+${money(p.surcharge)}</span>`:"",
      low=!out&&p.track&&p.stock<=DB.settings.lowStockAt?`<span class="stk">Only ${p.stock} left</span>`:"";
    return `<div class="card${out?" out":""}${img?"":" noimg"}" data-id="${p.id}" style="--i:${i}">
      ${img?`<div class="pwrap">${plateHTML(p)}${badge}${low}${bd.length?`<div class="bdgs">${bd.map(badgeHTML).join("")}</div>`:""}</div>`:""}
      <h4>${esc(p.name)}${img?"":badge}</h4>${(()=>{const r=ratingOf(p);return `<button class="rate${r.n?"":" none"}" type="button" data-reviews="${p.id}" aria-label="${r.n?`${r.avg.toFixed(1)} out of 5 stars, ${r.n} reviews. Read or write a review for ${esc(p.name)}`:`No reviews yet for ${esc(p.name)}`}">${r.n?`<span class="stars">★</span> ${r.avg.toFixed(1)} <span class="cnt">(${r.n})</span>`:"No reviews yet"}</button>`})()}<p>${esc(p.desc)}</p>
      ${out?`<span class="sold">${p.status==="soldout"?"Sold out today":"Out of stock"}</span>`:`<div class="stepper"><button type="button" data-act="dec" aria-label="Remove one ${esc(p.name)}">−</button><output aria-live="polite">0</output><button type="button" data-act="inc" aria-label="Add one ${esc(p.name)}">+</button></div>`}
    </div>`}).join("");
  $("#xtraHint").hidden=!prods.some(p=>p.surcharge>0&&!isOut(p));
}
function renderOpts(){
  const set=DB.settings;fixWhen();
  $("#modes").innerHTML=["sameday","pickup","scheduled"].filter(optOn).map(k=>{const late=k==="sameday"&&!samedayOpen()&&samedayLate(),ok=optAvail(k)||late;return `<button class="chip" type="button" data-opt="${k}" ${late?"data-late=\"1\"":""} ${ok?"":"disabled"}>${OPT_NAME[k]}${ok?"":" (closed today)"}</button>`}).join("");
  const sd=optOf(S)==="sameday";$("#dayBlock").hidden=sd;$("#timeBlock").hidden=sd;
  {const k=optOf(S),t=String(set.courierNote||"").trim(),on=set.courierNoteOn!==false&&!!t;$("#cnoteSd").hidden=!(on&&k==="sameday");$("#cnoteSch").hidden=!(on&&k==="scheduled");$("#cnoteSd").textContent=$("#cnoteSch").textContent=t}
  $("#days").innerHTML = dayOptions().map(d=>{const closed=set.closedWeekdays.includes(d.getDay());
    return `<button class="day" type="button" data-day="${ymd(d)}" ${closed?`disabled aria-label="${fmtDay(ymd(d))}, closed"`:""}><small>${DOW[d.getDay()]}</small><strong>${d.getDate()}</strong></button>`}).join("");
  const closedTxt=set.closedWeekdays.length?`We're closed ${listJoin(set.closedWeekdays.slice().sort().map(d=>DOW_LONG[d])).replace(" or "," and ")}. `:"";
  $("#daysHint").textContent=`${closedTxt}Order at least ${fmtLead(optLead(optOf(S)))} ahead. Orders after ${fmtHour(set.cutoffHour)} count from the next day. Time slots that are too soon are greyed out.`;
  renderTimes();
}
function renderTimes(){
  const k=optOf(S);$("#times").innerHTML=DB.settings.times.map(t=>{const full=slotFull(S.day,t),off=!!S.day&&k!=="sameday"&&slotTooSoon(S.day,t,k);return `<button class="chip" type="button" data-time="${esc(t)}" ${full?`disabled aria-label="${esc(t)}, full"`:off?`disabled aria-label="${esc(t)}, too soon"`:""}>${esc(t)}${full?" · Full":""}</button>`}).join("");
  document.querySelectorAll("[data-time]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.time===S.time));
}
function renderStoreStatic(){
  const set=DB.settings;
  applyPopScale();
  renderMenu();renderMarquee($("#marq"),DB.marquee);
  renderOpts();
  const closedTxt=set.closedWeekdays.length?`We're closed ${listJoin(set.closedWeekdays.slice().sort().map(d=>DOW_LONG[d])).replace(" or "," and ")}. `:"";
  $("#heroStrip").innerHTML=[`Boxes of ${listJoin(activeSizes().map(s=>s.n))}`,set.samedayOn?`Sameday shipment before ${fmtHour(set.samedayCutoff)}`:"",optLead("scheduled")===24&&optLead("pickup")===24?`Order by ${fmtHour(set.cutoffHour)} for the next day`:`Order ${fmtLead(Math.min(optLead("pickup"),optLead("scheduled")))} ahead`,closedTxt?closedTxt.replace("We're closed ","Closed ").replace(/\. $/,""):""].filter(Boolean).map(t=>`<span>${t}</span>`).join("");
  renderLanding();
  $("#hours").innerHTML = set.hours.map(h=>`<dt>${esc(h[0])}</dt><dd>${esc(h[1])}</dd>`).join("");
  $("#addr").textContent = set.address;
  const act=DB.addons.filter(a=>a.active);
  $("#extrasBlock").hidden=!act.length;
  $("#extras").innerHTML=act.map(a=>`<button class="extra" type="button" data-addon="${a.id}" aria-pressed="false"><span class="tick">✓</span>${lvAddon(a,46)}<span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span><span class="pr">${addonPr(a)}</span></button>`).join("");
  heroFloats($("#dome"),DB.page.hero);
}
function ctaState(){
  const left=S.size-boxN();
  if(S.step===1) return left>0?{label:`Pick ${left} more`,dis:false,go:"pick"}:{label:"Choose a day",dis:false,go:"step2"};
  if(!S.day||!S.time) return {label:"Pick a day and time",dis:false,go:"when"};
  if(bsPending(S))return {label:`Checkout (${money(total())})`,dis:false,go:"needcourier"};
  return {label:`Checkout (${money(total())})`,dis:false,go:"checkout"};
}
function renderStore(){
  let q=Q();
  if(S.coupon&&q.couponErr){cpMsg(`Coupon ${S.coupon}: ${q.couponErr}`,false);S.coupon="";q=Q()}
  // custom box
  {const t=DB.settings,cb=$("#customBox");cb.hidden=!t.customOn;
   if(t.customOn){const on=validCustom(S.size),n=on?S.size:snapCustom(S.cv||t.customMin);S.cv=n;
    const base=basePrice(n),sale=bestSale(n),now=sale?r2(base-saleDiscount(sale,base)):base;
    cb.dataset.on=on;
    cb.innerHTML=`<h4>Need a bigger box?</h4><p>Build your own from ${t.customMin} cookies, in steps of ${t.customStep}. ${money(t.customPer)} per cookie.</p>
    <div class="crow"><div class="stepper" role="group" aria-label="Custom box size"><button type="button" data-cstep="-1" aria-label="Fewer cookies" ${n<=t.customMin?"disabled":""}>−</button><input id="cvIn" type="number" inputmode="numeric" min="${t.customMin}" max="${t.customMax}" step="${t.customStep}" value="${n}" aria-label="Number of cookies"><button type="button" data-cstep="1" aria-label="More cookies" ${n+t.customStep>t.customMax?"disabled":""}>+</button></div>
    <span class="cprice num">${sale?`<s style="opacity:.6;font-weight:400">${money(base)}</s> `:""}${money(now)}</span>
    <button class="btn btn-blue btn-sm cuse" type="button" data-cuse ${on?"disabled":""}>${on?"Selected":`Use box of ${n}`}</button></div>${giftPlan(n).length?`<div class="gifthint inl"><span class="ic" aria-hidden="true">🎁</span><span class="t">Free gift with ${n} cookies!</span><button class="gifthint-b" type="button" data-giftsee="${n}">See gifts ›</button></div>`:""}`}}
  // sizes (with live sale prices)
  $("#sizes").innerHTML = activeSizes().map(s=>{const sale=bestSale(s.n),now=sale?r2(s.price-saleDiscount(sale,s.price)):s.price;
    return `<button class="size" type="button" data-size="${s.n}" aria-pressed="${s.n===S.size}">${sale?`<span class="saletag">${sale.type==="percent"?"−"+sale.value+"%":"Sale"}</span>`:""}${giftPlan(s.n).length?`<span class="saletag gifttag${sale?" l":""}">🎁<b class="gt"> Gift</b></span>`:""}<strong>${s.n}</strong><small>COOKIES</small><span class="num">${sale?`<s>${money(s.price)}</s>`:""}${money(now)}</span></button>`}).join("");
  renderGiftHint();renderBarExtras();renderFab();
  document.querySelectorAll(".card").forEach(c=>{const st=c.querySelector(".stepper");if(!st)return;const n=countOf(c.dataset.id);st.querySelector("output").textContent=n;c.classList.toggle("has",n>0);
    st.querySelector('[data-act="dec"]').disabled=n===0;const inc=st.querySelector('[data-act="inc"]'),lim=n>=stockLeft(prod(c.dataset.id));inc.disabled=lim;inc.classList.toggle("off",!lim&&full());inc.setAttribute("aria-disabled",String(lim||full()))});
  $("#fillRest").disabled=full();
  $("#step1").hidden=S.step!==1; $("#step2").hidden=S.step!==2;
  $("#tab1").setAttribute("aria-current",S.step===1?"step":"false");
  $("#tab2").setAttribute("aria-current",S.step===2?"step":"false");
  $("#tab1").classList.toggle("done",S.step===2&&full());
  $("#tab2").disabled=!full();
  document.querySelectorAll("[data-opt]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.opt===optOf(S)));
  {const k=optOf(S),st=DB.settings;const fdp=k!=="pickup"?freeDelSale(S.size):null;$("#modeHint").textContent=(fdp?`🚚 Free delivery promo is on: ${fdp.name}. `:"")+(k==="sameday"?`Sameday shipment adds ${money(st.samedayFee??st.deliveryFee)}. Order before ${fmtHour(st.samedayCutoff)} and we ship about ${fmtLead(optLead("sameday"))} after your payment is confirmed. We deliver within ${st.deliveryKm} km of the shop.`:k==="scheduled"?`Scheduled delivery adds ${money(st.deliveryFee)}. Pick a day and time. We deliver within ${st.deliveryKm} km of the shop.`:"Free pickup at the front counter. Pick a day and time.");}
  document.querySelectorAll(".day").forEach(b=>b.setAttribute("aria-pressed",b.dataset.day===S.day));
  document.querySelectorAll("[data-time]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.time===S.time));
  document.querySelectorAll("[data-addon]").forEach(b=>b.setAttribute("aria-pressed",S.addons.includes(b.dataset.addon)));
  $("#giftNote").value=S.note;
  // box panel
  const cols=S.size<=4?2:S.size<=9?3:4;
  $("#slots").style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;
  $("#slots").innerHTML=Array.from({length:S.size},(_,i)=>{const id=S.box[i];if(!id)return `<div class="slot" aria-hidden="true"></div>`;
    const p=prod(id),pd=pop.get(i);return `<button class="slot filled${pd!==undefined?" pop":""}" type="button" data-slot="${i}" style="--i:${i};--pd:${pd||0}ms" aria-label="Double-tap to remove ${esc(p.name)}${isAuto(i)?" (picked by shuffle)":""}">${plateHTML(p)}${isAuto(i)?`<span class="autodie" aria-hidden="true">🎲</span>`:""}</button>`}).join("");
  $("#bpTitle").textContent=`Box of ${S.size}`;
  $("#bpCount").textContent=`${boxN()} of ${S.size}`;
  $("#pillCount").textContent=`${boxN()}/${S.size}`;
  let L=`<div><dt>Box of ${S.size}</dt><dd>${money(q.base)}</dd></div>`;
  if(q.sale)L+=`<div class="saleln"><dt>${esc(q.sale.name)} (${saleOffText(q.sale)})</dt><dd>−${money(q.discount)}</dd></div>`;
  giftLines(S.size).forEach(t=>{L+=`<div class="saleln giftln"><dt>${esc(t)}</dt><dd>${fbHTML("Gift")}</dd></div>`});
  if(q.coupon&&q.couponDisc>0)L+=`<div class="saleln"><dt>Coupon ${esc(q.coupon.code)}</dt><dd>−${money(q.couponDisc)}</dd></div>`;
  if(q.surcharge>0)L+=`<div><dt>Premium flavors</dt><dd>+${money(q.surcharge)}</dd></div>`;
  if(S.step===2){
    S.addons.forEach(id=>{const a=DB.addons.find(x=>x.id===id);if(a)L+=`<div><dt class="withlv">${lvAddon(a,18,true)}${esc(a.name)}</dt><dd>${addonPr(a)}</dd></div>`});
    L+=`<div><dt>${OPT_NAME[optOf(S)]}</dt><dd>${q.feePending?"Choose a courier":q.fee?money(q.fee):fbHTML("Del")}</dd></div>`;
    if(S.day)L+=`<div><dt>When</dt><dd>${S.mode!=="pickup"&&S.speed==="sameday"?(samedayOpen()?"Today (sameday)":"Sameday (after the cut-off)"):fmtDay(S.day)+(S.time?", "+esc(S.time):"")}</dd></div>`;
    if(bsOn()&&S.mode==="delivery"){const sh=bsShip(S);
      L+=`<div class="bscour${q.feePending?" need":""}" id="bsRow"><dt>Courier</dt><dd><button type="button" class="bscbtn" data-bscourier>${sh?`${esc((sh.courierName||sh.courier)+" "+(sh.serviceName||sh.service))} · Change`:S.bsSkip?"Standard delivery · Change":"🛵 Choose courier"}</button></dd></div>`}
  }
  $("#lines").innerHTML=L;
  renderCoupon(q);renderGiftBox();
  $("#total").textContent=money(total());
  const c=ctaState();
  for(const b of [$("#panelCta"),$("#barCta")]){b.textContent=c.label;b.disabled=c.dis;b.dataset.go=c.go||"";b.classList.toggle("ready",!c.dis&&c.go!=="when"&&c.go!=="needcourier");b.classList.toggle("pickmore",c.go==="pick")}
  if(c.go!=="needcourier"){const m=$("#ctaMsg");if(m)m.hidden=true}
  $("#clearBtn").disabled=!boxN();
  $("#randBtn").disabled=!availProducts().length;
  $("#randLabel").textContent=full()?"Shuffle box":"Random fill";
  pop.clear();
  $("#barTotal").textContent=money(total());
  $("#barSub").textContent=S.step===1?`${boxN()} of ${S.size} picked`:`Box of ${S.size}`;
  updateFlash();
  saveCart();
}
function anRender(el,k,cfg,AN,text,ms){
  const c=cfg[k],sig=JSON.stringify([k,text,c.label,c.bg,c.ink,AN.size,AN.cdSize,AN.cdColor,AN.cdBg,AN.cdFx,AN.imgOn&&c.img?c.img.length:0,AN.imgFx]);
  if(el._sig!==sig){el._sig=sig;el._ai=null;el.style.removeProperty("--mdur");el.style.removeProperty("--mbg");
    el.style.setProperty("--fl-bg",c.bg);el.style.setProperty("--fl-ink",c.ink);el.style.setProperty("--fl-cd",AN.cdColor);el.style.setProperty("--fl-cdbg",AN.cdBg);
    el.className="flash sz-"+AN.size+" cds-"+(AN.cdSize||"L")+(AN.cdFx?" fx-cd":"")+(AN.imgOn&&c.img&&AN.imgFx?" fx-img":"")+(el.id==="flash"?" pinned":"");
    el.innerHTML=`<div class="fw">${AN.imgOn&&c.img?`<img class="fimg" src="${esc(c.img)}" alt="">`:`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1 3 9h4l-1 6 6.5-8h-4z" fill="currentColor"/></svg>`}<span class="ftx">${esc(text)}</span>${ms===null?"":`<span class="cdn"></span>`}</div>`}
  const cd=el.querySelector(".cdn");if(cd)cd.textContent=(c.label?c.label+" ":"")+fmtDur(ms);
}
function anCustomMs(c,now){if(!c.endsAt)return null;const t=new Date(c.endsAt).getTime();return isNaN(t)?null:t-now}
// everything the announcer can say right now: live sales, free delivery promos, coming-up ones (24 h ahead) and the owner's own note
function anFill(t,s){return t.replace(/\{name\}/g,s.name).replace(/\{off\}/g,saleOffText(s)).replace(/\{applies\}/g,saleAppliesText(s))}
function anItems(now,AN){
  const items=[];
  DB.sales.filter(s=>saleStatus(s,now)==="live").sort((a,b)=>a.end-b.end).forEach(s=>{const k=isFD(s)?"fdlive":isGift(s)?"giftlive":"live";items.push({k,text:anFill(AN[k].text,s),end:s.end})});
  DB.sales.filter(s=>saleStatus(s,now)==="scheduled"&&s.start-now<24*3600e3).sort((a,b)=>a.start-b.start).forEach(s=>{const k=isFD(s)?"fdsoon":isGift(s)?"giftsoon":"soon";items.push({k,text:anFill(AN[k].text,s),end:s.start})});
  const cm=AN.custom.on&&AN.custom.text?anCustomMs(AN.custom,now):undefined;
  if(AN.custom.on&&AN.custom.text&&!(cm!==null&&cm!==undefined&&cm<=0))items.push({k:"custom",text:AN.custom.text,end:cm===undefined||cm===null?null:now+cm});
  return items;
}
function updateFlash(now=Date.now()){
  applyCdLook();
  const AN=DB.announcer,el=$("#flash"),hdr=$(".top");
  const items=AN.on?anItems(now,AN):[];
  if(!items.length){el.hidden=true;return}
  if(AN.sticky){if(el.parentNode!==hdr)hdr.appendChild(el)}else if(el.parentNode===hdr)hdr.after(el);
  el.hidden=false;
  if(items.length>1)anMarquee(el,items,AN,now);   // two or more at once: one running line
  else anRender(el,items[0].k,AN,AN,items[0].text,items[0].end===null?null:items[0].end-now);
  el.classList.toggle("pinned",!!AN.sticky);
  if(!AN.sticky)el.classList.remove("pinned");
}
// ----- announcer marquee (used when several announcements show at the same time) -----
let anFace=null,anFaceKey="";
function anEnsureFont(m){
  if(!m.fontData){if(anFace){try{document.fonts.delete(anFace)}catch(e){}anFace=null;anFaceKey=""}return}
  const key=m.fontName+m.fontData.length;if(key===anFaceKey)return;
  try{if(anFace)document.fonts.delete(anFace);anFace=new FontFace("DD Announcer",`url(${m.fontData})`);document.fonts.add(anFace);anFaceKey=key;anFace.load().then(()=>{document.querySelectorAll(".anmq").forEach(e=>{if(e._ai)anMqBuild(e)})}).catch(()=>{})}catch(e){}
}
const anFontFam=m=>m.font==="custom"&&m.fontData?'"DD Announcer",var(--body)':(MQ_FONTS[m.font]||MQ_FONTS.display)[1];
function anMqSeq(items,AN,n){
  const m=AN.mq,out=[];
  for(let r=0;r<n;r++)items.forEach(it=>{const c=AN[it.k];
    out.push(`<span class="mt anit">${AN.imgOn&&c.img?`<img class="fimg" src="${esc(c.img)}" alt="">`:""}<span class="ftx">${esc(it.text)}</span>${it.end===null?"":`<span class="cdn" data-end="${it.end}" data-lab="${esc(c.label||"")}"></span>`}</span>`);
    out.push(m.sepOn&&m.sepImg?`<img class="mi" src="${esc(imgOk(m.sepImg))}" alt="" draggable="false">`:`<span class="mdot" aria-hidden="true">✦</span>`)});
  return out.join("");
}
function anMqBuild(el){
  const ai=el._ai;if(!ai)return;const {items,AN}=ai;
  el.classList.toggle("still",RM);
  const draw=n=>{const set=anMqSeq(items,AN,n);el.innerHTML=`<div class="track"><div class="set">${set}</div><div class="set" aria-hidden="true">${set}</div></div>`};
  draw(1);
  const cw=el.clientWidth;if(!cw){anCd(el,Date.now());return}
  const w1=el.querySelector(".set").scrollWidth||1,n=Math.max(1,Math.ceil(cw/w1));
  if(n>1)draw(n);
  const w=el.querySelector(".set").scrollWidth;
  el.style.setProperty("--mdur",Math.max(6,w/(MQ_SPEED[AN.mq.speed]||70))+"s");
  anCd(el,Date.now());
}
function anCd(el,now){el.querySelectorAll(".cdn[data-end]").forEach(c=>{const ms=+c.dataset.end-now;c.textContent=(c.dataset.lab?c.dataset.lab+" ":"")+fmtDur(Math.max(0,ms))})}
function anMarquee(el,items,AN,now){
  const m=AN.mq,sig="M"+JSON.stringify([items.map(i=>[i.k,i.text,i.end,AN[i.k].label,AN.imgOn&&AN[i.k].img?AN[i.k].img.length:0]),m,m.sepImg?m.sepImg.length:0,AN.cdSize,AN.cdColor,AN.cdBg,AN.cdFx,AN.imgOn,AN.imgFx]);
  if(el._sig!==sig){el._sig=sig;anEnsureFont(m);
    el.style.setProperty("--mbg",m.bg);el.style.setProperty("--mfg",m.ink);el.style.setProperty("--msz",(MQ_SIZE[m.size]||18)+"px");el.style.setProperty("--mfont",anFontFam(m));
    el.style.setProperty("--fl-bg",m.bg);el.style.setProperty("--fl-ink",m.ink);el.style.setProperty("--fl-cd",AN.cdColor);el.style.setProperty("--fl-cdbg",AN.cdBg);
    el.className="flash marq anmq cds-"+(AN.cdSize||"L")+(AN.cdFx?" fx-cd":"")+(AN.imgOn&&AN.imgFx?" fx-img":"")+(el.id==="flash"?" pinned":"");
    el.setAttribute("aria-label",items.map(i=>i.text).join(". "));
    el._ai={items,AN};anMqBuild(el)}
  else anCd(el,now);
}
/* --- motion helpers --- */
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pop = new Map();
const inView = r => r.bottom>0 && r.top<innerHeight;
function fx(html,cls){const d=document.createElement("div");d.className="fx "+(cls||"");d.innerHTML=html;document.body.appendChild(d);return d}
function squash(el){el.animate([{transform:"scale(1)"},{transform:"scale(1.2,.84) rotate(-10deg)"},{transform:"scale(.9,1.14) rotate(8deg)"},{transform:"scale(1.05) rotate(-2deg)"},{transform:"scale(1)"}],{duration:520,easing:"ease-out"})}
function shake(el){el.animate([{transform:"none"},{transform:"translateX(-8px) scale(.92) rotate(-8deg)"},{transform:"translateX(7px) scale(.92) rotate(7deg)"},{transform:"translateX(-3px) scale(.97)"},{transform:"none"}],{duration:400,easing:"ease-out"})}
function bump(el){el.animate([{transform:"scale(1)"},{transform:"scale(1.5)"},{transform:"scale(1)"}],{duration:320,easing:"ease-out"})}
function tag(el,text){const r=el.getBoundingClientRect(),t=fx(text,"fx-tag");
  t.style.transform=`translate(${r.left+r.width/2-16}px,${r.top-6}px)`;
  t.animate([{opacity:0,transform:t.style.transform+" scale(.6)"},{opacity:1,offset:.25,transform:t.style.transform+" translateY(-14px) scale(1.1)"},{opacity:0,transform:t.style.transform+" translateY(-40px) scale(1)"}],{duration:750,easing:"ease-out"}).onfinish=()=>t.remove()}
function crumbs(el,f){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,cols=[f.dough,f.edge,...f.chips];
  for(let i=0;i<10;i++){const s=4+Math.random()*5,c=fx("");Object.assign(c.style,{width:s+"px",height:s+"px",borderRadius:"40%",background:cols[i%cols.length]});
    const a=Math.random()*Math.PI*2,d=r.width*(.45+Math.random()*.35),x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d;
    c.animate([{transform:`translate(${cx}px,${cy}px) scale(1)`,opacity:1},{transform:`translate(${x}px,${y}px) rotate(${Math.random()*360}deg) scale(1)`,opacity:1,offset:.55},{transform:`translate(${x}px,${y+30}px) scale(.3)`,opacity:0}],{duration:650+Math.random()*200,easing:"cubic-bezier(.2,.7,.4,1)"}).onfinish=()=>c.remove()}}
function flyIn(srcPlate,idx,html){
  const slot=document.querySelector(`[data-slot="${idx}"]`);if(!slot)return;
  let dst=slot.getBoundingClientRect(),toBar=false;
  if(!inView(dst)){const bar=$("#barTotal");if(bar.offsetParent){dst=bar.getBoundingClientRect();toBar=true}else return}
  let src=srcPlate.getBoundingClientRect();
  if(html){const cx=src.left+src.width/2,cy=src.top+src.height/2;src={left:cx-28,top:cy-28,width:56,height:56}}
  const g=fx(html||srcPlate.outerHTML);
  Object.assign(g.style,{width:src.width+"px",height:src.height+"px",transformOrigin:"0 0"});
  const s=toBar?.35:dst.width/src.width,dx=dst.left-src.left,dy=dst.top-src.top;
  if(!toBar)slot.style.visibility="hidden";
  g.animate([{transform:`translate(${src.left}px,${src.top}px) scale(1) rotate(0)`},
    {transform:`translate(${src.left+dx*.5}px,${src.top+dy*.5-90}px) scale(${(1+s)/2}) rotate(200deg)`,offset:.5},
    {transform:`translate(${dst.left}px,${dst.top}px) scale(${s}) rotate(360deg)`}],{duration:620,easing:"cubic-bezier(.45,0,.25,1)"}).onfinish=()=>{
      g.remove();
      if(toBar){bump($("#barTotal"));return}
      slot.style.visibility="";slot.animate([{transform:"scale(.7)"},{transform:"scale(1.18)"},{transform:"scale(1)"}],{duration:320,easing:"ease-out"})}
}
function ghostOut(i){
  if(RM)return;const el=document.querySelector(`[data-slot="${i}"]`);if(!el)return;const r=el.getBoundingClientRect();if(!inView(r))return;
  const g=fx((el.querySelector(".plate")||el.querySelector(".noimg-t")).outerHTML);Object.assign(g.style,{width:r.width+"px",height:r.height+"px"});
  const t=`translate(${r.left}px,${r.top}px)`;
  g.animate([{transform:t+" scale(1)",opacity:1},{transform:t+" scale(1.2) rotate(-25deg)",opacity:1,offset:.3},{transform:t+" translateY(40px) scale(0) rotate(180deg)",opacity:0}],{duration:450,easing:"ease-in"}).onfinish=()=>g.remove()
}
function celebrate(){if(RM)return;const p=$(".boxpanel");
  p.animate([{transform:"scale(1)"},{transform:"scale(1.03) rotate(-.6deg)"},{transform:"scale(.99) rotate(.4deg)"},{transform:"scale(1)"}],{duration:600,delay:400,easing:"ease-out"});
  if(inView(p.getBoundingClientRect()))crumbs(p.querySelector(".slots"),{dough:"#FFFFFF",edge:"#D9DCFA",chips:["#FFFFFF","#EEF0FF"]})}
/* --- box actions --- */
// a smaller box: the cookies move up to fit
function setSize(n){S.size=n;if(S.box.slice(0,n).filter(Boolean).length<boxN()||S.box.length>n){const keep=S.box.map((id,i)=>[id,!!(S.auto&&S.auto[i])]).filter(x=>x[0]).slice(0,n);S.box=keep.map(x=>x[0]);S.auto=keep.map(x=>x[1])}if(!full())S.step=1;renderStore()}
function cpMsg(t,ok){const m=$("#cpnMsg");if(!m)return;m.textContent=t||"";m.hidden=!t;m.classList.toggle("ok",!!ok);clearTimeout(cpMsg.t);if(t)cpMsg.t=setTimeout(()=>{m.hidden=true},6000)}
function renderGiftHint(){
  const el=$("#giftHint");if(!el)return;const pl=giftPlan(S.size);
  if(!pl.length){el.hidden=true;el.innerHTML="";return}
  const rnd=pl.some(x=>x.mode==="random"),one=pl.length===1&&pl[0].mode==="specific"&&pl[0].gifts.length===1;
  el.hidden=false;
  el.innerHTML=`<span class="ic" aria-hidden="true">🎁</span><span class="t">${one?`Free gift with this box: ${esc(pl[0].gifts[0].name)}`:rnd?"Free surprise gift with this box!":"Free gifts with this box!"}</span><button class="gifthint-b" type="button" data-giftsee="${S.size}">See ${one?"gift":"gifts"} ›</button>`;
}
function renderGiftBox(){
  const el=$("#giftBox");if(!el)return;const pl=giftPlan(S.size);
  if(!pl.length){el.hidden=true;el.innerHTML="";return}
  const cl=(v,d)=>/^(#[0-9a-f]{6}|transparent)$/i.test(v||"")?v:d;
  el.hidden=false;
  el.innerHTML=pl.map(x=>{const t=x.sale,rnd=x.mode==="random";
    return `<div class="gb fx-${["shine","pulse","none"].includes(t.fx)?t.fx:"shine"}" style="--gb:${cl(t.bg,"#FFE066")};--gi:${cl(t.ink,"#000096")}"><div class="gh"><span class="gtag">${esc(t.tag||"Gifts")}</span><b class="gt">${esc(t.name)}</b><span class="gend">Ends in <span class="cd" data-exp="${t.end}">${fmtLeft(t.end-Date.now())}</span></span></div>
      <p class="gs">🎁 FREE with your box of ${S.size}. No extra cost:</p><div class="gl big">${rnd?`<span class="gcard rnd"><i aria-hidden="true">🎲</i><b>${giftSurprise(x.limit)}</b><em>FREE</em></span><div class="gpool">${x.gifts.map(g=>giftChip(g," sm")).join("")}</div>`:x.gifts.map(g=>giftCard(g)).join("")}</div>
      <button class="gbsee" type="button" data-giftsee="${S.size}">👀 See what you ${rnd?"may get":"get"}</button><p class="gnote">${GIFT_NOTE}</p></div>`}).join("");
}
/* pop-up with the gifts a box size earns (opened from the strip under the box sizes and from the gift card) */
function openGiftSheet(n){
  const pl=giftPlan(n);if(!pl.length)return;
  $("#gsBody").innerHTML=pl.map(x=>{const rnd=x.mode==="random";
    return `<h3 id="gsTitle">🎁 ${rnd?"Gifts you may get":x.gifts.length>1?"Your free gifts":"Your free gift"}</h3>
    <p class="gs-sub">${esc(x.sale.name)} · with your box of ${n} · ends in <span class="cd" data-exp="${x.sale.end}">${fmtLeft(x.sale.end-Date.now())}</span></p>
    ${x.gifts.map(g=>{const im=g.img||giftImg(g.id);return `<div class="gs-g">${im?`<img src="${esc(imgOk(im))}" alt="">`:`<span class="gs-p" aria-hidden="true">🎁</span>`}<b>${esc(g.name)}</b><em>FREE</em></div>`}).join("")}
    <div class="gs-note"><span aria-hidden="true">${rnd?"🎲":"✅"}</span><span>${rnd?`You get <b>${x.limit===1?"1 of these":x.limit+" of these"}</b>, picked at random when you send your payment proof. `:`${x.gifts.length>1?"These gifts come":"This gift comes"} with your box. `}It's confirmed once we verify your payment.</span></div>`}).join("")
    +`<p class="gs-av">${GIFT_NOTE}</p><button class="btn btn-blue gs-ok" type="button" data-gsclose>Got it</button>`;
  $("#giftSheet").hidden=false;setTimeout(()=>{const b=$("#giftSheet .gs-ok");b&&b.focus()},60);
}
function closeGiftSheet(){$("#giftSheet").hidden=true}
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-giftsee]");if(b){openGiftSheet(+b.dataset.giftsee);return}
  if(e.target.closest("[data-gsclose]"))closeGiftSheet()});
addEventListener("keydown",e=>{if(e.key==="Escape"&&$("#giftSheet")&&!$("#giftSheet").hidden)closeGiftSheet()});
function renderCoupon(q){
  const ap=$("#cpnAp"),f=$("#cpnForm"),ch=$("#cpnCh");if(!ap)return;
  const on=!!(S.coupon&&q.coupon);
  if(on){ap.hidden=false;ap.innerHTML=`<span>🎟 <b>${esc(q.coupon.code)}</b> applied${q.couponDisc>0?` · −${money(q.couponDisc)}`:q.coupon.type==="freedelivery"?(S.mode==="delivery"?" · free delivery":" · free delivery when you pick delivery"):""}</span><button type="button" data-cpnrm aria-label="Remove coupon">✕</button>`}else ap.hidden=true;
  f.hidden=on;
  const list=DB.coupons.filter(c=>c.show&&cpState(c)==="live"&&!(on&&q.coupon.code===c.code));
  ch.innerHTML=on?"":list.map(c=>`<button type="button" data-cpnuse="${esc(c.code)}"><b>${esc(c.code)}</b><small>${esc(c.desc||cpOff(c))}${c.minSpend>0?` · min ${money(c.minSpend)}`:""}</small></button>`).join("");
}
async function applyCoupon(code){
  code=cpNorm(code);if(!code){cpMsg("Type your coupon code first.",false);return}
  if(SBH.on){const r=await SBH.checkCoupon(code,S.size,($("#coPhone")||{}).value||"",S.editId).catch(ex=>({ok:false,err:ex.message}));if(!r.ok){cpMsg(r.err,false);return}}
  const q0=quote({...S,coupon:code},DB,{withDelivery:S.step===2});
  if(q0.couponErr){cpMsg(q0.couponErr,false);return}
  S.coupon=code;$("#cpnIn").value="";renderStore();
  cpMsg(q0.couponDisc>0?`Nice! You saved ${money(q0.couponDisc)}.`:"Coupon added.",true);
  const ap=$("#cpnAp");if(ap&&!RM)ap.animate([{transform:"scale(1)"},{transform:"scale(1.06)"},{transform:"scale(1)"}],{duration:400})
}
$("#cpnForm").addEventListener("submit",e=>{e.preventDefault();applyCoupon($("#cpnIn").value)});
$("#cpn").addEventListener("click",e=>{const u=e.target.closest("[data-cpnuse]");if(u){applyCoupon(u.dataset.cpnuse);return}
  if(e.target.closest("[data-cpnrm]")){S.coupon="";renderStore();cpMsg("Coupon removed.",true)}});
// tap the cookie picture to add it
$("#menuGrid").addEventListener("click",e=>{
  if(e.target.closest("button,a,.stepper"))return;
  const w=e.target.closest(".pwrap, h4");if(!w)return;const card=w.closest(".card");if(!card||card.classList.contains("out"))return;
  add(card.dataset.id,card)});
// box already full: a small bubble right on the tapped flavor (not the toast at the bottom)
function fullMsg(card){
  const w=card&&card.querySelector(".pwrap");if(!w){toast("Your box is full. Double-tap a cookie in your box to take it out.");return}
  let b=w.querySelector(".fullmsg");if(b)b.remove();
  b=document.createElement("div");b.className="fullmsg";b.setAttribute("role","status");
  b.innerHTML=`<b>Your box is full!</b><span>Double-tap a cookie in your box to take it out first.</span>`;w.appendChild(b);
  const r=b.getBoundingClientRect(),vw=document.documentElement.clientWidth,dx=r.left<8?8-r.left:r.right>vw-8?vw-8-r.right:0;if(dx){b.style.left=`calc(50% + ${dx}px)`;b.style.setProperty("--ax",-dx+"px")}
  if(!RM){shake(w.querySelector(".plate")||w);b.animate([{opacity:0,transform:"translate(-50%,8px) scale(.7)"},{opacity:1,transform:"translate(-50%,0) scale(1.06)",offset:.6},{opacity:1,transform:"translate(-50%,0) scale(1)"}],{duration:320,easing:"ease-out"})}
  clearTimeout(b._t);b._t=setTimeout(()=>{if(RM){b.remove();return}b.animate([{opacity:1},{opacity:0,transform:"translate(-50%,-10px)"}],{duration:300,easing:"ease-in"}).onfinish=()=>b.remove()},2400)}
function add(id,card){
  if(full()){fullMsg(card);return}
  if(countOf(id)>=stockLeft(prod(id))){toast(`That's all we have of ${prod(id).name} right now`);return}
  const idx=firstEmpty();if(idx<0)return;S.box[idx]=id;S.auto=S.auto||[];S.auto[idx]=false;
  if(!card||RM)pop.set(idx,0);
  renderStore();
  if(card&&!RM){const pl=card.querySelector(".plate"),p=prod(id),st=card.querySelector(".stepper");
    squash(pl||card.querySelector("h4"));crumbs(pl||st,crumbColors(p));bump(card.querySelector("output"));tag(st,p.surcharge>0?`+1 · +${money(p.surcharge)}`:"+1");
    flyIn(pl,idx)}
  if(full())celebrate();
}
function removeAt(i){
  const id=S.box[i];if(id===undefined)return;ghostOut(i);S.box[i]=null;if(S.auto)S.auto[i]=false;S.step=1;renderStore();
  if(!RM){const card=document.querySelector(`.card[data-id="${id}"]`);if(card&&inView(card.getBoundingClientRect())){shake(card.querySelector(".plate")||card.querySelector("h4"));bump(card.querySelector("output"))}}
}
function removeOne(id,card){const i=S.box.lastIndexOf(id);if(i<0)return;removeAt(i);if(card&&!RM)tag(card.querySelector(".stepper"),"−1")}
const randomId = () => {const a=pickable();return a.length?a[Math.floor(Math.random()*a.length)].id:null};
function fillBox(base){
  S.auto=S.auto||[];let k=0;while(!full()){const id=randomId(),at=firstEmpty();if(!id||at<0)break;S.box[at]=id;S.auto[at]=true;S.shuf=1;pop.set(at,base+k++*80)}
  if(!full())toast("Not enough stock to fill the whole box");
}
function fillRest(){if(!pickable().length){toast("Every flavor is out of stock right now");return}fillBox(0);renderStore();if(full())celebrate()}
// shuffle a full box: only the spots the random button filled get new flavors; what the customer picked by hand stays exactly as it is
function reshuffle(){
  const idx=S.box.map((_,i)=>i).filter(isAuto);
  if(!idx.length){toast("Every spot is hand-picked, so there's nothing to shuffle. Remove one to let us pick it for you.");return false}
  const old=idx.map(i=>S.box[i]);idx.forEach(i=>{ghostOut(i);S.box[i]=null});
  let k=0;idx.forEach((i,n)=>{
    let id=null;for(let t=0;t<6&&(!id||id===old[n]);t++){const c=randomId();if(c)id=c;if(id&&id!==old[n])break}   // try for a different flavor than before
    S.box[i]=id||old[n];pop.set(i,180+k++*80)});
  S.shuf=1;return true}
function randomFill(){
  if(!availProducts().length){toast("Every flavor is out of stock right now");return}
  if(full()){if(!reshuffle())return}
  else fillBox(0);
  renderStore();if(full())celebrate();
  if(!RM)$("#randBtn svg").animate([{transform:"rotate(0)"},{transform:"rotate(360deg)"}],{duration:500,easing:"ease-out"});
}
/* phone bar: random fill / shuffle button, and the floating "show my box" circle (both set in Boxes & extras) */
function showMyBox(){
  const el=$(".boxpanel");if(!el)return;
  const fl=$("#flash"),head=$(".top").getBoundingClientRect().height+(fl.hidden||fl.parentNode===$(".top")?0:fl.getBoundingClientRect().height);
  const go=()=>scrollTo({top:Math.max(0,el.getBoundingClientRect().top+scrollY-head-12),behavior:RM?"auto":"smooth"});
  go();el.classList.remove("boxflash");void el.offsetWidth;el.classList.add("boxflash");setTimeout(()=>el.classList.remove("boxflash"),1500);
}
const fxOk=(v,a,d)=>a.includes(v)?v:d,hexOk=(v,d)=>/^#[0-9a-f]{6}$/i.test(v||"")?v:d;
function renderBarExtras(){
  const t=DB.settings,rb=$("#barRand");if(!rb)return;
  const on=t.rbOn!==false;rb.hidden=!on;if(!on)return;
  const shuf=full(),ic=String(shuf?t.rbIcon2:t.rbIcon).trim()||(shuf?"🔀":"🎲");
  if(rb.dataset.ic!==ic){rb.dataset.ic=ic;rb.textContent=ic}
  rb.className="barrand fx-"+fxOk(t.rbFx,["wiggle","pulse","none"],"wiggle");
  rb.style.setProperty("--rb-bg",hexOk(t.rbBg,"#FFD43B"));
  rb.setAttribute("aria-label",shuf?"Shuffle my box":"Random fill");rb.title=shuf?"Shuffle my box":"Random fill";
  rb.disabled=!availProducts().length;
}
let boxSeen=false;
const fabNum=(v,lo,hi,d)=>{v=parseFloat(v);return Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):d};
const imgIsCut=(u,flag)=>flag===undefined?!/^data:image\/jpe?g/i.test(u||""):!!flag;
/* the round background behind the circle's icon: same choices as the flavor plates (solid, gradient, none, ring, picture size) */
function fabPlateCss(t){
  const type=["color","gradient","none"].includes(t.fabBgType)?t.fabBgType:"color",ring=/^#[0-9a-f]{6}$/i.test(t.fabRing||"")?t.fabRing:"";
  return plateBg({},{type,c1:hexOk(t.fabBg,"#FFD43B"),c2:hexOk(t.fabBg2,"#FF9F43"),dir:"diag",ring,size:fabNum(t.fabImgSize,40,100,84)}).css;
}
const fabIconHTML=(img,emoji,dflt,cut)=>imgOk(img)?`<img class="fab-img${imgIsCut(img,cut)?" cut":""}" src="${esc(imgOk(img))}" alt="" draggable="false">`:esc(String(emoji||"").trim()||dflt);
function fabPillCss(t){const ink=hexOk(t.fabInk,"#000096");return `background:${ink};color:${lumOf(ink)<.5?"#fff":"#000"}`}
const FAB_KEY="delidome-fab-v1";
const fabPrefs=()=>{try{return JSON.parse(localStorage.getItem(FAB_KEY)||"null")||{}}catch(e){return {}}};
const fabSave=o=>{try{localStorage.setItem(FAB_KEY,JSON.stringify(Object.assign(fabPrefs(),o)))}catch(e){}};
/* size and fade: the owner sets the starting values, a customer can only make it smaller or fainter (pinch, or press and hold) */
function fabDims(){
  const t=DB.settings,ds=fabNum(t.fabSizePx,40,96,58),dopa=fabNum(t.fabOpacity,30,100,100),pr=t.fabGest!==false?fabPrefs():{};
  return {ds,dopa,s:Math.min(ds,fabNum(pr.s,30,ds,ds)),o:Math.min(dopa,fabNum(pr.o,25,dopa,dopa))};
}
function renderBarExtras(){
  const t=DB.settings,rb=$("#barRand");if(!rb)return;
  const on=t.rbOn!==false;rb.hidden=!on;if(!on)return;
  const shuf=full(),im=shuf?t.rbImg2:t.rbImg,html=fabIconHTML(im,shuf?t.rbIcon2:t.rbIcon,shuf?"🔀":"🎲",shuf?t.rbImg2Cut:t.rbImgCut);
  if(rb.dataset.ic!==html){rb.dataset.ic=html;rb.innerHTML=html}
  rb.className="barrand fx-"+fxOk(t.rbFx,["wiggle","pulse","none"],"wiggle");
  rb.style.setProperty("--rb-bg",hexOk(t.rbBg,"#FFD43B"));
  rb.setAttribute("aria-label",shuf?"Shuffle my box":"Random fill");rb.title=shuf?"Shuffle my box":"Random fill";
  rb.disabled=!availProducts().length;
}
function renderFab(){
  const t=DB.settings,f=$("#fab");if(!f)return;
  const on=t.fabOn!==false;f.hidden=!on;if(!on)return;
  const tx=t.fabTextOn!==false?String(t.fabText||"").trim().slice(0,14):"",ic=fabIconHTML(t.fabImg,t.fabIcon,"📦",t.fabImgCut),ics=$("#fabIc");
  if(ics.dataset.h!==ic){ics.dataset.h=ic;ics.innerHTML=ic}
  const pl=$("#fabPl"),css=fabPlateCss(t);if(pl.dataset.c!==css){pl.dataset.c=css;pl.style.cssText=css}
  const tt=$("#fabTx");if(tt.textContent!==tx)tt.textContent=tx;tt.hidden=!tx;tt.style.cssText=fabPillCss(t);
  f.className="fab fx-"+fxOk(t.fabFx,["bounce","pulse","glow","none"],"bounce")+(f.classList.contains("dragging")?" dragging":"")+(t.fabHide!==false&&boxSeen?" away":"");
  f.style.setProperty("--fab-ink",hexOk(t.fabInk,"#000096"));
  const d=fabDims();f.style.setProperty("--fab-s",d.s+"px");f.style.setProperty("--fab-o",d.o/100);
  f.title=tx||"Show my box";
  if(!f.dataset.placed){f.dataset.placed="1";if(window.fabApply)fabApply()}
  if(t.fabGest!==false&&!f.classList.contains("away")&&!fabPrefs().hinted){fabSave({hinted:1});setTimeout(()=>toast("Tip: drag the circle to move it. Pinch it, or press and hold, to make it smaller or fainter."),1800)}
}
(function(){
  const f=$("#fab");if(!f)return;let st=null,pinch=null,longT=null;const ptrs=new Map();
  const place=(x,y)=>{const w=f.offsetWidth||58,h=f.offsetHeight||58;x=Math.min(Math.max(6,x),innerWidth-w-6);y=Math.min(Math.max(6,y),innerHeight-h-6);f.style.left=x+"px";f.style.top=y+"px";f.style.bottom="auto"};
  window.fabApply=()=>{const q=fabPrefs();if(typeof q.x==="number"&&typeof q.y==="number")place(q.x*innerWidth,q.y*innerHeight)};
  const setDims=(s,o)=>{const d=fabDims();s=Math.min(d.ds,Math.max(30,s));o=Math.min(d.dopa,Math.max(25,o));f.style.setProperty("--fab-s",s+"px");f.style.setProperty("--fab-o",o/100);if(f.style.top)place(f.offsetLeft,f.offsetTop);return {s,o}};
  const cur=()=>{const d=fabDims();return {s:d.s,o:d.o}};
  /* press and hold: a tiny panel with size and fade sliders */
  const tune=()=>{let el=$("#fabTune");if(!el){el=document.createElement("div");el.id="fabTune";el.className="fabtune";el.hidden=true;
    el.innerHTML=`<label>Size<input type="range" id="ftS" min="30" max="96" step="1"></label><label>Fade<input type="range" id="ftO" min="25" max="100" step="1"></label><button type="button" id="ftR">Reset</button>`;
    document.body.appendChild(el);
    el.addEventListener("input",e=>{const r=setDims(+$("#ftS").value,+$("#ftO").value);fabSave(r);moveTune()});
    $("#ftR").addEventListener("click",()=>{const d=fabDims();fabSave({s:d.ds,o:d.dopa});$("#ftS").value=d.ds;$("#ftO").value=d.dopa;setDims(d.ds,d.dopa)});
    document.addEventListener("pointerdown",e=>{if(!el.hidden&&!e.target.closest("#fabTune")&&!e.target.closest("#fab"))el.hidden=true})}return el};
  const moveTune=()=>{const el=$("#fabTune");if(!el||el.hidden)return;const r=f.getBoundingClientRect(),w=el.offsetWidth||190;
    el.style.left=Math.min(Math.max(8,r.left+r.width/2-w/2),innerWidth-w-8)+"px";el.style.top=Math.max(8,r.top-(el.offsetHeight||110)-10)+"px"};
  const openTune=()=>{const el=tune(),d=fabDims();$("#ftS").max=d.ds;$("#ftS").value=d.s;$("#ftO").max=d.dopa;$("#ftO").value=Math.round(d.o);el.hidden=false;moveTune()};
  f.addEventListener("pointerdown",e=>{
    ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});try{f.setPointerCapture(e.pointerId)}catch(x){}
    if(DB.settings.fabGest!==false&&ptrs.size===2){const [a,b]=[...ptrs.values()];pinch={d0:Math.max(10,Math.hypot(a.x-b.x,a.y-b.y)),s0:cur().s,o0:cur().o};clearTimeout(longT);if(st)st.moved=true;return}
    if(ptrs.size===1){st={id:e.pointerId,sx:e.clientX,sy:e.clientY,ox:f.offsetLeft,oy:f.offsetTop,moved:false,long:false};
      if(DB.settings.fabGest!==false)longT=setTimeout(()=>{if(st&&!st.moved){st.long=true;openTune()}},550)}});
  f.addEventListener("pointermove",e=>{
    if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&ptrs.size>=2){const [a,b]=[...ptrs.values()],k=Math.hypot(a.x-b.x,a.y-b.y)/pinch.d0;f.classList.add("dragging");setDims(pinch.s0*k,pinch.o0);return}
    if(!st||e.pointerId!==st.id)return;const dx=e.clientX-st.sx,dy=e.clientY-st.sy;if(!st.moved&&Math.hypot(dx,dy)<7)return;
    st.moved=true;clearTimeout(longT);f.classList.add("dragging");place(st.ox+dx,st.oy+dy)});
  const end=e=>{
    ptrs.delete(e.pointerId);clearTimeout(longT);
    if(pinch){if(ptrs.size<2){const c=cur(),cs=parseFloat(f.style.getPropertyValue("--fab-s"))||c.s;fabSave({s:Math.round(cs)});pinch=null;f.classList.remove("dragging");f.dataset.moved="1";setTimeout(()=>{delete f.dataset.moved},120)}return}
    if(!st)return;const m=st.moved,lg=st.long;st=null;f.classList.remove("dragging");
    if(m){fabSave({x:f.offsetLeft/innerWidth,y:f.offsetTop/innerHeight})}
    if(m||lg){f.dataset.moved="1";setTimeout(()=>{delete f.dataset.moved},60)}};
  f.addEventListener("pointerup",end);f.addEventListener("pointercancel",end);
  f.addEventListener("click",()=>{if(f.dataset.moved)return;showMyBox()});
  addEventListener("resize",()=>{if(f.style.top)window.fabApply();moveTune()});
  const bp=$(".boxpanel");if(bp&&"IntersectionObserver" in window)new IntersectionObserver(es=>{boxSeen=es[0].intersectionRatio>0.35;renderFab()},{threshold:[0,.35,.7]}).observe(bp);
})();
/* a small "are you sure?" before Clear box or Shuffle once a courier is chosen (wording set in Boxes & extras) */
function guardCardHTML(kind,t){
  const k=kind==="clear"?"Clear":"Shuf",g=(f,d)=>String(t["guard"+k+f]||"").trim()||d;
  const pic=imgOk(t.guardImg)?`<div class="gd-pic"><img class="${imgIsCut(t.guardImg,t.guardImgCut)?"cut":""}" src="${esc(imgOk(t.guardImg))}" alt="" draggable="false"></div>`:`<div class="cw-ring"><span class="cw-emo" aria-hidden="true">${esc(String(t.guardIcon||"").trim()||"🛡️")}</span></div>`;
  return `${pic}<h3 id="gdTitle">${esc(g("Title","Are you sure?"))}</h3>${g("Text","")?`<p>${esc(g("Text",""))}</p>`:""}<div class="cw-act"><button class="btn btn-blue" type="button" data-gdno>${esc(g("No","Keep my box"))}</button><button class="btn btn-ghost-blue" type="button" data-gdok>${esc(g("Ok","Yes"))}</button></div>`;
}
let gdFn=null;
function guardBox(kind,fn){
  const t=DB.settings,on=t.guardOn!==false&&(kind==="clear"?t.guardClear!==false:t.guardShuf!==false);
  if(!on||!bsOn()||S.mode!=="delivery"||!S.ship||!boxN()||(kind!=="clear"&&!full())||(kind==="shuf"&&!S.box.some((_,i)=>isAuto(i)))){fn();return}
  gdFn=fn;$("#gdCard").innerHTML=guardCardHTML(kind,t);$("#gdSheet").hidden=false;
  setTimeout(()=>{const b=$("#gdCard [data-gdno]");b&&b.focus()},60);
}
function closeGuard(){$("#gdSheet").hidden=true;gdFn=null}
$("#gdSheet").addEventListener("click",e=>{
  if(e.target.closest("[data-gdok]")){const f=gdFn;closeGuard();if(f)f();return}
  if(e.target.closest("[data-gdno]")||e.target.id==="gdSheet")closeGuard()});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#gdSheet").hidden)closeGuard()});
/* friendly pop-ups when a visitor gets close to a limit ("warn") or reaches it ("slow" = stop); look and wording set in the Security tab */
const POP_DEF={
  slow:{Title:"Slow down a little, friends!",Text:"Cookies are best eaten slowly… and so is this website. Please wait a moment and try again.",Btn:"OK, I'll slow down",Icon:"🍪",Bg:"#FFF4D6",Ink:"#0B0B45",BtnBg:"#000096",BtnInk:"#FFFFFF",Fx:"bounce",BtnFx:"shine"},
  warn:{Title:"Easy there, cookie lover!",Text:"You're going a little fast. Take a breath, cookies taste better slowly.",Btn:"Got it",Icon:"🐢",Bg:"#EAF6FF",Ink:"#0B0B45",BtnBg:"#0A7F5A",BtnInk:"#FFFFFF",Fx:"float",BtnFx:"pulse"}};
// which part of the shop the limit belongs to (each can have its own message)
const POP_GRP={place_order:"Orders",track_order:"Track",check_coupon:"Coupon",courier:"Courier",submit_proof:"Upload",submit_complaint:"Upload",submit_place:"Upload"};
const SLOW_FX=[["bounce","Bounce"],["wiggle","Wiggle"],["float","Float up and down"],["pulse","Pulse"],["spin","Slow spin"],["none","Still"]],SLOW_BFX=[["shine","Shine sweep"],["pulse","Gentle pulse"],["wiggle","Wiggle"],["none","Still"]];
const slowVars=(t,p="slow")=>{const D=POP_DEF[p],c=k=>hexOk(t[p+k],D[k]);return `--sl-bg:${c("Bg")};--sl-ink:${c("Ink")};--sl-bb:${c("BtnBg")};--sl-bi:${c("BtnInk")};--sl-font:${(MQ_FONTS[t[p+"Font"]]||MQ_FONTS.display)[1].replace(/"/g,"'")}`};
function slowCardHTML(t,p="slow",grp=""){
  const D=POP_DEF[p],g=k=>String(t[p+k]||"").trim()||D[k],fx=fxOk(t[p+"Fx"],SLOW_FX.map(x=>x[0]),D.Fx),bfx=fxOk(t[p+"BtnFx"],SLOW_BFX.map(x=>x[0]),D.BtnFx),u=imgOk(t[p+"Img"]);
  const txt=(grp&&String(t[p+"Msg"+grp]||"").trim())||g("Text");
  const pic=u?`<div class="sl-pic fx-${fx}"><img class="${imgIsCut(u,t[p+"ImgCut"])?"":"crop"}" src="${esc(u)}" alt="" draggable="false"></div>`:`<div class="sl-pic fx-${fx}"><span class="sl-emo" aria-hidden="true">${esc(g("Icon"))}</span></div>`;
  return `${pic}<h3>${esc(g("Title"))}</h3><p>${esc(txt).replace(/\n/g,"<br>")}</p><button class="sl-btn bfx-${bfx}" type="button" data-slowok><span>${esc(g("Btn"))}</span></button>`;
}
const popAt={};
// o: {kind:"warn"|"stop", src: what was called}; true = the owner's test button
window.ddSlow=function(o){
  o=o===true?{force:true}:(o||{});
  const p=o.kind==="warn"?"warn":"slow",t=DB.settings,sh=$("#slowSheet");if(!sh)return;
  const grp=POP_GRP[o.src]||o.grp||"",now=Date.now();
  if(!o.force){
    if(t[p+"On"]===false||(typeof SBH!=="undefined"&&SBH.admin))return;
    if(!sh.hidden&&!(p==="slow"&&sh.dataset.kind==="warn"))return;   // the stop message may replace a warning
    if(p==="slow"){if(now-(popAt.slow||0)<20000)return;popAt.slow=now}
    else{if(now-(popAt.slow||0)<60000||now-(popAt["w"+grp]||0)<300000)return;popAt["w"+grp]=now}
  }
  const c=$("#slowCard");c.className="sheet-card cw-card sl-card sl-"+p;c.style.cssText=slowVars(t,p);c.innerHTML=slowCardHTML(t,p,grp);
  const h=c.querySelector("h3");if(h)h.id="slowTitle";sh.dataset.kind=p;sh.hidden=false;
  setTimeout(()=>{const b=c.querySelector("[data-slowok]");b&&b.focus({preventScroll:true})},60);
};
$("#slowSheet").addEventListener("click",e=>{if(e.target.closest("[data-slowok]")||e.target.id==="slowSheet")$("#slowSheet").hidden=true});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#slowSheet").hidden)$("#slowSheet").hidden=true});
// size of every pop-up in the shop (Security tab, 70% to 130%)
const popZ=t=>Math.min(130,Math.max(70,Math.round(+(t||DB.settings).popScale||100)));
function applyPopScale(){document.documentElement.style.setProperty("--pop-z",String(popZ()/100))}
/* lively picture-or-icon chips: used by the paid extras and the free badges (set in Boxes & extras) */
const LV_FX=[["bounce","Bounce"],["wiggle","Wiggle"],["float","Float up and down"],["pulse","Pulse"],["spin","Slow spin"],["glow","Soft glow"],["none","Still"]];
const LV_BGM=[["solid","Solid colour"],["gradient","Gradient"],["none","None (see through)"]];
const lvBg=(o,d)=>{const m=o.bgMode||"solid",a=hexOk(o.bg,d),b=hexOk(o.bg2,"#FFFFFF");return m==="none"?"transparent":m==="gradient"?`linear-gradient(135deg,${a},${b})`:a};
// o: {img,imgCut,icon,fx,bg,bg2,bgMode}; the picture when there is one, otherwise the icon
function lvHTML(o,dflt,px,still){
  const u=imgOk(o.img),fx=still?"none":fxOk(o.fx,LV_FX.map(x=>x[0]),"none");
  return `<span class="lv fx-${fx}" style="--lv-s:${px}px;background:${lvBg(o,"#FFF4D6")}"><span class="lv-i">${u?`<img class="${imgIsCut(u,o.imgCut)?"":"crop"}" src="${esc(u)}" alt="" draggable="false">`:esc(String(o.icon||"").trim()||dflt)}</span></span>`}
const addonIcon=a=>{const n=String(a.name||"").toLowerCase();return /wrap|gift|ribbon/.test(n)?"🎀":/card|note|message/.test(n)?"💌":/candle/.test(n)?"🕯️":/box|bag/.test(n)?"🛍️":"✨"};
const lvAddon=(a,px,still)=>lvHTML(a,addonIcon(a),px,still);
// "FREE" badges in the checkout box: gift, delivery / pickup, free extra
const FB_DEF={Gift:{icon:"🎁",bg:"#FFE066",ink:"#000096",fx:"pulse",label:"Free gift"},Del:{icon:"🛵",bg:"#D9F7E8",ink:"#0A5F43",fx:"float",label:"Free delivery or pickup"},Extra:{icon:"✨",bg:"#E5E8FF",ink:"#000096",fx:"wiggle",label:"Free extra"}};
function fbHTML(kind){const t=DB.settings,D=FB_DEF[kind],p="fb"+kind;
  if(t[p+"On"]===false)return "Free";
  const txt=String(t[p+"Txt"]||"").trim()||"FREE",o={img:t[p+"Img"],imgCut:t[p+"ImgCut"],icon:t[p+"Icon"],fx:t[p+"Fx"]||D.fx,bgMode:"none"};
  return `<span class="fbadge" style="--fb-bg:${hexOk(t[p+"Bg"],D.bg)};--fb-ink:${hexOk(t[p+"Ink"],D.ink)}">${lvHTML(o,D.icon,18)}<b>${esc(txt)}</b></span>`}
const addonPr=a=>a.price>0?"+"+money(a.price):fbHTML("Extra");
function clearBox(){if(!boxN())return;S.shuf=0;S.box.forEach((_,i)=>ghostOut(i));S.box=[];S.auto=[];S.step=1;renderStore()}
function scrollToEl(el){
  const go=()=>{const fl=$("#flash"),head=$(".top").getBoundingClientRect().height+(fl.hidden||fl.parentNode===$(".top")?0:fl.getBoundingClientRect().height);
    const y=el.getBoundingClientRect().top+window.scrollY-head-16;
    window.scrollTo({top:Math.max(0,y),behavior:"instant"})};
  go();requestAnimationFrame(go);setTimeout(go,120);setTimeout(go,400);
}
function goStep(n){if(n===2&&!full())return;S.step=n;renderStore();
  if(document.activeElement)document.activeElement.blur();
  scrollToEl($(n===2?"#step2":"#build"))}
// point at a field without opening the phone keyboard; the customer taps it when ready
function nudge(el){if(!el)return;try{el.scrollIntoView({block:"center",behavior:RM?"auto":"smooth"})}catch(e){}el.classList.remove("nudge");void el.offsetWidth;el.classList.add("nudge");setTimeout(()=>el.classList.remove("nudge"),1600)}
// a friendly "check your details" pop-up before the checkout form (wording set in Shop settings)
function cwHTML(){const s=DB.settings;return `<div class="cw-ring" aria-hidden="true"><span class="cw-emo">${esc(s.coWarnEmoji||"⚠️")}</span></div><h3 id="cwTitle">${esc(s.coWarnTitle||"")}</h3><p>${esc(s.coWarnText||"").replace(/\n/g,"<br>")}</p>
    <div class="cw-act"><button class="btn btn-blue" type="button" data-cwok>${esc(s.coWarnOk||"Continue")}</button><button class="btn btn-ghost-blue" type="button" data-cwback>${esc(s.coWarnBack||"Go back")}</button></div>`}
function openCoWarn(){const s=DB.settings;if(s.coWarnOn===false){openCheckout();return}
  $("#cwCard").innerHTML=cwHTML();
  $("#cwSheet").hidden=false;document.body.style.overflow="hidden";if(document.activeElement)document.activeElement.blur()}
function closeCoWarn(){const m=$("#cwSheet");if(!m||m.hidden)return;m.hidden=true;document.body.style.overflow=""}
$("#cwSheet").addEventListener("click",e=>{if(e.target.closest("[data-cwok]")){closeCoWarn();openCheckout();return}if(e.target.id==="cwSheet"||e.target.closest("[data-cwback]"))closeCoWarn()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeCoWarn()});
function cta(go){if(go==="pick"){if(document.activeElement)document.activeElement.blur();scrollToEl($("#menuGrid"));return}
  if(go==="when"){if(document.activeElement)document.activeElement.blur();const sd=$("#dayBlock").hidden;scrollToEl($(!sd&&!S.day?"#dayBlock":!sd&&S.day&&!$("#timeBlock").hidden?"#timeBlock":"#step2"));return}
  if(go==="needcourier"){bsNudge();return}
  if(go==="step2")goStep(2);else if(go==="checkout")openCoWarn()}
/* courier choice in the box panel (delivery + Biteship on): a pop-up that reuses the checkout courier box */
function bsNudge(){
  const row=$("#bsRow"),m=$("#ctaMsg");if(m){m.hidden=false;clearTimeout(bsNudge.t);bsNudge.t=setTimeout(()=>{m.hidden=true},6000)}
  if(row){scrollToEl(row);row.classList.remove("nudge");void row.offsetWidth;row.classList.add("nudge");setTimeout(()=>row.classList.remove("nudge"),2200)}
  toast("Please choose a courier first");
}
function bsPopOpen(){
  const body=$("#bsPopBody");body.appendChild($("#addrFields"));body.appendChild($("#bsBox"));
  $("#addrFields").hidden=false;$("#coAddr").required=false;prefillCust();placeFieldsShow();bsBoxOpen();
  $("#bsPop").hidden=false;document.body.style.overflow="hidden";
}
// checkout form: one line with the chosen courier and a Change button (the full courier box lives in the pop-up)
function bsSumDraw(){
  const el=$("#bsSum");if(!el)return;const on=bsOn()&&S.mode==="delivery";el.hidden=!on;if(!on)return;const sh=bsShip(S);
  el.innerHTML=`<span class="flbl" style="font-weight:600;font-size:14px">Courier</span><div class="bssumrow${sh||S.bsSkip?"":" need"}"><span>${sh?`<b>${esc(sh.courierName||sh.courier)}</b> ${esc(sh.serviceName||sh.service)}${sh.eta?` <small>${esc(sh.eta)}</small>`:""}`:S.bsSkip?"Standard delivery":"No courier chosen yet"}</span>${sh?`<span class="num">${money(sh.price)}</span>`:""}<button type="button" class="ghost" data-bscourier>${sh||S.bsSkip?"Change":"🛵 Choose courier"}</button></div>`;
}
function bsPopClose(){
  const f=$("#coForm"),err=$("#coErr");f.insertBefore($("#addrFields"),err);f.insertBefore($("#bsBox"),err);$("#bsBox").hidden=true;
  if(!$("#sheet").hidden){$("#addrFields").hidden=S.mode!=="delivery";$("#coAddr").required=S.mode==="delivery";bsSumDraw();renderCoSummary()}
  $("#bsPop").hidden=true;if($("#sheet").hidden)document.body.style.overflow="";
  const m=$("#ctaMsg");if(m&&!bsPending(S))m.hidden=true;renderStore();
}
document.addEventListener("click",e=>{if(e.target.closest("[data-bscourier]"))bsPopOpen()});
$("#bsPopX").addEventListener("click",bsPopClose);$("#bsPopDone").addEventListener("click",bsPopClose);
$("#bsPop").addEventListener("click",e=>{if(e.target.id==="bsPop")bsPopClose()});
$("#bsPop").addEventListener("input",e=>{if(e.target.id==="coAddr"||e.target.id==="coDNote")saveCust()});
const CUST_KEY="delidome-cust-v1";
function loadCust(){try{return JSON.parse(localStorage.getItem(CUST_KEY)||"{}")||{}}catch(e){return {}}}
function saveCust(){try{const r=document.querySelector('input[name="coNotify"]:checked');localStorage.setItem(CUST_KEY,JSON.stringify(Object.assign(loadCust(),{name:$("#coName").value,phone:$("#coPhone").value,email:$("#coEmail").value,address:$("#coAddr").value,dnote:$("#coDNote").value,notify:r?r.value:"both"})))}catch(e){}}
// remember the delivery area and map pin too, so a repeat order only needs a courier choice
function saveLoc(){try{const c=loadCust();c.area=BSD.area||null;c.loc=BSD.lat&&BSD.lng?{lat:BSD.lat,lng:BSD.lng,label:BSD.label}:null;localStorage.setItem(CUST_KEY,JSON.stringify(c))}catch(e){}}
function loadLoc(){const c=loadCust();if(BSD.area||BSD.lat)return;
  if(c.area&&c.area.name){BSD.area=c.area;const a=document.getElementById("bsArea");if(a&&!a.value)a.value=c.area.name}
  if(c.loc&&c.loc.lat&&c.loc.lng){BSD.lat=c.loc.lat;BSD.lng=c.loc.lng;BSD.label="Saved from your last order (check it's still right)"}
  if(c.dnote&&!S.dnote)S.dnote=c.dnote}
function prefillCust(){const c=loadCust();if(c.dnote&&!S.dnote)S.dnote=c.dnote;[["#coName","name"],["#coPhone","phone"],["#coEmail","email"],["#coAddr","address"]].forEach(([q,k])=>{if(c[k]&&!$(q).value)$(q).value=c[k]});const r=c.notify&&document.querySelector(`input[name="coNotify"][value="${c.notify}"]`);if(r)r.checked=true}
/* --- checkout: optional courier prices (only when the owner switched Biteship on) --- */
const BSD={area:null,lat:"",lng:"",label:"",opts:[],busy:false,tried:false,err:"",t:0};
function bsBoxOpen(){
  const on=bsOn()&&SBH.on&&S.mode==="delivery";$("#bsBox").hidden=!on;if(!on)return;loadLoc();
  if(BSD.opts.length&&BSD.opts[0].size!==S.size){BSD.opts=[]}
  bsDraw();if(!BSD.opts.length&&(BSD.area||BSD.lat))bsRates();
}
/* free map with a draggable pin (Leaflet + OpenStreetMap), loaded only when the courier box is used */
let bsLeaf=null,bsMapObj=null,bsPin=null,bsPinT=0;
/* --- optional "Note for the driver" + "Photo of your place" (switch on/off in Delivery & courier) --- */
const placeOn=k=>DB.settings[k]!==false;
function placeFieldsShow(){
  const del=S.mode==="delivery";$("#placeNoteWrap").hidden=!(del&&placeOn("dnoteOn"));$("#placePhotoWrap").hidden=!(del&&SBH.on&&placeOn("dphotoOn"));
  $("#coDNote").value=S.dnote||"";const pv=$("#coPhotoPrev");pv.hidden=!S.dphoto;if(S.dphoto)pv.src=S.dphoto;$("#coPhotoRm").hidden=!S.dphoto;
  $("#coPhotoBtn").firstChild.textContent=S.dphoto?"📷 Change photo":"📷 Add photo";
}
async function processPlace(file){
  if(!file||!/^image\//.test(file.type))throw new Error("Please choose a photo (JPG, PNG or WebP).");
  if(file.size>25e6)throw new Error("That image is over 25 MB. Try a smaller one.");
  const url=URL.createObjectURL(file);
  try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("Couldn't read that image."));i.src=url});
    const k=Math.min(1,1000/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.round(img.naturalWidth*k),h=Math.round(img.naturalHeight*k);
    const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
    let o=c.toDataURL("image/webp",.72);if(!o.startsWith("data:image/webp"))o=c.toDataURL("image/jpeg",.75);return o}finally{URL.revokeObjectURL(url)}
}
$("#coDNote").addEventListener("input",e=>{S.dnote=e.target.value.slice(0,200)});
$("#coPhoto").addEventListener("change",async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;try{S.dphoto=await processPlace(f);placeFieldsShow()}catch(err){toast(err.message)}});
$("#coPhotoRm").addEventListener("click",()=>{S.dphoto="";placeFieldsShow()});
function bsLoadLeaflet(){
  if(bsLeaf)return bsLeaf;
  bsLeaf=new Promise((res,rej)=>{const l=document.createElement("link");l.rel="stylesheet";l.href="vendor/leaflet/leaflet.css";document.head.appendChild(l);
    const sc=document.createElement("script");sc.src="vendor/leaflet/leaflet.js";sc.onload=()=>res(window.L);sc.onerror=()=>{bsLeaf=null;rej(new Error("map"))};document.head.appendChild(sc)});
  return bsLeaf;
}
function bsPinSet(lat,lng){
  BSD.lat=(+lat).toFixed(5);BSD.lng=(+lng).toFixed(5);BSD.label="Pin on the map";S.ship=null;BSD.opts=[];bsDraw();
  clearTimeout(bsPinT);bsPinT=setTimeout(bsRates,700);
}
async function bsMapShow(){
  const box=$("#bsMap");if(!box||box.hidden&&!(BSD.lat||BSD.area||BSD.mapOpen))return;
  let L;try{L=await bsLoadLeaflet()}catch(e){box.hidden=true;$("#bsMapHint").hidden=true;return}
  box.hidden=false;$("#bsMapHint").hidden=false;
  const has=BSD.lat&&BSD.lng,ll=has?[+BSD.lat,+BSD.lng]:[-6.2,106.75];
  if(!bsMapObj){
    L.Icon.Default.imagePath="vendor/leaflet/images/";
    bsMapObj=L.map(box,{zoomControl:true,attributionControl:true}).setView(ll,has?17:11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(bsMapObj);
    bsMapObj.on("click",e=>{if(!bsPin)bsPin=L.marker(e.latlng,{draggable:true}).addTo(bsMapObj).on("dragend",ev=>{const p=ev.target.getLatLng();bsPinSet(p.lat,p.lng)});else bsPin.setLatLng(e.latlng);bsPinSet(e.latlng.lat,e.latlng.lng)});
  }else{setTimeout(()=>bsMapObj.invalidateSize(),50)}
  if(has){
    if(!bsPin)bsPin=L.marker(ll,{draggable:true}).addTo(bsMapObj).on("dragend",ev=>{const p=ev.target.getLatLng();bsPinSet(p.lat,p.lng)});else bsPin.setLatLng(ll);
    bsMapObj.setView(ll,Math.max(bsMapObj.getZoom(),16));
  }
  setTimeout(()=>bsMapObj&&bsMapObj.invalidateSize(),120);
}
function bsDraw(){
  const o=$("#bsOpts"),er=$("#bsErr"),pl=$("#bsPlace");if(BSD.area||BSD.lat)saveLoc();
  if(BSD.lat||BSD.mapOpen)bsMapShow();
  pl.hidden=!BSD.label;pl.innerHTML=BSD.label?`📍 ${esc(BSD.label)} · <a href="https://www.openstreetmap.org/?mlat=${esc(BSD.lat)}&mlon=${esc(BSD.lng)}#map=17/${esc(BSD.lat)}/${esc(BSD.lng)}" target="_blank" rel="noopener">Check on the map</a>`:"";
  if(BSD.busy){o.innerHTML=`<p class="note">Looking for couriers…</p>`}
  else{o.innerHTML=BSD.opts.map((x,i)=>`<button type="button" class="bsopt" data-bsopt="${i}" aria-pressed="${S.ship&&S.ship.sig===x.sig}"><span><b>${esc(x.courierName||x.courier)}</b> ${esc(x.serviceName||x.service)}${x.eta?`<small>${esc(x.eta)}</small>`:""}</span><span class="num">${money(x.price)}</span></button>`).join("")
    +(S.bsSkip?`<p class="note">Standard delivery fee selected (${money(DB.settings.deliveryFee)}).</p>`:"")}
  const msg=BSD.err&&!BSD.busy?BSD.err:"";er.hidden=!msg;er.textContent=msg;
  if(msg&&bsFallback()&&!S.bsSkip)o.insertAdjacentHTML("beforeend",`<button type="button" class="ghost" data-bsskip>Use standard delivery (${money(DB.settings.deliveryFee)})</button>`);
}
async function bsRates(){
  if(!(BSD.area||BSD.lat)||BSD.busy)return;
  const my=++BSD.t;BSD.busy=true;BSD.err="";bsDraw();
  try{
    const r=await SBH.fn("biteship",{action:"rates",size:S.size,dest:{lat:BSD.lat,lng:BSD.lng,postal:BSD.area?BSD.area.postal:"",areaId:BSD.area?BSD.area.id:"",areaName:BSD.area?BSD.area.name:""}});
    if(my!==BSD.t)return;BSD.opts=r.options||[];BSD.err=BSD.opts.length?"":(r.error||"No courier is available for this address.");
    if(S.ship&&!BSD.opts.some(x=>x.sig===S.ship.sig)){S.ship=null}
  }catch(e){if(my!==BSD.t)return;BSD.opts=[];BSD.err=e.message}
  BSD.busy=false;bsDraw();renderCoSummary();renderStore();
}
async function bsGeocode(){
  const addr=$("#coAddr").value.trim(),areaTxt=BSD.area?BSD.area.name:$("#bsArea").value.trim();if(!addr&&!areaTxt){BSD.err="Type your address (and your area) first.";bsDraw();return}
  BSD.busy=true;BSD.err="";bsDraw();
  try{const r=await SBH.fn("biteship",{action:"geocode",address:addr,area:areaTxt});BSD.busy=false;BSD.tried=true;
    if(r.found){BSD.lat=r.lat;BSD.lng=r.lng;BSD.label=(r.approx?"Near: ":"")+r.label+(r.approx?" (approximate, please check on the map)":"");S.ship=null;BSD.opts=[];await bsRates();return}
    BSD.err="We couldn't find that address on the map. Pick your area from the list, check the spelling, or use your current location.";
  }catch(e){BSD.busy=false;BSD.err=e.message}
  bsDraw();
}
let bsAreaT=0;
$("#bsArea").addEventListener("input",e=>{
  clearTimeout(bsAreaT);const q=e.target.value.trim(),list=$("#bsAreaList");BSD.area=null;
  if(q.length<3){list.hidden=true;return}
  bsAreaT=setTimeout(async()=>{try{const r=await SBH.fn("biteship",{action:"areas",q});
    list.innerHTML=(r.areas||[]).map((a,i)=>`<button type="button" data-bsarea="${i}">${esc(a.name)}</button>`).join("")||`<p class="note" style="padding:8px">No area found.</p>`;list.hidden=false;list._a=r.areas||[]}catch(err){list.innerHTML=`<p class="note" style="padding:8px">${esc(err.message)}</p>`;list.hidden=false}},350)});
$("#bsAreaList").addEventListener("click",e=>{const b=e.target.closest("[data-bsarea]");if(!b)return;const a=$("#bsAreaList")._a[+b.dataset.bsarea];if(!a)return;
  BSD.area=a;BSD.lat="";BSD.lng="";BSD.label="";BSD.opts=[];BSD.tried=false;S.ship=null;S.bsSkip=false;$("#bsArea").value=a.name;$("#bsAreaList").hidden=true;
  if($("#coAddr").value.trim().length>=5)bsGeocode();else bsRates()});
$("#bsFind").addEventListener("click",bsGeocode);
$("#bsPick").addEventListener("click",()=>{BSD.mapOpen=true;$("#bsMap").hidden=false;bsMapShow()});
$("#bsGeo").addEventListener("click",()=>{
  if(!navigator.geolocation){BSD.err="Your browser can't share its location.";bsDraw();return}
  BSD.busy=true;BSD.err="";bsDraw();
  navigator.geolocation.getCurrentPosition(p=>{BSD.busy=false;BSD.lat=p.coords.latitude.toFixed(5);BSD.lng=p.coords.longitude.toFixed(5);BSD.label="Your current location";S.ship=null;BSD.opts=[];bsRates()},
    ()=>{BSD.busy=false;BSD.err="We couldn't get your location. Allow location access, or search your area instead.";bsDraw()},{timeout:12000,maximumAge:60000})});
$("#bsOpts").addEventListener("click",e=>{
  const b=e.target.closest("[data-bsopt]");if(b){const x=BSD.opts[+b.dataset.bsopt];if(x){S.ship=x;S.bsSkip=false;bsDraw();renderCoSummary();renderStore();$("#coErr").hidden=true}return}
  if(e.target.closest("[data-bsskip]")){S.ship=null;S.bsSkip=true;bsDraw();renderCoSummary();renderStore()}});
function renderCoSummary(){
  const q=quote(S),counts=countItems(S.box);
  $("#summary").innerHTML=`<div><span>Box of ${S.size}</span><span class="num">${money(q.base)}</span></div>`+
    Object.entries(counts).map(([id,n])=>{const p=prod(id);return `<div class="m"><span>${n} × ${esc(p.name)}</span><span>${p.surcharge>0?"+"+money(p.surcharge*n):""}</span></div>`}).join("")+
    (q.sale?`<div class="sl"><span>${esc(q.sale.name)} (${saleOffText(q.sale)})</span><span class="num">−${money(q.discount)}</span></div>`:"")+
    giftLines(S.size).map(t=>`<div class="sl"><span>${esc(t)}</span><span class="num">${fbHTML("Gift")}</span></div>`).join("")+
    (q.coupon&&q.couponDisc>0?`<div class="sl"><span>Coupon ${esc(q.coupon.code)}</span><span class="num">−${money(q.couponDisc)}</span></div>`:"")+
    S.addons.map(id=>{const a=DB.addons.find(x=>x.id===id);return a?`<div><span class="withlv">${lvAddon(a,22,true)}${esc(a.name)}</span><span class="num">${addonPr(a)}</span></div>`:""}).join("")+
    `<div><span>${OPT_NAME[optOf(S)]}</span><span class="num">${q.feePending?"Choose a courier below":q.fee?money(q.fee):fbHTML("Del")}</span></div>`+
    `<div><span>When</span><span>${esc(whenTxt(S))}</span></div>`+
    (S.note?`<div><span>Note</span><span style="text-align:right">${esc(S.note)}</span></div>`:"")+
    `<div class="t"><span>Total</span><span class="num">${money(q.total)}</span></div>`;
}
function openCheckout(){
  renderCoSummary();
  const del=S.mode==="delivery";$("#addrFields").hidden=!del;$("#bsBox").hidden=true;bsSumDraw();placeFieldsShow();
  $("#coAddr").required=del;
  const eo=S.editId&&DB.orders.find(x=>x.id===S.editId);
  if(!eo)prefillCust();
  if(eo){const c=eo.customer;$("#coEmail").value=c.email;$("#coName").value=c.name;$("#coPhone").value=c.phone;$("#coAddr").value=c.address||"";const nr=document.querySelector(`input[name="coNotify"][value="${eo.notify||"both"}"]`);if(nr)nr.checked=true}
  $("#sheetTitle").textContent=eo?"Review changes":"Checkout";$("#placeBtn").textContent=eo?"Save changes":"Place order";
  $("#coNote").textContent=eo?`Your original payment deadline stays the same (${fmtLeft(eo.expiresAt-Date.now())} left).`:`You'll have ${fmtSpan(payDeadlineMs(S)-Date.now())} to pay after placing your order. Unpaid orders are cancelled automatically.`+(S.mode==="delivery"?" Your box may be split into smaller or bigger boxes for delivery safety.":"");
  $("#coErr").hidden=true;$("#checkoutView").hidden=false;$("#doneView").hidden=true;
  $("#sheet").hidden=false;document.body.style.overflow="hidden";
}
function closeSheet(){$("#sheet").hidden=true;document.body.style.overflow="";$("#sheet .sheet-card").style.background="";$("#dnFx")&&($("#dnFx").innerHTML="");endPreview()}
/* --- shop wiring --- */
/* --- shop reviews --- */
const RV={pid:null,stars:0};
function rvEligible(pid){return mineOrders().filter(o=>o.status==="completed"&&o.items&&o.items[pid]&&!(o.rated||{})[pid])}
function renderReviews(){
  const p=prod(RV.pid);if(!p){closeReviews();return}
  const {n,avg}=ratingOf(p),rs=p.reviews.slice().sort((a,b)=>b.at-a.at),el=rvEligible(p.id);
  if(!el.some(o=>o.id===RV.oid))RV.oid=el[0]?el[0].id:null;
  $("#rvCard").innerHTML=`<div class="sheet-top"><div><h3>${esc(p.name)}</h3><span class="note">${n?`<span class="stars">${starStr(Math.round(avg))}</span> ${avg.toFixed(1)} · ${n} review${n>1?"s":""}`:"No reviews yet."}</span></div><button class="x" type="button" data-rvclose aria-label="Close">✕</button></div>
  <div class="rvlist">${rs.map(r=>`<article class="rv"><div class="rv-h"><b>${esc(r.user)}</b>${r.example?`<span class="ex">Sample</span>`:""}${r.verified||r.orderId?`<span class="vf">✓ Bought it</span>`:""}<span class="stars" role="img" aria-label="${r.stars} out of 5 stars">${starStr(r.stars)}</span><small>${fmtShort(r.at)}</small></div><p>${esc(r.text)}</p></article>`).join("")}</div>
  ${el.length?`<form class="form" id="rvForm" novalidate style="margin-top:${n?18:10}px"><h4 style="margin:0">Review your ${esc(p.name)}</h4>
    ${el.length>1?`<div class="field"><label for="rvOrder">From order</label><select class="in" id="rvOrder">${el.map(o=>`<option value="${o.id}" ${o.id===RV.oid?"selected":""}>${esc(o.code)} · ${fmtDay(o.day)}</option>`).join("")}</select></div>`:`<p class="note" style="margin:0">From your order ${esc(el[0].code)}. One review per flavor per order.</p>`}
    <div class="field"><span class="lblx" id="rvRateLbl">Rating</span><div class="starpick" role="radiogroup" aria-labelledby="rvRateLbl">${[1,2,3,4,5].map(i=>`<button type="button" class="sp${i<=RV.stars?" on":""}" data-sp="${i}" role="radio" aria-checked="${i===RV.stars}" aria-label="${i} star${i>1?"s":""}">★</button>`).join("")}</div></div>
    <div class="field"><label for="rvText">Your review (optional)</label><textarea id="rvText" rows="3" maxlength="200" placeholder="What did you think?"></textarea></div>
    <p class="err" id="rvErr" hidden></p><button class="btn btn-blue" type="submit">Post review</button></form>`
  :`<div class="rvlock"><b>Only customers who bought ${esc(p.name)} can review it.</b><span>You can review each flavor once per order, after it's delivered or picked up. Find it in My orders.</span></div>`}`;
}
// one rating per flavor per order, proven by the order's secret token on the server
function rateOrder(o,rt){
  if(SBH.on)return SBH.rate(o.id,rt);
  o.rated=o.rated||{};Object.entries(rt).forEach(([pid,r])=>{const p=prod(pid);if(!p||o.rated[pid]||!o.items[pid])return;
    p.reviews.push({id:uid(),user:(o.customer.name.split(' ')[0]||'Customer').slice(0,30),text:(r.comment||'').trim()||'Rated '+r.n+' out of 5',stars:r.n,at:Date.now(),src:'customer',orderId:o.id});o.rated[pid]=r.n});
  saveDB();return Promise.resolve();
}
function openReviews(id){RV.pid=id;RV.stars=0;RV.oid=null;renderReviews();$("#rvSheet").hidden=false;document.body.style.overflow="hidden"}
function closeReviews(){const m=$("#rvSheet");if(!m||m.hidden)return;m.hidden=true;document.body.style.overflow=""}
$("#menuGrid").addEventListener("click",e=>{const b=e.target.closest("[data-reviews]");if(b)openReviews(b.dataset.reviews)});
$("#rvSheet").addEventListener("click",e=>{
  if(e.target.id==="rvSheet"||e.target.closest("[data-rvclose]")){closeReviews();return}
  const sp=e.target.closest("[data-sp]");
  if(sp){RV.stars=+sp.dataset.sp;document.querySelectorAll("#rvForm .sp").forEach(b=>{const i=+b.dataset.sp;b.classList.toggle("on",i<=RV.stars);b.setAttribute("aria-checked",i===RV.stars)})}
});
$("#rvSheet").addEventListener("change",e=>{if(e.target.id==="rvOrder")RV.oid=e.target.value});
$("#rvSheet").addEventListener("submit",e=>{
  if(e.target.id!=="rvForm")return;e.preventDefault();
  const o=DB.orders.find(x=>x.id===RV.oid),text=$("#rvText").value.trim(),err=$("#rvErr");
  const fail=m=>{err.textContent=m;err.hidden=false};
  if(!o)return fail("We couldn't find your order. Open My orders and try again.");
  if(!RV.stars)return fail("Tap a star rating.");
  const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;
  rateOrder(o,{[RV.pid]:{n:RV.stars,comment:text}}).then(()=>{RV.stars=0;renderReviews();toast("Thanks for your review");renderMenu();renderStore()}).catch(ex=>{btn.disabled=false;fail(ex.message)});
});
$("#catBar").addEventListener("click",e=>{const b=e.target.closest("[data-scat]");if(!b)return;shopCat=b.dataset.scat;renderMenu();renderStore()});
function setCustom(n){S.cv=snapCustom(n);if(validCustom(S.size))setSize(S.cv);else renderStore()}
$("#customBox").addEventListener("click",e=>{const st=e.target.closest("[data-cstep]"),u=e.target.closest("[data-cuse]"),t=DB.settings;
  if(st){const n=(S.cv||t.customMin)+(+st.dataset.cstep)*t.customStep;setCustom(Math.min(Math.max(n,t.customMin),t.customMax))}
  else if(u)setSize(snapCustom(S.cv))});
$("#customBox").addEventListener("change",e=>{if(e.target.id==="cvIn")setCustom(e.target.value)});
$("#customBox").addEventListener("keydown",e=>{if(e.target.id==="cvIn"&&e.key==="Enter"){e.preventDefault();e.target.blur()}});
$("#sizes").addEventListener("click",e=>{const b=e.target.closest("[data-size]");if(b)setSize(+b.dataset.size)});
$("#menuGrid").addEventListener("click",e=>{const b=e.target.closest("[data-act]");if(!b)return;const card=b.closest(".card"),id=card.dataset.id;b.dataset.act==="inc"?add(id,card):removeOne(id,card)});
// taking a cookie out needs two quick taps (or Delete on the keyboard), so it can't happen by accident; the spot then stays empty
let slotArm={i:-1,t:0,timer:0};
function clearSlotArm(){clearTimeout(slotArm.timer);document.querySelectorAll(".slot.armed").forEach(e=>e.classList.remove("armed"));slotArm.i=-1}
$("#slots").addEventListener("click",e=>{const b=e.target.closest("[data-slot]");if(!b)return;const i=+b.dataset.slot,now=Date.now();
  if(slotArm.i===i&&now-slotArm.t<=900){clearSlotArm();removeAt(i);return}
  clearSlotArm();slotArm={i,t:now,timer:setTimeout(clearSlotArm,900)};b.classList.add("armed")});
$("#slots").addEventListener("keydown",e=>{const b=e.target.closest("[data-slot]");if(b&&(e.key==="Delete"||e.key==="Backspace")){e.preventDefault();clearSlotArm();removeAt(+b.dataset.slot)}});
$("#fillRest").addEventListener("click",fillRest);
$("#randBtn").addEventListener("click",()=>guardBox("shuf",randomFill));
$("#barRand").addEventListener("click",()=>guardBox("shuf",()=>{randomFill();if(DB.settings.rbScroll!==false)setTimeout(showMyBox,260)}));
$("#clearBtn").addEventListener("click",()=>guardBox("clear",clearBox));
$("#tab1").addEventListener("click",()=>goStep(1));
$("#tab2").addEventListener("click",()=>goStep(2));
$("#backBtn").addEventListener("click",()=>goStep(1));
$("#modes").addEventListener("click",e=>{const b=e.target.closest("[data-opt]");if(b&&!b.disabled){const k=b.dataset.opt;if(b.dataset.late&&!S.sdLate){openSdPop();return}S.mode=k==="pickup"?"pickup":"delivery";S.speed=k==="sameday"?"sameday":"scheduled";renderOpts();renderStore()}});
$("#days").addEventListener("click",e=>{const b=e.target.closest("[data-day]");if(b&&!b.disabled){S.day=b.dataset.day;if(S.time&&slotTooSoon(S.day,S.time,optOf(S)))S.time=null;renderTimes();renderStore()}});
function openSdPop(){const s=DB.settings;$("#sdCard").innerHTML=`<p class="sdmsg">${esc(s.samedayMsg||"").replace(/\n/g,"<br>")}</p><button class="btn btn-blue" type="button" data-sdok>${esc(s.samedayOk||"OK")}</button>${String(s.samedayGo||"").trim()?`<button class="btn btn-ghost-blue" type="button" data-sdgo style="margin-top:8px">${esc(s.samedayGo)}</button>`:""}`;$("#sdSheet").hidden=false;document.body.style.overflow="hidden";const b=$("#sdCard [data-sdok]");b&&b.focus()}
function closeSdPop(){const m=$("#sdSheet");if(!m||m.hidden)return;m.hidden=true;document.body.style.overflow=""}
$("#sdSheet").addEventListener("click",e=>{
  if(e.target.id==="sdSheet"){closeSdPop();return}
  if(e.target.closest("[data-sdgo]")){closeSdPop();S.sdLate=true;S.mode="delivery";S.speed="sameday";renderOpts();renderStore();return}
  if(!e.target.closest("[data-sdok]"))return;
  closeSdPop();
  const k=["scheduled","pickup"].find(optAvail);if(k){S.mode=k==="pickup"?"pickup":"delivery";S.speed="scheduled";fixWhen();const d=dayOptions().find(x=>!DB.settings.closedWeekdays.includes(x.getDay()));S.day=d?ymd(d):null;S.time=null}
  renderOpts();renderStore();const tb=$("#timeBlock");tb&&tb.scrollIntoView&&tb.scrollIntoView({behavior:"smooth",block:"center"});
});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeSdPop()});
$("#times").addEventListener("click",e=>{const b=e.target.closest("[data-time]");if(b){S.time=b.dataset.time;renderStore()}});
$("#extras").addEventListener("click",e=>{const b=e.target.closest("[data-addon]");if(!b)return;const id=b.dataset.addon;
  S.addons=S.addons.includes(id)?S.addons.filter(x=>x!==id):[...S.addons,id];renderStore();if(!RM&&S.addons.includes(id))bump(b.querySelector(".tick"))});
$("#giftNote").addEventListener("input",e=>{S.note=e.target.value;saveCart()});
$("#coForm").addEventListener("input",saveCust);$("#coForm").addEventListener("change",saveCust);
$("#panelCta").addEventListener("click",e=>cta(e.currentTarget.dataset.go));
$("#barCta").addEventListener("click",e=>cta(e.currentTarget.dataset.go));
$("#pillBtn").addEventListener("click",()=>{const b=$("#pillBtn");b.classList.add("tapped");clearTimeout(b._t);b._t=setTimeout(()=>b.classList.remove("tapped"),1400);scrollToEl($("#build"))});
$("#closeSheet").addEventListener("click",closeSheet);
$("#sheet").addEventListener("click",e=>{if(e.target.id==="sheet")closeSheet()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(!$("#sheet").hidden)closeSheet();closeReviews();closeMO()});
$("#moSheet").addEventListener("input",e=>{if(e.target.id==="moMail"){const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v}});
$("#coPhone").addEventListener("input",e=>{const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v});
$("#coForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!/^\d{8,15}$/.test($("#coPhone").value)){$("#coErr").textContent="WhatsApp number: use numbers only, 8 to 15 digits.";$("#coErr").hidden=false;nudge($("#coPhone"));return}
  const f=e.currentTarget;
  if(!f.checkValidity()){const bad=f.querySelector(":invalid");$("#coErr").textContent=`Please check "${bad.labels[0].textContent}".`;$("#coErr").hidden=false;nudge(bad);return}
  const counts=countItems(S.box),short=Object.entries(counts).find(([id,n])=>{const p=prod(id);return !p||p.status!=="available"||n>stockLeft(p)});
  if(short){const p=prod(short[0]),left=p?stockLeft(p):0;
    $("#coErr").textContent=p&&p.status==="available"&&left>0?`Sorry, only ${left} ${p.name} left. Please change your box.`:`Sorry, ${p?p.name:"that flavor"} just sold out. Please change your box.`;
    $("#coErr").hidden=false;sanitizeCart();renderStoreStatic();renderStore();return}
  const q=quote({...S,phone:$("#coPhone").value.trim()}),del=S.mode==="delivery",ed=S.editId?DB.orders.find(x=>x.id===S.editId&&x.status==="awaiting"):null;
  if(S.coupon&&q.couponErr){const m=q.couponErr;S.coupon="";$("#coErr").textContent=m+" The coupon was removed, so please check your new total.";$("#coErr").hidden=false;renderStore();openCheckout();return}
  if(bsPending(S)){$("#coErr").textContent="Please choose a courier to see your delivery price.";$("#coErr").hidden=false;bsSumDraw();$("#bsSum").scrollIntoView({block:"center"});return}
  const notify=(document.querySelector('input[name="coNotify"]:checked')||{value:"both"}).value;
  const cust={name:$("#coName").value.trim(),email:$("#coEmail").value.trim(),phone:$("#coPhone").value.trim(),
    address:del?$("#coAddr").value.trim():""};
  const fields={notify,size:S.size,items:countItems(S.box),mode:S.mode,speed:S.mode==="pickup"?"pickup":S.speed,day:S.day,time:S.time,note:S.note,addons:[...S.addons],sale:q.sale?`${q.sale.name} (${saleOffText(q.sale)})`:"",
    base:q.base,discount:q.discount,coupon:q.coupon?q.coupon.code:"",couponDisc:q.couponDisc,surcharge:q.surcharge,addonsTotal:q.addons,fee:q.fee,total:q.total,customer:cust,gifts:ed&&ed.size===S.size&&ed.gifts?ed.gifts:[],giftsAt:ed&&ed.size===S.size&&ed.gifts?ed.giftsAt:undefined,...(S.mode==="delivery"&&(S.dnote||S.dphoto)?{place:{note:String(S.dnote||"").slice(0,200),photo:!!S.dphoto,img:S.dphoto||"",at:Date.now()}}:{})};
  if(SBH.on){
    const btn=f.querySelector("button[type=submit]");if(btn)btn.disabled=true;
    const pNote=S.mode==="delivery"&&placeOn("dnoteOn")?String(S.dnote||"").trim():"",pImg=S.mode==="delivery"&&placeOn("dphotoOn")?S.dphoto:"";
    SBH.place({notify,sdLate:S.mode!=="pickup"&&S.speed==="sameday"&&!samedayOpen()?true:undefined,shuffled:!!S.shuf,size:S.size,items:fields.items,mode:S.mode,speed:S.speed,day:S.day,time:S.time,note:S.note,addons:[...S.addons],coupon:fields.coupon,expectTotal:q.total,customer:cust,ship:q.ship||undefined},ed).then(o=>{
      if(pNote||pImg)SBH.placeInfo(o.id,pNote,pImg).catch(err=>toast("Order placed, but the driver note or photo didn't save: "+err.message));
      addMine(o.id);S.editId=null;saveCart();renderDone(o,!!ed);
      S=fresh();$("#coForm").reset();saveCart();sanitizeCart();renderStoreStatic();renderStore();renderEditBar();renderBag();
    }).catch(err=>{$("#coErr").textContent=err.message;$("#coErr").hidden=false;SBH.loadShop(true)}).finally(()=>{if(btn)btn.disabled=false});
    return}
  let o;
  if(ed){releaseHold(ed);Object.assign(ed,fields,{editedAt:Date.now()});o=ed;takeHold(o)}
  else{o={id:uid(),code:newCode(),tracked:true,holds:false,createdAt:Date.now(),expiresAt:payDeadlineMs(fields),status:"awaiting",...fields};DB.orders.unshift(o);takeHold(o)}
  if(!ed)logMsg(o,chanList(o.notify),"awaiting",msgText(o,"awaiting"),"system");
  saveDB();addMine(o.id);S.editId=null;saveCart();
  renderDone(o,!!ed);
  S=fresh();$("#coForm").reset();saveCart();sanitizeCart();renderStoreStatic();renderStore();renderEditBar();renderBag();
});
const COOKIE_SVG="data:image/svg+xml,"+encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='28' fill='#D9A066'/><circle cx='32' cy='32' r='28' fill='none' stroke='#B07A3F' stroke-width='3'/><g fill='#4A2A14'><circle cx='22' cy='24' r='4'/><circle cx='40' cy='19' r='3.5'/><circle cx='44' cy='38' r='4'/><circle cx='26' cy='43' r='3.5'/><circle cx='33' cy='31' r='2.6'/></g></svg>");
function thFill(t,o){const del=o.mode==="delivery";return String(t).replace(/\{name\}/g,o.customer.name.split(" ")[0]||"friend").replace(/\{size\}/g,o.size).replace(/\{mode\}/g,del?"delivery":"pickup").replace(/\{when\}/g,`${fmtDay(o.day)}, ${o.time}`).replace(/\{hours\}\s*hours?/g,o.expiresAt?fmtSpan(o.expiresAt-Date.now()):DB.settings.payWindowH+" hours").replace(/\{hours\}/g,o.expiresAt?fmtSpan(o.expiresAt-Date.now()):DB.settings.payWindowH).replace(/\{code\}/g,o.code).replace(/\{total\}/g,money(o.total))}
let dnTimer;
function fxBurst(fx,T,fb){
  clearTimeout(fx._t);fx.innerHTML="";
  if(RM||!T.fx)return;
  const imgs=T.cookies.length?T.cookies:(fb&&fb.length?fb:[COOKIE_SVG]),n=Math.max(4,Math.min(60,+T.amount||28)),cols=["#000096","#ffffff","#F5B942","#7A7AFF"];let h="";
  for(let i=0;i<n;i++){const sz=26+Math.random()*34;h+=`<i class="dn-p" style="--x:${(Math.random()*96).toFixed(1)}%;--s:${sz.toFixed(0)}px;--d:${(Math.random()*2.4).toFixed(2)}s;--t:${(2.6+Math.random()*2.4).toFixed(2)}s;--sw:${(Math.random()*160-80).toFixed(0)}px;--r:${(Math.random()*900-450).toFixed(0)}deg"><img src="${esc(imgs[i%imgs.length])}" alt="" draggable="false"></i>`}
  for(let i=0;i<Math.round(n/2);i++){h+=`<i class="dn-p dot" style="--x:${(Math.random()*98).toFixed(1)}%;--s:${(8+Math.random()*8).toFixed(0)}px;--d:${(Math.random()*2.6).toFixed(2)}s;--t:${(2.2+Math.random()*2).toFixed(2)}s;--sw:${(Math.random()*120-60).toFixed(0)}px;--r:${(Math.random()*1000-500).toFixed(0)}deg;background:${cols[i%cols.length]};${i%cols.length===1?"box-shadow:0 0 0 1px #c9c9ee":""}"></i>`}
  fx.innerHTML=h;fx._t=setTimeout(()=>{fx.innerHTML=""},9000);
}
function dnBurst(){fxBurst($("#dnFx"),DB.thanks)}
function renderDone(o,ed,preview){
  const T=DB.thanks,box=$("#doneBox");
  box.style.setProperty("--dn-acc",T.accent);box.style.setProperty("--dn-cd",T.cdColor);
  $("#sheet .sheet-card").style.background=T.bg;
  const bd=$("#doneBadge");bd.classList.toggle("logo",!!T.logo);bd.innerHTML=T.logo?`<img src="${esc(T.logo)}" alt="${esc(DB.page.name||"Delidome")}">`:"✓";
  $("#doneTitle").textContent=ed?T.titleUpd:T.title;
  $("#doneText").textContent=thFill(T.text,o);$("#doneUrgent").textContent=thFill(T.urgent,o);
  $("#doneCode").textContent=o.code;
  $("#doneView").dataset.id=preview?"":o.id;
  $("#doneCd").innerHTML=`<small>${esc(T.cdLabel)}</small><span class="cd" data-exp="${o.expiresAt}">${fmtLeft(o.expiresAt-Date.now())}</span>`;
  $("#donePM").innerHTML=payMethodsHTML();
  $("#donePay").textContent=T.payBtn;$("#doneClose").textContent=T.trackBtn;$("#newBox").textContent=T.buildBtn;
  $("#checkoutView").hidden=true;$("#doneView").hidden=false;
  if(preview){const sv=$("#storeView");sv.hidden=false;sv.classList.add("th-only");$("#sheet").hidden=false;document.body.style.overflow="hidden"}
  dnBurst();
}
const doneGo=()=>{const id=$("#doneView").dataset.id;closeSheet();if(id)openMO(id)};
function endPreview(){const sv=$("#storeView");if(sv.classList.contains("th-only")){sv.classList.remove("th-only");sv.hidden=true}}
/* the magic gift box in the "proof sent" pop-up: it shakes, opens, and shows the gifts the order earned */
function gmHTML(gl){
  const rnd=gl.some(g=>g.random);
  return `<div class="gmagic" id="gmagic" data-open="0"><button class="gm-box" type="button" id="gmBox" aria-label="Open your gift"><i class="gm-glow"></i><i class="gm-body"></i><i class="gm-lid"></i><i class="gm-bow">🎀</i></button>
    <p class="gm-t" id="gmT">${rnd?"A surprise gift is waiting! Tap the box 🎁":"Your free gift is ready! Tap the box 🎁"}</p>
    <div class="gm-gifts" id="gmGifts" hidden><p class="gm-h">${rnd?"Surprise! You got:":"Your free gift:"}</p><div class="gl big">${gl.map(g=>giftCard(g)).join("")}</div><p class="gm-n">Confirmed once we verify your payment. ${GIFT_NOTE}</p></div></div>`;
}
function gmConfetti(host){
  const cols=["#FFD43B","#FF6B8B","#4DD0E1","#9CCC65","#FFFFFF","#FF9F43"];
  for(let i=0;i<34;i++){const c=document.createElement("i");c.className="gm-c";const a=Math.random()*Math.PI*2,d=70+Math.random()*130;
    c.style.cssText=`--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d-40}px;--r:${Math.random()*720-360}deg;background:${cols[i%cols.length]};animation-delay:${Math.random()*120}ms`;host.appendChild(c)}
  setTimeout(()=>host.querySelectorAll(".gm-c").forEach(c=>c.remove()),1800);
}
let gmTimer=null;
function gmOpen(){
  const m=$("#gmagic");if(!m||m.dataset.open==="1")return;m.dataset.open="1";clearTimeout(gmTimer);
  const still=matchMedia("(prefers-reduced-motion:reduce)").matches;
  m.classList.add(still?"opened":"opening");
  const done=()=>{m.classList.remove("opening");m.classList.add("opened");$("#gmGifts").hidden=false;$("#gmT").hidden=true;gmConfetti(m)};
  if(still)done();else setTimeout(done,950);
}
document.addEventListener("click",e=>{if(e.target.closest("#gmBox"))gmOpen()});
function ppShow(o,preview){
  const P=DB.proofpop,gl=!preview&&o.gifts&&o.gifts.length?o.gifts:null;if(!P.on&&!preview&&!gl)return false;
  const pop=$("#ppPop");
  pop.style.setProperty("--pp-bg",P.bg);pop.style.setProperty("--pp-acc",P.accent);pop.style.setProperty("--pp-ink",P.ink);
  $("#ppCard").innerHTML=`${P.emoji?`<div class="pp-emoji" aria-hidden="true">${esc(P.emoji)}</div>`:""}${P.img?`<img class="pp-img" src="${esc(P.img)}" alt="">`:""}<h3>${esc(P.on||preview?thFill(P.title,o):"Payment proof sent")}</h3><p>${esc(P.on||preview?thFill(P.text,o):"We'll confirm your payment soon.")}</p>${gl?gmHTML(gl):""}<button class="btn" type="button" data-ppclose>${esc(P.on||preview?P.btn:"Close")}</button>`;
  if(preview){const sv=$("#storeView");sv.hidden=false;sv.classList.add("th-only")}
  pop.hidden=false;fxBurst($("#ppFx"),P,DB.thanks.cookies);
  if(gl){clearTimeout(gmTimer);gmTimer=setTimeout(gmOpen,1500)}
  setTimeout(()=>{const b=$("#ppCard [data-ppclose]");b&&b.focus()},60);
  return true;
}
function ppClose(){const pop=$("#ppPop");if(pop.hidden)return;clearTimeout(gmTimer);pop.hidden=true;$("#ppFx").innerHTML="";endPreview()}
$("#ppPop").addEventListener("click",e=>{if(e.target.id==="ppPop"||e.target.closest("[data-ppclose]"))ppClose()});
addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#ppPop").hidden)ppClose()});
$("#doneClose").addEventListener("click",doneGo);
$("#donePay").addEventListener("click",doneGo);
$("#doneView").addEventListener("click",e=>{const b=e.target.closest("[data-pmsave]");if(b)savePayImg(b.dataset.pmsave)});
$("#newBox").addEventListener("click",()=>{S=fresh();renderEditBar();$("#coForm").reset();closeSheet();sanitizeCart();renderStoreStatic();renderStore();scrollToEl($("#build"))});
/* --- My orders (customer): pay, proof, track, edit --- */
const normPhone=v=>String(v||"").replace(/\D/g,"").replace(/^(0|62)/,"");
const MINE_KEY="delidome-mine-v1";let MINE=[];try{MINE=JSON.parse(localStorage.getItem(MINE_KEY)||"[]")||[]}catch(e){}
const addMine=id=>{if(!MINE.includes(id))MINE.unshift(id);try{localStorage.setItem(MINE_KEY,JSON.stringify(MINE))}catch(e){}};
const mineOrders=()=>MINE.map(id=>DB.orders.find(o=>o.id===id)).filter(Boolean);
function fmtLeft(ms){ms=Math.max(0,ms);const t=Math.floor(ms/1000),h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;return [h,m,sec].map(n=>String(n).padStart(2,"0")).join(":")}
const CUS={awaiting:"Awaiting payment",review:"Checking payment",new:"Confirmed",baking:"Baking",cancelled:"Cancelled"};
const isRej=o=>o.status==="awaiting"&&!!o.rejected;
const refundTxt=o=>o.refund?(o.refund.full?"Refunded":"Partly refunded"):"";
const cusLabel=o=>(isRej(o)?"Payment rejected":(CUS[o.status]||stLabel(o.status,o.mode)))+(o.refund?" · "+refundTxt(o):"");
function releaseHold(o){if(SBH.on)return;if(o.tracked&&o.holds){Object.entries(o.items).forEach(([pid,n])=>{const p=prod(pid);if(p&&p.track)p.stock+=n});o.holds=false}}
function takeHold(o){if(SBH.on)return;if(o.tracked&&!o.holds){Object.entries(o.items).forEach(([pid,n])=>{const p=prod(pid);if(p&&p.track)p.stock=Math.max(0,p.stock-n)});o.holds=true}}
function expireOrders(){
  if(SBH.on)return false;
  const now=Date.now();let ch=false;
  DB.orders.forEach(o=>{if(o.status==="awaiting"&&o.expiresAt&&now>=o.expiresAt){o.status="cancelled";o.cancelReason="It was not paid in time, so it was cancelled automatically.";releaseHold(o);logMsg(o,chanList(o.notify||"both"),"cancelled",msgText(o,"cancelled"),"system");ch=true}});
  if(ch)saveDB();return ch;
}
const SEEN_KEY="delidome-seen-v1";let SEEN=0,SEENV=0;try{SEEN=+localStorage.getItem(SEEN_KEY)||0}catch(e){}
function notifs(){
  const map=new Map();
  mineOrders().forEach(o=>(o.msgs||[]).filter(m=>m.status!=="refunded").forEach(m=>{const k=o.id+"|"+m.at+"|"+m.text;const e=map.get(k);if(e){if(!e.ch.includes(m.channel))e.ch.push(m.channel)}else map.set(k,{o,m,ch:[m.channel]})}));
  return [...map.values()].sort((a,b)=>b.m.at-a.m.at);
}
// a friendly nudge to rate orders that were delivered / picked up
const RN_KEY="delidome-ratenudge-v1";let RN_SEEN={};try{RN_SEEN=JSON.parse(localStorage.getItem(RN_KEY)||"{}")||{}}catch(e){}
function rateNudge(){
  if(view!=="store"||!$("#rnPop")||!$("#rnPop").hidden||!$("#moSheet").hidden||!$("#sheet").hidden)return;
  if(Date.now()-(RN_SEEN._last||0)<864e5)return;   // one reminder a day at most
  const o=mineOrders().find(o=>o.status==="completed"&&!(RN_SEEN[o.id]===-1||Date.now()-(RN_SEEN[o.id]||0)<864e5)&&Object.keys(o.items||{}).some(pid=>prod(pid)&&!(o.rated||{})[pid]));if(!o)return;
  const left=Object.keys(o.items).filter(pid=>prod(pid)&&!(o.rated||{})[pid]).map(pid=>prod(pid).name);
  $("#rnPop").innerHTML=`<div class="rn-ic" aria-hidden="true">⭐</div><div class="rn-tx"><b>How were your cookies?</b><span>Your order ${esc(o.code)} was ${o.mode==="delivery"?"delivered":"picked up"}. Rate ${esc(listJoin(left.slice(0,3)).replace(" or "," and "))}${left.length>3?" and more":""}.</span></div><div class="rn-act"><button class="btn btn-blue btn-sm" type="button" data-rnrate="${o.id}">Rate now</button><button class="linkbtn sm" type="button" data-rnlater="${o.id}">Later</button></div>`;
  $("#rnPop").hidden=false;
}
function rnDone(id,forGood){RN_SEEN[id]=forGood?-1:Date.now();RN_SEEN._last=Date.now();try{localStorage.setItem(RN_KEY,JSON.stringify(RN_SEEN))}catch(e){}$("#rnPop").hidden=true}
{const rp=$("#rnPop");if(rp)rp.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.rnrate){rnDone(b.dataset.rnrate,true);openMO(b.dataset.rnrate);setTimeout(()=>{const r=$("#moCard .rstars");r&&r.scrollIntoView({block:"center"})},80)}
  else if(b.dataset.rnlater)rnDone(b.dataset.rnlater)})}
// orders still waiting for payment: the bell tells the customer to pay before the time runs out
const refundsNew=()=>mineOrders().filter(o=>o.refund&&o.refund.at>SEEN);
const refundList=()=>mineOrders().filter(o=>o.refund);
const payDue=()=>mineOrders().filter(o=>o.status==="awaiting"&&o.expiresAt&&o.expiresAt>Date.now());
function renderBell(){
  applyCdLook();
  try{rateNudge()}catch(e){}
  const list=notifs(),n=list.filter(x=>x.m.at>SEEN).length+activeBroadcasts().filter(x=>x.at>SEEN).length+payDue().length+refundsNew().length,b=$("#bellCount"),btn=$("#bellBtn");
  if(!b)return;b.hidden=!n;b.textContent=n>9?"9+":n;btn.classList.toggle("ring",n>0);
  btn.setAttribute("aria-label",n?`Notifications, ${n} new`:"Notifications");
  if(!$("#bellPop").hidden)drawBell(list);
}
let BELLF="all";
const ST_ICON={refunded:"💸",awaiting:"⏳",review:"🔎",new:"✅",baking:"🍪",ready:"🚚",completed:"🎉",cancelled:"❌"};
function drawBell(list){
  $("#bellTabs").innerHTML=[["all","All"],["orders","My orders"],["deals","News & deals"]].map(([k,l])=>`<button type="button" role="tab" data-belltab="${k}" aria-selected="${BELLF===k}">${l}</button>`).join("");
  const items=[];
  if(BELLF!=="deals")payDue().forEach(o=>{
    items.push({at:Infinity,h:`<button class="bell-it bell-pay" type="button" data-bellgo="${o.id}"><span class="bell-ic" aria-hidden="true">⏰</span><span class="bell-tx"><small>Order #${esc(o.code)} · ${isRej(o)?"payment rejected":"waiting for payment"}</small><b>${isRej(o)?"Payment rejected – please send a new proof":"Pay now or you'll miss your cookies!"}</b>${isRej(o)&&o.rejected.reason?`<span class="bell-rej">Reason: ${esc(o.rejected.reason)}</span>`:""}<span class="bell-cdrow">Time left: <span class="cd" data-exp="${o.expiresAt}">${fmtLeft(o.expiresAt-Date.now())}</span></span></span><span class="bell-ch" aria-hidden="true">›</span></button>`})});
  if(BELLF!=="deals")refundList().forEach(o=>{
    items.push({at:o.refund.at,h:`<button class="bell-it${o.refund.at>SEENV?" new":""}" type="button" data-bellgo="${o.id}"><span class="bell-ic" aria-hidden="true">💸</span><span class="bell-tx"><small>Order #${esc(o.code)} · ${fmtAgo(o.refund.at)}</small><b>${o.refund.full?"Your order was refunded":"Part of your order was refunded"}: ${money(o.refund.amount)}</b><span>${o.refund.note?esc(o.refund.note)+" · ":""}It can take a few days to show in your account.</span></span><span class="bell-ch" aria-hidden="true">›</span></button>`})});
  if(BELLF!=="deals")list.forEach(x=>{const st=x.m.status,o=x.o,lab=x.m.courier?"Courier update":st==="complaint"?"Complaint update":st?stLabel(st,o.mode):"Update";
    items.push({at:x.m.at,h:`<button class="bell-it${x.m.at>SEENV?" new":""}" type="button" data-bellgo="${o.id}"><span class="bell-ic" aria-hidden="true">${x.m.courier?"🛵":st==="complaint"?"💬":ST_ICON[st]||"📦"}</span><span class="bell-tx"><small>Order · ${fmtAgo(x.m.at)}</small><b>Order #${esc(o.code)} · ${esc(lab)}</b><span>${esc(x.m.text)}</span></span><span class="bell-ch" aria-hidden="true">›</span></button>`})});
  if(BELLF!=="orders")DB.sales.filter(s=>saleStatus(s)!=="ended").forEach(s=>{const live=saleStatus(s)==="live";
    items.push({at:live?s.start:Date.now()-3600e3,h:`<button class="bell-it" type="button" data-bellsale="1"><span class="bell-ic" aria-hidden="true">${isFD(s)?"🚚":isGift(s)?"🎁":"🔥"}</span><span class="bell-tx"><small>${isFD(s)?"Free delivery":isGift(s)?"Gifts":"Flash sale"} · ${live?fmtAgo(s.start):"coming up"}</small><b>${isFD(s)?(live?"Free delivery now":"Free delivery soon"):isGift(s)?(live?"Gifts now":"Gifts soon"):(live?"Flash sale now":"Flash sale soon")}: ${esc(s.name)}</b><span>${esc(saleOffText(s))} · ${live?"ends":"starts"} ${fmtDT(live?s.end:s.start)}</span></span><span class="bell-ch" aria-hidden="true">›</span></button>`})});
  if(BELLF!=="orders")activeBroadcasts().forEach(x=>{const p=x.pid&&prod(x.pid);
    items.push({at:x.at,h:`<button class="bell-it${x.at>SEENV?" new":""}" type="button" ${p?`data-bellprod="${p.id}"`:'data-bellnone="1"'}><span class="bell-ic" aria-hidden="true">${nfIcon(x.type)}</span><span class="bell-tx"><small>${nfName(x.type)} · ${fmtAgo(x.at)}</small><b>${esc(x.title)}</b>${x.text?`<span>${esc(x.text)}</span>`:""}${x.code?`<span class="bell-code" data-bellcode="${esc(x.code)}">🎟 ${esc(x.code)} · tap to copy</span>`:""}${p?`<span style="color:var(--blue);font-weight:600">View ${esc(p.name)}</span>`:""}</span>${p?`<span class="bell-ch" aria-hidden="true">›</span>`:"<span></span>"}</button>`})});
  items.sort((a,b)=>(b.at===Infinity)-(a.at===Infinity)||b.at-a.at);
  $("#bellList").innerHTML=items.length?items.map(i=>i.h).join(""):`<div class="bell-empty">${BELLF==="deals"?"No news or deals right now.":"No notifications yet. Updates about your orders will show up here."}</div>`;
}
function openBell(){SEENV=SEEN;const list=notifs();drawBell(list);const pop=$("#bellPop");pop.hidden=false;$("#bellBtn").setAttribute("aria-expanded","true");
  const latest=Math.max(list.reduce((a,x)=>Math.max(a,x.m.at),SEEN),...refundList().map(o=>o.refund.at),...activeBroadcasts().map(x=>x.at));SEEN=latest;try{localStorage.setItem(SEEN_KEY,String(SEEN))}catch(e){}
  $("#bellCount").hidden=true;$("#bellBtn").classList.remove("ring")}
function closeBell(){const p=$("#bellPop");if(p.hidden)return;p.hidden=true;$("#bellBtn").setAttribute("aria-expanded","false");renderBell()}
$("#bellBtn").addEventListener("click",e=>{e.stopPropagation();$("#bellPop").hidden?openBell():closeBell()});
$("#bellPop").addEventListener("click",e=>{e.stopPropagation();if(e.target.closest("[data-bellclose]")){closeBell();return}
  const cc=e.target.closest("[data-bellcode]");if(cc){const v=cc.dataset.bellcode,orig=cc.textContent;const ok=()=>{cc.textContent="✓ Copied "+v;setTimeout(()=>{cc.textContent=orig},1500)};try{navigator.clipboard.writeText(v).then(ok,()=>toast("Press and hold the code to copy it"))}catch(err){toast("Press and hold the code to copy it")}return}
  const t=e.target.closest("[data-belltab]");if(t){BELLF=t.dataset.belltab;drawBell(notifs());return}
  const bp=e.target.closest("[data-bellprod]");if(bp){closeBell();const el=document.querySelector(`.card[data-id="${bp.dataset.bellprod}"]`);if(el){scrollToEl(el);el.classList.remove("hl");void el.offsetWidth;el.classList.add("hl");setTimeout(()=>el.classList.remove("hl"),2600)}else scrollToEl($("#build"));return}
  if(e.target.closest("[data-bellsale]")){closeBell();scrollToEl($("#build"));return}
  const g=e.target.closest("[data-bellgo]");if(g){closeBell();openMO(g.dataset.bellgo)}});
document.addEventListener("click",e=>{if(!$("#bellPop").hidden&&!e.target.closest("#bellPop"))closeBell()});
addEventListener("keydown",e=>{if(e.key==="Escape")closeBell()});
function renderBag(){
  const n=mineOrders().filter(o=>o.status==="awaiting").length,b=$("#moCount");
  if(b){b.hidden=!n;b.textContent=n;$("#moBtn").classList.toggle("hot",n>0)}
  renderBell();
}
const MO={id:null,cform:false,rate:{}};
function payMethodsHTML(){
  const ms=DB.payMethods.filter(m=>m.on&&(m.name||m.details||m.img));
  if(!ms.length)return `<p class="mo-sub" style="margin:0">Please contact us for payment details.</p>`;
  return `<div class="pmlist"><div class="mo-sub">${ms.length>1?"Pay with any of these":"How to pay"}</div>${ms.map(m=>`<div class="pmc"><b>${esc(m.name||"Payment")}</b>${m.details?`<pre>${esc(m.details)}</pre>`:""}${m.img?`<button class="pmimgbtn" type="button" data-pmsave="${m.id}" aria-label="Save the ${esc(m.name||"payment")} image"><img class="pmimg" src="${esc(m.img)}" alt="${esc(m.name||"Payment")} image"><span>⬇ Tap to save this image</span></button>`:""}</div>`).join("")}</div>`;
}
async function savePayImg(id){
  const m=DB.payMethods.find(x=>x.id===id);if(!m||!m.img)return;
  const mt=/^data:(image\/(png|jpeg|webp));base64,(.*)$/.exec(m.img);if(!mt){toast("Can't save this image");return}
  const bin=atob(mt[3]),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  const ext=mt[2]==="jpeg"?"jpg":mt[2],name=`${(DB.page.name||"delidome").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-${(m.name||"payment").replace(/[^a-z0-9]+/gi,"-").toLowerCase()}.${ext}`,blob=new Blob([u],{type:mt[1]});
  let dl=null;try{dl=window.claude&&await window.claude.use("downloads")}catch(e){}
  if(dl){try{await dl.save({filename:name,data:blob});toast("Image saved")}catch(err){if(err&&err.code!=="declined")toast("Couldn't save the image here. Press and hold it to save.")}return}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000);toast("Image saved");
}
$("#moSheet").addEventListener("click",e=>{const b=e.target.closest("[data-pmsave]");if(b)savePayImg(b.dataset.pmsave);
  const c=e.target.closest("[data-awbcopy]");if(c){const v=c.dataset.awbcopy;const ok=()=>{c.textContent="Copied";setTimeout(()=>{c.textContent="Copy"},1500)};
    try{navigator.clipboard.writeText(v).then(ok,()=>{toast("Press and hold the number to copy it")})}catch(err){toast("Press and hold the number to copy it")}}});
const proofOk=f=>f&&/^image\//.test(f.type);
async function processProof(file){
  if(!proofOk(file))throw new Error("Please choose a photo or screenshot (JPG, PNG or WebP).");
  if(file.size>25e6)throw new Error("That image is over 25 MB. Try a smaller one.");
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("Couldn't read that image."));i.src=url});
    const MAX=1000,k=Math.min(1,MAX/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.round(img.naturalWidth*k),h=Math.round(img.naturalHeight*k);
    const c=document.createElement("canvas");c.width=w;c.height=h;const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,w,h);x.imageSmoothingQuality="high";x.drawImage(img,0,0,w,h);
    return c.toDataURL("image/jpeg",.78);
  }finally{URL.revokeObjectURL(url)}
}
const bsDriverLine=b=>{const d=b.driver;return d&&(d.name||d.plate||d.phone)?`Driver: <b>${esc(d.name||"Your driver")}</b>${d.plate?` · ${esc(d.plate)}`:""}${d.phone?` · <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>`:""}`:""};
const bsLiveLink=b=>DB.settings.biteship&&DB.settings.biteship.showLink===true&&b.link&&b.biteshipId?`<a href="${esc(safeUrl(b.link))}" target="_blank" rel="noopener">Track the courier live</a>`:"";
/* the "Courier pickup" step of the customer tracker: what the booking is doing right now */
function courierStep(o,b){
  const dl=bsDriverLine(b),lk=bsLiveLink(b),both=[dl,lk].filter(Boolean).join("<br>");
  if(o.status==="ready"||o.status==="completed")return {label:"Picked up by the courier",sub:both};
  if(b.biteshipId){
    if(b.status==="allocated"||b.status==="picking_up")return {label:b.status==="picking_up"?"Driver on the way to pick up":"Driver found",sub:both||"Your driver is coming to pick up your cookies."};
    return {label:"Searching for a driver…",srch:1,sub:["We're finding a courier for your order.",lk].filter(Boolean).join("<br>")};
  }
  if(b.nightHold)return {label:"Searching again tomorrow",srch:1,sub:`No driver was free today. We'll look for a courier again tomorrow from ${fmtHour(b.resumeH??9)}.`};
  if(b.failed)return {label:"Searching for a driver…",srch:1,sub:`<span class="trk-rej">No driver yet. We're arranging another courier.</span>`};
  return {label:"Courier pickup",sub:"We'll call the courier when your cookies are ready."};
}
function moSteps(o){
  if(o.bship&&o.bship.biteshipId&&o.mode==="delivery"&&!o.courier)o.courier=(o.bship.courierName||o.bship.courier)+" "+(o.bship.serviceName||o.bship.service);
  const del=o.mode==="delivery",b=del&&o.bship&&o.bship.courier?o.bship:null,cs=b?courierStep(o,b):null,ship=del&&(o.courier||o.awb),cp=o.complaint;
  const labels=["Order placed","Payment","Confirmed","Baking"];
  if(b)labels.push(cs.label);
  labels.push(del?"Out for delivery":"Ready for pickup",del?"Delivered":"Picked up");
  const off=b?1:0,outI=4+off,endI=5+off,cpI=6+off;
  if(cp)labels.push("Problem reported");
  let idx={awaiting:1,review:1,new:2,baking:3,ready:4,completed:5}[o.status]??1;
  if(b){if(idx>=4)idx+=1;else if(o.status==="baking"&&(b.biteshipId||b.failed))idx=4}
  const failed=!!b&&o.status!=="completed"&&(b.status==="returned"||b.status==="disposed");
  if(failed)labels[endI]="Delivery failed";
  const cpDone=!!cp&&(cp.status==="resolved"||cp.status==="rejected");
  const sub=i=>i===1&&isRej(o)?`<span class="trk-rej">Rejected${o.rejected.reason?": "+esc(o.rejected.reason):""}. Please send a new proof.</span>`:
    i===outI&&del?(ship?`<span class="trk">${o.courier?`Courier: <b>${esc(o.courier)}</b>`:""}${o.courier&&o.awb?"<br>":""}${o.awb?`Airway bill: <b>${esc(o.awb)}</b> <button class="trkcopy" type="button" data-awbcopy="${esc(o.awb)}">Copy</button>`:""}</span>`:(o.status==="ready"?"Courier details will show here soon":"")):
    i===0?fmtDT(o.createdAt):i===1?(o.status==="awaiting"?"Waiting for your payment":o.status==="review"?"Proof sent, we're checking it":"Received"):
    b&&i===4?cs.sub:failed&&i===endI?`<span class="trk-rej">The courier couldn't deliver and your order is being returned. We'll contact you.</span>`:
    cp&&i===cpI?`${CP_STATUS[cp.status]||""}${cp.reply?": "+esc(cp.reply):""}`:"";
  return `<ol class="track-l">${labels.map((l,i)=>{
    const bad=failed&&i===endI,done=!bad&&(i<idx||(o.status==="completed"&&i===endI)||(!!cp&&i===cpI&&cpDone)),now=!bad&&!done&&(i===idx||(!!cp&&i===cpI)),srch=!!b&&i===4&&!!cs.srch&&now;
    const st=(done||now||bad||(i===outI&&ship&&o.status==="completed"))?sub(i):"";
    return `<li class="${done?"done":now?"now":""}${bad?" bad":""}${srch?" srch":""}"><span class="dot">${done?"✓":bad?"!":""}</span><span>${l}${st?`<small>${st}</small>`:""}</span></li>`}).join("")}</ol>`;
}
/* --- ratings and complaints (customer) --- */
const COMPLAINT_REASONS=["Damaged product","Wrong item","Missing item","Product quality","Late delivery","Other"];
const CP_STATUS={open:"New",review:"In review",resolved:"Resolved",rejected:"Rejected"};
const cwinEnd=o=>o.completedAt?o.completedAt+DB.settings.complaintWindowH*3600e3:0;
const cwinOpen=o=>o.status==="completed"&&!o.complaint&&Date.now()<cwinEnd(o);
const UNBOX_NOTE=`<div class="cnote"><b>Please keep your unboxing video.</b><span>Record the whole opening of the package in one uncut video. If something is wrong, we'll ask for it as proof.</span></div>`;
function ratingHTML(o){
  const rated=o.rated||{},ids=Object.keys(o.items);
  const rows=ids.map(pid=>{const p=prod(pid);if(!p)return "";const done=rated[pid];
    return done?`<div class="rrow"><b>${esc(p.name)}</b><span class="stars" role="img" aria-label="You rated ${done} out of 5">${starStr(done)}</span></div>`
    :`<div class="rrow"><b>${esc(p.name)}</b><div class="rstars" role="group" aria-label="Rate ${esc(p.name)}">${[1,2,3,4,5].map(n=>`<button type="button" data-rstar="${pid}" data-n="${n}" aria-label="${n} star${n>1?"s":""}">★</button>`).join("")}</div><input class="in" data-rcomment="${pid}" maxlength="200" placeholder="Say something about it (optional)" aria-label="Comment on ${esc(p.name)}"></div>`}).join("");
  const left=ids.some(pid=>prod(pid)&&!rated[pid]);
  return `<div class="dsec"><h4>Rate your cookies</h4>${rows}${left?`<p class="err" id="rtErr" hidden></p><button class="btn btn-blue btn-sm" type="button" data-rsubmit style="margin-top:8px">Send ratings</button>`:`<p class="hint" style="margin:8px 0 0">Thanks for rating!</p>`}</div>`;
}
function complaintHTML(o){
  if(o.status!=="ready"&&o.status!=="completed")return "";
  const end=cwinEnd(o),win=DB.settings.complaintWindowH;
  if(o.status==="ready")return `<div class="dsec"><h4>Problem with your order?</h4>${UNBOX_NOTE}<p class="hint">You can report a problem for ${win} hours after your order is ${o.mode==="delivery"?"delivered":"picked up"}.</p></div>`;
  if(o.complaint){const c=o.complaint;
    const names=c.scope==="order"?"Whole order":c.items.map(id=>{const p=prod(id);return p?p.name:"Removed flavor"}).join(", ");
    return `<div class="dsec"><h4>Your complaint</h4><div class="cbox"><div class="mo-row"><b>${esc(c.reason)}</b><span class="mo-chip st-${c.status==="resolved"?"completed":c.status==="rejected"?"cancelled":c.status==="review"?"baking":"awaiting"}">${CP_STATUS[c.status]}</span></div>
      <span class="mo-sub">Sent ${fmtDT(c.at)} · ${esc(names)}</span><p style="margin:0;white-space:pre-line">${esc(c.text)}</p>
      ${c.photos.length?`<div class="cphotos">${c.photos.map(src=>`<img src="${esc(imgOk(src))}" alt="Photo you sent">`).join("")}</div>`:""}
      ${c.reply?`<div class="mo-pay"><b>Reply from the shop</b><span style="white-space:pre-line">${esc(c.reply)}</span></div>`:`<p class="hint" style="margin:0">We'll reply here as soon as we've looked at it. Keep your unboxing video handy.</p>`}</div></div>`}
  if(Date.now()>=end)return `<div class="dsec"><h4>Problem with your order?</h4><p class="hint" style="margin:0">The ${win}-hour complaint window for this order has closed.</p></div>`;
  const head=`<div class="dsec"><h4>Problem with your order?</h4>${UNBOX_NOTE}<p class="mo-sub" style="margin:10px 0">Complaint window closes in <span class="cd" data-cexp="${end}">${fmtLeft(end-Date.now())}</span></p>`;
  if(!MO.cform)return head+`<button class="btn btn-ghost-blue btn-sm" type="button" data-cpopen>Report a problem</button></div>`;
  return head+`<form class="form cbox" id="moComplain" novalidate>
    <div class="field"><label for="cpReason">What went wrong?</label><select id="cpReason">${COMPLAINT_REASONS.map(r=>`<option>${r}</option>`).join("")}</select></div>
    <div class="field"><span class="flbl" style="font-weight:600;font-size:14px">Which part of the order?</span>
      <label class="chk"><input type="radio" name="cpScope" value="order" checked> Whole order</label>
      <label class="chk"><input type="radio" name="cpScope" value="items"> Specific flavors</label>
      <div id="cpItems" hidden style="padding-left:26px;display:grid;gap:6px">${Object.keys(o.items).map(pid=>{const p=prod(pid);return p?`<label class="chk"><input type="checkbox" name="cpItem" value="${pid}"> ${o.items[pid]} × ${esc(p.name)}</label>`:""}).join("")}</div></div>
    <div class="field"><label for="cpText">Tell us what happened</label><textarea id="cpText" rows="4" maxlength="600" placeholder="e.g. 3 cookies were crushed when I opened the box"></textarea></div>
    <div class="field"><label for="cpPhotos">Photos (optional, up to 3)</label><input id="cpPhotos" type="file" accept="image/*" multiple></div>
    <label class="chk"><input type="checkbox" id="cpVideo"> I have an uncut unboxing video and can send it if asked.</label>
    <p class="err" id="cpErr" hidden></p>
    <div class="mo-row" style="gap:8px"><button class="btn btn-blue btn-sm" type="submit">Send complaint</button><button class="linkbtn" type="button" data-cpclose>Cancel</button></div></form></div>`;
}
function renderMO(){
  const card=$("#moCard"),list=mineOrders();
  const o=MO.id&&DB.orders.find(x=>x.id===MO.id);
  if(!o){
    MO.id=null;
    card.innerHTML=`<div class="sheet-top"><h3>My orders</h3><button class="x" type="button" data-moclose aria-label="Close">✕</button></div>
    ${list.length?`<div class="mo-list">${list.map(x=>`<button class="mo-card" type="button" data-moopen="${x.id}"><div class="mo-row"><span class="mo-code">${esc(x.code)}</span><span class="mo-chip st-${isRej(x)?"rejected":x.status}">${cusLabel(x)}</span></div>
      <div class="mo-row"><span>Box of ${x.size} · ${money(x.total)}${x.refund?` · <b style="color:#0a7a3b">${refundTxt(x)} ${money(x.refund.amount)}</b>`:""}</span><span class="mo-sub">${fmtDay(x.day)}, ${esc(x.time)}</span></div>
      ${x.status==="completed"&&x.complaint?`<div class="mo-sub">Complaint: ${CP_STATUS[x.complaint.status]}</div>`:cwinOpen(x)?`<div class="mo-sub">Complaint window: <span class="cd" data-cexp="${cwinEnd(x)}">${fmtLeft(cwinEnd(x)-Date.now())}</span></div>`:""}${x.status==="completed"&&Object.keys(x.items).some(id=>prod(id)&&!(x.rated||{})[id])?`<div class="mo-sub">Tap to rate your cookies</div>`:""}
      ${x.status==="awaiting"?`<div class="mo-sub">Pay within <span class="cd" data-exp="${x.expiresAt}">${fmtLeft(x.expiresAt-Date.now())}</span></div>`:""}</button>`).join("")}</div>`:`<p class="hint">No orders yet in this browser. Build a box and it will show up here.</p>`}
    <details class="mo-find" ${list.length?"":"open"}><summary>Find an order</summary>
      <form class="form" id="moFind" novalidate style="margin-top:12px"><div class="row2"><div class="field"><label for="moCode">Order code</label><input id="moCode" placeholder="DD-ABCD" autocapitalize="characters"></div><div class="field"><label for="moMail">WhatsApp number used</label><input id="moMail" type="tel" inputmode="numeric" maxlength="24" placeholder="Numbers only"></div></div>
      <p class="err" id="moErr" hidden></p><button class="btn btn-blue" type="submit">Find order</button></form></details>`;
    return}
  if(SBH.on)SBH.needFiles(o);
  const items=Object.entries(o.items).map(([id,n])=>{const p=prod(id);return `<div class="m"><span>${n} × ${esc(p?p.name:"Removed flavor")}</span><span></span></div>`}).join("");
  const awaiting=o.status==="awaiting";
  const total=Math.max(1,(o.expiresAt||0)-(o.createdAt||0)||DB.settings.payWindowH*3600e3);
  card.innerHTML=`<div class="sheet-top"><div><button class="mo-back" type="button" data-moback>← All orders</button><h3 style="margin-top:6px">${esc(o.code)}</h3></div><button class="x" type="button" data-moclose aria-label="Close">✕</button></div>
  <div class="mo-row" style="margin:6px 0 14px"><span class="mo-chip st-${isRej(o)?"rejected":o.status}">${cusLabel(o)}</span><span class="mo-sub">${modeName(o)} · ${esc(whenTxt(o))}</span></div>
  ${o.refund?`<div class="mo-pay" style="background:#E6F6EC;border-color:#9AD3AE"><b>💸 ${o.refund.full?"Refunded":"Partly refunded"}: ${money(o.refund.amount)}</b><span>${fmtDT(o.refund.at)}${o.refund.note?" · "+esc(o.refund.note):""}</span><span class="mo-sub">It can take a few days to show in your account.</span></div>`:""}
  ${o.status==="cancelled"?`<div class="mo-pay" style="background:#FCE3E8"><b>This order was cancelled.</b><span>${esc(o.cancelReason||"It was cancelled.")}</span><button class="btn btn-blue btn-sm" type="button" data-monew>Build a new box</button></div>`:""}
  ${awaiting?`<div class="mo-pay"><div><div class="mo-sub">Time left to pay</div><div class="mo-big cd" data-exp="${o.expiresAt}">${fmtLeft(o.expiresAt-Date.now())}</div><div class="mo-bar" style="margin-top:8px"><i data-expbar="${o.expiresAt}" data-expfrom="${o.createdAt||0}" style="width:${Math.max(0,Math.min(100,(o.expiresAt-Date.now())/total*100))}%"></i></div><p class="mo-sub" style="margin:8px 0 0">If it isn't paid in time, the order is cancelled automatically.</p></div>
    ${o.rejected?`<div class="rej-box" role="alert"><b>✕ Payment rejected</b><span>${o.rejected.reason?esc(o.rejected.reason):"We couldn't verify your payment proof."}</span><span>Please send a new payment proof below before the time runs out.</span></div>`:""}
    <div><div class="mo-sub">Transfer exactly</div><div class="mo-big">${money(o.total)}</div></div>
    ${payMethodsHTML()}
    <form class="form" id="moPay" novalidate><h4 style="margin:0">Send your payment proof</h4>
      <div class="field"><label for="mpName">Full name</label><input id="mpName" value="${esc(o.customer.name)}" autocomplete="name" required placeholder="Name of the person who paid"></div>
      <div class="field"><label for="mpFile">Proof of payment (photo or screenshot)</label><input id="mpFile" type="file" accept="image/*"></div>
      <img class="proofimg" id="mpPrev" alt="Proof preview" hidden>
      <p class="err" id="mpErr" hidden></p>
      <button class="btn btn-blue" type="submit">I've paid, send proof</button></form></div>`:""}
  ${o.status==="review"&&o.proof?`<div class="mo-pay"><b>We're checking your payment.</b><span class="mo-sub">Sent ${fmtDT(o.proof.at)} by ${esc(o.proof.name)}. This page updates when it's confirmed.</span><img class="proofimg" src="${esc(imgOk(o.proof.img))}" alt="Your payment proof"></div>`:""}
  <div class="dsec" style="margin-top:18px"><h4>Track your order</h4>${o.status==="cancelled"?`<p class="hint" style="margin:0">Cancelled ${o.cancelReason?"":""}</p>`:moSteps(o)}${o.refund?`<ol class="track-l" style="margin-top:6px"><li class="done"><span class="dot">✓</span><span>${o.refund.full?"Refunded":"Partly refunded"} · ${money(o.refund.amount)}<small>${esc(fmtDT(o.refund.at))}</small></span></li></ol>`:""}</div>
  <div class="dsec"><h4>Your box of ${o.size}</h4><div class="summary" style="margin:0">${items}
    ${o.discount>0?`<div class="sl"><span>${esc(o.sale||"Flash sale")}</span><span class="num">−${money(o.discount)}</span></div>`:""}
    ${o.couponDisc>0?`<div class="sl"><span>Coupon ${esc(o.coupon)}</span><span class="num">−${money(o.couponDisc)}</span></div>`:""}
    <div><span>${modeName(o)}</span><span class="num">${o.fee?money(o.fee):"Free"}</span></div>
    <div class="t"><span>Total</span><span class="num">${money(o.total)}</span></div></div>${o.mode==="delivery"?`<p class="hint">Your box may be split into smaller or bigger boxes for delivery safety.</p>`:""}</div>
  ${giftsHTML(o,true)}
  ${bsHTML(o,false)}
  ${placeHTML(o,true)}
  ${o.status==="completed"?ratingHTML(o):""}
  ${complaintHTML(o)}
  ${awaiting?`<div class="mo-row" style="margin-top:14px;gap:8px"><button class="btn btn-ghost-blue btn-sm" type="button" data-moedit="${o.id}">Edit order</button><button class="danger" type="button" data-mocancel="${o.id}">Cancel order</button></div><p class="hint">You can change your box until you've sent payment.</p>`:""}`;
}
function openMO(id){MO.id=id||null;MO.cform=false;MO.rate={};renderMO();$("#moSheet").hidden=false;document.body.style.overflow="hidden"}
function closeMO(){const m=$("#moSheet");if(!m||m.hidden)return;m.hidden=true;document.body.style.overflow=""}
function renderEditBar(){
  const b=$("#editBar"),o=S.editId&&DB.orders.find(x=>x.id===S.editId);
  b.hidden=!o;if(o)b.innerHTML=`<span><b>Editing order ${esc(o.code)}.</b> Change your box, then save at checkout.</span><button type="button" id="stopEdit">Stop editing</button>`;
}
function startEdit(id){
  const o=DB.orders.find(x=>x.id===id);if(!o||o.status!=="awaiting"){toast("This order can't be edited any more");return}
  S.editId=id;S.size=o.size;S.box=Object.entries(o.items).flatMap(([pid,n])=>Array(n).fill(pid));S.auto=[];S.mode=o.mode;S.speed=o.speed==="sameday"?"sameday":"scheduled";S.note=o.note||"";S.addons=[...o.addons];S.coupon=o.coupon||"";
  S.day=dayOptions().some(d=>ymd(d)===o.day)?o.day:null;S.time=S.day?o.time:null;S.step=1;fixWhen();
  closeMO();sanitizeCart();renderStoreStatic();renderStore();renderEditBar();saveCart();scrollToEl($("#build"));toast(`Editing ${o.code}`);
}
$("#moBtn").addEventListener("click",()=>openMO(null));
$("#moSheet").addEventListener("click",e=>{
  if(e.target.id==="moSheet"||e.target.closest("[data-moclose]")){closeMO();return}
  const b=e.target.closest("button");if(!b)return;const d=b.dataset;
  if(d.moopen){MO.id=d.moopen;MO.cform=false;MO.rate={};renderMO()}
  else if(d.moback!==undefined){MO.id=null;MO.cform=false;renderMO()}
  else if(d.cpopen!==undefined){MO.cform=true;renderMO();const f=$('#moComplain');f&&f.scrollIntoView({block:'center'})}
  else if(d.cpclose!==undefined){MO.cform=false;renderMO()}
  else if(d.rstar){MO.rate[d.rstar]=+d.n;b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('on',+x.dataset.n<=+d.n))}
  else if(d.rsubmit!==undefined){const o=DB.orders.find(x=>x.id===MO.id);if(!o)return;const picks=Object.entries(MO.rate);
    if(!picks.length){const er=$('#rtErr');er.textContent='Tap the stars to rate at least one flavor.';er.hidden=false;return}
    const rt={};picks.forEach(([pid,n])=>{const c=($('#moCard').querySelector(`[data-rcomment="${pid}"]`)||{}).value||'';rt[pid]={n,comment:c.trim()}});
    rateOrder(o,rt).then(()=>{MO.rate={};toast('Thanks for your rating!');renderMO();renderMenu()}).catch(ex=>{const er=$('#rtErr');er.textContent=ex.message;er.hidden=false})}
  else if(d.moedit)startEdit(d.moedit);
  else if(d.monew!==undefined){closeMO();scrollToEl($("#build"))}
  else if(d.mocancel){armed(b,()=>{const o=DB.orders.find(x=>x.id===d.mocancel);if(!o||o.status!=="awaiting")return;
    if(SBH.on){SBH.cancel(o.id).then(()=>{if(S.editId===o.id){S.editId=null;saveCart();renderEditBar()}toast("Order cancelled");renderBag();renderMO()}).catch(ex=>toast(ex.message));return}
    o.status="cancelled";o.cancelReason="You cancelled this order.";releaseHold(o);saveDB();if(S.editId===o.id){S.editId=null;renderEditBar()}toast("Order cancelled");renderBag();renderMO()})}
});
$("#moSheet").addEventListener("input",e=>{if(e.target.id==="plNote"&&PLE){PLE.note=e.target.value.slice(0,200);window.PLE_DIRTY=true}});
$("#moSheet").addEventListener("change",async e=>{if(e.target.id!=="plPhoto"||!PLE)return;const f=e.target.files[0];e.target.value="";if(!f)return;
  try{PLE.img=await processPlace(f);window.PLE_DIRTY=true;renderMO()}catch(err){toast(err.message)}});
$("#moSheet").addEventListener("click",async e=>{
  if(e.target.closest("[data-plrm]")&&PLE){PLE.img="remove";window.PLE_DIRTY=true;renderMO();return}
  const b=e.target.closest("[data-plsave]");if(!b||!PLE)return;const o=DB.orders.find(x=>x.id===b.dataset.plsave);if(!o)return;
  b.disabled=true;b.textContent="Saving…";const img=PLE.img;
  try{await SBH.placeInfo(o.id,DB.settings.dnoteOn!==false?String(PLE.note||"").trim():"",img||"");
    const n=DB.orders.find(x=>x.id===o.id);if(n&&n.place){if(img&&img!=="remove")n.place.img=img;if(img==="remove")delete n.place.img}
    PLE=null;window.PLE_DIRTY=false;toast("Delivery details saved");renderMO()}
  catch(err){b.disabled=false;b.textContent="Save delivery details";const er=$("#plErr");if(er){er.hidden=false;er.textContent=err.message}}});
$("#moSheet").addEventListener("change",e=>{
  if(e.target.name==="cpScope"){$("#cpItems").hidden=e.target.value!=="items";return}
  if(e.target.id!=="mpFile")return;const f=e.target.files[0],img=$("#mpPrev");
  if(!f){img.hidden=true;return}
  if(proofOk(f)){img.src=URL.createObjectURL(f);img.hidden=false}else img.hidden=true;
});
$("#moSheet").addEventListener("submit",async e=>{
  e.preventDefault();
  if(e.target.id==="moFind"){
    const code=$("#moCode").value.trim().toUpperCase(),num=normPhone($("#moMail").value),err=$("#moErr");
    if(SBH.on){
      if(!code||!num){err.textContent="Enter the order code and the WhatsApp number you used.";err.hidden=false;return}
      try{const id=await SBH.track(code,$("#moMail").value);
        if(!id){err.textContent="We couldn't find that order. Check the code and the WhatsApp number you used.";err.hidden=false;return}
        addMine(id);renderBag();MO.id=id;renderMO()}catch(ex){err.textContent=ex.message;err.hidden=false}
      return}
    const o=num?DB.orders.find(x=>x.code===code&&normPhone(x.customer.phone)===num):null;
    if(!o){err.textContent="We couldn't find that order. Check the code and the WhatsApp number you used.";err.hidden=false;return}
    addMine(o.id);renderBag();MO.id=o.id;renderMO();return}
  if(e.target.id==="moComplain"){
    const o=DB.orders.find(x=>x.id===MO.id),err=$("#cpErr"),bad=m=>{err.textContent=m;err.hidden=false};
    if(!o||!cwinOpen(o)){bad("The complaint window for this order has closed.");return}
    const scope=document.querySelector('input[name="cpScope"]:checked').value,items=[...document.querySelectorAll('input[name="cpItem"]:checked')].map(x=>x.value),text=$("#cpText").value.trim();
    if(scope==="items"&&!items.length){bad("Choose which flavors have the problem, or pick Whole order.");return}
    if(text.length<10){bad("Please describe the problem (at least 10 characters).");$("#cpText").focus();return}
    if(!$("#cpVideo").checked){bad("Please confirm you have your uncut unboxing video.");return}
    const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Sending...";
    try{
      const files=[...$("#cpPhotos").files].slice(0,3),photos=[];for(const f of files)photos.push(await processProof(f));
      if(SBH.on){await SBH.complain(o.id,{reason:$("#cpReason").value,scope,items:scope==="items"?items:[],text,photos});MO.cform=false;toast("Complaint sent. We'll reply here.");renderMO();return}
      o.complaint={at:Date.now(),reason:$("#cpReason").value,scope,items:scope==="items"?items:[],text,photos,status:"open",reply:"",updatedAt:Date.now()};
      if(!saveDB()){delete o.complaint;bad("Not enough storage space for the photos. Try fewer or smaller photos.");btn.disabled=false;btn.textContent="Send complaint";return}
      MO.cform=false;toast("Complaint sent. We'll reply here.");renderMO();
    }catch(ex){bad(ex.message);btn.disabled=false;btn.textContent="Send complaint"}
    return}
  if(e.target.id==="moPay"){
    const o=DB.orders.find(x=>x.id===MO.id),err=$("#mpErr"),name=$("#mpName").value.trim(),f=$("#mpFile").files[0];
    const bad=m=>{err.textContent=m;err.hidden=false};
    if(!o||o.status!=="awaiting"){bad("This order is no longer waiting for payment.");return}
    if(name.length<2){bad("Please enter your full name.");$("#mpName").focus();return}
    if(!f){bad("Please attach your proof of payment.");return}
    const btn=e.target.querySelector("button[type=submit]");btn.disabled=true;btn.textContent="Sending...";
    try{
      const img=await processProof(f),prev={proof:o.proof,status:o.status,rejected:o.rejected};
      if(SBH.on){await SBH.proof(o.id,name,img);renderBag();renderMO();if(!ppShow(o))toast("Proof sent. We'll confirm your payment soon.");return}
      o.proof={name,img,at:Date.now()};o.status="review";delete o.rejected;if(!o.giftsAt){o.gifts=giftDrawLocal(o);o.giftsAt=Date.now()}logMsg(o,chanList(o.notify||"both"),"review",msgText(o,"review"),"system");
      if(!saveDB()){o.proof=prev.proof;o.status=prev.status;if(prev.rejected)o.rejected=prev.rejected;delete o.giftsAt;o.gifts=[];bad("Not enough storage space to save the image. Try a smaller screenshot.");btn.disabled=false;btn.textContent="I've paid, send proof";return}
      renderBag();renderMO();if(!ppShow(o))toast("Proof sent. We'll confirm your payment soon.");
    }catch(ex){bad(ex.message);btn.disabled=false;btn.textContent="I've paid, send proof"}
  }
});
$("#editBar").addEventListener("click",e=>{if(e.target.id==="stopEdit"){S.editId=null;S.box=[];S.auto=[];S.step=1;S.day=null;S.time=null;S.note="";S.addons=[];S.coupon="";S.size=6;sanitizeCart();renderEditBar();renderStoreStatic();renderStore();saveCart();toast("Editing stopped")}});
/* live countdowns + automatic cancellation */
function tickCountdowns(){
  const now=Date.now();
  document.querySelectorAll("[data-exp],[data-cexp]").forEach(el=>{el.textContent=fmtLeft(+(el.dataset.exp||el.dataset.cexp)-now)});
  if(!$("#moSheet").hidden&&!MO.cform&&[...document.querySelectorAll("[data-cexp]")].some(el=>+el.dataset.cexp<=now))renderMO();
  document.querySelectorAll("[data-expbar]").forEach(el=>{const t=Math.max(1,(+el.dataset.expbar)-(+el.dataset.expfrom||0)||DB.settings.payWindowH*3600e3);el.style.width=Math.max(0,Math.min(100,(+el.dataset.expbar-now)/t*100))+"%"});
  renderBell();
}
function sweepOrders(){
  if(!expireOrders())return;
  renderBag();
  if(view==="store"){sanitizeCart();renderStoreStatic();renderStore();renderEditBar();if(!$("#moSheet").hidden)renderMO()}
}
setInterval(()=>{tickCountdowns();if(Math.round(Date.now()/1000)%10===0)sweepOrders()},1000);
function toast(msg){if(typeof toastHook==="function")msg=toastHook(msg);const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,Math.max(1600,msg.length*45))}
function armed(btn,fn){if(btn.dataset.armed){fn();return}btn.dataset.armed="1";const t=btn.textContent;btn.textContent="Tap again to confirm";btn.classList.add("armed");
  setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.textContent=t;btn.classList.remove("armed")}},3000)}
const stLabel=(k,mode)=>k==="refunded"?"Refunded":k==="ready"?(mode==="delivery"?"Out for delivery":"Ready for pickup"):k==="completed"?(mode==="delivery"?"Delivered":"Picked up"):STATUSES.find(x=>x[0]===k)[1];
const NF_TYPES=[["news","📣","News"],["deal","🎁","Deal"],["flash","🔥","Flash sale"],["info","ℹ️","Info"]];
const nfIcon=t=>(NF_TYPES.find(x=>x[0]===t)||NF_TYPES[0])[1],nfName=t=>(NF_TYPES.find(x=>x[0]===t)||NF_TYPES[0])[2];
const bcActive=b=>!b.until||b.until>=ymd(today0());
const activeBroadcasts=()=>(DB.broadcasts||[]).filter(bcActive);
const VIS_KEY="delidome-visits-v1",VID_KEY="delidome-vid-v1",LASTV_KEY="delidome-lastv-v1";
let VIS=[];const loadVis=()=>{try{VIS=JSON.parse(localStorage.getItem(VIS_KEY)||"[]")||[]}catch(e){VIS=[]}};loadVis();
function trackVisit(){
  try{
    if(navigator.webdriver||/bot|crawl|spider|slurp|headless|preview/i.test(navigator.userAgent))return;
    const now=Date.now(),last=+localStorage.getItem(LASTV_KEY)||0;if(now-last<30*60e3)return;
    let vid=localStorage.getItem(VID_KEY);if(!vid){vid=uid()+uid();localStorage.setItem(VID_KEY,vid)}
    localStorage.setItem(LASTV_KEY,String(now));
    if(SBH.on){SBH.visit(vid);return}
    loadVis();VIS=VIS.filter(v=>now-v.t<40*864e5).slice(-4000);VIS.push({t:now,v:vid});localStorage.setItem(VIS_KEY,JSON.stringify(VIS));
  }catch(e){}
}
function msgText(o,st){
  const nm=(o.customer.name.split(" ")[0]||"there"),shop=DB.page.name||"Delidome",when=whenTxt(o);
  const t={
    awaiting:`Hi ${nm}, your ${shop} order ${o.code} (${money(o.total)}) is waiting for payment. Please pay and send your proof in My orders before it is cancelled automatically.`,
    review:`Hi ${nm}, we got your payment proof for order ${o.code} and we're checking it now.`,
    new:`Hi ${nm}, your payment for order ${o.code} is confirmed. Thank you! Your box is set for ${o.mode==="delivery"?"delivery":"pickup"} on ${when}.`,
    baking:`Hi ${nm}, your order ${o.code} is being baked now.`,
    ready:o.mode==="delivery"?`Hi ${nm}, your order ${o.code} is out for delivery.${o.courier||o.awb?` ${o.courier?"Courier: "+o.courier+". ":""}${o.awb?"Airway bill: "+o.awb+".":""}`:""} Please keep your phone close.`:`Hi ${nm}, your order ${o.code} is ready for pickup. Address: ${DB.settings.address}`,
    completed:o.mode==="delivery"?`Hi ${nm}, your order ${o.code} was delivered. Enjoy! Please keep your unboxing video, rate your cookies, and tell us within ${DB.settings.complaintWindowH} hours if anything is wrong.`:`Hi ${nm}, thanks for picking up order ${o.code}. Enjoy! You can rate your cookies in My orders and tell us within ${DB.settings.complaintWindowH} hours if anything is wrong.`,
    refunded:`Hi ${nm}, your order ${o.code} was refunded${o.refund?": "+money(o.refund.amount):""}.${o.refund&&o.refund.note?" "+o.refund.note:""} It can take a few days to show in your account.`,
    cancelled:`Hi ${nm}, your order ${o.code} was cancelled.${o.cancelReason?" "+o.cancelReason:""} Contact us if you have questions.`
  };
  return t[st]||`Hi ${nm}, your order ${o.code} is now: ${stLabel(st,o.mode)}.`;
}
function logMsg(o,channels,st,text,by){o.msgs=o.msgs||[];channels.forEach(ch=>o.msgs.push({at:Date.now(),channel:ch,status:st,text,by}))}
const chanList=v=>v==="both"?["whatsapp","email"]:v==="none"?[]:[v];
const MQ_FONTS={display:["Unbounded","var(--display)"],body:["Instrument Sans","var(--body)"],serif:["Serif",'Georgia,"Times New Roman",serif'],mono:["Monospace",'ui-monospace,Menlo,Consolas,monospace'],hand:["Handwritten",'"Segoe Script","Brush Script MT","Comic Sans MS",cursive'],impact:["Poster",'Impact,"Arial Narrow Bold","Haettenschweiler",sans-serif']};
const MQ_SIZE={S:14,M:18,L:28},MQ_SPEED={slow:40,medium:70,fast:110};
let mqFace=null,mqFaceKey="";
function mqEnsureFont(m){
  if(!m.fontData){if(mqFace){try{document.fonts.delete(mqFace)}catch(e){}mqFace=null;mqFaceKey=""}return}
  const key=m.fontName+m.fontData.length;if(key===mqFaceKey)return;
  try{if(mqFace)document.fonts.delete(mqFace);mqFace=new FontFace("DD Custom",`url(${m.fontData})`);document.fonts.add(mqFace);mqFaceKey=key;mqFace.load().then(()=>mqFit()).catch(()=>{})}catch(e){}
}
function mqFamily(m){return m.font==="custom"&&m.fontData?'"DD Custom",var(--body)':(MQ_FONTS[m.font]||MQ_FONTS.display)[1]}
function mqSeq(m,n){ // n repeats of the sentences, a random photo after each one (never the same twice in a row)
  const out=[];let last=-1;const imgs=m.images||[];
  for(let k=0;k<n;k++)m.texts.forEach(t=>{out.push(`<span class="mt">${esc(t)}</span>`);
    if(imgs.length){let i=Math.floor(Math.random()*imgs.length);if(imgs.length>1&&i===last)i=(i+1+Math.floor(Math.random()*(imgs.length-1)))%imgs.length;last=i;out.push(`<img class="mi" src="${esc(imgOk(imgs[i]))}" alt="" draggable="false">`)}
    else out.push(`<span class="mdot" aria-hidden="true">✦</span>`)});
  return out.join("");
}
function renderMarquee(el,m){
  if(!el)return;m=m||DB.marquee;
  const texts=(m.texts||[]).filter(Boolean);
  el.hidden=!m.on||!texts.length;if(el.hidden)return;
  mqEnsureFont(m);
  el.style.setProperty("--mbg",m.bg);el.style.setProperty("--mfg",m.color);el.style.setProperty("--msz",(MQ_SIZE[m.size]||18)+"px");el.style.setProperty("--mfont",mqFamily(m));
  el.setAttribute("aria-label",texts.join(". "));
  el._m={...m,texts};mqBuild(el);
}
function mqBuild(el){
  const m=el._m;if(!m)return;
  el.classList.toggle("still",RM);
  const draw=n=>{const set=mqSeq(m,n);el.innerHTML=`<div class="track"><div class="set">${set}</div><div class="set" aria-hidden="true">${set}</div></div>`};
  draw(1);
  const cw=el.clientWidth;if(!cw)return; // hidden: re-fit when shown
  const w1=el.querySelector(".set").scrollWidth||1;
  const n=Math.max(1,Math.ceil(cw/w1));
  if(n>1)draw(n);
  const w=el.querySelector(".set").scrollWidth;
  el.style.setProperty("--mdur",Math.max(6,w/(MQ_SPEED[m.speed]||70))+"s");
}
function mqFit(){document.querySelectorAll(".marq").forEach(el=>{if(el._m&&!el.hidden)mqBuild(el);else if(el._ai&&!el.hidden)anMqBuild(el)})}
const LP_DEFAULT_SVG=`<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M3 21a12 12 0 0 1 24 0Z" fill="currentColor"/><circle cx="15" cy="5" r="2.6" fill="currentColor"/><rect x="1" y="20.5" width="28" height="3" rx="1.5" fill="currentColor"/></svg>`;
function defaultPage(){return {name:"delidome",logo:"",brand:"#000096",bg:"#ffffff",ink:"#0B0B45",headFont:"display",bodyFont:"body",fonts:[],
  hero:{eyebrow:"Baked fresh every morning",title:"Warm cookies, boxed your way.",lede:"Pick a box, fill it with the flavors you love, and choose when you want it. Pickup or local delivery.",btn1:"Build a box",btn2:"See the flavors",bg:"",color:"#ffffff",mediaType:"none",src:"",overlay:35,floats:true,cookies:["","","","","",""],media:[],carousel:true,carouselSec:5,shape:"dome"},
  strip:{items:[{t:"Boxes of {sizes}",on:true},{t:"Order by {cutoff} for the next day",on:true},{t:"Closed {closed}",on:true}]},
  build:{title:"Build your box",intro:"Choose a size, fill every spot, then tell us when you want it. Each box is baked the morning it leaves the oven room."},
  blocks:[],
  visit:{title:"Come say hello",text:"Pickup is at the front counter. Give your name and we'll bring your box out.",bg:"",faqTitle:"Good to know"},
  faq:[{q:"When is the order cutoff?",a:"{cutoff} the day before. We bake every box fresh in the morning, so we need the evening to plan the bake."},
       {q:"How long do the cookies stay fresh?",a:"They're best on the day you get them. Keep them in an airtight container for up to three days, and give them 5 minutes in a warm oven to bring them back."},
       {q:"Can I order for an event?",a:"Yes. For more than five boxes, message us at least three days ahead so we can set aside oven time."},
       {q:"What about allergies?",a:"Every cookie contains wheat, dairy and egg, and our kitchen handles nuts. We can't promise any box is allergen free."}],
  footer:{text:"Fresh cookie boxes, baked to order.",bg:"",color:"#ffffff",socials:[{id:"instagram",kind:"instagram",name:"Instagram",url:"",img:""},{id:"threads",kind:"threads",name:"Threads",url:"",img:""},{id:"whatsapp",kind:"whatsapp",name:"WhatsApp",url:"",img:""}]}}}
const SOC_KINDS=[["instagram","Instagram"],["threads","Threads"],["whatsapp","WhatsApp"],["tiktok","TikTok"],["facebook","Facebook"],["youtube","YouTube"],["x","X"],["custom","Other link"]];
const SOC_SVG={
  instagram:'<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>',
  threads:'<path d="M12 3.5c-5 0-8.5 3.4-8.5 8.5s3.5 8.5 8.5 8.5c3.9 0 6.5-1.9 6.5-4.8 0-2.3-1.8-3.7-4.4-3.7-2.1 0-3.3 1-3.3 2.4 0 1.2.9 2 2.2 2 1.9 0 2.8-1.4 2.8-3.7V11c0-3.3-1.9-4.8-4.5-4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  whatsapp:'<path d="M4 20l1.2-4A8.5 8.5 0 1 1 8 18.8L4 20Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2.2-1-.9.9c-1-.4-2-1.4-2.4-2.4l.9-.9-1-2.2L9 8.5Z" fill="currentColor"/>',
  tiktok:'<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.4 2.4 2 4 4.5 4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  facebook:'<path d="M14 20v-7h2.5l.5-3H14V8.5c0-.9.4-1.5 1.6-1.5H17V4.2C16.6 4.1 15.8 4 15 4c-2.3 0-3.7 1.4-3.7 3.8V10H9v3h2.3v7H14Z" fill="currentColor"/>',
  youtube:'<rect x="3" y="6" width="18" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor"/>',
  x:'<path d="M5 5l14 14M19 5L5 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  custom:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'};
const SOC_NAME=Object.fromEntries(SOC_KINDS);
function socialUrl(u,kind){u=String(u||"").trim();if(!u)return "";
  if(/^\+?[\d\s().-]{7,}$/.test(u)){let d=u.replace(/\D/g,"");if(d.startsWith("0"))d=String(DB.settings.waCountry||"62")+d.slice(1);return "https://wa.me/"+d}
  return /^https:\/\/[^\s"'<>\\]+$/i.test(u)?u:""}
function socialsHTML(list){
  return (list||[]).map(x=>({x,u:socialUrl(x.url,x.kind)})).filter(o=>o.u).map(({x,u})=>{
    const nm=String(x.name||"").trim()||SOC_NAME[x.kind]||"Link",img=imgOk(x.img);
    return `<a class="soc" href="${esc(u)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(nm)}"><span class="soc-i${img?" img":""}">${img?`<img class="${imgIsCut(img,x.imgCut)?"":"crop"}" src="${esc(img)}" alt="" draggable="false">`:`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${SOC_SVG[x.kind]||SOC_SVG.custom}</svg>`}</span><span class="soc-n">${esc(nm)}</span></a>`}).join("");
}
function deepFill(d,o){if(o===undefined||o===null)return d;if(Array.isArray(d)||typeof d!=="object")return o;const r={...o};for(const k in d)r[k]=deepFill(d[k],o[k]);return r}
const safeUrl=u=>{u=String(u||"").trim();return /^(https:\/\/|#(build|menu|visit|shop)$)/i.test(u)?u:""};
const safeMedia=u=>{u=String(u||"").trim();return /^(https:\/\/|data:(image|video)\/)/i.test(u)?u:""};
let lpFaces={};
function lpEnsureFonts(pg){
  const ids=new Set((pg.fonts||[]).map(f=>f.id));
  for(const id in lpFaces)if(!ids.has(id)){try{document.fonts.delete(lpFaces[id])}catch(e){}delete lpFaces[id]}
  (pg.fonts||[]).forEach(f=>{if(lpFaces[f.id])return;try{const ff=new FontFace("DD-"+f.id,`url(${f.data})`);document.fonts.add(ff);lpFaces[f.id]=ff;ff.load().then(()=>mqFit()).catch(()=>{})}catch(e){}});
}
const LP_STACK={display:'"Unbounded","Arial Black",system-ui,sans-serif',body:'"Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif'};
function lpFamily(key,pg,role){const fb=LP_STACK[role==="head"?"display":"body"];
  if(String(key).startsWith("f:")){const f=(pg.fonts||[]).find(x=>x.id===key.slice(2));if(f)return `"DD-${f.id}",${fb}`}
  const m=MQ_FONTS[key]||MQ_FONTS.body;return key==="display"?LP_STACK.display:key==="body"?LP_STACK.body:m[1]}
function videoHTML(src,{bg=false}={}){
  src=safeMedia(src);if(!src)return "";
  if(/^data:video\//i.test(src)||/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(src))
    return bg?`<video src="${esc(src)}" ${RM?"":"autoplay"} muted loop playsinline preload="metadata"></video>`:`<video src="${esc(src)}" controls playsinline preload="metadata"></video>`;
  if(bg)return "";
  let m=src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if(m)return `<div class="vf"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" title="Video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  m=src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if(m)return `<div class="vf"><iframe src="https://player.vimeo.com/video/${m[1]}" title="Video" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  return `<p><a href="${esc(src)}" target="_blank" rel="noopener">Watch the video</a></p>`;
}
const HERO_SPOTS=[[3,6],[85,4],[-4,46],[90,40],[2,84],[86,82],[22,2],[68,2],[14,60],[76,62],[40,88],[58,90]];
const HERO_FX=[["bob","Float"],["spin","Spin"],["pulse","Pulse"],["wiggle","Wiggle"],["none","Still"]];
const heroCkN=h=>Math.max(6,Math.min(12,+(h&&h.ckn)||6));
const heroCkShow=(h,k)=>{const v=h&&h[k];return v===undefined||v===""||v===null?(k==="ckPh"?6:12):Math.max(0,Math.min(12,Math.round(+v)||0))};
const heroCkx=(h,i)=>{const x=(h&&h.ckx&&h.ckx[i])||{};return{show:x.show!==false,bg:/^(#[0-9a-f]{6}|transparent)$/i.test(x.bg||"")?x.bg:"",op:Math.max(10,Math.min(100,+x.op||95)),fx:HERO_FX.some(f=>f[0]===x.fx)?x.fx:"bob"}};
function heroFloats(dome,h){
  if(!dome)return;dome.querySelectorAll(".float").forEach(n=>n.remove());
  const prods=DB.products.filter(p=>p.status!=="hidden"&&hasImage(p)).slice(0,6),cs=(h&&h.cookies)||[],ph=heroCkShow(h,"ckPh"),pc=heroCkShow(h,"ckPc");let html="",k=0;
  for(let i=0;i<heroCkN(h);i++){const x=heroCkx(h,i);if(!x.show)continue;const c=safeMedia(cs[i]);let inner="";
    if(c)inner=`<img class="ck ph${/^data:image\/jpeg/i.test(c)?"":" cut"}" src="${esc(c)}" alt="" draggable="false">`;else if(prods[i])inner=plateInner(prods[i]);
    if(!inner)continue;
    html+=`<div class="float fx-${x.fx}${k>=ph?" hid-ph":""}${k>=pc?" hid-pc":""}" aria-hidden="true" style="left:${HERO_SPOTS[k][0]}%;top:${HERO_SPOTS[k][1]}%;opacity:${x.op/100}"><div class="plate" style="background:${x.bg||(i%2?"#2328C8":"#1A1FB0")}">${inner}</div></div>`;k++}
  dome.insertAdjacentHTML("afterbegin",html);
}
function heroFill(dome,h){
  if(!dome)return;const q=x=>dome.querySelector(x),ey=q(".eyebrow"),ti=q("h1"),le=q(".lede"),ab=dome.querySelectorAll(".hero-ctas a");
  ey.textContent=h.eyebrow;ey.hidden=!h.eyebrow;ti.textContent=h.title;le.textContent=h.lede;le.hidden=!h.lede;
  ab[0].textContent=h.btn1;ab[0].hidden=!h.btn1;ab[1].textContent=h.btn2;ab[1].hidden=!h.btn2;
  dome.style.background=h.bg||"";dome.style.color=h.color||"";dome.classList.toggle("nofloat",!h.floats);
  const hm=q(".hm");hm.innerHTML="";hm.style.backgroundImage="";clearInterval(dome._car);
  let list=heroList(h);if(!(h.carousel!==false))list=list.slice(0,1);
  list.forEach((m,i)=>{const src=safeMedia(m.src),sl=document.createElement("div");sl.className="hs"+(i?"":" on");
    if(m.type==="video"){const v=videoHTML(src,{bg:true});if(!v)return;sl.innerHTML=v}
    else sl.style.backgroundImage=`url("${imgOk(src).replace(/["()\\\s]/g,c=>encodeURIComponent(c))}")`;
    hm.appendChild(sl)});
  const sls=hm.querySelectorAll(".hs"),hasM=sls.length>0;
  if(sls.length>1){let k=0;dome._car=setInterval(()=>{if(!dome.isConnected){clearInterval(dome._car);return}sls[k].classList.remove("on");k=(k+1)%sls.length;sls[k].classList.add("on")},Math.max(2,Math.min(30,+h.carouselSec||5))*1000)}
  const shp=heroShapes().some(x=>x[0]===h.shape)?h.shape:"dome";heroShapes().forEach(x=>dome.classList.remove("shape-"+x[0]));dome.classList.add("shape-"+shp);dome.classList.toggle("nomedia",!hasM);
  if(shp==="none"){dome.style.background=hasM?"#000":"transparent";if(!hasM&&/^#fff(fff)?$/i.test(h.color||"#ffffff"))dome.style.color=""}
  q(".ho").style.opacity=hasM?(Math.max(0,Math.min(90,+h.overlay||0))/100):0;
  heroFloats(dome,h);
}
function heroShapes(){return [["dome","Dome (arch top)"],["rounded","Rounded box"],["pill","Pill"],["capsule","Capsule (round top and bottom)"],["oval","Oval"],["leaf","Leaf"],["none","No shape"]]}
function heroList(h){const L=(h.media||[]).filter(m=>m&&safeMedia(m.src));if(L.length)return L;
  return h.mediaType&&h.mediaType!=="none"&&safeMedia(h.src)?[{type:h.mediaType,src:h.src}]:[]}
function heroNorm(h){const c=anClone(h);if(!Array.isArray(c.media))c.media=[];if(!c.media.length&&c.mediaType&&c.mediaType!=="none"&&c.src)c.media=[{type:c.mediaType,src:c.src}];c.mediaType="none";c.src="";return c}
let favKey="";
function lpFavicon(pg){
  let l=document.querySelector('link[rel="icon"]');if(!l){l=document.createElement("link");l.rel="icon";document.head.appendChild(l)}
  const lg=safeMedia(pg.logo),key=lg?"i"+lg.length+lg.slice(-30):"d"+pg.brand;if(key===favKey)return;favKey=key;
  const dflt=()=>{l.type="image/svg+xml";l.href="data:image/svg+xml,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 24"><path d="M3 21a12 12 0 0 1 24 0Z" fill="${pg.brand}"/><circle cx="15" cy="5" r="2.6" fill="${pg.brand}"/><rect x="1" y="20.5" width="28" height="3" rx="1.5" fill="${pg.brand}"/></svg>`)};
  if(!lg){dflt();return}
  const im=new Image();im.onload=()=>{try{const c=document.createElement("canvas");c.width=c.height=64;const x=c.getContext("2d"),k=Math.min(64/im.naturalWidth,64/im.naturalHeight),w=im.naturalWidth*k,h=im.naturalHeight*k;x.drawImage(im,(64-w)/2,(64-h)/2,w,h);l.type="image/png";l.href=c.toDataURL("image/png")}catch(e){dflt()}};im.onerror=dflt;im.src=lg;
}
function renderLanding(){
  const pg=DB.page,sv=$("#storeView");if(!pg||!sv)return;
  lpEnsureFonts(pg);
  sv.style.setProperty("--blue",pg.brand);sv.style.setProperty("--ink",pg.ink);
  sv.style.setProperty("--display",lpFamily(pg.headFont,pg,"head"));sv.style.setProperty("--body",lpFamily(pg.bodyFont,pg,"body"));
  document.documentElement.style.setProperty("--pagebg",pg.bg);
  const nm=pg.name||"delidome";document.title=`${nm} Cookie Boxes`;
  $("#brandTxt").textContent=nm;$("#ftBrand").textContent=nm;$(".top .logo").setAttribute("aria-label",`${nm} home`);
  const lg=safeMedia(pg.logo);const mark=lg?`<img src="${esc(lg)}" alt="">`:LP_DEFAULT_SVG;$("#logoMark").innerHTML=mark;$("#ftMark").innerHTML=mark;
  lpFavicon(pg);
  heroFill($("#dome"),pg.hero);
  // strip
  const set=DB.settings,closed=set.closedWeekdays.slice().sort().map(d=>DOW_LONG[d]),tok={sizes:listJoin(activeSizes().map(x=>x.n)),cutoff:fmtHour(set.cutoffHour),closed:listJoin(closed).replace(" or "," and ")};
  $("#heroStrip").innerHTML=pg.strip.items.filter(it=>it.on&&it.t&&!(/\{closed\}/.test(it.t)&&!closed.length)).map(it=>`<span>${esc(it.t.replace(/\{(sizes|cutoff|closed)\}/g,(m,k)=>tok[k]))}</span>`).join("");
  $("#buildTitle").textContent=pg.build.title;$("#buildIntro").textContent=pg.build.intro;$("#buildIntro").hidden=!pg.build.intro;
  const v=pg.visit,vs=$("#visit");$("#visitTitle").textContent=v.title;$("#visitText").textContent=v.text;$("#visitText").hidden=!v.text;$("#faqTitle").textContent=v.faqTitle;vs.style.background=v.bg||"";
  $("#faqList").innerHTML=pg.faq.filter(f=>f.q).map((f,i)=>`<details ${i===0?"open":""}><summary>${esc(f.q)}</summary><p>${esc(String(f.a||"").replace(/\{cutoff\}/g,fmtHour(DB.settings.cutoffHour)))}</p></details>`).join("");
  $("#faqTitle").hidden=!pg.faq.some(f=>f.q);
  const f=pg.footer,ft=$("#siteFoot");$("#ftText").textContent=f.text;ft.style.background=f.bg||"";ft.style.color=f.color||"";
  ft.querySelectorAll("a,.logo").forEach(a=>a.style.color=f.color||"");
  {const so=$("#ftSocial");if(so){const h=socialsHTML(f.socials);so.innerHTML=h;so.hidden=!h;so.style.color=f.color||""}}
  // custom sections
  const blk=b=>{
    const lay=b.layout||"right",sm=safeMedia(b.src);let media="";
    if(lay!=="text"){if(b.mediaType==="image"&&sm)media=`<div class="lp-media"><img src="${esc(sm)}" alt="${esc(b.heading||"")}" loading="lazy"></div>`;
      else if(b.mediaType==="video"&&sm){const vh=videoHTML(sm);if(vh)media=`<div class="lp-media">${vh}</div>`}}
    const bl=safeUrl(b.btnLink),btn=b.btnLabel&&bl?`<a class="btn btn-blue" href="${esc(bl)}" ${bl[0]==="#"?"":'target="_blank" rel="noopener"'} ${b.color?`style="background:transparent;color:${esc(b.color)}"`:""}>${esc(b.btnLabel)}</a>`:"";
    const text=(b.heading||b.text||btn)?`<div class="lp-text">${b.heading?`<h2>${esc(b.heading)}</h2>`:""}${b.text?`<p>${esc(b.text)}</p>`:""}${btn}</div>`:"";
    const st=`${b.bg?`background:${esc(b.bg)};`:""}${b.color?`color:${esc(b.color)};`:""}`;
    return `<section class="lp l-${esc(lay)}" ${st?`style="${st}"`:""}><div class="wrap lp-in">${lay==="full"?media+text:text+media}</div></section>`;
  };
  $("#lpTop").innerHTML=pg.blocks.filter(b=>b.pos==="top").map(blk).join("");
  $("#lpBottom").innerHTML=pg.blocks.filter(b=>b.pos!=="top").map(blk).join("");
}
const sig = (now=Date.now()) => DB.sales.map(s=>saleStatus(s,now)).join();
let view=null;
function route(){
  if(view===null&&SBH.on&&!SBH.loaded){view="store";SBH.loadShop();return}
  view="store";
  trackVisit();closeReviews();expireOrders();sanitizeCart();renderBag();renderEditBar();renderStoreStatic();renderStore();
  if(location.hash==="#shop")window.scrollTo(0,0);
}
addEventListener("hashchange",route);

// browsers refuse to open data: pictures in a new tab, so open them as a blob instead
document.addEventListener("click",e=>{const a=e.target.closest('a[href^="data:image/"]');if(!a)return;e.preventDefault();
  fetch(a.getAttribute("href")).then(r=>r.blob()).then(b=>window.open(URL.createObjectURL(b),"_blank","noopener")).catch(()=>toast("Couldn't open the picture"))});
addEventListener("storage",e=>{if(SBH.on)return;if(e.key===DB_KEY){loadDB();view=null;route()}});
if(!hadCart&&!SBH.on)S.box=["bb","bb","dc","rv"];
expireOrders();
route();
let lastSig=sig();
setInterval(()=>{const now=Date.now(),s=sig(now);if(s!==lastSig)renderStore();else updateFlash(now);lastSig=s},1000);
