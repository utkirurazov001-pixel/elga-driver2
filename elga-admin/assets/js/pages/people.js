/* ====================================================================
   ELGA Admin — Foydalanuvchilar bo'limi
   ==================================================================== */
(function(){
  var U = window.UI;

  /* ---------------- HAYDOVCHILAR (sub: list / kyc / fleet) ---------------- */
  window.PAGES.car = function(ctx){
    var sub = ctx.sub || 'list';
    if(sub==='kyc') return driversKyc(ctx);
    if(sub==='fleet') return driversFleet(ctx);
    return driversList(ctx);
  };

  function driversList(ctx){
    return window.listPage({
      title:'Haydovchilar', sub:'Ro\'yxat · '+window.DB.drivers.length+' ta haydovchi',
      actions:'<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Yangi haydovchi</button>',
      placeholder:'Ism, telefon yoki davlat raqami...',
      perPage:10,
      filters:function(st){return [
        {key:'status', value:st.status||'', options:[window.opt('','Barcha holatlar'),
          window.opt('free','Bo\'sh'),window.opt('busy','Buyurtmada'),window.opt('offline','Oflayn'),window.opt('blocked','Bloklangan')]},
        {key:'city', value:st.city||'', options:window.cityOptions()},
        {key:'kyc', value:st.kyc||'', options:[window.opt('','Barcha KYC'),
          window.opt('approved','Tasdiqlangan'),window.opt('pending','Kutilmoqda'),window.opt('rejected','Rad etilgan')]}
      ];},
      getData:function(st){
        var rows = window.DB.drivers.filter(function(d){
          return U.matches(d,st.q,['full_name','phone','car_plate','car_model']) &&
            (!st.status||d.status===st.status)&&(!st.city||d.city===st.city)&&(!st.kyc||d.kyc_status===st.kyc);
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'Haydovchi', render:function(d){return U.cust(d.full_name,d.ini,d.phone);}},
        {th:'Avtomobil', render:function(d){return d.car_make+' '+d.car_model+'<br><span class="muted mono" style="font-size:11px">'+d.car_plate+'</span>';}},
        {th:'Park', render:function(d){return U.park(d.park_number);}},
        {th:'Tarif', render:function(d){return U.tariff(d.tariff);}},
        {th:'Reyting', render:function(d){return '<span class="mono">★ '+d.rating+'</span>';}},
        {th:'Balans', cls:'sum', render:function(d){return window.money(d.balance);}},
        {th:'KYC', render:function(d){return U.kycTag(d.kyc_status);}},
        {th:'Holat', render:function(d){return U.driverTag(d.status);}}
      ],
      onRowClick:function(d, rerender){ window.driverDetail(d, rerender); }
    });
  }

  function driversKyc(ctx){
    return window.listPage({
      title:'KYC tasdiqlash', sub:'Haydovchi hujjatlarini tekshirish va tasdiqlash',
      placeholder:'Haydovchi qidirish...',
      perPage:10,
      filters:function(st){return [
        {key:'kyc', value:st.kyc||'pending', options:[window.opt('','Barcha'),
          window.opt('pending','Kutilmoqda'),window.opt('approved','Tasdiqlangan'),window.opt('rejected','Rad etilgan')]}
      ];},
      getData:function(st){
        var rows = window.DB.drivers.filter(function(d){
          return U.matches(d,st.q,['full_name','phone']) && (!st.kyc||d.kyc_status===st.kyc);
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'Haydovchi', render:function(d){return U.cust(d.full_name,d.ini,d.phone);}},
        {th:'Shahar', render:function(d){return d.city;}},
        {th:'Hujjatlar', render:function(d){return '<span class="tariff-chip">Guvohnoma</span> <span class="tariff-chip">Pasport</span> <span class="tariff-chip">Tex. pasport</span>';}},
        {th:'KYC holati', render:function(d){return U.kycTag(d.kyc_status);}},
        {th:'', cls:'right', render:function(d){
          if(d.kyc_status==='approved') return '<span class="muted">—</span>';
          return '<div class="row-actions"><button class="btn btn-success btn-sm" data-kyc-ok="'+d.id+'">Tasdiqlash</button>'+
            '<button class="btn btn-danger btn-sm" data-kyc-no="'+d.id+'">Rad etish</button></div>';
        }}
      ],
      onRowClick:function(d, rerender){ window.driverDetail(d, rerender); }
    });
  }

  function driversFleet(ctx){
    return window.listPage({
      title:'Avtopark', sub:'Park raqamlari · tom belgisi «ELGA TAXI 1226 + park raqami»',
      placeholder:'Park raqami yoki davlat raqami...',
      perPage:12,
      getData:function(st){
        var rows = window.DB.drivers.filter(function(d){
          return U.matches(d,st.q,['park_number','car_plate','full_name','car_model']);
        }).sort(function(a,b){return a.park_number-b.park_number;});
        return {rows:U.paginate(rows,st.page,12), total:rows.length};
      },
      columns:[
        {th:'Park №', render:function(d){return U.park(d.park_number);}},
        {th:'Tom belgisi', render:function(d){return '<span class="mono muted">ELGA TAXI 1226 · '+d.park_number+'</span>';}},
        {th:'Haydovchi', render:function(d){return U.cust(d.full_name,d.ini);}},
        {th:'Avtomobil', render:function(d){return d.car_make+' '+d.car_model;}},
        {th:'Rang', render:function(d){return d.car_color;}},
        {th:'Davlat raqami', render:function(d){return '<span class="mono">'+d.car_plate+'</span>';}},
        {th:'Holat', render:function(d){return U.driverTag(d.status);}}
      ]
    });
  }

  /* ---------------- MIJOZLAR ---------------- */
  window.PAGES.users = function(ctx){
    return window.listPage({
      title:'Mijozlar', sub:'Ro\'yxat · '+window.DB.clients.length+' ta mijoz',
      placeholder:'Ism yoki telefon...',
      perPage:10,
      filters:function(st){return [
        {key:'tier', value:st.tier||'', options:[window.opt('','Barcha darajalar'),
          window.opt('gold','Gold'),window.opt('silver','Silver'),window.opt('bronze','Bronze')]},
        {key:'blocked', value:st.blocked||'', options:[window.opt('','Hammasi'),window.opt('no','Faol'),window.opt('yes','Bloklangan')]}
      ];},
      getData:function(st){
        var rows = window.DB.clients.filter(function(c){
          return U.matches(c,st.q,['full_name','phone']) && (!st.tier||c.tier===st.tier) &&
            (!st.blocked || (st.blocked==='yes'?c.is_blocked:!c.is_blocked));
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'Mijoz', render:function(c){return U.cust(c.full_name,c.ini,c.phone,true);}},
        {th:'Buyurtmalar', render:function(c){return c.orders_count;}},
        {th:'Sarflagan', cls:'sum', render:function(c){return window.money(c.total_spent);}},
        {th:'Daraja', render:function(c){return '<span class="tier-badge '+c.tier+'" style="display:inline-grid;width:28px;height:22px;font-size:9px;border-radius:6px">'+c.tier.slice(0,3).toUpperCase()+'</span>';}},
        {th:'Ball', render:function(c){return '<span class="mono gold">'+c.points+'</span>';}},
        {th:'Ro\'yxatdan', render:function(c){return '<span class="muted">'+c.registered_at+'</span>';}},
        {th:'Holat', render:function(c){return c.is_blocked?U.genTag('rejected').replace('Rad etilgan','Bloklangan'):U.genTag('true');}},
        {th:'', cls:'right', render:function(c){return '<button class="btn btn-sm '+(c.is_blocked?'btn-success':'btn-danger')+'" data-block="'+c.id+'">'+(c.is_blocked?'Blokdan chiqarish':'Bloklash')+'</button>';}}
      ],
      onRowClick:function(c){ window.clientDetail(c); }
    });
  };

  /* ---------------- SHIKOYATLAR ---------------- */
  window.PAGES.warn = function(ctx){
    return window.listPage({
      title:'Shikoyatlar', sub:window.DB.complaints.filter(function(c){return c.status==='new';}).length+' ta yangi · moderatorga tayinlash',
      placeholder:'Kategoriya, buyurtma yoki mijoz...',
      perPage:10,
      filters:function(st){return [
        {key:'status', value:st.status||'', options:[window.opt('','Barcha holatlar'),
          window.opt('new','Yangi'),window.opt('in_review','Ko\'rib chiqilmoqda'),window.opt('resolved','Hal qilingan')]},
        {key:'source', value:st.source||'', options:[window.opt('','Hammasi'),window.opt('client','Mijozdan'),window.opt('driver','Haydovchidan')]}
      ];},
      getData:function(st){
        var rows = window.DB.complaints.filter(function(c){
          return U.matches(c,st.q,['category','order','who','city']) &&
            (!st.status||c.status===st.status)&&(!st.source||c.source===st.source);
        });
        return {rows:U.paginate(rows,st.page,10), total:rows.length};
      },
      columns:[
        {th:'ID', render:function(c){return '<span class="mono">'+c.id+'</span>';}},
        {th:'Kategoriya', render:function(c){return '<b>'+c.category+'</b>';}},
        {th:'Buyurtma', render:function(c){return '<span class="mono muted">'+c.order+'</span>';}},
        {th:'Manba', render:function(c){return U.tariff(c.source==='driver'?'Haydovchi':'Mijoz');}},
        {th:'Kim', render:function(c){return c.who;}},
        {th:'Shahar', render:function(c){return c.city;}},
        {th:'Vaqt', render:function(c){return '<span class="muted">'+c.created_at+'</span>';}},
        {th:'Holat', render:function(c){return U.genTag(c.status);}}
      ],
      onRowClick:function(c, rerender){ window.complaintDetail(c, rerender); }
    });
  };

  /* ---------------- XODIMLAR (admin_users / RBAC) ---------------- */
  window.PAGES.badge = function(ctx){
    return window.listPage({
      title:'Xodimlar', sub:'Panel foydalanuvchilari · 5 rol (RBAC)',
      actions:'<button class="btn btn-primary" data-x="new">'+window.icon('plus',16)+'Xodim qo\'shish</button>',
      placeholder:'Ism yoki login...',
      perPage:10,
      filters:function(st){return [
        {key:'role', value:st.role||'', options:[window.opt('','Barcha rollar')].concat(window.DB.ROLES.map(function(r){return window.opt(r,window.roleLabel(r));}))}
      ];},
      getData:function(st){
        var rows = window.DB.staff.filter(function(s){
          return U.matches(s,st.q,['full_name','login']) && (!st.role||s.role===st.role);
        });
        return {rows:rows, total:null};
      },
      columns:[
        {th:'Xodim', render:function(s){return U.cust(s.full_name,s.ini,'@'+s.login);}},
        {th:'Telefon', render:function(s){return '<span class="mono">'+s.phone+'</span>';}},
        {th:'Rol', render:function(s){return roleChip(s.role);}},
        {th:'Oxirgi kirish', render:function(s){return '<span class="muted">'+s.last_login+'</span>';}},
        {th:'Holat', render:function(s){return s.is_active?U.genTag('true'):U.genTag('false');}},
        {th:'', cls:'right', render:function(s){return '<div class="row-actions"><button class="btn btn-icon btn-sm" title="Tahrir">'+window.icon('edit',15)+'</button></div>';}}
      ]
    });
  };
  function roleChip(r){
    var c = {super_admin:'gold',operator:'prog',finance_admin:'wait',dispatcher:'done',moderator:'neutral'}[r]||'neutral';
    return '<span class="tg '+c+'">'+window.roleLabel(r)+'</span>';
  }
})();
