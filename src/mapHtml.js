// ─── Xarita HTML (Leaflet + OSM) ───
// Xarita BIR MARTA yuklanadi (barqaror HTML). Keyin markerlar/joylashuv
// injectJavaScript -> window.updateMap(...) orqali yangilanadi — WebView qayta
// yuklanmaydi (avval har GPS yangilanishida butun xarita qayta yuklanib, ilova
// qotib qolardi).
export function mapHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><script>
function ic(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var greenIcon=ic('green'),redIcon=ic('red');
var map=L.map('map').setView([41.31,69.24],14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var myMarker=null,pickMarker=null,dropMarker=null,centeredOnce=false;
window.updateMap=function(d){
  try{
    if(d.myLat!=null){ if(myMarker){myMarker.setLatLng([d.myLat,d.myLng]);} else {myMarker=L.marker([d.myLat,d.myLng]).addTo(map).bindPopup('Siz');} }
    if(d.pickLat!=null){ if(pickMarker){pickMarker.setLatLng([d.pickLat,d.pickLng]);} else {pickMarker=L.marker([d.pickLat,d.pickLng],{icon:greenIcon}).addTo(map).bindPopup('Mijoz');} } else if(pickMarker){map.removeLayer(pickMarker);pickMarker=null;}
    if(d.dropLat!=null){ if(dropMarker){dropMarker.setLatLng([d.dropLat,d.dropLng]);} else {dropMarker=L.marker([d.dropLat,d.dropLng],{icon:redIcon}).addTo(map).bindPopup('Manzil');} } else if(dropMarker){map.removeLayer(dropMarker);dropMarker=null;}
    var c=d.myLat!=null?[d.myLat,d.myLng]:(d.pickLat!=null?[d.pickLat,d.pickLng]:null);
    if(c&&!centeredOnce){ map.setView(c,14); centeredOnce=true; }
  }catch(e){}
};
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
</script></body></html>`;
}
