/* ====================================================================
   ELGA Admin — Tizim bo'limi
   ==================================================================== */
(function(){
  var U = window.UI;

  /* ---------------- SHAHARLAR / ZONALAR + MO'LJALLAR ---------------- */
  window.PAGES.pin = function(ctx){
    var root = document.createElement('div');
    var tab = 'cities';
    function render(){
      root.innerHTML = window.pageHead({title:'Shaharlar / Zonalar', sub:'Surxondaryo · 6 shahar (RULE-04) · manzillar lug\'ati to\'planib boradi'});
      var tabs=document.createElement('div'); tabs.className='tabs';
      [['cities','Shaharlar'],['places','Mo\'ljallar (manzillar)']].forEach(function(it){
        var b=document.createElement('button'); b.textContent=it[1]; if(it[0]===tab) b.className='on';
        b.addEventListener('click',function(){ tab=it[0]; render(); });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      var content=document.createElement('div');
      content.appendChild(tab==='cities'?citiesNode():placesNode());
      root.appendChild(content);
    }
    root._render = render; // joriy tabni saqlab qayta render (rerenderPage uchun)
    function citiesNode(){
      return window.listPage({
        title:'', sub:'', placeholder:'Shahar qidirish...',
        rows:function(st){ return window.DB.cities.filter(function(c){return U.matches(c,st.q,['name']);}); },
        columns:[
          {th:'Shahar', sortKey:'name', render:function(c){return '<div class="route">'+window.icon('pin',14)+'<b>'+c.name+'</b></div>';}},
          {th:'Viloyat', render:function(c){return c.region;}},
          {th:'Haydovchilar', sortKey:'drivers', render:function(c){return c.drivers;}},
          {th:'Buyurtmalar', sortKey:'orders', render:function(c){return c.orders;}},
          {th:'Mo\'ljallar', render:function(c){return window.DB.placesOf(c.name).length;}},
          {th:'Holat', render:function(c){return c.active?U.genTag('true'):U.genTag('false');}},
          {th:'', cls:'right', render:function(c){return '<button class="btn btn-icon btn-sm" title="Tahrir">'+window.icon('edit',15)+'</button>';}}
        ]
      });
    }
    function placesNode(){
      return window.listPage({
        title:'', sub:'', placeholder:'Mo\'ljal nomi qidirish...', perPage:12, exportName:'elga-moljallar',
        actions:'<button class="btn" data-export>'+window.icon('download',16)+'CSV eksport</button>'+
                '<button class="btn btn-primary" data-add-place>'+window.icon('plus',16)+'Mo\'ljal qo\'shish</button>',
        filters:function(st){return [
          {key:'city', value:st.city||'', options:window.cityOptions()},
          {key:'source', value:st.source||'', options:[window.opt('','Barcha manba'),window.opt('seed','Bazaviy'),window.opt('kiritilgan','Kiritilgan')]}
        ];},
        rows:function(st){
          return window.DB.places.filter(function(p){
            return U.matches(p,st.q,['name','city']) && (!st.city||p.city===st.city) && (!st.source||p.source===st.source);
          }).sort(function(a,b){return b.count-a.count;});
        },
        columns:[
          {th:'Mo\'ljal / manzil', sortKey:'name', csv:function(p){return p.name;}, render:function(p){return '<b>'+U.esc(p.name)+'</b>';}},
          {th:'Shahar', sortKey:'city', csv:function(p){return p.city;}, render:function(p){return '<div class="route">'+window.icon('pin',13)+U.esc(p.city)+'</div>';}},
          {th:'Foydalanish', sortKey:'count', csv:function(p){return p.count;}, render:function(p){return '<span class="mono gold">'+p.count+'</span>';}},
          {th:'Manba', csv:function(p){return p.source;}, render:function(p){return U.tariff(p.source==='seed'?'Bazaviy':'Kiritilgan');}},
          {th:'Qo\'shilgan', csv:function(p){return p.added_at;}, render:function(p){return '<span class="muted">'+p.added_at+'</span>';}}
        ]
      });
    }
    render();
    return root;
  };

  /* ---------------- BILDIRISHNOMALAR ---------------- */
  window.PAGES.bell = function(ctx){
    var root=document.createElement('div');
    function render(){
      root.innerHTML = window.pageHead({title:'Bildirishnomalar', sub:window.DB.notifications.filter(function(n){return !n.read;}).length+' ta o\'qilmagan',
        actions:'<button class="btn" data-readall>'+window.icon('check',16)+'Hammasini o\'qildi</button>'});
      var card=document.createElement('div'); card.className='card';
      var body=document.createElement('div'); body.className='card-body';
      var list=document.createElement('div'); list.className='cmp-list';
      window.DB.notifications.forEach(function(n){
        var toneCls = n.tone==='danger'?'':(n.tone==='gold'?'gold':'info');
        var item=document.createElement('div'); item.className='cmp';
        item.style.opacity = n.read?'.6':'1';
        item.innerHTML='<div class="ic '+toneCls+'">'+window.icon(n.icon,16)+'</div>'+
          '<div><div class="tt">'+n.title+(n.read?'':' <span class="tg gold" style="padding:1px 7px;font-size:10px">yangi</span>')+'</div>'+
          '<div class="ds">'+n.body+'</div></div><div class="tm">'+n.created_at+'</div>';
        item.addEventListener('click',function(){n.read=true; render();});
        list.appendChild(item);
      });
      body.appendChild(list); card.appendChild(body); root.appendChild(card);
      root.querySelector('[data-readall]').addEventListener('click',function(){
        window.DB.notifications.forEach(function(n){n.read=true;}); window.UI.toast('Bajarildi','Barcha bildirishnomalar o\'qildi'); render(); window.refreshBadges&&window.refreshBadges();
      });
    }
    render();
    return root;
  };

  /* ---------------- AUDIT JURNALI ---------------- */
  window.PAGES.audit = function(ctx){
    return window.listPage({
      title:'Audit jurnali', sub:'O\'zgarmas (immutable) yozuvlar · faqat super_admin',
      actions:'<button class="btn">'+window.icon('download',16)+'Eksport</button>',
      placeholder:'Amal, xodim yoki obyekt...',
      perPage:12,
      filters:function(st){return [
        {key:'entity', value:st.entity||'', options:[window.opt('','Barcha obyektlar'),
          window.opt('orders','Buyurtmalar'),window.opt('drivers','Haydovchilar'),window.opt('withdrawals','Pul yechish'),
          window.opt('tariffs','Tariflar'),window.opt('admin_users','Xodimlar')]}
      ];},
      getData:function(st){
        var rows = window.DB.audit.filter(function(a){
          return U.matches(a,st.q,['action','user','entity_id','detail']) && (!st.entity||a.entity===st.entity);
        });
        return {rows:U.paginate(rows,st.page,12), total:rows.length};
      },
      columns:[
        {th:'Vaqt', render:function(a){return '<span class="muted">'+a.created_at+'</span>';}},
        {th:'Xodim', render:function(a){return '<b>'+a.user+'</b><br><span class="muted" style="font-size:11px">'+window.roleLabel(a.role)+'</span>';}},
        {th:'Amal', render:function(a){return '<span class="mono" style="color:var(--gold)">'+a.action+'</span>';}},
        {th:'Obyekt', render:function(a){return '<span class="tariff-chip">'+a.entity+'</span> <span class="mono muted">'+a.entity_id+'</span>';}},
        {th:'Tafsilot', render:function(a){return a.detail;}},
        {th:'IP', render:function(a){return '<span class="mono muted">'+a.ip+'</span>';}}
      ]
    });
  };

  /* ---------------- SOZLAMALAR (sub: general/roles/payments/brand) ---------------- */
  window.PAGES.cog = function(ctx){
    var sub = ctx.sub||'general';
    var root=document.createElement('div');
    root.innerHTML = window.pageHead({title:'Sozlamalar', sub:'Tizim konfiguratsiyasi'});
    var tabs=document.createElement('div'); tabs.className='tabs';
    var items=[['general','Umumiy'],['roles','Rollar va ruxsatlar'],['payments','To\'lov (Payme / Click)'],['brand','Brend']];
    items.forEach(function(it){
      var b=document.createElement('button'); b.textContent=it[1]; if(it[0]===sub) b.className='on';
      b.addEventListener('click',function(){ ctx.navigate('cog', it[0]); });
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
    var body=document.createElement('div');
    body.innerHTML = settingsBody(sub);
    root.appendChild(body);
    body.querySelectorAll('[data-save]').forEach(function(b){b.addEventListener('click',function(){window.UI.toast('Saqlandi','Sozlamalar yangilandi');});});
    return root;
  };

  function settingsBody(sub){
    if(sub==='roles') return rolesMatrix();
    if(sub==='payments') return paymentsCard();
    if(sub==='brand') return brandCard();
    return generalCard();
  }

  function generalCard(){
    return '<div class="grid g-half" style="align-items:start">'+
      '<div class="card"><div class="card-head"><div><h3>Umumiy</h3><p>Platforma sozlamalari</p></div></div>'+
      '<div class="card-body"><div class="form-grid">'+
      field('Platforma nomi','ELGA TAXI 1226')+field('Dispetcher raqami','1226',true)+
      field('Asosiy domen','app.elga.uz')+field('API manzili','api.elga.uz')+
      fieldFull('Standart viloyat','Surxondaryo')+
      '<div class="field full"><label>Ball koeffitsienti (RULE-08)</label><input class="input" value="1000 so\'m = 1 ball"></div>'+
      '</div><div style="margin-top:18px"><button class="btn btn-primary" data-save>Saqlash</button></div></div></div>'+
      '<div class="card"><div class="card-head"><div><h3>Komissiya va limitlar</h3><p>Standart qiymatlar</p></div></div>'+
      '<div class="card-body"><div class="form-grid">'+
      field('Standart komissiya','15%')+field('Min. pul yechish','100 000 so\'m')+
      field('Bekor qilish to\'lovi','5 000 so\'m')+field('Kutish (bepul)','3 daqiqa')+
      '</div><div style="margin-top:18px"><button class="btn btn-primary" data-save>Saqlash</button></div></div></div>'+
      '</div>';
  }
  function rolesMatrix(){
    var roles=window.DB.ROLES;
    var perms=[
      ['Xodimlar (CRUD)',[1,0,0,0,0]],['Haydovchilar (o\'qish)',[1,1,0,1,0]],['Haydovchilar (blok)',[1,1,0,0,0]],
      ['KYC tasdiqlash',[1,1,0,0,0]],['Mijozlar',[1,1,0,0,0]],['Buyurtmalar (o\'qish)',[1,1,0,1,0]],
      ['Buyurtma tayinlash',[1,1,0,1,0]],['Tariflar',[1,0,1,0,0]],['Moliya / tranzaksiya',[1,0,1,0,0]],
      ['Pul yechish (tasdiq)',[1,0,1,0,0]],['Shikoyatlar',[1,1,0,0,1]],['Audit jurnali',[1,0,0,0,0]],['Dashboard',[1,1,1,1,1]]
    ];
    var head='<th>Resurs</th>'+roles.map(function(r){return '<th style="text-align:center">'+window.roleLabel(r)+'</th>';}).join('');
    var body=perms.map(function(p){
      return '<tr><td><b>'+p[0]+'</b></td>'+p[1].map(function(v){
        return '<td style="text-align:center">'+(v?'<span style="color:var(--success)">'+window.icon('check',16)+'</span>':'<span class="muted">—</span>')+'</td>';
      }).join('')+'</tr>';
    }).join('');
    return '<div class="card"><div class="card-head"><div><h3>Rollar va ruxsatlar matritsasi</h3><p>Server-side majburlanadi (RBAC-01) · TZ §4.2</p></div></div>'+
      '<div class="table-wrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+body+'</tbody></table></div></div>';
  }
  function paymentsCard(){
    return '<div class="grid g-half" style="align-items:start">'+
      provCard('Payme','Merchant API (JSON-RPC)','PAYME_MERCHANT_ID','PAYME_KEY')+
      provCard('Click','Shop API (Prepare/Complete)','CLICK_SERVICE_ID','CLICK_SECRET')+
      '</div>'+
      '<div class="card" style="margin-top:16px"><div class="card-body"><div class="cmp"><div class="ic gold">'+window.icon('shield',16)+'</div>'+
      '<div><div class="tt">Imzo tekshiruvi majburiy (PAY-03)</div><div class="ds">Har callback imzo/auth tekshiruvidan o\'tadi, idempotent. Maxfiy kalitlar faqat .env da saqlanadi — repoga commit qilinmaydi (BE-SEC-04).</div></div></div></div></div>';
  }
  function provCard(name,api,k1,k2){
    return '<div class="card"><div class="card-head"><div><h3>'+name+'</h3><p>'+api+'</p></div><span class="tg done">Ulangan</span></div>'+
      '<div class="card-body"><div class="form-grid">'+
      '<div class="field full"><label>'+k1+'</label><input class="input mono" value="•••••••••••• (env)" disabled></div>'+
      '<div class="field full"><label>'+k2+'</label><input class="input mono" value="•••••••••••• (env)" disabled></div>'+
      '</div><div style="margin-top:16px"><button class="btn btn-sm" data-save>Test ulanish</button></div></div></div>';
  }
  function brandCard(){
    return '<div class="card"><div class="card-head"><div><h3>Brend identikasi</h3><p>Manba: brand.config.json (yagona haqiqat)</p></div></div>'+
      '<div class="card-body"><div class="form-grid">'+
      field('Nom','ELGA TAXI')+field('Dispetcher','1226',true)+
      fieldFull('Slogan','HAR DOIM YONINGIZDA!')+
      '<div class="field"><label>Asosiy rang</label><div style="display:flex;gap:8px;align-items:center"><span style="width:34px;height:34px;border-radius:9px;background:#FFCC00"></span><input class="input mono" value="#FFCC00" style="flex:1"></div></div>'+
      '<div class="field"><label>Gold-dark</label><div style="display:flex;gap:8px;align-items:center"><span style="width:34px;height:34px;border-radius:9px;background:#C9A24B"></span><input class="input mono" value="#C9A24B" style="flex:1"></div></div>'+
      '<div class="field"><label>Fon (qora)</label><div style="display:flex;gap:8px;align-items:center"><span style="width:34px;height:34px;border-radius:9px;background:#15171C;border:1px solid var(--border)"></span><input class="input mono" value="#15171C" style="flex:1"></div></div>'+
      '<div class="field"><label>Font</label><input class="input" value="Manrope"></div>'+
      '</div>'+
      '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap"><span class="login-pillars" style="display:flex;gap:8px"><span>TEZ</span><span>XAVFSIZ</span><span>ISHONCHLI</span></span></div>'+
      '<div class="hint" style="margin-top:14px">⚠ «1226», slogan va logotip lockup hech qachon o\'zgartirilmaydi (RULE-03, brand.usage.neverChange).</div>'+
      '<div style="margin-top:14px"><button class="btn btn-primary" data-save>Saqlash</button></div></div></div>';
  }

  function field(label,val,lock){
    return '<div class="field"><label>'+label+(lock?' 🔒':'')+'</label><input class="input'+(lock?' mono':'')+'" value="'+val+'"'+(lock?' readonly':'')+'></div>';
  }
  function fieldFull(label,val){ return '<div class="field full"><label>'+label+'</label><input class="input" value="'+val+'"></div>'; }
})();
