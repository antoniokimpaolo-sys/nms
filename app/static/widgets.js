
(function(){
  function esc(v){
    return String(v ?? '').replace(/[&<>\"']/g,m=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'
    }[m]));
  }
  function fmtAge(iso){
    if(!iso)return '—';
    const sec=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000));
    if(sec<60)return sec+'s ago';
    if(sec<3600)return Math.floor(sec/60)+'m ago';
    return Math.floor(sec/3600)+'h ago';
  }
  function uptime(sec){
    if(!sec)return '—';
    const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60);
    return d+'d '+h+'h '+m+'m';
  }
  function bps(v){
    if(v==null)return '—';
    const n=Number(v);
    if(n>=1e9)return (n/1e9).toFixed(2)+' Gbps';
    if(n>=1e6)return (n/1e6).toFixed(1)+' Mbps';
    if(n>=1e3)return (n/1e3).toFixed(1)+' Kbps';
    return n.toFixed(0)+' bps';
  }
  const CATALOG = {
    "device-summary": {title:"Device Summary", subtitle:"Devices, ports and availability", size:"wide", icon:"▣"},
    "availability-map": {title:"Availability Map", subtitle:"Live status by monitored device", size:"wide", icon:"◉"},
    "alerts": {title:"Alerts", subtitle:"Active alert notifications", size:"medium", icon:"♧"},
    "eventlog": {title:"Eventlog", subtitle:"Recent monitoring events", size:"medium", icon:"◈"},
    "network-health": {title:"Network Health", subtitle:"Live availability", size:"small", icon:"◔"},
    "device-status": {title:"Device Status", subtitle:"Online, offline and warning", size:"medium", icon:"◍"},
    "top-devices": {title:"Top Devices", subtitle:"CPU, memory, uptime or latency", size:"medium", icon:"↕"},
    "top-interfaces": {title:"Top Interfaces", subtitle:"Highest live interface traffic", size:"medium", icon:"⌁"},
    "traffic-overview": {title:"Traffic Overview", subtitle:"Current aggregate RX / TX", size:"wide", icon:"▥"},
    "sites": {title:"Smart City Sites", subtitle:"Site health overview", size:"medium", icon:"⌂"},
    "cctv-summary": {title:"CCTV Summary", subtitle:"Camera and NVR availability", size:"small", icon:"◉"},
    "polling-health": {title:"Polling Health", subtitle:"SNMP / ICMP collection status", size:"small", icon:"⌁"},
    "server-stats": {title:"Server Stats", subtitle:"Average CPU and memory of servers", size:"medium", icon:"▤"},
    "notes": {title:"Notes", subtitle:"Operator notes", size:"medium", icon:"✎"}
  };

  const DEFAULTS = [
    {id:"dw1",type:"device-summary",size:"wide"},
    {id:"dw2",type:"network-health",size:"small"},
    {id:"dw3",type:"device-status",size:"medium"},
    {id:"dw4",type:"alerts",size:"medium"},
    {id:"dw5",type:"availability-map",size:"wide"},
    {id:"dw6",type:"top-devices",size:"medium"},
    {id:"dw7",type:"top-interfaces",size:"medium"},
    {id:"dw8",type:"traffic-overview",size:"wide"},
    {id:"dw9",type:"sites",size:"medium"},
    {id:"dw10",type:"cctv-summary",size:"small"},
    {id:"dw11",type:"polling-health",size:"small"},
    {id:"dw12",type:"server-stats",size:"medium"},
    {id:"dw13",type:"eventlog",size:"medium"},
    {id:"dw14",type:"notes",size:"medium"}
  ];

  let widgets = readConfig();
  let editMode = false;
  let metric = "cpu";
  let data = {summary:{},alerts:[],sites:[],polling:{},topDevices:[],topInterfaces:[],devices:[]};

  function readConfig(){
    try{
      const x = JSON.parse(localStorage.getItem("smartcity-nms.dashboard.widgets") || "null");
      if(Array.isArray(x) && x.length) return x;
    }catch(e){}
    return DEFAULTS.map(function(x){return Object.assign({},x);});
  }
  function saveConfig(){ localStorage.setItem("smartcity-nms.dashboard.widgets", JSON.stringify(widgets)); }
  function sizeClass(s){ return s==="wide" ? "widget-wide" : s==="small" ? "widget-small" : "widget-medium"; }
  function id(){ return "dw_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,7); }

  async function refreshData(){
    try{
      const results = await Promise.all([
        api("/api/dashboard/summary"),
        api("/api/alerts?status=active&limit=30"),
        api("/api/dashboard/widget/sites"),
        api("/api/dashboard/widget/polling"),
        api("/api/dashboard/widget/top-interfaces?limit=8"),
        api("/api/dashboard/widget/top-devices?metric="+encodeURIComponent(metric)+"&limit=8"),
        api("/api/devices")
      ]);
      data.summary=results[0];
      data.alerts=results[1];
      data.sites=results[2];
      data.polling=results[3];
      data.topInterfaces=results[4];
      data.topDevices=results[5];
      data.devices=results[6];
      if(typeof devicesCache !== "undefined") devicesCache=data.devices;
      render();
    }catch(e){
      console.error("Widget data refresh failed",e);
    }
  }

  function toggleEdit(){
    editMode=!editMode;
    document.getElementById("dashboard-state").textContent=editMode?"EDIT MODE":"VIEW MODE";
    document.getElementById("dashboard-edit-toggle").textContent=editMode?"Done":"Edit Layout";
    document.getElementById("widget-grid").classList.toggle("edit-mode",editMode);
    render();
  }

  function openPicker(){
    const box=document.getElementById("widget-picker");
    const active={};
    widgets.forEach(function(w){active[w.type]=true;});
    box.innerHTML=Object.keys(CATALOG).map(function(type){
      const w=CATALOG[type];
      return '<label class="widget-option '+(active[type]?'selected':'')+'">'+
        '<input type="checkbox" value="'+type+'" '+(active[type]?'checked':'')+'>'+
        '<span class="widget-option-icon">'+w.icon+'</span>'+
        '<span><strong>'+esc(w.title)+'</strong><small>'+esc(w.subtitle)+'</small></span>'+
      '</label>';
    }).join("");
    document.getElementById("widget-modal").classList.remove("hidden");
  }

  function addSelected(){
    const inputs=$$("#widget-picker input:checked");
    const active={}; widgets.forEach(function(w){active[w.type]=true;});
    inputs.forEach(function(input){
      const type=input.value;
      if(!active[type]) widgets.push({id:id(),type:type,size:CATALOG[type].size});
    });
    saveConfig();
    document.getElementById("widget-modal").classList.add("hidden");
    render();
  }

  function remove(idValue){
    widgets=widgets.filter(function(w){return w.id!==idValue;});
    saveConfig();
    render();
  }

  function cycleSize(idValue){
    const w=widgets.find(function(x){return x.id===idValue;});
    if(!w)return;
    w.size=w.size==="small"?"medium":w.size==="medium"?"wide":"small";
    saveConfig();
    render();
  }

  function reset(){
    widgets=DEFAULTS.map(function(x){return Object.assign({},x);});
    saveConfig();
    render();
  }

  function setMetric(m){
    metric=m;
    refreshData();
  }

  function noteSave(v){ localStorage.setItem("smartcity-nms.dashboard.note",v); }

  function shell(w,body){
    const meta=CATALOG[w.type] || {title:w.type,subtitle:"Widget",icon:"▦"};
    return '<article class="dashboard-widget '+sizeClass(w.size)+'" draggable="'+editMode+'" data-widget-id="'+w.id+'">'+
      '<div class="widget-card card">'+
        '<div class="widget-head">'+
          '<div class="widget-title"><span class="widget-icon">'+meta.icon+'</span><div><h3>'+esc(meta.title)+'</h3><p>'+esc(meta.subtitle)+'</p></div></div>'+
          '<div class="widget-tools">'+(editMode?
            '<button class="widget-tool" title="Change widget width" onclick="window.SC3Widgets.cycleSize(\''+w.id+'\')">↔</button>'+
            '<button class="widget-tool danger" title="Remove widget" onclick="window.SC3Widgets.remove(\''+w.id+'\')">×</button>'
            :'')+
          '</div>'+
        '</div>'+
        '<div class="widget-body">'+body+'</div>'+
      '</div>'+
    '</article>';
  }

  function summaryStat(label,value,cls){
    return '<div class="summary-stat"><span class="'+(cls||'')+'">●</span><b>'+(value==null?0:value)+'</b><small>'+esc(label)+'</small></div>';
  }

  function topMetricValue(x){
    if(metric==="cpu") return x.cpu_percent==null?"—":x.cpu_percent+"%";
    if(metric==="memory") return x.memory_percent==null?"—":x.memory_percent+"%";
    if(metric==="uptime") return uptime(x.uptime_seconds);
    return x.latency_ms==null?"—":x.latency_ms+" ms";
  }

  function body(w){
    const d=data.summary||{};
    switch(w.type){
      case "device-summary":
        return '<div class="widget-summary-grid">'+
          summaryStat("Devices",d.total,"info")+
          summaryStat("Online",d.online,"good")+
          summaryStat("Offline",d.offline,"bad")+
          summaryStat("Alerts",d.active_alerts,"amber")+
          summaryStat("Ports",d.interfaces_total,"cyan")+
          summaryStat("Cameras",d.cameras_total,"info")+
        '</div>';

      case "availability-map":
        return '<div class="availability-map">'+
          (data.devices.length ? data.devices.map(function(x){
            return '<button class="availability-tile '+esc(x.status)+'" onclick="window.openDevice('+x.id+')">'+
              '<span class="availability-dot"></span>'+
              '<strong>'+esc(x.name)+'</strong>'+
              '<small>'+esc(x.ip)+'</small>'+
            '</button>';
          }).join("") : '<div class="empty">No devices configured.</div>')+
        '</div>';

      case "alerts":
        return '<div class="widget-list">'+
          (data.alerts.length ? data.alerts.map(function(x){
            return '<div class="widget-list-row"><span class="severity-dot '+esc(x.severity)+'"></span>'+
              '<div><strong>'+esc(x.device||x.ip||"Device")+'</strong><small>'+esc(x.type)+" · "+esc(x.message)+'</small></div>'+
              '<time>'+fmtAge(x.last_detected)+'</time></div>';
          }).join("") : '<div class="empty">No active alerts.</div>')+
        '</div>';

      case "eventlog":
        return '<div class="widget-list">'+
          (data.alerts.length ? data.alerts.slice(0,12).map(function(x){
            return '<div class="widget-list-row"><span class="event-mark">•</span>'+
              '<div><strong>'+esc(x.ip||x.device||"Device")+'</strong><small>'+esc(x.type)+" · "+esc(x.message)+'</small></div>'+
              '<time>'+fmtAge(x.last_detected)+'</time></div>';
          }).join("") : '<div class="empty">No recent events.</div>')+
        '</div>';

      case "network-health":
        return '<div class="widget-gauge"><div class="widget-ring" style="--pct:'+Number(d.health||0)*3.6+'deg"><strong>'+(d.health||0)+'%</strong><span>HEALTH</span></div>'+
          '<div class="widget-gauge-copy"><strong>'+(d.online||0)+' online</strong><span>'+(d.offline||0)+' offline</span><small>Live polling state</small></div></div>';

      case "device-status":
        var total=Math.max(1,d.total||0), on=d.online||0, off=d.offline||0, warn=d.warning||0;
        return '<div class="status-widget"><div class="status-bars">'+
          '<div><span style="width:'+(on/total*100)+'%"></span></div>'+
          '<div><span style="width:'+(off/total*100)+'%"></span></div>'+
          '<div><span style="width:'+(warn/total*100)+'%"></span></div>'+
        '</div><div class="legend compact">'+
          '<div><i class="dot green-dot"></i>Online <b>'+on+'</b></div>'+
          '<div><i class="dot red-dot"></i>Offline <b>'+off+'</b></div>'+
          '<div><i class="dot amber-dot"></i>Warning <b>'+warn+'</b></div>'+
        '</div></div>';

      case "top-devices":
        return '<div class="widget-inline-tabs">'+
          ["cpu","memory","uptime","latency"].map(function(m){
            return '<button class="'+(metric===m?"active":"")+'" onclick="window.SC3Widgets.setMetric(\''+m+'\')">'+m.charAt(0).toUpperCase()+m.slice(1)+'</button>';
          }).join("")+
        '</div><div class="widget-list">'+
          (data.topDevices.length ? data.topDevices.map(function(x,i){
            return '<div class="rank-row" onclick="window.openDevice('+x.id+')"><span class="rank">'+(i+1)+'</span>'+
              '<div><strong>'+esc(x.name)+'</strong><small>'+esc(x.ip)+'</small></div><b>'+topMetricValue(x)+'</b></div>';
          }).join("") : '<div class="empty">No data.</div>')+
        '</div>';

      case "top-interfaces":
        return '<div class="widget-list">'+
          (data.topInterfaces.length ? data.topInterfaces.map(function(x,i){
            return '<div class="rank-row"><span class="rank">'+(i+1)+'</span>'+
              '<div><strong>'+esc(x.device)+' · '+esc(x.name)+'</strong><small>'+esc(x.ip)+' · '+(x.oper_status===1?"UP":"DOWN")+'</small></div>'+
              '<b>'+bps(x.total_bps)+'</b></div>';
          }).join("") : '<div class="empty">No interfaces discovered.</div>')+
        '</div>';

      case "traffic-overview":
        var rx=data.topInterfaces.reduce(function(a,x){return a+(x.rx_bps||0);},0);
        var tx=data.topInterfaces.reduce(function(a,x){return a+(x.tx_bps||0);},0);
        var rxHeight=Math.min(100,rx?65:3),txHeight=Math.min(100,tx?45:3);
        return '<div class="traffic-widget"><div class="traffic-kpi"><span>RX</span><strong>'+bps(rx)+'</strong></div>'+
          '<div class="traffic-kpi"><span>TX</span><strong>'+bps(tx)+'</strong></div>'+
          '<div class="traffic-bars"><div class="traffic-bar"><i style="height:'+rxHeight+'%"></i><span>RX</span></div>'+
          '<div class="traffic-bar"><i style="height:'+txHeight+'%"></i><span>TX</span></div></div></div>';

      case "sites":
        return '<div class="site-widget-list">'+
          (data.sites.length ? data.sites.map(function(s){
            var cls=s.health>=95?"good":s.health>=80?"warn":"bad";
            return '<div><div><strong>'+esc(s.name)+'</strong><small>'+s.total+' devices · '+s.online+' online</small></div><span class="site-health '+cls+'">'+s.health+'%</span></div>';
          }).join("") : '<div class="empty">No sites configured.</div>')+
        '</div>';

      case "cctv-summary":
        var cams=data.devices.filter(function(x){return x.device_type==="Camera" || x.device_type==="NVR";});
        var camOn=cams.filter(function(x){return x.status==="online";}).length;
        return '<div class="cctv-widget"><div class="cctv-total"><strong>'+cams.length+'</strong><span>CCTV DEVICES</span></div>'+
          '<div class="cctv-split"><div><b class="good">'+camOn+'</b><small>Online</small></div>'+
          '<div><b class="bad">'+(cams.length-camOn)+'</b><small>Offline</small></div></div></div>';

      case "polling-health":
        return '<div class="polling-widget"><div class="polling-ring"><strong>'+(data.polling.coverage||0)+'%</strong><span>FRESH</span></div>'+
          '<div class="polling-copy"><div><span>SNMP</span><b>'+((data.polling&&data.polling.snmp)||0)+'</b></div>'+
          '<div><span>ICMP</span><b>'+((data.polling&&data.polling.icmp)||0)+'</b></div>'+
          '<small>'+((data.polling&&data.polling.fresh)||0)+'/'+((data.polling&&data.polling.total)||0)+' devices with a recent successful poll</small></div></div>';

      case "server-stats":
        var servers=data.devices.filter(function(x){return String(x.device_type||"").toLowerCase().indexOf("server")>=0;});
        var cpuVals=servers.map(function(x){return Number(x.cpu_percent);}).filter(function(x){return isFinite(x);});
        var memVals=servers.map(function(x){return Number(x.memory_percent);}).filter(function(x){return isFinite(x);});
        var avgCpu=cpuVals.length?(cpuVals.reduce(function(a,x){return a+x;},0)/cpuVals.length).toFixed(1):"—";
        var avgMem=memVals.length?(memVals.reduce(function(a,x){return a+x;},0)/memVals.length).toFixed(1):"—";
        return '<div class="server-stats"><div><span>CPU</span><strong>'+avgCpu+(avgCpu==="—"?"":"%")+'</strong><small>'+servers.length+' servers</small></div>'+
          '<div><span>MEMORY</span><strong>'+avgMem+(avgMem==="—"?"":"%")+'</strong><small>SNMP telemetry</small></div></div>';

      case "notes":
        var note=localStorage.getItem("smartcity-nms.dashboard.note") || "Smart City NOC dashboard. Use Edit Layout to rearrange widgets and Add Widget to extend the dashboard.";
        return '<textarea class="widget-note" onchange="window.SC3Widgets.noteSave(this.value)">'+esc(note)+'</textarea>';

      default:
        return '<div class="empty">Widget is not available yet.</div>';
    }
  }

  function render(){
    const grid=document.getElementById("widget-grid");
    if(!grid)return;
    const empty=document.getElementById("widget-empty");
    empty.classList.toggle("hidden",widgets.length!==0);
    grid.innerHTML=widgets.map(function(w){return shell(w,body(w));}).join("");
    bindDrag();
  }

  function bindDrag(){
    if(!editMode)return;
    let dragging=null;
    $$("#widget-grid .dashboard-widget").forEach(function(el){
      el.addEventListener("dragstart",function(){dragging=el.dataset.widgetId;el.classList.add("dragging");});
      el.addEventListener("dragend",function(){dragging=null;el.classList.remove("dragging");});
      el.addEventListener("dragover",function(e){e.preventDefault();});
      el.addEventListener("drop",function(e){
        e.preventDefault();
        const target=el.dataset.widgetId;
        if(!dragging || target===dragging)return;
        const from=widgets.findIndex(function(x){return x.id===dragging;});
        const to=widgets.findIndex(function(x){return x.id===target;});
        if(from<0||to<0)return;
        const moved=widgets.splice(from,1)[0];
        widgets.splice(to,0,moved);
        saveConfig();
        render();
      });
    });
  }

  window.SC3Widgets = {
    remove: remove,
    cycleSize: cycleSize,
    setMetric: setMetric,
    noteSave: noteSave,
    reset: reset
  };

  document.addEventListener("DOMContentLoaded",function(){
    document.getElementById("dashboard-add-widget").addEventListener("click",openPicker);
    document.getElementById("empty-add-widget").addEventListener("click",openPicker);
    document.getElementById("add-selected-widgets").addEventListener("click",addSelected);
    document.getElementById("dashboard-edit-toggle").addEventListener("click",toggleEdit);
    document.getElementById("dashboard-reset").addEventListener("click",function(){
      if(confirm("Reset dashboard widgets to the Smart City default layout?")) reset();
    });
    render();
    refreshData();
    setInterval(refreshData,15000);
  });

  window.addEventListener("smartcity-nms-live",function(){refreshData();});
})();
