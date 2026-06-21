/* ====================================================================
   ELGA Admin — Mock ma'lumotlar bazasi
   TZ §3 DATA modeliga mos. Backend (api.elga.uz) tayyor bo'lganda
   shu joy fetch() bilan almashtiriladi (api.js qatlami).
   ==================================================================== */
(function(){
  var CITIES = ["Angor","Muzrabot","Jarqo'rg'on","Sherobod","Termiz","Denov"];
  var TARIFFS = ["Ekonom","Komfort","Biznes"];
  var FIRST = ["Dilshod","Madina","Aziz","Nilufar","Bobur","Sardor","Gulnora","Jasur","Kamola","Shuhrat","Zarina","Otabek","Malika","Rustam","Dilnoza","Akmal","Sevara","Bekzod","Nodira","Farrux"];
  var LAST = ["Tursunov","Rahimova","Karimov","Saidova","Toshev","Yusupov","Ergasheva","Qodirov","Ahmedova","Nazarov","Islomova","Murodov","Hakimova","Sobirov","Yo'ldosheva","Aliyev","Mirzayeva","Sultonov","Komilova","Xolmatov"];
  var CARS = [["Chevrolet","Cobalt"],["Chevrolet","Nexia 3"],["Chevrolet","Lacetti"],["Chevrolet","Gentra"],["Chevrolet","Spark"],["Chevrolet","Malibu"],["Daewoo","Matiz"]];
  var COLORS = ["Oq","Kulrang","Qora","Kumush","Bej"];

  // ---- MO'LJALLAR / MANZILLAR (namuna — platformaga kiritilgani sari to'planadi) ----
  var PLACES = {
    "Angor":       ["Markaz","Elektroset","15 bayroq","Yangi bozor","Temir yo'l vokzali","Sanoat zonasi","Do'stlik MFY","Paxtakor","Navoiy ko'chasi"],
    "Muzrabot":    ["Markaz","Pariqishloq","Xalqabod","Navbahor","Oqoltin","Bandixon yo'li","Mustaqillik MFY"],
    "Jarqo'rg'on": ["Markaz","Sharq","Markaziy bozor","Yangiobod","Vokzal","Paxtazor"],
    "Sherobod":    ["Markaz","Qiziriq yo'li","Bozor","Vokzal","Talimarjon yo'li"],
    "Termiz":      ["Markaz","Vokzal","Aeroport","Alpomish maydoni","Markaziy bozor","Chegara (Ayritom)","Universitet"],
    "Denov":       ["Markaz","Markaziy bozor","Sariosiyo yo'li","Yangiariq","Qumqo'rg'on yo'li"]
  };

  function pick(a,i){ return a[i % a.length]; }
  function rnd(seed){ var x=Math.sin(seed)*10000; return x-Math.floor(x); }
  function initials(name){ var p=name.split(' '); return ((p[0]||'')[0]||'')+((p[1]||'')[0]||''); }
  function phone(seed){ var ops=['90','91','93','94','97','99','88','33']; var op=pick(ops,seed);
    var a=10+Math.floor(rnd(seed)*89); var b=10+Math.floor(rnd(seed+1)*89); var c=10+Math.floor(rnd(seed+2)*89);
    return '+998 '+op+' '+a+' '+b+' '+c; }

  // ---- DRIVERS ----
  var STATUSES = ["free","busy","offline","blocked"];
  var KYC = ["approved","approved","approved","pending","rejected"];
  var drivers = [];
  for(var i=0;i<48;i++){
    var nm = pick(FIRST,i)+' '+pick(LAST,i+3);
    var car = pick(CARS,i);
    var st = i<6?'blocked':(i%10===0?'offline':pick(STATUSES,(i%3)));
    if(i>=6) st = (i%4===0?'offline':(i%3===0?'busy':'free'));
    drivers.push({
      id:'DR'+(101+i), park_number:300+i*7%180+26, full_name:nm, ini:initials(nm),
      phone:phone(i+1), status: i<6?'blocked':st,
      car_make:car[0], car_model:car[1], car_plate:'01 '+(100+i)+' '+['AAB','BCA','CCB','DEF','GHK'][i%5],
      car_color:pick(COLORS,i), tariff:pick(TARIFFS,i%3), rating:(4.2+rnd(i)*0.79).toFixed(2),
      orders_count: 120+Math.floor(rnd(i+5)*1800), balance: Math.floor(rnd(i+2)*1500)*1000,
      kyc_status: i<6?'approved':pick(KYC,i), city:pick(CITIES,i)
    });
  }

  // ---- CLIENTS ----
  var clients = [];
  for(var c=0;c<60;c++){
    var cn = pick(FIRST,c+5)+' '+pick(LAST,c+1);
    clients.push({
      id:'CL'+(2001+c), full_name:cn, ini:initials(cn), phone:phone(c+40),
      is_blocked: c%23===0, orders_count: 3+Math.floor(rnd(c)*240),
      total_spent: (50+Math.floor(rnd(c+1)*900))*1000,
      tier: c%9===0?'gold':(c%4===0?'silver':'bronze'),
      points: Math.floor(rnd(c+3)*1800),
      registered_at: dateAgo(c*5+2)
    });
  }

  // ---- ORDERS ----
  var OSTATUS = ["completed","in_progress","searching","assigned","cancelled","new"];
  var PAY = ["cash","payme","click","balance"];
  function placeOf(city,seed){ var arr=PLACES[city]||["Markaz"]; return arr[Math.floor(rnd(seed)*arr.length)]; }
  var orders = [];
  for(var o=0;o<140;o++){
    var cl = pick(clients,o);
    var dr = pick(drivers,o+2);
    var st = o<3?pick(["new","searching"],o):pick(OSTATUS,o%6);
    var fromCity = pick(CITIES,o);
    var intercity = rnd(o+50) < 0.3;            // ~30% shaharlararo
    var toCity = intercity ? (function(){ var t=pick(CITIES,o+3); if(t===fromCity) t=pick(CITIES,o+1); return t; })() : fromCity;
    var fromPlace = placeOf(fromCity,o+1), toPlace = placeOf(toCity,o+7);
    if(toPlace===fromPlace && !intercity) toPlace = placeOf(toCity,o+13);
    var fromLabel = fromCity+' · '+fromPlace, toLabel = toCity+' · '+toPlace;
    var price = intercity ? (35+Math.floor(rnd(o)*70))*1000 : (12+Math.floor(rnd(o)*26))*1000;
    orders.push({
      id:'#'+(10620-o), client:cl.full_name, client_id:cl.id, client_ini:cl.ini, client_phone:cl.phone,
      driver: st==='new'||st==='searching'?null:dr.full_name, driver_id:dr.id, park: st==='new'||st==='searching'?null:dr.park_number,
      from_city:fromCity, from_place:fromPlace, to_city:toCity, to_place:toPlace,
      from:fromLabel, to:toLabel, route_type: intercity?'inter':'intra',
      tariff:pick(TARIFFS,o%3), distance: intercity ? (20+rnd(o)*70).toFixed(1) : (1.5+rnd(o)*8).toFixed(1),
      duration: intercity ? 30+Math.floor(rnd(o+1)*60) : 5+Math.floor(rnd(o+1)*22),
      price:price, commission:Math.round(price*0.15),
      payment: pick(PAY,o), payment_status: st==='completed'?'paid':'pending',
      status:st, created_at: minsAgo(o*7+3), cancel_reason: st==='cancelled'?pick(["Mijoz topilmadi","Haydovchi rad etdi","Narx kelishmadi","Mijoz bekor qildi"],o):null
    });
  }

  // ---- WITHDRAWALS ----
  var withdrawals = [];
  for(var w=0;w<14;w++){
    var d = pick(drivers,w+1);
    withdrawals.push({
      id:'WD'+(501+w), driver:d.full_name, driver_id:d.id, driver_ini:d.ini, driver_phone:d.phone, park:d.park_number,
      amount: (3+Math.floor(rnd(w)*22))*100000, provider: w%2?'Payme':'Click',
      status: w<5?'pending':(w%3===0?'paid':(w%5===0?'rejected':'approved')),
      requested_at: minsAgo(w*40+12)
    });
  }

  // ---- TRANSACTIONS ----
  var TTYPE = ["ride_payment","commission","topup","withdrawal","refund"];
  var transactions = [];
  for(var t=0;t<80;t++){
    var amt = (10+Math.floor(rnd(t)*140))*1000;
    transactions.push({
      id:'TX'+(90001+t), type:pick(TTYPE,t%5), order:t%3?('#'+(10620-t)):null,
      who: pick(drivers,t).full_name, amount: amt, provider:pick(["Payme","Click","Naqd","Balans"],t%4),
      status: t%11===0?'failed':(t%7===0?'pending':'success'), created_at: minsAgo(t*11+5)
    });
  }

  // ---- COMPLAINTS ----
  var CCAT = ["Haydovchi kechikdi","Noto'g'ri narx","Avtomobil holati","Bekor qilish to'lovi","Qo'pol muomala","Yo'nalish noto'g'ri"];
  var complaints = [];
  for(var k=0;k<13;k++){
    var cl2 = pick(clients,k+7);
    complaints.push({
      id:'CM'+(401+k), order:'#'+(10402-k*3), category:pick(CCAT,k), source:k%4===0?'driver':'client',
      who:cl2.full_name, city:pick(CITIES,k), description:'Mijoz '+pick(CCAT,k).toLowerCase()+' haqida shikoyat qildi. Operator tekshirishi kerak.',
      status: k<5?'new':(k%2?'in_review':'resolved'), created_at: minsAgo(k*55+5)
    });
  }

  // ---- ADMIN USERS (xodimlar) ----
  var ROLES = ["super_admin","operator","finance_admin","dispatcher","moderator"];
  var staff = [
    {id:'AU1', login:'admin', full_name:'Utkir Urazov', ini:'UU', phone:phone(2), role:'super_admin', is_active:true, last_login:'Hozir onlayn'},
    {id:'AU2', login:'operator1', full_name:'Sardor To\'shev', ini:'ST', phone:phone(7), role:'operator', is_active:true, last_login:minsAgo(14)},
    {id:'AU3', login:'finance1', full_name:'Gulnora Ergasheva', ini:'GE', phone:phone(11), role:'finance_admin', is_active:true, last_login:minsAgo(120)},
    {id:'AU4', login:'disp1', full_name:'Jasur Qodirov', ini:'JQ', phone:phone(13), role:'dispatcher', is_active:true, last_login:minsAgo(3)},
    {id:'AU5', login:'disp2', full_name:'Kamola Ahmedova', ini:'KA', phone:phone(17), role:'dispatcher', is_active:true, last_login:minsAgo(46)},
    {id:'AU6', login:'mod1', full_name:'Rustam Murodov', ini:'RM', phone:phone(19), role:'moderator', is_active:false, last_login:dateAgo(4)}
  ];

  // ---- REWARDS (sovg'alar) ----
  var rewards = [
    {id:'RW1', title:'5 000 so\'m chegirma', desc:'Keyingi safaringizga 5 000 so\'m chegirma.', cost:200, type:'discount', stock:9999, active:true, icon:'ticket'},
    {id:'RW2', title:'Bepul safar (Ekonom)', desc:'Ekonom tarifda 1 ta bepul safar (shahar ichi).', cost:850, type:'free_ride', stock:120, active:true, icon:'car'},
    {id:'RW3', title:'10% chegirma kuponi', desc:'Istalgan safarga 10% chegirma, 30 kun amal qiladi.', cost:400, type:'discount', stock:500, active:true, icon:'tag'},
    {id:'RW4', title:'ELGA termo-stakan', desc:'Brendlangan termo-stakan sovg\'asi.', cost:1500, type:'gift', stock:40, active:true, icon:'gift'},
    {id:'RW5', title:'Bepul safar (Komfort)', desc:'Komfort tarifda 1 ta bepul safar.', cost:1200, type:'free_ride', stock:60, active:true, icon:'star'},
    {id:'RW6', title:'15 000 so\'m chegirma', desc:'Yirik safar uchun 15 000 so\'m chegirma.', cost:600, type:'discount', stock:0, active:false, icon:'ticket'}
  ];

  // ---- REDEMPTIONS (almashtirishlar) ----
  var redemptions = [];
  for(var r=0;r<18;r++){
    var rw = pick(rewards,r); var cl3 = pick(clients,r+11);
    redemptions.push({
      id:'RD'+(7001+r), client:cl3.full_name, client_ini:cl3.ini, reward:rw.title, points:rw.cost,
      code:'ELGA-'+(1000+r*37), status: r<6?'pending':(r%3?'fulfilled':'cancelled'), created_at: dateAgo(r*2+1)
    });
  }

  // ---- PROMO CODES ----
  var promos = [
    {id:'PR1', code:'YANGI2026', type:'percent', value:20, min_order:20000, limit:1000, used:412, valid_to:'2026-12-31', active:true},
    {id:'PR2', code:'TERMIZ50', type:'fixed', value:5000, min_order:30000, limit:500, used:288, valid_to:'2026-08-01', active:true},
    {id:'PR3', code:'BONUS100', type:'points', value:100, min_order:0, limit:2000, used:1340, valid_to:'2026-07-15', active:true},
    {id:'PR4', code:'KECHKI10', type:'percent', value:10, min_order:15000, limit:300, used:300, valid_to:'2026-06-01', active:false},
    {id:'PR5', code:'DENOV25', type:'fixed', value:2500, min_order:20000, limit:400, used:67, valid_to:'2026-09-30', active:true}
  ];

  // ---- CITIES ----
  var cityRows = CITIES.map(function(n,idx){
    return {id:'CT'+(idx+1), name:n, region:'Surxondaryo', active:true,
      drivers: drivers.filter(function(d){return d.city===n;}).length,
      orders: orders.filter(function(o){return o.from===n;}).length};
  });

  // ---- NOTIFICATIONS ----
  var notifications = [
    {id:'N1', type:'order', title:'Yangi buyurtma #10620', body:'Angor · Elektroset → Angor · 15 bayroq · Komfort · 24 000 so\'m', read:false, created_at:minsAgo(2), icon:'bag', tone:'info'},
    {id:'N2', type:'complaint', title:'Yangi shikoyat', body:'Haydovchi kechikdi · #10402 · Aziz K.', read:false, created_at:minsAgo(5), icon:'warn', tone:'danger'},
    {id:'N3', type:'withdrawal', title:'Pul yechish so\'rovi', body:'Dilshod T. · 540 000 so\'m · Payme', read:false, created_at:minsAgo(18), icon:'cash', tone:'gold'},
    {id:'N4', type:'kyc', title:'KYC tasdiqlash kutilmoqda', body:'2 ta yangi haydovchi hujjati yuklandi', read:true, created_at:minsAgo(55), icon:'shield', tone:'info'},
    {id:'N5', type:'system', title:'Tizim yangilandi', body:'Tariflar moduli yangilandi (v3.0)', read:true, created_at:dateAgo(1), icon:'cog', tone:'info'}
  ];

  // ---- MO'LJALLAR LUG'ATI (places) — seed + buyurtmalardan to'plangan foydalanish ----
  var places = [];
  var placeIndex = {};
  function regPlace(city, name){
    var key = city+'|'+name;
    if(placeIndex[key]){ placeIndex[key].count++; return placeIndex[key]; }
    var p = {id:'PL'+(places.length+1), city:city, name:name, count:1,
      added_at: dateAgo(Math.floor(rnd(places.length)*40)), source:'seed'};
    places.push(p); placeIndex[key]=p; return p;
  }
  CITIES.forEach(function(c){ (PLACES[c]||[]).forEach(function(n){ regPlace(c,n); }); });
  // buyurtmalardagi foydalanishni hisobga olish
  orders.forEach(function(o){ regPlace(o.from_city,o.from_place); regPlace(o.to_city,o.to_place); });

  // ---- AUDIT LOGS ----
  var ACT = [
    ["withdrawal.approve","withdrawals","WD501","Pul yechish tasdiqlandi (2-bosqich)"],
    ["driver.block","drivers","DR104","Haydovchi bloklandi: hujjat muddati tugagan"],
    ["tariff.update","tariffs","TF2","Komfort surge 1.0 → 1.3"],
    ["auth.login","admin_users","AU1","Tizimga kirish (super_admin)"],
    ["kyc.verify","driver_documents","DOC88","KYC tasdiqlandi"],
    ["order.cancel","orders","#10479","Buyurtma bekor qilindi: mijoz bekor qildi"],
    ["promo.create","promo_codes","PR5","Yangi promo-kod yaratildi: DENOV25"],
    ["client.block","clients","CL2008","Mijoz bloklandi: spam"],
    ["refund.create","transactions","TX90011","Pul qaytarildi: 28 500 so'm"],
    ["loyalty.adjust","loyalty_accounts","CL2001","Qo'lda +200 ball qo'shildi"]
  ];
  var audit = [];
  for(var a=0;a<26;a++){
    var ac = pick(ACT,a); var u = pick(staff,a);
    audit.push({id:'LG'+(8001+a), user:u.full_name, role:u.role, action:ac[0], entity:ac[1], entity_id:ac[2],
      detail:ac[3], ip:'185.74.'+(10+a%200)+'.'+(2+a%50), created_at:minsAgo(a*23+4)});
  }

  function minsAgo(m){
    if(m<60) return m+' daq oldin';
    var h=Math.floor(m/60); if(h<24) return h+' soat oldin';
    return Math.floor(h/24)+' kun oldin';
  }
  function dateAgo(d){
    var dt=new Date(2026,5,21); dt.setDate(dt.getDate()-d);
    var mm=['Yan','Fev','Mar','Apr','May','Iyun','Iyul','Avg','Sen','Okt','Noy','Dek'];
    return dt.getDate()+'-'+mm[dt.getMonth()]+' '+dt.getFullYear();
  }

  window.DB = {
    CITIES:CITIES, TARIFFS:TARIFFS, ROLES:ROLES, PLACES:PLACES,
    drivers:drivers, clients:clients, orders:orders, withdrawals:withdrawals,
    transactions:transactions, complaints:complaints, staff:staff,
    rewards:rewards, redemptions:redemptions, promos:promos, cities:cityRows,
    notifications:notifications, audit:audit, places:places,
    // Yangi manzil kiritilganda lug'atga qo'shib boradi (to'planadi)
    addPlace:function(city,name){
      name=(name||'').trim(); if(!city||!name) return null;
      var key=city+'|'+name, p=placeIndex[key];
      if(p){ p.count++; return p; }
      p={id:'PL'+(places.length+1), city:city, name:name, count:1, added_at:'hozir', source:'kiritilgan'};
      places.push(p); placeIndex[key]=p; return p;
    },
    placesOf:function(city){ return places.filter(function(p){return p.city===city;}).sort(function(a,b){return b.count-a.count;}); },
    tariffs:[
      {id:'TF1', name:'Ekonom', base:8000, per_km:1500, per_min:300, min_fare:12000, surge:1.0, commission:15, active:true},
      {id:'TF2', name:'Komfort', base:12000, per_km:2200, per_min:450, min_fare:18000, surge:1.0, commission:15, active:true},
      {id:'TF3', name:'Biznes', base:20000, per_km:3500, per_min:700, min_fare:30000, surge:1.2, commission:18, active:true}
    ]
  };

  // foydali util'lar
  window.maskPhone = function(p){ return p; }; // mock'da allaqachon maskirovkalangan
  window.money = function(n){ return (n||0).toLocaleString('ru-RU').replace(/,/g,' '); };
  window.roleLabel = function(r){
    return {super_admin:'Super-admin', operator:'Operator', finance_admin:'Moliya admini',
            dispatcher:'Dispetcher', moderator:'Moderator'}[r] || r;
  };
})();
