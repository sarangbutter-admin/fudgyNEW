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
const money = v => /^rp/i.test(DB.settings.currency)?DB.settings.currency+Math.ceil(r2(v)).toLocaleString("id-ID"):DB.settings.currency + r2(v).toFixed(2); // rupiah: always rounded up, no decimals, 20.000
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fromYmd = s => {const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const addDays = (d,n) => {const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const today0 = () => {const n=new Date();return new Date(n.getFullYear(),n.getMonth(),n.getDate())};
const LOC = () => window.DDLOC ? window.DDLOC() : "en-US";
const fmtDay = s => fromYmd(s).toLocaleDateString(LOC(),{weekday:"short",month:"short",day:"numeric"});
const fmtHour = h => h===0?"12am":h<12?h+"am":h===12?"12pm":(h-12)+"pm";
const fmtDT = ms => new Date(ms).toLocaleString(LOC(),{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
function fmtDur(ms){ms=Math.max(0,ms);const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60,p=n=>String(n).padStart(2,"0");return (d?d+"d ":"")+`${p(h)}:${p(m)}:${p(x)}`}
function fmtAgo(ms){const m=Math.round((Date.now()-ms)/60000);if(m<1)return "just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" hr ago";return Math.round(h/24)+" d ago"}
const fmtShort = ms => new Date(ms).toLocaleDateString(LOC(),{month:"short",day:"numeric"});
const starStr = n => "★".repeat(n)+"☆".repeat(5-n);
const uid = () => Math.random().toString(36).slice(2,9);
const newCode = () => "DD-"+Math.random().toString(36).slice(2,6).toUpperCase();
function listJoin(a){return a.length<2?a.join(""):a.slice(0,-1).join(", ")+" or "+a[a.length-1]}
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
/* --- seed data --- */
function seedDB(){
  const now=Date.now(), H=3600e3;
  const db={v:1,
    settings:{currency:"$",tz:"Asia/Jakarta",deliveryFee:5,scOn:true,scName:"Store Courier",scMode:"flat",scPerKg:0,scPerPcs:0,scGrams:100,scBoxG:200,scShow:"always",scNote:"Delivered by our own team",schedMsg:"Scheduled delivery: pick a day and time. We deliver within {km} km of the shop. {courier}",deliveryKm:10,samedayOn:false,samedayLeadH:3,samedayCutoff:15,samedayFee:8,samedayPayMin:60,minPayMin:30,rejPayMin:120,payCdColor:"#C8102E",payCdSize:"L",payCdFx:true,pickupOn:true,pickupLeadH:24,schedOn:true,schedLeadH:24,cutoffHour:20,closedWeekdays:[1],lowStockAt:10,customOn:true,customMin:14,customStep:2,customMax:48,customPer:3.25,payWindowH:24,complaintWindowH:24,waCountry:"62",payBank:"Example Bank\nAccount 123 456 7890\nName: Delidome Cookies",
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
function defaultMarquee(){return {on:true,texts:["Baked fresh every morning","Build a box your way","Pickup or local delivery","Order by 8pm for next-day cookies"],images:[],bg:"#000096",color:"#ffffff",font:"display",size:"M",speed:"medium",fontData:null,fontName:"",mode:"both",imgH:0,links:[],rich:true}}
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
  ev:{order:{on:true,snd:"register"},proof:{on:true,snd:"chime"},paid:{on:false,snd:"bell"},complaint:{on:true,snd:"alarm"},courier:{on:true,snd:"alarm"}}}}
function defaultRev(){return {on:false,days:7,minBox:6,mode:"random",daily:20,validDays:7,redeemDays:30,claimMin:6,claimMode:"auto",
  upg:{icon:"🎁",one:"You have 1 reward waiting! Upgrade to a box of {min} or more to claim it.",many:"You have {n} rewards waiting! Upgrade to a box of {min} or more to claim one.",man:"You have {n} reward code(s) saved. Type one in the coupon box to claim it.",chg:"You have {n} rewards. Only one can be used per order.",pickTitle:"Choose the reward for this order",exp:"{n} of your rewards expired and can't be used any more.",useBtn:"Use my reward",changeBtn:"Change",bg:"#FFF4D6",ink:"#0B0B45"},
  rem:{on:true,hot:24,text:"Unclaimed reward: {name}",cd:"Expires in {time}",tip:"Last chance! Your reward {name} expires in {time}"},
  bn:{card:true,star:true,icon:"⭐",starImg:"",starFx:"blink",starSpeed:100,waitIcon:"📦",waitImg:"",waitFx:"shake",waitSpeed:100,title:"How was your order {code}?",sub:"Rate your cookies and open a blind box 🎁",bg:"#FFF4D6",ink:"#0B0B45",line:"#FFD166",fx:"shine",tipOn:true,tip:"Rate your order and open a blind box!",cd:true,cdText:"Review ends in {time}",cdHot:24,cdTip:"Last chance! Review ends in {time}"},
  win:{icon:"🎉",img:"",fx:"confetti",title:"You won a surprise!",text:"{reward}",btn:"Great!",bg:"#FFFFFF",ink:"#0B0B45",acc:"#000096"},
  sad:{icon:"🥺",img:"",fx:"rain",title:"Thank you for rating",text:"We're sorry it wasn't perfect this time. We'd love to make it right, so please order again soon.",btn1:"Buy again",btn2:"Close",bg:"#FFFFFF",ink:"#0B0B45",acc:"#000096"},
  none:{icon:"🎁",img:"",fx:"sparkle",title:"Thanks for rating!",text:"No surprise this time, but we loved hearing from you. See you at your next order!",btn1:"Buy again",btn2:"Close",bg:"#FFFFFF",ink:"#0B0B45",acc:"#000096"},
  choose:{title:"Pick your gift",text:"Choose the surprise you want:"}}}
function defaultLabel(){return {logo:"",qr:"",qrCaption:"",notes:"",warnOn:true,warn1:"UNBOXING WITH UNCUT VIDEO!",warn2:"CONTACT US IF SEAL BROKEN"}}
// time slots can be any range ("13:30 to 15:00"); the label is built from two time pickers
const slotFmt=m=>{const h=Math.floor(m/60),mi=m%60;return String(h).padStart(2,"0")+(mi?":"+String(mi).padStart(2,"0"):"")},slotMk=(a,b)=>slotFmt(a)+" to "+slotFmt(b);
const slotHM=m=>String(Math.floor(m/60)%24).padStart(2,"0")+":"+String(m%60).padStart(2,"0"),hmMin=v=>{const m=/^(\d{2}):(\d{2})$/.exec(v||"");return m?+m[1]*60+ +m[2]:null};
const slotEndMin=t=>{const m=/^\s*(\d{1,2})(?::(\d{2}))?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*$/i.exec(t||"");if(m){const e=+m[3]*60+ +(m[4]||0);return e>=0&&e<=1440?e:null}const a=slotStartMin(t);return a===null?null:Math.min(1440,a+60)};
const slotSort=(a,b)=>(slotStartMin(a.t)??0)-(slotStartMin(b.t)??0);
const slotRowTimes=(x,at,i)=>{const a=slotStartMin(x.t)??600,b=slotEndMin(x.t)??a+60;return `<span class="slottm"><input class="in" type="time" step="300" data-${at}from="${i}" value="${slotHM(a)}" aria-label="Starts"> <b>to</b> <input class="in" type="time" step="300" data-${at}to="${i}" value="${slotHM(Math.min(b,1439))}" aria-label="Ends"></span>`};
function slotNext(list){const last=list.slice().sort(slotSort).pop(),a=last?Math.min(1380,slotEndMin(last.t)??600):600;let st=a,t=slotMk(st,Math.min(st+60,1440));while(list.some(y=>y.t===t)&&st<1380){st+=30;t=slotMk(st,Math.min(st+60,1440))}return list.some(y=>y.t===t)?null:t}
function slotChange(list,i,el){const x=list[i];if(!x)return false;const row=el.closest(".slotrow"),f=hmMin(row.querySelector('[data-slfrom],[data-sdfrom]').value),t=hmMin(row.querySelector('[data-slto],[data-sdto]').value);
  if(f===null||t===null)return false;if(t<=f){toast("The end must be later than the start.");renderAdmin();return false}
  const nl=slotMk(f,t);if(list.some((y,j)=>j!==i&&y.t===nl)){toast("That time slot already exists.");renderAdmin();return false}x.t=nl;return true}
const SLOT_PRESETS=Array.from({length:23},(_,h)=>String(h).padStart(2,"0")+" to "+String(h+1).padStart(2,"0"));
function migrate(db){
  if(db.settings&&!db.settings.turnstile)db.settings.turnstile={on:false,siteKey:"",where:{whatsapp:true,courier:true,doku:true,proof:true,coupon:true,apply:true}};
  if(db.settings&&db.settings.turnstile&&db.settings.turnstile.where&&db.settings.turnstile.where.apply===undefined)db.settings.turnstile.where.apply=true;
  if(db.settings&&!db.settings.doku)db.settings.doku={on:false,methods:[{k:"va",name:"Virtual account (bank)",on:true,payer:"owner",pct:0,fixed:0},{k:"qris",name:"QRIS",on:true,payer:"owner",pct:0,fixed:0},{k:"ewallet",name:"E-wallet (OVO, DANA, ShopeePay)",on:true,payer:"customer",pct:0,fixed:0},{k:"card",name:"Credit card",on:false,payer:"customer",pct:0,fixed:0},{k:"retail",name:"Alfamart / Indomaret",on:false,payer:"customer",pct:0,fixed:0},{k:"paylater",name:"PayLater",on:false,payer:"customer",pct:0,fixed:0}]};
  if(db.settings){const D={samedayOn:false,samedayLeadH:3,samedayCutoff:15,samedayFee:8,samedayPayMin:60,minPayMin:30,rejPayMin:120,payCdColor:"#C8102E",payCdSize:"L",payCdFx:true,pickupOn:true,pickupLeadH:24,schedOn:true,schedLeadH:24,samedayMsg:"Sorry Sameday closed Today.\nyour order will be send tomorrow.",sdSlotOn:false,sdSlots:[{t:"16 to 17",on:true,limit:0},{t:"17 to 18",on:true,limit:0},{t:"18 to 19",on:true,limit:0}],samedayOk:"OK",samedayGo:"Continue with Sameday anyway",schedMaxDays:7,courierNoteOn:true,courierNote:"We need at least 3 hours of lead time. Once we have requested a courier, any delay or failed delivery is beyond our responsibility.",coWarnOn:true,coWarnEmoji:"⚠️",coWarnTitle:"Wait! Check your details",coWarnText:"Please make sure your name, WhatsApp number and address are correct before you place your order. We use them to send you updates and deliver your box.",coWarnOk:"Yes, my details are correct",coWarnBack:"Go back"};for(const k in D)if(db.settings[k]===undefined)db.settings[k]=D[k];
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
  db.prelaunch=preNorm(db.prelaunch);if(!Array.isArray(db.preRegs))db.preRegs=[];
  if(db.page&&db.page.strip&&db.page.strip.mode){const st=db.page.strip,d=defaultPage().strip.items;
    db.page.strip={items:st.mode==="off"?d.map(x=>({...x,on:false})):st.mode==="custom"?String(st.text||"").split("\n").map(x=>x.trim()).filter(Boolean).map(t=>({t,on:true})):d}}
  db.page=deepFill(defaultPage(),db.page);
  if(!db.marquee)db.marquee=defaultMarquee();
  db.marquee=Object.assign({mode:"both",imgH:0,links:[],rich:true},db.marquee);if(!Array.isArray(db.marquee.links))db.marquee.links=[];
  db.announcer=deepFill(defaultAnnouncer(),db.announcer);
  db.revrew=deepFill(defaultRev(),db.revrew);if(!db.revpool||!Array.isArray(db.revpool.items))db.revpool={items:[]};
  if(db.settings.complaintWindowH===undefined)db.settings.complaintWindowH=24;
  {const t=db.settings,d={scOn:true,scName:"Store Courier",scMode:"flat",scPerKg:0,scPerPcs:0,scGrams:100,scBoxG:200,scShow:"always",scNote:"Delivered by our own team",schedMsg:"Scheduled delivery: pick a day and time. We deliver within {km} km of the shop. {courier}"};for(const k in d)if(t[k]===undefined)t[k]=d[k]}
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
const giftCard=(g,extra="")=>{const im=g.img||giftImg(g.id),pt=rvwArt(g);return `<span class="gcard${extra}">${pt||im?pt||`<img src="${esc(imgOk(im))}" alt="" loading="lazy">`:`<i aria-hidden="true">${esc(String(g.icon||"🎁").slice(0,4))}</i>`}<b>${esc(g.name)}${giftQty(g)>1?` ×${giftQty(g)}`:""}</b><em>FREE</em></span>`};
const giftSurprise=n=>n>1?n+" × "+bbName():"1 "+bbName();
const giftLines=n=>giftPlan(n).flatMap(x=>x.mode==="random"?[`🎲 ${giftSurprise(x.limit)}`]:x.gifts.map(g=>`🎁 ${g.name}`));
const GIFT_NOTE="Gifts are subject to availability. Alternative gifts or a delayed shipment may happen.";
const giftsHTML=(o,cust)=>preGiftHTML(o,cust)+(o.gifts&&o.gifts.length?`<div class="dsec"><h4>🎁 ${cust?"Your gifts":"Free gifts to pack"}</h4>${cust&&o.gifts.some(g=>g.random)&&!bbOpened(o.id+"|g")?bbCardHTML(o.id+"|g"):""}<div class="gl">${o.gifts.filter(g=>!(cust&&g.random&&!bbOpened(o.id+"|g"))).map(g=>giftChip(g,g.random?" rnd":"")).join("")}</div>${["new","baking","ready","completed"].includes(o.status)?"":`<p class="note" style="margin:8px 0 0">${cust?"Confirmed once we verify your payment.":"Pack it once the payment is confirmed."}</p>`}</div>`:cust&&o.status==="awaiting"&&giftPlan(o.size).length?`<div class="dsec"><h4>🎁 Your free gift</h4><p class="hint" style="margin:0">It's revealed as soon as you send your payment proof.</p></div>`:"");
/* --- optional courier prices from Biteship (does nothing unless the owner switches it on in Shop settings) --- */
const bsOn=(db=DB)=>!!(SBH.on&&db.settings&&db.settings.biteship&&db.settings.biteship.on);
const bsFallback=(db=DB)=>scOn(db)&&!(db.settings&&db.settings.biteship&&db.settings.biteship.fallback===false);
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
// the Store Courier price: flat, per started kg (cookies x grams + box grams) or per cookie. Mirrors store_fee() in the database.
function storeFee(n,db=DB){const t=db.settings,m=t.scMode||"flat";
  if(m==="pcs")return r2(n*(+t.scPerPcs||0));
  if(m==="kg"){const g=n*(+(t.scGrams??100))+(+(t.scBoxG??200));return r2(Math.ceil(g/1000)*(+t.scPerKg||0))}
  return +t.deliveryFee||0}
// the customer-facing line under "Scheduled delivery": {km} = delivery radius, {fee} = Store Courier price for this box, {courier} = who delivers
function schedText(c,db=DB){const t=db.settings,fee=storeFee(c.size,db),by=bsOn(db)?"The delivery price depends on the courier you choose.":(scOn(db)?`Delivered by ${scName(db)}: ${freeDelSale(c.size)?"free":money(fee)}.`:"");
  return String(t.schedMsg||"Scheduled delivery: pick a day and time. We deliver within {km} km of the shop. {courier}").replace(/\{km\}/g,t.deliveryKm).replace(/\{fee\}/g,money(fee)).replace(/\{courier\}/g,by).replace(/\s+/g," ").trim()}
const scName=(db=DB)=>String((db.settings&&db.settings.scName)||"").trim()||"Store Courier";
const scOn=(db=DB)=>!(db.settings&&db.settings.scOn===false);
// a free-delivery promo covers every box, one box size (old promos), or a list of sizes plus (optionally) custom boxes
const fdApplies=(s,n,db=DB)=>s.appliesTo==="all"||(s.appliesTo==="list"?((s.sizes||[]).some(x=>+x===n)||(!!s.custom&&!db.sizes.some(z=>z.n===n))):+s.appliesTo===n);
const freeDelSale=(n,at=Date.now(),db=DB)=>db.sales.find(s=>isFD(s)&&saleStatus(s,at)==="live"&&fdApplies(s,n,db))||null;
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
  const shipQ=withDelivery?bsShip(c,at||Date.now(),db):null,cpFree=!!(cp&&cp.ok&&cp.freeDel);
  const noFee=cpFree||!!(fdSale&&fdSale.kind!=="amount"&&fdSale.scope!=="store");   // a free promo for every courier: no need to pick a courier to know the price
  const feePending=withDelivery&&c.mode==="delivery"&&!noFee&&!shipQ&&bsPending(c,db);
  const feeRaw=withDelivery&&c.mode==="delivery"?(shipQ?+shipQ.price:feePending?0:(c.speed==="sameday"?(db.settings.samedayFee??db.settings.deliveryFee):storeFee(c.size,db))):0;
  const fee=cpFree||feePending?(cpFree?0:feeRaw):fdApply(fdSale,feeRaw,shipQ?"bite":"store"),feeWas=fee<feeRaw?feeRaw:0;
  return {ship:shipQ,feePending,feeWas,base,sale,fdSale,discount,surcharge,addons,fee,coupon:cp&&cp.ok?cp.coupon:null,couponDisc,couponErr:cp&&!cp.ok?cp.err:"",total:r2(base-discount-couponDisc+surcharge+addons+fee)};
}
const saleOffText = s => isFD(s)?(s.kind==="amount"?`${money(s.amount)} off delivery`:"Free delivery")+(s.scope==="store"?` (${scName()})`:""):isGift(s)?"Free gifts":s.type==="percent"?`${s.value}% off`:`${money(s.value)} off`;
function giftAppliesText(s){const ps=[...new Set(s.rules.map(r=>+r.from===+r.to&&DB.sizes.some(z=>z.n===+r.from)?`box of ${r.from}`:`custom boxes of ${r.from} to ${r.to}`))];
  return ps.length>1?ps.slice(0,-1).join(", ")+" and "+ps[ps.length-1]:ps[0]}
const fdx=D=>({scope:D.dscope==="store"?"store":"all",kind:D.dkind==="amount"?"amount":"free",amount:D.dkind==="amount"?Math.max(0,Math.round(+D.damount||0)):0});
/* a delivery promo takes the delivery price down: free or an amount off. src "bite" = a Biteship courier, "store" = the Store Courier / sameday. A "store only" promo leaves Biteship prices alone. */
const fdApply=(s,fee,src)=>!s||(s.scope==="store"&&src==="bite")?fee:s.kind==="amount"?Math.max(0,r2(fee-(+s.amount||0))):0;
const fdPriceHTML=(s,fee,src)=>{const n=fdApply(s,fee,src);return n<fee?`<s class="fdwas">${money(fee)}</s> <b class="fdnow">${n>0?money(n):"FREE"}</b>`:money(fee)};
function fdListText(s){const a=(s.sizes||[]).slice().sort((x,y)=>x-y).map(n=>`box of ${n}`);if(s.custom)a.push("custom boxes");return a.length>1?a.slice(0,-1).join(", ")+" and "+a[a.length-1]:(a[0]||"no box")}
const saleAppliesText = s => isGift(s)&&giftHasRules(s)?giftAppliesText(s):s.appliesTo==="all"?"every box":s.appliesTo==="list"?fdListText(s):`the box of ${s.appliesTo}`;
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
const fresh = () => ({size:6, box:[], auto:[], step:1, mode:"pickup", speed:"scheduled", day:null, time:null, note:"", addons:[], extrasDone:false, extraTip:false, courierTip:false, coupon:"", ship:null, bsSkip:false, dnote:"", dphoto:""});
let S = fresh(), hadCart=false;
try{const s=JSON.parse(localStorage.getItem(CART_KEY)||"null");if(s&&Array.isArray(s.box)){S={...S,...s,step:s.step===2?2:1};hadCart=true;
  }}catch(e){}
const saveCart = () => {try{localStorage.setItem(CART_KEY,JSON.stringify({size:S.size,box:S.box,auto:S.auto,mode:S.mode,speed:S.speed,note:S.note,addons:S.addons,editId:S.editId||null,day:S.day,time:S.time,step:S.step,coupon:S.coupon||"",closed:!!S.closed}))}catch(e){}};
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
  if(!full())S.closed=false;else if(S.step===2)S.closed=true;
  if(!full()||!S.closed)S.step=1;
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
// sameday time slots: the customer picks a one-hour box for today, only while sameday is still open
const sdSlotList=()=>(DB.settings.sdSlots||[]).filter(x=>x&&x.on!==false&&String(x.t||"").trim());
const sdSlotsOn=()=>!!DB.settings.sdSlotOn&&sdSlotList().length>0&&samedayOpen();
const sdTooSoon=t=>{const m=slotStartMin(t);return m!==null&&slotWall(ymd(shopNow().d),m)<shopNowT()+Math.max(0,+DB.settings.samedayLeadH||0)*3600e3};
const sdFull=t=>{const c=(DB.settings.sdSlots||[]).find(x=>x.t===t),l=c&&+c.limit||0;return l>0&&slotUsed(ymd(shopNow().d),t)>=l};
// the order-by hour passed while sameday was picked: tell the customer (pop-up) instead of quietly moving them to another option
function sdWatch(){const m=$("#sdSheet");if(m&&m.hidden&&S.mode!=="pickup"&&S.speed==="sameday"&&!S.sdLate&&!samedayOpen()&&samedayLate())openSdPop()}
function fixWhen(){sdWatch();
  if(!optAvail(optOf(S))){const k=["pickup","scheduled","sameday"].find(optAvail);if(k){S.mode=k==="pickup"?"pickup":"delivery";S.speed=k==="sameday"?"sameday":"scheduled"}}
  if(optOf(S)==="sameday"){S.day=ymd(shopNow().d);if(sdSlotsOn()){if(!(sdSlotList().some(x=>x.t===S.time)&&!sdTooSoon(S.time)&&!sdFull(S.time)))S.time=null}else S.time="Same day";return}
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
// flavor filter beside "Fill it up": all / premium (extra price) / no extra cost. Also limits Fill the rest and Shuffle.
let shopTier="all";const TIER_SEEN=new Set();
const tierOk=p=>shopTier==="all"||(shopTier==="prem"?p.surcharge>0:!(p.surcharge>0));
const TIER_NAME={prem:"premium",reg:"no-extra-cost"};
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
function menuOrder(list){const by=DB.settings.menuSort||"popular",sold=soldMap(),pos=new Map(DB.products.map((p,i)=>[p.id,i])),best=bestIds(),bd=p=>badgesOf(p,best).length?1:0;
  return list.slice().sort((a,b)=>(isOut(a)-isOut(b))||(bd(b)-bd(a))||(by==="popular"?(sold[b.id]||0)-(sold[a.id]||0):0)||(pos.get(a.id)-pos.get(b.id)))}
function renderMenu(){
  const vis=DB.products.filter(p=>p.status!=="hidden");
  const groups=DB.categories.map(c=>({id:c.id,name:c.name,n:vis.filter(p=>p.cat===c.id).length})).filter(g=>g.n);
  const other=vis.filter(p=>!catName(p.cat)).length;
  if(other&&groups.length)groups.push({id:"none",name:"Other",n:other});
  if(shopCat!=="all"&&!groups.some(g=>g.id===shopCat))shopCat="all";
  $("#catBar").hidden=groups.length<2;
  $("#catBar").innerHTML=`<button class="fchip" type="button" data-scat="all" aria-pressed="${shopCat==="all"}">All</button>`+groups.map(g=>`<button class="fchip" type="button" data-scat="${g.id}" aria-pressed="${shopCat===g.id}">${esc(g.name)}</button>`).join("");
  const mixed=vis.some(p=>p.surcharge>0)&&vis.some(p=>!(p.surcharge>0));if(!mixed)shopTier="all";
  const ts=$("#tierSeg");if(ts){ts.hidden=!mixed;ts.querySelectorAll("[data-tier]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.tier===shopTier)))}
  const prods=menuOrder((shopCat==="all"||groups.length<2?vis:vis.filter(p=>shopCat==="none"?!catName(p.cat):p.cat===shopCat)).filter(tierOk)),best=bestIds();
  $("#menuGrid").innerHTML = prods.map((p,i)=>{const bd=badgesOf(p,best).slice(0,2);
    const out=isOut(p),img=true,badge=p.surcharge>0?`<span class="xtra">+${money(p.surcharge)}</span>`:"",
      low=!out&&p.track&&p.stock<=DB.settings.lowStockAt?`<span class="stk">Only ${p.stock} left</span>`:"";
    return `<div class="card${out?" out":""}${img?"":" noimg"}" data-id="${p.id}" style="--i:${i}">
      ${img?`<div class="pwrap">${plateHTML(p)}${badge}${low}${bd.length?`<div class="bdgs">${bd.map(badgeHTML).join("")}</div>`:""}</div>`:""}
      <h4>${esc(p.name)}${img?"":badge}</h4>${rvFree(p)}${(()=>{const r=ratingOf(p);return `<button class="rate${r.n?"":" none"}" type="button" data-reviews="${p.id}" aria-label="${r.n?`${r.avg.toFixed(1)} out of 5 stars, ${r.n} reviews. Read or write a review for ${esc(p.name)}`:`No reviews yet for ${esc(p.name)}`}">${r.n?`<span class="stars">★</span> ${r.avg.toFixed(1)} <span class="cnt">(${r.n})</span>`:"No reviews yet"}</button>`})()}<p>${esc(p.desc)}</p>
      ${out?`<span class="sold">${p.status==="soldout"?"Sold out today":"Out of stock"}</span>`:`<div class="stepper"><button type="button" data-act="dec" aria-label="Remove one ${esc(p.name)}">−</button><output aria-live="polite">0</output><button type="button" data-act="inc" aria-label="Add one ${esc(p.name)}">+</button></div>`}
    </div>`}).join("");
  if(!prods.length)$("#menuGrid").innerHTML=`<p class="tierempty">No ${shopTier==="prem"?"premium":"no-extra-cost"} flavors here. <button class="linkbtn" type="button" data-tierall>Show all flavors</button></p>`;
  $("#xtraHint").hidden=!prods.some(p=>p.surcharge>0&&!isOut(p))||((DB.page&&DB.page.xtra)||{}).on===false;
}
function renderOpts(){
  const set=DB.settings;fixWhen();
  $("#modes").innerHTML=["sameday","pickup","scheduled"].filter(optOn).map(k=>{const late=k==="sameday"&&!samedayOpen()&&samedayLate(),ok=optAvail(k)||late;return `<button class="chip" type="button" data-opt="${k}" ${late?"data-late=\"1\"":""} ${ok?"":"disabled"}>${OPT_NAME[k]}${ok?"":" (closed today)"}</button>`}).join("");
  const sd=optOf(S)==="sameday";$("#dayBlock").hidden=sd;$("#timeBlock").hidden=sd&&!sdSlotsOn();
  {const k=optOf(S),t=String(set.courierNote||"").trim(),on=set.courierNoteOn!==false&&!!t;$("#cnoteSd").hidden=!(on&&k==="sameday");$("#cnoteSch").hidden=!(on&&k==="scheduled");$("#cnoteSd").textContent=$("#cnoteSch").textContent=t}
  $("#days").innerHTML = dayOptions().map(d=>{const closed=set.closedWeekdays.includes(d.getDay());
    return `<button class="day" type="button" data-day="${ymd(d)}" ${closed?`disabled aria-label="${fmtDay(ymd(d))}, closed"`:""}><small>${DOW[d.getDay()]}</small><strong>${d.getDate()}</strong></button>`}).join("");
  const closedTxt=set.closedWeekdays.length?`We're closed ${listJoin(set.closedWeekdays.slice().sort().map(d=>DOW_LONG[d])).replace(" or "," and ")}. `:"";
  $("#daysHint").textContent=`${closedTxt}Order at least ${fmtLead(optLead(optOf(S)))} ahead. Orders after ${fmtHour(set.cutoffHour)} count from the next day. Time slots that are too soon are greyed out.`;
  renderTimes();
}
function renderTimes(){
  const k=optOf(S);if(k==="sameday"&&sdSlotsOn()){$("#times").innerHTML=sdSlotList().map(x=>{const t=x.t,full=sdFull(t),off=sdTooSoon(t);return `<button class="chip" type="button" data-time="${esc(t)}" ${full?`disabled aria-label="${esc(t)}, full"`:off?`disabled aria-label="${esc(t)}, too soon"`:""}>${esc(t)}${full?" · Full":""}</button>`}).join("");
    document.querySelectorAll("[data-time]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.time===S.time));return}
  $("#times").innerHTML=DB.settings.times.map(t=>{const full=slotFull(S.day,t),off=!!S.day&&k!=="sameday"&&slotTooSoon(S.day,t,k);return `<button class="chip" type="button" data-time="${esc(t)}" ${full?`disabled aria-label="${esc(t)}, full"`:off?`disabled aria-label="${esc(t)}, too soon"`:""}>${esc(t)}${full?" · Full":""}</button>`}).join("");
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
  $("#extras").innerHTML=act.map(a=>`<button class="extra" type="button" data-addon="${a.id}" aria-pressed="false"><span class="tick">✓</span>${lvAddon(a,46)}<span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span><span class="pr">${addonPr(a)}</span></button>`).join("")+(act.length?`<button class="extra noextra" type="button" data-noextra aria-pressed="${!!S.extrasDone&&!S.addons.length}"><span class="tick">✓</span><span><b>No extras, thanks</b><small>I do not want any extra</small></span><span class="pr"></span></button>`:"");
  heroFloats($("#dome"),DB.page.hero);
}
function ctaState(){
  const left=S.size-boxN();
  if(S.step===1) return left>0?{label:`Pick ${left} more`,dis:false,go:"pick"}:!S.closed?{label:"🔒 Close the box",dis:false,go:"close"}:{label:"Choose a day",dis:false,go:"step2"};
  if(!S.day||!S.time) return {label:optOf(S)==="sameday"?"Pick a time for today":"Pick a day and time",dis:false,go:"when"};
  if(bsPending(S))return {label:`Checkout (${money(total())})`,dis:false,go:"needcourier"};
  return {label:`Checkout (${money(total())})`,dis:false,go:"checkout"};
}
/* guide: after the time is chosen, scroll to the extras and blink an arm tip until they choose an extra or "No extras"; then guide them to the courier */
function guideExtras(){const blk=$("#extrasBlock");if(!blk||blk.hidden||S.extrasDone||!(S.day&&S.time))return;S.extraTip=true;renderStore();setTimeout(()=>scrollToEl(blk),80)}
function guideCourier(){S.extraTip=false;if(S.mode!=="delivery"){renderStore();return}S.courierTip=!!(bsOn()&&bsPending(S));renderStore();
  setTimeout(()=>{const t=$("#csTip")||$("#bsRow");if(t)scrollToEl(t)},150)}
/* extras that need a gift note: Gift wrap and Greeting card (the owner sets the type of each extra). Other extras do not show the note box. */
const addonKind=a=>a.kind||(/wrap/i.test(a.name||"")?"giftwrap":/card|greeting/i.test(a.name||"")?"greeting":"other");
const noteNeeded=()=>S.addons.some(id=>{const a=DB.addons.find(x=>x.id===id);return a&&addonKind(a)!=="other"});
// the gift note box, its arm tip and the "Done, continue" button follow what the customer chose
function extraGuideUI(){const gn=$("#giftNote");if(!gn)return;const blk=gn.closest(".block"),need=noteNeeded(),filled=!!S.note.trim();
  blk.hidden=!need&&!(S.editId&&S.note);if(!need&&!S.editId&&S.note){S.note="";gn.value=""}
  let nt=$("#gnTip");if(!nt){nt=document.createElement("div");nt.id="gnTip";nt.className="armtip";nt.hidden=true;const lb=document.querySelector('label[for="giftNote"]');lb.parentNode.insertBefore(nt,lb)}
  nt.hidden=!(need&&!filled);if(!nt.hidden)nt.innerHTML=`<span aria-hidden="true">✍️</span><span>Write your <b>gift note</b> here. It goes with your gift wrap or greeting card.</span>`;
  let dn=$("#extraDone");const show=S.addons.length>0&&(!need||filled);
  if(show){if(!dn){dn=document.createElement("button");dn.id="extraDone";dn.type="button";dn.className="btn btn-blue btn-sm";dn.dataset.extradone="1";dn.textContent="Done, continue →";dn.style.cssText="margin-top:10px"}
    const host=need?blk:$("#extras");if(dn.parentNode!==host)host.appendChild(dn)}
  else if(dn)dn.remove()}
function renderStore(){
  if(preGate())return;
  pgInit();
  let q=Q();
  if(S.coupon&&q.couponErr){cpMsg(`Coupon ${S.coupon}: ${q.couponErr}`,false);S.coupon="";q=Q()}
  // custom box
  {const t=DB.settings,cb=$("#customBox");cb.hidden=!t.customOn;
   if(t.customOn){const on=validCustom(S.size),n=on?S.size:snapCustom(S.cv||t.customMin);S.cv=n;
    const base=basePrice(n),sale=bestSale(n),now=sale?r2(base-saleDiscount(sale,base)):base;
    cb.dataset.on=on;
    cb.innerHTML=`<h4>Need a bigger box?</h4><p>Build your own from ${t.customMin} cookies, in steps of ${t.customStep}. ${money(t.customPer)} per cookie.</p>${freeDelSale(n)?`<span class="fdnote">🚚 Free delivery on this box</span>`:""}
    <div class="crow"><div class="stepper" role="group" aria-label="Custom box size"><button type="button" data-cstep="-1" aria-label="Fewer cookies" ${n<=t.customMin?"disabled":""}>−</button><input id="cvIn" type="number" inputmode="numeric" min="${t.customMin}" max="${t.customMax}" step="${t.customStep}" value="${n}" aria-label="Number of cookies"><button type="button" data-cstep="1" aria-label="More cookies" ${n+t.customStep>t.customMax?"disabled":""}>+</button></div>
    <span class="cprice num">${sale?`<s style="opacity:.6;font-weight:400">${money(base)}</s> `:""}${money(now)}</span>
    <button class="btn btn-blue btn-sm cuse" type="button" data-cuse ${on?"disabled":""}>${on?"Selected":`Use box of ${n}`}</button></div>${giftPlan(n).length?`<div class="gifthint inl"><span class="ic" aria-hidden="true">🎁</span><span class="t">Free gift with ${n} cookies!</span><button class="gifthint-b" type="button" data-giftsee="${n}">See gifts ›</button></div>`:""}`}}
  // sizes (with live sale prices)
  const fdOn=activeSizes().some(z=>freeDelSale(z.n));$("#sizes").classList.toggle("fdon",fdOn);
  {const h=$("#fdHint");if(h){const live=DB.sales.filter(x=>isFD(x)&&saleStatus(x,Date.now())==="live");h.hidden=!live.length;h.innerHTML=live.map(x=>`<span>🚚 <b>${esc(x.name)}</b>: free delivery on ${esc(saleAppliesText(x))}</span>`).join("")}}
  $("#sizes").innerHTML = activeSizes().map(s=>{const sale=bestSale(s.n),now=sale?r2(s.price-saleDiscount(sale,s.price)):s.price,fd=freeDelSale(s.n);
    return `<button class="size" type="button" data-size="${s.n}" aria-pressed="${s.n===S.size}">${fd?`<span class="fdtag">🚚 <b>Free delivery</b></span>`:""}${sale?`<span class="saletag">${sale.type==="percent"?"−"+sale.value+"%":"Sale"}</span>`:""}${giftPlan(s.n).length?`<span class="saletag gifttag${sale?" l":""}">🎁<b class="gt"> Gift</b></span>`:""}<strong>${s.n}</strong><small>COOKIES</small><span class="num">${sale?`<s>${money(s.price)}</s>`:""}${money(now)}</span></button>`}).join("");
  renderGiftHint();renderBarExtras();renderFab();
  document.querySelectorAll(".card").forEach(c=>{const st=c.querySelector(".stepper");if(!st)return;const n=countOf(c.dataset.id);st.querySelector("output").textContent=n;c.classList.toggle("has",n>0);
    st.querySelector('[data-act="dec"]').disabled=n===0;const inc=st.querySelector('[data-act="inc"]'),lim=n>=stockLeft(prod(c.dataset.id));inc.disabled=lim;inc.classList.toggle("off",!lim&&full());inc.setAttribute("aria-disabled",String(lim||full()))});
  $("#fillRest").disabled=full();
  $("#step1").hidden=S.step!==1; $("#step2").hidden=S.step!==2;
  $("#tab1").setAttribute("aria-current",S.step===1?"step":"false");
  $("#tab2").setAttribute("aria-current",S.step===2?"step":"false");
  $("#tab1").classList.toggle("done",S.step===2&&full());
  $("#tab2").disabled=!(full()&&S.closed);
  renderLid();
  document.querySelectorAll("[data-opt]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.opt===optOf(S)));
  {const k=optOf(S),st=DB.settings;const fdp=k!=="pickup"?freeDelSale(S.size):null;$("#modeHint").textContent=(fdp?`🚚 ${fdp.name}: ${saleOffText(fdp)}. `:"")+(k==="sameday"?`Sameday shipment adds ${money(st.samedayFee??st.deliveryFee)}. Order before ${fmtHour(st.samedayCutoff)} and we ship about ${fmtLead(optLead("sameday"))} after your payment is confirmed. We deliver within ${st.deliveryKm} km of the shop.`:k==="scheduled"?schedText(S):"Free pickup at the front counter. Pick a day and time.");}
  document.querySelectorAll(".day").forEach(b=>b.setAttribute("aria-pressed",b.dataset.day===S.day));
  document.querySelectorAll("[data-time]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.time===S.time));
  document.querySelectorAll("[data-addon]").forEach(b=>b.setAttribute("aria-pressed",S.addons.includes(b.dataset.addon)));
  {const t=document.querySelector("[data-noextra]");if(t)t.setAttribute("aria-pressed",String(!!S.extrasDone&&!S.addons.length));
   let tip=$("#exTip");if(!tip){tip=document.createElement("div");tip.id="exTip";tip.className="armtip";tip.hidden=true;$("#extras").parentNode.insertBefore(tip,$("#extras"))}
   const on=!!S.extraTip&&!S.extrasDone&&!$("#extrasBlock").hidden;tip.hidden=!on;if(on)tip.innerHTML=`<span aria-hidden="true">👇</span><span>Add something extra, or tap <b>No extras, thanks</b> to continue.</span>`;
   extraGuideUI()}
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
    L+=`<div><dt>${OPT_NAME[optOf(S)]}</dt><dd>${q.feePending?"Choose a courier":q.feeWas?`<s class="fdwas">${money(q.feeWas)}</s> ${q.fee?`<b class="fdnow">${money(q.fee)}</b>`:fbHTML("Del")}`:q.fee?money(q.fee):fbHTML("Del")}</dd></div>`;
    if(S.day)L+=`<div><dt>When</dt><dd>${S.mode!=="pickup"&&S.speed==="sameday"?(samedayOpen()?"Today (sameday)"+(S.time&&S.time!=="Same day"?", "+esc(S.time):""):"Sameday (after the cut-off)"):fmtDay(S.day)+(S.time?", "+esc(S.time):"")}</dd></div>`;
    if(bsOn()&&S.mode==="delivery"){const sh=bsShip(S);
      L+=`<div class="bscour${q.feePending?" need":""}${S.courierTip&&q.feePending&&!BSD.busy?" tipped":""}" id="bsRow"><dt>Courier</dt><dd>${S.courierTip&&q.feePending&&!BSD.busy?`<span class="armtip" id="csTip"><span aria-hidden="true">👇</span><span>Tap <b>Choose courier</b> to see the prices.</span></span>`:""}<button type="button" class="bscbtn" data-bscourier>${sh?`${esc((sh.courierName||sh.courier)+" "+(sh.serviceName||sh.service))} · Change`:S.bsSkip?esc(scName())+" · Change":"🛵 Choose courier"}</button></dd></div>`}
  }
  $("#lines").innerHTML=L;
  renderCoupon(q);renderGiftBox();
  $("#total").textContent=money(total());
  const c=ctaState();
  for(const b of [$("#panelCta"),$("#barCta")]){b.textContent=c.label;b.disabled=c.dis;b.dataset.go=c.go||"";b.classList.toggle("ready",!c.dis&&c.go!=="when"&&c.go!=="needcourier");b.classList.toggle("pickmore",c.go==="pick");b.classList.toggle("closecta",c.go==="close")}
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
function setSize(n){if(S.closed&&n!==S.size){S.closed=false;toast("Box opened so you can change the size")}S.size=n;if(S.box.slice(0,n).filter(Boolean).length<boxN()||S.box.length>n){const keep=S.box.map((id,i)=>[id,!!(S.auto&&S.auto[i])]).filter(x=>x[0]).slice(0,n);S.box=keep.map(x=>x[0]);S.auto=keep.map(x=>x[1])}if(!full())S.step=1;renderStore()}
function cpMsg(t,ok){const m=$("#cpnMsg");if(!m)return;m.textContent=t||"";m.hidden=!t;m.classList.toggle("ok",!!ok);clearTimeout(cpMsg.t);if(t)cpMsg.t=setTimeout(()=>{m.hidden=true},6000)}
function renderGiftHint(){
  const el=$("#giftHint");if(!el)return;const pl=giftPlan(S.size);
  if(!pl.length){el.hidden=true;el.innerHTML="";return}
  const rnd=pl.some(x=>x.mode==="random"),one=pl.length===1&&pl[0].mode==="specific"&&pl[0].gifts.length===1;
  el.hidden=false;
  el.innerHTML=`<span class="ic" aria-hidden="true">🎁</span><span class="t">${one?`Free gift with this box: ${esc(pl[0].gifts[0].name)}`:rnd?"Free "+bbName()+" with this box!":"Free gifts with this box!"}</span><button class="gifthint-b" type="button" data-giftsee="${S.size}">See ${one?"gift":"gifts"} ›</button>`;
}
// how the gifts show in the box: a short teaser (default), every gift, or only the "See what you may get" button
const GV_OPTS=[["teaser","Teaser only","A few small pictures and \"+more\". Customers tap the button to see all gifts."],["full","Full list","Every gift's name and picture."],["hidden","Hidden","Only the \"See what you may get\" button."]],GV_KEYS=GV_OPTS.map(x=>x[0]);
function giftTeaser(gs,kind){const n=gs.length,sh=gs.slice(0,3),more=n-sh.length;
  return `<div class="gteaser"><span class="gtst" aria-hidden="true">${sh.map(g=>{const im=g.img||giftImg(g.id);return im?`<img src="${esc(imgOk(im))}" alt="" loading="lazy">`:`<i>🎁</i>`}).join("")}${more>0?`<i class="more">+${more}</i>`:""}</span><span>${n} ${kind==="possible"?(n===1?"possible gift":"possible gifts"):(n===1?"free gift included":"free gifts included")}</span></div>`}
function renderGiftBox(){
  const el=$("#giftBox");if(!el)return;const pl=giftPlan(S.size);rvwSync();const nt=rvwNoticeHTML();
  if(!pl.length&&!PG.info&&!nt){el.hidden=true;el.innerHTML="";return}
  const cl=(v,d)=>/^(#[0-9a-f]{6}|transparent)$/i.test(v||"")?v:d;
  el.hidden=false;
  el.innerHTML=nt+pgPanelHTML()+pl.map(x=>{const t=x.sale,rnd=x.mode==="random",gv=GV_KEYS.includes(t.view)?t.view:"teaser";
    return `<div class="gb fx-${["shine","pulse","none"].includes(t.fx)?t.fx:"shine"}" style="--gb:${cl(t.bg,"#FFE066")};--gi:${cl(t.ink,"#000096")}"><div class="gh"><span class="gtag">${esc(t.tag||"Gifts")}</span><b class="gt">${esc(t.name)}</b><span class="gend">Ends in <span class="cd" data-exp="${t.end}">${fmtLeft(t.end-Date.now())}</span></span></div>
      <p class="gs">🎁 FREE with your box of ${S.size}. No extra cost:</p><div class="gl big">${rnd?`<span class="gcard rnd"><i aria-hidden="true">🎲</i><b>${giftSurprise(x.limit)}</b><em>FREE</em></span>${gv==="full"?`<div class="gpool">${x.gifts.map(g=>giftChip(g," sm")).join("")}</div>`:gv==="teaser"?giftTeaser(x.gifts,"possible"):""}`:gv==="full"||x.gifts.length<2?(gv==="hidden"?"":x.gifts.map(g=>giftCard(g)).join("")):gv==="teaser"?giftTeaser(x.gifts,"included"):""}</div>
      <button class="gbsee" type="button" data-giftsee="${S.size}">👀 See what you ${rnd?"may get":"get"}</button><p class="gnote">${GIFT_NOTE}</p></div>`}).join("");
}
/* pop-up with the gifts a box size earns (opened from the strip under the box sizes and from the gift card) */
function openGiftSheet(n){
  const pl=giftPlan(n);if(!pl.length)return;
  $("#gsBody").innerHTML=pl.map(x=>{const rnd=x.mode==="random";
    return `<h3 id="gsTitle">🎁 ${rnd?"Gifts you may get":x.gifts.length>1?"Your free gifts":"Your free gift"}</h3>
    <p class="gs-sub">${esc(x.sale.name)} · with your box of ${n} · ends in <span class="cd" data-exp="${x.sale.end}">${fmtLeft(x.sale.end-Date.now())}</span></p>
    ${x.gifts.map(g=>{const im=g.img||giftImg(g.id);return `<div class="gs-g">${im?`<img src="${esc(imgOk(im))}" alt="">`:`<span class="gs-p" aria-hidden="true">🎁</span>`}<b>${esc(g.name)}</b><em>FREE</em></div>`}).join("")}
    <div class="gs-note"><span aria-hidden="true">${rnd?"🎲":"✅"}</span><span>${rnd?`Your <b>${esc(bbName())}</b> holds <b>${x.limit===1?"1 gift":x.limit+" gifts"}</b> from this list. You open it after you send your payment proof. `:`${x.gifts.length>1?"These gifts come":"This gift comes"} with your box. `}It's confirmed once we verify your payment.</span></div>`}).join("")
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
  {let pa=$("#pgAp");if(!pa){pa=document.createElement("div");pa.id="pgAp";pa.className="pg-ap";ap.parentNode.insertBefore(pa,ap)}
    pa.hidden=!PG.code;pa.innerHTML=PG.code?`<span>🎁 <b>${esc(PG.code)}</b> ✓ ${esc((PG.info&&PG.info.mode!=="surprise"&&(PG.info.items||[]).map(g=>g&&g.name).filter(Boolean).join(", "))||(PG.info&&PG.info.title)||"Free Gift Set")}</span><button type="button" data-pgrm aria-label="Remove gift code">✕</button>`:""}
  const list=DB.coupons.filter(c=>c.show&&cpState(c)==="live"&&!(on&&q.coupon.code===c.code));
  ch.innerHTML=on?"":list.map(c=>`<button type="button" data-cpnuse="${esc(c.code)}"><b>${esc(c.code)}</b><small>${esc(c.desc||cpOff(c))}${c.minSpend>0?` · min ${money(c.minSpend)}`:""}</small></button>`).join("");
}
async function applyCoupon(code){
  code=cpNorm(code);if(!code){cpMsg("Type your coupon code first.",false);return}
  if(PG.code!==code.toUpperCase()){const g=await pgCheck(code,($("#coPhone")||{}).value||"");
    if(g.gift){if(g.ok){$("#cpnIn").value="";renderStore();cpMsg(`🎁 Gift code added! Your ${(g.info&&g.info.title)||"Free Gift Set"} is reserved.`,true)}else cpMsg(g.err||"That gift code cannot be used.",false);return}}
  if(SBH.on){const r=await withPass("coupon",()=>SBH.checkCoupon(code,S.size,($("#coPhone")||{}).value||"",S.editId)).catch(ex=>({ok:false,err:ex.message}));if(!r.ok){cpMsg(r.err,false);return}}
  const q0=quote({...S,coupon:code},DB,{withDelivery:S.step===2});
  if(q0.couponErr){cpMsg(q0.couponErr,false);return}
  S.coupon=code;$("#cpnIn").value="";renderStore();
  cpMsg(q0.couponDisc>0?`Nice! You saved ${money(q0.couponDisc)}.`:"Coupon added.",true);
  const ap=$("#cpnAp");if(ap&&!RM)ap.animate([{transform:"scale(1)"},{transform:"scale(1.06)"},{transform:"scale(1)"}],{duration:400})
}
$("#cpnForm").addEventListener("submit",e=>{e.preventDefault();applyCoupon($("#cpnIn").value)});
$("#cpn").addEventListener("click",e=>{if(e.target.closest("[data-pgrm]")){pgForget();renderStore();return}const u=e.target.closest("[data-cpnuse]");if(u){applyCoupon(u.dataset.cpnuse);return}
  if(e.target.closest("[data-cpnrm]")){S.coupon="";renderStore();cpMsg("Coupon removed.",true)}});
// tap the cookie picture to add it
$("#menuGrid").addEventListener("click",e=>{
  if(e.target.closest("button,a,.stepper"))return;
  const w=e.target.closest(".pwrap, h4");if(!w)return;const card=w.closest(".card");if(!card||card.classList.contains("out"))return;
  add(card.dataset.id,card)});
// box already full: a small bubble right on the tapped flavor (not the toast at the bottom)
function fullMsg(card,closed){
  const ttl=closed?"Your box is closed":"Your box is full!",sub=closed?"Please open it to change your cookies.":"Double-tap a cookie in your box to take it out first.";
  const w=card&&card.querySelector(".pwrap");if(!w){toast(`${ttl} ${sub}`);return}
  let b=w.querySelector(".fullmsg");if(b)b.remove();
  b=document.createElement("div");b.className="fullmsg";b.setAttribute("role","status");
  b.innerHTML=`<b>${ttl}</b><span>${sub}</span>`;w.appendChild(b);
  const r=b.getBoundingClientRect(),vw=document.documentElement.clientWidth,dx=r.left<8?8-r.left:r.right>vw-8?vw-8-r.right:0;if(dx){b.style.left=`calc(50% + ${dx}px)`;b.style.setProperty("--ax",-dx+"px")}
  if(!RM){shake(w.querySelector(".plate")||w);b.animate([{opacity:0,transform:"translate(-50%,8px) scale(.7)"},{opacity:1,transform:"translate(-50%,0) scale(1.06)",offset:.6},{opacity:1,transform:"translate(-50%,0) scale(1)"}],{duration:320,easing:"ease-out"})}
  clearTimeout(b._t);b._t=setTimeout(()=>{if(RM){b.remove();return}b.animate([{opacity:1},{opacity:0,transform:"translate(-50%,-10px)"}],{duration:300,easing:"ease-in"}).onfinish=()=>b.remove()},2400)}
function add(id,card){
  if(S.closed&&full()){fullMsg(card,true);return}
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
function removeOne(id,card){if(S.closed&&full()){fullMsg(card,true);return}const i=S.box.lastIndexOf(id);if(i<0)return;removeAt(i);if(card&&!RM)tag(card.querySelector(".stepper"),"−1")}
const randomId = () => {const a=pickable().filter(tierOk);return a.length?a[Math.floor(Math.random()*a.length)].id:null};
function fillBox(base){
  S.auto=S.auto||[];let k=0;while(!full()){const id=randomId(),at=firstEmpty();if(!id||at<0)break;S.box[at]=id;S.auto[at]=true;S.shuf=1;pop.set(at,base+k++*80)}
  if(!full())toast(shopTier==="all"?"Not enough stock to fill the whole box":`Not enough ${TIER_NAME[shopTier]} flavors left to fill the whole box. Switch to All for more.`);
}
function fillRest(){if(!pickable().length){toast("Every flavor is out of stock right now");return}if(!pickable().filter(tierOk).length){toast(`No ${TIER_NAME[shopTier]} flavors left right now. Switch to All.`);return}fillBox(0);renderStore();if(full())celebrate()}
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
  if(shopTier!=="all"&&!availProducts().filter(tierOk).length){toast(`No ${TIER_NAME[shopTier]} flavors left right now. Switch to All.`);return}
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
  if(t.fabGest!==false&&!f.classList.contains("away")&&!fabPrefs().hinted&&!document.body.classList.contains("pre-on")){fabSave({hinted:1});setTimeout(()=>toast("Tip: drag the circle to move it. Pinch it, or press and hold, to make it smaller or fainter."),1800)}
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
/* closing the box: a full box is closed (lid with the logo, ribbon and bow) before the customer chooses a day.
   While closed, flavors, Shuffle and Clear box are locked. Open it with the Open box button, or double-tap the lid. */
function renderLid(){const on=!!(S.closed&&full()),lid=$("#boxLid");
  if(lid.hidden===on){lid.hidden=!on;lid.classList.remove("anim")}
  if(on){$("#lidMark").innerHTML=$("#logoMark").innerHTML;$("#lidName").textContent=$("#brandTxt").textContent}
  $("#bpDone").hidden=!on;$("#bpCount").hidden=on;$("#openBtn").hidden=!on;
  [$("#randBtn"),$("#clearBtn"),$("#barRand")].forEach(b=>b&&b.classList.toggle("lockedout",on));
  $(".boxpanel").classList.toggle("isclosed",on)}
function closeBox(){if(!full())return;
  const play=()=>{S.closed=true;renderStore();if(RM)return;const lid=$("#boxLid"),q=x=>lid.querySelector(x);
    lid.classList.add("anim");
    lid.animate([{transform:"perspective(600px) translateY(-150px) rotateX(-60deg)",opacity:0},{opacity:1,offset:.25},{transform:"perspective(600px) translateY(6px) rotateX(0)",offset:.72},{transform:"perspective(600px) translateY(-6px) scale(1.01,.99)",offset:.86},{transform:"none"}],{duration:620,easing:"cubic-bezier(.5,0,.3,1)"});
    $("#slotWrap").animate([{transform:"none"},{transform:"scale(1.03,.95)",offset:.5},{transform:"none"}],{duration:300,delay:420,easing:"ease-out"});
    q(".lg").animate([{transform:"scale(.7)",opacity:0},{transform:"scale(1.08)",opacity:1,offset:.7},{transform:"scale(1)"}],{duration:420,delay:420,easing:"ease-out",fill:"backwards"});
    q(".rv").animate([{transform:"scaleY(0)"},{transform:"scaleY(1)"}],{duration:300,delay:720,easing:"ease-out",fill:"backwards"});
    q(".rh").animate([{transform:"scaleX(0)"},{transform:"scaleX(1)"}],{duration:300,delay:900,easing:"ease-out",fill:"backwards"});
    q(".bow").animate([{transform:"scale(0) rotate(-40deg)"},{transform:"scale(1.25) rotate(8deg)",offset:.6},{transform:"scale(1) rotate(0)"}],{duration:480,delay:1150,easing:"ease-out",fill:"backwards"});
    q(".lidlock").animate([{transform:"scale(0) rotate(-30deg)"},{transform:"scale(1.25)",offset:.6},{transform:"scale(1)"}],{duration:420,delay:1350,easing:"ease-out",fill:"backwards"});
    q(".shine").animate([{left:"-40%"},{left:"130%"}],{duration:700,delay:1250,easing:"ease-in-out",fill:"backwards"});
    $("#bpDone").animate([{transform:"scale(0)"},{transform:"scale(1.2)",offset:.6},{transform:"scale(1)"}],{duration:420,delay:1400,easing:"ease-out",fill:"backwards"});
    setTimeout(()=>{const b=q(".bow").getBoundingClientRect();boxBurst(b.left+b.width/2,b.top+b.height/2)},1300)};
  const p=$(".boxpanel"),r=$("#slotWrap").getBoundingClientRect();
  if(r.top<0||r.bottom>innerHeight){showMyBox();setTimeout(play,450)}else play()}
function boxBurst(cx,cy){const cols=["#FFD43B","#E8384F","#2FBF71","#4DABF7","#FFFFFF","#F783AC"];
  for(let i=0;i<26;i++){const c=fx("");const w=5+Math.random()*4;Object.assign(c.style,{width:w+"px",height:w*1.5+"px",borderRadius:"2px",background:cols[i%cols.length]});
    const a=-Math.PI/2+(Math.random()-.5)*2.6,v=90+Math.random()*110,x=Math.cos(a)*v,y=Math.sin(a)*v,r=Math.random()*720-360;
    c.animate([{transform:`translate(${cx}px,${cy}px) rotate(0)`,opacity:1},{transform:`translate(${cx+x}px,${cy+y}px) rotate(${r/2}deg)`,opacity:1,offset:.45},{transform:`translate(${cx+x*1.2}px,${cy+y+110}px) rotate(${r}deg)`,opacity:0}],{duration:1300+Math.random()*400,easing:"cubic-bezier(.2,.7,.4,1)"}).onfinish=()=>c.remove()}}
function openBox(){if(!S.closed)return;const lid=$("#boxLid"),q=x=>lid.querySelector(x);
  const done=()=>{S.closed=false;if(S.step===2)S.step=1;renderStore()};
  if(RM||lid.hidden){done();return}
  q(".bow").animate([{transform:"none",opacity:1},{transform:"translateY(-20px) rotate(90deg) scale(.4)",opacity:0}],{duration:280,easing:"ease-in",fill:"forwards"});
  q(".rh").animate([{transform:"scaleX(1)"},{transform:"scaleX(0)"}],{duration:240,easing:"ease-in",fill:"forwards"});
  q(".rv").animate([{transform:"scaleY(1)"},{transform:"scaleY(0)"}],{duration:240,delay:80,easing:"ease-in",fill:"forwards"});
  q(".lidlock").animate([{transform:"scale(1)"},{transform:"scale(0)"}],{duration:200,fill:"forwards"});
  lid.animate([{transform:"none",opacity:1},{transform:"perspective(600px) translateY(-140px) rotateX(-55deg) rotate(-6deg)",opacity:0}],{duration:450,delay:260,easing:"ease-in",fill:"forwards"}).onfinish=()=>{lid.getAnimations({subtree:true}).forEach(a=>a.cancel());done()}}
let lidArm=0;
$("#boxLid").addEventListener("click",()=>{const now=Date.now(),lid=$("#boxLid");if(now-lidArm<=900){lidArm=0;lid.querySelectorAll(".armtip").forEach(x=>x.remove());openBox();return}
  lidArm=now;lid.querySelectorAll(".armtip").forEach(x=>x.remove());const t=document.createElement("span");t.className="armtip";t.textContent="Tap again to open";lid.appendChild(t);setTimeout(()=>{t.remove()},900)});
$("#openBtn").addEventListener("click",openBox);
function goStep(n){if(n===2&&!(full()&&S.closed))return;S.step=n;renderStore();
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
  if(go==="when"){if(document.activeElement)document.activeElement.blur();const sd=$("#dayBlock").hidden;scrollToEl($(!sd&&!S.day?"#dayBlock":!$("#timeBlock").hidden&&(!sd||!S.time)?"#timeBlock":!sd&&S.day&&!$("#timeBlock").hidden?"#timeBlock":"#step2"));return}
  if(go==="needcourier"){bsNudge();return}
  if(go==="close"){closeBox();return}
  if(go==="step2")goStep(2);else if(go==="checkout")openCoWarn()}
/* courier choice in the box panel (delivery + Biteship on): a pop-up that reuses the checkout courier box */
function bsNudge(){
  const row=$("#bsRow"),m=$("#ctaMsg");if(m){m.hidden=false;clearTimeout(bsNudge.t);bsNudge.t=setTimeout(()=>{m.hidden=true},6000)}
  if(row){scrollToEl(row);row.classList.remove("nudge");void row.offsetWidth;row.classList.add("nudge");setTimeout(()=>row.classList.remove("nudge"),2200)}
  toast("Please choose a courier first");
}
function bsPopOpen(){
  S.courierTip=false;
  const body=$("#bsPopBody");body.appendChild($("#addrFields"));body.appendChild($("#bsBox"));
  $("#addrFields").hidden=false;$("#coAddr").required=false;prefillCust();placeFieldsShow();bsBoxOpen();
  $("#bsPhone").value=$("#coPhone").value;
  $("#bsPop").hidden=false;document.body.style.overflow="hidden";
  bsTourStart(false);
}
// checkout form: one line with the chosen courier and a Change button (the full courier box lives in the pop-up)
function bsSumDraw(){
  const el=$("#bsSum");if(!el)return;const on=bsOn()&&S.mode==="delivery";el.hidden=!on;if(!on)return;const sh=bsShip(S);
  el.innerHTML=`<span class="flbl" style="font-weight:600;font-size:14px">Courier</span><div class="bssumrow${sh||S.bsSkip?"":" need"}${BSD.busy?" busy":""}"><span>${BSD.busy?`<span class="bsmoto sm" aria-hidden="true">🛵</span> <b>${BSD.phase==="map"?"Finding your address…":"Looking for couriers…"}</b>`:sh?`<b>${esc(sh.courierName||sh.courier)}</b> ${esc(sh.serviceName||sh.service)}${sh.eta?` <small>${esc(sh.eta)}</small>`:""}`:S.bsSkip?esc(scName()):"<b>⚠ Choose your courier</b>"}</span>${sh?`<span class="num">${money(sh.price)}</span>`:""}<button type="button" class="ghost" data-bscourier>${sh||S.bsSkip?"Change":"🛵 Choose courier"}</button></div>`;
}
/* guided tour for the courier pop-up: shows once, can be skipped, replay with the "?" button */
/* guided tour of the shop for a new visitor: starts when they tap the main button, follows them through the box, the day and time, and checkout. It can be skipped and replayed with "How does it work?". */
const GT_KEY="delidome-shop-tour",GT={i:-1,on:false,iv:0};
const gtShown=el=>!!(el&&el.getClientRects().length);
const gtCta=()=>[$("#barCta"),$("#panelCta")].find(gtShown)||null;
const GT_STEPS=[
  {t:"Pick a box size",m:"How many cookies do you want in your box? Tap a size to choose.",el:()=>$("#sizes"),done:()=>GT.sizeTap},
  {t:"Fill your box",m:"Tap a flavor to add a cookie to your box. Tap again to add more. Or press “Fill the rest for me”.",el:()=>$("#menuGrid"),done:()=>S.box.filter(Boolean).length>=S.size&&S.size>0},
  {t:"This is your box",m:"Here you can see what is in your box. Double-tap a cookie in the box to take it out. When it is full, the button below lights up.",el:()=>$(".boxpanel"),next:true},
  {t:"Go to the next step",m:"When your box is full, tap this button to close the box. Then tap it again to choose the day and time.",el:()=>gtCta(),done:()=>S.step===2},
  {t:"Choose when you want it",m:"Pick pickup or delivery, then the day and the time. You can add extras and a note too.",el:()=>S.step===2?$("#step2"):null,next:true,after:true},
  {t:"Almost done",m:"Type your name, WhatsApp number and email, then place your order. We show you how to pay on the next screen.",el:()=>!$("#sheet").hidden?$("#coForm"):null,next:true,after:true,last:true}];
function gtEnd(done){clearInterval(GT.iv);GT.iv=0;GT.on=false;GT.i=-1;$("#gt").hidden=true;try{localStorage.setItem(GT_KEY,"1")}catch(e){}if(done)toast("Enjoy your cookies! 🍪")}
function gtStart(force){if(GT.on)return;if(!force){let seen=false;try{seen=!!localStorage.getItem(GT_KEY)}catch(e){}if(seen)return}
  if(!$("#storeView")||$("#storeView").hidden||document.body.classList.contains("pre-on"))return;
  GT.on=true;GT.i=0;GT.sizeTap=false;GT.shownFor=-1;$("#gtD").innerHTML=GT_STEPS.map(()=>"<i></i>").join("");clearInterval(GT.iv);GT.iv=setInterval(gtTick,350);gtTick()}
function gtShow(){const s=GT_STEPS[GT.i],el=s.el();if(!el){$("#gt").hidden=true;return false}
  if(GT.shownFor!==GT.i){GT.shownFor=GT.i;$("#gtT").textContent=`Step ${GT.i+1} of ${GT_STEPS.length} · ${s.t}`;$("#gtM").textContent=s.m;[...$("#gtD").children].forEach((d,k)=>d.classList.toggle("on",k===GT.i));
    $("#gtN").textContent=GT.i===GT_STEPS.length-1?"Finish":"Next";
    if(!/^(barCta|panelCta)$/.test(el.id)&&!getComputedStyle(el).position.match(/fixed/))scrollToEl(el)}
  $("#gt").hidden=false;gtPlace(el);return true}
function gtPlace(el){const r=el.getBoundingClientRect(),h=$("#gtHole"),c=$("#gtCard"),pad=6,top=Math.max(2,r.top-pad),bot=Math.min(innerHeight-2,r.bottom+pad);
  h.style.cssText=`left:${Math.max(2,r.left-pad)}px;top:${top}px;width:${Math.min(innerWidth-4,r.width+pad*2)}px;height:${Math.max(24,bot-top)}px`;
  const ch=c.offsetHeight,below=innerHeight-bot-12,above=top-12;c.style.top=(below>=ch?bot+12:above>=ch?top-ch-12:Math.max(8,innerHeight-ch-10))+"px"}
function gtTick(){if(!GT.on)return;if(!$("#bsPop").hidden||!$("#storeView")||$("#storeView").hidden||document.body.classList.contains("pre-on")){$("#gt").hidden=true;return}
  const s=GT_STEPS[GT.i];if(!s)return gtEnd(false);
  if(s.done&&s.done()){if(GT.i>=GT_STEPS.length-1)return gtEnd(true);GT.i++;GT.shownFor=-1;return gtTick()}
  // a step further on is already on screen (they moved ahead on their own): jump to it
  for(let k=GT_STEPS.length-1;k>GT.i;k--){const n=GT_STEPS[k];if(n.after&&n.el()){GT.i=k;GT.shownFor=-1;break}}
  gtShow()}
$("#gtN").addEventListener("click",()=>{if(GT.i>=GT_STEPS.length-1)return gtEnd(true);GT.i++;GT.shownFor=-1;gtTick()});
$("#gtSkip").addEventListener("click",()=>gtEnd(false));
$("#gtBtn").addEventListener("click",()=>{GT.sizeTap=false;gtStart(true)});
$("#sizes").addEventListener("click",()=>{if(GT.on)GT.sizeTap=true});
document.addEventListener("click",e=>{const a=e.target.closest(".hero-ctas a");if(a&&a===$("#dome .hero-ctas a"))setTimeout(()=>gtStart(false),700)});
addEventListener("resize",()=>{if(GT.on)gtTick()});document.addEventListener("scroll",()=>{if(GT.on&&!$("#gt").hidden){const s=GT_STEPS[GT.i],el=s&&s.el();if(el)gtPlace(el)}},true);
const BS_TIP="delidome-courier-tour",BST={i:-1};
const BS_STEPS=[
  {el:()=>$("#bsPhoneF"),t:"WhatsApp",m:"Type your WhatsApp number. We use it to find your address and show courier prices.",ex:"Example: 81234567890"},
  {el:()=>$("#coAddr"),t:"Delivery address",m:"Type your full address, in this order:",ex:"Place / Residence / Apartment · City · Street name · House or location number · Postal code"},
  {el:()=>$("#bsBox .bsbtns")||$("#bsBox"),t:"Find your spot",m:"Tap “Find my address on the map” or “Use my current location”. Then check that the pin is on your door."},
  {el:()=>{const o=$("#bsOpts");return o&&o.offsetHeight>20?o:$("#bsBox")},t:"Pick a courier",m:"Prices appear for your location. Tap the courier you like, then press Done."}];
function bsTourSeen(){try{return !!localStorage.getItem(BS_TIP)}catch(e){return false}}
function bsTourEnd(done){$("#bsTour").hidden=true;BST.i=-1;try{localStorage.setItem(BS_TIP,"1")}catch(e){}if(done)toast("You're all set! Check your courier and tap Done.")}
let BS_LIST=[];
const bsVis=s=>{const e=s.el();return !!(e&&e.getClientRects().length)};
function bsTourStart(force){if(!force&&bsTourSeen())return;BS_LIST=BS_STEPS.filter(bsVis);if(!BS_LIST.length)return;$("#bsTdots").innerHTML=BS_LIST.map(()=>"<i></i>").join("");$("#bsTour").hidden=false;bsTourGo(0)}
function bsTourGo(i){BST.i=i;const s=BS_LIST[i],el=s.el();if(!el){bsTourEnd(false);return}
  $("#bsTt").textContent=`Step ${i+1} of ${BS_LIST.length} · ${s.t}`;$("#bsTm").textContent=s.m;const e=$("#bsTe");e.hidden=!s.ex;e.textContent=s.ex||"";
  [...$("#bsTdots").children].forEach((d,k)=>d.classList.toggle("on",k===i));$("#bsTnext").textContent=i===BS_LIST.length-1?"Finish":"Next";
  const r0=el.getBoundingClientRect();el.scrollIntoView({block:r0.height>innerHeight*.4?"start":"center",behavior:"auto"});bsTourPlace()}
function bsTourPlace(){if(BST.i<0||$("#bsTour").hidden)return;const el=BS_LIST[BST.i].el();if(!el)return;const r=el.getBoundingClientRect(),h=$("#bsHole"),c=$("#bsTcard");
  const pad=6,top=Math.max(2,r.top-pad),bot=Math.min(innerHeight-2,r.bottom+pad);
  h.style.cssText=`left:${Math.max(2,r.left-pad)}px;top:${top}px;width:${Math.min(innerWidth-4,r.width+pad*2)}px;height:${Math.max(20,bot-top)}px`;
  const ch=c.offsetHeight,below=innerHeight-bot-12,above=top-12;
  c.style.top=(below>=ch?bot+12:above>=ch?top-ch-12:Math.max(8,innerHeight-ch-10))+"px"}
$("#bsTnext").addEventListener("click",()=>{if(BST.i>=BS_LIST.length-1)bsTourEnd(true);else bsTourGo(BST.i+1)});
$("#bsTskip").addEventListener("click",()=>bsTourEnd(false));
$("#bsTourBtn").addEventListener("click",()=>bsTourStart(true));
addEventListener("resize",bsTourPlace);document.addEventListener("scroll",bsTourPlace,true);
$("#bsPop").addEventListener("input",()=>{if(BST.i>=0)requestAnimationFrame(bsTourPlace)});
function bsPopClose(){
  if(BST.i>=0)$("#bsTour").hidden=true,BST.i=-1;
  const f=$("#coForm"),err=$("#coErr");f.insertBefore($("#addrFields"),err);f.insertBefore($("#bsBox"),err);$("#bsBox").hidden=true;
  if(!$("#sheet").hidden){$("#addrFields").hidden=S.mode!=="delivery";$("#coAddr").required=S.mode==="delivery";bsSumDraw();renderCoSummary()}
  $("#bsPop").hidden=true;if($("#sheet").hidden)document.body.style.overflow="";
  const m=$("#ctaMsg");if(m&&!bsPending(S))m.hidden=true;renderStore();
}
document.addEventListener("click",e=>{if(e.target.closest("[data-bscourier]"))bsPopOpen()});
$("#bsPopX").addEventListener("click",bsPopClose);$("#bsPopDone").addEventListener("click",bsPopClose);
$("#bsPop").addEventListener("click",e=>{if(e.target.id==="bsPop")bsPopClose()});
$("#bsPop").addEventListener("input",e=>{if(e.target.id==="coAddr"||e.target.id==="coDNote")saveCust()});
$("#bsPhone").addEventListener("input",e=>{const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v;$("#coPhone").value=v;saveCust();if(normPhone(v).length>=7&&BSD.err&&/WhatsApp/.test(BSD.err)){BSD.err="";bsDraw()}});
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
const BSD={area:null,lat:"",lng:"",label:"",opts:[],busy:false,tried:false,err:"",t:0,phase:""};
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
  const box=$("#bsMap");if(!box||!BSD.mapOpen)return;
  let L;try{L=await bsLoadLeaflet()}catch(e){box.hidden=true;const h=$("#bsMapHint");h.hidden=false;h.textContent="The map couldn't load. Please type your address above, or try again in a moment.";return}
  box.hidden=false;$("#bsMapHint").hidden=false;$("#bsMapDone").hidden=false;
  const has=BSD.lat&&BSD.lng,ll=has?[+BSD.lat,+BSD.lng]:[-6.2,106.75];
  if(!bsMapObj){
    L.Icon.Default.imagePath="vendor/leaflet/images/";
    bsMapObj=L.map(box,{zoomControl:true,attributionControl:true}).setView(ll,has?17:11);
    // OpenStreetMap tiles; if they fail (blocked or busy) switch once to the CARTO copy of the same map
    const osm=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(bsMapObj);
    let bad=0;osm.on("tileerror",()=>{if(++bad!==3)return;bsMapObj.removeLayer(osm);L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",{maxZoom:19,subdomains:"abcd",attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'}).addTo(bsMapObj)});
    bsMapObj.on("click",e=>{if(!bsPin)bsPin=L.marker(e.latlng,{draggable:true}).addTo(bsMapObj).on("dragend",ev=>{const p=ev.target.getLatLng();bsPinSet(p.lat,p.lng)});else bsPin.setLatLng(e.latlng);bsPinSet(e.latlng.lat,e.latlng.lng)});
  }else{setTimeout(()=>bsMapObj.invalidateSize(),50)}
  if(has){
    if(!bsPin)bsPin=L.marker(ll,{draggable:true}).addTo(bsMapObj).on("dragend",ev=>{const p=ev.target.getLatLng();bsPinSet(p.lat,p.lng)});else bsPin.setLatLng(ll);
    bsMapObj.setView(ll,Math.max(bsMapObj.getZoom(),16));
  }
  setTimeout(()=>bsMapObj&&bsMapObj.invalidateSize(),120);
}
/* the kind of a Biteship service, for the badge: Car, Instant (bike, minutes) or Sameday */
const BS_KINDS={car:{t:"Car",ic:"🚗",cls:"bsb-car"},instant:{t:"Instant",ic:"🏍️",cls:"bsb-inst"},sameday:{t:"Sameday",ic:"🏍️",cls:"bsb-same"}};
function bsKind(x){const t=String([x.type,x.serviceName,x.service,x.courierName,x.courier].join(" ")).toLowerCase();
  if(/car|mobil|truck|van\b|pickup/.test(t))return "car";if(/same[ _-]?day/.test(t))return "sameday";if(/instant|gojek|grab|lalamove|borzo|deliveree|bike|motor|ojek/.test(t))return "instant";return ""}
// the "looking for couriers" animation: a little scooter riding along a road
function bsBusyHTML(){const t=BSD.phase==="map"?"Finding your address on the map…":"Looking for couriers…",s=BSD.phase==="map"?"We are placing the pin. This takes a few seconds.":"Checking prices for your address. Please wait a moment.";
  return `<div class="bsbusy" role="status" aria-live="polite"><div class="bsroad"><span class="bsmoto" aria-hidden="true">🛵</span><i class="bsdash"></i></div><b>${t}</b><small>${s}</small></div>`}
function bsDraw(){
  const o=$("#bsOpts"),er=$("#bsErr"),pl=$("#bsPlace");if(BSD.area||BSD.lat)saveLoc();
  // the map only opens with "Pick on the map" and closes with Done (or once a courier is chosen), so a scroll can't move the pin by accident
  if(BSD.mapOpen)bsMapShow();else{$("#bsMap").hidden=true;$("#bsMapHint").hidden=true;$("#bsMapDone").hidden=true}
  $("#bsPick").textContent=BSD.mapOpen?"✓ Done with the map":"🗺️ Pick on the map";
  pl.hidden=!BSD.label;pl.innerHTML=BSD.label?`📍 ${esc(BSD.label)} · <a href="https://www.openstreetmap.org/?mlat=${esc(BSD.lat)}&mlon=${esc(BSD.lng)}#map=17/${esc(BSD.lat)}/${esc(BSD.lng)}" target="_blank" rel="noopener">Check on the map</a>`:"";
  if(BSD.busy){o.innerHTML=bsBusyHTML()}
  else{const fd=S.mode==="delivery"?freeDelSale(S.size):null,fee0=storeFee(S.size),promoStore=!!(fd&&fdApply(fd,fee0,"store")<fee0),store=bsStoreOpt();
    // cheapest first (the index stays the position in BSD.opts so the click handler still finds the courier)
    const rows=BSD.opts.map((x,i)=>({x,i})).sort((a,b)=>fdApply(fd,a.x.price,"bite")-fdApply(fd,b.x.price,"bite")||a.x.price-b.x.price);
    o.innerHTML=(promoStore?store:"")+rows.map(({x,i})=>{const sel=!!(S.ship&&S.ship.sig===x.sig&&!S.bsSkip),k=bsKind(x),b=BS_KINDS[k];
      return `<button type="button" class="bsopt${sel?" sel":""}${b?" bsk-"+k:""}" data-bsopt="${i}" aria-pressed="${sel}">${sel?`<i class="bschk" aria-hidden="true">✓</i>`:""}<span><b>${esc(x.courierName||x.courier)}</b> ${esc(x.serviceName||x.service)}${b?` <em class="bsbadge ${b.cls}"><i aria-hidden="true">${b.ic}</i>${b.t}</em>`:""}${x.eta?`<small>${esc(x.eta)}</small>`:""}</span><span class="num">${fdPriceHTML(fd,x.price,"bite")}</span></button>`}).join("")
      +(promoStore?"":store)}
  const msg=BSD.err&&!BSD.busy?BSD.err:"";er.hidden=!msg;er.textContent=msg;
}
// "Store Courier" in the courier list: always, or only when courier prices can't load (the owner chooses). Free while a free-delivery promo covers this box.
function bsStoreOpt(){if(!bsFallback()||BSD.busy)return "";
  if(!bsWho())return "";                                   // no WhatsApp number yet: the Store Courier is not offered
  if(!(BSD.opts.length||BSD.err||BSD.tried))return "";     // the customer has to find the address on the map (or try the Biteship couriers) first
  const fd=S.mode==="delivery"?freeDelSale(S.size):null,fee=storeFee(S.size),promo=!!(fd&&fdApply(fd,fee,"store")<fee),fb=(DB.settings.scShow||"always")==="fallback";
  if(fb&&!promo&&BSD.opts.length&&!BSD.err)return S.bsSkip?bsStoreBtn():"";   // "only when prices can't load", unless a delivery promo makes it the better deal
  return bsStoreBtn()}
function bsStoreBtn(){const t=DB.settings,fee=storeFee(S.size),fd=freeDelSale(S.size),sel=!!S.bsSkip,promo=fd&&fdApply(fd,fee,"store")<fee;
  return `<button type="button" class="bsopt bsstore${sel?" sel":""}${promo?" promo":""}" data-bsskip aria-pressed="${sel}">${sel?`<i class="bschk" aria-hidden="true">✓</i>`:""}<span><b>${esc(scName())}</b>${promo?`<em class="bspromo">${fd.kind==="amount"?esc(money(fd.amount))+" OFF":"FREE DELIVERY"}</em>`:""}${t.scNote?`<small>${esc(t.scNote)}</small>`:""}</span><span class="num">${fdPriceHTML(fd,fee,"store")}</span></button>`}
async function bsRates(){
  if(!(BSD.area||BSD.lat)||BSD.busy)return;
  const who=bsWho();if(!who){BSD.err="Type your WhatsApp number first, then we can show courier prices.";bsDraw();return}
  const my=++BSD.t;BSD.busy=true;BSD.phase="rates";BSD.err="";bsDraw();bsSumDraw();
  try{
    const r=await SBH.fn("biteship",{action:"rates",pass:await tsPass("courier"),phone:who.phone,email:who.email,size:S.size,dest:{lat:BSD.lat,lng:BSD.lng,postal:BSD.area?BSD.area.postal:"",areaId:BSD.area?BSD.area.id:"",areaName:BSD.area?BSD.area.name:""}});
    if(my!==BSD.t)return;BSD.opts=r.options||[];BSD.err=BSD.opts.length?"":(r.error||"No courier is available for this address.");
    if(S.ship&&!BSD.opts.some(x=>x.sig===S.ship.sig)){S.ship=null}
  }catch(e){if(my!==BSD.t)return;BSD.opts=[];BSD.err=e.message==="BANNED"?"Courier prices are not available for this order.":e.message;if(e.message==="BANNED")banShow()}
  BSD.busy=false;bsDraw();renderCoSummary();renderStore();
}
async function bsGeocode(){
  const addr=$("#coAddr").value.trim(),areaTxt=BSD.area?BSD.area.name:$("#bsArea").value.trim();if(!addr&&!areaTxt){BSD.err="Type your address (and your area) first.";bsDraw();return}
  const who=bsWho();if(!who){BSD.err="Type your WhatsApp number first, then we can find your address.";bsDraw();return}
  BSD.busy=true;BSD.phase="map";BSD.err="";bsDraw();bsSumDraw();
  try{const r=await SBH.fn("biteship",{action:"geocode",pass:await tsPass("courier"),phone:who.phone,email:who.email,address:addr,area:areaTxt});BSD.busy=false;BSD.tried=true;
    if(r.found){BSD.lat=r.lat;BSD.lng=r.lng;BSD.label=(r.approx?"Near: ":"")+r.label+(r.approx?" (approximate, please check on the map)":"");S.ship=null;BSD.opts=[];await bsRates();return}
    BSD.err="We couldn't find that address on the map. Pick your area from the list, check the spelling, or use your current location.";
  }catch(e){BSD.busy=false;BSD.err=e.message==="BANNED"?"Courier prices are not available for this order.":e.message;if(e.message==="BANNED")banShow()}
  bsDraw();
}
$("#coPhone").addEventListener("change",()=>{if((BSD.area||BSD.lat)&&!BSD.busy&&!BSD.opts.length&&/WhatsApp number/.test(BSD.err||""))bsRates()});
const bsWho=()=>{const p=($("#coPhone")||{value:""}).value.trim();return normPhone(p).length>=7?{phone:p,email:($("#coEmail")||{value:""}).value.trim()}:null};
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
$("#bsPick").addEventListener("click",()=>{BSD.mapOpen=!BSD.mapOpen;bsDraw()});
$("#bsMapDone").addEventListener("click",()=>{BSD.mapOpen=false;bsDraw();const p=$("#bsPlace");if(p&&!p.hidden)p.scrollIntoView({block:"nearest",behavior:RM?"auto":"smooth"})});
$("#bsGeo").addEventListener("click",()=>{
  if(!navigator.geolocation){BSD.err="Your browser can't share its location.";bsDraw();return}
  BSD.busy=true;BSD.err="";bsDraw();
  navigator.geolocation.getCurrentPosition(p=>{BSD.busy=false;BSD.lat=p.coords.latitude.toFixed(5);BSD.lng=p.coords.longitude.toFixed(5);BSD.label="Your current location";S.ship=null;BSD.opts=[];bsRates()},
    ()=>{BSD.busy=false;BSD.err="We couldn't get your location. Allow location access, or search your area instead.";bsDraw()},{timeout:12000,maximumAge:60000})});
$("#bsOpts").addEventListener("click",e=>{
  const b=e.target.closest("[data-bsopt]");if(b){const x=BSD.opts[+b.dataset.bsopt];if(x){S.ship=x;S.bsSkip=false;S.courierTip=false;BSD.mapOpen=false;bsDraw();renderCoSummary();renderStore();$("#coErr").hidden=true}return}
  if(e.target.closest("[data-bsskip]")){S.ship=null;S.bsSkip=true;bsDraw();renderCoSummary();renderStore()}});
function renderCoSummary(){
  const q=quote(S),counts=countItems(S.box);
  $("#summary").innerHTML=`<div><span>Box of ${S.size}</span><span class="num">${money(q.base)}</span></div>`+
    Object.entries(counts).map(([id,n])=>{const p=prod(id);return `<div class="m"><span>${n} × ${esc(p.name)}</span><span>${p.surcharge>0?"+"+money(p.surcharge*n):""}</span></div>`}).join("")+
    (q.sale?`<div class="sl"><span>${esc(q.sale.name)} (${saleOffText(q.sale)})</span><span class="num">−${money(q.discount)}</span></div>`:"")+
    giftLines(S.size).map(t=>`<div class="sl"><span>${esc(t)}</span><span class="num">${fbHTML("Gift")}</span></div>`).join("")+
    (PG.info?`<div class="sl"><span>🎁 ${(()=>{const nm=(PG.info.items||[]).map(g=>g&&g.name).filter(Boolean).join(", ");return nm&&PG.info.mode!=="surprise"?"Free reward: <b>"+esc(nm)+"</b>":esc(PG.info.title||"Free Gift Set")})()} · ${esc(PG.code)}</span><span class="num">${fbHTML("Gift")}</span></div>`:"")+
    (q.coupon&&q.couponDisc>0?`<div class="sl"><span>Coupon ${esc(q.coupon.code)}</span><span class="num">−${money(q.couponDisc)}</span></div>`:"")+
    S.addons.map(id=>{const a=DB.addons.find(x=>x.id===id);return a?`<div><span class="withlv">${lvAddon(a,22,true)}${esc(a.name)}</span><span class="num">${addonPr(a)}</span></div>`:""}).join("")+
    `<div><span>${OPT_NAME[optOf(S)]}</span><span class="num">${q.feePending?"Choose a courier below":q.feeWas?`<s class="fdwas">${money(q.feeWas)}</s> ${q.fee?`<b class="fdnow">${money(q.fee)}</b>`:fbHTML("Del")}`:q.fee?money(q.fee):fbHTML("Del")}</span></div>`+
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
/* --- "Become an affiliator" now lives on its own page: /join (join.html). Old apply and status links come here and are sent on. --- */
const AP_KEY="delidome-affapp";
function apOpen(tok){let t=typeof tok==="string"?tok:"";if(!t){try{t=localStorage.getItem(AP_KEY)||""}catch(e){}}location.replace("join.html"+(t?"?status="+encodeURIComponent(t):""))}
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
const TIER_TIP={all:"All flavors",prem:"✨ Special flavors only · Fill & Shuffle use these too",reg:"No extra charge · Fill & Shuffle use these too"};
function tierTip(seg,btn,text){seg.querySelectorAll(".tiertip").forEach(x=>x.remove());clearTimeout(tierTip.t);
  const t=document.createElement("span");t.className="tiertip";t.setAttribute("role","status");t.textContent=text;seg.appendChild(t);
  const sr=seg.getBoundingClientRect(),br=btn.getBoundingClientRect(),tw=t.offsetWidth,bc=br.left+br.width/2-sr.left,left=Math.max(0,Math.min(sr.width-tw,bc-tw/2));
  t.style.left=left+"px";t.style.setProperty("--ax",(bc-left)+"px");
  tierTip.t=setTimeout(()=>{t.classList.add("out");setTimeout(()=>t.remove(),250)},2200)}
$("#menuGrid").addEventListener("click",e=>{if(e.target.closest("[data-tierall]")){shopTier="all";renderMenu();renderStore()}});
$("#tierSeg").addEventListener("click",e=>{const b=e.target.closest("[data-tier]");if(!b)return;const k=b.dataset.tier,seg=$("#tierSeg");
  if(k!=="all"&&!availProducts().some(p=>k==="prem"?p.surcharge>0:!(p.surcharge>0))){shopTier="all";renderMenu();renderStore();tierTip(seg,seg.querySelector('[data-tier="all"]'),k==="prem"?"No premium flavors left today":"No no-extra-cost flavors left today");return}
  if(k===shopTier)return;seg.querySelectorAll(".tiertip").forEach(x=>x.remove());shopTier=k;renderMenu();renderStore();
  if(!TIER_SEEN.has(k)){TIER_SEEN.add(k);tierTip(seg,seg.querySelector(`[data-tier="${k}"]`),TIER_TIP[k])}});
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
$("#slots").addEventListener("keydown",e=>{const b=e.target.closest("[data-slot]");if(b&&!S.closed&&(e.key==="Delete"||e.key==="Backspace")){e.preventDefault();clearSlotArm();removeAt(+b.dataset.slot)}});
$("#fillRest").addEventListener("click",fillRest);
// Shuffle (full box) and Clear box need a second tap within 1.5 s, so a stray tap can't undo a box
let armBtn={el:null,t:0,timer:0};
function disarmBtn(){clearTimeout(armBtn.timer);if(armBtn.el){armBtn.el.classList.remove("armed2");armBtn.el.querySelectorAll(".armtip").forEach(x=>x.remove())}armBtn.el=null}
function dblTap(el,msg,fn){const now=Date.now();if(armBtn.el===el&&now-armBtn.t<=1500){disarmBtn();fn();return}
  disarmBtn();armBtn={el,t:now,timer:setTimeout(disarmBtn,1500)};el.classList.add("armed2");const tip=document.createElement("span");tip.className="armtip";tip.setAttribute("role","status");tip.textContent=msg;el.appendChild(tip)}
function closedTip(el){disarmBtn();armBtn={el,t:0,timer:setTimeout(disarmBtn,1600)};const tip=document.createElement("span");tip.className="armtip";tip.setAttribute("role","status");tip.textContent="Box is closed. Open it first";el.appendChild(tip);if(!RM)shake(el)}
$("#randBtn").addEventListener("click",()=>{if(S.closed&&full()){closedTip($("#randBtn"));return}if(!full()){disarmBtn();guardBox("shuf",randomFill);return}dblTap($("#randBtn"),"Tap again to shuffle",()=>guardBox("shuf",randomFill))});
$("#barRand").addEventListener("click",()=>{if(S.closed&&full()){closedTip($("#barRand"));return}const go=()=>guardBox("shuf",()=>{randomFill();if(DB.settings.rbScroll!==false)setTimeout(showMyBox,260)});if(!full()){disarmBtn();go();return}dblTap($("#barRand"),"Tap again to shuffle",go)});
$("#clearBtn").addEventListener("click",()=>{if(S.closed&&full()){closedTip($("#clearBtn"));return}if(!boxN())return;dblTap($("#clearBtn"),"Tap again to clear",()=>guardBox("clear",clearBox))});
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
setInterval(()=>{try{if(S.speed==="sameday"&&S.mode!=="pickup"){sdWatch();if(S.time&&sdSlotsOn()&&sdTooSoon(S.time)){fixWhen();renderStore()}}}catch(e){}},20000);
$("#times").addEventListener("click",e=>{const b=e.target.closest("[data-time]");if(b){S.time=b.dataset.time;renderStore();guideExtras()}});
$("#extras").addEventListener("click",e=>{
  if(e.target.closest("[data-noextra]")){S.addons=[];S.extrasDone=true;S.extraTip=false;renderStore();guideCourier();return}
  const b=e.target.closest("[data-addon]");if(!b)return;const id=b.dataset.addon;S.extrasDone=false;S.extraTip=false;const was=noteNeeded();
  S.addons=S.addons.includes(id)?S.addons.filter(x=>x!==id):[...S.addons,id];renderStore();
  if(!was&&noteNeeded()&&!S.note.trim())setTimeout(()=>{scrollToEl($("#giftNote").closest(".block"));$("#giftNote").focus({preventScroll:true})},120);if(!RM&&S.addons.includes(id))bump(b.querySelector(".tick"))});
$("#giftNote").addEventListener("input",e=>{S.note=e.target.value;saveCart()});
$("#giftNote").addEventListener("input",extraGuideUI);
document.addEventListener("click",e=>{if(e.target.closest("[data-extradone]")){S.extrasDone=true;S.extraTip=false;guideCourier()}});
$("#coPhone").addEventListener("change",()=>{if(normPhone($("#coPhone").value).length>=9&&tsOn("whatsapp"))tsPass("whatsapp").catch(()=>{})});
$("#coForm").addEventListener("input",saveCust);$("#coForm").addEventListener("change",saveCust);
$("#panelCta").addEventListener("click",e=>cta(e.currentTarget.dataset.go));
$("#barCta").addEventListener("click",e=>cta(e.currentTarget.dataset.go));
// affiliators sign in on the shop address: /#partner
addEventListener("hashchange",()=>{if(location.hash==="#partner"&&SBH.partner)SBH.partner()});
if(location.hash==="#partner")setTimeout(()=>{if(SBH.partner)SBH.partner()},0);
$("#pillBtn").addEventListener("click",()=>{const b=$("#pillBtn");b.classList.add("tapped");clearTimeout(b._t);b._t=setTimeout(()=>b.classList.remove("tapped"),1400);scrollToEl($("#build"))});
$("#closeSheet").addEventListener("click",closeSheet);
$("#sheet").addEventListener("click",e=>{if(e.target.id==="sheet")closeSheet()});
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(!$("#sheet").hidden)closeSheet();closeReviews();closeMO()});
$("#moSheet").addEventListener("input",e=>{if(e.target.id==="moMail"){const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v}});
$("#coPhone").addEventListener("input",e=>{const v=e.target.value.replace(/\D/g,"");if(v!==e.target.value)e.target.value=v});
$("#coForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!$("#extrasBlock").hidden&&!S.extrasDone&&!S.addons.length&&!S.editId){S.extraTip=true;renderStore();scrollToEl($("#extrasBlock"));toast("Please choose an extra, or No extras");return}
  if(noteNeeded()&&!S.note.trim()){renderStore();scrollToEl($("#giftNote").closest(".block"));toast("Please write your gift note");return}
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
  if(S.mode!=="pickup"&&S.speed==="sameday"&&!S.sdLate&&!samedayOpen()&&samedayLate()){openSdPop();return}
  const notify=(document.querySelector('input[name="coNotify"]:checked')||{value:"both"}).value;
  const cust={name:$("#coName").value.trim(),email:$("#coEmail").value.trim(),phone:$("#coPhone").value.trim(),
    address:del?$("#coAddr").value.trim():""};
  const fields={notify,size:S.size,items:countItems(S.box),mode:S.mode,speed:S.mode==="pickup"?"pickup":S.speed,day:S.day,time:S.time,note:S.note,addons:[...S.addons],sale:q.sale?`${q.sale.name} (${saleOffText(q.sale)})`:"",
    base:q.base,discount:q.discount,coupon:q.coupon?q.coupon.code:"",couponDisc:q.couponDisc,surcharge:q.surcharge,addonsTotal:q.addons,fee:q.fee,total:q.total,customer:cust,gifts:ed&&ed.size===S.size&&ed.gifts?ed.gifts:[],giftsAt:ed&&ed.size===S.size&&ed.gifts?ed.giftsAt:undefined,...(S.mode==="delivery"&&(S.dnote||S.dphoto)?{place:{note:String(S.dnote||"").slice(0,200),photo:!!S.dphoto,img:S.dphoto||"",at:Date.now()}}:{})};
  if(SBH.on){
    const btn=f.querySelector("button[type=submit]");if(btn)btn.disabled=true;
    const pNote=S.mode==="delivery"&&placeOn("dnoteOn")?String(S.dnote||"").trim():"",pImg=S.mode==="delivery"&&placeOn("dphotoOn")?S.dphoto:"";
    tsPass("whatsapp").then(pp=>{window.__tsPass=pp||undefined;return SBH.place({notify,sdLate:S.mode!=="pickup"&&S.speed==="sameday"&&!samedayOpen()?true:undefined,shuffled:!!S.shuf,size:S.size,items:fields.items,mode:S.mode,speed:S.speed,day:S.day,time:S.time,note:S.note,addons:[...S.addons],coupon:fields.coupon,preCode:!ed&&PG.code?PG.code:undefined,expectTotal:q.total,customer:cust,ship:q.ship||undefined},ed)}).then(o=>{
      if(o&&o.preGift)pgForget(true);else if(o&&o._preErr)setTimeout(()=>toast("Your gift code was not added: "+o._preErr),900);
      if(pNote||pImg)SBH.placeInfo(o.id,pNote,pImg).catch(err=>toast("Order placed, but the driver note or photo didn't save: "+err.message));
      addMine(o.id);S.editId=null;saveCart();renderDone(o,!!ed);
      S=fresh();$("#coForm").reset();saveCart();sanitizeCart();renderStoreStatic();renderStore();renderEditBar();renderBag();
    }).catch(err=>{if(err.message==="BANNED"){$("#coErr").hidden=true;banShow()}else{$("#coErr").textContent=err.message;$("#coErr").hidden=false}SBH.loadShop(true)}).finally(()=>{window.__tsPass=undefined;if(btn)btn.disabled=false});
    return}
  let o;
  if(ed){releaseHold(ed);Object.assign(ed,fields,{editedAt:Date.now()});o=ed;takeHold(o)}
  else{o={id:uid(),code:newCode(),tracked:true,holds:false,createdAt:Date.now(),expiresAt:payDeadlineMs(fields),status:"awaiting",...fields};DB.orders.unshift(o);takeHold(o)
    if(PG.code){const x=(DB.preRegs||[]).find(z=>z.code===PG.code&&!z.used),I=PG.info||{};if(x&&normPhone(x.phone)===normPhone(o.customer.phone)){const its=I.items||[];x.used=o.code;o.preGift={code:x.code,title:I.title,mode:I.mode,items:I.mode==="surprise"&&its.length>1?[its[Math.floor(Math.random()*its.length)]]:its,pool:its.length,at:Date.now()};pgForget()}}}
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
  DKS.done=o.id;$("#donePM").innerHTML=dkChoice(o)+`<div class="dkhide${dkAuto(o)?" dkoff":""}">${payMethodsHTML()}</div>`;$("#donePay").hidden=dkAuto(o);
  $("#donePay").textContent=T.payBtn;$("#doneClose").textContent=T.trackBtn;$("#newBox").textContent=T.buildBtn;
  $("#checkoutView").hidden=true;$("#doneView").hidden=false;
  if(preview){const sv=$("#storeView");sv.hidden=false;sv.classList.add("th-only");$("#sheet").hidden=false;document.body.style.overflow="hidden"}
  dnBurst();
}
const doneGo=()=>{const id=$("#doneView").dataset.id;closeSheet();if(id)openMO(id)};
function endPreview(){const sv=$("#storeView");if(sv.classList.contains("th-only")){sv.classList.remove("th-only");sv.hidden=true}}
/* the magic gift box in the "proof sent" pop-up: it shakes, opens, and shows the gifts the order earned */
/* the blind box art: the owner's own picture/GIF/video link, or the drawn red box; it shakes the way the owner chose */
function bbCfg(){return Object.assign({name:"Blind box",img:"",fx:"wiggle",speed:100,size:120,tip:"Tap the box to open it!"},(DB.page&&DB.page.bb)||{})}
function bbName(){return String(bbCfg().name||"").trim()||"Blind box"}
function bbOpened(k){try{return !!JSON.parse(localStorage.getItem("delidome-bbopen")||"{}")[k]}catch(e){return false}}
function bbMark(k){try{const o=JSON.parse(localStorage.getItem("delidome-bbopen")||"{}");o[k]=1;const ks=Object.keys(o);if(ks.length>300)delete o[ks[0]];localStorage.setItem("delidome-bbopen",JSON.stringify(o))}catch(e){}}
function bbBoxHTML(id,small){const b=bbCfg(),fx=["wiggle","shake","bounce","pulse","float","none"].includes(b.fx)?b.fx:"wiggle",sp=Math.max(40,Math.min(250,+b.speed||100)),w=Math.max(70,Math.min(220,+b.size||120)),img=safeMedia(b.img),tag=small?"span":"button";
  const art=img?(mqIsVideo(img)?`<video src="${esc(img)}" autoplay loop muted playsinline></video>`:`<img src="${esc(img)}" alt="">`):`<i class="gm-glow"></i><i class="gm-body"></i><i class="gm-lid"></i><i class="gm-bow">🎀</i>`;
  return `<${tag} class="gm-box${img?" gm-cust":""} bbfx-${fx}${small?" bbsm":""}" ${small?"":`type="button" id="${id||"gmBox"}" aria-label="Open your ${esc(bbName())}"`} style="--bbd:${(100/sp).toFixed(2)}s;--bbw:${small?64:w}px">${art}</${tag}>`}
function bbCardHTML(key){return `<button class="bbcard" type="button" data-bbopen="${esc(key)}">${bbBoxHTML("",true)}<span><b>Tap to open your ${esc(bbName())}</b><small>${esc(bbCfg().tip)}</small></span></button>`}
function gmHTML(gl,oid){
  const rnd=gl.some(g=>g.random),b=bbCfg();
  return `<div class="gmagic" id="gmagic" data-open="0" data-oid="${esc(oid||"")}">${bbBoxHTML("gmBox")}
    <p class="gm-t" id="gmT">${esc(rnd?b.tip:"Your free gift is ready! Tap the box 🎁")}</p>
    <div class="gm-gifts" id="gmGifts" hidden><p class="gm-h">${rnd?"Your "+esc(bbName())+" had:":"Your free gift:"}</p><div class="gl big">${gl.map(g=>giftCard(g)).join("")}</div><p class="gm-n">Confirmed once we verify your payment. ${GIFT_NOTE}</p></div></div>`;
}
function gmConfetti(host){
  const cols=["#FFD43B","#FF6B8B","#4DD0E1","#9CCC65","#FFFFFF","#FF9F43"];
  for(let i=0;i<34;i++){const c=document.createElement("i");c.className="gm-c";const a=Math.random()*Math.PI*2,d=70+Math.random()*130;
    c.style.cssText=`--dx:${Math.cos(a)*d}px;--dy:${Math.sin(a)*d-40}px;--r:${Math.random()*720-360}deg;background:${cols[i%cols.length]};animation-delay:${Math.random()*120}ms`;host.appendChild(c)}
  setTimeout(()=>host.querySelectorAll(".gm-c").forEach(c=>c.remove()),1800);
}
let gmTimer=null;
function gmOpen(){
  const m=$("#gmagic");if(!m||m.dataset.open==="1")return;m.dataset.open="1";clearTimeout(gmTimer);if(m.dataset.oid)bbMark(m.dataset.oid);
  const still=matchMedia("(prefers-reduced-motion:reduce)").matches;
  m.classList.add(still?"opened":"opening");
  const done=()=>{m.classList.remove("opening");m.classList.add("opened");$("#gmGifts").hidden=false;$("#gmT").hidden=true;gmConfetti(m)};
  if(still)done();else setTimeout(done,950);
}
document.addEventListener("click",e=>{if(e.target.closest("#gmBox"))gmOpen()});
document.addEventListener("click",e=>{const b=e.target.closest("[data-bbopen]");if(!b)return;const [id,w]=b.dataset.bbopen.split("|"),o=DB.orders.find(x=>x.id===id);if(!o)return;
  const gl=w==="p"?(o.preGift&&o.preGift.items||[]).map(g=>({...g,random:true})):(o.gifts||[]).filter(g=>g.random);if(!gl.length)return;
  rvPop(`<div class="rvbox rvt-win" style="--rpbg:#fff;--rpink:#0B0B45;--rpacc:#000096"><div class="rvin">${gmHTML(gl,b.dataset.bbopen)}<button class="rvb rvb2" type="button" data-rvclose>Close</button></div></div>`);setTimeout(gmOpen,250)});
function ppShow(o,preview){
  const P=DB.proofpop,pgi=!preview&&o.preGift&&o.preGift.mode==="surprise"&&o.preGift.drawn&&(o.preGift.items||[]).length?o.preGift.items.map(g=>({...g,random:true})):[],gl=!preview&&((o.gifts&&o.gifts.length)||pgi.length)?[...(o.gifts||[]),...pgi]:null;if(!P.on&&!preview&&!gl)return false;
  const pop=$("#ppPop");
  pop.style.setProperty("--pp-bg",P.bg);pop.style.setProperty("--pp-acc",P.accent);pop.style.setProperty("--pp-ink",P.ink);
  $("#ppCard").innerHTML=`${P.emoji?`<div class="pp-emoji" aria-hidden="true">${esc(P.emoji)}</div>`:""}${P.img?`<img class="pp-img" src="${esc(P.img)}" alt="">`:""}<h3>${esc(P.on||preview?thFill(P.title,o):"Payment proof sent")}</h3><p>${esc(P.on||preview?thFill(P.text,o):"We'll confirm your payment soon.")}</p>${gl?gmHTML(gl,o.id+"|g"):""}<button class="btn" type="button" data-ppclose>${esc(P.on||preview?P.btn:"Close")}</button>`;
  if(preview){const sv=$("#storeView");sv.hidden=false;sv.classList.add("th-only")}
  pop.hidden=false;fxBurst($("#ppFx"),P,DB.thanks.cookies);
  setTimeout(()=>{const b=$("#ppCard [data-ppclose]");b&&b.focus()},60);
  return true;
}
/* --- a banned customer sees the owner's own message (icon, picture, falling gifts, text, contact button) --- */
const BANM_DEF={icon:"🚫",title:"We can't take this order",text:"Sorry, we are not able to take orders from this number or email right now. Please contact us and we will be happy to help.",img:"",fx:true,items:[],amount:24,btn:"Chat with us",btnOn:true};
let BANM=null;
function banContact(){const s=((DB.page&&DB.page.footer&&DB.page.footer.socials)||[]).find(x=>x.kind==="whatsapp"&&socialUrl(x.url,x.kind));return s?socialUrl(s.url,s.kind):""}
function banHTML(M,link){return `${M.icon?`<div class="pp-emoji" aria-hidden="true">${esc(M.icon)}</div>`:""}${M.img&&imgOk(M.img)?`<img class="pp-img" src="${esc(M.img)}" alt="">`:""}<h3>${esc(M.title)}</h3><p>${esc(M.text)}</p>${link&&M.btnOn&&M.btn?`<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${esc(M.btn)}</a>`:""}<button class="ghost" type="button" data-ppclose>Close</button>`}
async function banShow(preview){
  let M=preview||BANM;
  if(!M){try{M=Object.assign({},BANM_DEF,await SBH.banMsg())}catch(e){M=BANM_DEF}BANM=M}
  const pop=$("#ppPop"),P=DB.proofpop||{};
  pop.style.setProperty("--pp-bg",P.bg||"#fff");pop.style.setProperty("--pp-acc",P.accent||"#000096");pop.style.setProperty("--pp-ink",P.ink||"#0B0B45");
  $("#ppCard").innerHTML=banHTML(M,banContact());pop.hidden=false;
  fxBurst($("#ppFx"),{fx:M.fx!==false,cookies:Array.isArray(M.items)?M.items:[],amount:M.amount},null);
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
/* review rewards: a reminder (card in the page, blinking star in the top bar, bell line) for delivered orders that still wait for a review, and the pop-up with the result */
const RV_FX={confetti:["🎉","✨","🎊","⭐"],hearts:["💖","💛","✨"],cookies:["🍪","✨","🍪"],rain:["💧","🌧️","💧"],sparkle:["✨","⭐","✨"],none:[]},RVX="rvfx-shine rvfx-pulse rvfx-glow rvfx-bounce rvfx-none";
const rvOn=()=>!!(SBH.on&&DB.revrew&&DB.revrew.on);
function rvOrders(){if(!rvOn())return [];const R=DB.revrew,now=Date.now(),win=(+R.days||7)*864e5;
  const a=mineOrders().filter(o=>o.status==="completed"&&!o.rv&&(+o.size||0)>=(+R.minBox||6)&&(+o.completedAt||+o.updatedAt||0)+win>now&&Object.keys(o.items||{}).some(pid=>prod(pid)));
  // a drawn blind box that was never opened stays as a reminder (14 days)
  const w=mineOrders().filter(o=>o.rv&&o.rv.st&&!bbOpened("rv|"+o.id)&&(+o.rv.at||0)+14*864e5>now);return a.concat(w)}
function rvRender(){const card=$("#rvCard"),star=$("#rvStar");if(!card||!star)return;const R=DB.revrew,b=R.bn||{},list=rvOrders(),o=list[0];
  card.hidden=!(o&&b.card!==false);star.hidden=!(o&&b.star!==false);
  if(!o){const t=$("#rvTip");if(t)t.hidden=true;return}
  const fx=["shine","pulse","glow","bounce","none"].includes(b.fx)?b.fx:"shine";
  if(!card.hidden){card.className="rvc rvfx-"+fx;card.style.setProperty("--rbg",hexOk(b.bg,"#FFF4D6"));card.style.setProperty("--rink",hexOk(b.ink,"#0B0B45"));card.style.setProperty("--rline",hexOk(b.line,"#FFD166"));card.dataset.rvgo=o.id;
    card.innerHTML=o.rv?`<span class="rvst" aria-hidden="true">📦</span><b>${esc("Your "+bbName()+" is waiting!")}</b><small>${esc(bbCfg().tip)}${list.length>1?` · ${list.length} orders`:""}</small>`
      :`<span class="rvst" aria-hidden="true">★★★★★</span><b>${esc(String(b.title||"").replace(/\{code\}/g,"#"+o.code))}</b><small>${esc(b.sub||"")}${list.length>1?` · ${list.length} orders`:""}</small>${rvCd(o)}`}
  if(!star.hidden){const wt=!!o.rv,ic=wt?String(b.waitIcon||"📦").trim().slice(0,2)||"📦":String(b.icon||"⭐").trim().slice(0,2)||"⭐",im=wt?(safeMedia(b.waitImg)||safeMedia(bbCfg().img)):safeMedia(b.starImg),fxk=wt?b.waitFx:b.starFx,sfx=["blink","shake","bounce","pulse","float","glow","none"].includes(fxk)?fxk:wt?"shake":"blink";
    star.className="bagbtn rvstar rvsfx-"+sfx;star.style.setProperty("--rvsd",(100/Math.max(40,Math.min(250,+(wt?b.waitSpeed:b.starSpeed)||100))).toFixed(2));star.dataset.ic=ic;
    star.innerHTML=im?(mqIsVideo(im)?`<video src="${esc(im)}" autoplay loop muted playsinline></video>`:`<img src="${esc(im)}" alt="">`):esc(ic);star.dataset.rvgo=o.id;star.setAttribute("aria-label",String(b.tip||"Rate your order"))}
  let seen={};try{seen=JSON.parse(localStorage.getItem("delidome-rvtip")||"{}")}catch(e){}
  if(b.tipOn!==false&&!star.hidden&&!seen[o.id]&&!RVT.t){RVT.t=setTimeout(()=>{RVT.t=0;const t=$("#rvTip"),s2=$("#rvStar");if(!t||!s2||s2.hidden||!$("#moSheet").hidden)return;
    t.innerHTML="<b>"+esc(s2.dataset.ic||"⭐")+" "+esc(String(DB.revrew.bn.tipTitle||"Review time"))+"</b><span>"+esc(String(DB.revrew.bn.tip||""))+"</span>";t.hidden=false;
    const br=s2.getBoundingClientRect(),tr=t.getBoundingClientRect();t.style.setProperty("--ar",Math.max(10,Math.round(tr.right-(br.left+br.width/2)-6))+"px");
    seen[o.id]=1;try{localStorage.setItem("delidome-rvtip",JSON.stringify(seen))}catch(e){}setTimeout(()=>{t.hidden=true},9000)},4200)}}
const RVT={t:0};
const rvEnd=o=>(+o.completedAt||+o.updatedAt||0)+(+DB.revrew.days||7)*864e5;
const rvTime=ms=>{const m=Math.max(0,Math.floor(ms/6e4)),d=Math.floor(m/1440),h=Math.floor(m%1440/60);return d?d+"d "+h+"h":h?h+"h "+String(m%60).padStart(2,"0")+"m":m+"m"};
const rvHot=o=>!o.rv&&rvEnd(o)-Date.now()<=(+DB.revrew.bn.cdHot||24)*36e5;
const rvCd=o=>{const b=DB.revrew.bn||{};return !o.rv&&rvOn()&&b.cd!==false?`<span class="rvcd${rvHot(o)?" rvhot":""}" data-rvend="${rvEnd(o)}">⏰ ${esc(String(b.cdText||"Review ends in {time}").replace(/\{time\}/g,rvTime(rvEnd(o)-Date.now())))}</span>`:""};
// morning, afternoon and night: the arm tip comes back once in each while the deadline is close
function rvSlotTip(){const l=rvOrders().filter(rvHot),o=l[0],b=DB.revrew.bn||{},t=$("#rvTip"),st=$("#rvStar");if(!o||b.cd===false||b.tipOn===false||!t||!st||st.hidden||!$("#moSheet").hidden||!$("#rvPop").hidden)return;
  const h=new Date().getHours(),sl=h<12?"m":h<17?"a":"n",k=o.id+"|"+new Date().toDateString()+"|"+sl;let seen={};try{seen=JSON.parse(localStorage.getItem("delidome-rvtip2")||"{}")}catch(e){}
  if(seen[k])return;seen[k]=1;for(const x in seen)if(x.split("|")[1]!==new Date().toDateString())delete seen[x];try{localStorage.setItem("delidome-rvtip2",JSON.stringify(seen))}catch(e){}
  t.innerHTML="<b>⏰ "+esc(String(b.tipTitle||"Review time"))+"</b><span>"+esc(String(b.cdTip||"Last chance! Review ends in {time}").replace(/\{time\}/g,rvTime(rvEnd(o)-Date.now())))+"</span>";t.hidden=false;setTimeout(()=>{t.hidden=true},9000)}
function rvTick(){if(!DB||!DB.revrew)return;const now=Date.now(),hot=(+DB.revrew.bn.cdHot||24)*36e5,tx=String(DB.revrew.bn.cdText||"Review ends in {time}");let any=false;
  document.querySelectorAll("[data-rvend]").forEach(e=>{const l=+e.dataset.rvend-now,own=e.dataset.rvtx;any=true;if(l<=0){rvRender();renderBell();return}e.textContent="⏰ "+(own||tx).replace(/\{time\}/g,rvTime(l));e.classList.toggle("rvhot",l<=(own?(+((DB.revrew.rem||{}).hot)||24)*36e5:hot))});
  const o=rvOrders()[0],h=!!(o&&!o.rv&&rvOn()&&DB.revrew.bn.cd!==false&&rvEnd(o)-now<=hot);const st=$("#rvStar"),cd=$("#rvCard");if(st)st.classList.toggle("rvhot",h);if(cd)cd.classList.toggle("rvhot",h);
  if(!(Math.floor(now/1000)%60)){rvSlotTip();rvRemTip()}}
document.addEventListener("click",e=>{const b=e.target.closest("[data-rvgo]");if(!b)return;e.preventDefault();const t=$("#rvTip");if(t)t.hidden=true;try{closeBell()}catch(x){}const og=DB.orders.find(x=>x.id===b.dataset.rvgo);if(og&&og.rv){rvReveal(og,og.rv);return}openMO(b.dataset.rvgo);setTimeout(()=>{const r=$("#moCard .rstars");r&&r.scrollIntoView({block:"center"})},120)});
const rvFill=(t,d)=>String(t||"").replace(/\{reward\}/g,(d&&d.item&&d.item.name)||"").replace(/\{code\}/g,(d&&d.code)||"");
const rvFree=p=>PG.info&&PG.code&&(PG.info.items||[]).some(g=>g&&g.pid===p.id)?`<span class="rvfree">🎁 your free reward</span>`:"";
/* reminders for every reward the customer holds and has not claimed: a bell line each day, and 3 times a day (morning, afternoon, night) with a blinking countdown in the last hours */
const RVC_KEY="delidome-rvcoup";let RVC=[];try{RVC=JSON.parse(localStorage.getItem(RVC_KEY)||"[]").filter(x=>x&&typeof x.code==="string").slice(0,20)}catch(e){}
const rvcSave=()=>{try{localStorage.setItem(RVC_KEY,JSON.stringify(RVC))}catch(e){}};
function rvcAdd(rv){if(!rv||rv.kind!=="coupon"||!rv.code||RVC.some(x=>x.code===rv.code))return;RVC.push({code:rv.code,name:(rv.item&&rv.item.name)||rv.code,exp:rv.exp||null,at:Date.now()});rvcSave()}
function rvRemList(){const rm=(DB.revrew||{}).rem||{};if(!DB.revrew||rm.on===false)return [];const now=Date.now();
  const used=new Set(mineOrders().filter(o=>o.status!=="cancelled").map(o=>String(o.coupon||"").toUpperCase()));
  const g=RVW.list.map(x=>({code:x.code,name:((x.info||{}).items||[]).map(i=>i&&i.name).filter(Boolean).join(", ")||"Reward",exp:x.exp,kind:"gift"}));
  const c=RVC.filter(x=>!used.has(String(x.code).toUpperCase())).map(x=>({code:x.code,name:x.name,exp:x.exp,kind:"coupon"}));
  return g.concat(c).filter(x=>!x.exp||x.exp>now)}
const rvRemHot=x=>!!x.exp&&x.exp-Date.now()<=(+((DB.revrew.rem||{}).hot)||24)*36e5;
function rvRemAt(x){const d=new Date(),h=d.getHours();if(!rvRemHot(x)){d.setHours(0,0,0,0);return d.getTime()}d.setHours(h<12?6:h<17?12:17,0,0,0);return Math.min(d.getTime(),Date.now())}
const rvRemFill=(t,x)=>String(t||"").replace(/\{name\}/g,x.name).replace(/\{time\}/g,x.exp?rvTime(x.exp-Date.now()):"");
function rvRemCd(x){const rm=DB.revrew.rem||{};return x.exp?`<span class="rvcd${rvRemHot(x)?" rvhot":""}" data-rvend="${x.exp}" data-rvtx="${esc(rm.cd||"Expires in {time}")}">⏰ ${esc(rvRemFill(rm.cd||"Expires in {time}",x))}</span>`:""}
function rvRemBell(items){if(typeof BELLF!=="undefined"&&BELLF==="deals")return;const rm=DB.revrew.rem||{};rvRemList().forEach(x=>{const at=rvRemAt(x);
  items.push({at,h:`<button class="bell-it${at>SEENV?" new":""}" type="button" data-rvclaim="${esc(x.code)}" data-rvk="${x.kind}"><span class="bell-ic" aria-hidden="true">${x.kind==="coupon"?"🎟️":"🎁"}</span><span class="bell-tx"><small>${esc(rvRemFill(rm.text||"Unclaimed reward: {name}",x))}</small><b>${rvRemCd(x)||esc(x.name)}</b></span><span class="bell-ch" aria-hidden="true">›</span></button>`})})}
document.addEventListener("click",e=>{const b=e.target.closest("[data-rvclaim]");if(!b)return;e.preventDefault();try{closeBell()}catch(x){}
  if(b.dataset.rvk==="coupon"){try{navigator.clipboard.writeText(b.dataset.rvclaim)}catch(x){}toast("Coupon "+b.dataset.rvclaim+" copied. Type it at checkout.")}else toast("Pick a box of "+rvwMin()+" or more to use your reward.");
  const bd=$("#build");bd&&scrollToEl(bd)});
function rvRemTip(){const rm=DB.revrew.rem||{},t=$("#rvTip");if(!t||rm.on===false||(DB.revrew.bn||{}).tipOn===false)return;if(!$("#moSheet").hidden||!$("#rvPop").hidden)return;
  const x=rvRemList().filter(rvRemHot)[0];if(!x)return;const d=new Date(),h=d.getHours(),k=x.code+"|"+d.toDateString()+"|"+(h<12?"m":h<17?"a":"n");let seen={};try{seen=JSON.parse(localStorage.getItem("delidome-rvtip3")||"{}")}catch(e){}
  if(seen[k])return;for(const y in seen)if(y.split("|")[1]!==d.toDateString())delete seen[y];seen[k]=1;try{localStorage.setItem("delidome-rvtip3",JSON.stringify(seen))}catch(e){}
  t.innerHTML="<b>⏰ "+esc(String((DB.revrew.bn||{}).tipTitle||"Reward"))+"</b><span>"+esc(rvRemFill(rm.tip||"Last chance! Your reward {name} expires in {time}",x))+"</span>";t.hidden=false;setTimeout(()=>{t.hidden=true},9000)}
function rvPop(html){const p=$("#rvPop");if(p.parentNode!==document.body)document.body.appendChild(p);p.innerHTML=html;p.hidden=false;document.body.style.overflow="hidden"}
function rvClose(){const p=$("#rvPop");p.hidden=true;p.innerHTML="";if(!$("#moSheet").hidden){try{renderMO()}catch(e){}}if($("#moSheet").hidden&&$("#sheet").hidden)document.body.style.overflow=""}
function rvReveal(o,rv){const b=bbCfg();rvPop(`<div class="rvbox rvt-win" style="--rpbg:#fff;--rpink:#0B0B45;--rpacc:#000096"><div class="rvin gmagic">${bbBoxHTML("rvBbBox")}<h2>${esc(bbName())}</h2><p>${esc(b.tip)}</p></div></div>`);RVR.o=o;RVR.rv=rv}
const RVR={o:null,rv:null};
document.addEventListener("click",e=>{const x=e.target.closest("#rvBbBox");if(!x||x.dataset.go)return;x.dataset.go="1";x.classList.add("bbopening");setTimeout(()=>{if(RVR.rv)rvOutcome(RVR.rv,RVR.o)},720)});
function rvOutcome(rv,o,pv){if(!pv&&o)bbMark("rv|"+o.id);if(!pv&&rv.st==="win"&&rv.kind==="coupon")rvcAdd(rv);const R=DB.revrew,k=rv.st==="win"?"win":rv.st==="sad"?"sad":"none",m=R[k]||{},img=safeMedia(m.img),fx=RV_FX[m.fx]||[];
  const it=rv.item||{},iimg=k==="win"?safeMedia(it.img):"",coup=k==="win"&&rv.kind==="coupon";
  const rp=k==="win"&&!coup&&it.pid&&prod(it.pid);
  const art=rp?`<div class="rvplate">${plateHTML(rp)}</div>`:coup?`<div class="rvtk"><span>🎟️</span><b>${esc(it.name||"Coupon")}</b></div>`:iimg?`<img class="rvimg rvdrew" src="${esc(iimg)}" alt="">`:img?`<img class="rvimg" src="${esc(img)}" alt="">`:`<div class="rvic" aria-hidden="true">${esc(String((k==="win"&&it.icon)||m.icon||"🎁").slice(0,4))}</div>`;
  let body=`<h2>${esc(rvFill(m.title,rv))}</h2><p>${esc(rvFill(m.text,rv)).replace(/\n/g,"<br>")}</p>`;
  if(k==="win"){body+=`<div class="rvcode" data-notr>${esc(rv.code||"")}</div><p class="rvnote">${rv.kind==="gift"?"We saved this code on this phone. It is added to your next order by itself, one reward gift per order. Valid until "+esc(fmtDT(rv.exp))+".":"Type this coupon code at checkout on your next order."+(rv.exp?" Valid until "+esc(fmtDT(rv.exp))+".":"")}</p>
    <div class="rvbtns"><button class="rvb rvb1" type="button" data-rvcopy="${esc(rv.code||"")}">📋 Copy code</button><button class="rvb rvb2" type="button" data-rvclose>${esc(m.btn||"Great!")}</button></div>`}
  else body+=`<div class="rvbtns"><button class="rvb rvb1" type="button" data-rvbuy>${esc(m.btn1||"Buy again")}</button><button class="rvb rvb2" type="button" data-rvclose>${esc(m.btn2||"Close")}</button></div>`;
  rvPop(`<div class="rvbox rvt-${k}" style="--rpbg:${hexOk(m.bg,"#FFFFFF")};--rpink:${hexOk(m.ink,"#0B0B45")};--rpacc:${hexOk(m.acc,"#000096")}">${fx.length?preRain(fx):""}<div class="rvin">${art}${body}</div></div>`);
  if(k==="win"&&rv.kind==="gift"&&rv.code&&!pv)rvwAdd(rv.code)}
function rvChoose(id,opts){const c=DB.revrew.choose||{};
  rvPop(`<div class="rvbox rvt-win" style="--rpbg:#fff;--rpink:#0B0B45;--rpacc:#000096"><div class="rvin"><div class="rvic" aria-hidden="true">🎁</div><h2>${esc(c.title||"Pick your gift")}</h2><p>${esc(c.text||"")}</p>
    <div class="rvopts">${(opts||[]).map(x=>`<button class="rvopt" type="button" data-rvpick="${esc(x.id)}" data-rvfor="${esc(id)}">${safeMedia(x.img)?`<img src="${esc(safeMedia(x.img))}" alt="">`:`<i aria-hidden="true">${x.type==="coupon"?"🎟️":"🎁"}</i>`}<b>${esc(x.name)}</b></button>`).join("")}</div></div></div>`)}
async function rvDraw(id,choice){let d;try{d=await SBH.rvClaim(id,choice||"")}catch(e){toast(e.message);return}
  const o=DB.orders.find(x=>x.id===id);
  if(d.state==="choose"){rvChoose(id,d.options);return}
  if(d.state==="done"&&d.rv){if(o)o.rv=d.rv;rvReveal(o,d.rv);rvRender();renderBell();if(!$("#moSheet").hidden)renderMO()}}
function rvAfter(id){if(!rvOn())return;const o=DB.orders.find(x=>x.id===id);if(!o||o.rv||o.status!=="completed"||(+o.size||0)<(+DB.revrew.minBox||6))return;
  const all=Object.keys(o.items||{}).filter(pid=>prod(pid)).every(pid=>(o.rated||{})[pid]);if(!all){toast("Thanks! Rate the other flavors too to see your surprise 🎁");return}
  rvDraw(id,"")}
document.addEventListener("click",e=>{const p=e.target.closest("#rvPop");if(!p)return;
  if(e.target===p||e.target.closest("[data-rvclose]")){rvClose();return}
  const cp=e.target.closest("[data-rvcopy]");if(cp){const c=cp.dataset.rvcopy;(navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(()=>toast("Code copied"),()=>toast(c));return}
  if(e.target.closest("[data-rvbuy]")){rvClose();try{closeMO()}catch(x){}scrollToEl($("#build"));return}
  const pk=e.target.closest("[data-rvpick]");if(pk){rvClose();rvDraw(pk.dataset.rvfor,pk.dataset.rvpick)}});
// orders still waiting for payment: the bell tells the customer to pay before the time runs out
const refundsNew=()=>mineOrders().filter(o=>o.refund&&o.refund.at>SEEN);
const refundList=()=>mineOrders().filter(o=>o.refund);
const payDue=()=>mineOrders().filter(o=>o.status==="awaiting"&&o.expiresAt&&o.expiresAt>Date.now());
function renderBell(){
  applyCdLook();
  try{rateNudge()}catch(e){}
  try{rvRender()}catch(e){}
  const list=notifs(),n=list.filter(x=>x.m.at>SEEN).length+activeBroadcasts().filter(x=>x.at>SEEN).length+payDue().length+refundsNew().length+rvOrders().length+rvRemList().filter(x=>rvRemAt(x)>SEEN).length,b=$("#bellCount"),btn=$("#bellBtn");
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
  if(BELLF!=="deals")rvOrders().forEach(o=>{
    items.push({at:Infinity,h:`<button class="bell-it bell-pay" type="button" data-rvgo="${o.id}"><span class="bell-ic" aria-hidden="true">${esc(String((DB.revrew.bn||{}).icon||"⭐").slice(0,2))}</span><span class="bell-tx"><small>Order #${esc(o.code)} · ${o.rv?"blind box":"review"}${rvCd(o)?" · "+rvCd(o):""}</small><b>${o.rv?esc("Your "+bbName()+" is waiting. Tap to open!"):esc(String((DB.revrew.bn||{}).tip||"Rate your order and open a blind box!"))}</b></span><span class="bell-ch" aria-hidden="true">›</span></button>`})});
  rvRemBell(items);
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
/* Cloudflare Turnstile: a quick check before the actions bots like to abuse. It returns a 10-minute pass the server checks. */
const TS={pass:{},pend:{},loading:null};
const tsCfg=()=>DB.settings.turnstile||{};
const tsOn=a=>!!(SBH.on&&tsCfg().on&&tsCfg().siteKey&&(tsCfg().where||{})[a]);
function tsLoad(){if(window.turnstile)return Promise.resolve();return TS.loading||(TS.loading=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";s.async=true;s.onload=()=>res();s.onerror=()=>{TS.loading=null;rej(new Error("The security check could not load. Please check your connection and try again."))};document.head.appendChild(s)}))}
function tsWidget(){return new Promise((res,rej)=>{let box=$("#tsBox");if(!box){box=document.createElement("div");box.id="tsBox";box.className="tsbox";document.body.appendChild(box)}
  box.innerHTML=`<div class="tscard" role="dialog" aria-modal="true"><h3>Quick security check</h3><p>Please confirm you are not a robot.</p><div id="tsW"></div><button class="ghost" type="button" data-tscancel>Cancel</button></div>`;box.hidden=false;
  const done=(f,v)=>{box.hidden=true;box.innerHTML="";f(v)};
  box.querySelector("[data-tscancel]").onclick=()=>done(rej,new Error("Security check cancelled."));
  try{window.turnstile.render("#tsW",{sitekey:String(tsCfg().siteKey),callback:t=>done(res,t),"error-callback":()=>done(rej,new Error("The security check failed. Please try again.")),"timeout-callback":()=>done(rej,new Error("The security check timed out. Please try again."))})}catch(e){done(rej,new Error("The security check could not start."))}})}
function tsPass(a){if(!tsOn(a))return Promise.resolve("");const c=TS.pass[a];if(c&&c.exp-Date.now()>60e3)return Promise.resolve(c.p);
  return TS.pend[a]||(TS.pend[a]=(async()=>{try{await tsLoad();const t=await tsWidget(),r=await SBH.tsVerify(t,a),p=String(r.pass||"");TS.pass[a]={p,exp:+(p.split(".")[0].split("|")[1])||Date.now()+9*60e3};return p}finally{delete TS.pend[a]}})())}
// run a database call with the pass in a request header
async function withPass(a,fn){const p=await tsPass(a);window.__tsPass=p||undefined;try{return await fn()}finally{window.__tsPass=undefined}}
/* DOKU online payment: the customer chooses auto confirmation (DOKU) or manual confirmation by the store */
const DKS={sel:{},done:null,busy:false};
const dkOn=()=>!!(SBH.on&&DB.settings.doku&&DB.settings.doku.on);
const dkAuto=o=>dkOn()&&(DKS.sel[o.id]||"auto")==="auto";
const dkFee=(m,t)=>m.payer==="customer"?Math.round(t*(+m.pct||0)/100+(+m.fixed||0)):0;
function dkChoice(o){if(!dkOn())return "";const D=DB.settings.doku,auto=dkAuto(o),ms=(D.methods||[]).filter(m=>m&&m.on!==false&&m.k);
  return `<div class="dkp" data-dko="${esc(o.id)}"><div class="mo-sub">How do you want to pay?</div>
    <div class="dkc"><button class="dko" type="button" data-dksel="auto" aria-pressed="${auto}"><b>⚡ Auto confirmation</b><small>Pay online with DOKU. Your order is confirmed right away.</small></button>
    <button class="dko" type="button" data-dksel="manual" aria-pressed="${!auto}"><b>🧾 Manual confirmation</b><small>Pay by transfer and send your proof. The store confirms it.</small></button></div>
    ${auto?`<div class="dkms">${ms.map(m=>{const f=dkFee(m,+o.total||0);return `<button class="dkm" type="button" data-dkgrp="${esc(m.k)}"><span><b>${esc(m.name||m.k)}</b><small>${f>0?"+ "+money(f)+" payment fee · you pay "+money((+o.total||0)+f):"No extra fee · you pay "+money(+o.total||0)}</small></span><i aria-hidden="true">›</i></button>`}).join("")||`<p class="mo-sub">No online payment method is on right now.</p>`}</div>`:""}</div>`}
function dkRefresh(id){const o=DB.orders.find(x=>x.id===id);if(!o)return;
  if(!$("#doneView").hidden&&DKS.done===id){$("#donePM").innerHTML=dkChoice(o)+`<div class="dkhide${dkAuto(o)?" dkoff":""}">${payMethodsHTML()}</div>`;$("#donePay").hidden=dkAuto(o)}
  if(!$("#moSheet").hidden)renderMO()}
document.addEventListener("click",async e=>{const sb=e.target.closest("[data-dksel]"),gb=e.target.closest("[data-dkgrp]");if(!sb&&!gb)return;const id=(e.target.closest("[data-dko]")||{dataset:{}}).dataset.dko;if(!id)return;
  if(sb){DKS.sel[id]=sb.dataset.dksel;dkRefresh(id);return}
  if(DKS.busy)return;DKS.busy=true;gb.disabled=true;try{const r=await SBH.dokuCreate(id,gb.dataset.dkgrp,await tsPass("doku"));if(r&&r.url){location.href=r.url;return}toast("Couldn't open the payment page.")}catch(er){toast(er.message||"Couldn't open the payment page.")}finally{DKS.busy=false;gb.disabled=false}});
// back from DOKU: ask DOKU once whether it was paid (the notification may take a few seconds)
function dkReturn(){const c=new URLSearchParams(location.search).get("paid");if(!c)return;const o=DB.orders.find(x=>x.code===c);try{history.replaceState(null,"",location.pathname)}catch(e){}if(!o)return;
  const chk=async n=>{try{const r=await SBH.dokuStatus(o.id);if(r&&r.paid){await SBH.loadShop(true);toast("Payment received. Thank you!");openMO(o.id);return}}catch(e){}if(n>0)setTimeout(()=>chk(n-1),4000);else{toast("We are waiting for your payment to be confirmed.");openMO(o.id)}};chk(3)}
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
  return `<div class="dsec"><h4>Rate your cookies</h4>${rvOn()&&!o.rv&&o.status==="completed"&&(+o.size||0)>=(+DB.revrew.minBox||6)&&rvEnd(o)>Date.now()&&left?`<p style="margin:0 0 8px">${rvCd(o)}</p>`:""}${rows}${left?`<p class="err" id="rtErr" hidden></p><button class="btn btn-blue btn-sm" type="button" data-rsubmit style="margin-top:8px">Send ratings</button>`:`<p class="hint" style="margin:8px 0 0">Thanks for rating!</p>`}</div>`;
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
    <div class="field"><label for="cpReason">What went wrong?</label><select id="cpReason">${COMPLAINT_REASONS.map(r=>`<option value="${r}">${r}</option>`).join("")}</select></div>
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
    ${dkChoice(o)}<div class="dkhide${dkAuto(o)?" dkoff":""}"><div><div class="mo-sub">Transfer exactly</div><div class="mo-big">${money(o.total)}</div></div>
    ${payMethodsHTML()}
    <form class="form" id="moPay" novalidate><h4 style="margin:0">Send your payment proof</h4>
      <div class="field"><label for="mpName">Full name</label><input id="mpName" value="${esc(o.customer.name)}" autocomplete="name" required placeholder="Name of the person who paid"></div>
      <div class="field"><label for="mpFile">Proof of payment (photo or screenshot)</label><input id="mpFile" type="file" accept="image/*"></div>
      <img class="proofimg" id="mpPrev" alt="Proof preview" hidden>
      <p class="err" id="mpErr" hidden></p>
      <button class="btn btn-blue" type="submit">I've paid, send proof</button></form></div></div>`:""}
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
  S.editId=id;S.size=o.size;S.box=Object.entries(o.items).flatMap(([pid,n])=>Array(n).fill(pid));S.auto=[];S.closed=true;S.mode=o.mode;S.speed=o.speed==="sameday"?"sameday":"scheduled";S.note=o.note||"";S.addons=[...o.addons];S.coupon=o.coupon||"";
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
    rateOrder(o,rt).then(()=>{MO.rate={};toast('Thanks for your rating!');renderMO();renderMenu();rvAfter(o.id)}).catch(ex=>{const er=$('#rtErr');er.textContent=ex.message;er.hidden=false})}
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
      if(SBH.on){await withPass("proof",()=>SBH.proof(o.id,name,img));renderBag();renderMO();if(!ppShow(o))toast("Proof sent. We'll confirm your payment soon.");return}
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
setInterval(()=>{try{rvTick()}catch(e){}tickCountdowns();if(Math.round(Date.now()/1000)%10===0)sweepOrders()},1000);
/* ================= pre-launch page =================
   While the owner has it on (Pre-launch tab), customers see only this page: a banner like the Top banner, a countdown to the
   opening, the free Gift Set, and a form for the first X people. Each one gets a personal gift code (made on the server). */
function defaultPre(){return {on:false,max:100,openAt:0,autoOpen:true,
  hero:Object.assign(JSON.parse(JSON.stringify(defaultPage().hero)),{eyebrow:"Pre-launch",title:"Something sweet is coming 🍪",lede:"",btn1:"🎁 Claim my gift",btn2:"🍪 Play while you wait",floats:false,shape:"rounded"}),
  text:"Be one of the first {max} to register and get a FREE Gift Set on opening day.",cdLabel:"Opening in",cdSize:"M",cdStyle:"pulse",cdBg:"#000096",cdInk:"#FFE066",
  bg:"#FFF4D6",ink:"#0B0B45",accent:"#000096",btnBg:"#C8102E",btnInk:"#ffffff",spots:true,
  form:{btn:"🎁 Claim my free Gift Set",email:true},
  gifts:{on:true,mode:"set",title:"Your Free Gift Set",items:[],fx:"float",icon:"🎁",setText:"Everything below is yours:",surText:"Your blind box holds 1 of these:",bg:"#ffffff",ink:"#0B0B45",title2:"#000096",tile:"#FFF4D6"},
  codePrefix:"GIFT-",expMode:"days",expDays:7,expAt:0,
  done:{title:"You're in, {name}!",text:"You're #{rank} of {max}. Your Free Gift Set is waiting for you on opening day.",icon:"🎁",img:"",fx:"gifts",bg:"#ffffff",ink:"#0B0B45",title2:"#000096",codeBg:"#FFF4D6",codeInk:"#000096",note:"This phone remembers it for you. Ordering from another phone? Type this code in the coupon box.",tip:"📸 Tip: take a screenshot of this page",wa:true},
  closed:{icon:"🎉",img:"",fx:"confetti",title:"All {max} Gift Sets are taken!",text:"Thank you for the amazing enthusiasm 💙 Stay tuned, more exciting events are coming soon.",btn:"Follow us on Instagram",link:"",bg:"#000096",ink:"#ffffff"},
  fx:{on:true,mode:"float",imgs:[],n:8,speed:"normal",size:"M",op:55},
  game:{on:true,pTitle:"Can you beat the Cookie Challenge?",pText:"Tap the falling cookies, grab the golden ones and dodge the flames. Climb 10 levels and win a trophy on our top 5!",pBtn:"Play now",imgs:[],gold:"",burnt:"",clock:"",sec:60,speed:"normal",tap:"crumble",bg:"#FFF4D6",end:"You scored {score} points!",cks:[],pts:100,flame:200,add:5,pGold:8,pFlame:10,pTime:4,grow:20,pass:70,max:[],share:"I scored {score} points catching cookies 🍪 Join the {shop} pre-launch: {link}"}}}
function preNorm(p){const d=defaultPre(),o=p&&typeof p==="object"?p:{},r=Object.assign({},d,o);
  ["hero","form","gifts","done","closed","fx","game"].forEach(k=>{r[k]=Object.assign({},d[k],o[k]&&typeof o[k]==="object"?o[k]:{})});
  ["items"].forEach(k=>{if(!Array.isArray(r.gifts[k]))r.gifts[k]=[]});if(!Array.isArray(r.fx.imgs))r.fx.imgs=[];if(!Array.isArray(r.game.imgs))r.game.imgs=[];["cks","max"].forEach(k=>{if(!Array.isArray(r.game[k]))r.game[k]=[]});
  // settings saved before the 10 levels: their untouched old defaults move to the new ones (1-minute round, points wording)
  const og=o.game&&typeof o.game==="object"?o.game:null;if(og&&og.pass===undefined){if(+og.sec===20)r.game.sec=60;if(og.end==="You caught {score} cookies!")r.game.end=d.game.end;if(og.share==="I caught {score} cookies 🍪 Join the {shop} pre-launch: {link}")r.game.share=d.game.share}
  if(!Array.isArray(r.hero.media))r.hero.media=[];
  r.gifts.items=r.gifts.items.filter(g=>g&&typeof g==="object");r.gifts.items.forEach((g,i)=>{if(!g.id)g.id="i"+i});return r}
const PRE_KEY="delidome-pre-v1",PRE={st:null,me:null,busy:false,err:"",t:0,poll:0};
const preForced=()=>/[?&]prelaunch\b/.test(location.search);
// the owner's preview acts like a private window: nothing is read from or saved to this phone, and nobody is registered
if(!preForced())try{PRE.me=JSON.parse(localStorage.getItem(PRE_KEY)||"null")}catch(e){}
const preNow=()=>Date.now()+((window.SBH&&SBH.skew)||0);
function preOn(){const P=DB.prelaunch;if(!P)return false;if(preForced())return true;
  if(!P.on)return false;return !(P.autoOpen!==false&&+P.openAt>0&&preNow()>=+P.openAt)}
const preFill=(t,x)=>String(t||"").replace(/\{max\}/g,(DB.prelaunch||{}).max||"").replace(/\{name\}/g,x&&x.name?String(x.name).split(" ")[0]:"").replace(/\{rank\}/g,x&&x.rank||"").replace(/\{shop\}/g,(DB.page&&DB.page.name)||"Delidome");
function preView(){let v=document.getElementById("preView");if(!v){v=document.createElement("div");v.id="preView";v.hidden=true;document.body.insertBefore(v,document.body.firstChild);
  v.addEventListener("click",preClick);v.addEventListener("submit",preSubmit)}return v}
// called at the start of renderStore: true = the pre-launch page is showing instead of the shop
function preGate(){const on=preOn(),v=preView();document.body.classList.toggle("pre-on",on);document.documentElement.style.backgroundColor=on?hexOk(DB.prelaunch.bg,"#FFF4D6"):"";
  if(!on){if(!v.hidden){v.hidden=true;v.innerHTML="";v._sig=""}return false}
  v.hidden=false;if(!PRE.st)preStatus();renderPre();return true}
async function preStatus(){if(PRE.busy)return;
  if(!SBH.on){const n=(DB.preRegs||[]).length,mx=+DB.prelaunch.max||0;PRE.st={count:n,max:mx,full:n>=mx};renderPre(true);return}
  try{PRE.st=await SBH.preStatus()}catch(e){}renderPre(true)}
function preCdHTML(P,dark){if(!(+P.openAt>0))return "";
  return `<div class="pcd pcd-${["S","M","L","XL"].includes(P.cdSize)?P.cdSize:"M"} pcs-${["still","pulse","flip","glow"].includes(P.cdStyle)?P.cdStyle:"pulse"}" data-pcd="${+P.openAt}" style="--pcb:${hexOk(P.cdBg,"#000096")};--pci:${hexOk(P.cdInk,"#FFE066")}">
    ${P.cdLabel?`<p class="pcd-l">${esc(P.cdLabel)}</p>`:""}<div class="pcd-n">${["d","h","m","s"].map((k,i)=>`<div><b data-pk="${k}">00</b><span>${["DAYS","HRS","MIN","SEC"][i]}</span></div>`).join("")}</div></div>`}
function preGiftsHTML(P){const G=P.gifts;if(!G.on||!G.items.length)return "";
  const sub=G.mode==="surprise"?G.surText:G.setText;
  return `<section class="pre-gifts" style="--gbx:${hexOk(G.bg,"#ffffff")};--gink:${hexOk(G.ink,"#0B0B45")};--gttl:${hexOk(G.title2,"#000096")};--gtile:${hexOk(G.tile,"#FFF4D6")}"><h3>${G.icon?esc(G.icon)+" ":""}${esc(G.title||"Your Free Gift Set")}</h3>${sub?`<p>${esc(sub)}</p>`:""}
    <div class="pg-grid gfx-${["float","wiggle","spin","pulse","shine","none"].includes(G.fx)?G.fx:"float"}">${G.items.map((g,i)=>`<div class="pg-it" style="--d:${(i*.35).toFixed(2)}s">${g.img?`<img src="${esc(imgOk(g.img))}" alt="">`:`<i aria-hidden="true">🎁</i>`}<span>${esc(g.name||"")}</span></div>`).join("")}</div></section>`}
/* the game, shown on the page itself: a looping mini preview, an invitation, the top 5 and a big Play button */
function preGameCardHTML(P){const G=P.game,C=pgmCks(G),art=i=>pgmArt(C[i%C.length]),own=k=>G[k]?`<img src="${esc(imgOk(G[k]))}" alt="" draggable="false">`:"";
  const ck=(cls,x,t,dl,inner)=>`<i class="pgm-ck pgp-ck ${cls}${(cls==="gold"&&G.gold)||(cls==="flame"&&G.burnt)||(cls==="time"&&G.clock)?" own":""}" style="left:${x}%;--t:${t}s;--dl:${dl}s">${inner}</i>`;
  const set=[["",8,3.6,-0.4,art(0)],["",24,4.4,-2.1,art(1)],["gold",40,4.0,-1.2,own("gold")||art(0)],["",56,3.4,-2.8,art(2)],["flame",70,4.2,-0.9,own("burnt")||art(1)],["time",84,3.8,-3.0,own("clock")||art(0)],["",92,4.8,-1.7,art(3)]];
  const bg=hexOk(G.bg,"#FFF4D6"),lv=1;
  PGM.tops===null&&pgmPageTopsLoad();
  return `<section class="pgp" style="--gbg:${bg}"><h3>🎮 ${esc(G.pTitle||"Can you beat the Cookie Challenge?")}</h3><p class="pgp-tx">${esc(G.pText||"")}</p>
    <div class="pgp-stage" aria-hidden="true"><div class="pgp-hud"><span>Lv 1</span><span>🍪 <b>12.400</b></span><span>⏱ 60s</span></div><div class="pgp-bar"><i></i></div>
      ${set.map(x=>ck(x[0],x[1],x[2],x[3],x[4])).join("")}
      <span class="pgp-pop p1">+100</span><span class="pgp-pop p2">+200 ✨</span><span class="pgp-pop p3 tm">+5s ⏰</span><span class="pgp-pop p4 cb">x2 combo!</span></div>
    <div class="pgp-chips"><span>🍪 Tap the cookies</span><span>✨ Golden = double</span><span>⏰ Clock = more time</span><span>🏆 Top 5 win a trophy</span></div>
    <div id="pgpTops">${pgmTopsHTML(PGM.lv||lv,"")}</div>
    <button class="pre-btn pre-btn-b pgp-play" type="button" data-pregame><i aria-hidden="true">▶</i> ${esc(G.pBtn||"Play now")}</button><p class="pgp-sm">Free · takes 1 minute · your phone only</p></section>`}
async function pgmPageTopsLoad(){if(PGM.tl)return;PGM.tl=true;try{PGM.tops=SBH.on&&SBH.gameTops?await SBH.gameTops():(PGM.me.tops||{});PGM.topsErr=false}catch(e){PGM.topsErr=true;PGM.tops=null}PGM.tl=false;
  const el=document.getElementById("pgpTops");if(el)el.innerHTML=pgmTopsHTML(PGM.lv||1,"")}
function preFxHTML(P){const F=P.fx;if(!F.on)return "";const imgs=F.imgs.length?F.imgs:[COOKIE_SVG],n=Math.max(2,Math.min(20,+F.n||8)),sz={S:26,M:38,L:54}[F.size]||38,sp={slow:1.6,normal:1,fast:.6}[F.speed]||1;let h="";
  for(let i=0;i<n;i++){const fall=F.mode==="fall"||(F.mode==="both"&&i%2),s=sz*(.7+Math.random()*.6);
    h+=`<i class="${fall?"pfx-fall":"pfx-float"}" style="left:${(Math.random()*94).toFixed(1)}%;${fall?"":`top:${(5+Math.random()*85).toFixed(1)}%;`}width:${s|0}px;height:${s|0}px;--t:${((fall?7:5)+Math.random()*5)*sp}s;--dl:-${(Math.random()*8).toFixed(1)}s;opacity:${Math.max(.1,Math.min(1,(+F.op||55)/100))}"><img src="${esc(F.imgs.length?imgOk(imgs[i%imgs.length]):COOKIE_SVG)}" alt=""></i>`}
  return `<div class="pre-fx" aria-hidden="true">${h}</div>`}
function renderPre(force){const v=preView();if(v.hidden)return;const P=DB.prelaunch,me=PRE.me,st=PRE.st||{},full=(!!st.full||!!PRE.pvFull)&&!me;
  const sig=JSON.stringify([P,me,st.count,st.full,PRE.pvFull,PRE.err,PRE.busy,window.DDLANG?DDLANG():""]);if(!force&&sig===v._sig)return;v._sig=sig;
  const pg=DB.page||{},lg=safeMedia(pg.logo),mark=lg?`<img src="${esc(lg)}" alt="">`:LP_DEFAULT_SVG,C=P.closed;
  v.style.cssText=`--pbg:${hexOk(P.bg,"#FFF4D6")};--pink:${hexOk(P.ink,"#0B0B45")};--pacc:${hexOk(P.accent,"#000096")};--pbtn:${hexOk(P.btnBg,"#C8102E")};--pbtnk:${hexOk(P.btnInk,"#ffffff")};--display:${lpFamily(pg.headFont,pg,"head")};--body:${lpFamily(pg.bodyFont,pg,"body")}`;
  const left=st.max?Math.max(0,st.max-(st.count||0)):null;
  const top=`<header class="pre-top"><span class="pre-mk">${mark}</span><b>${esc(pg.name||"delidome")}</b>${window.DDlangBtnHTML?`<button class="langbtn" type="button" data-prelang>${DDlangBtnHTML()}</button>`:""}</header>`;
  let body;
  if(full){const ic=C.img?`<img class="pre-big" src="${esc(imgOk(C.img))}" alt="">`:`<div class="pre-big">${esc(C.icon||"🎉")}</div>`;
    body=`<section class="pre-closed" style="--cbg:${hexOk(C.bg,"#000096")};--cink:${hexOk(C.ink,"#ffffff")}">${C.fx!=="none"?preRain(C.fx==="gifts"?["🎁","🍪","🎁"]:["✨","🎉","✨","🎊"]):""}${ic}<h2>${esc(preFill(C.title))}</h2><p>${esc(preFill(C.text))}</p>${preCdHTML(P)}
      ${C.btn&&C.link?`<a class="pre-btn pre-btn-w" href="${esc(socialUrl(C.link)||"#")}" target="_blank" rel="noopener">${esc(C.btn)}</a>`:""}${P.game.on?`<button class="pre-btn pre-btn-y" type="button" data-pregame>🍪 Play while you wait</button>`:""}</section>`}
  else{
    const D=P.done,reg=me?`<section class="pre-done" id="preForm" style="--dbx:${hexOk(D.bg,"#ffffff")};--dink:${hexOk(D.ink,"#0B0B45")};--dttl:${hexOk(D.title2,"#000096")};--dcbg:${hexOk(D.codeBg,"#FFF4D6")};--dcink:${hexOk(D.codeInk,"#000096")}">${D.fx==="none"?"":preRain(D.fx==="confetti"?["✨","🎉","✨","🎊"]:D.fx==="cookies"?["🍪","🍪","✨"]:["🎁","🍪","🎁"])}${D.img?`<img class="pre-big" src="${esc(imgOk(D.img))}" alt="">`:`<div class="pre-big">${esc(D.icon||"🎁")}</div>`}<h2>${esc(preFill(D.title,me))}</h2><p>${esc(preFill(D.text,me))}</p>
        <div class="pre-code" data-notr>${esc(me.code)}</div>${D.note?`<p class="pre-sm">${esc(D.note)}</p>`:""}
        <div class="pre-row"><button class="pre-btn pre-btn-l" type="button" data-precopy>📋 Copy code</button>${D.wa===false?"":`<a class="pre-btn pre-btn-wa" href="https://wa.me/?text=${encodeURIComponent(`My ${pg.name||"Delidome"} gift code: ${me.code}${me.exp?` (claim before ${fmtDT(me.exp)})`:""}`)}" target="_blank" rel="noopener">💬 Save to my WhatsApp</a>`}</div>
        ${me.exp?`<p class="pre-exp">⏳ Claim before ${esc(fmtDT(me.exp))}</p>`:""}${D.tip?`<p class="pre-sm">${esc(D.tip)}</p>`:""}</section>`
      :`<form class="pre-form" id="preForm" novalidate><p class="pre-lead">${esc(preFill(P.text))}</p>
        ${P.spots!==false&&left!==null?`<div class="pre-spots">🔥 <b>${left} of ${st.max}</b> Gift Sets left<div class="pre-bar"><i style="width:${st.max?Math.round(left/st.max*100):0}%"></i></div></div>`:""}
        <input class="pre-in" id="prName" autocomplete="name" maxlength="80" placeholder="Full name" required>
        <input class="pre-in" id="prPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="24" placeholder="WhatsApp number" required>
        ${P.form.email!==false?`<input class="pre-in" id="prEmail" type="email" autocomplete="email" maxlength="120" placeholder="Email (optional)">`:""}
        ${PRE.err?`<p class="pre-err" role="alert">${esc(PRE.err)}</p>`:""}<button class="pre-btn" type="submit" ${PRE.busy?"disabled":""}>${PRE.busy?"Saving…":esc(P.form.btn||"Claim my free Gift Set")}</button></form>`;
    body=`<div class="dome" id="preDome"><div class="hm" aria-hidden="true"></div><div class="ho" aria-hidden="true"></div><p class="eyebrow"></p><h1></h1><p class="lede"></p><div class="hero-ctas"><a class="btn btn-white" href="#preForm" data-prego="form"></a><a class="btn btn-line" href="#preGame" data-prego="game"></a></div></div>
      ${me?reg+preCdHTML(P):preCdHTML(P)+reg}${preGiftsHTML(P)}${P.game.on?preGameCardHTML(P):""}`}
  const pv=preForced()?`<div class="pre-pv" data-notr><b>👁 Preview</b><span>Like a private window: nothing is saved and nobody is registered.</span><div>${[["form","Form"],["done","You're in"],["full","All taken"]].map(([k,l])=>`<button type="button" data-pvst="${k}" aria-pressed="${(k==="done"&&!!me)||(k==="full"&&full)||(k==="form"&&!me&&!full)}">${l}</button>`).join("")}<button type="button" data-pvgame>Game</button></div></div>`:"";
  v.innerHTML=`${preFxHTML(P)}<div class="pre-wrap">${pv}${top}${body}</div>`;
  const dome=v.querySelector("#preDome");if(dome){const h=JSON.parse(JSON.stringify(P.hero));if(!P.game.on)h.btn2="";if(me)h.btn1="";if(!h.bg)h.bg=pg.brand;heroFill(dome,h)}
  preTick();clearInterval(PRE.t);PRE.t=setInterval(preTick,1000);
  clearInterval(PRE.poll);if(SBH.on&&!me)PRE.poll=setInterval(()=>{if(!document.hidden&&!preView().hidden)preStatus()},30000)}
function preShowGift(){requestAnimationFrame(()=>{const g=document.querySelector("#preView .pre-done");if(g)g.scrollIntoView({behavior:"smooth",block:"start"})})}
function preFake(nm){const P=DB.prelaunch,st=PRE.st||{};return {code:String(P.codePrefix||"GIFT-").toUpperCase()+"TEST",rank:(st.count||0)+1,name:nm,max:P.max,exp:P.expMode==="date"&&+P.expAt?+P.expAt:+P.openAt?+P.openAt+(+P.expDays||7)*864e5:null,preview:true}}
function preRain(list){let h="";for(let i=0;i<9;i++)h+=`<i style="left:${(Math.random()*92).toFixed(1)}%;--t:${(4+Math.random()*4).toFixed(1)}s;--dl:-${(Math.random()*6).toFixed(1)}s">${list[i%list.length]}</i>`;return `<div class="pre-rain" aria-hidden="true">${h}</div>`}
function preTick(){const v=document.getElementById("preView");if(!v||v.hidden)return;const P=DB.prelaunch;
  v.querySelectorAll("[data-pcd]").forEach(c=>{const ms=Math.max(0,+c.dataset.pcd-preNow()),s=Math.floor(ms/1000),x={d:Math.floor(s/86400),h:Math.floor(s%86400/3600),m:Math.floor(s%3600/60),s:s%60};
    c.querySelectorAll("[data-pk]").forEach(b=>{const t=String(x[b.dataset.pk]).padStart(2,"0");if(b.textContent!==t){b.textContent=t;if(c.classList.contains("pcs-flip")){b.classList.remove("flp");void b.offsetWidth;b.classList.add("flp")}}})});
  if(P.on&&P.autoOpen!==false&&+P.openAt>0&&preNow()>=+P.openAt&&!preForced()){clearInterval(PRE.t);if(SBH.on&&SBH.loadShop)SBH.loadShop(true);renderStore()}}
function preClick(e){const b=e.target.closest("button,a");if(!b)return;const d=b.dataset;
  if(d.pvst){const P=DB.prelaunch;PRE.err="";PRE.pvFull=d.pvst==="full";PRE.me=d.pvst==="done"?preFake("Sari"):null;renderPre(true);if(PRE.me)preShowGift();return}
  if(d.pvgame!==undefined){if(window.preGameStart)preGameStart();return}
  if(d.prelang!==undefined&&window.DDsetLang){DDsetLang(DDLANG()==="id"?"en":"id");return}
  if(d.prego==="form"){e.preventDefault();const f=document.getElementById("preForm");if(f){f.scrollIntoView({behavior:"smooth",block:"center"});const n=document.getElementById("prName");n&&setTimeout(()=>n.focus(),400)}return}
  if(d.prego==="game"||d.pregame!==undefined){e.preventDefault();if(window.preGameStart)preGameStart();return}
  if(d.precopy!==undefined&&PRE.me){const c=PRE.me.code;(navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(()=>toast("Code copied"),()=>toast(c))}}
async function preSubmit(e){if(e.target.id!=="preForm")return;e.preventDefault();if(PRE.busy)return;
  const v=id=>((document.getElementById(id)||{}).value||"").trim(),nm=v("prName"),ph=v("prPhone"),em=v("prEmail");
  const fail=m=>{PRE.err=m;renderPre(true)};
  if(nm.length<2)return fail("Please enter your name.");
  const n=normPhone(ph).length;if(n<7||n>14||!/^[0-9+()\s.-]{6,24}$/.test(ph))return fail("Please enter a valid WhatsApp number.");
  if(em&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))return fail("Please enter a valid email address.");
  PRE.err="";
  if(preForced()){PRE.me=preFake(nm);PRE.pvFull=false;renderPre(true);preShowGift();toast("Preview only: nobody was registered.");return}
  PRE.busy=true;renderPre(true);let r;
  try{
    if(SBH.on)r=await SBH.preReg(nm,ph,em);
    else{const L=DB.preRegs||(DB.preRegs=[]),P=DB.prelaunch,ex=L.find(x=>normPhone(x.phone)===normPhone(ph));
      if(ex)r={ok:true,again:true,code:ex.code,rank:ex.rank,name:ex.name,exp:ex.exp,max:P.max};
      else if(L.length>=+P.max)r={ok:false,full:true,max:P.max};
      else{const ab="ABCDEFGHJKMNPQRSTUVWXYZ23456789";let c=(P.codePrefix||"GIFT-").toUpperCase();for(let i=0;i<4;i++)c+=ab[Math.floor(Math.random()*ab.length)];
        const exp=P.expMode==="date"&&+P.expAt?+P.expAt:+P.openAt?+P.openAt+(+P.expDays||7)*864e5:null;
        const x={rank:L.length+1,name:nm,phone:ph,email:em,code:c,at:Date.now(),exp};L.push(x);saveDB();r=Object.assign({ok:true,max:P.max},x)}}
  }catch(x){PRE.busy=false;return fail(x.message||"Please try again.")}
  PRE.busy=false;
  if(r&&r.full){PRE.st=Object.assign({},PRE.st,{full:true,count:r.max,max:r.max});renderPre(true);return}
  PRE.me={code:r.code,rank:r.rank,name:r.name,exp:r.exp||null,max:r.max,at:Date.now()};try{localStorage.setItem(PRE_KEY,JSON.stringify(PRE.me))}catch(x){}
  if(PRE.st&&!r.again)PRE.st.count=(PRE.st.count||0)+1;
  renderPre(true);preShowGift();if(r.again)toast("You're already registered. Here's your code again.")}
addEventListener("ddlang",()=>{if(!preView().hidden)renderPre(true)});
/* pre-launch mini game "Catch the cookies": 10 levels, each a little harder. A level drops the same cookie sequence every time,
   so its highest possible score is exact (every good cookie tapped with a full combo). Top 5 of each level are kept on the
   server; the player's own progress (unlocked level, best scores) stays on their phone. */
const PGM={tl:false,run:false,score:0,raf:0,cks:[],combo:0,last:0,acc:0,lt:0,gt:0,endT:0,lv:1,rnd:null,L:null,C:null,html:{},tops:null,topsErr:false,res:null,busy:false,
  me:{lv:1,best:{},name:"",tops:{}}};
try{const m=JSON.parse(localStorage.getItem("delidome-game-v2")||"null");if(m&&typeof m==="object")Object.assign(PGM.me,m,{lv:Math.max(1,Math.min(10,+m.lv||1))})}catch(e){}
PGM.lv=PGM.me.lv;
const pgmSave=()=>{try{localStorage.setItem("delidome-game-v2",JSON.stringify(PGM.me))}catch(e){}};
const PGM_AV=["🐻","🐱","🐶","🦊","🐼","🐰","🐯","🐸","🐧","🦄"],PGM_BASE={slow:.62,normal:.46,fast:.34},PGM_SP={slow:.7,normal:1,fast:1.4};
const pgmN=n=>Math.round(+n||0).toLocaleString("id-ID"),pgmPct=(v,d,hi)=>Math.max(0,Math.min(hi,isFinite(+v)&&v!==""?+v:d));
const pgmSec=G=>Math.max(10,Math.min(300,+G.sec||60)),pgmAdd=G=>Math.max(1,Math.min(30,+G.add||5)),pgmFlame=G=>Math.max(0,Math.round(+G.flame||0));
// the regular cookies: flavors picked from the menu (each with its own points), else the uploaded game pictures
function pgmCks(G){const F=(G.cks||[]).map(c=>({p:prod(c.pid),pts:Math.max(1,Math.round(+c.pts||0))})).filter(c=>c.p);if(F.length)return F;
  const list=G.imgs&&G.imgs.length?G.imgs:(DB.prelaunch.fx.imgs.length?DB.prelaunch.fx.imgs:[COOKIE_SVG]);return list.map(u=>({u,pts:Math.max(1,Math.round(+G.pts||100))}))}
function pgmLevel(G,lv){const f=Math.pow(1+pgmPct(G.grow,20,100)/100,lv-1),gold=pgmPct(G.pGold,8,30),time=pgmPct(G.pTime,4,10);
  return {lv,f,every:Math.max(.08,(PGM_BASE[G.speed]||.46)/f),sp:(PGM_SP[G.speed]||1)*f,gold,time,flame:Math.min(45,pgmPct(G.pFlame,10,45)*f)}}
const pgmDraw=(r,L,n)=>{const x=r()*100,i=Math.floor(r()*n);return {i,kind:x<L.gold?"gold":x<L.gold+L.time?"time":x<L.gold+L.time+L.flame?"flame":""}};
const PGM_SEED=7936;   // every level uses the same random sequence, so a harder level always holds more points
const pgmCap=G=>pgmSec(G)*3;   // clock cookies can add time, up to 3x the round length
// highest possible score of a level: the same cookie sequence the game drops, every good cookie and clock tapped.
// Without the combo bonus it is the target for unlocking; with a full combo it is the ceiling for a top-5 total.
function pgmMax(G,lv,combo){const L=pgmLevel(G,lv),C=pgmCks(G),r=rng(PGM_SEED),add=pgmAdd(G),cap=pgmCap(G);let end=pgmSec(G),taps=0,s=0;
  for(let k=1;k<50000;k++){const t=k*L.every;if(t>end-.3)break;const d=pgmDraw(r,L,C.length);if(d.kind==="flame")continue;taps++;
    if(d.kind==="time"){end=Math.min(cap,end+add);continue}s+=C[d.i].pts*(d.kind==="gold"?2:1)*(combo?(taps>=6?3:taps>=3?2:1):1)}
  return s}
const pgmNeed=(G,max)=>Math.ceil(max*pgmPct(G.pass,70,100)/100);
function pgmLevels(G){return Array.from({length:10},(_,i)=>{const L=pgmLevel(G,i+1),max=pgmMax(G,i+1);return Object.assign(L,{max,need:pgmNeed(G,max),cap:pgmMax(G,i+1,true)})})}
async function pgmTopsLoad(){try{PGM.tops=SBH.on&&SBH.gameTops?await SBH.gameTops():(PGM.me.tops||{});PGM.topsErr=false}catch(e){PGM.topsErr=true}
  const ov=document.getElementById("preGame");if(ov&&!ov.hidden&&!PGM.run){const t=ov.querySelector("[data-pgmtops]");if(t)t.outerHTML=pgmTopsHTML(+t.dataset.pgmtops,t.dataset.me||"")}}
const pgmTop=lv=>(PGM.tops&&PGM.tops[lv])||[];
// shiny gold / silver / bronze trophy for places 1 to 3 (places 4 and 5 stay blank)
const PGM_TR={1:["#FFF3B0","#F7C531","#B57A00","Gold"],2:["#F4F7FB","#AEB9C8","#5C6878","Silver"],3:["#FFD9B0","#D58A47","#8C4E1C","Bronze"]};
function pgmTrophy(r){const c=PGM_TR[r];if(!c)return "";const id="pgt"+r;
  return `<svg class="pgm-tr t${r}" viewBox="0 0 24 24" role="img" aria-label="${c[3]} trophy"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient><clipPath id="${id}c"><path d="M7 3h10v6a5 5 0 0 1-10 0z"/><rect x="10.5" y="13" width="3" height="4"/><path d="M7 19h10v2H7z"/></clipPath></defs>
    <path d="M7 4H3.5v2.2c0 2.2 1.5 3.8 3.6 4.1M17 4h3.5v2.2c0 2.2-1.5 3.8-3.6 4.1" fill="none" stroke="url(#${id})" stroke-width="1.7" stroke-linecap="round"/>
    <g stroke="rgba(70,45,0,.45)" stroke-width=".6" stroke-linejoin="round"><path d="M7 3h10v6a5 5 0 0 1-10 0z" fill="url(#${id})"/><rect x="10.5" y="13" width="3" height="4" fill="url(#${id})"/><path d="M7 19h10v2H7z" fill="url(#${id})"/></g>
    <g clip-path="url(#${id}c)"><g transform="skewX(-20)"><rect class="pgt-sh" x="-6" y="0" width="4" height="24" fill="#fff" opacity=".85"/></g></g>
    <path class="pgt-sp s1" d="M20.5 2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#fff"/><path class="pgt-sp s2" d="M3 12l.5 1.3 1.3.5-1.3.5L3 15.6l-.5-1.3-1.3-.5 1.3-.5z" fill="#fff"/></svg>`}
function pgmTopsHTML(lv,me){const T=pgmTop(lv);return `<div class="pgm-tops" data-pgmtops="${lv}" data-me="${esc(me||"")}"><b>🏆 Top 5 · Level ${lv}</b>${PGM.tops===null?`<p class="pgm-sm">${PGM.topsErr?"Couldn't load the scores.":"Loading…"}</p>`
  :T.length?`<ol>${T.map((x,i)=>`<li class="${me&&me===x.name+"|"+x.score?"me":""}"><span class="pgm-av" style="animation-delay:${i*.15}s">${PGM_AV[+x.av]||PGM_AV[0]}</span><span class="pgm-nmw"><span class="pgm-nm">${esc(x.name)}</span>${pgmTrophy(i+1)}</span><b>${pgmN(x.score)}</b></li>`).join("")}</ol>`:`<p class="pgm-sm">No scores yet. Be the first!</p>`}</div>`}
function pgmBar(v,need){return `<div class="pgm-bar"><i style="width:${need>0?Math.min(100,Math.round(v/need*100)):0}%"></i></div>`}
function pgmGoal(lv,best,lvl){return lv<10?`<p class="pgm-goal"><b>${pgmN(best)}</b> / ${pgmN(lvl.need)} to unlock Level ${lv+1}</p>${pgmBar(best,lvl.need)}`:`<p class="pgm-goal"><b>${pgmN(best)}</b> / ${pgmN(lvl.need)} to beat the last level</p>${pgmBar(best,lvl.need)}`}
window.preGameStart=function(){const G=DB.prelaunch.game;let ov=document.getElementById("preGame");
  if(!ov){ov=document.createElement("div");ov.id="preGame";ov.setAttribute("role","dialog");ov.setAttribute("aria-label","Catch the cookies");document.body.appendChild(ov);
    ov.addEventListener("pointerdown",pgmTap);ov.addEventListener("click",e=>{const b=e.target.closest("button,a");if(!b)return;const d=b.dataset;
      if(d.pgmgo!==undefined)pgmPlay();else if(d.pgmrules!==undefined)pgmRules();else if(d.pgmback!==undefined)pgmIntro();else if(d.pgmx!==undefined)pgmClose();
      else if(d.pgmlv){if(+d.pgmlv<=PGM.me.lv){PGM.lv=+d.pgmlv;pgmIntro()}}else if(d.pgmnext!==undefined){PGM.lv=Math.min(10,PGM.lv+1);pgmRules()}
      else if(d.pgmsave!==undefined)pgmSubmit()});
    ov.addEventListener("submit",e=>{e.preventDefault();pgmSubmit()})}
  ov.style.setProperty("--gbg",hexOk(G.bg,"#FFF4D6"));ov.hidden=false;document.body.style.overflow="hidden";PGM.lv=Math.min(PGM.lv,PGM.me.lv);PGM.tops=null;pgmIntro();pgmTopsLoad()};
function pgmIntro(){const ov=document.getElementById("preGame"),G=DB.prelaunch.game,lv=PGM.lv,lvl=pgmLevels(G)[lv-1],best=+PGM.me.best[lv]||0;
  ov.innerHTML=`<div class="pgm-card"><button class="pgm-x" type="button" data-pgmx aria-label="Close">✕</button><div class="pgm-big">🍪</div><h2>Catch the cookies!</h2>
    <div class="pgm-lvs" role="group" aria-label="Level">${Array.from({length:10},(_,i)=>i+1).map(n=>`<button type="button" data-pgmlv="${n}" aria-pressed="${n===lv}" ${n>PGM.me.lv?`disabled aria-label="Level ${n}, locked"`:""}>${n>PGM.me.lv?"🔒":n}</button>`).join("")}</div>
    <div class="pgm-info"><span>Level <b>${lv}</b></span><span>Highest possible <b>${pgmN(lvl.max)}</b></span></div>${pgmGoal(lv,best,lvl)}
    ${pgmTopsHTML(lv)}<button class="pre-btn" type="button" data-pgmrules>▶ Play</button></div>`}
// the rules, as short as possible, then "ready?"
function pgmRules(){const ov=document.getElementById("preGame"),G=DB.prelaunch.game,lv=PGM.lv,lvl=pgmLevels(G)[lv-1],C=pgmCks(G),lo=Math.min(...C.map(c=>c.pts)),hi=Math.max(...C.map(c=>c.pts));
  ov.innerHTML=`<div class="pgm-card"><button class="pgm-x" type="button" data-pgmx aria-label="Close">✕</button><h2>How to play</h2><p class="pgm-sm">Level ${lv} · ${pgmSec(G)} seconds</p>
    <ul class="pgm-rules"><li><i>🍪</i><span>Tap the cookies: <b>+${lo===hi?pgmN(lo):pgmN(lo)+" to "+pgmN(hi)}</b></span></li><li><i>✨</i><span>Golden cookie: <b>double points</b></span></li>
    ${pgmFlame(G)?`<li><i>🔥</i><span>Flame cookie: <b>−${pgmN(pgmFlame(G))}</b>, don't tap it!</span></li>`:""}<li><i>⏰</i><span>Clock cookie: <b>+${pgmAdd(G)} seconds</b></span></li><li><i>⚡</i><span>Tap fast in a row: <b>combo bonus</b> (x2, x3), added at the end</span></li></ul>
    <p class="pgm-goal">Get <b>${pgmN(lvl.need)}</b> cookie points to ${lv<10?`unlock Level ${lv+1}`:"beat the last level"}.${PGM.me.lv>1?" Miss it and you drop one level.":""}</p>
    <h3 class="pgm-ready">Ready?</h3><button class="pre-btn" type="button" data-pgmgo>Yes, let's go! 🚀</button><button class="pgm-link" type="button" data-pgmback>Not yet</button></div>`}
function pgmPlay(){const ov=document.getElementById("preGame"),G=DB.prelaunch.game,lv=PGM.lv;cancelAnimationFrame(PGM.raf);
  PGM.L=pgmLevel(G,lv);PGM.C=pgmCks(G);PGM.need=pgmLevels(G)[lv-1].need;PGM.rnd=rng(PGM_SEED);PGM.res=null;
  ov.innerHTML=`<div class="pgm-stage" id="pgmStage"><div class="pgm-hud"><span>Lv ${lv}</span><span>🍪 <b id="pgmScore">0</b></span><span class="pgm-tm">⏱ <b id="pgmTime">${pgmSec(G)}</b>s</span><button class="pgm-x2" type="button" data-pgmx aria-label="Close">✕</button></div>
    <div class="pgm-hbar">${pgmBar(0,PGM.need)}</div><div class="pgm-cb" id="pgmBonus" hidden>⚡ Combo bonus <b>+0</b></div><div class="pgm-combo" id="pgmCombo"></div></div>`;
  PGM.cks=[];PGM.score=0;PGM.bonus=0;PGM.combo=0;PGM.last=0;PGM.acc=0;PGM.lt=0;PGM.gt=0;PGM.endT=pgmSec(G);PGM.run=true;PGM.raf=requestAnimationFrame(pgmLoop)}
// cookie pictures: the flavor's own picture (cached), or an uploaded one
function pgmArt(c){if(c.u)return `<img src="${esc(c.u===COOKIE_SVG?c.u:imgOk(c.u))}" alt="" draggable="false">`;const k=c.p.id;return PGM.html[k]||(PGM.html[k]=plateInner(c.p)||`<img src="${esc(COOKIE_SVG)}" alt="" draggable="false">`)}
function pgmSpawn(st){const G=DB.prelaunch.game,d=pgmDraw(PGM.rnd,PGM.L,PGM.C.length),c=PGM.C[d.i],kind=d.kind,e=document.createElement("i"),W=st.clientWidth,sz=Math.max(48,Math.min(78,W/6));
  const own=kind==="gold"?G.gold:kind==="flame"?G.burnt:kind==="time"?G.clock:"";
  e.className="pgm-ck"+(kind?" "+kind+(own?" own":""):"");e.innerHTML=own?`<img src="${esc(imgOk(own))}" alt="" draggable="false">`:pgmArt(c);e.style.width=e.style.height=sz+"px";st.appendChild(e);
  PGM.cks.push({e,kind,pts:kind==="gold"?c.pts*2:kind==="flame"?-pgmFlame(G):kind==="time"?0:c.pts,x:Math.random()*(W-sz),y:-sz,s:sz,v:(st.clientHeight*.28+Math.random()*st.clientHeight*.25)*PGM.L.sp,w:4+Math.random()*10,ph:Math.random()*6})}
function pgmLoop(ts){const st=document.getElementById("pgmStage");if(!st||!PGM.run)return;const dt=Math.min(.05,(ts-(PGM.lt||ts))/1000);PGM.lt=ts;PGM.gt+=dt;
  PGM.acc+=dt;while(PGM.acc>=PGM.L.every){PGM.acc-=PGM.L.every;if(PGM.gt<PGM.endT-.3)pgmSpawn(st)}
  PGM.cks.forEach(c=>{if(c.dead)return;c.y+=c.v*dt;c.ph+=dt*4;c.e.style.transform=`translate(${c.x+Math.sin(c.ph)*c.w}px,${c.y}px) rotate(${Math.sin(c.ph)*18}deg)`;if(c.y>st.clientHeight){c.dead=1;c.e.remove()}});
  PGM.cks=PGM.cks.filter(c=>!c.dead);
  const left=Math.max(0,Math.ceil(PGM.endT-PGM.gt)),tm=document.getElementById("pgmTime");if(tm&&tm.textContent!==String(left))tm.textContent=left;
  if(PGM.gt>=PGM.endT){pgmOver();return}PGM.raf=requestAnimationFrame(pgmLoop)}
function pgmTap(ev){if(!PGM.run)return;const st=document.getElementById("pgmStage");if(!st)return;const r=st.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;
  const c=PGM.cks.find(c=>!c.dead&&Math.abs(c.x+Math.sin(c.ph)*c.w+c.s/2-x)<c.s*.62&&Math.abs(c.y+c.s/2-y)<c.s*.62);if(!c)return;ev.preventDefault();c.dead=1;c.e.remove();
  const G=DB.prelaunch.game,now=performance.now();let pts=0,bon=0;
  if(c.kind==="flame"){PGM.combo=0;pts=c.pts}
  else{PGM.combo=now-PGM.last<750?PGM.combo+1:1;PGM.last=now;if(c.kind==="time")PGM.endT=Math.min(pgmCap(G),PGM.endT+pgmAdd(G));else{pts=c.pts;bon=c.pts*((PGM.combo>=6?3:PGM.combo>=3?2:1)-1)}}
  PGM.score=Math.max(0,PGM.score+pts);document.getElementById("pgmScore").textContent=pgmN(PGM.score);
  if(bon){PGM.bonus+=bon;const bb=document.getElementById("pgmBonus");bb.hidden=false;bb.querySelector("b").textContent="+"+pgmN(PGM.bonus)}
  const hb=st.querySelector(".pgm-hbar");if(hb)hb.innerHTML=pgmBar(PGM.score,PGM.need);try{if(navigator.vibrate)navigator.vibrate(c.kind==="flame"?[30,40,30]:15)}catch(e){}
  const fx=G.tap,cx=c.x+Math.sin(c.ph)*c.w+c.s/2,cy=c.y+c.s/2;
  for(let i=0;i<(fx==="crumble"?10:8);i++){const k=document.createElement("i");k.className="pgm-p pgm-"+(fx==="sparkle"?"sp":fx==="hearts"?"ht":"cr")+(c.kind?" "+c.kind:"");k.style.left=cx+"px";k.style.top=cy+"px";k.style.setProperty("--dx",(Math.random()*110-55)+"px");k.style.setProperty("--dy",(Math.random()*110-55)+"px");if(fx==="hearts")k.textContent="💛";if(fx==="sparkle")k.textContent="✨";st.appendChild(k);setTimeout(()=>k.remove(),650)}
  const p=document.createElement("i");p.className="pgm-pop"+(pts<0?" neg":c.kind==="time"?" tm":"");p.textContent=c.kind==="time"?`+${pgmAdd(G)}s ⏰`:(pts>0?"+":"")+pgmN(pts)+(c.kind==="gold"?" ✨":c.kind==="flame"?" 🔥":"")+(bon?` ⚡+${pgmN(bon)}`:"");p.style.left=(cx-14)+"px";p.style.top=(cy-24)+"px";st.appendChild(p);setTimeout(()=>p.remove(),800);
  if(PGM.combo===3||PGM.combo===6){const cb=document.getElementById("pgmCombo");cb.textContent=PGM.combo===3?"x2 combo!":"🔥 x3!";cb.classList.remove("on");void cb.offsetWidth;cb.classList.add("on")}}
const PGM_WIN=["You did it! 🎉","Amazing! 🥳","Cookie master! 🏆","Sweet victory! 🍪"],PGM_TRY=["So close! 💪","Don't give up! 🍪","You've got this! 🔥","One more try? 😋"];
const pgmPick=a=>a[Math.floor(Math.random()*a.length)];
function pgmOver(){PGM.run=false;cancelAnimationFrame(PGM.raf);const G=DB.prelaunch.game,lv=PGM.lv,lvl=pgmLevels(G)[lv-1],s=PGM.score,tot=s+PGM.bonus,old=+PGM.me.best[lv]||0,oldT=+(PGM.me.tot||{})[lv]||0;
  if(s>old)PGM.me.best[lv]=s;PGM.me.tot=PGM.me.tot||{};if(tot>oldT)PGM.me.tot[lv]=tot;
  const pass=s>=lvl.need,unlock=pass&&lv<10&&PGM.me.lv<=lv,was=PGM.me.lv;
  if(unlock)PGM.me.lv=lv+1;if(!pass)PGM.me.lv=Math.max(1,PGM.me.lv-1);   // every miss costs one level (Level 1 stays)
  const drop=PGM.me.lv<was;PGM.lv=Math.min(PGM.lv,PGM.me.lv);pgmSave();
  const T=pgmTop(lv),top=PGM.tops!==null&&!PGM.topsErr&&tot>0&&(T.length<5||tot>+T[T.length-1].score);
  PGM.res={lv,s,bonus:PGM.bonus,tot,best:tot>oldT,pass,unlock,drop,top,head:pgmPick(pass?PGM_WIN:PGM_TRY),av:Math.floor(Math.random()*PGM_AV.length),saved:""};pgmEnd();
  const cd=document.querySelector("#preGame .pgm-card");if(cd&&!RM&&(pass||top))pgmParty(cd)}
// a lively celebration: confetti in waves and cookies, stars and party poppers flying up
function pgmParty(cd){[0,450,900].forEach(t=>setTimeout(()=>{if(cd.isConnected)gmConfetti(cd)},t));
  const em=["🎉","✨","🍪","⭐","🥳","🎊"];for(let i=0;i<14;i++){const f=document.createElement("i");f.className="pgm-fly";f.textContent=em[i%em.length];
    f.style.left=(5+Math.random()*90)+"%";f.style.animationDelay=(Math.random()*1.2)+"s";f.style.fontSize=(20+Math.random()*18)+"px";cd.appendChild(f);setTimeout(()=>f.remove(),3200)}}
function pgmEnd(){const G=DB.prelaunch.game,R=PGM.res,lv=R.lv,lvl=pgmLevels(G)[lv-1],s=R.s;
  const link=location.origin+location.pathname,txt=preFill(G.share).replace(/\{score\}/g,pgmN(R.tot)).replace(/\{link\}/g,link),next=R.pass&&lv<10&&PGM.me.lv>lv;
  document.getElementById("preGame").innerHTML=`<div class="pgm-card ${R.pass?"win":"try"}"><button class="pgm-x" type="button" data-pgmx aria-label="Close">✕</button><div class="pgm-big">${R.pass?"🏆":"💪"}</div>
    <h2>${esc(R.head)}</h2><p class="pgm-sm">${esc(preFill(G.end).replace(/\{score\}/g,pgmN(R.tot)))}</p>
    <div class="pgm-sum"><span>🍪 Cookies <b>${pgmN(s)}</b></span><span>⚡ Combo bonus <b>+${pgmN(R.bonus)}</b></span><span class="t">Total <b>${pgmN(R.tot)}</b></span></div>
    ${R.pass?`<p class="pgm-badge">${lv<10?(R.unlock?`🔓 Level ${lv+1} unlocked!`:`✅ Level ${lv} cleared!`):"👑 You beat the last level!"}</p>`
      :`<p class="pgm-goal">Only <b>${pgmN(Math.max(0,lvl.need-s))}</b> more cookie points next time. Tap fast and skip the 🔥!</p>${pgmBar(s,lvl.need)}${R.drop?`<p class="pgm-drop">⬇️ You're back on Level ${PGM.me.lv}. Win it to climb back up!</p>`:""}`}
    ${R.best?`<p class="pgm-sm">🎉 Your best total on Level ${lv}!</p>`:""}
    ${R.top&&!R.saved?`<form class="pgm-win"><b>You're in the top 5! 🎉</b><span class="pgm-av big">${PGM_AV[R.av]}</span><span class="pgm-sm">This is your player icon</span>
      <input class="in" id="pgmName" maxlength="20" placeholder="Your name" autocomplete="nickname" value="${esc(PGM.me.name||"")}" aria-label="Your name">
      <button class="pre-btn" type="button" data-pgmsave ${PGM.busy?"disabled":""}>${PGM.busy?"Saving…":"Save my name"}</button>${R.err?`<p class="pgm-err">${esc(R.err)}</p>`:""}${preForced()?`<p class="pgm-sm">Preview: the name is not saved.</p>`:""}</form>`:""}
    ${R.saved||!R.top?pgmTopsHTML(lv,R.saved):""}
    ${next?`<button class="pre-btn" type="button" data-pgmnext>▶ Level ${lv+1}</button>`:""}<button class="pre-btn${next?" pre-btn-w":""}" type="button" data-pgmrules>${R.pass?"↻ Play again":`💪 Try again${R.drop?` (Level ${PGM.lv})`:""}`}</button>
    <a class="pre-btn pre-btn-wa" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">💬 Share my score</a><button class="pgm-link" type="button" data-pgmback>All levels</button></div>`}
async function pgmSubmit(){const R=PGM.res;if(!R||!R.top||R.saved||PGM.busy)return;const i=document.getElementById("pgmName"),nm=String(i&&i.value||"").replace(/[<>]/g,"").trim().slice(0,20);
  if(!nm){R.err="Type your name first.";pgmEnd();return}PGM.me.name=nm;pgmSave();R.err="";
  if(preForced()){R.saved=nm+"|"+R.tot;pgmEnd();return}
  PGM.busy=true;pgmEnd();
  try{if(SBH.on&&SBH.gameSubmit)PGM.tops=await SBH.gameSubmit(R.lv,R.tot,nm,R.av);else{const L=(PGM.me.tops[R.lv]||[]).concat({name:nm,av:R.av,score:R.tot}).sort((a,b)=>b.score-a.score).slice(0,5);PGM.me.tops[R.lv]=L;pgmSave();PGM.tops=PGM.me.tops}
    R.saved=nm+"|"+R.tot}catch(e){R.err=e.message||"Couldn't save. Please try again."}
  PGM.busy=false;pgmEnd()}
function pgmClose(){PGM.run=false;cancelAnimationFrame(PGM.raf);const ov=document.getElementById("preGame");if(ov){ov.hidden=true;ov.innerHTML=""}document.body.style.overflow=""}
document.addEventListener("visibilitychange",()=>{if(document.hidden&&PGM.run){PGM.run=false;cancelAnimationFrame(PGM.raf);const ov=document.getElementById("preGame");if(ov&&!ov.hidden)pgmIntro()}});
addEventListener("keydown",e=>{if(e.key==="Escape"){const ov=document.getElementById("preGame");if(ov&&!ov.hidden)pgmClose()}});
/* pre-launch gift code in the shop (after opening): remembered on the phone that registered, or typed in the coupon box.
   It shows as a gift panel in the box and a line in checkout; the server attaches it to the order right after it is placed. */
const PG_KEY="delidome-pregift-v1",PG={code:null,info:null,exp:null,checked:false};
/* review rewards the customer holds (saved on this phone): one can be used per order, and only on a box of the minimum size or more */
const RVW_KEY="delidome-rvcodes",RVW={list:[],checked:false,pick:"",off:false,expired:0},isRvCode=c=>/^RV-/i.test(c||"");
const rvwSaved=()=>{try{return JSON.parse(localStorage.getItem(RVW_KEY)||"[]").filter(x=>typeof x==="string").slice(0,20)}catch(e){return []}};
const rvwSave=()=>{try{localStorage.setItem(RVW_KEY,JSON.stringify(RVW.list.map(x=>x.code)))}catch(e){}};
const rvwMin=()=>Math.max(1,Math.round(+(DB.revrew||{}).claimMin)||6);
async function rvwInit(){if(RVW.checked||!SBH.on)return;RVW.checked=true;const out=[];
  for(const c of rvwSaved()){try{const r=await SBH.preGift(c,"");if(r&&r.ok)out.push({code:r.code,info:r.info,exp:r.exp||null});else if(r&&/expired/i.test(r.err||""))RVW.expired++}catch(e){}}
  RVW.list=out;rvwSave();renderStore()}
async function rvwAdd(code){if(!SBH.on||!code||RVW.list.some(x=>x.code===code))return;try{const r=await SBH.preGift(code,"");if(r&&r.ok){RVW.list.push({code:r.code,info:r.info,exp:r.exp||null});rvwSave();RVW.off=false;renderStore()}}catch(e){}}
const rvwUsed=c=>{RVW.list=RVW.list.filter(x=>x.code!==c);if(RVW.pick===c)RVW.pick="";rvwSave()};
const rvwApplied=()=>!!(PG.code&&RVW.list.some(x=>x.code===PG.code));
function rvwApply(x){PG.code=x.code;PG.info=x.info;PG.exp=x.exp;setTimeout(renderMenu,0)}
function rvwSync(){const ok=(S.size||0)>=rvwMin();
  if(isRvCode(PG.code)&&!ok){PG.code=null;PG.info=null;PG.exp=null;setTimeout(renderMenu,0)}
  if(!PG.code&&ok&&(DB.revrew||{}).claimMode!=="manual"&&!RVW.off){
    const pk=RVW.list.find(x=>x.code===RVW.pick);if(pk)rvwApply(pk);else if(RVW.list.length===1)rvwApply(RVW.list[0])}}
const rvwArt=g=>{const p=g&&g.pid&&prod(g.pid);return p?`<span class="gplate">${plateHTML(p)}</span>`:""};
function rvwNoticeHTML(){const R=DB.revrew;if(!R)return "";const U0=R.upg||{},xp=RVW.expired>0?`<div class="rvu" style="--ub:#FDECEC;--ui:#8A1020"><span aria-hidden="true">⌛</span><p>${esc(String(U0.exp||"{n} of your rewards expired and can't be used any more.").replace(/\{n\}/g,RVW.expired))}</p><button type="button" data-rvwxp>OK</button></div>`:"";
  return xp+rvwNoticeMain()}
function rvwNoticeMain(){const R=DB.revrew;if(!RVW.list.length)return "";const U=R.upg||{},n=RVW.list.length,min=rvwMin(),ok=(S.size||0)>=min,man=R.claimMode==="manual",
    fill=t=>esc(String(t||"").replace(/\{n\}/g,n).replace(/\{min\}/g,min)),st=`style="--ub:${hexOk(U.bg,"#FFF4D6")};--ui:${hexOk(U.ink,"#0B0B45")}"`,ic=`<span aria-hidden="true">${esc(String(U.icon||"🎁").slice(0,4))}</span>`;
  if(!ok)return `<div class="rvu" ${st}>${ic}<p>${fill(n===1?U.one:U.many)}</p></div>`;
  if(man)return PG.code?"":`<div class="rvu" ${st}>${ic}<p>${fill(U.man)}</p></div>`;
  if(rvwApplied())return n>1?`<div class="rvu" ${st}>${ic}<p>${fill(U.chg)}</p><button type="button" data-rvwchange>${esc(U.changeBtn||"Change")}</button></div>`:"";
  if(PG.code)return "";
  if(n===1)return `<div class="rvu" ${st}>${ic}<p>${fill(U.one.replace(/Upgrade.*$/,"").trim()||U.one)}</p><button type="button" data-rvwpick="${esc(RVW.list[0].code)}">${esc(U.useBtn||"Use my reward")}</button></div>`;
  return `<div class="rvu rvpick" ${st}>${ic}<p><b>${fill(U.pickTitle)}</b></p><div class="rvpk">${RVW.list.map(x=>{const g=((x.info||{}).items||[])[0]||{};return `<button type="button" data-rvwpick="${esc(x.code)}">${rvwArt(g)||(g.img?`<img src="${esc(imgOk(g.img))}" alt="">`:`<i aria-hidden="true">${esc(String(g.icon||"🎁").slice(0,4))}</i>`)}<b>${esc(g.name||"Reward")}</b></button>`}).join("")}</div></div>`}
document.addEventListener("click",e=>{if(e.target.closest("[data-rvwxp]")){RVW.expired=0;renderStore();return}const pk=e.target.closest("[data-rvwpick]");if(pk){RVW.pick=pk.dataset.rvwpick;RVW.off=false;PG.code=null;PG.info=null;PG.exp=null;renderStore();return}
  if(e.target.closest("[data-rvwchange]")){RVW.pick="";RVW.off=false;PG.code=null;PG.info=null;PG.exp=null;renderStore();setTimeout(renderMenu,0)}});
const pgSaved=()=>{try{return localStorage.getItem(PG_KEY)||""}catch(e){return ""}};
function pgInit(){rvwInit();if(PG.checked)return;PG.checked=true;const c=pgSaved()||(PRE.me&&PRE.me.code)||"";if(c)pgCheck(c,"",true)}
async function pgCheck(code,phone,quiet){code=String(code||"").trim().toUpperCase();if(!code)return {ok:false,gift:false};let r;
  if(SBH.on){try{r=await SBH.preGift(code,phone)}catch(e){r={ok:false,gift:false}}}
  else{const x=(DB.preRegs||[]).find(z=>z.code===code),G=DB.prelaunch.gifts;
    r=!x?{ok:false,gift:false}:x.used?{ok:false,gift:true,err:"This gift code was already used."}:x.exp&&x.exp<Date.now()?{ok:false,gift:true,err:"This gift code has expired."}
      :phone&&normPhone(phone).length>=7&&normPhone(phone)!==normPhone(x.phone)?{ok:false,gift:true,err:"This gift code belongs to another WhatsApp number."}
      :{ok:true,gift:true,code,exp:x.exp,info:{title:G.title||"Free Gift Set",mode:G.mode,items:G.mode==="surprise"?[]:G.items.map(g=>({name:g.name,img:g.img}))}}}
  if(r.ok&&isRvCode(r.code)&&(S.size||0)<rvwMin())r={ok:false,gift:true,err:`This reward needs a box of ${rvwMin()} or more.`};
  if(r.ok){PG.code=r.code;PG.info=r.info;PG.exp=r.exp||null;
    if(isRvCode(r.code)){if(!RVW.list.some(x=>x.code===r.code)){RVW.list.push({code:r.code,info:r.info,exp:r.exp||null});rvwSave()}RVW.off=false}else{try{localStorage.setItem(PG_KEY,r.code)}catch(e){}}}
  else if(r.gift&&quiet)pgForget(true);
  if(quiet)renderStore();if(r.ok&&r.info&&(r.info.items||[]).some(g=>g&&g.pid))renderMenu();return r}
function pgForget(used){const had=PG.info&&(PG.info.items||[]).some(g=>g&&g.pid),c=PG.code;PG.code=null;PG.info=null;PG.exp=null;if(had)setTimeout(renderMenu,0);
  if(isRvCode(c)){if(used)rvwUsed(c);else RVW.off=true}else try{localStorage.removeItem(PG_KEY)}catch(e){}}
function pgPanelHTML(){if(!PG.info)return "";const I=PG.info,its=(I.items||[]).filter(g=>g&&(g.name||g.img));
  return `<div class="gb pgb fx-shine" style="--gb:#FFE9A8;--gi:#000096"><div class="gh"><span class="gtag">${esc(I.tag||"PRE-LAUNCH GIFT")}</span><b class="gt">${esc(I.title||"Free Gift Set")}</b>${PG.exp?`<span class="gend">Claim before ${esc(fmtDT(PG.exp))}</span>`:""}</div>
    <p class="gs">🎁 Reserved for you with code <b>${esc(PG.code)}</b>${I.mode==="surprise"?". Your ${esc(bbName())} is picked when you send your payment proof. Then tap it to open! 🤫":". Comes free with this order:"}</p>
    <div class="gl big">${I.mode==="surprise"?`<span class="gcard"><i aria-hidden="true">🎁</i><b>${esc(bbName())}</b><em>FREE</em></span>`:its.length?its.map(g=>giftCard(g)).join(""):`<span class="gcard"><i aria-hidden="true">🎁</i><b>${esc(I.title||"Free Gift Set")}</b><em>FREE</em></span>`}</div></div>`}
const preGiftHTML=(o,cust)=>o.preGift&&cust&&o.preGift.mode==="surprise"&&o.preGift.drawn&&(o.preGift.items||[]).length&&!bbOpened(o.id+"|p")?`<div class="dsec"><h4>🎁 Your pre-launch gift · ${esc(o.preGift.code||"")}</h4>${bbCardHTML(o.id+"|p")}</div>`:o.preGift?`<div class="dsec"><h4>🎁 ${o.preGift.src==="review"?(cust?"Your review reward":"Review reward to pack"):(cust?"Your pre-launch gift":"Pre-launch gift to pack")} · ${esc(o.preGift.code||"")}</h4><div class="gl">${(o.preGift.items||[]).map(g=>giftChip(g)).join("")||giftChip({name:o.preGift.mode==="surprise"&&o.preGift.drawn===false?bbName():o.preGift.soldOut?"Out of stock":o.preGift.title||"Free Gift Set"})}</div>${o.preGift.mode==="surprise"&&o.preGift.drawn===false?`<p class="note" style="margin:8px 0 0">${cust?"Your ${esc(bbName())} is picked when you send your payment proof.":"Not drawn yet. It is picked when the payment proof is sent."}</p>`:o.preGift.soldOut?`<p class="note" style="margin:8px 0 0">${cust?"Sorry, the free gifts ran out.":"No gift left in stock for this order."}</p>`:o.preGift.mode==="surprise"&&o.preGift.pool>1?`<p class="note" style="margin:8px 0 0">Picked at random from ${o.preGift.pool} gifts.</p>`:""}</div>`:"";
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
const AFF_KEY="delidome-aff-v1";let affDone=false;
function affCapture(){if(affDone)return;affDone=true;try{
  const q=new URLSearchParams(location.search),code=(q.get("ref")||"").trim().toUpperCase(),to=q.get("to")||"",cp=(q.get("cp")||"").trim().toUpperCase().slice(0,30);
  if(code&&/^[A-Z0-9_-]{2,20}$/.test(code)&&!(navigator.webdriver||/bot|crawl|spider|slurp|headless|preview/i.test(navigator.userAgent))){
    let src=(q.get("src")||"").toLowerCase().replace(/[^a-z0-9.-]/g,"").slice(0,40);
    if(!src){let h="";try{h=document.referrer?new URL(document.referrer).hostname.replace(/^www\./,""):""}catch(e){}
      src=!h||h===location.hostname?"direct":/instagram/.test(h)?"ig":/tiktok/.test(h)?"tt":/whatsapp|wa\.me/.test(h)?"wa":/facebook|fb\.com|fb\.me/.test(h)?"fb":/youtube|youtu\.be/.test(h)?"yt":/(^|\.)t\.co$|twitter|x\.com/.test(h)?"x":/google/.test(h)?"google":h.slice(0,40)}
    let vid=localStorage.getItem(VID_KEY);if(!vid){vid=uid()+uid();localStorage.setItem(VID_KEY,vid)}
    localStorage.setItem(AFF_KEY,JSON.stringify({code,src,at:Date.now()}));
    if(SBH.on&&SBH.affHit)SBH.affHit(code,vid,src)}
  if(q.get("paid"))setTimeout(dkReturn,1800);
  if(q.get("apply")==="affiliate")apOpen();
  if(q.get("affstatus"))apOpen(q.get("affstatus"));
  const sz=parseInt(q.get("size"),10),again=(fn,n=20)=>{const t=setInterval(()=>{let ok=false;try{ok=fn()}catch(e){}if(ok||--n<=0)clearInterval(t)},400)};
  if(to)again(()=>{const c=document.querySelector(`.card[data-id="${CSS.escape(to)}"]`);if(!c)return false;c.scrollIntoView({block:"center",behavior:RM?"auto":"smooth"});c.classList.add("affhl");setTimeout(()=>c.classList.remove("affhl"),2600);return true});
  if(sz>0&&!to)again(()=>{if(!activeSizes().length)return false;if(!activeSizes().some(x=>x.n===sz))return true;if(!S.editId&&S.size!==sz)setSize(sz);
    const b=document.querySelector(`.size[data-size="${sz}"]`);if(!b)return false;b.scrollIntoView({block:"center",behavior:RM?"auto":"smooth"});b.classList.add("affhl");setTimeout(()=>b.classList.remove("affhl"),2600);return true});
  if(cp){const i=document.getElementById("cpnIn");if(i&&!i.value)i.value=cp}
  if(code||to||cp||sz>0)history.replaceState(null,"",location.pathname+location.hash);
}catch(e){}}
function trackVisit(){affCapture();
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
function mqNorm(u){u=String(u||"").trim();if(!/^https:\/\//i.test(u))return {err:"Paste a link that starts with https://"};
  let m=u.match(/^https:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers|clips)\/(?:[^\/?#]*-)?([A-Za-z0-9]+)(?:[\/?#]|$)/i);if(m)return {url:`https://media.giphy.com/media/${m[1]}/giphy.gif`};
  if(/^https:\/\/www\.dropbox\.com\//i.test(u))return {url:u.replace("://www.dropbox.com","://dl.dropboxusercontent.com").replace(/([?&])dl=0&?/,"$1").replace(/[?&]$/,"")};
  if(/^https:\/\/([a-z0-9-]+\.)?(instagram|tiktok|facebook|fb)\.com\/|tenor\.com\/view|drive\.google\.com\/|photos\.app\.goo\.gl|pin\.it\/|pinterest\./i.test(u))return {err:"That link is a web page, not the picture or video file itself. Use a direct link to the file (ending in .mp4, .webm or .gif), a YouTube or Vimeo link, or upload a small file."};
  return {url:u}}
const mqIsVideo=s=>/^data:video\//i.test(s||"")||/\.(mp4|webm|m4v|mov)(\?[^#]*)?(#.*)?$/i.test(s||"");
function mqSeq(m,n){ // n repeats. "both": a random photo after each sentence (never the same twice in a row); "pics": only the photos; "text": only sentences
  const out=[],imgs=m.images||[],L=m.links||[],mode=m.mode||"both";let last=-1;
  const pic=i=>{const rich=m.noFont||m.rich,src=rich?safeMedia(imgs[i]):imgOk(imgs[i]);if(!src)return "";const yt=rich?ytId(src):"",vm=rich&&!yt?vimeoId(src):"";
    const im=yt||vm?`<span class="mv${/shorts\//i.test(src)?" v916":""}"><iframe src="${yt?`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=1&loop=1&playlist=${yt}&controls=0&playsinline=1&rel=0&modestbranding=1&disablekb=1`:`https://player.vimeo.com/video/${vm}?background=1&autoplay=1&muted=1&loop=1&dnt=1`}" title="" tabindex="-1" aria-hidden="true" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`:mqIsVideo(src)?`<video class="mi" src="${esc(src)}" muted loop autoplay playsinline preload="metadata"></video>`:`<img class="mi" src="${esc(src)}" alt="" draggable="false">`,lk=safeUrl(L[i]);return lk?`<a class="mia" href="${esc(lk)}" ${lk[0]==="#"?"":'target="_blank" rel="noopener"'}>${im}</a>`:im};
  for(let k=0;k<n;k++){
    if(mode==="pics"&&imgs.length){imgs.forEach((u,i)=>out.push(pic(i)))}
    else m.texts.forEach(t=>{out.push(`<span class="mt">${esc(t)}</span>`);
      if(mode!=="text"&&imgs.length){let i=Math.floor(Math.random()*imgs.length);if(imgs.length>1&&i===last)i=(i+1+Math.floor(Math.random()*(imgs.length-1)))%imgs.length;last=i;out.push(pic(i))}
      else out.push(`<span class="mdot" aria-hidden="true">✦</span>`)})}
  return out.join("");
}
function renderMarquee(el,m){
  if(!el)return;m=m||DB.marquee;
  const texts=(m.texts||[]).filter(Boolean),pics=(m.images||[]).filter(u=>(m.noFont||m.rich)?safeMedia(u):imgOk(u));
  el.hidden=!m.on||((m.mode||"both")==="pics"?!pics.length:!texts.length);if(el.hidden)return;
  if(!m.noFont)mqEnsureFont(m);
  el.style.setProperty("--mbg",m.bg);el.style.setProperty("--mfg",m.color);el.style.setProperty("--msz",(MQ_SIZE[m.size]||18)+"px");{const ih=Math.max(0,Math.min(300,+m.imgH||0));el.style.setProperty("--mih",ih?ih+"px":"2.2em");el.classList.toggle("bigimg",ih>0)}el.style.setProperty("--mfont",mqFamily(m));
  el.setAttribute("aria-label",texts.join(". "));
  el._m={...m,texts};mqBuild(el);
}
function mqVids(el,on){el.querySelectorAll("video").forEach(v=>{if(on){const pl=v.play();if(pl&&pl.catch)pl.catch(()=>{})}else v.pause()})}
function mqTap(el,tap){
  el.querySelectorAll("img.mi").forEach(im=>{if(im._fb)return;im._fb=1;im.addEventListener("error",()=>{const v=document.createElement("video");v.className="mi";v.muted=true;v.loop=true;v.autoplay=true;v.playsInline=true;v.addEventListener("error",()=>{(v.parentNode&&v.parentNode.classList.contains("mia")?v.parentNode:v).remove()});v.src=im.src;im.replaceWith(v);const pl=v.play();if(pl&&pl.catch)pl.catch(()=>{})})});
  el.querySelectorAll("video.mi").forEach(v=>{if(v._fb)return;v._fb=1;v.addEventListener("error",()=>{(v.parentNode&&v.parentNode.classList.contains("mia")?v.parentNode:v).remove()})});
  if(!tap||el._tp)return;el._tp=1;let last=0;
  el.addEventListener("click",e=>{if(e.target.closest("a"))return;const t=Date.now(),dbl=t-last<450;last=t;if(dbl){el.classList.remove("paused");mqVids(el,true)}else{el.classList.add("paused");mqVids(el,false)}})}
function mqBuild(el){
  const m=el._m;if(!m)return;
  el.classList.toggle("still",RM);
  const draw=n=>{const set=mqSeq(m,n);el.innerHTML=`<div class="track"><div class="set">${set}</div><div class="set" aria-hidden="true">${set}</div></div>`};
  draw(1);
  const cw=el.clientWidth;if(!cw)return; // hidden: re-fit when shown
  const w1=el.querySelector(".set").scrollWidth||1;
  const n=Math.max(1,Math.ceil(cw/w1));
  if(n>1)draw(n);
  el.querySelectorAll("video").forEach(v=>{v.muted=true;if(el.classList.contains("paused"))v.pause();else{const pl=v.play();if(pl&&pl.catch)pl.catch(()=>{})}});
  if(m.noFont||m.rich)mqTap(el,!!m.noFont);
  const w=el.querySelector(".set").scrollWidth;
  el.style.setProperty("--mdur",Math.max(6,w/(MQ_SPEED[m.speed]||70))+"s");
}
function mqFit(){document.querySelectorAll(".marq").forEach(el=>{if(el._m&&!el.hidden)mqBuild(el);else if(el._ai&&!el.hidden)anMqBuild(el)})}
const LP_DEFAULT_SVG=`<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M3 21a12 12 0 0 1 24 0Z" fill="currentColor"/><circle cx="15" cy="5" r="2.6" fill="currentColor"/><rect x="1" y="20.5" width="28" height="3" rx="1.5" fill="currentColor"/></svg>`;
function defaultPage(){return {name:"delidome",logo:"",brand:"#000096",bg:"#ffffff",xtra:{on:true,text:"Flavors marked with a price cost that much extra per cookie.",icon:"✨",bg:"#FFF4D6",ink:"#5A4300",line:"#FFD166",fx:"shine",size:"M",shape:"rounded"},
  favicon:{mode:"auto",img:"",emoji:"🍪",bg:""},
  logoSize:0,nameShow:true,nameSize:0,bb:{name:"Blind box",img:"",fx:"wiggle",speed:100,size:120,tip:"Tap the box to open it!"},nameSide:"right",logoPos:{m:"normal",x:0,y:0},adm:{name:"",show:true,size:0,logo:""},
  mq2:{on:false,noFont:true,texts:["Hello there! Fresh cookies, baked daily"],images:[],links:[],mode:"both",imgH:0,bg:"#000096",color:"#ffffff",font:"display",size:"M",speed:"medium"},bgx:{mode:"off",color:"",img:"",fit:"cover",veil:25,op:100,shop:true,aff:true,admin:true},
  snow:{on:false,icon:"❄️",imgs:[],n:40,speed:4,size:30,op:80,layer:"front",sway:true,spin:false,shop:true,aff:true,admin:false},ink:"#0B0B45",headFont:"display",bodyFont:"body",fonts:[],
  hero:{eyebrow:"Baked fresh every morning",title:"Warm cookies, boxed your way.",lede:"Pick a box, fill it with the flavors you love, and choose when you want it. Pickup or local delivery.",btn1:"Build a box",btn2:"See the flavors",bg:"",color:"#ffffff",mediaType:"none",src:"",overlay:35,floats:true,cookies:["","","","","",""],media:[],carousel:true,carouselSec:5,waitVideo:true,swipe:true,shape:"dome",size:"auto",fit:"cover",hPh:360,hPc:480,btnPh:null,btnPc:null},
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
const ytId=s=>(String(s||"").match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)||[])[1]||"";
const vimeoId=s=>(String(s||"").match(/vimeo\.com\/(?:video\/)?(\d+)/)||[])[1]||"";
const isVideoSrc=s=>/^data:video\//i.test(s)||/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(s)||!!ytId(s)||!!vimeoId(s);
function videoHTML(src,{bg=false,loop=true}={}){
  src=safeMedia(src);if(!src)return "";
  if(/^data:video\//i.test(src)||/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(src))
    return bg?`<video src="${esc(src)}" autoplay muted${loop?" loop":""} playsinline preload="metadata"></video>`:`<video src="${esc(src)}" controls playsinline preload="metadata"></video>`;
  // YouTube / Vimeo links play muted and looping behind the words (no controls)
  if(bg){const ifr=(u,tall)=>`<div class="vbg${tall?" v916":""}"><iframe src="${u}" title="" tabindex="-1" aria-hidden="true" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    const y=ytId(src);if(y)return ifr(`https://www.youtube-nocookie.com/embed/${y}?autoplay=1&mute=1${loop?`&loop=1&playlist=${y}`:""}&controls=0&playsinline=1&rel=0&modestbranding=1&disablekb=1&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`,/shorts\//i.test(src));
    const v=vimeoId(src);if(v)return ifr(`https://player.vimeo.com/video/${v}?background=1&autoplay=1&muted=1&loop=${loop?1:0}&dnt=1`);
    return ""}
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
  const hm=q(".hm");hm.innerHTML="";hm.style.backgroundImage="";clearInterval(dome._car);clearTimeout(dome._car);
  let list=heroList(h);if(!(h.carousel!==false))list=list.slice(0,1);
  const multi=list.length>1,waitV=multi&&h.waitVideo!==false;
  list.forEach((m,i)=>{const src=safeMedia(m.src),sl=document.createElement("div");sl.className="hs"+(i?"":" on");
    if(m.type==="video"||isVideoSrc(src)){const v=videoHTML(src,{bg:true,loop:!waitV});if(!v)return;sl.innerHTML=v;sl.dataset.vid="1";
      // a linked video only loads while its slide is showing (it starts from the beginning each time)
      const f=sl.querySelector("iframe");if(f&&multi){f.dataset.src=f.src;f.removeAttribute("src")}}
    else sl.style.backgroundImage=`url("${imgOk(src).replace(/["()\\\s]/g,c=>encodeURIComponent(c))}")`;
    hm.appendChild(sl)});
  const sls=hm.querySelectorAll(".hs"),hasM=sls.length>0;
  heroCar(dome,h,[...sls]);
  const shp=heroShapes().some(x=>x[0]===h.shape)?h.shape:"dome";heroShapes().forEach(x=>dome.classList.remove("shape-"+x[0]));dome.classList.add("shape-"+shp);dome.classList.toggle("nomedia",!hasM);
  const frm=heroFrameApply(dome,h,hasM);
  if(shp==="none"){dome.style.background=hasM?"#000":"transparent";if(!hasM&&/^#fff(fff)?$/i.test(h.color||"#ffffff"))dome.style.color=""}
  q(".ho").style.opacity=hasM?(Math.max(0,Math.min(90,+h.overlay||0))/100):0;
  heroFloats(dome,h);
  [h.b1,h.b2].forEach((st,i)=>{const a=ab[i];[...a.classList].filter(c=>/^hb/.test(c)).forEach(c=>a.classList.remove(c));if(!st)return;
    a.classList.add("hbc","hb-"+fxOk(st.shape,HB_SHAPES.map(x=>x[0]),"pill"),"hbz-"+fxOk(st.size,["S","M","L","A"],"M"),"hbfx-"+fxOk(st.fx,HB_FX.map(x=>x[0]),"none"));
    a.style.setProperty("--hb-bg",st.fill===false?"transparent":hexOk(st.bg,"#ffffff"));a.style.setProperty("--hb-ink",hexOk(st.ink,"#000096"));
    a.style.setProperty("--hb-line",hexOk(st.line,"#ffffff"));a.style.setProperty("--hb-glow",hexOk(st.fill===false?st.line:st.bg,"#ffffff"))});
  dome.classList.toggle("fit-contain",h.fit==="contain");
  dome._h=h;dome._ratio=null;
  if(hasM&&!frm&&(h.size||"auto")==="auto")heroRatio(list[0],r=>{if(dome._h===h){dome._ratio=r;heroLayout(dome)}});
  heroLayout(dome);
}
const HERO_BP=640,HR_RATIO=new Map();
function heroCar(dome,h,sls){
  if(!window._hk){window._hk=1;["touchstart","pointerdown","click","scroll","keydown"].forEach(ev=>addEventListener(ev,heroKick,{passive:true,capture:true}))}
  const n=sls.length,old=dome.querySelector(".hdots");if(old)old.remove();dome._go=null;dome._cur=null;dome.classList.remove("swipe");
  if(!n)return;
  const wait=h.waitVideo!==false,sec=Math.max(2,Math.min(30,+h.carouselSec||5))*1000;let k=0,dots=null;
  const vEl=sl=>sl.querySelector("video"),fEl=sl=>sl.querySelector("iframe");
  const wake=sl=>{const v=vEl(sl),f=fEl(sl);if(v){try{v.currentTime=0}catch(e){}v.muted=true;v.playsInline=true;const pl=v.play();if(pl&&pl.catch)pl.catch(()=>{})}if(f&&f.dataset.src)f.src=f.dataset.src};
  const sleep=sl=>{const v=vEl(sl),f=fEl(sl);if(v)v.pause();if(f&&f.dataset.src)f.removeAttribute("src")};
  if(n<2)return;
  const arm=()=>{clearTimeout(dome._car);if(!dome.isConnected)return;dome._car=setTimeout(()=>go(1),wait&&sls[k].dataset.vid?300000:sec)};
  const go=d=>{if(!dome.isConnected){clearTimeout(dome._car);return}sls[k].classList.remove("on");sleep(sls[k]);k=(k+d+n)%n;sls[k].classList.add("on");wake(sls[k]);dome._cur=sls[k];
    if(dots)[...dots.children].forEach((b,i)=>b.setAttribute("aria-current",i===k?"true":"false"));arm()};
  sls.forEach((sl,i)=>{const v=vEl(sl);if(v){if(i)v.removeAttribute("autoplay");v.addEventListener("ended",()=>{if(wait&&sls[k]===sl)go(1)});v.addEventListener("error",()=>{if(sls[k]===sl){clearTimeout(dome._car);dome._car=setTimeout(()=>go(1),sec)}})}
    const f=fEl(sl);if(f)f.addEventListener("load",()=>{if(!f.getAttribute("src"))return;try{f.contentWindow.postMessage(JSON.stringify(/vimeo/.test(f.src)?{method:"addEventListener",value:"ended"}:{event:"listening",id:i,channel:"widget"}),"*")}catch(e){}})});
  dome._end=f=>{if(wait&&dome._cur&&fEl(dome._cur)===f)go(1)};
  dome._cur=sls[0];wake(sls[0]);arm();
  if(h.swipe!==false){dome._go=go;dome.classList.add("swipe");
    dots=document.createElement("div");dots.className="hdots";dots.innerHTML=sls.map((_,i)=>`<button type="button" aria-label="Show slide ${i+1}" aria-current="${i===0}"></button>`).join("");
    dots.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const i=[...dots.children].indexOf(b);if(i!==k)go(i-k)});dome.appendChild(dots);
    if(!dome._sw){dome._sw=1;let x0=null,y0=0;
      dome.addEventListener("pointerdown",e=>{if(!dome._go||e.target.closest("a,button,.hero-ctas"))return;x0=e.clientX;y0=e.clientY});
      dome.addEventListener("pointerup",e=>{if(x0===null||!dome._go)return;const dx=e.clientX-x0,dy=e.clientY-y0;x0=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3)dome._go(dx<0?1:-1)});
      dome.addEventListener("pointercancel",()=>{x0=null})}}}
function heroKick(){document.querySelectorAll(".dome .hm video").forEach(v=>{const sl=v.closest(".hs");if(sl&&sl.parentNode.children.length>1&&!sl.classList.contains("on"))return;if(v.paused){v.muted=true;const pl=v.play();if(pl&&pl.catch)pl.catch(()=>{})}})}
const heroMsg=e=>{if(!/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)$/.test(e.origin))return;let d=e.data;try{if(typeof d==="string")d=JSON.parse(d)}catch(x){return}if(!d)return;
  const ended=d.event==="ended"||(d.event==="onStateChange"&&d.info===0)||(d.event==="infoDelivery"&&d.info&&d.info.playerState===0);if(!ended)return;
  document.querySelectorAll(".dome .hm iframe").forEach(f=>{if(f.contentWindow===e.source){const dm=f.closest(".dome");if(dm&&dm._end)dm._end(f)}})};addEventListener("message",heroMsg);
const HB_SHAPES=[["pill","Pill"],["rounded","Rounded box"],["square","Square box"],["circle","Circle"]];
const HB_FX=[["none","Still"],["pulse","Pulse"],["bounce","Bounce"],["shine","Shine"],["glow","Glow"],["wiggle","Wiggle"]];
function heroRatio(m,cb){const src=safeMedia(m&&m.src);if(!src)return;if(HR_RATIO.has(src)){cb(HR_RATIO.get(src));return}
  const done=r=>{if(r>0&&isFinite(r)){r=Math.max(.4,Math.min(4,r));HR_RATIO.set(src,r);cb(r)}};
  if(ytId(src)){done(/shorts\//i.test(src)?9/16:16/9);return}
  if(vimeoId(src)){done(16/9);return}
  if(m.type==="video"||isVideoSrc(src)){const v=document.createElement("video");v.muted=true;v.preload="metadata";v.onloadedmetadata=()=>done(v.videoWidth/v.videoHeight);v.src=src;return}
  const im=new Image();im.onload=()=>done(im.naturalWidth/im.naturalHeight);im.src=imgOk(src)}
const HERO_FRAMES={"16:9":16/9,"1:1":1,"4:5":.8,"9:16":.5625};
const heroFr=(h,dev)=>h[dev==="pc"?"fPc":"fPh"]||{frame:h.frame,frameW:h.frameW,frameCr:h.frameCr};
function heroFrameApply(dome,h,hasM){
  const dev=dome._dev||(innerWidth>HERO_BP?"pc":"ph"),F=heroFr(h,dev),full=!F.frame||F.frame==="full",fw=Math.max(30,Math.min(100,+F.frameW||(full?100:60)));
  const edge=!!F.edge,frm=!!hasM&&(full?(!edge&&(fw<100||F.frameCr==="square")):HERO_FRAMES[F.frame]!==undefined);
  dome.classList.toggle("edge",edge);if(edge)dome.style.setProperty("--ecr",F.edgeCr==="square"?"0px":"28px");else dome.style.removeProperty("--ecr");
  dome.classList.toggle("framed",frm);dome.classList.toggle("framefull",frm&&full);
  if(frm){dome.style.setProperty("--far",full?"auto":HERO_FRAMES[F.frame]);dome.style.setProperty("--fw",fw+"%");dome.style.setProperty("--fcr",F.frameCr==="square"?"0px":"22px")}
  else["--far","--fw","--fcr"].forEach(v=>dome.style.removeProperty(v));
  return frm}
function heroLayout(dome){const h=dome&&dome._h;if(!h)return;heroFrameApply(dome,h,!dome.classList.contains("nomedia"));
  const dev=dome._dev||(innerWidth>HERO_BP?"pc":"ph"),size=h.size||"auto",w=dome.clientWidth;let mh=0;
  if(dome.classList.contains("framed")){}
  else if(size==="custom")mh=dev==="pc"?Math.max(260,Math.min(1000,+h.hPc||480)):Math.max(220,Math.min(900,+h.hPh||360));
  else if(size==="auto"&&dome._ratio&&w)mh=Math.round(Math.min(w/dome._ratio,innerHeight*(dome._dev?.6:.9)));
  dome.style.minHeight=mh?mh+"px":"";dome.classList.toggle("hsz",!!mh);
  const bp=h[dev==="pc"?"btnPc":"btnPh"],c=dome.querySelector(".hero-ctas"),ok=bp&&isFinite(bp.x)&&isFinite(bp.y);
  dome.classList.toggle("btnfree",!!ok);if(c){c.style.left=ok?bp.x+"%":"";c.style.top=ok?bp.y+"%":""}}
let heroRz=0;addEventListener("resize",()=>{cancelAnimationFrame(heroRz);heroRz=requestAnimationFrame(()=>document.querySelectorAll(".dome").forEach(heroLayout))});
function heroShapes(){return [["dome","Dome (arch top)"],["rounded","Rounded box"],["pill","Pill"],["capsule","Capsule (round top and bottom)"],["oval","Oval"],["leaf","Leaf"],["none","No shape"]]}
function heroList(h){const L=(h.media||[]).filter(m=>m&&safeMedia(m.src));if(L.length)return L;
  return h.mediaType&&h.mediaType!=="none"&&safeMedia(h.src)?[{type:h.mediaType,src:h.src}]:[]}
function heroNorm(h){const c=anClone(h);if(!Array.isArray(c.media))c.media=[];if(!c.media.length&&c.mediaType&&c.mediaType!=="none"&&c.src)c.media=[{type:c.mediaType,src:c.src}];c.mediaType="none";c.src="";return c}
let favKey="";
function lpFavicon(pg){
  const F=pg.favicon||{},mode=["auto","own","emoji"].includes(F.mode)?F.mode:"auto",own=mode==="own"?safeMedia(F.img):"",emo=mode==="emoji"?(String(F.emoji||"").trim().slice(0,4)||"🍪"):"";
  // replace the <link> itself (Safari and Firefox ignore a changed href on the old one)
  const swap=(rel,href,type,sizes)=>{document.querySelectorAll(`link[rel="${rel}"]`).forEach(x=>x.remove());if(!href)return;const n=document.createElement("link");n.rel=rel;if(type)n.type=type;if(sizes)n.sizes=sizes;n.href=href;document.head.appendChild(n)};
  const lg=own||safeMedia(pg.logo),bgc=/^#[0-9a-f]{6}$/i.test(F.bg||"")?F.bg:"",key=emo?"e"+emo+bgc:lg?"i"+lg.length+lg.slice(-30)+bgc:"d"+pg.brand;if(key===favKey)return;favKey=key;
  const dflt=()=>{swap("icon","data:image/svg+xml,"+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 24"><path d="M3 21a12 12 0 0 1 24 0Z" fill="${pg.brand}"/><circle cx="15" cy="5" r="2.6" fill="${pg.brand}"/><rect x="1" y="20.5" width="28" height="3" rx="1.5" fill="${pg.brand}"/></svg>`),"image/svg+xml");swap("apple-touch-icon","")};
  const png=(n,draw,solid)=>{const c=document.createElement("canvas");c.width=c.height=n;const x=c.getContext("2d");if(bgc||solid){x.fillStyle=bgc||"#ffffff";x.fillRect(0,0,n,n)}draw(x,n);return c.toDataURL("image/png")};
  if(emo){try{const dr=(x,n)=>{x.font=`${Math.round(n*.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;x.textAlign="center";x.textBaseline="middle";x.fillText(emo,n/2,n*.54)};swap("icon",png(64,dr),"image/png");swap("apple-touch-icon",png(180,dr,true),"image/png","180x180")}catch(e){dflt()}return}
  if(!lg){dflt();return}
  // a picture on the shop's storage is loaded "with CORS" so it can be drawn on a canvas; if that is refused, the picture itself is used as the icon
  const direct=()=>{swap("icon",lg);swap("apple-touch-icon",lg,"","180x180")};
  const im=new Image();if(!/^data:/i.test(lg))im.crossOrigin="anonymous";
  im.onload=()=>{if(favKey!==key)return;try{const iw=im.naturalWidth||256,ih=im.naturalHeight||256,dr=(x,n)=>{const k=Math.min(n/iw,n/ih),w=iw*k,h=ih*k;x.drawImage(im,(n-w)/2,(n-h)/2,w,h)};swap("icon",png(64,dr),"image/png");swap("apple-touch-icon",png(180,dr,true),"image/png","180x180")}catch(e){direct()}};
  im.onerror=()=>{if(favKey!==key)return;if(/^data:/i.test(lg))dflt();else direct()};im.src=lg;
}
const HDR_SHAPES=["none","pill","rounded","square"],HDR_ISHAPES=["circle","rounded","square"],HDR_BAR=["flat","rounded","float","pill"];
function applyHeader(){const t=DB.settings,top=$(".top"),lg=$(".top .logo"),on=!!t.hdrOn;if(!top)return;top.classList.toggle("lgnotxt",!!(DB.page&&DB.page.nameShow===false));
  top.classList.toggle("hdc",on);HDR_BAR.forEach(k=>top.classList.remove("hbs-"+k));if(on)top.classList.add("hbs-"+fxOk(t.hdrShape,HDR_BAR,"flat"));lg.className="logo"+(on?" lgs-"+fxOk(t.hdrLogoShape,HDR_SHAPES,"none"):"");
  const ic=["#bellBtn","#moBtn"].map(x=>$(x)).filter(Boolean);ic.forEach(b=>{HDR_ISHAPES.forEach(k=>b.classList.remove("ics-"+k));if(on)b.classList.add("ics-"+fxOk(t.hdrIconShape,HDR_ISHAPES,"circle"))});
  const v={"--hd-bg":t.hdrBg,"--lg-bg":t.hdrLogoBg,"--lg-ink":t.hdrLogoInk,"--ic-bg":t.hdrIconBg,"--ic-ink":t.hdrIconInk,"--ic-line":t.hdrIconLine,"--hd-line":t.hdrLine,"--pl-bg":t.hdrPillBg,"--pl-ink":t.hdrPillInk,"--pl-line":t.hdrPillLine,"--pn-bg":t.hdrNumBg,"--pn-ink":t.hdrNumInk};
  for(const k in v){if(on&&HEX_OK.test(v[k]||""))top.style.setProperty(k,v[k]);else top.style.removeProperty(k)}}
function renderLanding(){
  const pg=DB.page,sv=$("#storeView");if(!pg||!sv)return;
  lpEnsureFonts(pg);
  sv.style.setProperty("--blue",pg.brand);sv.style.setProperty("--ink",pg.ink);
  sv.style.setProperty("--display",lpFamily(pg.headFont,pg,"head"));sv.style.setProperty("--body",lpFamily(pg.bodyFont,pg,"body"));
  document.documentElement.style.setProperty("--pagebg",pg.bg);
  const nm=pg.name||"delidome";document.title=`${nm} Cookie Boxes`;
  $("#brandTxt").textContent=nm;$("#ftBrand").textContent=nm;$(".top .logo").setAttribute("aria-label",`${nm} home`);
  const lg=safeMedia(pg.logo);const mark=lg?`<img src="${esc(lg)}" alt="">`:LP_DEFAULT_SVG;$("#logoMark").innerHTML=mark;$("#ftMark").innerHTML=mark;
  lpFavicon(pg);applyHeader();applyBrandSize();applyXtra();applyBgx();applySnow();renderMarquee($("#marq2"),pg.mq2);
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
function applyBgx(){const pg=DB.page;if(!pg||!document.body)return;const b=Object.assign({mode:"off",color:"",img:"",fit:"cover",veil:25,op:100,shop:true,aff:true,admin:true},pg.bgx||{}),h=document.documentElement;
  let L=document.getElementById("pgBg");if(!L){L=document.createElement("div");L.id="pgBg";L.setAttribute("aria-hidden","true");document.body.insertBefore(L,document.body.firstChild)}
  const col=/^#[0-9a-f]{6}$/i.test(b.color||"")?b.color:(/^#[0-9a-f]{6}$/i.test(pg.bg||"")?pg.bg:"#ffffff"),u=b.mode==="image"?safeMedia(b.img):"";
  const on=b.mode==="color"||(b.mode==="image"&&!!u);h.classList.toggle("bgx-shop",on&&b.shop!==false);h.classList.toggle("bgx-aff",on&&b.aff!==false);h.classList.toggle("bgx-admin",on&&b.admin!==false);
  const st=L.style;st.cssText="";if(!on)return;st.backgroundColor=col;st.opacity=String(Math.max(10,Math.min(100,+b.op||100))/100);
  if(u){st.backgroundImage=`url("${String(u).replace(/["\\]/g,"")}")`;st.backgroundSize=b.fit==="tile"?"auto":"cover";st.backgroundRepeat=b.fit==="tile"?"repeat":"no-repeat";st.setProperty("--bgx-veil",String(Math.max(0,Math.min(90,+b.veil||0))/100))}}
const XCLS="xsz-S xsz-M xsz-L xsh-rounded xsh-pill xsh-square xfx-none xfx-pulse xfx-shine xfx-glow xfx-bounce xfx-wiggle"; // listed in full so the shop keeps their styles
function xtraDraw(el,x){x=x||{};const fx=["none","pulse","shine","glow","bounce","wiggle"].includes(x.fx)?x.fx:"none",sz=["S","M","L"].includes(x.size)?x.size:"M",sh=["rounded","pill","square"].includes(x.shape)?x.shape:"rounded";
  el.className="hint xhint xsz-"+sz+" xsh-"+sh+" xfx-"+fx;el.style.setProperty("--xbg",hexOk(x.bg,"#FFF4D6"));el.style.setProperty("--xink",hexOk(x.ink,"#5A4300"));el.style.setProperty("--xline",hexOk(x.line,"#FFD166"));
  el.innerHTML=`${String(x.icon||"").trim()?`<span class="xic" aria-hidden="true">${esc(String(x.icon).trim().slice(0,4))}</span>`:""}<span class="xtx">${esc(x.text||"")}</span>`}
function applyXtra(){const pg=DB.page,el=document.getElementById("xtraHint");if(!el||!pg||!pg.xtra)return;xtraDraw(el,pg.xtra)}
function admBrandHTML(){const pg=DB.page||{},a=pg.adm||{},lg=safeMedia(a.logo)||safeMedia(pg.logo),z=Math.max(0,Math.min(72,+a.size||0))||28;
  const mk=lg?`<img src="${esc(lg)}" alt="" style="height:${z}px;width:auto;border-radius:6px;display:block">`:LP_DEFAULT_SVG.replace(/currentColor/g,"#fff").replace("<svg ",`<svg style="height:${z}px;width:auto" `);
  return `<span style="display:inline-flex;align-items:center;margin-right:${a.show===false?0:8}px">${mk}</span>${a.show===false?"":esc(admName())+" "}<small>Affiliate</small>`}
const admName=()=>{const a=(DB.page&&DB.page.adm)||{};return a.name||(DB.page&&DB.page.name)||"delidome"};
function applyBrandSize(){const pg=DB.page,top=document.querySelector(".top");if(!pg||!top)return;const z=Math.max(0,Math.min(72,+pg.logoSize||0));top.classList.toggle("lgnotxt",pg.nameShow===false);const ns=Math.max(0,Math.min(40,+pg.nameSize||0));top.classList.toggle("nmsz",ns>0);if(ns)document.documentElement.style.setProperty("--nm-size",ns+"px");else document.documentElement.style.removeProperty("--nm-size");top.classList.toggle("lgsz",z>0);top.classList.toggle("nmtop",pg.nameSide==="top");top.classList.toggle("nmbot",pg.nameSide==="bottom");const lp=pg.logoPos||{},rt=document.documentElement.style;top.classList.toggle("lgcorner",lp.m==="corner");top.classList.toggle("lgfree",lp.m==="custom");
  if(lp.m==="custom"){rt.setProperty("--lg-x",Math.max(-200,Math.min(200,+lp.x||0))+"px");rt.setProperty("--lg-y",Math.max(-30,Math.min(30,+lp.y||0))+"px")}else{rt.removeProperty("--lg-x");rt.removeProperty("--lg-y")}if(z)document.documentElement.style.setProperty("--logo-h",z+"px");else document.documentElement.style.removeProperty("--logo-h")}
function applyAdminBrand(){const pg=DB.page,box=document.getElementById("adLogo");if(!pg||!box)return;const a=pg.adm||{},mk=document.getElementById("adLogoMark"),nm=document.getElementById("adLogoName"),z=Math.max(0,Math.min(72,+a.size||0));
  const lg=safeMedia(a.logo)||safeMedia(pg.logo);if(lg)mk.innerHTML=`<img src="${esc(lg)}" alt="">`;else if(!mk.querySelector("svg"))mk.innerHTML=LP_DEFAULT_SVG.replace(/currentColor/g,"#fff");
  nm.textContent=admName();nm.hidden=a.show===false;box.classList.toggle("lgsz",z>0);if(z)box.style.setProperty("--ad-logo-h",z+"px");else box.style.removeProperty("--ad-logo-h")}
const SNOW={cv:null,ctx:null,fl:[],spr:[],key:"",raf:0,last:0,w:0,h:0,dpr:1,run:false,iv:0};
const snowScope=()=>{const c=document.body.classList;return c.contains("aff-on")?"aff":c.contains("in-store")?"shop":"admin"};
function snowStop(){SNOW.run=false;cancelAnimationFrame(SNOW.raf);if(SNOW.cv)SNOW.cv.style.display="none";const d=document.getElementById("snowDom");if(d)d.style.display="none"}
const snowApple=()=>/AppleWebKit/.test(navigator.userAgent)&&!/Chrome\/|Chromium|Edg\/|Android|OPR\//.test(navigator.userAgent)||/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
function snowDom(S,z,op){let d=document.getElementById("snowDom");if(!d){d=document.createElement("div");d.id="snowDom";d.setAttribute("aria-hidden","true");const a=SNOW.cv;document.body.insertBefore(d,a?a.nextSibling:document.body.firstChild)}
  const cl=(v,a,b,df)=>Math.max(a,Math.min(b,+v||df)),n=cl(S.n,5,200,40),mx=cl(S.size,8,120,30),sp=cl(S.speed,1,10,4),imgs=(S.imgs||[]).map(imgOk).filter(Boolean),icon=String(S.icon||"❄️").trim().slice(0,4)||"❄️";
  const key=JSON.stringify([n,mx,sp,imgs,icon,S.sway,S.spin,innerHeight]);
  if(d._k!==key){d._k=key;let h="";const base=22+sp*22,H=innerHeight;
    for(let i=0;i<n;i++){const sz=mx*(.55+.45*Math.random()),v=base*(.6+.8*sz/mx),dur=(H*1.3+sz*2)/v,am=S.sway===false?0:8+Math.random()*26;
      h+=`<i style="left:${(Math.random()*100).toFixed(1)}%;--s:${sz.toFixed(0)}px;--dur:${dur.toFixed(1)}s;--dl:-${(Math.random()*dur).toFixed(1)}s"><b style="--sw:${am.toFixed(0)}px;--sd:${(1.6+Math.random()*2.4).toFixed(1)}s">${imgs.length?`<img src="${esc(imgs[i%imgs.length])}" alt="" draggable="false">`:`<span>${esc(icon)}</span>`}</b></i>`}
    d.innerHTML=h}
  d.classList.toggle("spin",!!S.spin);const st=d.style;st.display="block";st.zIndex=z;st.opacity=op}
function snowSprites(S){const key=JSON.stringify([S.icon,S.imgs]);if(key===SNOW.key)return;SNOW.key=key;SNOW.fl=[];SNOW.spr=[];
  const emoji=()=>{const c=document.createElement("canvas");c.width=c.height=96;const x=c.getContext("2d");x.font='72px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';x.textAlign="center";x.textBaseline="middle";x.fillText(String(S.icon||"❄️").slice(0,4),48,52);SNOW.spr.push(c)};
  const list=(S.imgs||[]).map(imgOk).filter(Boolean);if(!list.length){emoji();return}
  let left=list.length;list.forEach(src=>{const im=new Image();im.onload=()=>{SNOW.spr.push(im);left--};im.onerror=()=>{left--;if(left<=0&&!SNOW.spr.length)emoji()};im.src=src})} // a picture the phone can't open falls back to the icon
function snowFlake(S,top){const mx=Math.max(8,Math.min(120,+S.size||30)),sz=mx*(.55+.45*Math.random());
  return {x:Math.random()*SNOW.w,y:top?-sz-Math.random()*SNOW.h*.2:Math.random()*SNOW.h,s:sz,k:Math.random(),ph:Math.random()*6.28,sw:.6+Math.random()*1.2,am:S.sway===false?0:8+Math.random()*26,rot:Math.random()*6.28,rs:S.spin?(Math.random()-.5)*1.6:0,sp:0}}
function snowFrame(t){if(!SNOW.run)return;SNOW.raf=requestAnimationFrame(snowFrame);const S=DB.page&&DB.page.snow;if(!S||document.hidden){SNOW.last=t;return}
  const dt=Math.min(.05,(t-(SNOW.last||t))/1000);SNOW.last=t;const ctx=SNOW.ctx,n=Math.max(5,Math.min(200,+S.n||40)),base=22+Math.max(1,Math.min(10,+S.speed||4))*22;
  while(SNOW.fl.length<n)SNOW.fl.push(snowFlake(S,false));if(SNOW.fl.length>n)SNOW.fl.length=n;
  ctx.clearRect(0,0,SNOW.cv.width,SNOW.cv.height);if(!SNOW.spr.length)return;
  for(let i=0;i<SNOW.fl.length;i++){const f=SNOW.fl[i];f.y+=base*(.6+.8*f.s/Math.max(8,+S.size||30))*dt;f.ph+=f.sw*dt;f.rot+=f.rs*dt;const x=f.x+Math.sin(f.ph)*f.am;
    if(f.y>SNOW.h+f.s){SNOW.fl[i]=snowFlake(S,true);continue}
    const im=SNOW.spr[i%SNOW.spr.length];ctx.save();ctx.translate((x)*SNOW.dpr,f.y*SNOW.dpr);if(f.rs)ctx.rotate(f.rot);const w=f.s*SNOW.dpr,r=(im.naturalWidth||im.width)&&(im.naturalHeight||im.height)?(im.naturalHeight||im.height)/(im.naturalWidth||im.width):1;ctx.drawImage(im,-w/2,-w*r/2,w,w*r);ctx.restore()}}
function snowSize(){if(!SNOW.cv)return;SNOW.dpr=Math.min(2,devicePixelRatio||1);SNOW.w=innerWidth;SNOW.h=innerHeight;SNOW.cv.width=Math.round(SNOW.w*SNOW.dpr);SNOW.cv.height=Math.round(SNOW.h*SNOW.dpr)}
const snowOff=()=>{try{return localStorage.getItem("delidome-snow")==="off"}catch(e){return false}};
function snowToggle(){try{localStorage.setItem("delidome-snow",snowOff()?"on":"off")}catch(x){}const t=document.getElementById("snowTip");if(t)t.hidden=true;applySnow()}
function snowBtnSync(S,on){const b=document.getElementById("snowBtn");if(!b)return;if(!b._sn){b._sn=1;b.addEventListener("click",snowToggle)}const show=on&&snowScope()==="shop";b.hidden=!show;if(!show)return;
  const ic=String(S.icon||"").trim()||"❄️";b.textContent=ic.slice(0,2);b.classList.toggle("off",snowOff());b.setAttribute("aria-pressed",snowOff()?"false":"true");
  let seen=false;try{seen=!!localStorage.getItem("delidome-snow-tip")}catch(e){}
  if(!seen&&!SNOW.tipT){SNOW.tipT=setTimeout(()=>{const t=document.getElementById("snowTip"),lt=document.getElementById("langTip");if(!t||b.hidden)return;if(lt&&!lt.hidden){SNOW.tipT=0;return snowBtnSync(S,on)}
    t.innerHTML="<b>"+b.textContent+" Falling effect</b><span>Tap this button to turn the falling effect on or off.</span>";t.hidden=false;
    const br=b.getBoundingClientRect(),tr=t.getBoundingClientRect();t.style.setProperty("--ar",Math.max(10,Math.round(tr.right-(br.left+br.width/2)-6))+"px");
    try{localStorage.setItem("delidome-snow-tip","1")}catch(e){}setTimeout(()=>{t.hidden=true},9000)},9800)}}
function applySnow(){const pg=DB.page,S=pg&&pg.snow;if(!S||!document.body)return;
  const want=!!S.on&&S[snowScope()]!==false&&!document.body.classList.contains("pre-on");snowBtnSync(S,want);const ok=want&&!snowOff();
  if(!SNOW.iv)SNOW.iv=setInterval(applySnow,1500);
  if(!ok){snowStop();return}
  if(!SNOW.cv){const c=document.createElement("canvas");c.id="snowCv";c.setAttribute("aria-hidden","true");const bg=document.getElementById("pgBg");document.body.insertBefore(c,bg?bg.nextSibling:document.body.firstChild);SNOW.cv=c;SNOW.ctx=c.getContext("2d");snowSize();addEventListener("resize",snowSize)}
  const z=S.layer==="back"?"-1":"900",op=String(Math.max(10,Math.min(100,+S.op||80))/100);
  if(snowApple()){SNOW.run=false;cancelAnimationFrame(SNOW.raf);SNOW.cv.style.display="none";snowDom(S,z,op);SNOW.mode="dom";snowDbg(S,want,ok);return}
  const d=document.getElementById("snowDom");if(d)d.style.display="none";SNOW.mode="canvas";
  snowSprites(S);const st=SNOW.cv.style;st.display="block";st.zIndex=z;st.opacity=op;
  if(!SNOW.run){SNOW.run=true;SNOW.last=0;SNOW.raf=requestAnimationFrame(snowFrame)}snowDbg(S,want,ok)}
function snowDbg(S,want,ok){if(!/[?&]snowdebug\b/.test(location.search))return;let e=document.getElementById("snowDbg");if(!e){e=document.createElement("pre");e.id="snowDbg";e.style.cssText="position:fixed;left:6px;bottom:6px;z-index:99999;margin:0;padding:6px 8px;background:#000c;color:#9f9;font:11px/1.3 monospace;max-width:92vw;white-space:pre-wrap;border-radius:8px;pointer-events:none";document.body.appendChild(e)}
  const d=document.getElementById("snowDom");e.textContent=JSON.stringify({on:S.on,scope:snowScope(),want,ok,mode:SNOW.mode,run:SNOW.run,spr:SNOW.spr.length,flakes:SNOW.fl.length,dom:d?d.childElementCount:0,dispDom:d?getComputedStyle(d).display:null,cv:SNOW.cv?[SNOW.cv.width,SNOW.cv.height,getComputedStyle(SNOW.cv).display]:null,imgs:(S.imgs||[]).length,ua:navigator.userAgent.slice(-60)})}
const HEX_OK=/^(#[0-9a-f]{6}|transparent)$/i;
const AF={list:null,orders:null,loading:false,err:"",range:"30d",from:"",to:"",group:"day",sel:null,rep:null,repLoading:false,form:null,ferr:"",prods:null,sf:"all",afs:"all",act:null,proof:"",busy:false,cfg:null,pf:null,perr:"",tab:"dash"};
const AF_SRC={ig:"Instagram",tt:"TikTok",wa:"WhatsApp",fb:"Facebook",ads:"Ads",x:"X / Twitter",yt:"YouTube",google:"Google",direct:"Direct / unknown",coupon:"Coupon code",web:"Website"};
const AF_ST={progress:["On progress","#1B4DB3","#E4EDFF"],hold:["On hold","#8A5A00","#FFF4D6"],review:["Needs approval","#B42318","#FDE8E6"],approved:["Waiting payout","#0A6B34","#E3F6EA"],paid:["Paid out","#000096","#E5E8FF"],voided:["VOIDED","#B42318","#FDE2E2"],cancelled:["Cancelled","#5A5F86","#EEF0F7"],waiting:["Waiting for payment","#5A5F86","#EEF0F7"]};
const AF_STATUS={active:["Active","#0A6B34","#E3F6EA"],paused:["Paused","#8A5A00","#FFF4D6"],disabled:["Switched off","#9B1C1C","#FDE2E2"]};
const AF_FILTERS=[["all","All"],["review","Needs approval"],["approved","Waiting payout"],["hold","On hold"],["progress","On progress"],["paid","Paid out"],["voided","Voided"],["cancelled","Cancelled"],["waiting","Waiting for payment"]];
const AF_DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const AF_BANKS=["BCA","BRI","BNI","Mandiri","CIMB Niaga","Permata","BSI","Bank Jago","SeaBank","Jenius (BTPN)","GoPay","OVO","DANA","ShopeePay","LinkAja","Other"];
const AF_PAY_ST={none:["No account","#5A5F86","#EEF0F7"],pending:["Waiting for verification","#B42318","#FDE8E6"],verified:["Verified","#0A6B34","#E3F6EA"],rejected:["Rejected","#9B1C1C","#FDE2E2"]};
const afChip=(m,k,self)=>{const x=m[k]||m[Object.keys(m)[0]];return `<span class="afchip${!self&&(k==="review"||k==="pending")?" blink":""}" style="color:${x[1]};background:${x[2]}">${self&&k==="review"?"Under review":x[0]}</span>`};
function afRange(){const n=Date.now(),d0=today0().getTime();
  if(AF.range==="today")return [d0,n+864e5];if(AF.range==="7d")return [d0-6*864e5,n+864e5];if(AF.range==="30d")return [d0-29*864e5,n+864e5];
  if(AF.range==="month"){const d=today0();d.setDate(1);return [d.getTime(),n+864e5]}
  if(AF.range==="custom"&&AF.from){const f=fromYmd(AF.from).getTime(),t=AF.to?fromYmd(AF.to).getTime()+864e5:n+864e5;return [f,t]}
  return [0,n+864e5]}
const afShop=()=>String((window.DELIDOME_CONFIG||{}).shopUrl||location.origin).replace(/\/+$/,"");
function afLink(code,to,ch,cp,size){const q=new URLSearchParams({ref:code});if(ch)q.set("src",ch);if(to)q.set("to",to);if(cp)q.set("cp",cp);if(size)q.set("size",size);return afShop()+"/?"+q.toString()}
function afPeriodHTML(){return `<div class="chips" style="margin-top:4px">${[["today","Today"],["7d","Last 7 days"],["30d","Last 30 days"],["month","This month"],["all","All time"],["custom","Custom"]].map(([k,l])=>`<button class="fchip" type="button" data-afr="${k}" aria-pressed="${AF.range===k}">${l}</button>`).join("")}</div>
  ${AF.range==="custom"?`<div class="colin" style="margin-top:8px;gap:8px;flex-wrap:wrap"><label class="af" style="margin:0">From<input class="in" type="date" data-afd="from" value="${esc(AF.from)}"></label><label class="af" style="margin:0">To<input class="in" type="date" data-afd="to" value="${esc(AF.to)}"></label></div>`:""}`}
function afKpis(t,self,cfg){const k=(v,l,cls,sub)=>`<div class="afk${cls?" "+cls:""}"><strong>${v}</strong><small>${l}</small>${sub?`<em>${sub}</em>`:""}</div>`,n=(c,w)=>c?`${c} order${c===1?"":"s"}${w?" "+w:""}`:"";
  return `<div class="afkpis">${k(t.views,"Link views")}${k(t.uniq,"Unique visitors")}${k(t.orders,"Paid orders")}${k(t.coupon,"Coupon uses")}${k(money(t.sales),"Sales (product value)")}
  ${k(money(t.pending),"Commission pending",0,n(t.hold_n,"on hold"))}${k(money(t.review),self?"Under review":"Needs approval",!self&&t.review_n>0?"hot red":"",n(t.review_n))}${k(money(t.approved),"Waiting payout",t.approved_n>0?"hot":"",n(t.approved_n)+(cfg?`${t.approved_n?" · ":""}min ${money(cfg.min)} · paid every ${AF_DAYS[cfg.day]}`:""))}${k(money(t.paid),"Paid out")}${t.void_n>0?k(money(t.void),"Voided",0,n(t.void_n)):""}</div>
  ${t.waiting>0||t.cancelled_n>0?`<p class="note" style="margin:6px 0 0">${t.waiting?`${t.waiting} order${t.waiting===1?"":"s"} waiting for payment. `:""}${t.cancelled_n?`${t.cancelled_n} cancelled.`:""}</p>`:""}`}
const afShown=rows=>AF.sf==="all"?rows:rows.filter(r=>r.st===AF.sf);
function afChips(rows,self){const n=k=>k==="all"?rows.length:rows.filter(r=>r.st===k).length;
  return `<div class="chips afsf">${AF_FILTERS.filter(([k])=>k==="all"||n(k)>0||AF.sf===k).map(([k,l])=>`<button class="fchip" type="button" data-afsf="${k}" aria-pressed="${AF.sf===k}">${self&&k==="review"?"Under review":l} <small>${n(k)}</small></button>`).join("")}</div>`}
function afOrdersHTML(rows,mode){
  const self=mode==="self",one=mode==="one",all=mode==="all",shown=afShown(rows);
  const rev=shown.filter(r=>r.st==="review"&&!r.partial).slice(0,300),pay=shown.filter(r=>r.st==="approved").slice(0,300),sum=a=>a.reduce((s,r)=>s+(+r.com||0),0);
  const bulk=one?`<div class="afbulk">${rev.length?`<button class="btn btn-blue btn-sm" type="button" data-afbulk="approve">Approve all shown (${rev.length} · ${money(sum(rev))})</button>`:""}${pay.length?`<button class="btn btn-blue btn-sm" type="button" data-afbulk="pay">Pay all shown (${pay.length} · ${money(sum(pay))})</button>`:""}${shown.some(r=>r.st==="review"&&r.partial)?`<small class="note">Orders with a partial refund are approved one by one.</small>`:""}</div>`:"";
  const cols=self?"minmax(110px,1.2fr) 1.1fr 1fr 1fr 1fr 1.8fr":one?"minmax(110px,1.2fr) 1.1fr 1fr 1fr 1fr 1.8fr minmax(150px,1.3fr)":"minmax(130px,1.4fr) 1.1fr 1fr 1fr 1fr 1.8fr",mw=self||all?680:860;
  const th=`<div class="afrow afo afth" style="--c:${cols};min-width:${mw}px"><span>Order</span><span>Date</span><span>Sales</span><span>Commission</span><span>From</span><span>Status</span>${one?"<span>Action</span>":""}</div>`;
  const row=r=>{
    const com=r.st==="waiting"||r.st==="cancelled"?"–":r.st==="voided"?`<s>${money(r.com)}</s>`:money(r.com)+(r.partial?`<small>after refund</small>`:"");
    const why=r.st==="voided"&&r.reason?`<small class="afwhy">${esc(r.reason)}</small>`:r.st==="review"&&r.partial&&!self?`<small>Partial refund: new amount</small>`:r.late&&!self?`<small class="afwhy">Refunded after approval. Check it.</small>`:"";
    const proof=r.st==="paid"&&/^https:\/\//.test(r.proof||"")?`<a class="afproof" href="${esc(r.proof)}" target="_blank" rel="noopener">🧾 View payout proof</a>${r.paid_at?`<small>${fmtDT(r.paid_at)}</small>`:""}`:"";
    const code=!self&&r.id?`<button class="linkbtn" type="button" data-afopen="${esc(r.id)}" title="Open the order">${esc(r.code)}</button>`:`<b>${esc(r.code)}</b>`;
    const who=all?`<small><button class="linkbtn sm" type="button" data-afview="${esc(r.aff)}">${esc(r.aname)}</button></small>`:"";
    let act="";if(one){
      if(r.st==="review")act=`<button class="afokb" type="button" data-afdo="approve|${esc(r.id)}">Approve</button><button class="afvoid blinkv" type="button" data-afdo="void|${esc(r.id)}">VOIDED</button>`;
      else if(r.st==="hold")act=`<button class="afokb" type="button" data-afdo="approve|${esc(r.id)}" title="Only works when the complaint is resolved">Approve</button><button class="afvoid" type="button" data-afdo="void|${esc(r.id)}">VOIDED</button>`;
      else if(["progress","approved"].includes(r.st))act=`<button class="afvoid" type="button" data-afdo="void|${esc(r.id)}">VOIDED</button>`;
      else if(r.st==="voided"&&!["Full refund","Order cancelled"].includes(r.reason))act=`<button class="ghost sm" type="button" data-afdo="restore|${esc(r.id)}">Restore</button>`}
    return `<div class="afrow afo st-${r.st}" style="--c:${cols};min-width:${mw}px"><span>${code}${who}</span><span>${fmtDT(r.at)}</span><span>${money(r.sales)}${r.refund>0?`<small>refunded ${money(r.refund)}</small>`:""}</span><span>${com}</span><span>${esc(AF_SRC[r.src]||r.src||"")}</span><span>${afChip(AF_ST,r.st,self)}${why}${proof}</span>${one?`<span class="afacts2">${act}</span>`:""}</div>`};
  return `${bulk}${shown.length?`<div class="aftable">${th}${shown.map(row).join("")}</div>`:`<p class="note" style="margin:10px 0 0">${rows.length?"No orders with this status in this period.":"No orders in this period yet."}</p>`}`}
const afPayLine=p=>{p=p||{status:"none"};return `Payment: ${p.status==="none"?"":`${esc(p.method)} ${esc(p.no?"••••"+String(p.no).slice(-4):"")} · `}${afChip(AF_PAY_ST,p.status==="none"?"none":p.status,false)}`};
const afPayOk=x=>{const r=AF.rep||{},p=r.pay||{},cfg=r.cfg||{min:20000};return p.status==="verified"&&x.amount>=cfg.min};
function afPayBox(x){const r=AF.rep||{},p=r.pay||{},cfg=r.cfg||{min:20000},ok=p.status==="verified";
  return `<div class="afacct${ok?"":" bad"}">${ok?`<b>${esc(p.method)}</b> · <span class="mono">${esc(p.no)}</span> <button class="ghost sm" type="button" data-afcopytxt="${esc(p.no)}">Copy number</button> · <b>${esc(p.name)}</b>`:`⚠️ The payment account is ${p.status==="none"||!p.status?"not added yet":p.status==="pending"?"waiting for verification":"not verified"}. Verify it first.`}${x.amount<cfg.min?`<br>⚠️ Below the minimum payout of ${money(cfg.min)}.`:""}</div>`}
function afPayHTML(r,owner){const p=r.pay||{status:"none"},cfg=r.cfg||{min:20000,day:4},bal=+r.tot.approved||0,F=AF.pf;
  const hint=bal>0&&bal<cfg.min?` You need ${money(cfg.min-bal)} more to reach the minimum.`:"";
  const note=`<p class="afnote">💸 Minimum payout <b>${money(cfg.min)}</b> · paid every <b>${AF_DAYS[cfg.day]}</b>.${hint}${!owner&&bal>=cfg.min&&p.status!=="verified"?" Add and verify your payment account to be paid.":""}</p>`;
  let body="";
  const det=p.status==="none"?`<p class="note" style="margin:6px 0 0">${owner?"No payment account added yet.":"You haven't added a payment account yet."}</p>`:`<div class="afacct"><b>${esc(p.method)}</b> · <span class="mono">${esc(p.no)}</span>${owner?` <button class="ghost sm" type="button" data-afcopytxt="${esc(p.no)}">Copy number</button>`:""}<br>Holder: <b>${esc(p.name)}</b>${p.at?` <small>· changed ${fmtDT(p.at)}</small>`:""}</div>`;
  if(owner){body=det+(p.status==="rejected"&&p.reason?`<p class="afwhy">Rejected: ${esc(p.reason)}</p>`:"")+
    (p.status==="pending"?`<div class="colin" style="margin-top:8px"><button class="btn btn-blue btn-sm" type="button" data-afpayv="verify">Verify account</button><button class="afvoid" type="button" data-afpayv="reject">Reject</button></div><p class="note" style="margin:6px 0 0">Check that the holder name matches ${esc(r.aff.name||r.aff.username)} (a small test transfer works too).</p>`:p.status==="verified"?`<div class="colin" style="margin-top:8px"><button class="ghost sm" type="button" data-afpayv="reject">Reject / remove verification</button></div>`:"")}
  else if(F){const o=F.method==="Other";body=`<div class="grid2" style="margin-top:8px"><label class="af">Bank or e-wallet<select class="in" data-afpf="method"><option value="">Choose…</option>${AF_BANKS.map(b=>`<option value="${esc(b)}" ${F.method===b?"selected":""}>${b==="Other"?"Other (type it)":b}</option>`).join("")}</select></label>
      ${o?`<label class="af">Name of the bank or e-wallet<input class="in" data-afpf="other" maxlength="40" value="${esc(F.other||"")}"></label>`:""}
      <label class="af">Account number<input class="in" data-afpf="no" inputmode="numeric" maxlength="30" value="${esc(F.no||"")}"></label>
      <label class="af">Account holder name<input class="in" data-afpf="name" maxlength="80" value="${esc(F.name||"")}"></label>
      <label class="af">Your password (to confirm)<input class="in" type="password" data-afpf="password" autocomplete="current-password" value="${esc(F.password||"")}"></label></div>
      ${AF.perr?`<p class="adl-err" role="alert">${esc(AF.perr)}</p>`:""}<div class="colin" style="margin-top:10px"><button class="btn btn-blue btn-sm" type="button" data-afpaysave>Save account</button><button class="ghost" type="button" data-afpaycancel>Cancel</button></div>
      <p class="note" style="margin:6px 0 0">The shop checks the account before paying. Changing it later needs checking again.</p>`}
  else{body=det+(p.status==="pending"?`<p class="note" style="margin:6px 0 0">The shop will check your account before paying you.</p>`:p.status==="rejected"?`<p class="afwhy">The shop couldn't accept it${p.reason?`: ${esc(p.reason)}`:""}. Please fix it.</p>`:p.status==="verified"?`<p class="note" style="margin:6px 0 0">✅ Verified. You'll be paid here.</p>`:"")+`<div class="colin" style="margin-top:8px"><button class="ghost" type="button" data-afpayedit>${p.status==="none"?"Add payment account":"Change account"}</button></div>`}
  return `<section class="panel" id="afPayPanel"><div class="afhead"><h2 style="margin:0">Payment account</h2>${afChip(AF_PAY_ST,p.status||"none",!owner)}</div>${note}${body}</section>`}
async function afPaySave(){const f=AF.pf;AF.perr="";const m=f.method==="Other"?(f.other||"").trim():f.method;
  try{const r=await SBH.rpc("aff_pay_save",{p_method:m||"",p_no:f.no||"",p_name:f.name||"",p_password:f.password||""});AF.rep.pay=r;AF.pf=null;toast("Saved. The shop will check your account before paying.")}catch(e){AF.perr=e.message}
  affRender()}
function afPayClick(e){const b=e.target.closest("button");if(!b)return;const d=b.dataset;
  if(d.afpayedit!==undefined){const p=(AF.rep&&AF.rep.pay)||{};AF.pf={method:AF_BANKS.includes(p.method)?p.method:p.method?"Other":"",other:AF_BANKS.includes(p.method)?"":p.method||"",no:"",name:p.name||"",password:""};AF.perr="";affRender()}
  else if(d.afpaycancel!==undefined){AF.pf=null;AF.perr="";affRender()}
  else if(d.afpaysave!==undefined)afPaySave()}
const AFM={cpn:null,msg:"",pwMsg:"",busy:false,edit:false};
const AF_FAQ_DEFAULT=[
  {q:"How do I earn commission?",a:"You earn commission on every order that comes from your share link or your coupon code.\n\n• Link: the customer opened the shop with your link before ordering.\n• Coupon: the customer used your coupon code. The coupon always wins, even if they clicked someone else's link.\n• Your own orders (from your registered WhatsApp number) never count.\n• While your account is paused, links and the coupon don't earn commission."},
  {q:"How is my commission calculated?",a:"Your commission is {rate}% of what the customer really paid for the cookies.\n\n• The delivery fee is never included.\n• Every discount (coupon, flash sale) is taken off first.\n• Extras such as gift wrap or a greeting card are included.\n\nIn short: commission = (amount the customer paid − delivery fee) × your %."},
  {q:"Can you show me an example?",a:"Example with 10% commission:\n\nCookies (normal price): Rp 85.000\nDelivery fee: Rp 15.000\nTotal before discounts: Rp 100.000\nFlash sale: − Rp 5.000\nCoupon: − Rp 5.000\nThe customer pays: Rp 90.000\n\nCommission is counted on: Rp 90.000 − Rp 15.000 delivery = Rp 75.000\nYour commission: Rp 75.000 × 10% = Rp 7.500"},
  {q:"When does my commission become ready to pay?",a:"Each order moves through these steps:\n\n1. Waiting for payment: the customer hasn't paid yet. No commission yet.\n2. On progress: paid, the cookies are being baked and sent.\n3. On hold: the order is delivered or picked up. A 7-day window starts now.\n4. Needs approval: the 7 days have passed with no problem, and the shop checks the order.\n5. Waiting payout: approved. It will be in your next payout.\n6. Paid out: the money has been sent to you.\n\nThe 7 days start from the day the order is DELIVERED (or picked up), not the day it was ordered. Example: ordered on 1 November, delivered on 3 November, so the window ends on 10 November."},
  {q:"What if an order is cancelled, refunded or has a complaint?",a:"• Cancelled or never paid: no commission.\n• Full refund, or the courier returned or lost the box: the commission is cancelled (VOIDED).\n• Partial refund: the commission is counted again on what the customer kept. Example: Rp 75.000 − Rp 20.000 refund = Rp 55.000 × 10% = Rp 5.500.\n• Complaint: the commission stays On hold until the complaint is solved. A complaint inside the 7 days puts it on hold again.\n\nThis is why we wait 7 days after delivery: complaints and refunds can only happen after the customer receives the cookies."},
  {q:"When and how do I get paid?",a:"Approved commission is paid every {day}, once your balance reaches at least {min}.\n\n• We transfer it to the bank or e-wallet account you saved on your dashboard. Please make sure the name matches.\n• You will see each payout and its transfer proof under Payouts.\n• If your balance is below the minimum, it simply carries over to the next payout day."}];
const AFQ={items:null,draft:null,busy:false,loaded:false,open:false};
async function afFaqLoad(){try{const r=SBH.on?await SBH.rpc("aff_faq",{}):null;AFQ.items=r&&Array.isArray(r.items)&&r.items.length?r.items:null;AFQ.loaded=true}catch(e){}}
const afFaqList=()=>AFQ.items||AF_FAQ_DEFAULT;
function afFaqFill(s,r){const c=(r&&r.cfg)||AF.cfg||{min:20000,day:4};
  return String(s||"").replace(/\{rate\}/g,r&&r.aff?String(+r.aff.rate):"your").replace(/\{min\}/g,money(+c.min||0)).replace(/\{day\}/g,AF_DAYS[+c.day]||"week")}
function afFaqHTML(r){const L=afFaqList();return `<section class="panel"><h2>FAQ</h2><p class="sub">How you earn and how your commission is counted.</p>
  <div class="faq affaq">${L.map((f,i)=>`<details ${i===0?"open":""}><summary>${esc(afFaqFill(f.q,r))}</summary><p>${esc(afFaqFill(f.a,r))}</p></details>`).join("")}</div></section>`}
const afTabsHTML=()=>`<div class="chips aftabs" role="tablist">${[["dash","📊 Dashboard"],["faq","❓ FAQ"]].map(([k,l])=>`<button class="fchip" type="button" role="tab" data-aftab="${k}" aria-selected="${AF.tab===k}" aria-pressed="${AF.tab===k}">${l}</button>`).join("")}</div>`;
async function afCpnLoad(){try{AFM.cpn=await SBH.rpc("aff_coupon_info",{})}catch(e){AFM.cpn={ok:false}}affRender()}
function afCpnText(c){const d=c.type==="freedelivery"?"free delivery":c.type==="amount"?money(+c.value)+" off":(+c.value)+"% off";return d+(+c.minSpend>0?" on orders from "+money(+c.minSpend):"")+(c.stack?", also on flash sales":", not on flash sales")+(c.endsAt?", until "+esc(String(c.endsAt).replace("T"," ")):"")}
function afCouponHTML(){const c=AFM.cpn;if(!c||!c.ok)return "";const shop=String((window.DELIDOME_CONFIG||{}).shopUrl||"").replace(/\/+$/,"")||location.origin.replace(/admin[^/]*/,"");
  return `<section class="panel"><h2 style="margin:0 0 6px">🎟️ My coupon</h2>${!c.ready?`<p class="sub">Coupons are not ready yet. The shop sets the discount first, then you can choose your coupon name here.</p>`
    :`<div class="afcpdef"><span aria-hidden="true">🎁</span><div>Discount for your customers<b>${afCpnText(c)}</b><small>Set by the shop. It is added to your coupon automatically.</small></div></div>
    <p class="sub" style="margin:0 0 8px">${c.coupon?`Your code <b>${esc(c.coupon)}</b>`:"You do not have a coupon name yet."} Customers who type it get <b>${afCpnText(c)}</b>. You earn <b>${+c.rate}%</b> of the order. Your link is remembered for 30 days, so orders from customers who came through it also count.</p>
    ${c.canName?(()=>{const lock=!!c.coupon&&!AFM.edit,wait=c.coupon&&+c.changedAt>0?Math.ceil((3600000-(Date.now()-c.changedAt))/60000):0;
      return `<div class="colin" style="flex-wrap:wrap;gap:8px"><input class="in${lock?" locked":""}" id="afCpIn" maxlength="20" placeholder="Choose a name, like ALPHA001" value="${esc(c.coupon||"")}" style="flex:1;min-width:180px;text-transform:uppercase" ${lock?`readonly aria-label="Your coupon name (locked)"`:""}>
      ${lock?`<button class="btn btn-ghost-blue btn-sm" type="button" data-afcpedit>✏️ Change coupon</button>`:`<button class="btn btn-blue btn-sm" type="button" data-afcpsave ${AFM.busy?"disabled":""}>${AFM.busy?"Saving…":c.coupon?"Save new name":"Save"}</button>${c.coupon?`<button class="ghost" type="button" data-afcpcancel>Cancel</button>`:""}`}</div>
      <p class="note" style="margin:6px 0 0">${lock?`🔒 Your coupon is saved. ${wait>0?`You changed it recently. You can change it again in about ${wait} minute${wait===1?"":"s"}.`:"You can change it once an hour."}`:"3 to 20 letters or numbers. You can change it once an hour."}</p>`})():`<p class="note" style="margin:0">The owner sets your coupon name.</p>`}
    ${AFM.msg?`<p class="note" style="margin:6px 0 0"><b>${esc(AFM.msg)}</b></p>`:""}`}</section>`}
function afPwHTML(){return `<section class="panel"><h2 style="margin:0 0 6px">🔑 Change my password</h2><div class="grid2"><label class="af">Current password<input class="in" id="afPwOld" type="password" autocomplete="current-password" maxlength="72"></label><label class="af">New password (8+ characters)<input class="in" id="afPwNew" type="password" autocomplete="new-password" maxlength="72"></label></div>
    <div class="colin" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost-blue btn-sm" type="button" data-afpwsave ${AFM.busy?"disabled":""}>Change password</button>${AFM.pwMsg?`<span class="note" style="margin:0"><b>${esc(AFM.pwMsg)}</b></span>`:""}</div></section>`}
function afDashHTML(r,owner){
  const a=r.aff,t=r.tot,mx=Math.max(1,...r.series.map(x=>Math.max(x.views,x.orders))),gl={day:"Daily",week:"Weekly",month:"Monthly"};
  const lbl=b=>AF.group==="month"?new Date(b+"-01T00:00:00").toLocaleDateString("en-US",{month:"long",year:"numeric"}):AF.group==="week"?"Week of "+fmtDay(b):fmtDay(b);
  const prods=(AF.prods||[]).filter(p=>p.status!=="hidden");
  return `${a.status==="paused"?`<div class="afwarn">⏸️ ${owner?"This affiliator is paused":"Your account is paused"}: links and the coupon don't earn commission right now.</div>`:""}
  <section class="panel"><div class="afhead"><div><h2 style="margin:0">${esc(a.name||a.username)} ${afChip(AF_STATUS,a.status)}</h2>
    <p class="sub" style="margin:4px 0 0">Code <b>${esc(a.code)}</b> · ${+a.rate}% commission${a.coupon?` · Coupon <b>${esc(a.coupon)}</b>`:""}${owner&&a.phone?` · ${esc(a.phone)}`:""}</p></div></div>
    ${afPeriodHTML()}${afKpis(t,!owner,r.cfg)}
    <p class="note" style="margin:8px 0 0">Commission is ${+a.rate}% of the product value of each order (the delivery fee is never included, and refunds are taken off). After delivery an order stays On hold for ${+r.win} hours, or until a complaint is resolved. Then ${owner?"you review it":"the shop reviews it"}. Approved orders wait for payout and are paid with a transfer proof.</p></section>
  ${owner?"":afCouponHTML()}
  ${afPayHTML(r,owner)}
  ${owner?afActHTML():""}
  <section class="panel"><h2>Commission orders</h2>${afChips(r.orders,!owner)}${afOrdersHTML(r.orders,owner?"one":"self")}</section>
  <section class="panel"><div class="afhead"><h2 style="margin:0">Performance</h2><div class="chips">${["day","week","month"].map(k=>`<button class="fchip" type="button" data-afg="${k}" aria-pressed="${AF.group===k}">${gl[k]}</button>`).join("")}</div></div>
    ${r.series.length?`<div class="aftable"><div class="afrow afth"><span>Period</span><span>Views</span><span>Unique</span><span>Orders</span><span>Sales</span><span>Commission</span></div>${r.series.slice().reverse().map(x=>`<div class="afrow"><span>${esc(lbl(x.b))}<i class="afbar" style="width:${Math.round(Math.max(x.views,x.orders)/mx*100)}%"></i></span><span>${x.views}</span><span>${x.uniq}</span><span>${x.orders}</span><span>${money(x.sales)}</span><span>${money(x.com)}</span></div>`).join("")}</div>`:`<p class="note">No visits or orders in this period yet.</p>`}</section>
  <section class="panel"><h2>Where visitors came from</h2>
    ${r.sources.length?`<div class="aftable"><div class="afrow afth"><span>Source</span><span>Views</span><span>Orders</span><span>Sales</span></div>${r.sources.map(x=>`<div class="afrow"><span>${esc(AF_SRC[x.src]||x.src)}</span><span>${x.views}</span><span>${x.orders}</span><span>${money(x.sales)}</span></div>`).join("")}</div>`:`<p class="note">Nothing yet. Share your links below.</p>`}
    <p class="note" style="margin:8px 0 0">WhatsApp, TikTok and Instagram apps often hide where a visit came from. Use the link made for each place so it's counted correctly.</p></section>
  <section class="panel"><h2>${owner?"Share links":"Your share links"}</h2><p class="sub">Pick what to open and where it will be shared, then copy the link.</p>
    <div class="grid2" style="margin-top:10px"><label class="af">Opens<select class="in" id="afTo"><option value="">The shop</option>${a.coupon?`<option value="__cp">The shop with coupon ${esc(a.coupon)} filled in</option>`:""}${(AF.sizes||[]).map(z=>`<option value="size:${z.n}">Box of ${z.n} cookies</option>`).join("")}${prods.map(p=>`<option value="${esc(p.id)}">Flavor: ${esc(p.name)}</option>`).join("")}</select></label>
    <label class="af">Shared on<select class="in" id="afCh">${[["ig","Instagram"],["tt","TikTok"],["wa","WhatsApp"],["fb","Facebook"],["yt","YouTube"],["x","X / Twitter"],["ads","Ads"],["web","Website / blog"],["","Other"]].map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></label></div>
    <div class="colin" style="margin-top:8px"><input class="in" id="afLinkOut" readonly value="${esc(afLink(a.code,"","ig",""))}"><button class="btn btn-blue btn-sm" type="button" data-afcopy>Copy</button></div></section>
  <section class="panel"><h2>Payouts</h2>${r.payouts.length?r.payouts.map(p=>`<div class="afrow" style="grid-template-columns:1fr auto"><span>${fmtDT(p.at)} · ${p.n} order${p.n===1?"":"s"}${p.note?` · ${esc(p.note)}`:""}${/^https:\/\//.test(p.proof||"")?` · <a class="afproof" href="${esc(p.proof)}" target="_blank" rel="noopener">🧾 proof</a>`:""}</span><b>${money(p.amount)}</b></div>`).join(""):`<p class="note">No payouts yet.</p>`}</section>
  ${owner?"":afPwHTML()}`}
async function affLoadRep(id,mine){const [f,t]=afRange();AF.repLoading=true;
  try{const [rep,inf]=await Promise.all([SBH.rpc("aff_report",{p_id:id,p_from:f,p_to:t,p_group:AF.group}),SBH.rpc("aff_pay_info",{p_id:id})]);rep.pay=inf.pay;rep.cfg=inf.cfg;AF.rep=rep;if(!AF.act)AF.err=""}catch(e){AF.err=e.message}
  AF.repLoading=false;if(!AF.prods)affLoadProds();mine?affRender():(A.tab==="affiliates"&&(()=>{const y=scrollY;renderAdmin();scrollTo(0,y)})())}
async function affLoadProds(){try{const r=await SBH.rpc("shop_public",{});AF.prods=(r.products||[]).map(p=>({id:p.id,name:p.name,status:p.status}));AF.sizes=(r.sizes||[]).filter(z=>z.active!==false).map(z=>({n:z.n})).sort((a,b)=>a.n-b.n)}catch(e){AF.prods=[];AF.sizes=[]}
  if(AF.rep){if(document.getElementById("affView"))affRender();else if(A.tab==="affiliates")renderAdmin()}}
function afClick(e,root,mine){
  const b=e.target.closest("button");if(!b)return;const d=b.dataset;
  const reload=()=>{if(mine)affLoadRep(SBH.aff.id,true);else if(AF.sel)affLoadRep(AF.sel);else affLoadList()};
  if(d.afr){AF.range=d.afr;if(d.afr!=="custom")reload();else mine?affRender():renderAdmin()}
  else if(d.afg){AF.group=d.afg;reload()}
  else if(d.afsf){AF.sf=d.afsf;if(mine)affRender();else{const y=scrollY;renderAdmin();scrollTo(0,y)}}
  else if(d.afcopy!==undefined){const i=root.querySelector("#afLinkOut");try{navigator.clipboard.writeText(i.value).then(()=>toast("Link copied"),()=>{i.select();toast("Select and copy the link")})}catch(x){i.select()}}
}
function afLinkUpd(root){const r=AF.rep;if(!r)return;const to=root.querySelector("#afTo"),ch=root.querySelector("#afCh"),o=root.querySelector("#afLinkOut");if(!to||!o)return;
  const v=to.value,sz=v.startsWith("size:");o.value=afLink(r.aff.code,v==="__cp"||sz?"":v,ch.value,v==="__cp"?r.aff.coupon:"",sz?v.slice(5):"")}
function afDate(el,mine){AF[el.dataset.afd]=el.value;if(AF.from){mine?affLoadRep(SBH.aff.id,true):AF.sel?affLoadRep(AF.sel):affLoadList()}}
const AFN={d:null,open:false,was:0,t:0,tab:"all"};
const AFN_TABS=[["all","All"],["com","Commission"],["news","News & Deals"]];
const afnIn=(x,k)=>k==="all"||(k==="com"?x.kind!=="info"&&x.kind!=="account":x.kind==="info"||x.kind==="account");
const AFN_IC={order:"🛒",money:"💰",void:"⛔",hold:"⏳",account:"👤",info:"📣"};
function afBellHTML(){const d=AFN.d,n=d?+d.unseen||0:0;
  return `<button class="afbell${n?" has":""}" type="button" data-afbell aria-label="Notifications${n?`, ${n} new`:""}" aria-expanded="${AFN.open}">🔔${n?`<i>${n>99?"99+":n}</i>`:""}</button>`+(AFN.open?`<div class="afpop" role="dialog" aria-label="Notifications"><div class="afpoph"><b>Notifications</b><button class="ghost sm" type="button" data-afbell>Close</button></div><div class="bell-tabs" role="tablist">${AFN_TABS.map(([k,l])=>`<button type="button" role="tab" data-afntab="${k}" aria-selected="${AFN.tab===k}">${l}</button>`).join("")}</div><div class="afpopl">${d&&d.notes.filter(x=>afnIn(x,AFN.tab)).length?d.notes.filter(x=>afnIn(x,AFN.tab)).map(x=>`<div class="afnt${x.at>AFN.was?" new":""}"><span class="afnic" aria-hidden="true">${AFN_IC[x.kind]||"📣"}</span><span class="afntx"><small>${fmtAgo(x.at)}${x.all?" · from the shop, for everyone":x.kind==="info"?" · from the shop":""}</small><b>${esc(x.title)}</b><span>${esc(x.body)}</span></span></div>`).join(""):`<div class="empty">Nothing yet. You will see your orders, payouts and news from the shop here.</div>`}</div></div>`:"")}
function afBellDraw(){const b=document.getElementById("afBellBox");if(b)b.innerHTML=afBellHTML()}
async function afNotesLoad(){if(!document.getElementById("affView"))return;
  try{const d=await SBH.rpc("aff_notes_list",{}),old=AFN.d;AFN.d=d;
    if(AFN.open){if(d.unseen){SBH.rpc("aff_notes_seen",{}).catch(()=>{});d.unseen=0}}
    else{AFN.was=d.seen;if(old&&d.unseen>old.unseen&&d.notes[0])toast("🔔 "+d.notes[0].title)}
    afBellDraw()}catch(e){}}
function afBellClick(e){const tb=e.target.closest("[data-afntab]");if(tb){AFN.tab=tb.dataset.afntab;afBellDraw();return}
  if(e.target.closest("[data-afbell]")){AFN.open=!AFN.open;
    if(AFN.open&&AFN.d){AFN.was=AFN.d.seen;if(AFN.d.unseen){AFN.d.unseen=0;SBH.rpc("aff_notes_seen",{}).catch(()=>{})}}
    afBellDraw()}
  else if(AFN.open&&!e.target.closest(".afpop")){AFN.open=false;afBellDraw()}}
function affRender(){try{applyBgx();applySnow()}catch(e){}let v=document.getElementById("affView");
  if(!v){v=document.createElement("div");v.id="affView";document.body.appendChild(v);document.body.classList.add("aff-on");
    v.addEventListener("click",async e=>{afBellClick(e);afClick(e,v,true);afPayClick(e);const tb=e.target.closest("[data-aftab]");if(tb){AF.tab=tb.dataset.aftab;affRender();scrollTo(0,0);return}if(e.target.closest("[data-afout]"))SBH.signOut();
      if(e.target.closest("[data-afcpedit]")){AFM.edit=true;AFM.msg="";affRender();const i=document.getElementById("afCpIn");if(i){i.focus();i.select()}return}
      if(e.target.closest("[data-afcpcancel]")){AFM.edit=false;AFM.msg="";affRender();return}
      if(e.target.closest("[data-afcpsave]")){const code=(document.getElementById("afCpIn")||{}).value||"";AFM.busy=true;AFM.msg="";affRender();try{AFM.cpn=await SBH.rpc("aff_coupon_save",{p_code:code});AFM.msg="Saved. Your coupon is "+AFM.cpn.coupon+".";AFM.edit=false}catch(er){AFM.msg=er.message||"Couldn't save.";const i=document.getElementById("afCpIn");if(i)i.value=code}AFM.busy=false;affRender();if(AFM.edit){const i=document.getElementById("afCpIn");if(i){i.value=code;i.focus()}}}
      if(e.target.closest("[data-afpwsave]")){const o=(document.getElementById("afPwOld")||{}).value||"",n=(document.getElementById("afPwNew")||{}).value||"";AFM.pwMsg="";
        if(n.length<8){AFM.pwMsg="New password: at least 8 characters.";affRender();return}AFM.busy=true;affRender();try{await SBH.changePassword(o,n);AFM.pwMsg="Password changed."}catch(er){AFM.pwMsg=er.message||"Couldn't change it."}AFM.busy=false;affRender()}});
    v.addEventListener("input",e=>{const el=e.target;if(el.dataset.afpf&&AF.pf)AF.pf[el.dataset.afpf]=el.value});
    v.addEventListener("change",e=>{const el=e.target;if(el.id==="afTo"||el.id==="afCh")afLinkUpd(v);if(el.dataset.afd)afDate(el,true);if(el.dataset.afpf==="method"&&AF.pf){AF.pf.method=el.value;affRender()}})}
  const me=SBH.aff;
  v.innerHTML=`<header class="afhdr" style="background:${hexOk(DB.page&&DB.page.brand,"#000096")}"><span class="logo" style="display:inline-flex;align-items:center">${admBrandHTML()}</span><small class="afver">build 2026-10-29 16:46 UTC</small><span class="afwho"><span id="afBellBox" class="afbellbox">${afBellHTML()}</span>@${esc(me.username)}<button class="ghost" type="button" data-afout>Sign out</button></span></header>
  <main class="afmain">${afTabsHTML()}${AF.tab==="faq"?afFaqHTML(AF.rep):AF.rep?afDashHTML(AF.rep,false):`<section class="panel"><div class="empty">${AF.err?esc(AF.err):"Loading your numbers…"}</div></section>`}</main>`;
  afLinkUpd(v)}
const AFF_START=window.affStart=function(me){SBH.aff=me;AFM.cpn=null;AFM.edit=false;afCpnLoad();AF.rep=null;AF.sf="all";AF.tab="dash";afFaqLoad().then(()=>{if(AF.tab==="faq")affRender()});AFN.d=null;AFN.open=false;affRender();affLoadRep(me.id,true);afNotesLoad();clearInterval(AFN.t);AFN.t=setInterval(afNotesLoad,60000)};
const sig = (now=Date.now()) => DB.sales.map(s=>saleStatus(s,now)).join();
let view=null;
function route(){
  if(!SBH.on||SBH.loaded)document.body.classList.remove("dd-load");
  if(view===null&&SBH.on&&!SBH.loaded){view="store";SBH.loadShop();return}
  view="store";document.body.classList.add("in-store");
  trackVisit();closeReviews();expireOrders();sanitizeCart();renderBag();renderEditBar();renderStoreStatic();renderStore();
  if(location.hash==="#shop")window.scrollTo(0,0);
}
addEventListener("ddlang",()=>{try{renderStoreStatic();renderStore();renderBag();renderEditBar()}catch(e){}});
addEventListener("hashchange",route);

// browsers refuse to open data: pictures in a new tab, so open them as a blob instead
document.addEventListener("click",e=>{const a=e.target.closest('a[href^="data:image/"]');if(!a)return;e.preventDefault();
  fetch(a.getAttribute("href")).then(r=>r.blob()).then(b=>window.open(URL.createObjectURL(b),"_blank","noopener")).catch(()=>toast("Couldn't open the picture"))});
addEventListener("storage",e=>{if(SBH.on)return;if(e.key===DB_KEY){loadDB();view=null;route()}});
if(!hadCart&&!SBH.on)S.box=["bb","bb","dc","rv"];
expireOrders();
route();setTimeout(()=>document.body.classList.remove("dd-load"),8000); // never leave the page hidden if the shop is slow to answer
let lastSig=sig();
setInterval(()=>{const now=Date.now(),s=sig(now);if(s!==lastSig)renderStore();else updateFlash(now);lastSig=s},1000);
