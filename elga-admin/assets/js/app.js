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
    app.querySelector('#bellBtn').addEventListener('click',function(e){ e.stopPropagation(); openNotifPanel(this); });
    app.querySelector('#profileBtn').addEventListener('click',function(e){ e.stopPropagation(); openProfileMenu(this); });
    app.querySelector('#logout').addEventListener('click',doLogout);
    var ts=app.querySelector('.top-search input'); if(ts) ts.addEventListener('focus',function(){ this.blur(); openPalette(); });

    // Real-time dvigatelni ishga tushirish
    if(window.RealtimeEngine) window.RealtimeEngine.start();
    // Global jonli obunalar (badge'lar, qo'ng'iroq nuqtasi)
    if(window.Bus){
      window.Bus.on('notice:new', function(){
        var dot=document.querySelector('#bellBtn .dot'); if(dot) dot.style.display='block';
        window.refreshBadges();
      });
      window.Bus.on('order:new', function(o){
        if(current.route==='grid' || current.route==='radio') return; // o'sha sahifa o'zi ko'rsatadi
      });
    }
  }

  function doLogout(){
    if(window.RealtimeEngine) window.RealtimeEngine.stop();
    sessionStorage.removeItem('elga_admin_in'); renderLogin();
  }

  /* ---- Popover yordamchisi ---- */
  function popover(anchor, html, width){
    closePopovers();
    var r=anchor.getBoundingClientRect();
    var p=document.createElement('div');
    p.className='popover';
    p.style.cssText='position:fixed;top:'+(r.bottom+8)+'px;right:'+(window.innerWidth-r.right)+'px;width:'+(width||320)+'px;'+
      'background:var(--surface);border:1px solid var(--border-strong);border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.5);z-index:250;overflow:hidden;animation:rise .15s';
    p.innerHTML=html;
    document.body.appendChild(p);
    setTimeout(function(){ document.addEventListener('click', onDoc); },0);
    function onDoc(e){ if(!p.contains(e.target)){ closePopovers(); } }
    p._onDoc=onDoc;
    return p;
  }
  function closePopovers(){
    document.querySelectorAll('.popover').forEach(function(p){ if(p._onDoc) document.removeEventListener('click',p._onDoc); p.remove(); });
  }

  function openNotifPanel(anchor){
    var items = window.DB.notifications.slice(0,6).map(function(n){
      var tone = n.tone==='danger'?'':(n.tone==='gold'?'gold':'info');
      return '<div class="cmp" style="padding:12px 16px;border-bottom:1px solid var(--border);'+(n.read?'opacity:.6':'')+'">'+
        '<div class="ic '+tone+'">'+window.icon(n.icon,16)+'</div>'+
        '<div><div class="tt">'+n.title+'</div><div class="ds">'+n.body+'</div></div><div class="tm">'+n.created_at+'</div></div>';
    }).join('');
    var p=popover(anchor,
      '<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'+
      '<b style="font-size:14px">Bildirishnomalar</b><span class="tg gold" style="padding:2px 8px">'+window.DB.notifications.filter(function(n){return !n.read;}).length+' yangi</span></div>'+
      '<div style="max-height:380px;overflow-y:auto">'+items+'</div>'+
      '<div class="foot-link" data-all>Barchasini ko\'rish →</div>', 340);
    p.querySelector('[data-all]').addEventListener('click',function(){ closePopovers(); navigate('bell'); });
    var dot=document.querySelector('#bellBtn .dot'); if(dot) dot.style.display='none';
  }

  function openProfileMenu(anchor){
    var p=popover(anchor,
      '<div style="padding:16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:center">'+
        '<div class="av" style="width:42px;height:42px;border-radius:11px;background:linear-gradient(135deg,var(--gold),var(--gold-dark));display:grid;place-items:center;font-weight:800;color:#15171C">'+ME.ini+'</div>'+
        '<div><div style="font-weight:700">'+ME.full_name+'</div><div class="muted" style="font-size:12px">'+ME.phone+'</div>'+
        '<div class="tg gold" style="margin-top:4px;padding:2px 8px;font-size:10px">'+window.roleLabel(ME.role)+'</div></div></div>'+
      '<div style="padding:8px">'+
        menuItem('cog','Sozlamalar','set')+menuItem('shield','Rollar va ruxsatlar','roles')+
        menuItem('refresh','Demo ma\'lumotni tiklash','reset')+
        '<div style="height:1px;background:var(--border);margin:6px 0"></div>'+
        '<div class="pm-item" data-act="logout" style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:9px;cursor:pointer;color:var(--danger);font-weight:600">'+window.icon('logout',16)+'Chiqish</div>'+
      '</div>', 280);
    p.querySelectorAll('.pm-item').forEach(function(it){ it.addEventListener('mouseenter',function(){it.style.background='var(--surface-2)';}); it.addEventListener('mouseleave',function(){it.style.background='';}); });
    p.querySelectorAll('[data-act]').forEach(function(it){ it.addEventListener('click',function(){
      var a=it.getAttribute('data-act'); closePopovers();
      if(a==='set') navigate('cog','general');
      else if(a==='roles') navigate('cog','roles');
      else if(a==='reset'){ window.UI.toast('Tiklandi','Sahifa yangilanmoqda...'); setTimeout(function(){ location.reload(); },700); }
      else if(a==='logout') doLogout();
    }); });
  }
  function menuItem(ic,label,act){
    return '<div class="pm-item" data-act="'+act+'" style="display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:9px;cursor:pointer;font-weight:600">'+window.icon(ic,16)+label+'</div>';
  }

  /* ---- Command palette (⌘K) ---- */
  function openPalette(){
    var all=[];
    NAV.forEach(function(g){ g[1].forEach(function(it){
      all.push({label:it[1], group:g[0], route:it[0], sub:null, ic:it[2]});
      if(it[4]) it[4].forEach(function(s){ all.push({label:it[1]+' · '+s[1], group:g[0], route:it[0], sub:s[0], ic:it[2]}); });
    }); });
    var back=document.createElement('div');
    back.className='modal-back'; back.style.alignItems='flex-start'; back.style.paddingTop='12vh';
    back.innerHTML='<div class="modal" style="max-width:560px">'+
      '<div style="display:flex;align-items:center;gap:11px;padding:16px 20px;border-bottom:1px solid var(--border)">'+
      window.icon('search',18)+'<input id="palInput" placeholder="Bo\'lim yoki amal qidiring..." style="flex:1;background:none;border:none;outline:none;color:var(--text);font-family:inherit;font-size:15px"><kbd style="font-family:JetBrains Mono;font-size:10px;color:var(--text-faint);border:1px solid var(--border-strong);border-radius:5px;padding:2px 6px">ESC</kbd></div>'+
      '<div id="palList" style="max-height:50vh;overflow-y:auto;padding:8px"></div></div>';
    function close(){ back.remove(); document.removeEventListener('keydown',onKey); }
    function onKey(e){ if(e.key==='Escape') close();
      else if(e.key==='ArrowDown'){ e.preventDefault(); move(1); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); move(-1); }
      else if(e.key==='Enter'){ var s=back.querySelector('.pal-row.sel'); if(s) s.click(); }
    }
    var sel=0, shown=[];
    function renderList(q){
      q=(q||'').toLowerCase();
      shown=all.filter(function(x){return !q || x.label.toLowerCase().indexOf(q)>=0 || x.group.toLowerCase().indexOf(q)>=0;}).slice(0,8);
      sel=0;
      var list=back.querySelector('#palList');
      list.innerHTML = shown.length? shown.map(function(x,i){
        return '<div class="pal-row'+(i===0?' sel':'')+'" data-i="'+i+'" style="display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:10px;cursor:pointer">'+
          '<span style="color:var(--gold);display:grid">'+window.icon(x.ic,17)+'</span>'+
          '<div><div style="font-weight:700;font-size:13.5px">'+x.label+'</div><div class="muted" style="font-size:11px">'+x.group+'</div></div></div>';
      }).join('') : '<div class="empty" style="padding:30px">'+window.icon('search',32)+'<b>Hech narsa topilmadi</b></div>';
      list.querySelectorAll('.pal-row').forEach(function(row){
        row.addEventListener('mouseenter',function(){ setSel(parseInt(row.getAttribute('data-i'),10)); });
        row.addEventListener('click',function(){ var x=shown[parseInt(row.getAttribute('data-i'),10)]; close(); navigate(x.route,x.sub); });
      });
    }
    function setSel(i){ sel=i; back.querySelectorAll('.pal-row').forEach(function(r,idx){ r.classList.toggle('sel',idx===i); r.style.background=idx===i?'var(--surface-2)':''; }); }
    function move(d){ var n=shown.length; if(!n)return; setSel((sel+d+n)%n); back.querySelectorAll('.pal-row')[sel].scrollIntoView({block:'nearest'}); }
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
    document.addEventListener('keydown',onKey);
    document.body.appendChild(back);
    renderList('');
    var inp=back.querySelector('#palInput'); inp.focus();
    inp.addEventListener('input',function(){ renderList(inp.value); });
  }
  window.openPalette = openPalette;
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey) && (e.key==='k'||e.key==='K')){ e.preventDefault(); if(sessionStorage.getItem('elga_admin_in')) openPalette(); }
  });

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
  // Sahifa obunalari (real-time) — har navigatsiyada tozalanadi
  window.PAGE_SUBS = [];
  window.addPageSub = function(off){ if(typeof off==='function') window.PAGE_SUBS.push(off); };
  function clearPageSubs(){
    (window.PAGE_SUBS||[]).forEach(function(off){ try{off();}catch(e){} });
    window.PAGE_SUBS = [];
    (window._leafletMaps||[]).forEach(function(m){ try{m.remove();}catch(e){} });
    window._leafletMaps = [];
  }

  function navigate(route, sub){
    clearPageSubs();
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
    if(node._onMount){ try{ node._onMount(); }catch(e){ console.error(e); } }
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
    else if(t=e.target.closest('[data-add-place]')){ window.addPlaceModal(); }
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
