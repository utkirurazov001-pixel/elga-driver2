/* ====================================================================
   ELGA Admin — Modal oynalar va amallar
   ==================================================================== */
(function(){
  var U = window.UI;
  function dl(rows){ return '<dl class="dl">'+rows.map(function(r){return '<dt>'+r[0]+'</dt><dd>'+r[1]+'</dd>';}).join('')+'</dl>'; }

  /* ---- BUYURTMA DETALI ---- */
  window.orderDetail = function(o){
    var pay={cash:'Naqd',payme:'Payme',click:'Click',balance:'Balans'}[o.payment]||o.payment;
    var hist = buildHistory(o);
    U.modal({
      title:'Buyurtma '+o.id, sub:U.orderTag(o.status).replace(/<[^>]+>/g,function(m){return m;}),
      wide:true,
      body:'<div class="grid g-half" style="align-items:start;gap:20px">'+
        '<div>'+dl([
          ['Mijoz', o.client],['Telefon','<span class="mono">'+o.client_phone+'</span>'],
          ['Olish','<b>'+U.esc(o.from||'')+'</b>'],['Tushirish','<b>'+U.esc(o.to||'')+'</b>'],
          ['Safar turi', o.route_type==='inter'?'<span class="tg gold">Shaharlararo</span>':'<span class="tg neutral">Shahar ichi</span>'],
          ['Tarif', U.tariff(o.tariff)],
          ['Masofa', o.distance+' km'],['Davomiyligi', o.duration+' daq'],
          ['Haydovchi', o.driver||'—'],['Park', o.park?o.park:'—'],
          ['To\'lov', pay],['Summa','<b class="mono">'+window.money(o.price)+' so\'m</b>'],
          ['Komissiya (15%)','<span class="mono">'+window.money(o.commission)+' so\'m</span>'],
          ['Holat', U.orderTag(o.status)]
        ].concat(o.cancel_reason?[['Bekor sababi','<span style="color:var(--danger)">'+o.cancel_reason+'</span>']]:[]))+'</div>'+
        '<div><div class="card-head" style="padding:0 0 12px;border:none"><h3 style="font-size:14px">Holat tarixi</h3></div>'+hist+'</div>'+
      '</div>',
      foot: (o.status==='new'||o.status==='searching') ?
        '<button class="btn" data-close>Yopish</button><button class="btn btn-primary" data-assign-modal="'+o.id+'">Haydovchiga tayinlash</button>' :
        '<button class="btn" data-close>Yopish</button>',
      onMount:function(back,close){
        var a=back.querySelector('[data-assign-modal]');
        if(a) a.addEventListener('click',function(){ close(); window.assignDriver(o); });
        back.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',close);});
      }
    });
  };
  function buildHistory(o){
    var steps=[['Buyurtma yaratildi','new'],['Qidirilmoqda','searching'],['Tayinlandi','assigned'],['Yetib bormoqda','arriving'],['Boshlandi','in_progress'],['Yakunlandi','completed']];
    var order=['new','searching','assigned','arriving','in_progress','completed'];
    var idx=order.indexOf(o.status);
    if(o.status==='cancelled') idx=1;
    var done=steps.slice(0, idx<0?1:idx+1);
    var html='<div class="timeline">';
    done.forEach(function(s,i){
      html+='<div class="tl-item"><div class="dot" style="background:'+(i===done.length-1?'var(--gold)':'var(--success)')+'"></div>'+
        '<div class="tx"><b>'+s[0]+'</b><span>'+o.created_at+'</span></div></div>';
    });
    if(o.status==='cancelled'){
      html+='<div class="tl-item"><div class="dot" style="background:var(--danger)"></div><div class="tx"><b>Bekor qilindi</b><span>'+(o.cancel_reason||'')+'</span></div></div>';
    }
    return html+'</div>';
  }

  /* ---- HAYDOVCHI DETALI ---- */
  window.driverDetail = function(d, rerender){
    U.modal({
      title:d.full_name, sub:'Park '+d.park_number+' · '+d.car_make+' '+d.car_model,
      wide:true,
      body:'<div class="grid g-half" style="align-items:start;gap:20px">'+
        '<div>'+dl([
          ['Telefon','<span class="mono">'+d.phone+'</span>'],['Shahar', d.city],
          ['Avtomobil', d.car_make+' '+d.car_model],['Davlat raqami','<span class="mono">'+d.car_plate+'</span>'],
          ['Rang', d.car_color],['Tarif', U.tariff(d.tariff)],['Park raqami', U.park(d.park_number)]
        ])+'</div>'+
        '<div>'+dl([
          ['Reyting','★ '+d.rating],['Buyurtmalar', d.orders_count],
          ['Balans','<b class="mono">'+window.money(d.balance)+' so\'m</b>'],
          ['KYC', U.kycTag(d.kyc_status)],['Holat', U.driverTag(d.status)]
        ])+'</div></div>',
      foot:'<button class="btn" data-close>Yopish</button>'+
        (d.status==='blocked'
          ? '<button class="btn btn-success" data-unblock>Blokdan chiqarish</button>'
          : '<button class="btn btn-danger" data-block>Bloklash</button>'),
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        var bl=back.querySelector('[data-block]'), un=back.querySelector('[data-unblock]');
        if(bl) bl.addEventListener('click',function(){ blockReason(d, true, close, rerender); });
        if(un) un.addEventListener('click',function(){ d.status='free'; U.toast('Bajarildi', d.full_name+' blokdan chiqarildi'); window.apiAction('POST','/drivers/'+d.id+'/unblock').then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); }); close(); rerender&&rerender(); });
      }
    });
  };
  function blockReason(d, block, parentClose, rerender){
    U.modal({
      title:'Haydovchini bloklash', sub:d.full_name,
      body:'<div class="field full"><label>Bloklash sababi (majburiy)</label>'+
        '<textarea class="input" data-reason placeholder="Masalan: hujjat muddati tugagan, shikoyatlar..."></textarea>'+
        '<div class="hint" style="margin-top:6px">Amal audit jurnaliga yoziladi (BE-FR-012).</div></div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-danger" data-ok>Bloklash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var r=back.querySelector('[data-reason]').value.trim();
          if(!r){ U.toast('Xato','Sabab kiriting','error'); return; }
          d.status='blocked'; close(); parentClose&&parentClose(); U.toast('Bloklandi', d.full_name+' bloklandi');
          window.apiAction('POST','/drivers/'+d.id+'/block',{reason:r}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          rerender&&rerender();
        });
      }
    });
  }

  /* ---- MIJOZ DETALI ---- */
  window.clientDetail = function(c){
    U.modal({
      title:c.full_name, sub:'Mijoz · '+c.tier.toUpperCase()+' daraja',
      body:dl([
        ['Telefon','<span class="mono">'+c.phone+'</span>'],['Buyurtmalar', c.orders_count],
        ['Jami sarflagan','<b class="mono">'+window.money(c.total_spent)+' so\'m</b>'],
        ['Sadoqat balli','<span class="mono gold">'+c.points+' ball</span>'],
        ['Daraja', c.tier.toUpperCase()],['Ro\'yxatdan', c.registered_at],
        ['Holat', c.is_blocked?'<span class="tg canc">Bloklangan</span>':'<span class="tg done">Faol</span>']
      ]),
      foot:'<button class="btn" data-close>Yopish</button><button class="btn '+(c.is_blocked?'btn-success':'btn-danger')+'" data-toggle>'+(c.is_blocked?'Blokdan chiqarish':'Bloklash')+'</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-toggle]').addEventListener('click',function(){
          c.is_blocked=!c.is_blocked; U.toast('Bajarildi', c.full_name+' '+(c.is_blocked?'bloklandi':'blokdan chiqarildi')); close();
          window.apiAction('POST','/clients/'+c.id+'/block').then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          var pg=document.querySelector('#page>div'); if(pg&&pg._render)pg._render();
        });
      }
    });
  };

  /* ---- SHIKOYAT DETALI ---- */
  window.complaintDetail = function(c, rerender){
    U.modal({
      title:c.category, sub:c.id+' · '+c.order+' · '+c.city,
      body:dl([
        ['Manba', c.source==='driver'?'Haydovchi':'Mijoz'],['Kim', c.who],
        ['Buyurtma','<span class="mono">'+c.order+'</span>'],['Vaqt', c.created_at],
        ['Holat', U.genTag(c.status)]
      ])+'<div class="field full" style="margin-top:16px"><label>Tavsif</label>'+
        '<div class="card-body" style="background:var(--surface-2);border-radius:11px;padding:13px">'+U.esc(c.description)+'</div></div>'+
        '<div class="field full" style="margin-top:14px"><label>Javob / yechim</label>'+
        '<textarea class="input" data-resolution placeholder="Operatorning javobi yoki yechimi..."></textarea></div>',
      foot:'<button class="btn" data-close>Yopish</button>'+
        (c.status!=='resolved'?'<button class="btn" data-review>Ko\'rib chiqishga</button><button class="btn btn-primary" data-resolve>Hal qilindi</button>':''),
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        var rv=back.querySelector('[data-review]'), rs=back.querySelector('[data-resolve]');
        if(rv) rv.addEventListener('click',function(){
          var txt=(back.querySelector('[data-resolution]')||{}).value||'ko\'rib chiqilmoqda';
          c.status='in_review'; U.toast('Yangilandi','Shikoyat ko\'rib chiqilmoqda'); close();
          window.apiAction('POST','/complaints/'+c.id+'/respond',{resolution:txt}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          rerender&&rerender();
        });
        if(rs) rs.addEventListener('click',function(){
          c.status='resolved'; U.toast('Hal qilindi','Shikoyat yopildi'); close();
          window.apiAction('POST','/complaints/'+c.id+'/resolve').then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          rerender&&rerender(); window.refreshBadges&&window.refreshBadges();
        });
      }
    });
  };

  /* ---- YANGI BUYURTMA (to'liq manzilli) ---- */
  window.newOrderModal = function(){
    var cityOpts = window.DB.CITIES.map(function(c){return '<option>'+c+'</option>';}).join('');
    var tarOpts = window.DB.TARIFFS.map(function(t){return '<option>'+t+'</option>';}).join('');
    var allPlaces = window.DB.places.map(function(p){return p.name;}).filter(function(v,i,a){return a.indexOf(v)===i;});
    var dl = '<datalist id="placeList">'+allPlaces.map(function(n){return '<option value="'+n+'">';}).join('')+'</datalist>';
    U.modal({
      title:'Yangi buyurtma', sub:'Qo\'lda buyurtma · to\'liq manzil (operator / dispetcher)', wide:true,
      body:dl+'<div class="form-grid">'+
        '<div class="field full"><label>Mijoz telefoni</label><input class="input mono" data-r placeholder="+998 90 123 45 67"></div>'+
        '<div class="field"><label>Olish — shahar</label><select class="input" data-fc>'+cityOpts+'</select></div>'+
        '<div class="field"><label>Olish — mo\'ljal / manzil</label><input class="input" list="placeList" data-fp placeholder="Masalan: Elektroset, 15 bayroq..."></div>'+
        '<div class="field"><label>Tushirish — shahar</label><select class="input" data-tc>'+cityOpts+'</select></div>'+
        '<div class="field"><label>Tushirish — mo\'ljal / manzil</label><input class="input" list="placeList" data-tp placeholder="Masalan: Markaziy bozor..."></div>'+
        '<div class="field"><label>Tarif</label><select class="input" data-tar>'+tarOpts+'</select></div>'+
        '<div class="field"><label>To\'lov</label><select class="input" data-pay><option value="cash">Naqd</option><option value="payme">Payme</option><option value="click">Click</option><option value="balance">Balans</option></select></div>'+
      '</div>'+
      '<div class="hint" style="margin-top:10px">Yangi mo\'ljal kiritsangiz — u manzillar lug\'atiga avtomatik qo\'shiladi (to\'planib boradi).</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Yaratish va qidirish</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var ph=back.querySelector('[data-r]').value.trim();
          var fc=back.querySelector('[data-fc]').value, fp=back.querySelector('[data-fp]').value.trim()||'Markaz';
          var tc=back.querySelector('[data-tc]').value, tp=back.querySelector('[data-tp]').value.trim()||'Markaz';
          var tar=back.querySelector('[data-tar]').value, pay=back.querySelector('[data-pay]').value;
          if(!ph){ U.toast('Xato','Mijoz telefonini kiriting','error'); return; }
          // manzillarni lug'atga qo'shish (to'planadi)
          window.DB.addPlace(fc,fp); window.DB.addPlace(tc,tp);
          var inter = fc!==tc;
          var price = inter ? (35+Math.floor(Math.random()*70))*1000 : (12+Math.floor(Math.random()*26))*1000;
          var id = '#'+(10621+Math.floor(Math.random()*900));
          window.DB.orders.unshift({
            id:id, client:'Qo\'lda kiritilgan', client_id:'-', client_ini:'QK', client_phone:ph,
            driver:null, driver_id:null, park:null,
            from_city:fc, from_place:fp, to_city:tc, to_place:tp,
            from:fc+' · '+fp, to:tc+' · '+tp, route_type: inter?'inter':'intra',
            tariff:tar, distance: inter?(20+Math.random()*60).toFixed(1):(1.5+Math.random()*8).toFixed(1),
            duration: inter?40:12, price:price, commission:Math.round(price*0.15),
            payment:pay, payment_status:'pending', status:'searching', created_at:'hozir', cancel_reason:null, _new:true
          });
          if(window.Bus) window.Bus.emit('order:new', window.DB.orders[0]);
          close(); U.toast('Buyurtma yaratildi', id+' · '+fc+' · '+fp+' → '+tc+' · '+tp+' · haydovchi qidirilmoqda');
          window.rerenderPage && window.rerenderPage();
        });
      }
    });
  };

  /* ---- HAYDOVCHIGA TAYINLASH ---- */
  window.assignDriver = function(o){
    var free=window.DB.drivers.filter(function(d){return d.status==='free';}).slice(0,8);
    var rows=free.map(function(d){
      return '<tr class="clickable" data-pick="'+d.id+'"><td>'+U.cust(d.full_name,d.ini)+'</td><td>'+U.park(d.park_number)+'</td>'+
        '<td>'+U.tariff(d.tariff)+'</td><td><span class="mono">★ '+d.rating+'</span></td>'+
        '<td class="right"><button class="btn btn-primary btn-sm" data-pick="'+d.id+'">Tanlash</button></td></tr>';
    }).join('');
    U.modal({
      title:'Haydovchiga tayinlash', sub:(o?o.id+' · '+o.from+' → '+o.to:'')+' · bo\'sh haydovchilar',
      wide:true,
      body:'<div class="table-wrap"><table><thead><tr><th>Haydovchi</th><th>Park</th><th>Tarif</th><th>Reyting</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>',
      foot:'<button class="btn" data-close>Yopish</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelectorAll('[data-pick]').forEach(function(b){b.addEventListener('click',function(){
          var d=window.DB.drivers.find(function(x){return x.id===b.getAttribute('data-pick');});
          if(o){ o.driver=d.full_name; o.driver_id=d.id; o.park=d.park_number; o.status='assigned'; d.status='busy'; }
          close(); U.toast('Tayinlandi', (o?o.id:'Buyurtma')+' → '+d.full_name);
          if(o) window.apiAction('POST','/orders/'+encodeURIComponent(o.id)+'/assign',{driver_id:d.id}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          var pg=document.querySelector('#page>div'); if(pg&&pg._render)pg._render();
        });});
      }
    });
  };

  /* ---- PUL YECHISH: 2-bosqichli tasdiqlash ---- */
  window.confirmWithdrawal = function(id){
    var w=window.DB.withdrawals.find(function(x){return x.id===id;});
    if(!w) return;
    U.modal({
      title:'Pul yechishni tasdiqlash', sub:'1-bosqich · '+w.driver,
      body:dl([
        ['Haydovchi', w.driver],['Telefon','<span class="mono">'+w.driver_phone+'</span>'],['Park', U.park(w.park)],
        ['Summa','<b class="mono" style="color:var(--gold)">'+window.money(w.amount)+' so\'m</b>'],
        ['Provayder', U.tariff(w.provider)]
      ])+'<div class="hint" style="margin-top:14px">Bu summa haydovchi balansidan yechiladi va '+w.provider+' orqali o\'tkaziladi. Davom etish uchun pastdagi tasdiqni bosing.</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-step1>Davom etish →</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-step1]').addEventListener('click',function(){ close(); confirmStep2(w); });
      }
    });
  };
  function confirmStep2(w){
    U.modal({
      title:'Yakuniy tasdiq (2-bosqich)', sub:'Tasdiq kodini kiriting',
      body:'<div class="field full"><label>Summa</label><input class="input mono" value="'+window.money(w.amount)+' so\'m" readonly></div>'+
        '<div class="field full" style="margin-top:12px"><label>Tasdiq kodi (2FA)</label><input class="input mono" data-code placeholder="6 xonali kod" maxlength="6"></div>'+
        '<div class="hint" style="margin-top:8px">Demo: istalgan 6 raqam. Real tizimda super_admin / finance_admin 2FA talab qilinadi (AUTH-04).</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-success" data-ok>'+window.icon('check',16)+' Tasdiqlash va to\'lash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var c=back.querySelector('[data-code]').value.trim();
          if(c.length<4){ U.toast('Xato','Tasdiq kodini kiriting','error'); return; }
          w.status='paid'; close(); U.toast('To\'landi', w.driver+' · '+window.money(w.amount)+' so\'m '+w.provider);
          window.apiAction('POST','/finance/withdrawals/'+w.id+'/approve',{confirm:true,code:c}).then(function(r){ if(!r.ok&&!r.demo) U.toast('Backend xatosi', r.message,'error'); });
          var pg=document.querySelector('#page>div'); if(pg&&pg._render)pg._render();
        });
      }
    });
  }
  window.rejectWithdrawal = function(id){
    var w=window.DB.withdrawals.find(function(x){return x.id===id;});
    if(!w) return;
    U.modal({
      title:'Pul yechishni rad etish', sub:w.driver,
      body:'<div class="field full"><label>Rad etish sababi</label><textarea class="input" data-reason placeholder="Sabab..."></textarea></div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-danger" data-ok>Rad etish</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var reason=back.querySelector('[data-reason]').value.trim();
          if(!reason){ U.toast('Xato','Sabab kiriting','error'); return; }
          w.status='rejected'; close(); U.toast('Rad etildi', w.driver+' so\'rovi rad etildi','error');
          window.apiAction('POST','/finance/withdrawals/'+w.id+'/reject',{reason:reason}).then(function(r){ if(!r.ok&&!r.demo) U.toast('Backend xatosi', r.message,'error'); });
          var pg=document.querySelector('#page>div'); if(pg&&pg._render)pg._render();
        });
      }
    });
  };

  /* ---- TARIF TAHRIRLASH ---- */
  window.tariffModal = function(id, rerender){
    var t = id ? window.DB.tariffs.find(function(x){return x.id===id;}) : {name:'',base:0,per_km:0,per_min:0,min_fare:0,surge:1.0,commission:15,active:true};
    U.modal({
      title:id?'Tarifni tahrirlash':'Yangi tarif', sub:id?t.name:'',
      body:'<div class="form-grid">'+
        numField('Nomi','name',t.name,true)+numField('Komissiya (%)','commission',t.commission)+
        numField('Bazaviy narx','base',t.base)+numField('Min. narx','min_fare',t.min_fare)+
        numField('Har km','per_km',t.per_km)+numField('Har daqiqa','per_min',t.per_min)+
        numField('Surge koeff.','surge',t.surge)+
        '</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Saqlash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          ['name','commission','base','min_fare','per_km','per_min','surge'].forEach(function(k){
            var v=back.querySelector('[data-k="'+k+'"]').value;
            t[k] = (k==='name')?v:parseFloat(v)||0;
          });
          if(!id){ t.id='TF'+(window.DB.tariffs.length+1); t.active=true; window.DB.tariffs.push(t); }
          else window.apiAction('PATCH','/tariffs/'+t.id,{base_fare:t.base,per_km:t.per_km,per_min:t.per_min,min_fare:t.min_fare,surge_multiplier:t.surge,commission_percent:t.commission}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          close(); U.toast('Saqlandi','Tarif yangilandi'); rerender&&rerender();
        });
      }
    });
  };
  function numField(label,k,v,text){
    return '<div class="field"><label>'+label+'</label><input class="input'+(text?'':' mono')+'" data-k="'+k+'" value="'+v+'"'+(text?'':' type="number"')+'></div>';
  }

  /* ---- SOVG'A TAHRIRLASH ---- */
  window.rewardModal = function(id, rerender){
    var r = id?window.DB.rewards.find(function(x){return x.id===id;}):{title:'',desc:'',cost:100,type:'discount',stock:100,active:true,icon:'gift'};
    U.modal({
      title:id?'Sovg\'ani tahrirlash':'Yangi sovg\'a',
      body:'<div class="form-grid">'+
        '<div class="field full"><label>Sarlavha</label><input class="input" data-k="title" value="'+r.title+'"></div>'+
        '<div class="field full"><label>Tavsif</label><textarea class="input" data-k="desc">'+r.desc+'</textarea></div>'+
        '<div class="field"><label>Narx (ball)</label><input class="input mono" type="number" data-k="cost" value="'+r.cost+'"></div>'+
        '<div class="field"><label>Zaxira</label><input class="input mono" type="number" data-k="stock" value="'+r.stock+'"></div>'+
        '<div class="field"><label>Tur</label><select class="input" data-k="type">'+
          ['discount|Chegirma','gift|Sovg\'a','free_ride|Bepul safar'].map(function(o){var p=o.split('|');return '<option value="'+p[0]+'"'+(r.type===p[0]?' selected':'')+'>'+p[1]+'</option>';}).join('')+'</select></div>'+
        '<div class="field"><label>Ikona</label><select class="input" data-k="icon">'+
          ['gift','ticket','tag','star','car'].map(function(i){return '<option'+(r.icon===i?' selected':'')+'>'+i+'</option>';}).join('')+'</select></div>'+
        '</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Saqlash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          ['title','desc','cost','type','icon','stock'].forEach(function(k){
            var v=back.querySelector('[data-k="'+k+'"]').value; r[k]=(k==='cost'||k==='stock')?parseInt(v,10)||0:v;
          });
          if(!id){ r.id='RW'+(window.DB.rewards.length+1); r.active=true; window.DB.rewards.push(r); }
          close(); U.toast('Saqlandi','Sovg\'a katalogiga yozildi'); rerender&&rerender();
        });
      }
    });
  };

  /* ---- PROMO-KOD TAHRIRLASH ---- */
  window.promoModal = function(id, rerender){
    var p = id?window.DB.promos.find(function(x){return x.id===id;}):{code:'',type:'percent',value:10,min_order:0,limit:100,used:0,valid_to:'2026-12-31',active:true};
    U.modal({
      title:id?'Promo-kodni tahrirlash':'Yangi promo-kod',
      body:'<div class="form-grid">'+
        '<div class="field full"><label>Kod</label><input class="input mono" data-k="code" value="'+p.code+'" placeholder="YANGI2026"></div>'+
        '<div class="field"><label>Tur</label><select class="input" data-k="type">'+
          ['percent|Foiz','fixed|Qat\'iy summa','points|Ball'].map(function(o){var s=o.split('|');return '<option value="'+s[0]+'"'+(p.type===s[0]?' selected':'')+'>'+s[1]+'</option>';}).join('')+'</select></div>'+
        '<div class="field"><label>Qiymat</label><input class="input mono" type="number" data-k="value" value="'+p.value+'"></div>'+
        '<div class="field"><label>Min. buyurtma</label><input class="input mono" type="number" data-k="min_order" value="'+p.min_order+'"></div>'+
        '<div class="field"><label>Limit</label><input class="input mono" type="number" data-k="limit" value="'+p.limit+'"></div>'+
        '<div class="field full"><label>Amal muddati</label><input class="input mono" data-k="valid_to" value="'+p.valid_to+'"></div>'+
        '</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Saqlash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          ['code','type','value','min_order','limit','valid_to'].forEach(function(k){
            var v=back.querySelector('[data-k="'+k+'"]').value;
            p[k]=(k==='value'||k==='min_order'||k==='limit')?parseInt(v,10)||0:v;
          });
          if(!p.code){ U.toast('Xato','Kod kiriting','error'); return; }
          if(!id){ p.id='PR'+(window.DB.promos.length+1); p.active=true; p.used=0; window.DB.promos.push(p); }
          close(); U.toast('Saqlandi','Promo-kod yangilandi'); rerender&&rerender();
        });
      }
    });
  };

  /* ---- MO'LJAL QO'SHISH ---- */
  window.addPlaceModal = function(){
    var cityOpts = window.DB.CITIES.map(function(c){return '<option>'+c+'</option>';}).join('');
    U.modal({
      title:'Yangi mo\'ljal qo\'shish', sub:'Manzil lug\'atiga qo\'shiladi',
      body:'<div class="form-grid">'+
        '<div class="field"><label>Shahar</label><select class="input" data-c>'+cityOpts+'</select></div>'+
        '<div class="field"><label>Mo\'ljal / manzil nomi</label><input class="input" data-n placeholder="Masalan: Elektroset"></div>'+
        '</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Qo\'shish</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var c=back.querySelector('[data-c]').value, n=back.querySelector('[data-n]').value.trim();
          if(!n){ U.toast('Xato','Mo\'ljal nomini kiriting','error'); return; }
          window.DB.addPlace(c,n); close(); U.toast('Qo\'shildi', c+' · '+n+' lug\'atga qo\'shildi');
          window.apiAction('POST','/places',{city:c,name:n}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          window.rerenderPage && window.rerenderPage();
        });
      }
    });
  };

  /* ---- BALL BOSHQARISH (loyalty.adjust) ---- */
  window.adjustPoints = function(clientId){
    var c = clientId?window.DB.clients.find(function(x){return x.id===clientId;}):null;
    U.modal({
      title:'Qo\'lda ball boshqarish', sub:c?c.full_name+' · joriy '+c.points+' ball':'loyalty.adjust',
      body:'<div class="form-grid">'+
        (c?'':'<div class="field full"><label>Mijoz telefoni</label><input class="input mono" placeholder="+998 ..."></div>')+
        '<div class="field"><label>Amal</label><select class="input" data-act><option value="earn">Qo\'shish (+)</option><option value="redeem">Yechish (−)</option></select></div>'+
        '<div class="field"><label>Ball miqdori</label><input class="input mono" type="number" data-pts value="100"></div>'+
        '<div class="field full"><label>Sabab</label><input class="input" data-reason placeholder="Masalan: kompensatsiya, aksiya..."></div>'+
        '</div><div class="hint" style="margin-top:8px">Ball berish idempotent va point_transactions ga yoziladi (BE-FR-052, BE-FR-056).</div>',
      foot:'<button class="btn" data-close>Bekor</button><button class="btn btn-primary" data-ok>Qo\'llash</button>',
      onMount:function(back,close){
        back.querySelector('[data-close]').addEventListener('click',close);
        back.querySelector('[data-ok]').addEventListener('click',function(){
          var pts=parseInt(back.querySelector('[data-pts]').value,10)||0;
          var act=back.querySelector('[data-act]').value;
          var reason=back.querySelector('[data-reason]').value.trim();
          if(!reason){ U.toast('Xato','Sabab kiriting','error'); return; }
          if(c){ c.points += act==='earn'?pts:-pts; if(c.points<0)c.points=0; }
          close(); U.toast('Bajarildi',(act==='earn'?'+':'−')+pts+' ball qo\'llandi');
          if(c) window.apiAction('POST','/loyalty/adjust',{client_id:c.id,type:act,points:pts,reason:reason}).then(function(x){ if(!x.ok&&!x.demo) U.toast('Backend xatosi', x.message,'error'); });
          var pg=document.querySelector('#page>div'); if(pg&&pg._render)pg._render();
        });
      }
    });
  };
})();
