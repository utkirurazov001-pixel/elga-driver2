/* ====================================================================
   ELGA TAXI 1226 — Admin panel · ilova qobig'i (shell + router)
   ==================================================================== */
(function(){
  // Navigatsiya tuzilishi: [route, label, ikona, badge, [sub:[subkey,label]]]
  var NAV = [
    ['Asosiy', [
      ['grid','Boshqaruv','grid',null],
      ['radio','Dispetcher','radio',{t:'gold',n:7}],
      ['bag','Buyurtmalar','bag',null],
      ['map','Jonli xarita','map',null]
    ]],
    ['Foydalanuvchilar', [
      ['car','Haydovchilar','car',null,[['list','Ro\'yxat'],['kyc','KYC tasdiqlash'],['fleet','Avtopark (park raqami)']]],
      ['users','Mijozlar','users',null],
      ['warn','Shikoyatlar','warn',{t:'',n:13}],
      ['badge','Xodimlar','badge',null]
    ]],
    ['Moliya', [
      ['finance','Moliya hisoboti','finance',null],
      ['cash','Pul yechish','cash',{t:'gold',n:5}],
      ['wallet','Tranzaksiyalar','wallet',null],
      ['tag','Tariflar','tag',null]
    ]],
    ['Sadoqat dasturi', [
      ['star','Ball hisoblari','star',null],
      ['gift','Sovg\'alar katalogi','gift',null],
      ['repeat','Almashtirishlar','repeat',null],
      ['ticket','Promo-kodlar','ticket',null]
    ]],
    ['Tizim', [
      ['pin','Shaharlar / Zonalar','pin',null],
      ['bell','Bildirishnomalar','bell',null],
      ['audit','Audit jurnali','audit',null],
      ['cog','Sozlamalar','cog',null,[['general','Umumiy'],['roles','Rollar va ruxsatlar'],['payments','To\'lov (Payme / Click)'],['brand','Brend']]]
    ]]
  ];
  // route -> {label, group}
  var META = {};
  NAV.forEach(function(g){ g[1].forEach(function(it){ META[it[0]]={label:it[1], group:g[0], sub:it[4]}; }); });

  var current = {route:'grid', sub:null};
  var ME = window.DB.staff[0]; // Utkir Urazov, super_admin

  /* ---------------- LOGIN ---------------- */
  function renderLogin(){
    var app=document.getElementById('app');
    app.className='';
    app.innerHTML =
      '<div class="login"><div class="login-card">'+
        '<div class="login-anchor"><b>1226</b><span>DISPETCHER</span></div>'+
        '<div class="login-brand">'+
          '<div class="checker"></div>'+
          '<div class="lockup"><span class="el">EL</span><span class="ga">GA</span><span class="taxi">TAXI</span></div>'+
          '<div class="login-slogan">HAR DOIM YONINGIZDA!</div>'+
          '<div class="login-pillars"><span>TEZ</span><span>XAVFSIZ</span><span>ISHONCHLI</span></div>'+
        '</div>'+
        '<form id="loginForm">'+
          '<div class="field"><label>Login</label><input class="input" id="lg" value="admin" autocomplete="username"></div>'+
          '<div class="field"><label>Parol</label><input class="input" id="pw" type="password" value="elga1226" autocomplete="current-password"></div>'+
          '<button class="btn btn-primary" type="submit">'+window.icon('lock',16)+' Tizimga kirish</button>'+
        '</form>'+
        '<div class="login-demo">Demo kirish: <b>admin</b> / <b>elga1226</b><br>app.elga.uz · super_admin roli</div>'+
      '</div></div>';
    document.getElementById('loginForm').addEventListener('submit',function(e){
      e.preventDefault();
      var u=document.getElementById('lg').value.trim();
      if(!u){ window.UI.toast('Xato','Login kiriting','error'); return; }
      sessionStorage.setItem('elga_admin_in','1');
      renderShell();
      navigate('grid');
      window.UI.toast('Xush kelibsiz!', ME.full_name+' · '+window.roleLabel(ME.role));
    });
  }

  /* ---------------- SHELL ---------------- */
  function renderShell(){
    var app=document.getElementById('app');
    app.className='app';
    app.innerHTML = sidebarHTML()+
      '<div class="main">'+
        '<header class="topbar">'+
          '<div class="hamb" id="hamb">'+window.icon('grid',18)+'</div>'+
          '<div class="crumb" id="crumb">Asosiy / <b>Boshqaruv</b></div>'+
          '<div class="top-search">'+window.icon('search',17)+'<input placeholder="Buyurtma, haydovchi yoki mijoz qidirish..."></div>'+
          '<div class="top-actions">'+
            '<div class="pill">'+window.icon('pin',15)+'Barcha shaharlar'+window.icon('down',13)+'</div>'+
            '<div class="icon-btn" id="bellBtn" title="Bildirishnomalar">'+window.icon('bell',19)+'<span class="dot"></span></div>'+
            '<div class="profile" id="profileBtn"><div class="av">'+ME.ini+'</div>'+
              '<div><div class="nm">'+ME.full_name+'</div><div class="rl">'+window.roleLabel(ME.role)+'</div></div>'+
              window.icon('down',16)+'</div>'+
          '</div>'+
        '</header>'+
        '<main class="content" id="page"></main>'+
      '</div>';

    buildNav(app);
    // topbar hodisalar
    app.querySelector('#hamb').addEventListener('click',function(){
      app.querySelector('.sidebar').classList.toggle('open');
      if(app.querySelector('.sidebar').classList.contains('open')){
        var bd=document.createElement('div'); bd.className='sb-backdrop';
        bd.addEventListener('click',function(){app.querySelector('.sidebar').classList.remove('open'); bd.remove();});
        app.appendChild(bd);
      }
    });
    app.querySelector('#bellBtn').addEventListener('click',function(){ navigate('bell'); });
    app.querySelector('#profileBtn').addEventListener('click',function(){ navigate('cog','general'); });
    app.querySelector('#logout').addEventListener('click',function(){
      sessionStorage.removeItem('elga_admin_in'); renderLogin();
    });
  }

  function sidebarHTML(){
    var groups = NAV.map(function(g){
      var items = g[1].map(function(it){
        var key=it[0], label=it[1], ic=it[2], badge=it[3], sub=it[4];
        var badgeHTML = badge ? '<span class="badge'+(badge.t==='gold'?' gold':'')+'">'+badge.n+'</span>' : '';
        var chev = sub ? '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="15" height="15" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>' : '';
        var subHTML = sub ? '<div class="nav-sub">'+sub.map(function(s){return '<a data-route="'+key+'" data-sub="'+s[0]+'">'+s[1]+'</a>';}).join('')+'</div>' : '';
        return '<div class="nav-item'+(sub?' has-sub':'')+'" data-route="'+key+'" data-ic="'+ic+'"><span></span>'+label+badgeHTML+chev+'</div>'+subHTML;
      }).join('');
      return '<div class="nav-group"><div class="nav-label">'+g[0]+'</div>'+items+'</div>';
    }).join('');

    return '<aside class="sidebar">'+
      '<div class="brand"><div class="lockup-row"><div class="checker"></div>'+
        '<div class="lockup"><span class="el">EL</span><span class="ga">GA</span><span class="taxi">TAXI</span></div>'+
        '<div class="dispatch"><b>1226</b><span>DISPETCHER</span></div></div>'+
        '<div class="slogan">Har doim yoningizda!</div></div>'+
      '<div class="sb-search"><div>'+window.icon('search',16)+'<input placeholder="Bo\'limni qidirish..."><kbd>⌘K</kbd></div></div>'+
      '<nav class="nav" id="nav">'+groups+'</nav>'+
      '<div class="sb-foot"><div class="av">'+ME.ini+'</div>'+
        '<div><div class="nm">'+ME.full_name+'</div><div class="rl">'+ME.role+'</div></div>'+
        '<button id="logout" title="Chiqish">'+window.icon('logout',16)+'</button></div>'+
      '</aside>';
  }

  function buildNav(app){
    // ikonalarni joylash
    app.querySelectorAll('.nav-item[data-ic]').forEach(function(el){
      var k=el.getAttribute('data-ic'); var span=el.querySelector('span');
      if(window.ICONS[k]) span.outerHTML=window.icon(k,18);
    });
    // bosish
    app.querySelectorAll('.nav-item[data-route]').forEach(function(el){
      el.addEventListener('click',function(e){
        if(el.classList.contains('has-sub')){
          el.classList.toggle('open');
          var ns=el.nextElementSibling;
          if(ns&&ns.classList.contains('nav-sub')) ns.classList.toggle('show');
          return;
        }
        navigate(el.getAttribute('data-route'));
        app.querySelector('.sidebar').classList.remove('open');
        var bd=app.querySelector('.sb-backdrop'); if(bd) bd.remove();
      });
    });
    app.querySelectorAll('.nav-sub a[data-route]').forEach(function(a){
      a.addEventListener('click',function(){
        navigate(a.getAttribute('data-route'), a.getAttribute('data-sub'));
        app.querySelector('.sidebar').classList.remove('open');
        var bd=app.querySelector('.sb-backdrop'); if(bd) bd.remove();
      });
    });
  }

  /* ---------------- NAVIGATE ---------------- */
  function navigate(route, sub){
    current.route=route; current.sub=sub||null;
    var app=document.getElementById('app');
    // aktiv holat
    app.querySelectorAll('.nav-item').forEach(function(a){a.classList.remove('active');});
    app.querySelectorAll('.nav-sub a').forEach(function(a){a.classList.remove('active');});
    var item=app.querySelector('.nav-item[data-route="'+route+'"]:not(.has-sub)') || app.querySelector('.nav-item[data-route="'+route+'"]');
    if(item) item.classList.add('active');
    if(sub){
      var sa=app.querySelector('.nav-sub a[data-route="'+route+'"][data-sub="'+sub+'"]');
      if(sa){ sa.classList.add('active'); var grp=sa.closest('.nav-sub'); if(grp){grp.classList.add('show'); grp.previousElementSibling.classList.add('open');} }
    }
    // breadcrumb
    var m=META[route]||{label:route,group:''};
    app.querySelector('#crumb').innerHTML = m.group+' / <b>'+m.label+'</b>';
    // sahifa
    var page=document.getElementById('page');
    page.innerHTML='';
    var fn = window.PAGES[route];
    var node = fn ? fn({route:route, sub:sub, navigate:navigate}) : placeholder(m.label);
    page.appendChild(node);
    page.scrollTop=0; window.scrollTo(0,0);
  }
  window.adminNavigate = navigate;

  function placeholder(label){
    var d=document.createElement('div');
    d.innerHTML=window.pageHead({title:label,sub:'Bu bo\'lim tayyorlanmoqda'})+
      '<div class="card"><div class="empty">'+window.icon('layers',40)+'<b>'+label+'</b>Tez orada qo\'shiladi</div></div>';
    return d;
  }

  // joriy sahifani qayta render qilish (amal tugmalaridan keyin)
  window.rerenderPage = function(){
    var pg=document.querySelector('#page>div');
    if(pg&&pg._render) pg._render();
    else navigate(current.route, current.sub);
  };
  window.refreshBadges = function(){
    var c=window.DB.complaints.filter(function(x){return x.status==='new';}).length;
    var w=window.DB.withdrawals.filter(function(x){return x.status==='pending';}).length;
    var wb=document.querySelector('.nav-item[data-route="warn"] .badge'); if(wb) wb.textContent=c;
    var cb=document.querySelector('.nav-item[data-route="cash"] .badge'); if(cb) cb.textContent=w;
  };

  /* ---------------- GLOBAL AMAL DELEGATSIYASI ---------------- */
  document.addEventListener('click',function(e){
    var t;
    if(t=e.target.closest('[data-assign]')){ var o=window.DB.orders.find(function(x){return x.id===t.getAttribute('data-assign');}); window.assignDriver(o); }
    else if(t=e.target.closest('[data-wd]')){ window.confirmWithdrawal(t.getAttribute('data-wd')); }
    else if(t=e.target.closest('[data-wr]')){ window.rejectWithdrawal(t.getAttribute('data-wr')); }
    else if(t=e.target.closest('[data-block]')){
      var c=window.DB.clients.find(function(x){return x.id===t.getAttribute('data-block');});
      if(c){ c.is_blocked=!c.is_blocked; window.UI.toast('Bajarildi', c.full_name+' '+(c.is_blocked?'bloklandi':'blokdan chiqarildi')); window.rerenderPage(); }
    }
    else if(t=e.target.closest('[data-kyc-ok]')){
      var d=window.DB.drivers.find(function(x){return x.id===t.getAttribute('data-kyc-ok');});
      if(d){ d.kyc_status='approved'; window.UI.toast('Tasdiqlandi', d.full_name+' KYC tasdiqlandi'); window.rerenderPage(); }
    }
    else if(t=e.target.closest('[data-kyc-no]')){
      var d2=window.DB.drivers.find(function(x){return x.id===t.getAttribute('data-kyc-no');});
      if(d2){ d2.kyc_status='rejected'; window.UI.toast('Rad etildi', d2.full_name+' KYC rad etildi','error'); window.rerenderPage(); }
    }
    else if(t=e.target.closest('[data-fulfill]')){
      var r=window.DB.redemptions.find(function(x){return x.id===t.getAttribute('data-fulfill');});
      if(r){ r.status='fulfilled'; window.UI.toast('Berildi','Sovg\'a berildi: '+r.reward); window.rerenderPage(); }
    }
    else if(t=e.target.closest('[data-adjust]')){ window.adjustPoints(null); }
    else if(t=e.target.closest('[data-adj]')){ window.adjustPoints(t.getAttribute('data-adj')); }
    else if(t=e.target.closest('[data-edit-promo]')){ window.promoModal(t.getAttribute('data-edit-promo'), window.rerenderPage); }
    else if(t=e.target.closest('[data-new-promo]')){ window.promoModal(null, window.rerenderPage); }
    else if(t=e.target.closest('[data-x="new"]')){
      if(current.route==='car') window.UI.toast('Forma','Yangi haydovchi formasi (demo)');
      else if(current.route==='badge') window.UI.toast('Forma','Yangi xodim formasi (demo)');
      else window.newOrderModal();
    }
  });

  /* ---------------- START ---------------- */
  if(sessionStorage.getItem('elga_admin_in')){ renderShell(); navigate('grid'); }
  else renderLogin();
})();
