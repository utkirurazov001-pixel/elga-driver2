/* ====================================================================
   ELGA Admin — Sadoqat (loyalty) bo'limi · RULE-08
   ==================================================================== */
(function(){
  var U = window.UI;

  /* ---------------- BALL HISOBLARI ---------------- */
  window.PAGES.star = function(ctx){
    return window.listPage({
      title:'Ball hisoblari', sub:'Mijoz sadoqat balanslari · har 1000 so\'m = 1 ball',
      actions:'<button class="btn btn-primary" data-adjust>'+window.icon('plus',16)+'Qo\'lda ball</button>',
      placeholder:'Mijoz qidirish...',
      perPage:10,
      filters:function(st){return [
        {key:'tier', value:st.tier||'', options:[window.opt('','Barcha darajalar'),
          window.opt('gold','Gold'),window.opt('silver','Silver'),window.opt('bronze','Bronze')]}
      ];},
      beforeTable:function(){
        var g=window.DB.clients.filter(function(c){return c.tier==='gold';}).length;
        var s=window.DB.clients.filter(function(c){return c.tier==='silver';}).length;
        var b=window.DB.clients.filter(function(c){return c.tier==='bronze';}).length;
        return '<div class="strip">'+
          U.mini({icon:'star',bg:'var(--gold-soft)',color:'var(--gold)',label:'Gold mijozlar',val:g})+
          U.mini({icon:'star',bg:'rgba(215,220,227,.13)',color:'#d7dce3',label:'Silver mijozlar',val:s})+
          U.mini({icon:'star',bg:'rgba(205,155,106,.13)',color:'#cd9b6a',label:'Bronze mijozlar',val:b})+
          '</div>';
      },
      getData:function(st){
        var rows = window.DB.clients.filter(function(c){
          return U.matches(c,st.q,['full_name','phone']) && (!st.tier||c.tier===st.tier);
        }).sort(function(a,b){return b.points-a.points;});
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'Mijoz', render:function(c){return U.cust(c.full_name,c.ini,c.phone,true);}},
        {th:'Daraja', render:function(c){return '<span class="tier-badge '+c.tier+'" style="display:inline-grid;width:30px;height:22px;font-size:9px;border-radius:6px">'+c.tier.slice(0,3).toUpperCase()+'</span>';}},
        {th:'Joriy ball', render:function(c){return '<b class="mono gold">'+c.points+'</b>';}},
        {th:'Jami yig\'ilgan', render:function(c){return '<span class="mono">'+(c.points+c.orders_count*4)+'</span>';}},
        {th:'Buyurtmalar', render:function(c){return c.orders_count;}},
        {th:'', cls:'right', render:function(c){return '<button class="btn btn-sm" data-adj="'+c.id+'">Ball boshqarish</button>';}}
      ],
      onRowClick:function(c){ window.clientDetail(c); }
    });
  };

  /* ---------------- SOVG'ALAR KATALOGI ---------------- */
  window.PAGES.gift = function(ctx){
    var root = document.createElement('div');
    var TYPE = {discount:'Chegirma',gift:'Sovg\'a',free_ride:'Bepul safar'};
    function render(){
      root.innerHTML = window.pageHead({title:'Sovg\'alar katalogi', sub:'Ballga almashtiriladigan sovg\'alar · '+window.DB.rewards.length+' ta',
        actions:'<button class="btn btn-primary" data-new>'+window.icon('plus',16)+'Yangi sovg\'a</button>'});
      var grid=document.createElement('div'); grid.className='reward-grid';
      window.DB.rewards.forEach(function(r){
        var el=document.createElement('div'); el.className='reward';
        el.innerHTML='<div class="top">'+window.icon(r.icon,34)+'<span class="cost">'+r.cost+' ball</span></div>'+
          '<div class="bd"><b>'+r.title+'</b><p>'+r.desc+'</p>'+
          '<div class="meta">'+U.tariff(TYPE[r.type])+(r.stock>0?'<span class="muted" style="font-size:12px">Zaxira: '+(r.stock>9000?'∞':r.stock)+'</span>':'<span class="tg canc">Tugagan</span>')+
          (r.active?'':'<span class="tg neutral">Nofaol</span>')+'</div>'+
          '<div class="row-actions" style="margin-top:8px;justify-content:flex-start;gap:8px">'+
          '<button class="btn btn-sm" data-edit="'+r.id+'">'+window.icon('edit',14)+' Tahrir</button>'+
          '<button class="btn btn-sm btn-ghost" data-toggle="'+r.id+'">'+(r.active?'O\'chirish':'Yoqish')+'</button></div></div>';
        grid.appendChild(el);
      });
      root.appendChild(grid);
      root.querySelector('[data-new]').addEventListener('click',function(){window.rewardModal(null,render);});
      root.querySelectorAll('[data-edit]').forEach(function(b){b.addEventListener('click',function(){window.rewardModal(b.getAttribute('data-edit'),render);});});
      root.querySelectorAll('[data-toggle]').forEach(function(b){b.addEventListener('click',function(){
        var r=window.DB.rewards.find(function(x){return x.id===b.getAttribute('data-toggle');});
        r.active=!r.active; window.UI.toast('Yangilandi', r.title+' '+(r.active?'yoqildi':'o\'chirildi')); render();
      });});
    }
    render();
    return root;
  };

  /* ---------------- ALMASHTIRISHLAR ---------------- */
  window.PAGES.repeat = function(ctx){
    return window.listPage({
      title:'Almashtirishlar', sub:'Mijozlar sovg\'aga almashtirgan ballar (redemptions)',
      placeholder:'Mijoz, kod yoki sovg\'a...',
      perPage:10,
      filters:function(st){return [
        {key:'status', value:st.status||'', options:[window.opt('','Barcha holatlar'),
          window.opt('pending','Kutilmoqda'),window.opt('fulfilled','Berildi'),window.opt('cancelled','Bekor')]}
      ];},
      getData:function(st){
        var rows = window.DB.redemptions.filter(function(r){
          return U.matches(r,st.q,['client','code','reward']) && (!st.status||r.status===st.status);
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'ID', render:function(r){return '<span class="mono">'+r.id+'</span>';}},
        {th:'Mijoz', render:function(r){return U.cust(r.client,r.client_ini,'',true);}},
        {th:'Sovg\'a', render:function(r){return '<b>'+r.reward+'</b>';}},
        {th:'Ball', render:function(r){return '<span class="mono gold">−'+r.points+'</span>';}},
        {th:'Kod', render:function(r){return '<span class="mono">'+r.code+'</span>';}},
        {th:'Sana', render:function(r){return '<span class="muted">'+r.created_at+'</span>';}},
        {th:'Holat', render:function(r){return U.genTag(r.status);}},
        {th:'', cls:'right', render:function(r){
          if(r.status!=='pending') return '<span class="muted">—</span>';
          return '<button class="btn btn-success btn-sm" data-fulfill="'+r.id+'">Berildi</button>';
        }}
      ]
    });
  };

  /* ---------------- PROMO-KODLAR ---------------- */
  window.PAGES.ticket = function(ctx){
    var TYPE={percent:'Foiz',fixed:'Qat\'iy',points:'Ball'};
    return window.listPage({
      title:'Promo-kodlar', sub:'Chegirma kodlari · foiz / qat\'iy / ball',
      actions:'<button class="btn btn-primary" data-new-promo>'+window.icon('plus',16)+'Promo-kod</button>',
      toolbarRight:'',
      placeholder:'Kod qidirish...',
      perPage:10,
      filters:function(st){return [
        {key:'active', value:st.active||'', options:[window.opt('','Hammasi'),window.opt('yes','Faol'),window.opt('no','Nofaol')]}
      ];},
      getData:function(st){
        var rows = window.DB.promos.filter(function(p){
          return U.matches(p,st.q,['code']) && (!st.active||(st.active==='yes'?p.active:!p.active));
        });
        return {rows:rows, total:null};
      },
      columns:[
        {th:'Kod', render:function(p){return '<span class="mono gold" style="font-weight:700">'+p.code+'</span>';}},
        {th:'Tur', render:function(p){return U.tariff(TYPE[p.type]);}},
        {th:'Qiymat', render:function(p){return '<b>'+(p.type==='percent'?p.value+'%':(p.type==='points'?p.value+' ball':window.money(p.value)+' so\'m'))+'</b>';}},
        {th:'Min. buyurtma', render:function(p){return p.min_order?window.money(p.min_order):'—';}},
        {th:'Foydalanish', render:function(p){return '<span class="mono">'+p.used+' / '+p.limit+'</span>';}},
        {th:'Amal muddati', render:function(p){return '<span class="muted">'+p.valid_to+'</span>';}},
        {th:'Holat', render:function(p){return p.active?U.genTag('true'):U.genTag('false');}},
        {th:'', cls:'right', render:function(p){return '<button class="btn btn-icon btn-sm" data-edit-promo="'+p.id+'" title="Tahrir">'+window.icon('edit',15)+'</button>';}}
      ]
    });
  };
})();
