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
    var state = { q:'', page:1 };
    var root = document.createElement('div');

    function render(){
      var data = opts.getData(state);
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
        state.q = st.q!=null?st.q:state.q;
        (opts.filters?opts.filters(state):[]).forEach(function(f){ if(st[f.key]!=null) state[f.key]=st[f.key]; });
        state.page = 1;
        render();
        // qidiruv inputiga fokusni qaytarish
        var inp = root.querySelector('[data-f="q"]'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length,inp.value.length); }
      });
      root.appendChild(tb);

      var tbl = window.UI.table({
        columns: opts.columns,
        rows: data.rows,
        rowAttr: opts.rowAttr,
        total: data.total,
        page: state.page,
        perPage: opts.perPage||10,
        emptyTitle: opts.emptyTitle, empty: opts.empty,
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
    }
    root._render = render;
    render();
    return root;
  };

  // Kichik yordamchi: filtr select varianti
  window.opt = function(v,t){ return {v:v,t:t}; };
  window.cityOptions = function(){
    return [window.opt('','Barcha shaharlar')].concat(window.DB.CITIES.map(function(c){return window.opt(c,c);}));
  };
})();
