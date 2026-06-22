/* ====================================================================
   ELGA Admin — API klient (api.elga.uz ga ulanish)
   Backend topilsa → jonli ma'lumot. Topilmasa → demo (mock) rejimi.
   Bootstrap window.DB ni real ma'lumot bilan to'ldiradi (sahifalar
   o'zgartirilmaydi — ular window.DB dan o'qiydi).
   ==================================================================== */
(function(){
  function baseUrl(){
    try{ return localStorage.getItem('elga_api_base') || 'http://localhost:3000/v1'; }
    catch(e){ return 'http://localhost:3000/v1'; }
  }

  var ELGA = {
    live: false,
    token: null,
    me: null,

    setBase: function(url){ try{ localStorage.setItem('elga_api_base', url); }catch(e){} },
    base: baseUrl,

    request: function(method, path, body){
      var opts = { method:method, headers:{'Content-Type':'application/json'} };
      if(this.token) opts.headers['Authorization'] = 'Bearer '+this.token;
      if(body) opts.body = JSON.stringify(body);
      return fetch(baseUrl()+path, opts).then(function(r){
        return r.json().catch(function(){ return {success:false, error:{code:'PARSE', message:'Javob o\'qilmadi'}}; })
          .then(function(j){ return {status:r.status, body:j}; });
      });
    },
    get: function(path){ return this.request('GET', path); },
    post: function(path, body){ return this.request('POST', path, body); },

    // Login: muvaffaqiyat → {ok:true}; xato turlari: 'auth' | 'network'
    login: function(login, password, code){
      var self=this;
      return this.post('/auth/login', {login:login, password:password, code:code||undefined})
        .then(function(res){
          if(res.status>=200 && res.status<300 && res.body.success){
            self.token = res.body.data.access_token;
            self.me = res.body.data.user;
            return {ok:true};
          }
          return {ok:false, type:'auth', message:(res.body.error&&res.body.error.message)||'Login xato'};
        })
        .catch(function(){ return {ok:false, type:'network'}; });
    },

    // window.DB ni jonli ma'lumot bilan to'ldirish
    bootstrap: function(){
      var self=this;
      var get = function(p){ return self.get(p).then(function(r){ return r.body && r.body.success ? r.body : {data:[],meta:null}; }); };
      return Promise.all([
        get('/drivers?limit=100'), get('/clients?limit=100'), get('/orders?limit=100'),
        get('/finance/withdrawals?limit=100'), get('/finance/transactions?limit=100'),
        get('/complaints?limit=100'), get('/loyalty/rewards'), get('/loyalty/promo-codes'),
        get('/cities'), get('/places?limit=100'), get('/audit?limit=100'), get('/tariffs'),
        get('/stats/dashboard'), get('/zones'), get('/campaigns'), get('/corporate')
      ]).then(function(r){
        var D = window.DB;
        D.drivers     = (r[0].data||[]).map(mapDriver);
        D.clients     = (r[1].data||[]).map(mapClient);
        D.orders      = (r[2].data||[]).map(mapOrder);
        D.withdrawals = (r[3].data||[]).map(mapWithdrawal);
        D.transactions= (r[4].data||[]).map(mapTxn);
        D.complaints  = (r[5].data||[]).map(mapComplaint);
        D.rewards     = (r[6].data||[]).map(mapReward);
        D.promos      = (r[7].data||[]).map(mapPromo);
        D.cities      = (r[8].data||[]).map(mapCity);
        D.places      = (r[9].data||[]).map(mapPlace);
        D.audit       = (r[10].data||[]).map(mapAudit);
        D.tariffs     = (r[11].data||[]).map(mapTariff);
        var dash = r[12].data;
        if(dash) applyDash(dash);
        if((r[13].data||[]).length) D.zones = r[13].data.map(mapZone);
        if((r[14].data||[]).length) D.campaigns = r[14].data.map(mapCampaign);
        if((r[15].data||[]).length) D.corporate = r[15].data.map(mapCorp);
        self.live = true;
        return true;
      });
    }
  };

  function ini(name){ var p=String(name||'').split(' '); return ((p[0]||'')[0]||'')+((p[1]||'')[0]||''); }
  function cap(p){ return ({payme:'Payme',click:'Click',cash:'Naqd',balance:'Balans'})[p]||p; }
  function tlabel(t){ return t? t.charAt(0).toUpperCase()+t.slice(1) : t; }

  function mapDriver(d){ d.ini=ini(d.full_name); d.tariff=tlabel(d.tariff); return d; }
  function mapClient(c){ c.ini=ini(c.full_name); return c; }
  function mapOrder(o){
    o.client_ini=ini(o.client);
    o.from = o.from_city+' · '+o.from_place; o.to = o.to_city+' · '+o.to_place;
    o.tariff=tlabel(o.tariff); return o;
  }
  function mapWithdrawal(w){ w.driver_ini=ini(w.driver); w.provider=cap(w.provider); return w; }
  function mapTxn(t){ t.provider=cap(t.provider); return t; }
  function mapComplaint(c){ return c; }
  function mapReward(r){ return {id:r.id, title:r.title, desc:r.description, cost:r.cost_points, type:r.type, stock:r.stock, active:r.is_active, icon:'gift'}; }
  function mapPromo(p){ return {id:p.id, code:p.code, type:p.type, value:p.value, min_order:p.min_order, limit:p.usage_limit, used:p.used_count, valid_to:p.valid_to, active:p.is_active}; }
  function mapCity(c){ return {id:c.name, name:c.name, region:c.region, active:c.is_active, drivers:c.drivers, orders:c.orders}; }
  function mapPlace(p){ return {id:p.id, city:p.city, name:p.name, count:p.count, source:p.source, added_at:p.added_at||p.created_at||''}; }
  function mapAudit(a){ return a; }
  function mapTariff(t){ return {id:t.id, name:tlabel(t.name), base:t.base_fare, per_km:t.per_km, per_min:t.per_min, min_fare:t.min_fare, surge:t.surge_multiplier, commission:t.commission_percent, active:t.is_active}; }
  function mapZone(z){ return {id:z.id, name:z.name, city:z.city, polygon:z.polygon, surge:z.surge, active:z.is_active}; }
  function mapCampaign(c){ var seg=c.segment||{}; var s=(seg.city?seg.city+' · ':'')+(seg.tier?tlabel(seg.tier)+' mijozlar':'Barcha mijozlar'); return {id:c.id, title:c.title, channel:c.channel, segment:s, body:c.body, status:c.status, recipients:c.recipients, created_at:c.created_at}; }
  function mapCorp(c){ return {id:c.id, name:c.name, contact:c.contact, phone:c.phone, balance:c.balance, employees:c.employees, rides:c.rides, active:c.is_active}; }

  function applyDash(d){
    var L = window.LiveKPI; if(!L) return;
    L.orders_today = d.orders_today;
    L.active_drivers = d.active_drivers;
    L.revenue_today = +(d.revenue_today/1e6).toFixed(2);
    L.new_clients = d.new_clients;
    L.cancel_rate = d.cancel_rate;
    L.commission = +(d.commission_today/1e6).toFixed(2);
  }

  /* Socket.IO jonli ulanish (live rejimda real-time) */
  ELGA.connectSocket = function(){
    if(typeof io==='undefined' || !this.token) return;
    try{
      var origin = baseUrl().replace(/\/v1$/,'');
      var s = io(origin, {auth:{token:this.token}, transports:['websocket','polling']});
      this.socket = s;
      s.on('order:new', function(o){ try{ o.from=o.from_city+' · '+o.from_place; o.to=o.to_city+' · '+o.to_place; o.client_ini=(o.client||'').split(' ').map(function(x){return x[0];}).join('').slice(0,2); window.DB.orders.unshift(o); if(window.DB.orders.length>240)window.DB.orders.pop(); window.Bus&&window.Bus.emit('order:new',o);}catch(e){} });
      s.on('order:updated', function(o){ window.Bus&&window.Bus.emit('order:updated',o); });
      s.on('driver:status', function(d){ window.Bus&&window.Bus.emit('driver:status',d); });
      s.on('driver:location', function(list){
        var full=[]; (list||[]).forEach(function(p){ var d=window.DB.drivers.find(function(x){return x.id===p.id;}); if(d){ d.lat=p.lat; d.lng=p.lng; if(p.status)d.status=p.status; full.push(d); } });
        window.Bus&&window.Bus.emit('driver:location', full.length?full:list);
      });
      s.on('kpi:update', function(k){ if(k&&k.orders_today!=null){ var L=window.LiveKPI; L.orders_today=k.orders_today; L.active_drivers=k.active_drivers; L.revenue_today=+(k.revenue_today/1e6).toFixed(2); } window.Bus&&window.Bus.emit('kpi:update', window.LiveKPI); });
    }catch(e){}
  };
  ELGA.disconnectSocket = function(){ if(this.socket){ try{this.socket.disconnect();}catch(e){} this.socket=null; } };

  /* Yozish amali — live rejimda backendga yuboradi, demo'da no-op.
     Promise qaytaradi: {ok:true,data} yoki {ok:false,message}. */
  window.apiAction = function(method, path, body){
    if(!(window.ELGA && window.ELGA.live)) return Promise.resolve({ok:true, demo:true});
    return window.ELGA.request(method, path, body).then(function(r){
      if(r.status>=200 && r.status<300 && r.body && r.body.success) return {ok:true, data:r.body.data};
      return {ok:false, message:(r.body && r.body.error && r.body.error.message) || 'Server xatosi'};
    }).catch(function(){ return {ok:false, message:'Tarmoq xatosi'}; });
  };

  window.ELGA = ELGA;
})();
