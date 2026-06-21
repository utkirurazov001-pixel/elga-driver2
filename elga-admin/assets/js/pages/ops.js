/* ====================================================================
   ELGA Admin — Operatsion sahifalar (Uber/Yandex uslubidagi funksiyalar)
   ==================================================================== */
(function(){
  var U = window.UI;

  /* -------- NARX KALKULYATORI -------- */
  window.PAGES.pricing = function(){
    var root=document.createElement('div');
    function render(result){
      root.innerHTML = window.pageHead({title:'Narx kalkulyatori', sub:'base + km + min + surge + tun koeffitsienti (BE-FR-005)'})+
        '<div class="grid g-half" style="align-items:start">'+
        '<div class="card"><div class="card-head"><div><h3>Hisoblash</h3></div></div><div class="card-body">'+
        '<div class="form-grid">'+
        '<div class="field"><label>Shahar</label><select class="input" data-city>'+window.DB.CITIES.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select></div>'+
        '<div class="field"><label>Tarif</label><select class="input" data-tariff>'+window.DB.TARIFFS.map(function(t){return '<option>'+t+'</option>';}).join('')+'</select></div>'+
        '<div class="field"><label>Masofa (km)</label><input class="input mono" type="number" data-dist value="6"></div>'+
        '<div class="field"><label>Vaqt (daqiqa)</label><input class="input mono" type="number" data-dur value="15"></div>'+
        '</div><div style="margin-top:16px"><button class="btn btn-primary" data-calc>'+window.icon('cash',16)+' Narxni hisoblash</button></div></div></div>'+
        '<div class="card"><div class="card-head"><div><h3>Natija</h3></div></div><div class="card-body">'+
        (result? '<dl class="dl">'+
          row('Tarif',result.tariff)+row('Masofa',result.distance+' km')+row('Vaqt',result.duration+' daq')+
          row('Surge koeff.','×'+result.surge)+row('Tun koeff.','×'+result.time)+
          row('Narx','<b class="mono" style="color:var(--gold);font-size:18px">'+window.money(result.price)+' so\'m</b>')+
          row('Komissiya','<span class="mono">'+window.money(result.commission)+' so\'m</span>')+
          row('Haydovchiga','<span class="mono">'+window.money(result.driver)+' so\'m</span>')+
          '</dl>' : '<div class="empty">'+window.icon('cash',40)+'<b>Hisoblang</b>Parametrlarni kiriting</div>')+
        '</div></div></div>';
      root.querySelector('[data-calc]').addEventListener('click',function(){
        var city=root.querySelector('[data-city]').value, tariff=root.querySelector('[data-tariff]').value;
        var dist=parseFloat(root.querySelector('[data-dist]').value)||1, dur=parseFloat(root.querySelector('[data-dur]').value)||1;
        render(window.DB.fareEstimate(tariff,dist,dur,city));
      });
    }
    function row(k,v){return '<dt>'+k+'</dt><dd>'+v+'</dd>';}
    render(null);
    return root;
  };

  /* -------- SURGE & ZONALAR -------- */
  window.PAGES.surge = function(){
    var root=document.createElement('div');
    var s=window.DB.surgeAll();
    var heat=window.DB.heatmap().slice(0,8);
    var maxC=Math.max.apply(null,heat.map(function(h){return h.count;}))||1;
    root.innerHTML = window.pageHead({title:'Surge & talab', sub:'Talab/taklif koeffitsienti va issiq nuqtalar', live:true})+
      '<div class="card mb16"><div class="card-head"><div><h3>Shaharlar bo\'yicha koeffitsient</h3><p>demand / free drivers</p></div></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Shahar</th><th>Talab (kutilayotgan)</th><th>Bo\'sh haydovchi</th><th>Koeffitsient</th></tr></thead><tbody>'+
      s.map(function(x){return '<tr><td><div class="route">'+window.icon('pin',13)+'<b>'+x.city+'</b></div></td>'+
        '<td>'+x.demand+'</td><td>'+x.free+'</td><td>'+(x.surge>1?'<span class="tg gold">×'+x.surge+'</span>':'<span class="tg neutral">×1.0</span>')+'</td></tr>';}).join('')+
      '</tbody></table></div></div>'+
      '<div class="card"><div class="card-head"><div><h3>Issiq nuqtalar (talab heatmap)</h3><p>eng ko\'p buyurtma berilgan mo\'ljallar</p></div></div>'+
      '<div class="card-body"><div class="stat-rows">'+
      heat.map(function(h){return '<div><div class="stat-row"><span class="dt" style="background:var(--gold)"></span>'+
        '<span class="nm">'+U.esc(h.city)+' · '+U.esc(h.place)+'</span><span class="num">'+h.count+'</span></div>'+
        '<div class="bar"><i style="width:'+(h.count/maxC*100)+'%;background:var(--gold)"></i></div></div>';}).join('')+
      '</div></div></div>';
    return root;
  };

  /* -------- SCORING & LEADERBOARD -------- */
  window.PAGES.scoring = function(){
    return window.listPage({
      title:'Scoring & reyting', sub:'Haydovchi ko\'rsatkichlari — Yandex scoring uslubi',
      actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>',
      placeholder:'Haydovchi qidirish...', perPage:12, exportName:'elga-scoring', defaultSort:'score',
      rows:function(st){ return window.DB.leaderboard().filter(function(d){return U.matches(d,st.q,['full_name']);}); },
      columns:[
        {th:'#', render:function(d,i){ return '<b class="mono">'+(i+1)+'</b>'; }},
        {th:'Haydovchi', csv:function(d){return d.full_name;}, render:function(d){return U.cust(d.full_name,d.ini);}},
        {th:'Park', render:function(d){return U.park(d.park);}},
        {th:'Reyting', sortKey:'rating', csv:function(d){return d.rating;}, render:function(d){return '<span class="mono">★ '+d.rating+'</span>';}},
        {th:'Qabul %', sortKey:'accept', csv:function(d){return d.accept;}, render:function(d){return d.accept+'%';}},
        {th:'Yakunlash %', sortKey:'completion', csv:function(d){return d.completion;}, render:function(d){return d.completion+'%';}},
        {th:'Bekor %', sortKey:'cancel', csv:function(d){return d.cancel;}, render:function(d){return '<span style="color:'+(d.cancel>30?'var(--danger)':'inherit')+'">'+d.cancel+'%</span>';}},
        {th:'Ball', sortKey:'score', csv:function(d){return d.score;}, render:function(d){var c=d.score>=75?'done':(d.score>=50?'wait':'canc');return '<span class="tg '+c+'">'+d.score+'</span>';}}
      ]
    });
  };

  /* -------- SMENALAR -------- */
  window.PAGES.shifts = function(){
    return window.listPage({
      title:'Smenalar', sub:'Haydovchilar onlayn vaqti va faol smenalar',
      placeholder:'Haydovchi qidirish...', perPage:12,
      filters:function(st){return [{key:'active', value:st.active||'', options:[window.opt('','Hammasi'),window.opt('yes','Faol'),window.opt('no','Yopilgan')]}];},
      rows:function(st){ return window.DB.shifts.filter(function(s){return U.matches(s,st.q,['driver']) && (!st.active||(st.active==='yes'?s.active:!s.active));}); },
      columns:[
        {th:'Haydovchi', render:function(s){return U.cust(s.driver,s.ini);}},
        {th:'Park', render:function(s){return U.park(s.park);}},
        {th:'Boshlandi', render:function(s){return '<span class="muted">'+s.started_at+'</span>';}},
        {th:'Onlayn vaqt', sortKey:'minutes', render:function(s){return Math.floor(s.minutes/60)+'s '+(s.minutes%60)+'daq';}},
        {th:'Holat', render:function(s){return s.active?'<span class="tg done">Faol</span>':'<span class="tg neutral">Yopilgan</span>';}}
      ]
    });
  };

  /* -------- HUJJAT MUDDATI -------- */
  window.PAGES.docs = function(){
    return window.listPage({
      title:'Hujjat muddati', sub:'Muddati 30 kundan kam yoki o\'tgan hujjatlar (eslatma)',
      actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>',
      placeholder:'Haydovchi qidirish...', perPage:12, exportName:'elga-hujjatlar', defaultSort:'days', defaultDir:'asc',
      rows:function(st){ return window.DB.docsExpiring().filter(function(d){return U.matches(d,st.q,['driver','type']);}); },
      columns:[
        {th:'Haydovchi', csv:function(d){return d.driver;}, render:function(d){return U.cust(d.driver,d.ini);}},
        {th:'Park', render:function(d){return U.park(d.park);}},
        {th:'Hujjat', csv:function(d){return d.type;}, render:function(d){return U.esc(d.type);}},
        {th:'KYC', render:function(d){return U.kycTag(d.status);}},
        {th:'Qolgan muddat', sortKey:'days', csv:function(d){return d.days;}, render:function(d){
          if(d.days<0) return '<span class="tg canc">'+Math.abs(d.days)+' kun o\'tgan</span>';
          if(d.days<=7) return '<span class="tg wait">'+d.days+' kun</span>';
          return d.days+' kun';
        }}
      ]
    });
  };

  /* -------- REYTING & SHARHLAR -------- */
  window.PAGES.reviews = function(){
    return window.listPage({
      title:'Reyting & sharhlar', sub:'Yo\'lovchi → haydovchi baho va teglar',
      placeholder:'Haydovchi yoki mijoz...', perPage:12,
      filters:function(st){return [{key:'rating', value:st.rating||'', options:[window.opt('','Barcha baholar'),window.opt('5','5 ★'),window.opt('4','4 ★'),window.opt('3','3 ★')]}];},
      rows:function(st){ return window.DB.reviews.filter(function(r){return U.matches(r,st.q,['driver','client']) && (!st.rating||String(r.rating)===st.rating);}); },
      columns:[
        {th:'Haydovchi', render:function(r){return U.esc(r.driver);}},
        {th:'Mijoz', render:function(r){return U.esc(r.client);}},
        {th:'Baho', sortKey:'rating', render:function(r){return '<span class="mono gold">'+'★'.repeat(r.rating)+'</span>';}},
        {th:'Teglar', render:function(r){return r.tags.map(function(t){return '<span class="tariff-chip">'+U.esc(t)+'</span>';}).join(' ');}},
        {th:'Vaqt', render:function(r){return '<span class="muted">'+r.created_at+'</span>';}}
      ]
    });
  };

  /* -------- KAMPANIYALAR -------- */
  window.PAGES.campaigns = function(){
    var root=document.createElement('div');
    function render(){
      root.innerHTML = window.pageHead({title:'Kampaniyalar', sub:'Segmentlangan push / SMS e\'lonlar',
        actions:'<button class="btn btn-primary" data-new>'+window.icon('send',16)+'Yangi kampaniya</button>'});
      var card=document.createElement('div'); card.className='card';
      card.innerHTML='<div class="table-wrap"><table><thead><tr><th>Sarlavha</th><th>Kanal</th><th>Segment</th><th>Qabul</th><th>Holat</th><th>Sana</th></tr></thead><tbody>'+
        window.DB.campaigns.map(function(c){return '<tr><td><b>'+U.esc(c.title)+'</b></td>'+
          '<td>'+U.tariff(c.channel.toUpperCase())+'</td><td>'+U.esc(c.segment)+'</td>'+
          '<td class="mono">'+c.recipients+'</td><td>'+(c.status==='sent'?'<span class="tg done">Yuborildi</span>':'<span class="tg wait">Rejalashtirilgan</span>')+'</td>'+
          '<td class="muted">'+c.created_at+'</td></tr>';}).join('')+'</tbody></table></div>';
      root.appendChild(card);
      root.querySelector('[data-new]').addEventListener('click',function(){ window.campaignModal(render); });
    }
    render();
    return root;
  };

  /* -------- KORPORATIV (B2B) -------- */
  window.PAGES.corporate = function(){
    return window.listPage({
      title:'Korporativ (B2B)', sub:'Korxona akkauntlari va hisob-fakturalar',
      actions:'<button class="btn btn-primary" data-new-co>'+window.icon('building',16)+'Yangi korxona</button>',
      placeholder:'Korxona qidirish...',
      rows:function(st){ return window.DB.corporate.filter(function(c){return U.matches(c,st.q,['name','contact']);}); },
      columns:[
        {th:'Korxona', csv:function(c){return c.name;}, render:function(c){return '<b>'+U.esc(c.name)+'</b><br><span class="muted" style="font-size:11px">'+U.esc(c.contact)+'</span>';}},
        {th:'Telefon', render:function(c){return '<span class="mono">'+c.phone+'</span>';}},
        {th:'Xodimlar', sortKey:'employees', render:function(c){return c.employees;}},
        {th:'Safarlar', sortKey:'rides', render:function(c){return c.rides;}},
        {th:'Balans', cls:'sum', sortKey:'balance', render:function(c){return window.money(c.balance);}},
        {th:'Holat', render:function(c){return c.active?U.genTag('true'):U.genTag('false');}},
        {th:'', cls:'right', render:function(c){return '<button class="btn btn-sm" data-invoice="'+c.id+'">Hisob-faktura</button>';}}
      ]
    });
  };

  /* -------- HISOBOTLAR -------- */
  window.PAGES.reports2 = function(){
    var root=document.createElement('div');
    var paid=window.DB.orders.filter(function(o){return o.payment_status==='paid';});
    var revenue=paid.reduce(function(s,o){return s+o.price;},0);
    var commission=paid.reduce(function(s,o){return s+o.commission;},0);
    var byCity=window.DB.CITIES.map(function(c){var os=window.DB.orders.filter(function(o){return o.from_city===c;});return {city:c, orders:os.length, revenue:os.filter(function(o){return o.payment_status==='paid';}).reduce(function(s,o){return s+o.price;},0)};});
    var maxR=Math.max.apply(null,byCity.map(function(c){return c.revenue;}))||1;
    root.innerHTML = window.pageHead({title:'Hisobotlar', sub:'Kunlik / oylik agregatsiya',
      actions:'<div class="seg"><button>Kun</button><button class="on">Oy</button></div><button class="btn">'+window.icon('download',16)+'Eksport</button>'})+
      '<div class="kpis">'+
        U.kpi({icon:'bag',bg:'var(--gold-soft)',color:'var(--gold)',label:'Jami buyurtma',val:window.DB.orders.length})+
        U.kpi({icon:'check',bg:'var(--success-soft)',color:'var(--success)',label:'Bajarilgan',val:window.DB.orders.filter(function(o){return o.status==='completed';}).length})+
        U.kpi({icon:'cash',bg:'var(--info-soft)',color:'#84a9f5',label:'Daromad',val:window.money(revenue),unit:'so\'m'})+
        U.kpi({icon:'trend',bg:'var(--warning-soft)',color:'var(--warning)',label:'Komissiya',val:window.money(commission),unit:'so\'m'})+
      '</div>'+
      '<div class="card"><div class="card-head"><div><h3>Shaharlar bo\'yicha</h3></div></div><div class="card-body"><div class="stat-rows">'+
      byCity.map(function(c){return '<div><div class="stat-row"><span class="dt" style="background:var(--gold)"></span>'+
        '<span class="nm">'+c.city+'</span><span class="num">'+window.money(c.revenue)+' so\'m · '+c.orders+' ta</span></div>'+
        '<div class="bar"><i style="width:'+(c.revenue/maxR*100)+'%;background:var(--gold)"></i></div></div>';}).join('')+
      '</div></div></div>';
    root.querySelectorAll('.seg button').forEach(function(b){b.addEventListener('click',function(){b.parentNode.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});b.classList.add('on');});});
    return root;
  };
})();
