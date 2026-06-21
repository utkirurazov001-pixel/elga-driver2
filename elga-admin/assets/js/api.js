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
    login: function(login, password){
      var self=this;
      return this.post('/auth/login', {login:login, password:password})
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
        get('/stats/dashboard')
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

  function applyDash(d){
    var L = window.LiveKPI; if(!L) return;
    L.orders_today = d.orders_today;
    L.active_drivers = d.active_drivers;
    L.revenue_today = +(d.revenue_today/1e6).toFixed(2);
    L.new_clients = d.new_clients;
    L.cancel_rate = d.cancel_rate;
    L.commission = +(d.commission_today/1e6).toFixed(2);
  }

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
