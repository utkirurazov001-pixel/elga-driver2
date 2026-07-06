// ─── Xarita HTML (Leaflet/OSM zaxira + Google Maps JS asosiy) — mijoz ilovasi ───
// Xarita BIR MARTA yuklanadi. Markerlar/joylashuv injectJavaScript ->
// window.updateMap(...) orqali yangilanadi (qayta yuklanmaydi).
//
// IKKI DVIGATEL (fallback-xavfsiz):
//   1) Leaflet + OpenStreetMap — kalitsiz, DOIM ishlaydi (default).
//   2) Google Maps JS API — ilova `window.__useGoogle(key)` chaqirsa yoqiladi
//      (kalit: /api/loc/mapkey → google). Xato bo'lsa Leaflet'da qoladi.
// RN <-> WebView protokoli (updateMap / mapReady / mapClick / pickupDrag) har
// ikkala dvigatelda BIR XIL — App.js integratsiyasi o'zgarmaydi.
export function mapHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html{margin:0;padding:0;width:100%;height:100%;}#map,#gmap{position:absolute;top:0;left:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><div id="gmap" style="display:none"></div><script>
var _eng='leaflet',_last=null;
// Google Maps xatosini (RefererNotAllowed/BillingNotEnabled/ApiNotActivated/InvalidKey)
// RN'ga yuboramiz — nega OSM'ga qaytganini ANIQ bilish uchun. Google bu xatolarni
// console.error orqali chiqaradi (va "site URL to be authorized" ni ham beradi).
try{var _ce=console&&console.error?console.error.bind(console):function(){};if(console)console.error=function(){try{var m=Array.prototype.join.call(arguments,' ');if(/Google Maps|MapError|BillingNotEnabled|ApiNotActivated|RefererNotAllowed|InvalidKey|ExpiredKey/i.test(m)){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:String(m).slice(0,600)}));}}catch(e){}return _ce.apply(console,arguments);};}catch(e){}
// ── Zaxira: Leaflet + OpenStreetMap ──
function colorIcon(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var blueIcon=colorIcon('blue'),redIcon=colorIcon('red'),yellowIcon=colorIcon('gold');
var carIcon=L.divIcon({className:'',html:'<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🚕</div>',iconSize:[26,26],iconAnchor:[13,13]});
var map=L.map('map',{zoomControl:false});
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
// H-08: default markaz — Angor (Surxondaryo), Toshkent [41.31,69.24] EMAS.
// GPS/manzil kelganda quyida joriy joylashuvga markazlashtiriladi (centeredOnce/fitBounds).
map.setView([37.48,67.16],13);
var pickupMarker=null,destMarker=null,driverMarker=null,carMarkers=[],fitted=false,centeredOnce=false;
var searchCircle=null,searchTimer=null,searchR=120;
function stopSearchPulse(){ if(searchTimer){clearInterval(searchTimer);searchTimer=null;} if(searchCircle){try{map.removeLayer(searchCircle);}catch(e){}searchCircle=null;} }
function startSearchPulse(lat,lng){
  stopSearchPulse(); searchR=120;
  searchCircle=L.circle([lat,lng],{radius:searchR,color:'#FFCC00',weight:2,opacity:0.9,fillColor:'#FFCC00',fillOpacity:0.10}).addTo(map);
  searchTimer=setInterval(function(){ searchR+=70; if(searchR>1000)searchR=120; try{searchCircle.setLatLng([lat,lng]);searchCircle.setRadius(searchR);searchCircle.setStyle({fillOpacity:Math.max(0.02,0.16-(searchR/1000)*0.14),opacity:Math.max(0.15,0.9-(searchR/1000)*0.75)});}catch(e){} },110);
}
function postPickupDrag(e){var ll=e.target.getLatLng();window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickupDrag',lat:ll.lat,lng:ll.lng}));}
function leafletUpdate(d){
  try{
    if(d.lat!=null){
      if(!pickupMarker){pickupMarker=L.marker([d.lat,d.lng],{draggable:!!d.pickupMode,icon:blueIcon}).addTo(map).bindPopup('Olib ketish'); if(d.pickupMode)pickupMarker.on('dragend',postPickupDrag);}
      else{pickupMarker.setLatLng([d.lat,d.lng]); if(pickupMarker.dragging){d.pickupMode?pickupMarker.dragging.enable():pickupMarker.dragging.disable();}}
    }
    if(d.destLat!=null){ if(!destMarker){destMarker=L.marker([d.destLat,d.destLng],{icon:redIcon}).addTo(map).bindPopup('Manzil');}else{destMarker.setLatLng([d.destLat,d.destLng]);} } else if(destMarker){map.removeLayer(destMarker);destMarker=null;}
    if(d.driverLat!=null){ if(!driverMarker){driverMarker=L.marker([d.driverLat,d.driverLng],{icon:yellowIcon}).addTo(map).bindPopup('Haydovchi');}else{driverMarker.setLatLng([d.driverLat,d.driverLng]);} } else if(driverMarker){map.removeLayer(driverMarker);driverMarker=null;}
    for(var i=0;i<carMarkers.length;i++){map.removeLayer(carMarkers[i]);}
    carMarkers=[];
    (d.nearby||[]).forEach(function(c){if(c.lat&&c.lng){carMarkers.push(L.marker([c.lat,c.lng],{icon:carIcon}).addTo(map));}});
    if(d.searching&&d.lat!=null){ if(!searchCircle)startSearchPulse(d.lat,d.lng); } else { stopSearchPulse(); }
    if(d.destLat!=null&&d.lat!=null&&!fitted){map.fitBounds([[d.lat,d.lng],[d.destLat,d.destLng]],{padding:[40,40]});fitted=true;centeredOnce=true;}
    else if(d.lat!=null&&!centeredOnce){map.setView([d.lat,d.lng],15);centeredOnce=true;}
  }catch(e){}
}
map.on('click',function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}));});
// ── Asosiy: Google Maps JS API ──
var gmap=null,gPickup=null,gDest=null,gDriver=null,gCars=[],gFitted=false,gCentered=false,gReady=false;
var gSearch=null,gSearchTimer=null,gSearchR=120;
function gIcon(c){return {url:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',scaledSize:new google.maps.Size(25,41),anchor:new google.maps.Point(12,41)};}
function gStopSearch(){ if(gSearchTimer){clearInterval(gSearchTimer);gSearchTimer=null;} if(gSearch){try{gSearch.setMap(null);}catch(e){}gSearch=null;} }
function gStartSearch(lat,lng){
  gStopSearch(); gSearchR=120;
  gSearch=new google.maps.Circle({center:{lat:lat,lng:lng},radius:gSearchR,map:gmap,strokeColor:'#FFCC00',strokeWeight:2,strokeOpacity:0.9,fillColor:'#FFCC00',fillOpacity:0.10});
  gSearchTimer=setInterval(function(){ gSearchR+=70; if(gSearchR>1000)gSearchR=120; try{gSearch.setRadius(gSearchR);gSearch.setOptions({fillOpacity:Math.max(0.02,0.16-(gSearchR/1000)*0.14),strokeOpacity:Math.max(0.15,0.9-(gSearchR/1000)*0.75)});}catch(e){} },110);
}
function googleUpdate(d){
  if(!gReady||!gmap)return;
  try{
    if(d.lat!=null){
      if(!gPickup){ gPickup=new google.maps.Marker({position:{lat:d.lat,lng:d.lng},map:gmap,draggable:!!d.pickupMode,icon:gIcon('blue'),title:'Olib ketish'}); gPickup.addListener('dragend',function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickupDrag',lat:e.latLng.lat(),lng:e.latLng.lng()}));}); }
      else{ gPickup.setPosition({lat:d.lat,lng:d.lng}); gPickup.setDraggable(!!d.pickupMode); }
    }
    if(d.destLat!=null){ if(!gDest){gDest=new google.maps.Marker({position:{lat:d.destLat,lng:d.destLng},map:gmap,icon:gIcon('red'),title:'Manzil'});}else{gDest.setPosition({lat:d.destLat,lng:d.destLng});} } else if(gDest){gDest.setMap(null);gDest=null;}
    if(d.driverLat!=null){ if(!gDriver){gDriver=new google.maps.Marker({position:{lat:d.driverLat,lng:d.driverLng},map:gmap,icon:gIcon('gold'),title:'Haydovchi'});}else{gDriver.setPosition({lat:d.driverLat,lng:d.driverLng});} } else if(gDriver){gDriver.setMap(null);gDriver=null;}
    for(var i=0;i<gCars.length;i++){gCars[i].setMap(null);}
    gCars=[];
    (d.nearby||[]).forEach(function(c){if(c.lat&&c.lng){gCars.push(new google.maps.Marker({position:{lat:c.lat,lng:c.lng},map:gmap,label:{text:'🚕',fontSize:'22px'},icon:{path:google.maps.SymbolPath.CIRCLE,scale:0}}));}});
    if(d.searching&&d.lat!=null){ if(!gSearch)gStartSearch(d.lat,d.lng); } else { gStopSearch(); }
    if(d.destLat!=null&&d.lat!=null&&!gFitted){ var b=new google.maps.LatLngBounds(); b.extend({lat:d.lat,lng:d.lng}); b.extend({lat:d.destLat,lng:d.destLng}); gmap.fitBounds(b,40); gFitted=true; gCentered=true; }
    else if(d.lat!=null&&!gCentered){ gmap.setCenter({lat:d.lat,lng:d.lng}); gmap.setZoom(15); gCentered=true; }
  }catch(e){}
}
window.__gmInit=function(){
  try{
    gmap=new google.maps.Map(document.getElementById('gmap'),{center:{lat:37.48,lng:67.16},zoom:13,disableDefaultUI:true,zoomControl:true,zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_TOP},clickableIcons:false});
    gmap.addListener('click',function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latLng.lat(),lng:e.latLng.lng()}));});
    gReady=true; _eng='google';
    document.getElementById('map').style.display='none';
    document.getElementById('gmap').style.display='block';
    if(_last)googleUpdate(_last);
  }catch(e){}
};
window.gm_authFailure=function(){ try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'gmapError',msg:'gm_authFailure — Google kalit rad etildi (referer cheklovi yoki billing yoqilmagan yoki Maps JavaScript API yoqilmagan). Google Cloud kalitini tekshiring.'}));}catch(e){} _eng='leaflet'; try{document.getElementById('gmap').style.display='none';document.getElementById('map').style.display='block';}catch(e){} };
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
