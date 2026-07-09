/* ====================================================================
   KetdikGo Admin — API klient (JONLI backend: api.elga.uz /api/admin/*)
   YO'L 2: panel mavjud backend'ga to'g'ri ulanadi (backend TEGILMAYDI).
   - Auth: POST /api/admin/staff/login  (staff JWT) yoki X-Admin-Key.
   - Ma'lumot: GET /api/admin/{stats,drivers,orders,balances,promos,
       complaints,audit,customers,payouts} — REAL shakl.
   - Real-time: backend'da admin-socket YO'Q (driver_location faqat
       customer xonasiga boradi) -> POLLING bilan jonli xarita/KPI.
   - Fetch: timeout + retry (zaif internet).
   Bootstrap window.DB ni real ma'lumot bilan to'ldiradi; sahifalar
   o'zgartirilmaydi — ular window.DB dan o'qiydi.
   ==================================================================== */
(function(){
  function defaultBase(){
    try{
      var h = location.hostname;
      if(h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return 'http://localhost:3000';
    }catch(e){}
    return 'https://api.elga.uz';
  }
  function baseUrl(){
    try{
      var b = localStorage.getItem('elga_api_base') || defaultBase();
      // Eski sozlama '/v1' bilan saqlangan bo'lsa — tozalaymiz (backend'da /v1 yo'q).
      return b.replace(/\/v1\/?$/,'').replace(/\/$/,'');
    }
    catch(e){ return defaultBase(); }
  }

  // timeout + 1 retry (backoff). Zaif internetда osilib qolmaydi.
  function fetchJSON(method, url, headers, body, timeoutMs, retries){
    timeoutMs = timeoutMs || 12000;
    retries = (retries == null) ? 1 : retries;
    function attempt(left, delay){
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function(){ try{ctrl.abort();}catch(e){} }, timeoutMs) : null;
      var opts = { method: method, headers: headers };
      if(body) opts.body = JSON.stringify(body);
      if(ctrl) opts.signal = ctrl.signal;
      return fetch(url, opts).then(function(r){
        if(timer) clearTimeout(timer);
        return r.json().catch(function(){ return null; }).then(function(j){ return { status: r.status, body: j }; });
      }).catch(function(){
        if(timer) clearTimeout(timer);
        if(left > 0){ return new Promise(function(res){ setTimeout(res, delay); }).then(function(){ return attempt(left-1, delay*2); }); }
        var e = new Error('network'); e.network = true; throw e;
      });
    }
    return attempt(retries, 800);
  }

  var ELGA = {
    live: false,
    token: null,       // staff JWT
    adminKey: null,    // yoki X-Admin-Key (zaxira)
    me: null,
    _poll: null,

    setBase: function(url){ try{ localStorage.setItem('elga_api_base', String(url||'').replace(/\/v1\/?$/,'')); }catch(e){} },
    base: baseUrl,

    _headers: function(){
      var h = { 'Content-Type':'application/json' };
      if(this.token) h['Authorization'] = 'Bearer ' + this.token;
      if(this.adminKey) h['X-Admin-Key'] = this.adminKey;
      return h;
    },

    // path — '/api/admin/...' bilan boshlanadi.
    request: function(method, path, body){
      return fetchJSON(method, baseUrl() + path, this._headers(), body);
    },
    get: function(path){ return this.request('GET', path); },
    post: function(path, body){ return this.request('POST', path, body); },

    // Login: username+password -> /api/admin/staff/login (JWT). Parol bo'sh bo'lsa
    // login maydonidagi qiymat X-Admin-Key sifatida sinaladi (super-admin kaliti).
    // Muvaffaqiyat -> {ok:true}; xato: 'auth' | 'network'.
    login: function(login, password){
      var self = this;
      if(password){
        return this.post('/api/admin/staff/login', { username: login, password: password })
          .then(function(res){
            if(res.status>=200 && res.status<300 && res.body && res.body.token){
              self.token = res.body.token; self.adminKey = null;
              self.me = res.body.staff || null;
              return { ok:true };
            }
            return { ok:false, type:'auth', message:(res.body && res.body.error) || 'Login yoki parol noto\'g\'ri' };
          })
          .catch(function(){ return { ok:false, type:'network' }; });
      }
      // Parolsiz — login = X-Admin-Key deb sinaymiz (stats bilan tekshiramiz)
      self.adminKey = login; self.token = null;
      return this.get('/api/admin/stats').then(function(res){
        if(res.status>=200 && res.status<300 && res.body && res.body.role){
          self.me = { username:'admin', role: res.body.role, name:'Admin' };
          return { ok:true };
        }
        self.adminKey = null;
        return { ok:false, type:'auth', message:'Admin kalit noto\'g\'ri' };
      }).catch(function(){ self.adminKey=null; return { ok:false, type:'network' }; });
    },

    // window.DB ni jonli ma'lumot bilan to'ldirish (mavjud endpointlardan)
    bootstrap: function(){
      var self = this;
      var g = function(p){ return self.get(p).then(function(r){ return (r.status>=200&&r.status<300) ? (r.body||{}) : {}; }).catch(function(){ return {}; }); };
      return Promise.all([
        g('/api/admin/stats'),
        g('/api/admin/drivers'),
        g('/api/admin/orders?limit=100'),
        g('/api/admin/balances'),
        g('/api/admin/promos'),
        g('/api/admin/complaints'),
        g('/api/admin/audit?limit=100'),
        g('/api/admin/customers?limit=100'),
        g('/api/admin/payouts')
      ]).then(function(r){
        var D = window.DB;
        var balMap = {};
        arr(r[3],'drivers').forEach(function(b){ balMap[b.id] = b; });
        D.drivers     = arr(r[1],'drivers').map(function(d){ return mapDriver(d, balMap[d.id]); });
        D.orders      = arr(r[2],'orders').map(mapOrder);
        D.promos      = arr(r[4],'promos').map(mapPromo);
        D.complaints  = arr(r[5],'complaints').map(mapComplaint);
        D.audit       = arr(r[6],'audit','logs','log').map(mapAudit);
        D.clients     = arr(r[7],'customers','clients').map(mapClient);
        D.withdrawals = arr(r[8],'payouts','withdrawals').map(mapWithdrawal);
        applyStats(r[0] || {});
        self.live = true;
        // B2: hisobot ma'lumotlari (yangi endpointlar) — parallel yuklanadi;
        // xato bo'lsa demo qiymat qoladi (sahifa ochilganda ham qayta so'raladi).
        self.loadCancelReport().catch(function(){});
        self.loadDriverActivity().catch(function(){});
        return true;
      });
    },

    // ---- B2: HISOBOT LOADERLARI (sahifa ochilganda jonli yangilash) ----
    // Audit jurnali — GET /api/admin/audit (super_admin). DB.audit yangilanadi.
    loadAudit: function(limit){
      return this.get('/api/admin/audit?limit='+(limit||200)).then(function(r){
        if(r.status>=200 && r.status<300 && r.body)
          window.DB.audit = arr(r.body,'log','audit','logs').map(mapAudit);
        return window.DB.audit;
      });
    },
    // Bekor sabablari — GET /api/admin/report/cancels?days=30 (finance)
    loadCancelReport: function(days){
      return this.get('/api/admin/report/cancels?days='+(days||30)).then(function(r){
        if(r.status>=200 && r.status<300 && r.body && r.body.ok)
          window.DB.cancelReport = { days:(r.body.days||30), total:(r.body.total||0), reasons:(r.body.reasons||[]) };
        return window.DB.cancelReport;
      });
    },
    // Haydovchi faolligi — GET /api/admin/report/driver-activity (finance)
    loadDriverActivity: function(){
      return this.get('/api/admin/report/driver-activity').then(function(r){
        if(r.status>=200 && r.status<300 && r.body && r.body.ok)
          window.DB.driverActivity = arr(r.body,'drivers').map(mapActivity);
        return window.DB.driverActivity;
      });
    },

    // ---- Real-time o'rniga POLLING (backend'da admin-socket yo'q) ----
    // Har ~6s: KPI + haydovchi joylashuvi + yangi buyurtmalar. Bus event'lari
    // orqali sahifalar (jonli xarita, dashboard) avtomatik yangilanadi.
    startPolling: function(){
      var self = this;
      if(self._poll) return;
      var known = {}; (window.DB.orders||[]).forEach(function(o){ known[o.id]=1; });
      function tick(){
        if(!self.live) return;
        self.get('/api/admin/stats').then(function(r){ if(r.body) applyStats(r.body); window.Bus && window.Bus.emit('kpi:update', window.LiveKPI); }).catch(function(){});
        self.get('/api/admin/drivers').then(function(r){
          var list = arr(r.body,'drivers'); if(!list.length) return;
          window.DB.drivers = list.map(function(d){ return mapDriver(d, null); });
          window.Bus && window.Bus.emit('driver:location', window.DB.drivers);
        }).catch(function(){});
        self.get('/api/admin/orders?limit=50').then(function(r){
          var list = arr(r.body,'orders').map(mapOrder);
          if(!list.length) return;
          var fresh = list.filter(function(o){ return !known[o.id]; });
          fresh.forEach(function(o){ known[o.id]=1; });
          // B4: HOLATI o'zgargan buyurtmalar ham yangilanadi — ilgari ro'yxat
          // faqat YANGI buyurtma kelgandagina almashardi, doska/dispetcher
          // sahifalarida holat (searching→accepted→...) eskirib qolardi.
          var prevById = {};
          (window.DB.orders||[]).forEach(function(o){ prevById[o.id]=o; });
          var changed = list.filter(function(o){ var p=prevById[o.id]; return p && p.status!==o.status; });
          var olds = (window.DB.orders||[]).filter(function(o){ return list.every(function(n){return n.id!==o.id;}); });
          window.DB.orders = list.concat(olds).slice(0,240);
          fresh.forEach(function(o){ window.Bus && window.Bus.emit('order:new', o); });
          changed.forEach(function(o){ window.Bus && window.Bus.emit('order:updated', o); });
        }).catch(function(){});
      }
      self._poll = setInterval(tick, 6000);
    },
    stopPolling: function(){ if(this._poll){ clearInterval(this._poll); this._poll=null; } },

    // Eski nomlar (app.js chaqiradi) — polling'ga bog'laymiz (socket o'rniga).
    connectSocket: function(){ this.startPolling(); },
    disconnectSocket: function(){ this.stopPolling(); }
  };

  // ---- Yordamchilar ----
  // Javobdagi birinchi mos massivni topadi (kalit nomi backendда har xil bo'lishi mumkin).
  function arr(body){
    if(!body) return [];
    for(var i=1;i<arguments.length;i++){ if(Array.isArray(body[arguments[i]])) return body[arguments[i]]; }
    if(Array.isArray(body.data)) return body.data;
    if(Array.isArray(body)) return body;
    return [];
  }
  function ini(name){ var p=String(name||'').trim().split(/\s+/); return ((p[0]||'')[0]||'')+((p[1]||'')[0]||''); }
  function cap(p){ return ({payme:'Payme',click:'Click',cash:'Naqd',balance:'Balans'})[p]||p; }

  // Dashboard KPI — real /stats -> panel LiveKPI
  function applyStats(s){
    var L = window.LiveKPI; if(!L||!s) return;
    if(s.orders_today!=null) L.orders_today = s.orders_today;
    if(s.drivers_online!=null) L.active_drivers = s.drivers_online;
    if(s.revenue_today!=null) L.revenue_today = +(Number(s.revenue_today)/1e6).toFixed(2);
    if(s.customers!=null) L.new_clients = s.customers;
    if(s.orders_today!=null) L.cancel_rate = s.orders_today ? Math.round(100*(s.cancelled_today||0)/s.orders_today) : 0;
    if(s.commission_total!=null) L.commission = +(Number(s.commission_total)/1e6).toFixed(2);
  }

  // real /drivers -> panel driver (balans /balances dan qo'shiladi)
  function mapDriver(d, bal){
    var name = d.name || d.full_name || '';
    return {
      id: d.id, full_name: name, name: name, ini: ini(name), phone: d.phone,
      driver_id: d.driver_id, car: d.car || [d.car_model, d.car_number].filter(Boolean).join(' · '),
      online: !!d.online, busy: !!d.busy,
      // Q7b: sahifalar 'free' kutadi ('online' emas) — jonli rejimda "Bo'sh"
      // hisoblagichlari 0 ko'rinardi. + REAL joylashuv (backend Q7a lat/lng beradi):
      // lat bor bo'lsa map.js soxta koordinata chizmaydi.
      status: d.online ? (d.busy ? 'busy' : 'free') : 'offline',
      lat: (d.lat != null ? Number(d.lat) : undefined),
      lng: (d.lng != null ? Number(d.lng) : undefined),
      gps_at: d.gps_at || null,
      trips: (d.trips!=null?d.trips:d.trips_done), earned: d.earned,
      rating: d.rating,
      balance: bal ? bal.balance : (d.balance!=null?d.balance:0),
      pending_bonus: bal ? bal.pending_bonus : undefined
    };
  }
  // audit-fix: backend /customers { id,name,phone,balance,created_at,trips,spent } beradi —
  // people.js jadvali orders_count/total_spent/tier/points/registered_at/is_blocked kutadi.
  // Ayniqsa tier undefined bo'lsa people.js:129 c.tier.slice() TypeError → sahifa quladi.
  function mapClient(c){ var name=c.name||c.full_name||''; return {
    id:c.id, full_name:name, name:name, ini:ini(name), phone:c.phone,
    orders_count:(c.orders_count!=null?c.orders_count:(c.trips!=null?c.trips:(c.orders||0))),
    total_spent:(c.total_spent!=null?c.total_spent:(c.spent||0)),
    tier:(c.tier||'bronze'), points:(c.points!=null?c.points:0),
    registered_at:(c.registered_at||c.created_at||''), is_blocked:!!c.is_blocked,
    // eski nomlar ham qolsin (moslik uchun)
    orders:c.orders, spent:c.spent }; }
  function mapOrder(o){
    var name = o.customer_name || o.client || '';
    return {
      id:o.id, status:o.status, price:o.price, distance_km:o.distance_km,
      from:o.from_address||o.from||'', to:o.to_address||o.to||'',
      client:name, client_ini:ini(name), driver:o.driver_name||'',
      created_at:o.created_at,
      // B4 (doska): telefon, koordinata, haydovchi ID, rejalashtirilgan vaqt —
      // backend PR #131 dan keladi; eski backendda undefined bo'lib qolaveradi.
      client_phone:(o.customer_phone||o.client_phone||''), driver_id:(o.driver_id!=null?o.driver_id:null),
      from_lat:(o.from_lat!=null?o.from_lat:null), from_lng:(o.from_lng!=null?o.from_lng:null),
      scheduled_at:(o.scheduled_at||null)
    };
  }
  function mapWithdrawal(w){ var name=w.driver||w.name||''; return { id:w.id, driver:name, driver_ini:ini(name), amount:w.amount, provider:cap(w.provider||w.method), status:w.status, created_at:w.created_at }; }
  // audit-fix: backend /complaints { text,status('open'/'resolved'),role,name,phone,order_id }
  // beradi; people.js jadvali category/order/who/city/source va status='new' kutadi. Ilgari
  // badge/filtr 'new' bo'yicha sanardi, backend 'open' berardi → yangi shikoyatlar 0 ko'rinardi.
  function mapComplaint(c){
    var st = c.status==='resolved' ? 'resolved'
      : (c.status==='in_review'||c.status==='reviewing') ? 'in_review' : 'new';
    return { id:c.id, user:c.name||'', who:c.name||'', phone:c.phone,
      role:c.role, source:c.role, order_id:c.order_id, order:(c.order_id!=null?('#'+c.order_id):'—'),
      category:(c.category || (c.text ? String(c.text).slice(0,40) : 'Shikoyat')), city:(c.city||''),
      text:c.text, description:c.text, status:st, created_at:c.created_at }; }
  function mapPromo(p){ return { id:p.id, code:p.code, type:p.type||'percent', value:(p.percent!=null?p.percent:p.value), min_order:p.min_order, limit:(p.max_uses!=null?p.max_uses:p.usage_limit), used:(p.used_count||p.used||0), valid_to:p.valid_to, active:!!(p.active!=null?p.active:p.is_active) }; }
  // B2: jonli audit_log'da role yo'q — bo'sh qoldiramiz (sahifa o'zi yashiradi).
  function mapAudit(a){ return { id:a.id, user:(a.actor||a.user||a.staff||''), role:(a.role||''), action:a.action, entity:(a.entity||a.target||''), entity_id:(a.entity_id||a.target||''), detail:(a.detail||''), ip:(a.ip||''), created_at:(a.created_at||a.at) }; }
  // B2: real /report/driver-activity -> panel faollik qatori
  function mapActivity(d){
    var name = d.name || '';
    return { id:d.id, name:name, full_name:name, ini:ini(name), phone:(d.phone||''),
      trips_done:(d.trips_done||0), accept_rate:(d.accept_rate!=null?d.accept_rate:null),
      rating:(d.rating!=null?d.rating:null), today_trips:(d.today_trips||0),
      today_earned:(d.today_earned||0), online:!!d.is_online };
  }

  /* Yozish amali — live rejimda backendga (/api/admin/...) yuboradi, demo'da no-op. */
  window.apiAction = function(method, path, body){
    if(!(window.ELGA && window.ELGA.live)) return Promise.resolve({ok:true, demo:true});
    return window.ELGA.request(method, path, body).then(function(r){
      if(r.status>=200 && r.status<300 && r.body && (r.body.ok || r.body.success!==false)) return {ok:true, data:r.body};
      return {ok:false, message:(r.body && r.body.error) || 'Server xatosi'};
    }).catch(function(){ return {ok:false, message:'Tarmoq xatosi'}; });
  };

  window.ELGA = ELGA;
})();
