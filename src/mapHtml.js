// ─── Xarita HTML (Leaflet/OSM zaxira + Google Maps JS asosiy) — haydovchi ───
// Xarita BIR MARTA yuklanadi (barqaror HTML). Markerlar/joylashuv
// injectJavaScript -> window.updateMap(...) orqali yangilanadi — WebView qayta
// yuklanmaydi.
//
// IKKI DVIGATEL (fallback-xavfsiz):
//   1) Leaflet + OpenStreetMap — kalitsiz, DOIM ishlaydi (default). WebView ochilishi
//      bilan darrov ko'rinadi.
//   2) Google Maps JS API — ilova `window.__useGoogle(key)` chaqirsa yoqiladi
//      (kalit backenddan: /api/loc/mapkey → google). Muvaffaqiyatli yuklansa Google
//      xaritaga o'tadi; kalit yo'q / billing-auth xato bo'lsa — Leaflet'da qoladi.
// RN <-> WebView protokoli (updateMap / mapReady) HAR IKKALA dvigatelda bir xil —
// App.js integratsiyasi o'zgarmaydi.
export function mapHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html{margin:0;padding:0;width:100%;height:100%;}#map,#gmap{position:absolute;top:0;left:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><div id="gmap" style="display:none"></div><div id="dbg" style="position:absolute;left:6px;bottom:6px;z-index:99999;max-width:82%;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.62);padding:4px 7px;border-radius:6px;pointer-events:none">xarita: OSM (Google kaliti kutilmoqda)</div><script>
var _eng='leaflet',_last=null;
// KO'RINADIGAN diagnostika: xarita holatini/ xatosini ekranда pastki chapда ko'rsatamiz —
// telefonда WebView konsolini ochmasdan AYNAN sababni bilish uchun. __setDbg — RN ham
// (App.js) shu badge'ni yangilay oladi (masalan "KALIT KELMADI").
function _dbg(t){try{var e=document.getElementById('dbg');if(e)e.textContent='xarita: '+t;}catch(_){}}
window.__setDbg=function(t){_dbg(t);};
// Google Maps xatosini (RefererNotAllowed/BillingNotEnabled/ApiNotActivated/InvalidKey)
// RN'ga yuboramiz + badge'да ko'rsatamiz. Google bu xatolarni console.error orqali
// chiqaradi (va "site URL to be authorized" ni ham beradi).
try{var _ce=console&&console.error?console.error.bind(console):function(){};if(console)console.error=function(){try{var m=Array.prototype.join.call(arguments,' ');if(/Google Maps|MapError|BillingNotEnabled|ApiNotActivated|RefererNotAllowed|InvalidKey|ExpiredKey/i.test(m)){_dbg('Google XATO: '+String(m).slice(0,160));window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:String(m).slice(0,600)}));}}catch(e){}return _ce.apply(console,arguments);};}catch(e){}
// ── Zaxira: Leaflet + OpenStreetMap (kalitsiz) ──
function ic(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var greenIcon=ic('green'),redIcon=ic('red');
// H-08: default markaz — Angor (Surxondaryo), Toshkent [41.31,69.24] EMAS.
// GPS kelganda updateMap() joriy joylashuvga markazlashtiradi (centeredOnce).
var map=L.map('map').setView([37.48,67.16],13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var myMarker=null,pickMarker=null,dropMarker=null,centeredOnce=false;
// ── W2: NAVIGATOR (follow) rejimi — kamera haydovchini yaqin zoomda kuzatadi.
// Ilgari xarita BIR marta markazlashib qotib qolardi: haydovchi uzoqlashgani sari
// marshrut "uzoqda" ko'rinardi. Qo'lda surilsa follow pauza (RN'ga followOff).
var _follow=false;
function _followOffMsg(){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'followOff'}));}catch(e){}}
map.on('dragstart',function(){ if(_follow){_follow=false;_followOffMsg();} });
function centerNow(){
  try{
    if(!_last||_last.myLat==null)return;
    if(_eng==='google'){ if(gReady&&gmap){ gmap.setCenter({lat:_last.myLat,lng:_last.myLng}); if(gmap.getZoom()<16)gmap.setZoom(16); } }
    else { map.setView([_last.myLat,_last.myLng],Math.max(map.getZoom(),16)); }
  }catch(e){}
}
window.setFollow=function(on){ _follow=!!on; if(_follow)centerNow(); };
function leafletUpdate(d){
  try{
    if(d.myLat!=null){ if(myMarker){myMarker.setLatLng([d.myLat,d.myLng]);} else {myMarker=L.marker([d.myLat,d.myLng]).addTo(map).bindPopup('Siz');} }
    if(d.pickLat!=null){ if(pickMarker){pickMarker.setLatLng([d.pickLat,d.pickLng]);} else {pickMarker=L.marker([d.pickLat,d.pickLng],{icon:greenIcon}).addTo(map).bindPopup('Mijoz');} } else if(pickMarker){map.removeLayer(pickMarker);pickMarker=null;}
    if(d.dropLat!=null){ if(dropMarker){dropMarker.setLatLng([d.dropLat,d.dropLng]);} else {dropMarker=L.marker([d.dropLat,d.dropLng],{icon:redIcon}).addTo(map).bindPopup('Manzil');} } else if(dropMarker){map.removeLayer(dropMarker);dropMarker=null;}
    var c=d.myLat!=null?[d.myLat,d.myLng]:(d.pickLat!=null?[d.pickLat,d.pickLng]:null);
    if(_follow&&d.myLat!=null){ map.setView([d.myLat,d.myLng],Math.max(map.getZoom(),16),{animate:true}); centeredOnce=true; }
    else if(c&&!centeredOnce){ map.setView(c,14); centeredOnce=true; }
  }catch(e){}
}
// ── Asosiy: Google Maps JS API (kalit kelsa) ──
var gmap=null,gMy=null,gPick=null,gDrop=null,gCentered=false,gReady=false;
function gIcon(c){return {url:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',scaledSize:new google.maps.Size(25,41),anchor:new google.maps.Point(12,41)};}
function googleUpdate(d){
  if(!gReady||!gmap)return;
  try{
    if(d.myLat!=null){ if(gMy){gMy.setPosition({lat:d.myLat,lng:d.myLng});} else {gMy=new google.maps.Marker({position:{lat:d.myLat,lng:d.myLng},map:gmap,title:'Siz'});} }
    if(d.pickLat!=null){ if(gPick){gPick.setPosition({lat:d.pickLat,lng:d.pickLng});} else {gPick=new google.maps.Marker({position:{lat:d.pickLat,lng:d.pickLng},map:gmap,title:'Mijoz',icon:gIcon('green')});} } else if(gPick){gPick.setMap(null);gPick=null;}
    if(d.dropLat!=null){ if(gDrop){gDrop.setPosition({lat:d.dropLat,lng:d.dropLng});} else {gDrop=new google.maps.Marker({position:{lat:d.dropLat,lng:d.dropLng},map:gmap,title:'Manzil',icon:gIcon('red')});} } else if(gDrop){gDrop.setMap(null);gDrop=null;}
    var c=d.myLat!=null?{lat:d.myLat,lng:d.myLng}:(d.pickLat!=null?{lat:d.pickLat,lng:d.pickLng}:null);
    if(_follow&&d.myLat!=null){ gmap.setCenter({lat:d.myLat,lng:d.myLng}); if(gmap.getZoom()<16)gmap.setZoom(16); gCentered=true; }
    else if(c&&!gCentered){ gmap.setCenter(c); gmap.setZoom(14); gCentered=true; }
  }catch(e){}
}
window.__gmInit=function(){
  try{
    gmap=new google.maps.Map(document.getElementById('gmap'),{center:{lat:37.48,lng:67.16},zoom:13,disableDefaultUI:true,zoomControl:true,clickableIcons:false});
    gReady=true; _eng='google';
    try{gmap.addListener('dragstart',function(){ if(_follow){_follow=false;_followOffMsg();} });}catch(e){}
    document.getElementById('map').style.display='none';
    document.getElementById('gmap').style.display='block';
    _dbg('Google OK');
    if(_last)googleUpdate(_last);
    if(_lastRoute)googleRoute(_lastRoute); // M-07: dvigatel almashganda yo'nalish saqlanadi
  }catch(e){ _dbg('__gmInit xato: '+String(e&&e.message||e).slice(0,120)); }
};
window.gm_authFailure=function(){ _dbg('AUTH XATO -> OSM (kalit rad etildi: referer/billing/API tekshiring)'); try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:'gm_authFailure — Google kalit rad etildi (referer cheklovi yoki billing yoqilmagan yoki Maps JavaScript API yoqilmagan). Google Cloud kalitini tekshiring.'}));}catch(e){} _eng='leaflet'; try{document.getElementById('gmap').style.display='none';document.getElementById('map').style.display='block';}catch(e){} };
window.__useGoogle=function(key){
  if(gReady||document.getElementById('gm-src'))return;
  if(!key){ _dbg('KALIT KELMADI (bosh) — backend google maydoni bosh yoki ilovaga yetmadi'); window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:'__useGoogle: kalit BOSH keldi (backend /api/loc/mapkey google maydoni bosh — ENV GOOGLE_MAPS_API_KEY yoki backend deploy tekshiring)'})); return; }
  _dbg('Google yuklanmoqda... (kalit '+String(key).length+' belgi)');
  var s=document.createElement('script'); s.id='gm-src';
  s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__gmInit&loading=async';
  s.async=true; s.onerror=function(){ _dbg('Google JS yuklanmadi (tarmoq yoki URL)'); window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:'script onerror — Google Maps JS yuklanmadi (tarmoq/URL)'})); };
  document.head.appendChild(s);
  setTimeout(function(){ if(!gReady){ _dbg('Google 10s javob bermadi -> OSM (yuqoridagi xato yoki tarmoq)'); } },10000);
};
// ── M-07: YO'NALISH chizig'i (route) — ILOVA ICHIDA, ikkala dvigatelda ──
// RN OSRM'dan yo'nalishni oladi va window.drawRoute([[lat,lng],...]) chaqiradi.
// Sariq chiziq (brend) + to'q hoshiya — xaritada aniq ko'rinadi. clearRoute — o'chirish.
// Dvigatel almashsa (__gmInit) oxirgi yo'nalish qayta chiziladi (_lastRoute).
var _lastRoute=null;
var lRoute=null,lRouteCase=null;   // Leaflet polylines (hoshiya + asosiy)
var gRoute=null,gRouteCase=null;   // Google polylines
function leafletRoute(pts){
  try{
    if(lRoute){map.removeLayer(lRoute);lRoute=null;} if(lRouteCase){map.removeLayer(lRouteCase);lRouteCase=null;}
    if(!pts||!pts.length)return;
    lRouteCase=L.polyline(pts,{color:'#15171c',weight:8,opacity:0.85}).addTo(map);
    lRoute=L.polyline(pts,{color:'#FFCC00',weight:5,opacity:0.95}).addTo(map);
  }catch(e){}
}
function googleRoute(pts){
  if(!gReady||!gmap)return;
  try{
    if(gRoute){gRoute.setMap(null);gRoute=null;} if(gRouteCase){gRouteCase.setMap(null);gRouteCase=null;}
    if(!pts||!pts.length)return;
    var path=pts.map(function(p){return {lat:p[0],lng:p[1]};});
    gRouteCase=new google.maps.Polyline({path:path,strokeColor:'#15171c',strokeWeight:8,strokeOpacity:0.85,map:gmap});
    gRoute=new google.maps.Polyline({path:path,strokeColor:'#FFCC00',strokeWeight:5,strokeOpacity:0.95,map:gmap});
  }catch(e){}
}
window.drawRoute=function(pts){ _lastRoute=pts; if(_eng==='google')googleRoute(pts); else leafletRoute(pts); };
window.clearRoute=function(){ _lastRoute=null; leafletRoute(null); googleRoute(null); };
// ── Dispatcher: RN injectJavaScript(updateMap) ──
window.updateMap=function(d){ _last=d; if(_eng==='google')googleUpdate(d); else leafletUpdate(d); };
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
</script></body></html>`;
}
