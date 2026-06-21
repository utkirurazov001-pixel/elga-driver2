/* ====================================================================
   ELGA Admin — sahifalar uchun umumiy yordamchilar
   ==================================================================== */
window.PAGES = window.PAGES || {};
(function(){
  // Sahifa sarlavhasi
  window.pageHead = function(o){
    var live = o.live ? '<span class="live"><i></i>Real vaqt rejimida</span>' : '';
    var sub = o.sub ? '<p>'+o.sub+(live?' · '+live:'')+'</p>' : (live?'<p>'+live+'</p>':'');
    return '<div class="page-head"><div class="lt"><h1>'+o.title+'</h1>'+sub+'</div>'+
      (o.actions?'<div class="head-actions">'+o.actions+'</div>':'')+'</div>';
  };

  /* Umumiy ro'yxat sahifasi fabrikasi (toolbar + jadval + holat boshqaruvi)
     opts: {
       title, sub, actions, live,
       perPage, placeholder, filters(state)->[{key,label,options,value}],
       getData(state)->{rows,total},   // filtrlangan, paginatsiyalangan
       columns, rowAttr, emptyTitle, empty,
       beforeTable(state, wrap)->htmlString (ixtiyoriy KPI strip va h.k.)
     } */
  window.listPage = function(opts){
    var state = { q:'', page:1, sortKey:opts.defaultSort||null, sortDir:opts.defaultDir||'desc' };
    var root = document.createElement('div');
    var perPage = opts.perPage||10;

    function computeData(){
      // Yangi shartnoma: opts.rows(state) -> to'liq filtrlangan massiv (sort+paginate markazda)
      if(opts.rows){
        var full = opts.rows(state);
        if(state.sortKey){
          var col = (opts.columns||[]).filter(function(c){return c.sortKey===state.sortKey;})[0];
          var valOf = col && col.sortVal ? col.sortVal : function(r){ return r[state.sortKey]; };
          full = full.slice().sort(function(a,b){
            var x=valOf(a), y=valOf(b);
            if(typeof x==='string'&&!isNaN(parseFloat(x))&&isFinite(x)) {x=parseFloat(x);y=parseFloat(y);}
            if(x<y) return state.sortDir==='asc'?-1:1;
            if(x>y) return state.sortDir==='asc'?1:-1;
            return 0;
          });
        }
        return { rows: full.slice((state.page-1)*perPage, state.page*perPage), total: full.length, _full: full };
      }
      return opts.getData(state);
    }

    function render(){
      var data = computeData();
      root.innerHTML = window.pageHead({title:opts.title, sub:opts.sub, actions:typeof opts.actions==='function'?opts.actions():opts.actions, live:opts.live});

      if(opts.beforeTable){
        var pre = document.createElement('div');
        pre.innerHTML = opts.beforeTable(state);
        while(pre.firstChild) root.appendChild(pre.firstChild);
      }

      var tb = window.UI.toolbar({
        q: state.q,
        placeholder: opts.placeholder,
        filters: opts.filters? opts.filters(state):[],
        right: opts.toolbarRight
      }, function(st){
        // kursor pozitsiyasini saqlab qolamiz (oxiriga sakramasligi uchun)
        var ae = document.activeElement;
        var caret = (ae && ae.getAttribute && ae.getAttribute('data-f')==='q') ? ae.selectionStart : null;
        state.q = st.q!=null?st.q:state.q;
        (opts.filters?opts.filters(state):[]).forEach(function(f){ if(st[f.key]!=null) state[f.key]=st[f.key]; });
        state.page = 1;
        render();
        var inp = root.querySelector('[data-f="q"]');
        if(inp && caret!=null){ inp.focus(); try{ inp.setSelectionRange(caret, caret); }catch(e){} }
      });
      root.appendChild(tb);

      var tbl = window.UI.table({
        columns: opts.columns,
        rows: data.rows,
        rowAttr: opts.rowAttr,
        total: data.total,
        page: state.page,
        perPage: perPage,
        emptyTitle: opts.emptyTitle, empty: opts.empty,
        sort: opts.rows ? {key:state.sortKey, dir:state.sortDir} : null,
        onSort: opts.rows ? function(key){
          if(state.sortKey===key){ state.sortDir = state.sortDir==='asc'?'desc':'asc'; }
          else { state.sortKey=key; state.sortDir='asc'; }
          render();
        } : null,
        onPage: function(p){ state.page=p; render(); }
      });
      // qator bosish (detal)
      if(opts.onRowClick){
        tbl.querySelectorAll('tbody tr').forEach(function(tr,i){
          if(tr.querySelector('.empty')) return;
          tr.classList.add('clickable');
          tr.addEventListener('click', function(e){
            if(e.target.closest('button')||e.target.closest('a')) return;
            opts.onRowClick(data.rows[i], render);
          });
        });
      }
      root.appendChild(tbl);

      // CSV eksport tugmasi (sarlavhadagi [data-export])
      var exp = root.querySelector('[data-export]');
      if(exp){
        exp.addEventListener('click', function(){
          var full = data._full || data.rows;
          var cols = (opts.exportColumns||opts.columns).filter(function(c){return c.csv||c.key||c.exportKey;});
          window.UI.exportCSV((opts.exportName||'elga-export')+'.csv',
            cols.map(function(c){return {th:c.csvTh||(c.th||c.exportKey),csv:c.csv,key:c.exportKey};}), full);
        });
      }
    }
    root._render = render;
    render();

    // Jonli yangilanish (real-time event'lar)
    if(opts.liveEvents && window.Bus){
      opts.liveEvents.forEach(function(ev){
        var off = window.Bus.on(ev, function(){
          // foydalanuvchi yozayotgan yoki modal ochiq bo'lsa — tegmaymiz
          if(document.querySelector('.modal-back')) return;
          var ae = document.activeElement;
          if(ae && root.contains(ae) && (ae.tagName==='INPUT'||ae.tagName==='SELECT'||ae.tagName==='TEXTAREA')) return;
          if(state.page>1) return; // faqat 1-sahifada jonli oqim
          render();
        });
        if(window.addPageSub) window.addPageSub(off);
      });
    }
    return root;
  };

  // Kichik yordamchi: filtr select varianti
  window.opt = function(v,t){ return {v:v,t:t}; };
  window.cityOptions = function(){
    return [window.opt('','Barcha shaharlar')].concat(window.DB.CITIES.map(function(c){return window.opt(c,c);}));
  };
})();
