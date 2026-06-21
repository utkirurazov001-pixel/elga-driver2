/* ====================================================================
   ELGA Admin — Asosiy sahifalar
   ==================================================================== */
(function(){
  var U = window.UI;

  /* ---------------- BOSHQARUV (Dashboard) ---------------- */
  window.PAGES.grid = function(ctx){
    var root = document.createElement('div');
    var done=[300,360,330,390,420,400,450,480,440,500,520,490,540,580];
    var canc=[40,52,38,55,62,48,58,66,52,70,76,60,82,90];
    var days=['08','09','10','11','12','13','14','15','16','17','18','19','20','21'];
    var L = window.LiveKPI;

    function kpiHTML(){
      return [
        U.kpi({icon:'bag', bg:'var(--gold-soft)', color:'var(--gold)', label:'Bugungi buyurtmalar', val:L.orders_today, delta:'9.2%', deltaUp:true}),
        U.kpi({icon:'car', bg:'var(--success-soft)', color:'var(--success)', label:'Faol haydovchilar', val:L.active_drivers, unit:'/ 214', delta:'4.1%', deltaUp:true}),
        U.kpi({icon:'cash', bg:'var(--warning-soft)', color:'var(--warning)', label:'Bugungi daromad', val:L.revenue_today, unit:'mln so\'m', delta:'7.4%', deltaUp:true}),
        U.kpi({icon:'users', bg:'var(--info-soft)', color:'#84a9f5', label:'Yangi mijozlar', val:L.new_clients, delta:'1.8%', deltaUp:false})
      ].join('');
    }
    function stripHTML(){
      return [
        U.mini({icon:'clock', bg:'var(--info-soft)', color:'#84a9f5', label:'O\'rtacha kutish vaqti', val:L.avg_wait, unit:'daqiqa'}),
        U.mini({icon:'xcircle', bg:'var(--danger-soft)', color:'var(--danger)', label:'Bekor qilish foizi', val:L.cancel_rate, unit:'%'}),
        U.mini({icon:'trend', bg:'var(--gold-soft)', color:'var(--gold)', label:'Bugungi komissiya (15%)', val:L.commission, unit:'mln so\'m'})
      ].join('');
    }
    var kpis = kpiHTML();
    var strip = stripHTML();

    var recent = window.DB.orders.slice(0,5);
    var ordersRows = recent.map(function(o){
      return '<tr><td class="mono">'+o.id+'</td>'+
        '<td>'+U.cust(o.client,o.client_ini,o.client_phone)+'</td>'+
        '<td>'+U.route(o.from,o.to)+'</td>'+
        '<td>'+U.tariff(o.tariff)+'</td>'+
        '<td>'+U.park(o.park)+'</td>'+
        '<td class="sum">'+window.money(o.price)+'</td>'+
        '<td>'+U.orderTag(o.status)+'</td></tr>';
    }).join('');

    var complaints = window.DB.complaints.slice(0,4).map(function(c){
      return '<div class="cmp"><div class="ic">'+window.icon('warn',16)+'</div>'+
        '<div><div class="tt">'+c.category+'</div><div class="ds">'+c.order+' · '+c.who+' · '+c.city+'</div></div>'+
        '<div class="tm">'+c.created_at+'</div></div>';
    }).join('');

    var withdrawRows = window.DB.withdrawals.filter(function(w){return w.status==='pending';}).slice(0,3).map(function(w){
      return '<tr><td>'+U.cust(w.driver,w.driver_ini,w.driver_phone)+'</td><td>'+U.park(w.park)+'</td>'+
        '<td class="sum">'+window.money(w.amount)+'</td><td>'+U.tariff(w.provider)+'</td>'+
        '<td>'+U.genTag('pending')+'</td>'+
        '<td><button class="btn btn-primary btn-sm" data-wd="'+w.id+'">Tasdiqlash</button></td></tr>';
    }).join('');

    root.innerHTML = window.pageHead({
      title:'Boshqaruv paneli',
      sub:'21-iyun 2026 · Surxondaryo',
      live:true,
      actions:'<button class="btn" data-goto="finance">'+window.icon('download',16)+'Hisobot</button>'+
              '<button class="btn btn-primary" data-new-order>'+window.icon('plus',16)+'Yangi buyurtma</button>'
    })+
    '<div class="kpis" id="dashKpis">'+kpis+'</div>'+
    '<div class="strip" id="dashStrip">'+strip+'</div>'+
    '<div class="grid g-2 mb16">'+
      '<div class="card"><div class="card-head"><div><h3>Buyurtmalar dinamikasi</h3><p>So\'nggi 14 kun · jami 5 940 ta</p></div>'+
        '<div class="seg"><button>Hafta</button><button class="on">14 kun</button><button>Oy</button></div></div>'+
        '<div class="card-body chart-wrap"><div class="chart-legend"><span><i style="background:var(--gold)"></i>Bajarilgan</span>'+
        '<span><i style="background:var(--danger)"></i>Bekor qilingan</span></div>'+U.lineChart(done,canc,days,600)+'</div></div>'+
      '<div class="card"><div class="card-head"><div><h3>Buyurtmalar holati</h3><p>Bugun</p></div></div>'+
        '<div class="card-body"><div class="donut-wrap">'+
        U.donut([{value:345,color:'var(--success)'},{value:82,color:'var(--warning)'},{value:59,color:'var(--danger)'}],486,'jami')+
        '<div class="legend-list">'+
        '<div class="legend-row"><i style="background:var(--success)"></i><span class="t">Bajarilgan</span><span class="v">345</span></div>'+
        '<div class="legend-row"><i style="background:var(--warning)"></i><span class="t">Jarayonda</span><span class="v">82</span></div>'+
        '<div class="legend-row"><i style="background:var(--danger)"></i><span class="t">Bekor qilingan</span><span class="v">59</span></div>'+
        '</div></div></div></div>'+
    '</div>'+
    '<div class="grid g-2b mb16">'+
      '<div class="card"><div class="card-head"><div><h3>Haydovchilar holati</h3><p>Jonli</p></div></div>'+
        '<div class="card-body"><div class="stat-rows">'+
        statRow('success','Bo\'sh (free)',74,60)+statRow('warning','Buyurtmada (busy)',54,44)+
        statRow('text-faint','Oflayn (offline)',86,70)+statRow('danger','Bloklangan',6,7)+
        '</div></div></div>'+
      '<div class="card"><div class="card-head"><div><h3>Jonli xarita</h3><p>Surxondaryo · <span id="dashOnline">'+window.DB.drivers.filter(function(d){return d.status==='free'||d.status==='busy';}).length+'</span> haydovchi onlayn</p></div>'+
        '<button class="btn btn-sm" data-goto="map">To\'liq xarita</button></div>'+
        '<div class="card-body"><div id="dashMap" style="height:262px;border-radius:12px;overflow:hidden;border:1px solid var(--border)"></div></div></div></div>'+
    '</div>'+
    '<div class="grid g-2 mb16" style="align-items:start">'+
      '<div class="card"><div class="card-head"><div><h3>So\'nggi buyurtmalar</h3><p>Real vaqt</p></div>'+
        '<button class="btn btn-sm" data-goto="bag">Barchasi</button></div>'+
        '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Mijoz</th><th>Yo\'nalish</th><th>Tarif</th><th>Park</th><th>Summa</th><th>Holat</th></tr></thead>'+
        '<tbody id="dashOrders">'+ordersRows+'</tbody></table></div></div>'+
      '<div class="card"><div class="card-head"><div><h3>So\'nggi shikoyatlar</h3><p>13 ta yangi</p></div></div>'+
        '<div class="card-body"><div class="cmp-list">'+complaints+'</div></div>'+
        '<div class="foot-link" data-goto="warn">Barcha shikoyatlarni ko\'rish →</div></div>'+
    '</div>'+
    '<div class="grid g-2b" style="align-items:start">'+
      '<div class="card"><div class="card-head"><div><h3>Sadoqat dasturi</h3><p>Bonuslar sizni kutmoqda!</p></div></div>'+
        '<div class="card-body"><div class="loyal">'+
        tierRow('gold','GOLD','Gold daraja','312 mijoz · 12% chegirma','1 240')+
        tierRow('silver','SLV','Silver daraja','874 mijoz · 7% chegirma','540')+
        tierRow('bronze','BRZ','Bronze daraja','2 108 mijoz · 3% chegirma','120')+
        '</div></div><div class="foot-link" data-goto="gift">Sovg\'alar katalogini boshqarish →</div></div>'+
      '<div class="card"><div class="card-head"><div><h3>Pul yechish so\'rovlari</h3><p>Tasdiqlash kutilmoqda · 2-bosqich confirm</p></div>'+
        '<span class="tg gold">5 ta</span></div>'+
        '<div class="table-wrap"><table><thead><tr><th>Haydovchi</th><th>Park</th><th>Summa</th><th>Provayder</th><th>Holat</th><th></th></tr></thead>'+
        '<tbody>'+withdrawRows+'</tbody></table></div></div>'+
    '</div>';

    // segment tugmalari
    root.querySelectorAll('.seg').forEach(function(seg){
      seg.querySelectorAll('button').forEach(function(b){ b.addEventListener('click',function(){
        seg.querySelectorAll('button').forEach(function(x){x.classList.remove('on');}); b.classList.add('on');
      });});
    });
    root.querySelectorAll('[data-goto]').forEach(function(b){ b.addEventListener('click',function(){ ctx.navigate(b.getAttribute('data-goto')); }); });
    root.querySelectorAll('[data-wd]').forEach(function(b){ b.addEventListener('click',function(){ window.confirmWithdrawal(b.getAttribute('data-wd')); }); });
    var no=root.querySelector('[data-new-order]'); if(no) no.addEventListener('click', window.newOrderModal);

    // Mount: jonli xarita + real-time obunalar
    root._onMount = function(){
      var mapEl = root.querySelector('#dashMap');
      var handle = window.GeoMap.create(mapEl, {zoom:9, scroll:false});
      if(window.Bus){
        window.addPageSub(window.Bus.on('driver:location', function(moved){ handle.setDrivers(moved); }));
        window.addPageSub(window.Bus.on('kpi:update', function(){
          var k=root.querySelector('#dashKpis'); if(k) k.innerHTML=kpiHTML();
          var s=root.querySelector('#dashStrip'); if(s) s.innerHTML=stripHTML();
          var on=root.querySelector('#dashOnline'); if(on) on.textContent=window.DB.drivers.filter(function(d){return d.status==='free'||d.status==='busy';}).length;
        }));
        window.addPageSub(window.Bus.on('order:new', function(){
          var tb=root.querySelector('#dashOrders'); if(!tb) return;
          tb.innerHTML = window.DB.orders.slice(0,5).map(rowHTML).join('');
        }));
      }
    };
    function rowHTML(o){
      return '<tr><td class="mono">'+o.id+'</td>'+
        '<td>'+U.cust(o.client,o.client_ini,o.client_phone)+'</td>'+
        '<td>'+U.route(o.from,o.to)+'</td><td>'+U.tariff(o.tariff)+'</td>'+
        '<td>'+U.park(o.park)+'</td><td class="sum">'+window.money(o.price)+'</td>'+
        '<td>'+U.orderTag(o.status)+'</td></tr>';
    }
    return root;
  };

  function statRow(color,name,num,pct){
    return '<div><div class="stat-row"><span class="dt" style="background:var(--'+color+')"></span>'+
      '<span class="nm">'+name+'</span><span class="num">'+num+'</span></div>'+
      '<div class="bar"><i style="width:'+pct+'%;background:var(--'+color+')"></i></div></div>';
  }
  function tierRow(cls,abbr,nm,ds,pts){
    return '<div class="tier-row"><div class="tier-badge '+cls+'">'+abbr+'</div>'+
      '<div><div class="nm">'+nm+'</div><div class="ds">'+ds+'</div></div>'+
      '<div class="pts"><b>'+pts+'</b><span>o\'rt. ball</span></div></div>';
  }

  /* ---------------- DISPETCHER ---------------- */
  window.PAGES.radio = function(ctx){
    return window.listPage({
      title:'Dispetcher', sub:'Kutilayotgan buyurtmalar navbati · 1226', live:true,
      actions:'<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Qo\'lda buyurtma</button>',
      placeholder:'Buyurtma yoki mijoz qidirish...',
      perPage:8, liveEvents:['order:new','order:updated','driver:status'],
      beforeTable:function(){
        var queue = window.DB.orders.filter(function(o){return o.status==='new'||o.status==='searching';});
        var freeDrivers = window.DB.drivers.filter(function(d){return d.status==='free';});
        return '<div class="strip">'+
          U.mini({icon:'inbox',bg:'var(--warning-soft)',color:'var(--warning)',label:'Navbatda',val:queue.length,unit:'buyurtma'})+
          U.mini({icon:'car',bg:'var(--success-soft)',color:'var(--success)',label:'Bo\'sh haydovchi',val:freeDrivers.length})+
          U.mini({icon:'clock',bg:'var(--info-soft)',color:'#84a9f5',label:'O\'rt. tayinlash',val:'1.8',unit:'daqiqa'})+
          '</div>';
      },
      rows:function(st){
        return window.DB.orders.filter(function(o){return (o.status==='new'||o.status==='searching') && U.matches(o,st.q,['id','client','from','to']);});
      },
      columns:[
        {th:'ID', render:function(o){return '<span class="mono">'+o.id+'</span>';}},
        {th:'Mijoz', render:function(o){return U.cust(o.client,o.client_ini,o.client_phone);}},
        {th:'Yo\'nalish', render:function(o){return U.route(o.from,o.to);}},
        {th:'Tarif', render:function(o){return U.tariff(o.tariff);}},
        {th:'Summa', cls:'sum', render:function(o){return window.money(o.price);}},
        {th:'Kutmoqda', render:function(o){return '<span class="muted">'+o.created_at+'</span>';}},
        {th:'Holat', render:function(o){return U.orderTag(o.status);}},
        {th:'', cls:'right', render:function(o){return '<button class="btn btn-primary btn-sm" data-assign="'+o.id+'">Tayinlash</button>';}}
      ],
      onRowClick:function(o){ window.orderDetail(o); }
    });
  };

  /* ---------------- BUYURTMALAR ---------------- */
  window.PAGES.bag = function(ctx){
    return window.listPage({
      title:'Buyurtmalar', sub:'Barcha buyurtmalar · filter, sort, qidiruv, eksport', live:true,
      actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>'+
              '<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Yangi buyurtma</button>',
      placeholder:'ID, mijoz yoki haydovchi qidirish...',
      perPage:10, exportName:'elga-buyurtmalar',
      liveEvents:['order:new','order:updated'],
      filters:function(st){return [
        {key:'status', label:'Holat', value:st.status||'', options:[
          window.opt('','Barcha holatlar'),window.opt('completed','Bajarildi'),window.opt('in_progress','Yo\'lda'),
          window.opt('searching','Qidirilmoqda'),window.opt('assigned','Tayinlangan'),window.opt('cancelled','Bekor')]},
        {key:'city', label:'Shahar', value:st.city||'', options:window.cityOptions()},
        {key:'route', label:'Safar turi', value:st.route||'', options:[window.opt('','Barcha safarlar'),window.opt('intra','Shahar ichi'),window.opt('inter','Shaharlararo')]},
        {key:'tariff', label:'Tarif', value:st.tariff||'', options:[window.opt('','Barcha tariflar')].concat(window.DB.TARIFFS.map(function(t){return window.opt(t,t);}))}
      ];},
      rows:function(st){
        return window.DB.orders.filter(function(o){
          return U.matches(o,st.q,['id','client','driver','from','to','from_place','to_place']) &&
            (!st.status||o.status===st.status) && (!st.city||o.from_city===st.city||o.to_city===st.city) &&
            (!st.tariff||o.tariff===st.tariff) && (!st.route||o.route_type===st.route);
        });
      },
      columns:[
        {th:'ID', sortKey:'id', csv:function(o){return o.id;}, render:function(o){return '<span class="mono">'+o.id+(o._new?' <span class="tg gold" style="padding:1px 6px;font-size:9px">yangi</span>':'')+'</span>';}},
        {th:'Mijoz', sortKey:'client', csv:function(o){return o.client;}, render:function(o){return U.cust(o.client,o.client_ini,o.client_phone);}},
        {th:'Yo\'nalish', csv:function(o){return o.from+' → '+o.to;}, render:function(o){return U.route(o.from,o.to);}},
        {th:'Haydovchi', csv:function(o){return o.driver||'';}, render:function(o){return o.driver?o.driver+' '+U.park(o.park):'<span class="muted">—</span>';}},
        {th:'Tarif', sortKey:'tariff', csv:function(o){return o.tariff;}, render:function(o){return U.tariff(o.tariff);}},
        {th:'Summa', cls:'sum', sortKey:'price', csv:function(o){return o.price;}, render:function(o){return window.money(o.price);}},
        {th:'To\'lov', csv:function(o){return payLabel(o.payment);}, render:function(o){return U.tariff(payLabel(o.payment));}},
        {th:'Holat', sortKey:'status', csv:function(o){return o.status;}, render:function(o){return U.orderTag(o.status);}}
      ],
      onRowClick:function(o){ window.orderDetail(o); }
    });
  };
  function payLabel(p){ return {cash:'Naqd',payme:'Payme',click:'Click',balance:'Balans'}[p]||p; }

  /* ---------------- JONLI XARITA ---------------- */
  window.PAGES.map = function(ctx){
    var root = document.createElement('div');
    var online = window.DB.drivers.filter(function(d){return d.status!=='offline'&&d.status!=='blocked';});

    root.innerHTML = window.pageHead({title:'Jonli xarita', sub:'Surxondaryo · '+online.length+' haydovchi onlayn', live:true,
      actions:'<button class="btn" data-refresh>'+window.icon('refresh',16)+'Yangilash</button>'})+
      '<div class="strip" id="mapStrip">'+
        U.mini({icon:'car',bg:'var(--success-soft)',color:'var(--success)',label:'Bo\'sh',val:window.DB.drivers.filter(function(d){return d.status==='free';}).length})+
        U.mini({icon:'route',bg:'var(--warning-soft)',color:'var(--warning)',label:'Buyurtmada',val:window.DB.drivers.filter(function(d){return d.status==='busy';}).length})+
        U.mini({icon:'pin',bg:'var(--info-soft)',color:'#84a9f5',label:'Shaharlar',val:window.DB.CITIES.length})+
      '</div>'+
      '<div class="card"><div class="card-head"><div><h3>Haydovchilar joylashuvi</h3><p>WebSocket: driver:location · jonli</p></div>'+
      '<div class="chart-legend"><span><i style="background:var(--success);border-radius:50%"></i>Bo\'sh</span>'+
      '<span><i style="background:var(--warning);border-radius:50%"></i>Buyurtmada</span>'+
      '<span><i style="background:var(--text-faint);border-radius:50%"></i>Oflayn</span></div></div>'+
      '<div class="card-body"><div id="liveMap" style="height:540px;border-radius:12px;overflow:hidden;border:1px solid var(--border)"></div></div></div>';

    root._onMount = function(){
      var handle = window.GeoMap.create(root.querySelector('#liveMap'), {zoom:9, tall:true, scroll:true,
        drivers: window.DB.drivers.filter(function(d){return d.status!=='offline'&&d.status!=='blocked';})});
      if(window.Bus){
        window.addPageSub(window.Bus.on('driver:location', function(moved){ handle.setDrivers(moved); }));
        window.addPageSub(window.Bus.on('kpi:update', function(){
          var s=root.querySelector('#mapStrip'); if(!s) return;
          s.innerHTML = U.mini({icon:'car',bg:'var(--success-soft)',color:'var(--success)',label:'Bo\'sh',val:window.DB.drivers.filter(function(d){return d.status==='free';}).length})+
            U.mini({icon:'route',bg:'var(--warning-soft)',color:'var(--warning)',label:'Buyurtmada',val:window.DB.drivers.filter(function(d){return d.status==='busy';}).length})+
            U.mini({icon:'pin',bg:'var(--info-soft)',color:'#84a9f5',label:'Shaharlar',val:window.DB.CITIES.length});
        }));
      }
      var rf=root.querySelector('[data-refresh]'); if(rf) rf.addEventListener('click',function(){ handle.setDrivers(window.DB.drivers.filter(function(d){return d.status!=='offline'&&d.status!=='blocked';})); U.toast('Yangilandi','Xarita yangilandi'); });
    };
    return root;
  };
})();
