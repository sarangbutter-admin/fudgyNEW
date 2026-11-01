/* loading screen: always the owner's own logo, name and colour.
   - a returning visitor: shown straight away from what this browser saved last time
   - a brand-new browser or device: neutral dots for a moment while a tiny lookup (splash_info) brings the logo; never the default dome first
   Nothing here waits or delays the page. */
(function(){
  var s=document.getElementById("ddSplash");if(!s)return;
  var KEY="dd-splash-v1",TS="dd-splash-t",svg0=s.firstElementChild,b0=s.querySelector("b"),c=null,cfg=window.DELIDOME_CONFIG||{};
  function name(nb,txt){nb.textContent="";String(txt).slice(0,24).split("").forEach(function(ch,n){var sp=document.createElement("span");sp.style.setProperty("--i",n);sp.textContent=ch===" "?" ":ch;nb.appendChild(sp)})}
  function apply(d){
    try{
      if(d.brand&&/^#[0-9a-f]{3,8}$/i.test(d.brand))s.style.color=d.brand;
      var cur=s.firstElementChild,want=d.logo&&/^https:\/\//i.test(d.logo)?d.logo:"";
      if(want){
        if(!(cur.tagName==="IMG"&&cur.getAttribute("src")===want)){
          var i=new Image();i.className="lg";i.alt="";i.decoding="async";
          i.onerror=function(){if(i.parentNode)i.parentNode.replaceChild(svg0,i)};
          i.src=want;s.replaceChild(i,cur);
        }
      }else if(cur.tagName==="IMG"){s.replaceChild(svg0,cur)}
      var nb=s.querySelector("b");
      if(d.show===false){if(nb)s.removeChild(nb)}
      else{if(!nb){nb=b0;s.appendChild(nb)}if(d.name)name(nb,d.name)}
    }catch(e){}
  }
  function done(){s.classList.remove("ddw")}
  try{c=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){}
  if(c)apply(c);else s.classList.add("ddw");
  var age=0;try{age=+localStorage.getItem(TS)||0}catch(e){}
  if((!c||Date.now()-age>3600e3)&&cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.fetch){
    fetch(cfg.supabaseUrl+"/rest/v1/rpc/splash_info",{method:"POST",headers:{apikey:cfg.supabaseAnonKey,Authorization:"Bearer "+cfg.supabaseAnonKey,"Content-Type":"application/json"},body:"{}"})
      .then(function(r){return r.ok?r.json():null})
      .then(function(j){if(j&&typeof j==="object"){try{localStorage.setItem(KEY,JSON.stringify(j));localStorage.setItem(TS,String(Date.now()))}catch(e){}apply(j)}})
      .catch(function(){}).then(done);
  }
  setTimeout(done,1600);   // never stay on the dots
})();
