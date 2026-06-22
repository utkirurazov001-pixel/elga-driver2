// ─── Xarita HTML (Leaflet + OSM) — mijoz ilovasi ───
// Xarita BIR MARTA yuklanadi (barqaror HTML). Markerlar/joylashuv
// injectJavaScript -> window.updateMap(...) orqali yangilanadi (qayta yuklanmaydi).
export function mapHTML() {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body,html,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head><body><div id="map"></div><script>
function colorIcon(c){return L.icon({iconUrl:'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-'+c+'.png',shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',iconSize:[25,41],iconAnchor:[12,41],popupAnchor:[1,-34],shadowSize:[41,41]});}
var blueIcon=colorIcon('blue'),redIcon=colorIcon('red'),yellowIcon=colorIcon('gold');
var carIcon=L.divIcon({className:'',html:'<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">🚕</div>',iconSize:[26,26],iconAnchor:[13,13]});
var map=L.map('map',{zoomControl:false});
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
map.setView([41.31,69.24],13);
var pickupMarker=null,destMarker=null,driverMarker=null,carMarkers=[],fitted=false,centeredOnce=false;
function postPickupDrag(e){var ll=e.target.getLatLng();window.ReactNativeWebView.postMessage(JSON.stringify({type:'pickupDrag',lat:ll.lat,lng:ll.lng}));}
window.updateMap=function(d){
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
    if(d.destLat!=null&&d.lat!=null&&!fitted){map.fitBounds([[d.lat,d.lng],[d.destLat,d.destLng]],{padding:[40,40]});fitted=true;centeredOnce=true;}
    else if(d.lat!=null&&!centeredOnce){map.setView([d.lat,d.lng],15);centeredOnce=true;}
  }catch(e){}
};
map.on('click',function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng}));});
window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapReady'}));
</script></body></html>`;
}
