/* ====================================================================
   ELGA Admin — UI yordamchilar va qayta ishlatiladigan komponentlar
   ==================================================================== */
(function(){
  var UI = {};

  // ---- holat teglari ----
  var ORDER_TAGS = {
    completed:['done','Bajarildi'], in_progress:['prog','Yo\'lda'], arriving:['prog','Yetib bormoqda'],
    assigned:['prog','Tayinlangan'], searching:['wait','Qidirilmoqda'], new:['wait','Yangi'],
    cancelled:['canc','Bekor']
  };
  var DRIVER_TAGS = {
    free:['done','Bo\'sh'], busy:['wait','Buyurtmada'], offline:['neutral','Oflayn'], blocked:['canc','Bloklangan']
  };
  var KYC_TAGS = { approved:['done','Tasdiqlangan'], pending:['wait','Kutilmoqda'], rejected:['canc','Rad etilgan'] };
  var GEN_TAGS = {
    pending:['wait','Kutilmoqda'], approved:['prog','Tasdiqlangan'], paid:['done','To\'langan'],
    rejected:['canc','Rad etilgan'], success:['done','Muvaffaqiyatli'], failed:['canc','Xato'],
    fulfilled:['done','Berildi'], cancelled:['canc','Bekor qilingan'],
    new:['wait','Yangi'], in_review:['prog','Ko\'rib chiqilmoqda'], resolved:['done','Hal qilindi'],
    'true':['done','Faol'], 'false':['neutral','Nofaol']
  };
  UI.tag = function(map,key){
    var t = map[key] || ['neutral', key];
    return '<span class="tg '+t[0]+'">'+t[1]+'</span>';
  };
  UI.orderTag = function(s){ return UI.tag(ORDER_TAGS,s); };
  UI.driverTag = function(s){ return UI.tag(DRIVER_TAGS,s); };
  UI.kycTag = function(s){ return UI.tag(KYC_TAGS,s); };
  UI.genTag = function(s){ return UI.tag(GEN_TAGS, String(s)); };

  UI.avatar = function(ini, blue){ return '<div class="av'+(blue?' blue':'')+'">'+ini+'</div>'; };
  UI.cust = function(name, ini, sub, blue){
    return '<div class="cust">'+UI.avatar(ini,blue)+'<div><b>'+name+'</b>'+(sub?'<br><span>'+sub+'</span>':'')+'</div></div>';
  };
  UI.park = function(n){ return n? '<span class="park">'+n+'</span>' : '<span class="muted">—</span>'; };
  UI.tariff = function(t){ return '<span class="tariff-chip">'+t+'</span>'; };
  UI.route = function(from,to){
    return '<div class="route">'+window.icon('pin',13)+from+' → '+to+'</div>';
  };

  // ---- KPI karta ----
  UI.kpi = function(o){
    var d = o.delta!=null ? '<div class="delta '+(o.deltaUp?'up':'down')+'">'+window.icon(o.deltaUp?'up':'down',13)+' '+o.delta+'</div>' : '';
    return '<div class="kpi"><div class="ic" style="background:'+o.bg+';color:'+o.color+'">'+window.icon(o.icon,21)+'</div>'+
      '<div class="lab">'+o.label+'</div><div class="val">'+o.val+(o.unit?' <small>'+o.unit+'</small>':'')+'</div>'+d+'</div>';
  };
  UI.mini = function(o){
    return '<div class="mini"><div class="ic" style="background:'+o.bg+';color:'+o.color+'">'+window.icon(o.icon,18)+'</div>'+
      '<div><div class="lab">'+o.label+'</div><div class="val">'+o.val+(o.unit?' <small>'+o.unit+'</small>':'')+'</div></div></div>';
  };

  // ---- Jadval + paginatsiya ----
  // cfg: {columns:[{th,render(row),cls}], rows, page, perPage, total, onPage, empty}
  UI.table = function(cfg){
    var cols = cfg.columns;
    var sort = cfg.sort || {};
    var head = '<thead><tr>'+cols.map(function(c){
      var sortable = c.sortKey && cfg.onSort;
      var arrow = '';
      if(sortable && sort.key===c.sortKey){ arrow = ' <span style="color:var(--gold)">'+(sort.dir==='asc'?'▲':'▼')+'</span>'; }
      var attr = sortable ? ' data-sort="'+c.sortKey+'" style="cursor:pointer;user-select:none"' : '';
      return '<th'+(c.cls?' class="'+c.cls+'"':'')+attr+'>'+(c.th||'')+arrow+'</th>';
    }).join('')+'</tr></thead>';
    var body;
    if(!cfg.rows.length){
      body = '<tbody><tr><td colspan="'+cols.length+'"><div class="empty">'+window.icon('inbox',40)+
        '<b>'+(cfg.emptyTitle||'Ma\'lumot topilmadi')+'</b>'+(cfg.empty||'Filtrlarni o\'zgartirib ko\'ring')+'</div></td></tr></tbody>';
    } else {
      body = '<tbody>'+cfg.rows.map(function(r,i){
        var attr = cfg.rowAttr ? cfg.rowAttr(r,i) : '';
        return '<tr'+attr+'>'+cols.map(function(c){return '<td'+(c.cls?' class="'+c.cls+'"':'')+'>'+c.render(r,i)+'</td>';}).join('')+'</tr>';
      }).join('')+'</tbody>';
    }
    var pager = '';
    if(cfg.total!=null && cfg.perPage){
      var pages = Math.max(1, Math.ceil(cfg.total/cfg.perPage));
      var cur = cfg.page||1;
      var btns='';
      btns += '<button data-pg="'+(cur-1)+'"'+(cur<=1?' disabled':'')+'>‹</button>';
      for(var p=1;p<=pages;p++){
        if(pages>7 && p>3 && p<pages-1 && Math.abs(p-cur)>1){ if(p===4) btns+='<button disabled>…</button>'; continue; }
        btns += '<button data-pg="'+p+'" class="'+(p===cur?'on':'')+'">'+p+'</button>';
      }
      btns += '<button data-pg="'+(cur+1)+'"'+(cur>=pages?' disabled':'')+'>›</button>';
      var from = cfg.total? (cur-1)*cfg.perPage+1 : 0;
      var to = Math.min(cur*cfg.perPage, cfg.total);
      pager = '<div class="pager"><span class="info">'+from+'–'+to+' / '+cfg.total+' ta</span><div class="pages" data-pager>'+btns+'</div></div>';
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="card"><div class="table-wrap"><table>'+head+body+'</table></div>'+pager+'</div>';
    if(cfg.onPage){
      var pg = wrap.querySelector('[data-pager]');
      if(pg) pg.addEventListener('click', function(e){
        var b=e.target.closest('button[data-pg]'); if(!b||b.disabled) return;
        cfg.onPage(parseInt(b.getAttribute('data-pg'),10));
      });
    }
    if(cfg.onSort){
      wrap.querySelectorAll('th[data-sort]').forEach(function(th){
        th.addEventListener('click', function(){ cfg.onSort(th.getAttribute('data-sort')); });
      });
    }
    return wrap;
  };

  // CSV eksport (haqiqiy yuklab olish)
  UI.exportCSV = function(filename, columns, rows){
    var head = columns.map(function(c){return '"'+(c.th||c.key||'')+'"';}).join(',');
    var body = rows.map(function(r){
      return columns.map(function(c){
        var v = c.csv ? c.csv(r) : (c.key ? r[c.key] : '');
        return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';
      }).join(',');
    }).join('\n');
    var csv = '﻿'+head+'\n'+body;
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    UI.toast('Eksport tayyor', filename+' yuklab olindi');
  };

  // ---- Toolbar (qidiruv + filtrlar) ----
  // filters: [{key,label,options:[{v,t}],value}]
  UI.toolbar = function(cfg, onChange){
    var html = '<div class="toolbar">';
    if(cfg.search!==false){
      html += '<div class="search-box">'+window.icon('search',16)+
        '<input data-f="q" placeholder="'+(cfg.placeholder||'Qidirish...')+'" value="'+(cfg.q||'')+'"></div>';
    }
    (cfg.filters||[]).forEach(function(f){
      html += '<select class="input" data-f="'+f.key+'">'+
        f.options.map(function(o){return '<option value="'+o.v+'"'+(String(o.v)===String(f.value)?' selected':'')+'>'+o.t+'</option>';}).join('')+
        '</select>';
    });
    if(cfg.right) html += '<div class="grow"></div>'+cfg.right;
    html += '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-f]').forEach(function(inp){
      var ev = inp.tagName==='SELECT'?'change':'input';
      inp.addEventListener(ev, function(){
        var st={}; wrap.querySelectorAll('[data-f]').forEach(function(x){st[x.getAttribute('data-f')]=x.value;});
        onChange(st);
      });
    });
    return wrap;
  };

  // ---- Modal ----
  UI.modal = function(o){
    var back = document.createElement('div');
    back.className='modal-back';
    back.innerHTML = '<div class="modal'+(o.wide?' wide':'')+'">'+
      '<div class="modal-head"><div><h3>'+o.title+'</h3>'+(o.sub?'<p>'+o.sub+'</p>':'')+'</div>'+
      '<div class="x" data-close>'+window.icon('x',18)+'</div></div>'+
      '<div class="modal-body">'+o.body+'</div>'+
      (o.foot?'<div class="modal-foot">'+o.foot+'</div>':'')+'</div>';
    function close(){ back.remove(); document.removeEventListener('keydown',esc); }
    function esc(e){ if(e.key==='Escape') close(); }
    back.addEventListener('click', function(e){ if(e.target===back) close(); });
    back.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    if(o.onMount) o.onMount(back, close);
    back._close = close;
    return back;
  };

  // ---- Toast ----
  UI.toast = function(title, sub, tone){
    tone = tone||'success';
    var wrap = document.querySelector('.toast-wrap');
    if(!wrap){ wrap=document.createElement('div'); wrap.className='toast-wrap'; document.body.appendChild(wrap); }
    var ic = tone==='success'?'check':(tone==='error'?'x':'bell');
    var t = document.createElement('div');
    t.className='toast '+tone;
    t.innerHTML = '<div class="ic">'+window.icon(ic,16)+'</div><div class="tx"><b>'+title+'</b>'+(sub?'<span>'+sub+'</span>':'')+'</div>';
    wrap.appendChild(t);
    setTimeout(function(){ t.style.transition='.25s'; t.style.opacity='0'; t.style.transform='translateX(20px)'; setTimeout(function(){t.remove();},250); }, 3200);
  };

  // ---- Chart (line area) ----
  UI.lineChart = function(done, canc, days, max){
    var W=620,H=230,pad={l:30,r:8,t:14,b:24};
    max = max || Math.ceil(Math.max.apply(null,done)/100)*100+100;
    var x=function(i){return pad.l+(i*(W-pad.l-pad.r)/(done.length-1));};
    var y=function(v){return pad.t+(1-v/max)*(H-pad.t-pad.b);};
    var line=function(arr){return arr.map(function(v,i){return (i?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1);}).join(' ');};
    var area=function(arr){return line(arr)+' L'+x(arr.length-1)+' '+(H-pad.b)+' L'+pad.l+' '+(H-pad.b)+' Z';};
    var g='';
    var steps=[0, max*0.25, max*0.5, max*0.75, max];
    steps.forEach(function(v){
      g+='<line class="gl" x1="'+pad.l+'" y1="'+y(v)+'" x2="'+(W-pad.r)+'" y2="'+y(v)+'"/>';
      g+='<text class="ax" x="'+(pad.l-7)+'" y="'+(y(v)+3)+'" text-anchor="end">'+Math.round(v)+'</text>';
    });
    days.forEach(function(d,i){ if(i%2===0) g+='<text class="ax" x="'+x(i)+'" y="'+(H-6)+'" text-anchor="middle">'+d+'</text>'; });
    return '<div class="chart"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      '<defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">'+
      '<stop offset="0" stop-color="#FFCC00" stop-opacity=".30"/><stop offset="1" stop-color="#FFCC00" stop-opacity="0"/></linearGradient></defs>'+
      g+'<path d="'+area(done)+'" fill="url(#ga)"/>'+
      '<path d="'+line(done)+'" fill="none" stroke="#FFCC00" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'+
      '<path d="'+line(canc)+'" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'+
      done.map(function(v,i){return '<circle cx="'+x(i)+'" cy="'+y(v)+'" r="2.6" fill="#15171C" stroke="#FFCC00" stroke-width="2"/>';}).join('')+
      '</svg></div>';
  };

  // ---- Donut ----
  UI.donut = function(segments, total, label){
    // segments: [{value,color}]
    var circ=100, off=25, circles='';
    var sum = segments.reduce(function(a,s){return a+s.value;},0)||1;
    var acc=0;
    segments.forEach(function(s){
      var len = s.value/sum*circ;
      circles += '<circle cx="21" cy="21" r="15.9" fill="none" stroke="'+s.color+'" stroke-width="5" stroke-dasharray="'+len.toFixed(1)+' '+(circ-len).toFixed(1)+'" stroke-dashoffset="'+(off-acc).toFixed(1)+'" stroke-linecap="round"/>';
      acc+=len;
    });
    return '<div class="donut"><svg viewBox="0 0 42 42" width="150" height="150">'+
      '<circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--bg)" stroke-width="5"/>'+circles+
      '</svg><div class="ctr"><b>'+total+'</b><span>'+(label||'jami')+'</span></div></div>';
  };

  // ---- oddiy filtr/qidiruv yordamchisi ----
  UI.paginate = function(arr, page, per){
    return arr.slice((page-1)*per, page*per);
  };
  UI.matches = function(row, q, fields){
    if(!q) return true;
    q=q.toLowerCase();
    return fields.some(function(f){ return String(row[f]||'').toLowerCase().indexOf(q)>=0; });
  };

  window.UI = UI;
})();
