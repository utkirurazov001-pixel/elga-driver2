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
</head><body><div id="map"></div><div id="gmap" style="display:none"></div><script>
var _eng='leaflet',_last=null;
// ── Zaxira: Leaflet + OpenStreetMap (kalitsiz) ──
function ic(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var greenIcon=ic('green'),redIcon=ic('red');
// H-08: default markaz — Angor (Surxondaryo), Toshkent [41.31,69.24] EMAS.
// GPS kelganda updateMap() joriy joylashuvga markazlashtiradi (centeredOnce).
var map=L.map('map').setView([37.48,67.16],13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var myMarker=null,pickMarker=null,dropMarker=null,centeredOnce=false;
function leafletUpdate(d){
  try{
    if(d.myLat!=null){ if(myMarker){myMarker.setLatLng([d.myLat,d.myLng]);} else {myMarker=L.marker([d.myLat,d.myLng]).addTo(map).bindPopup('Siz');} }
    if(d.pickLat!=null){ if(pickMarker){pickMarker.setLatLng([d.pickLat,d.pickLng]);} else {pickMarker=L.marker([d.pickLat,d.pickLng],{icon:greenIcon}).addTo(map).bindPopup('Mijoz');} } else if(pickMarker){map.removeLayer(pickMarker);pickMarker=null;}
    if(d.dropLat!=null){ if(dropMarker){dropMarker.setLatLng([d.dropLat,d.dropLng]);} else {dropMarker=L.marker([d.dropLat,d.dropLng],{icon:redIcon}).addTo(map).bindPopup('Manzil');} } else if(dropMarker){map.removeLayer(dropMarker);dropMarker=null;}
    var c=d.myLat!=null?[d.myLat,d.myLng]:(d.pickLat!=null?[d.pickLat,d.pickLng]:null);
    if(c&&!centeredOnce){ map.setView(c,14); centeredOnce=true; }
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
    if(c&&!gCentered){ gmap.setCenter(c); gmap.setZoom(14); gCentered=true; }
  }catch(e){}
}
window.__gmInit=function(){
  try{
    gmap=new google.maps.Map(document.getElementById('gmap'),{center:{lat:37.48,lng:67.16},zoom:13,disableDefaultUI:true,zoomControl:true,clickableIcons:false});
    gReady=true; _eng='google';
    document.getElementById('map').style.display='none';
    document.getElementById('gmap').style.display='block';
    if(_last)googleUpdate(_last);
  }catch(e){}
};
window.gm_authFailure=function(){ _eng='leaflet'; try{document.getElementById('gmap').style.display='none';document.getElementById('map').style.display='block';}catch(e){} };
window.__useGoogle=function(key){
  if(!key||gReady||document.getElementById('gm-src'))return;
  var s=document.createElement('script'); s.id='gm-src';
  s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__gmInit&loading=async';
  s.async=true; s.onerror=function(){};
  document.head.appendChild(s);
};
// ── Dispatcher: RN injectJavaScript(updateMap) ──
window.updateMap=function(d){ _last=d; if(_eng==='google')googleUpdate(d); else leafletUpdate(d); };
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
</script></body></html>`;
}
