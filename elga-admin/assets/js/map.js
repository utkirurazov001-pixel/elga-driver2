/* ====================================================================
   ELGA Admin — Geo / interaktiv xarita (Leaflet)
   Surxondaryo real koordinatalari. Leaflet yuklanmasa (tarmoq yo'q)
   nafis fallback ko'rsatiladi — panel baribir ishlaydi.
   ==================================================================== */
(function(){
  // Surxondaryo shaharlari — real koordinatalar [lat, lng]
  var CITY_COORDS = {
    "Angor":      [37.4775, 67.1419],
    "Muzrabot":   [37.5806, 67.2933],
    "Jarqo'rg'on":[37.5072, 67.4131],
    "Sherobod":   [37.6736, 67.0019],
    "Termiz":     [37.2242, 67.2783],
    "Denov":      [38.2675, 67.8953]
  };
  var CENTER = [37.55, 67.30];

  // Har haydovchiga koordinata berish (shahar markazi + ofset)
  function seedDriverCoords(){
    window.DB.drivers.forEach(function(d,i){
      if(d.lat) return;
      var c = CITY_COORDS[d.city] || CENTER;
      var r = function(s){ var x=Math.sin((i+s)*97.13)*10000; return (x-Math.floor(x)-0.5); };
      d.lat = c[0] + r(1)*0.14;
      d.lng = c[1] + r(2)*0.18;
      d.heading = Math.floor(Math.abs(r(3))*360);
    });
  }

  var GeoMap = {
    CITY_COORDS: CITY_COORDS, CENTER: CENTER,
    available: function(){ return typeof window.L !== 'undefined' && window.L.map; },

    // Xarita yaratish. container — DOM element. Qaytaradi: {map, markers, setDrivers}
    create: function(container, opts){
      opts = opts || {};
      seedDriverCoords();
      if(!this.available()){ return this._fallback(container, opts); }
      try{
        var map = window.L.map(container, {zoomControl:true, attributionControl:false, scrollWheelZoom:!!opts.scroll})
          .setView(opts.center||CENTER, opts.zoom||9);
        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
          maxZoom:19, subdomains:'abcd'
        }).addTo(map);
        // shahar belgilari
        Object.keys(CITY_COORDS).forEach(function(name){
          var c=CITY_COORDS[name];
          window.L.marker(c,{icon:cityIcon(name)}).addTo(map);
        });
        window._leafletMaps = window._leafletMaps || [];
        window._leafletMaps.push(map);
        var layer = window.L.layerGroup().addTo(map);
        var markers = {};
        function setDrivers(list){
          list.forEach(function(d){
            if(d.lat==null) return;
            var col = statusColor(d.status);
            if(markers[d.id]){
              markers[d.id].setLatLng([d.lat,d.lng]);
            } else {
              var m = window.L.marker([d.lat,d.lng],{icon:driverIcon(col)})
                .bindPopup(popupHTML(d));
              m.addTo(layer); markers[d.id]=m;
            }
          });
        }
        setDrivers(opts.drivers||window.DB.drivers.filter(onlineish));
        setTimeout(function(){ try{map.invalidateSize();}catch(e){} }, 120);
        return {map:map, markers:markers, setDrivers:setDrivers, fallback:false};
      }catch(e){ return this._fallback(container, opts); }
    },

    _fallback: function(container, opts){
      var online = (opts.drivers||window.DB.drivers.filter(onlineish));
      var pins='';
      for(var i=0;i<Math.min(40,online.length);i++){
        var d=online[i];
        var top=(8+(i*53)%84)+'%', left=(6+(i*37)%88)+'%';
        var col = statusColor(d.status);
        pins+='<div class="map-pin" style="top:'+top+';left:'+left+';background:'+col+';box-shadow:0 0 0 4px '+col+'22"></div>';
      }
      var cityLbls = Object.keys(CITY_COORDS).map(function(n,idx){
        var pos=[['16%','14%'],['34%','40%'],['26%','72%'],['60%','22%'],['74%','58%'],['48%','82%']][idx];
        return '<span class="map-city" style="top:'+pos[0]+';left:'+pos[1]+'">'+n+'</span>';
      }).join('');
      container.classList.add('map');
      if(opts.tall) container.classList.add('tall');
      container.innerHTML = cityLbls+pins+
        '<div class="ph">'+window.icon('map',30)+'<div class="mono">[ jonli xarita · internetga ulanganda CartoDB tiles yuklanadi ]</div></div>';
      return {map:null, markers:{}, setDrivers:function(){}, fallback:true};
    }
  };

  function onlineish(d){ return d.status!=='offline' && d.status!=='blocked'; }
  function statusColor(s){ return s==='busy'?'#F59E0B':(s==='free'?'#22C55E':(s==='blocked'?'#EF4444':'#646b78')); }
  function cityIcon(name){
    return window.L.divIcon({className:'',iconSize:[0,0],
      html:'<div style="transform:translate(-50%,-120%);white-space:nowrap;font:700 11px JetBrains Mono,monospace;color:#FFCC00;text-shadow:0 1px 4px #000;background:rgba(21,23,28,.7);border:1px solid rgba(255,204,0,.3);padding:2px 7px;border-radius:6px">'+name+'</div>'});
  }
  function driverIcon(col){
    return window.L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],
      html:'<div style="width:14px;height:14px;border-radius:50%;background:'+col+';border:2px solid #15171C;box-shadow:0 0 0 4px '+col+'33,0 2px 6px rgba(0,0,0,.5)"></div>'});
  }
  function popupHTML(d){
    return '<div style="font-family:Manrope,sans-serif;min-width:160px"><b style="color:#15171C">'+d.full_name+'</b><br>'+
      '<span style="color:#555;font-size:12px">Park '+d.park_number+' · '+d.car_make+' '+d.car_model+'</span><br>'+
      '<span style="color:#555;font-size:12px">★ '+d.rating+' · '+d.city+'</span></div>';
  }

  GeoMap.statusColor = statusColor;
  GeoMap.seedDriverCoords = seedDriverCoords;
  window.GeoMap = GeoMap;
})();
