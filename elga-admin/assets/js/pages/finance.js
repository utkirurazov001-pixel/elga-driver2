/* ====================================================================
   ELGA Admin — Moliya bo'limi
   ==================================================================== */
(function(){
  var U = window.UI;

  /* ---------------- MOLIYA HISOBOTI ---------------- */
  window.PAGES.finance = function(ctx){
    var root = document.createElement('div');
    var done=[4.1,4.8,4.4,5.2,5.6,5.1,5.9,6.3,5.8,6.6,6.9,6.2,7.1,6.8];
    var canc=[.4,.5,.4,.6,.7,.5,.6,.7,.5,.8,.8,.6,.9,.9];
    var days=['08','09','10','11','12','13','14','15','16','17','18','19','20','21'];
    var doneScaled = done.map(function(v){return v*100;});
    var cancScaled = canc.map(function(v){return v*100;});

    root.innerHTML = window.pageHead({title:'Moliya hisoboti', sub:'Iyun 2026 · daromad, komissiya, to\'lov tizimlari',
      actions:'<div class="seg"><button>Kun</button><button class="on">Oy</button><button>Yil</button></div>'+
              '<button class="btn">'+window.icon('download',16)+'Eksport (PDF)</button>'})+
      '<div class="kpis">'+
        U.kpi({icon:'cash',bg:'var(--success-soft)',color:'var(--success)',label:'Oylik daromad',val:'182.4',unit:'mln',delta:'12.6%',deltaUp:true})+
        U.kpi({icon:'trend',bg:'var(--gold-soft)',color:'var(--gold)',label:'Komissiya (15%)',val:'27.3',unit:'mln',delta:'8.1%',deltaUp:true})+
        U.kpi({icon:'wallet',bg:'var(--info-soft)',color:'#84a9f5',label:'Haydovchilarga',val:'155.1',unit:'mln',delta:'11.2%',deltaUp:true})+
        U.kpi({icon:'repeat',bg:'var(--danger-soft)',color:'var(--danger)',label:'Qaytarishlar',val:'1.8',unit:'mln',delta:'2.4%',deltaUp:false})+
      '</div>'+
      '<div class="grid g-2 mb16">'+
        '<div class="card"><div class="card-head"><div><h3>Daromad dinamikasi</h3><p>So\'nggi 14 kun (mln so\'m)</p></div></div>'+
          '<div class="card-body chart-wrap"><div class="chart-legend"><span><i style="background:var(--gold)"></i>Daromad</span>'+
          '<span><i style="background:var(--danger)"></i>Qaytarish</span></div>'+U.lineChart(doneScaled,cancScaled,days,800)+'</div></div>'+
        '<div class="card"><div class="card-head"><div><h3>To\'lov tizimlari</h3><p>Ulush</p></div></div>'+
          '<div class="card-body"><div class="donut-wrap">'+
          U.donut([{value:42,color:'var(--info)'},{value:31,color:'var(--success)'},{value:27,color:'var(--gold)'}],'100%','to\'lov')+
          '<div class="legend-list">'+
          '<div class="legend-row"><i style="background:var(--info)"></i><span class="t">Payme</span><span class="v">42%</span></div>'+
          '<div class="legend-row"><i style="background:var(--success)"></i><span class="t">Click</span><span class="v">31%</span></div>'+
          '<div class="legend-row"><i style="background:var(--gold)"></i><span class="t">Naqd / Balans</span><span class="v">27%</span></div>'+
          '</div></div></div></div>'+
      '</div>'+
      '<div class="card"><div class="card-head"><div><h3>Shaharlar bo\'yicha daromad</h3><p>Iyun 2026</p></div></div>'+
        '<div class="card-body"><div class="stat-rows">'+
        cityBars()+
        '</div></div></div>';

    root.querySelectorAll('.seg button').forEach(function(b){b.addEventListener('click',function(){
      b.parentNode.querySelectorAll('button').forEach(function(x){x.classList.remove('on');}); b.classList.add('on');
    });});
    return root;
  };
  function cityBars(){
    var data=[['Termiz',48,'gold'],['Denov',36,'success'],['Angor',31,'warning'],['Sherobod',24,'info'],['Muzrabot',21,'gold'],['Jarqo\'rg\'on',18,'success']];
    var max=48;
    return data.map(function(d){
      return '<div><div class="stat-row"><span class="dt" style="background:var(--'+d[2]+')"></span>'+
        '<span class="nm">'+d[0]+'</span><span class="num">'+d[1]+' mln</span></div>'+
        '<div class="bar"><i style="width:'+(d[1]/max*100)+'%;background:var(--'+d[2]+')"></i></div></div>';
    }).join('');
  }

  /* ---------------- PUL YECHISH ---------------- */
  window.PAGES.cash = function(ctx){
    return window.listPage({
      title:'Pul yechish so\'rovlari', sub:'Tasdiqlash ikki bosqichli (confirm) · BE-FR-020',
      actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>',
      placeholder:'Haydovchi qidirish...',
      perPage:10, exportName:'elga-pul-yechish',
      filters:function(st){return [
        {key:'status', value:st.status||'', options:[window.opt('','Barcha holatlar'),
          window.opt('pending','Kutilmoqda'),window.opt('approved','Tasdiqlangan'),window.opt('paid','To\'langan'),window.opt('rejected','Rad etilgan')]},
        {key:'provider', value:st.provider||'', options:[window.opt('','Barcha provayderlar'),window.opt('Payme','Payme'),window.opt('Click','Click')]}
      ];},
      rows:function(st){
        return window.DB.withdrawals.filter(function(w){
          return U.matches(w,st.q,['driver','driver_phone']) &&
            (!st.status||w.status===st.status)&&(!st.provider||w.provider===st.provider);
        });
      },
      columns:[
        {th:'ID', csv:function(w){return w.id;}, render:function(w){return '<span class="mono">'+w.id+'</span>';}},
        {th:'Haydovchi', sortKey:'driver', csv:function(w){return w.driver;}, render:function(w){return U.cust(w.driver,w.driver_ini,w.driver_phone);}},
        {th:'Park', sortKey:'park', csv:function(w){return w.park;}, render:function(w){return U.park(w.park);}},
        {th:'Summa', cls:'sum', sortKey:'amount', csv:function(w){return w.amount;}, render:function(w){return window.money(w.amount);}},
        {th:'Provayder', sortKey:'provider', csv:function(w){return w.provider;}, render:function(w){return U.tariff(w.provider);}},
        {th:'So\'ralgan', csv:function(w){return w.requested_at;}, render:function(w){return '<span class="muted">'+w.requested_at+'</span>';}},
        {th:'Holat', sortKey:'status', csv:function(w){return w.status;}, render:function(w){return U.genTag(w.status);}},
        {th:'', cls:'right', render:function(w){
          if(w.status!=='pending') return '<span class="muted">—</span>';
          return '<div class="row-actions"><button class="btn btn-primary btn-sm" data-wd="'+w.id+'">Tasdiqlash</button>'+
            '<button class="btn btn-danger btn-sm" data-wr="'+w.id+'">Rad</button></div>';
        }}
      ]
    });
  };

  /* ---------------- TRANZAKSIYALAR ---------------- */
  window.PAGES.wallet = function(ctx){
    var tlabel = {ride_payment:'Safar to\'lovi',commission:'Komissiya',topup:'To\'ldirish',withdrawal:'Yechish',refund:'Qaytarish'};
    return window.listPage({
      title:'Tranzaksiyalar', sub:'Barcha moliyaviy harakatlar',
      actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>',
      placeholder:'ID, buyurtma yoki ism...',
      perPage:12, exportName:'elga-tranzaksiyalar',
      filters:function(st){return [
        {key:'type', value:st.type||'', options:[window.opt('','Barcha turlar'),
          window.opt('ride_payment','Safar to\'lovi'),window.opt('commission','Komissiya'),
          window.opt('topup','To\'ldirish'),window.opt('withdrawal','Yechish'),window.opt('refund','Qaytarish')]},
        {key:'status', value:st.status||'', options:[window.opt('','Barcha holatlar'),
          window.opt('success','Muvaffaqiyatli'),window.opt('pending','Kutilmoqda'),window.opt('failed','Xato')]}
      ];},
      rows:function(st){
        return window.DB.transactions.filter(function(t){
          return U.matches(t,st.q,['id','order','who']) &&
            (!st.type||t.type===st.type)&&(!st.status||t.status===st.status);
        });
      },
      columns:[
        {th:'ID', csv:function(t){return t.id;}, render:function(t){return '<span class="mono">'+t.id+'</span>';}},
        {th:'Tur', sortKey:'type', csv:function(t){return tlabel[t.type]||t.type;}, render:function(t){return U.tariff(tlabel[t.type]||t.type);}},
        {th:'Buyurtma', csv:function(t){return t.order||'';}, render:function(t){return t.order?'<span class="mono muted">'+t.order+'</span>':'<span class="muted">—</span>';}},
        {th:'Tomon', sortKey:'who', csv:function(t){return t.who;}, render:function(t){return t.who;}},
        {th:'Provayder', sortKey:'provider', csv:function(t){return t.provider;}, render:function(t){return t.provider;}},
        {th:'Summa', cls:'sum', sortKey:'amount', csv:function(t){return t.amount;}, render:function(t){return (t.type==='refund'||t.type==='withdrawal'?'−':'')+window.money(t.amount);}},
        {th:'Vaqt', csv:function(t){return t.created_at;}, render:function(t){return '<span class="muted">'+t.created_at+'</span>';}},
        {th:'Holat', sortKey:'status', csv:function(t){return t.status;}, render:function(t){return U.genTag(t.status);}}
      ]
    });
  };

  /* ---------------- TARIFLAR ---------------- */
  window.PAGES.tag = function(ctx){
    var root = document.createElement('div');
    function render(){
      root.innerHTML = window.pageHead({title:'Tariflar', sub:'Shahar bo\'yicha narx hisoblash · surge va komissiya',
        actions:'<button class="btn btn-primary" data-new-tariff>'+window.icon('plus',16)+'Yangi tarif</button>'});
      var cards = document.createElement('div');
      cards.className='reward-grid';
      window.DB.tariffs.forEach(function(t){
        var card=document.createElement('div');
        card.className='card';
        card.innerHTML = '<div class="card-head"><div><h3>'+t.name+'</h3><p>'+(t.active?'Faol':'Nofaol')+' · komissiya '+t.commission+'%</p></div>'+
          (t.surge>1?'<span class="tg gold">surge ×'+t.surge+'</span>':U.genTag(t.active))+'</div>'+
          '<div class="card-body"><dl class="dl">'+
          row('Bazaviy narx',window.money(t.base)+' so\'m')+
          row('Har km',window.money(t.per_km)+' so\'m')+
          row('Har daqiqa',window.money(t.per_min)+' so\'m')+
          row('Minimal narx',window.money(t.min_fare)+' so\'m')+
          row('Surge koeff.','×'+t.surge.toFixed(1))+
          row('Komissiya',t.commission+'%')+
          '</dl></div><div class="foot-link" data-edit="'+t.id+'">'+window.icon('edit',15)+' Tahrirlash</div>';
        cards.appendChild(card);
      });
      root.appendChild(cards);
      root.querySelectorAll('[data-edit]').forEach(function(b){b.addEventListener('click',function(){window.tariffModal(b.getAttribute('data-edit'),render);});});
      var nt=root.querySelector('[data-new-tariff]'); if(nt) nt.addEventListener('click',function(){window.tariffModal(null,render);});
    }
    function row(k,v){ return '<dt>'+k+'</dt><dd class="mono">'+v+'</dd>'; }
    render();
    return root;
  };
})();
