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

    var kpis = [
      U.kpi({icon:'bag', bg:'var(--gold-soft)', color:'var(--gold)', label:'Bugungi buyurtmalar', val:'486', delta:'9.2%', deltaUp:true}),
      U.kpi({icon:'car', bg:'var(--success-soft)', color:'var(--success)', label:'Faol haydovchilar', val:'128', unit:'/ 214', delta:'4.1%', deltaUp:true}),
      U.kpi({icon:'cash', bg:'var(--warning-soft)', color:'var(--warning)', label:'Bugungi daromad', val:'6.8', unit:'mln so\'m', delta:'7.4%', deltaUp:true}),
      U.kpi({icon:'users', bg:'var(--info-soft)', color:'#84a9f5', label:'Yangi mijozlar', val:'34', delta:'1.8%', deltaUp:false})
    ].join('');

    var strip = [
      U.mini({icon:'clock', bg:'var(--info-soft)', color:'#84a9f5', label:'O\'rtacha kutish vaqti', val:'3.4', unit:'daqiqa'}),
      U.mini({icon:'xcircle', bg:'var(--danger-soft)', color:'var(--danger)', label:'Bekor qilish foizi', val:'8.1', unit:'%'}),
      U.mini({icon:'trend', bg:'var(--gold-soft)', color:'var(--gold)', label:'Bugungi komissiya (15%)', val:'1.02', unit:'mln so\'m'})
    ].join('');

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

    var pins = [
      ['26%','22%','success',''],['42%','48%','warning','busy'],['35%','73%','success',''],
      ['66%','30%','text-faint','off'],['76%','62%','success',''],['54%','82%','warning','busy'],['46%','38%','success','']
    ].map(function(p){return '<div class="map-pin '+p[3]+'" style="top:'+p[0]+';left:'+p[1]+';background:var(--'+p[2]+')"></div>';}).join('');
    var cityLbls = [['20%','18%','Angor'],['38%','44%','Muzrabot'],['30%','70%','Jarqo\'rg\'on'],['62%','26%','Sherobod'],['72%','60%','Termiz'],['50%','80%','Denov']]
      .map(function(c){return '<span class="map-city" style="top:'+c[0]+';left:'+c[1]+'">'+c[2]+'</span>';}).join('');

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
      actions:'<button class="btn">'+window.icon('download',16)+'Hisobot</button>'+
              '<button class="btn btn-primary" data-new-order>'+window.icon('plus',16)+'Yangi buyurtma</button>'
    })+
    '<div class="kpis">'+kpis+'</div>'+
    '<div class="strip">'+strip+'</div>'+
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
      '<div class="card"><div class="card-head"><div><h3>Jonli xarita</h3><p>Surxondaryo · 128 haydovchi onlayn</p></div>'+
        '<button class="btn btn-sm" data-goto="map">To\'liq xarita</button></div>'+
        '<div class="card-body"><div class="map">'+cityLbls+pins+
        '<div class="ph">'+window.icon('map',30)+'<div class="mono">[ jonli xarita · haydovchilar joylashuvi ]</div></div></div></div></div>'+
    '</div>'+
    '<div class="grid g-2 mb16" style="align-items:start">'+
      '<div class="card"><div class="card-head"><div><h3>So\'nggi buyurtmalar</h3><p>Real vaqt</p></div>'+
        '<button class="btn btn-sm" data-goto="bag">Barchasi</button></div>'+
        '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Mijoz</th><th>Yo\'nalish</th><th>Tarif</th><th>Park</th><th>Summa</th><th>Holat</th></tr></thead>'+
        '<tbody>'+ordersRows+'</tbody></table></div></div>'+
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
    var queue = window.DB.orders.filter(function(o){return o.status==='new'||o.status==='searching';});
    var freeDrivers = window.DB.drivers.filter(function(d){return d.status==='free';});
    return window.listPage({
      title:'Dispetcher', sub:'Kutilayotgan buyurtmalar navbati · 1226', live:true,
      actions:'<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Qo\'lda buyurtma</button>',
      placeholder:'Buyurtma yoki mijoz qidirish...',
      perPage:8,
      beforeTable:function(){
        return '<div class="strip">'+
          U.mini({icon:'inbox',bg:'var(--warning-soft)',color:'var(--warning)',label:'Navbatda',val:queue.length,unit:'buyurtma'})+
          U.mini({icon:'car',bg:'var(--success-soft)',color:'var(--success)',label:'Bo\'sh haydovchi',val:freeDrivers.length})+
          U.mini({icon:'clock',bg:'var(--info-soft)',color:'#84a9f5',label:'O\'rt. tayinlash',val:'1.8',unit:'daqiqa'})+
          '</div>';
      },
      getData:function(st){
        var rows = queue.filter(function(o){return U.matches(o,st.q,['id','client','from','to']);});
        var total=rows.length;
        return {rows:U.paginate(rows,st.page,8), total:total};
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
      title:'Buyurtmalar', sub:'Barcha buyurtmalar · filter, qidiruv, paginatsiya',
      actions:'<button class="btn">'+window.icon('download',16)+'Eksport</button>'+
              '<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Yangi buyurtma</button>',
      placeholder:'ID, mijoz yoki haydovchi qidirish...',
      perPage:10,
      filters:function(st){return [
        {key:'status', label:'Holat', value:st.status||'', options:[
          window.opt('','Barcha holatlar'),window.opt('completed','Bajarildi'),window.opt('in_progress','Yo\'lda'),
          window.opt('searching','Qidirilmoqda'),window.opt('assigned','Tayinlangan'),window.opt('cancelled','Bekor')]},
        {key:'city', label:'Shahar', value:st.city||'', options:window.cityOptions()},
        {key:'tariff', label:'Tarif', value:st.tariff||'', options:[window.opt('','Barcha tariflar')].concat(window.DB.TARIFFS.map(function(t){return window.opt(t,t);}))}
      ];},
      getData:function(st){
        var rows = window.DB.orders.filter(function(o){
          return U.matches(o,st.q,['id','client','driver','from','to']) &&
            (!st.status||o.status===st.status) && (!st.city||o.from===st.city||o.to===st.city) &&
            (!st.tariff||o.tariff===st.tariff);
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'ID', render:function(o){return '<span class="mono">'+o.id+'</span>';}},
        {th:'Mijoz', render:function(o){return U.cust(o.client,o.client_ini,o.client_phone);}},
        {th:'Yo\'nalish', render:function(o){return U.route(o.from,o.to);}},
        {th:'Haydovchi', render:function(o){return o.driver?o.driver+' '+U.park(o.park):'<span class="muted">—</span>';}},
        {th:'Tarif', render:function(o){return U.tariff(o.tariff);}},
        {th:'Summa', cls:'sum', render:function(o){return window.money(o.price);}},
        {th:'To\'lov', render:function(o){return U.tariff(payLabel(o.payment));}},
        {th:'Holat', render:function(o){return U.orderTag(o.status);}}
      ],
      onRowClick:function(o){ window.orderDetail(o); }
    });
  };
  function payLabel(p){ return {cash:'Naqd',payme:'Payme',click:'Click',balance:'Balans'}[p]||p; }

  /* ---------------- JONLI XARITA ---------------- */
  window.PAGES.map = function(ctx){
    var root = document.createElement('div');
    var online = window.DB.drivers.filter(function(d){return d.status!=='offline'&&d.status!=='blocked';});
    var pins='';
    for(var i=0;i<40;i++){
      var d=online[i%online.length];
      var top=(8+(i*53)%84)+'%', left=(6+(i*37)%88)+'%';
      var cls = d.status==='busy'?'busy':(d.status==='offline'?'off':'');
      var col = d.status==='busy'?'warning':(d.status==='offline'?'text-faint':'success');
      pins+='<div class="map-pin '+cls+'" style="top:'+top+';left:'+left+';background:var(--'+col+')"></div>';
    }
    var cityLbls = [['16%','14%','Angor'],['34%','40%','Muzrabot'],['26%','72%','Jarqo\'rg\'on'],['60%','22%','Sherobod'],['74%','58%','Termiz'],['48%','82%','Denov']]
      .map(function(c){return '<span class="map-city" style="top:'+c[0]+';left:'+c[1]+'">'+c[2]+'</span>';}).join('');

    root.innerHTML = window.pageHead({title:'Jonli xarita', sub:'Surxondaryo · '+online.length+' haydovchi onlayn', live:true,
      actions:'<button class="btn">'+window.icon('refresh',16)+'Yangilash</button>'})+
      '<div class="strip">'+
        U.mini({icon:'car',bg:'var(--success-soft)',color:'var(--success)',label:'Bo\'sh',val:window.DB.drivers.filter(function(d){return d.status==='free';}).length})+
        U.mini({icon:'route',bg:'var(--warning-soft)',color:'var(--warning)',label:'Buyurtmada',val:window.DB.drivers.filter(function(d){return d.status==='busy';}).length})+
        U.mini({icon:'pin',bg:'var(--info-soft)',color:'#84a9f5',label:'Shaharlar',val:window.DB.CITIES.length})+
      '</div>'+
      '<div class="card"><div class="card-head"><div><h3>Haydovchilar joylashuvi</h3><p>WebSocket: driver:location (mock)</p></div>'+
      '<div class="chart-legend"><span><i style="background:var(--success);border-radius:50%"></i>Bo\'sh</span>'+
      '<span><i style="background:var(--warning);border-radius:50%"></i>Buyurtmada</span>'+
      '<span><i style="background:var(--text-faint);border-radius:50%"></i>Oflayn</span></div></div>'+
      '<div class="card-body"><div class="map tall">'+cityLbls+pins+
      '<div class="ph">'+window.icon('map',30)+'<div class="mono">[ jonli xarita · api.elga.uz ulanganda Leaflet/Mapbox bilan almashtiriladi ]</div></div></div></div></div>';
    return root;
  };
})();
