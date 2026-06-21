/* ====================================================================
   ELGA Admin — Operatsion funksiyalar (Uber/Yandex uslubidagi)
   Client-side hisob window.DB ustida (live rejimda DB backenddan keladi,
   shuning uchun ayni logika ham demo, ham jonli ma'lumotda ishlaydi).
   ==================================================================== */
(function(){
  var D = window.DB;
  var CITY_COORDS = (window.GeoMap && window.GeoMap.CITY_COORDS) || {};

  // ---- Narx kalkulyatori (BE-FR-005) ----
  D.fareEstimate = function(tariffName, distanceKm, durationMin, city){
    var t = D.tariffs.find(function(x){return x.name.toLowerCase()===String(tariffName).toLowerCase();}) || D.tariffs[1];
    var surge = Math.max(D.surge(city), t.surge||1);
    var hour = new Date().getHours();
    var time = (hour>=22||hour<6)?1.2:1.0;
    var raw = t.base + t.per_km*distanceKm + t.per_min*durationMin;
    var price = Math.max(t.min_fare, Math.round(raw*surge*time));
    var commission = Math.round(price*(t.commission/100));
    return {tariff:t.name, distance:distanceKm, duration:durationMin, surge:surge, time:time,
      price:price, commission:commission, driver:price-commission};
  };

  // ---- Surge koeffitsienti (talab/taklif) ----
  D.surge = function(city){
    var demand = D.orders.filter(function(o){return (o.status==='searching'||o.status==='new')&&o.from_city===city;}).length;
    var supply = D.drivers.filter(function(d){return d.status==='free'&&d.city===city;}).length;
    var ratio = supply>0?demand/supply:(demand>0?3:0);
    if(ratio>=2)return 2.0; if(ratio>=1.2)return 1.6; if(ratio>=0.8)return 1.3; if(ratio>=0.4)return 1.1; return 1.0;
  };
  D.surgeAll = function(){
    return D.CITIES.map(function(c){
      return {city:c, surge:D.surge(c),
        demand:D.orders.filter(function(o){return (o.status==='searching'||o.status==='new')&&o.from_city===c;}).length,
        free:D.drivers.filter(function(d){return d.status==='free'&&d.city===c;}).length};
    });
  };

  // ---- Haydovchi scoring (Yandex uslubi) ----
  D.driverScore = function(d){
    var o = D.orders.filter(function(x){return x.driver_id===d.id;});
    var total = o.length||1;
    var done = o.filter(function(x){return x.status==='completed';}).length;
    var canc = o.filter(function(x){return x.status==='cancelled';}).length;
    var completion = +(done/total*100).toFixed(1);
    var cancel = +(canc/total*100).toFixed(1);
    var accept = +(85 + (rnd(d.id)-0.5)*20).toFixed(1);
    var score = Math.max(0, Math.min(100, Math.round((d.rating/5)*40 + (completion/100)*30 + (accept/100)*20 - (cancel/100)*10)));
    return {rating:+d.rating, completion:completion, cancel:cancel, accept:Math.max(0,accept), orders:o.length, score:score};
  };
  D.leaderboard = function(){
    return D.drivers.map(function(d){var s=D.driverScore(d); s.full_name=d.full_name; s.ini=d.ini; s.park=d.park_number; s.city=d.city; s.balance=d.balance; return s;})
      .sort(function(a,b){return b.score-a.score;});
  };

  // ---- Talab heatmap ----
  D.heatmap = function(){
    var by={};
    D.orders.forEach(function(o){var k=o.from_city+'|'+o.from_place; if(!by[k])by[k]={city:o.from_city,place:o.from_place,count:0}; by[k].count++;});
    return Object.keys(by).map(function(k){return by[k];}).sort(function(a,b){return b.count-a.count;});
  };

  // ---- Haydovchi hujjatlari (muddat) ----
  function seedDocs(){
    D.drivers.forEach(function(d,i){
      if(d.docs) return;
      d.docs = [
        {type:'Guvohnoma', status:'approved', days: 30+Math.floor(rnd(d.id+'1')*700)},
        {type:'Tex. pasport', status: i%7===0?'pending':'approved', days: 10+Math.floor(rnd(d.id+'2')*400)},
        {type:'Sug\'urta', status:'approved', days: Math.floor(rnd(d.id+'3')*60)-15}
      ];
    });
  }
  D.docsExpiring = function(){
    seedDocs();
    var rows=[];
    D.drivers.forEach(function(d){ d.docs.forEach(function(doc){ if(doc.days<=30) rows.push({driver:d.full_name, ini:d.ini, park:d.park_number, type:doc.type, status:doc.status, days:doc.days}); }); });
    return rows.sort(function(a,b){return a.days-b.days;});
  };

  // ---- Mijoz safar tarixi ----
  D.clientOrders = function(clientId){ return D.orders.filter(function(o){return o.client_id===clientId;}); };

  // ---- Promo-kod tekshirish ----
  D.promoValidate = function(code, amount){
    var p = D.promos.find(function(x){return x.code.toUpperCase()===String(code).toUpperCase();});
    if(!p) return {ok:false, msg:'Promo-kod topilmadi'};
    if(!p.active) return {ok:false, msg:'Promo-kod nofaol'};
    if(p.used>=p.limit) return {ok:false, msg:'Limit tugagan'};
    if(amount<p.min_order) return {ok:false, msg:'Minimal buyurtma '+window.money(p.min_order)+' so\'m'};
    var discount = p.type==='percent'?Math.round(amount*p.value/100):(p.type==='fixed'?p.value:0);
    var points = p.type==='points'?p.value:0;
    return {ok:true, discount:discount, points:points, final:Math.max(0,amount-discount), type:p.type};
  };

  // ---- Mock to'plamlar (demo; live'da backend mavjud) ----
  if(!D.zones){
    D.zones = D.CITIES.map(function(c,i){
      var co = CITY_COORDS[c]||[37.55,67.3]; var dd=0.06;
      return {id:'ZN'+(i+1), name:c+' markaziy zona', city:c,
        polygon:[[co[0]+dd,co[1]-dd],[co[0]+dd,co[1]+dd],[co[0]-dd,co[1]+dd],[co[0]-dd,co[1]-dd]],
        surge: i%3===0?1.3:1.0, active:true};
    });
  }
  if(!D.campaigns){
    D.campaigns = [
      {id:'CP1', title:'Hafta oxiri 20% chegirma', channel:'push', segment:'Gold mijozlar', body:'Gold mijozlarga 20% chegirma!', status:'sent', recipients:312, created_at:'2 kun oldin'},
      {id:'CP2', title:'Termiz aksiyasi', channel:'sms', segment:'Termiz shahri', body:'TERMIZ50 bilan 5000 so\'m chegirma', status:'scheduled', recipients:0, created_at:'1 kun oldin'}
    ];
  }
  if(!D.corporate){
    D.corporate = [
      {id:'CO1', name:'Abdulfayz-Angor X/K', contact:'Buxgalteriya', phone:'+998 90 *** ** 33', balance:4500000, employees:24, rides:312, active:true},
      {id:'CO2', name:'Surxon Tekstil', contact:'HR bo\'limi', phone:'+998 93 *** ** 55', balance:1200000, employees:58, rides:540, active:true}
    ];
  }
  if(!D.shifts){
    D.shifts = [];
    for(var s=0;s<30;s++){ var dr=D.drivers[s%D.drivers.length];
      D.shifts.push({id:'SH'+(s+1), driver:dr.full_name, ini:dr.ini, park:dr.park_number,
        minutes:120+Math.floor(rnd('sh'+s)*300), active: s%3===0,
        started_at:(2+s%10)+' soat oldin'}); }
  }
  if(!D.reviews){
    var tags=['Toza mashina','Xushmuomala','Tez yetib keldi','Xavfsiz haydash','Yaxshi musiqa'];
    D.reviews=[];
    for(var r=0;r<40;r++){ var d2=D.drivers[r%D.drivers.length]; var c2=D.clients[(r+3)%D.clients.length];
      D.reviews.push({id:'RV'+(r+1), driver:d2.full_name, driver_id:d2.id, client:c2.full_name,
        rating:3+Math.floor(rnd('rv'+r)*3), tags:[tags[r%tags.length],tags[(r+2)%tags.length]],
        created_at:(5+r*3)+' daq oldin'}); }
  }

  function rnd(seed){ var s=String(seed), h=0; for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))%100000;} var x=Math.sin(h)*10000; return x-Math.floor(x); }
})();
