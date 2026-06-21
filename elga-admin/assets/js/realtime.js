/* ====================================================================
   ELGA Admin — Event bus + Real-time simulyatsiya dvigateli
   api.elga.uz Socket.IO ulanganda shu joy real socket bilan
   almashtiriladi (order:new, driver:location, kpi:update ...).
   ==================================================================== */
(function(){
  /* ---- Oddiy pub/sub event bus ---- */
  var Bus = {
    _h: {},
    on: function(ev, fn){
      (this._h[ev]=this._h[ev]||[]).push(fn);
      var self=this;
      return function(){ self._h[ev]=(self._h[ev]||[]).filter(function(f){return f!==fn;}); };
    },
    emit: function(ev, data){
      (this._h[ev]||[]).slice().forEach(function(fn){ try{fn(data);}catch(e){console.error(e);} });
    }
  };
  window.Bus = Bus;

  /* ---- Jonli KPI holati (dashboard subscribe qiladi) ---- */
  var live = {
    orders_today: 486, active_drivers: 128, revenue_today: 6.8, new_clients: 34,
    avg_wait: 3.4, cancel_rate: 8.1, commission: 1.02
  };
  window.LiveKPI = live;

  var FIRST=["Dilshod","Madina","Aziz","Nilufar","Bobur","Sardor","Gulnora","Jasur","Kamola","Zarina","Otabek","Malika"];
  var LAST=["Tursunov","Rahimova","Karimov","Saidova","Toshev","Yusupov","Qodirov","Nazarov","Murodov"];
  var seq = 10621;
  function rnd(){ return Math.random(); }
  function pick(a){ return a[Math.floor(rnd()*a.length)]; }
  function ini(n){ var p=n.split(' '); return (p[0][0]||'')+((p[1]||'')[0]||''); }

  /* ---- Yangi buyurtma yaratish ---- */
  function spawnOrder(){
    var cities=window.DB.CITIES, tar=window.DB.TARIFFS;
    var nm=pick(FIRST)+' '+pick(LAST);
    var from=pick(cities), to=pick(cities); if(to===from) to=pick(cities);
    var price=(18+Math.floor(rnd()*82))*1000;
    var o={ id:'#'+(seq++), client:nm, client_id:'CL'+(3000+seq), client_ini:ini(nm),
      client_phone:'+998 9'+Math.floor(rnd()*9)+' '+(10+Math.floor(rnd()*89))+' *** ** '+(10+Math.floor(rnd()*89)),
      driver:null, driver_id:null, park:null, from:from, to:to, tariff:pick(tar),
      distance:(3+rnd()*40).toFixed(1), duration:6+Math.floor(rnd()*48),
      price:price, commission:Math.round(price*0.15), payment:pick(['cash','payme','click','balance']),
      payment_status:'pending', status:'searching', created_at:'hozir', cancel_reason:null, _new:true };
    window.DB.orders.unshift(o);
    if(window.DB.orders.length>240) window.DB.orders.pop();
    live.orders_today++;
    Bus.emit('order:new', o);
    Bus.emit('kpi:update', live);
  }

  /* ---- Haydovchilarni siljitish (jonli xarita) ---- */
  function moveDrivers(){
    var moved=[];
    window.DB.drivers.forEach(function(d){
      if(d.status==='offline'||d.status==='blocked') return;
      if(d.lat==null) return;
      if(rnd()<0.6){
        d.lat += (rnd()-0.5)*0.006;
        d.lng += (rnd()-0.5)*0.006;
        d.heading = Math.floor(rnd()*360);
        moved.push(d);
      }
    });
    if(moved.length) Bus.emit('driver:location', moved);
  }

  /* ---- Buyurtma holatini ilgarilatish ---- */
  function advanceOrders(){
    var flow={searching:'assigned',assigned:'arriving',arriving:'in_progress',in_progress:'completed'};
    var changed=false;
    window.DB.orders.slice(0,40).forEach(function(o){
      if(flow[o.status] && rnd()<0.25){
        if(o.status==='searching'){
          var free=window.DB.drivers.filter(function(x){return x.status==='free';});
          if(free.length){ var dr=pick(free); o.driver=dr.full_name; o.driver_id=dr.id; o.park=dr.park_number; dr.status='busy'; Bus.emit('driver:status', dr); }
        }
        if(flow[o.status]==='completed'){ o.payment_status='paid'; live.revenue_today=+(live.revenue_today+o.price/1e6).toFixed(2); if(o.driver_id){var d2=window.DB.drivers.find(function(x){return x.id===o.driver_id;}); if(d2){d2.status='free'; Bus.emit('driver:status', d2);}} }
        o.status=flow[o.status]; o._new=false; changed=true;
        Bus.emit('order:updated', o);
      }
    });
    if(changed) Bus.emit('kpi:update', live);
  }

  /* ---- KPI mayda tebranishlari ---- */
  function tickKPI(){
    var freeNow=window.DB.drivers.filter(function(d){return d.status==='free'||d.status==='busy';}).length;
    live.active_drivers = freeNow;
    live.avg_wait = +(3 + rnd()*1.6).toFixed(1);
    live.cancel_rate = +(7 + rnd()*2.4).toFixed(1);
    live.commission = +(live.revenue_today*0.15).toFixed(2);
    Bus.emit('kpi:update', live);
  }

  /* ---- Vaqti-vaqti bilan shikoyat/bildirishnoma ---- */
  function spawnNotice(){
    if(rnd()<0.5) return;
    var cats=["Haydovchi kechikdi","Noto'g'ri narx","Avtomobil holati","Qo'pol muomala"];
    var n={id:'N'+Date.now(), type:'complaint', title:'Yangi shikoyat', body:pick(cats)+' · '+('#'+(seq-1)),
      read:false, created_at:'hozir', icon:'warn', tone:'danger'};
    window.DB.notifications.unshift(n);
    Bus.emit('notice:new', n);
  }

  /* ---- Dvigatel ---- */
  var timers=[];
  var Engine = {
    running:false,
    start: function(){
      if(this.running) return; this.running=true;
      timers.push(setInterval(moveDrivers, 2500));
      timers.push(setInterval(advanceOrders, 4000));
      timers.push(setInterval(function(){ if(rnd()<0.7) spawnOrder(); }, 7000));
      timers.push(setInterval(tickKPI, 5000));
      timers.push(setInterval(spawnNotice, 15000));
    },
    stop: function(){ timers.forEach(clearInterval); timers=[]; this.running=false; }
  };
  window.RealtimeEngine = Engine;
})();
