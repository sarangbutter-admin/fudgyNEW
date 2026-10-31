/* loading screen: use the owner's latest logo, name and colour (saved by the shop the last time it loaded); nothing here waits or delays anything */
(function(){
  try{
    var s=document.getElementById("ddSplash");if(!s)return;
    var c=JSON.parse(localStorage.getItem("dd-splash-v1")||"null");if(!c)return;
    var svg=s.querySelector("svg"),b=s.querySelector("b");
    if(c.brand&&/^#[0-9a-f]{3,8}$/i.test(c.brand))s.style.color=c.brand;
    if(c.logo&&/^https?:\/\//i.test(c.logo)&&svg){
      var i=new Image();i.className="lg";i.alt="";i.decoding="async";
      i.onerror=function(){if(i.parentNode)i.parentNode.replaceChild(svg,i)};
      i.src=c.logo;s.replaceChild(i,svg);
    }
    if(b){
      if(c.show===false){b.parentNode.removeChild(b)}
      else if(c.name){
        b.textContent="";String(c.name).slice(0,24).split("").forEach(function(ch,n){var sp=document.createElement("span");sp.style.setProperty("--i",n);sp.textContent=ch===" "?" ":ch;b.appendChild(sp)});
      }
    }
  }catch(e){}
})();
