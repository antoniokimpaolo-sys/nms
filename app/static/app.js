const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let devicesCache = [];
let activity = [];

function esc(v){return String(v ?? '').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));}
function fmtAge(iso){ if(!iso) return '—'; const sec=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000)); if(sec<60)return `${sec}s ago`; if(sec<3600)return `${Math.floor(sec/60)}m ago`; return `${Math.floor(sec/3600)}h ago`; }
function uptime(sec){if(!sec)return '—';const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60);return `${d}d ${h}h ${m}m`;}
function bps(v){if(v==null)return '—';const n=Number(v);if(n>=1e9)return `${(n/1e9).toFixed(2)} Gbps`;if(n>=1e6)return `${(n/1e6).toFixed(1)} Mbps`;if(n>=1e3)return `${(n/1e3).toFixed(1)} Kbps`;return `${n.toFixed(0)} bps`;}
function statusPill(s){return `<span class="status ${esc(s)}"><i></i>${esc((s||'unknown').toUpperCase())}</span>`;}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}

function setPage(page){
  $$('.content').forEach(x=>x.classList.add('hidden'));
  $(`#page-${page}`)?.classList.remove('hidden');
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
  $('#page-title').textContent = page.replace(/-/g,' ').replace(/\b\w/g,x=>x.toUpperCase());
  if(page==='devices') renderDevices();
  if(page==='alerts') renderAlerts();
  if(page==='interfaces') renderInterfaces();
  if(page==='sites') loadSites();
  if(page==='map') renderMap();
  if(page==='wallboard') renderWallboard();
}

async function api(path, opts={}){const r=await fetch(path,{headers:{'Content-Type':'application/json'},...opts});if(!r.ok) throw new Error(await r.text());return r.json();}

async function loadDashboard(){
  const d=await api('/api/dashboard/summary');
  $('#kpi-total').textContent=d.total;$('#kpi-online').textContent=d.online;$('#kpi-offline').textContent=d.offline;$('#kpi-alerts').textContent=d.active_alerts;$('#kpi-critical').textContent=`${d.critical_alerts} critical`;$('#kpi-cameras').textContent=d.cameras_online;$('#kpi-camera-sub').textContent=`${d.cameras_total} total cameras`;$('#kpi-ifaces').textContent=d.interfaces_up;$('#kpi-iface-sub').textContent=`${d.interfaces_total} interfaces discovered`;
  $('#kpi-online-sub').textContent=`${d.health}% availability`;$('#health-value').textContent=`${d.health}%`;$('#status-total').textContent=d.total;$('#legend-online').textContent=d.online;$('#legend-offline').textContent=d.offline;$('#legend-warning').textContent=d.warning;
  const healthDeg=Math.round(d.health*3.6);$('#health-ring').style.background=`conic-gradient(var(--green) 0deg ${healthDeg}deg,#253149 ${healthDeg}deg 360deg)`;
  const total=Math.max(1,d.total), on=(d.online/total)*360, off=(d.offline/total)*360;$('#status-donut').style.background=`conic-gradient(var(--green) 0deg ${on}deg,var(--red) ${on}deg ${on+off}deg,var(--amber) ${on+off}deg 360deg)`;
  const devs=await api('/api/devices'); devicesCache=devs; renderDashDevices(devs.slice(0,8)); renderMap(); await loadRecentAlerts();
  renderActivity();
}

function renderDashDevices(devs){$('#dash-devices').innerHTML=devs.map(d=>`<tr data-device-id="${d.id}" class="device-row"><td><strong>${esc(d.name)}</strong></td><td>${esc(d.ip)}</td><td>${esc(d.vendor||'—')}</td><td>${statusPill(d.status)}</td><td>${d.cpu_percent==null?'—':d.cpu_percent+'%'}</td><td>${d.latency_ms==null?'—':d.latency_ms+' ms'}</td><td>${fmtAge(d.last_poll_at)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No devices configured.</td></tr>`; $$('#dash-devices .device-row').forEach(x=>x.onclick=()=>openDevice(x.dataset.deviceId));}
async function loadRecentAlerts(){const a=await api('/api/alerts?status=active&limit=8');$('#recent-alerts').innerHTML=a.map(x=>`<div class="activity"><i class="status-dot ${esc(x.severity)}"></i><div><h4>${esc(x.ip||x.device||'Device')} — ${esc(x.type)}</h4><p>${esc(x.message)}</p></div><time>${fmtAge(x.last_detected)}</time></div>`).join('')||'<div class="empty">No active alerts.</div>';}

function renderActivity(){const box=$('#activity-chart');if(!box)return;box.innerHTML='';const a=Array.from({length:28},(_,i)=>activity[i]||0);a.forEach(v=>{const b=document.createElement('div');b.className='mini-bar';b.style.height=`${8+Math.min(92,v*18)}%`;box.appendChild(b);});}

async function renderDevices(){let q=$('#device-search').value.trim();let st=$('#device-status-filter').value;const query=new URLSearchParams();if(q)query.set('q',q);if(st)query.set('status',st);const devs=await api('/api/devices?'+query.toString());devicesCache=devs;$('#device-count-label').textContent=`${devs.length} monitored devices`;const vendors=[...new Set(devs.map(d=>d.vendor).filter(Boolean))].sort();const sel=$('#device-vendor-filter');const keep=sel.value;sel.innerHTML='<option value="">All Vendors</option>'+vendors.map(v=>`<option>${esc(v)}</option>`).join('');sel.value=keep;$('#devices-table').innerHTML=devs.map(d=>`<tr data-device-id="${d.id}" class="device-row"><td><strong>${esc(d.name)}</strong></td><td>${esc(d.ip)}</td><td>${esc(d.vendor||'—')}</td><td>${esc(d.device_type||'—')}</td><td>${esc(d.site||'—')}</td><td>${statusPill(d.status)}</td><td>${d.cpu_percent==null?'—':d.cpu_percent+'%'}</td><td>${uptime(d.uptime_seconds)}</td><td>${fmtAge(d.last_poll_at)}</td><td><div class="row-actions"><button class="table-action" onclick="openEditDeviceModal(${d.id});event.stopPropagation()">Edit</button><button class="table-action danger" onclick="deleteDeviceQuick(${d.id});event.stopPropagation()">Delete</button></div></td></tr>`).join('')||'<tr><td colspan="9" class="empty">No matching devices.</td></tr>'; $$('#devices-table .device-row').forEach(x=>x.onclick=()=>openDevice(x.dataset.deviceId));}

async function renderAlerts(){const f=$('#alert-filter').value;const a=await api('/api/alerts?status='+f+'&limit=200');$('#alerts-table').innerHTML=a.map(x=>`<tr><td><span class="status ${x.severity==='critical'||x.severity==='major'?'offline':'warning'}"><i></i>${esc(x.severity.toUpperCase())}</span></td><td><strong>${esc(x.device||'—')}</strong><br><span class="muted">${esc(x.ip||'')}</span></td><td>${esc(x.type)}</td><td>${esc(x.message)}</td><td>${new Date(x.first_detected).toLocaleString()}</td><td>${esc(x.status)}</td><td>${x.status==='active'?`<button class="link-btn" onclick="ackAlert(${x.id})">Acknowledge</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No alerts.</td></tr>';}
async function ackAlert(id){await api(`/api/alerts/${id}/acknowledge`,{method:'POST'});toast('Alert acknowledged');renderAlerts();loadDashboard();}
window.ackAlert=ackAlert;

async function renderInterfaces(){const all=[];for(const d of devicesCache.slice(0,300)){try{const rows=await api(`/api/devices/${d.id}/interfaces`);rows.forEach(i=>all.push({...i,device:d}));}catch{}}$('#interfaces-table').innerHTML=all.map(i=>`<tr><td>${esc(i.device.name)}<br><span class="muted">${esc(i.device.ip)}</span></td><td>${esc(i.name)}</td><td>${i.oper_status===1?statusPill('online'):statusPill('offline')}</td><td>${i.speed_mbps?i.speed_mbps+' Mbps':'—'}</td><td>${bps(i.rx_bps)}</td><td>${bps(i.tx_bps)}</td><td>${Number(i.rx_errors||0)+Number(i.tx_errors||0)}</td><td>${Number(i.rx_discards||0)+Number(i.tx_discards||0)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No interfaces discovered yet.</td></tr>';}

async function loadSites(){const s=await api('/api/sites');$('#sites-grid').innerHTML=s.map(x=>`<div class="card site"><h3>${esc(x.name)}</h3><div class="site-count">${x.device_count}</div><div class="muted">monitored devices</div><div class="line"></div><div class="muted">${esc(x.address||'No address')}</div></div>`).join('')||'<div class="card site"><h3>No sites</h3><div class="muted">Create your first Smart City site.</div></div>';}

function renderMap(){const rows=(devicesCache.length?devicesCache:[]).slice(0,32);$('#map-grid').innerHTML=rows.map(d=>`<div class="map-node ${esc(d.status)}" onclick="openDevice(${d.id})"><strong>${esc(d.name)}</strong><span>${esc(d.ip)}</span><div class="line"></div><span>${esc(d.vendor||'Generic SNMP')}</span><span>${statusPill(d.status)}</span></div>`).join('')||'<div class="empty">No devices configured. Add devices to build the live map.</div>';}
window.openDevice=async function(id){const d=await api(`/api/devices/${id}`);const m=await api(`/api/devices/${id}/metrics?limit=40`);$('#detail-modal').classList.remove('hidden');$('#detail-content').innerHTML=`<div class="modal-head"><div><h2>${esc(d.name)}</h2><p>${esc(d.ip)} • ${esc(d.vendor||'Generic SNMP')} • ${esc(d.site||'No site')}</p></div><button class="close" data-close="detail-modal">×</button></div><div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)"><div class="card kpi"><div class="kpi-label">STATUS</div><div class="kpi-value" style="font-size:20px">${statusPill(d.status)}</div></div><div class="card kpi"><div class="kpi-label">CPU</div><div class="kpi-value">${d.cpu_percent==null?'—':d.cpu_percent+'%'}</div></div><div class="card kpi"><div class="kpi-label">LATENCY</div><div class="kpi-value">${d.latency_ms==null?'—':d.latency_ms+' ms'}</div></div><div class="card kpi"><div class="kpi-label">UPTIME</div><div class="kpi-value" style="font-size:20px">${uptime(d.uptime_seconds)}</div></div></div><div class="card" style="padding:18px;margin-top:15px"><div class="card-head"><div><h3>Live Metrics</h3><p>${d.monitoring_method.toUpperCase()} polling • Last poll ${fmtAge(d.last_poll_at)}</p></div></div><div class="mini-chart" id="detail-chart"></div></div><div class="card" style="padding:18px;margin-top:15px"><div class="card-head"><div><h3>Interfaces</h3><p>Discovered via IF-MIB</p></div></div><div class="table-wrap"><table><thead><tr><th>INTERFACE</th><th>STATUS</th><th>RX</th><th>TX</th><th>SPEED</th><th>ERRORS</th></tr></thead><tbody>${d.interfaces.map(i=>`<tr><td><strong>${esc(i.name)}</strong><br><span class="muted">${esc(i.description||'')}</span></td><td>${i.oper_status===1?statusPill('online'):statusPill('offline')}</td><td>${bps(i.rx_bps)}</td><td>${bps(i.tx_bps)}</td><td>${i.speed_mbps?i.speed_mbps+' Mbps':'—'}</td><td>${Number(i.rx_errors||0)+Number(i.tx_errors||0)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No interfaces discovered.</td></tr>'}</tbody></table></div></div>`;document.querySelector('[data-close="detail-modal"]').onclick=()=>$('#detail-modal').classList.add('hidden');const box=$('#detail-chart');const series=m.map(x=>Number(x.cpu||0));box.innerHTML=series.map(v=>{const b=document.createElement('div');b.className='mini-bar';b.style.height=`${8+Math.min(92,v)}%`;return b.outerHTML}).join('');};

function renderWallboard(){const d=devicesCache;$('#wallboard').innerHTML=`<div class="wb"><div class="muted">TOTAL DEVICES</div><div class="n">${d.length}</div></div><div class="wb"><div class="muted">ONLINE</div><div class="n good">${d.filter(x=>x.status==='online').length}</div></div><div class="wb"><div class="muted">OFFLINE</div><div class="n bad">${d.filter(x=>x.status==='offline').length}</div></div><div class="wb"><div class="muted">CCTV ONLINE</div><div class="n">${d.filter(x=>x.device_type==='Camera'&&x.status==='online').length}</div></div><div class="wb" style="grid-column:1/-1"><div class="muted">TOP OFFLINE DEVICES</div>${d.filter(x=>x.status==='offline').slice(0,8).map(x=>`<div style="padding:10px 0;border-bottom:1px solid #222937">🔴 ${esc(x.name)} <span class="muted">${esc(x.ip)}</span></div>`).join('')||'<div class="muted" style="padding-top:12px">No offline devices.</div>'}</div>`;}


function resetDeviceModal(){
  const form=$('#device-form');
  form.reset();
  form.elements.device_id.value='';
  form.elements.poll_interval.value=10;
  $('#device-modal-title').textContent='Add Device';
  $('#device-modal-subtitle').textContent='Configure SNMP v2c or ICMP fallback.';
  $('#save-device-btn').textContent='Save Device';
  $('#delete-device-btn').classList.add('hidden');
  $('#snmp-result').textContent='';
  $('#snmp-result').style.color='';
}
function openAddDeviceModal(){
  resetDeviceModal();
  $('#device-modal').classList.remove('hidden');
}
async function openEditDeviceModal(id){
  try{
    const d=await api('/api/devices/'+id);
    resetDeviceModal();
    const form=$('#device-form');
    form.elements.device_id.value=d.id;
    form.elements.name.value=d.name||'';
    form.elements.ip.value=d.ip||'';
    form.elements.hostname.value=d.hostname||'';
    form.elements.vendor.value=d.vendor||'';
    form.elements.model.value=d.model||'';
    form.elements.device_type.value=d.device_type||'Network Device';
    form.elements.site_id.value=d.site_id||'';
    form.elements.snmp_version.value=d.snmp_version||'2c';
    form.elements.community.value='';
    form.elements.poll_interval.value=d.poll_interval||10;
    $('#device-modal-title').textContent='Edit Device';
    $('#device-modal-subtitle').textContent='Update device settings. Leave Community blank to keep the existing credential.';
    $('#save-device-btn').textContent='Update Device';
    $('#delete-device-btn').classList.remove('hidden');
    $('#device-modal').classList.remove('hidden');
  }catch(err){
    console.error(err);
    toast('Failed to load device: '+(err.message||'check API'));
  }
}
async function saveDeviceForm(e){
  e.preventDefault();
  const f=new FormData(e.target);
  const id=f.get('device_id');
  const payload={
    name:f.get('name'),
    ip:f.get('ip'),
    hostname:f.get('hostname')||null,
    vendor:f.get('vendor')||null,
    model:f.get('model')||null,
    device_type:f.get('device_type'),
    site_id:f.get('site_id')?Number(f.get('site_id')):null,
    snmp_version:f.get('snmp_version'),
    community:f.get('community')||null,
    poll_interval:Number(f.get('poll_interval')||10)
  };
  try{
    if(id){
      await api('/api/devices/'+id,{method:'PUT',body:JSON.stringify(payload)});
      toast('Device updated');
    }else{
      await api('/api/devices',{method:'POST',body:JSON.stringify(payload)});
      toast('Device added — scheduled polling will use the configured interval');
    }
    $('#device-modal').classList.add('hidden');
    await loadDashboard();
    await renderDevices();
  }catch(err){
    console.error(err);
    const msg=String(err.message||'').includes('409')?'Another device already uses that IP':'Failed to save device';
    toast(msg);
  }
}
async function deleteCurrentDevice(){
  const id=$('#device-form').elements.device_id.value;
  if(!id)return;
  const name=$('#device-form').elements.name.value;
  if(!confirm('Delete "'+name+'"? This removes the device and its monitoring data.'))return;
  try{
    await api('/api/devices/'+id,{method:'DELETE'});
    $('#device-modal').classList.add('hidden');
    toast('Device deleted');
    await loadDashboard();
    await renderDevices();
  }catch(err){
    console.error(err);
    toast('Failed to delete device');
  }
}

async function testSNMP(){const f=new FormData($('#device-form'));const result=$('#snmp-result');result.textContent='Testing...';result.style.color='var(--muted)';try{const r=await api('/api/snmp/test',{method:'POST',body:JSON.stringify({ip:f.get('ip'),community:f.get('community')||'public',port:161,timeout:5})});const parts=[];if(r.profile)parts.push(r.profile);if(r.model)parts.push(r.model);if(r.firmware)parts.push(r.firmware);if(r.message)parts.push(r.message);result.textContent=r.ok?('SNMP OK — '+parts.join(' • ')):(r.message||r.error||'SNMP test failed');result.style.color=r.ok?'var(--green)':'var(--red)';}catch(err){result.textContent='Test error';result.style.color='var(--red)';}}

async function addSite(){const name=prompt('Site name');if(!name)return;try{await api('/api/sites',{method:'POST',body:JSON.stringify({name})});toast('Site created');loadSites();}catch{toast('Failed to create site');}}

function connectWS(){const proto=location.protocol==='https:'?'wss':'ws';const ws=new WebSocket(`${proto}://${location.host}/ws/live`);ws.onopen=()=>{$('#ws-dot').classList.add('ok');$('#ws-label').textContent='LIVE';};ws.onclose=()=>{ $('#ws-dot').classList.remove('ok');$('#ws-label').textContent='RECONNECTING';setTimeout(connectWS,2000);};ws.onmessage=(e)=>{const msg=JSON.parse(e.data);if(msg.event==='device.updated'){activity.push(1);activity=activity.slice(-28);renderActivity();loadDashboard();if(!$('#page-devices').classList.contains('hidden'))renderDevices();}};setInterval(()=>{if(ws.readyState===1)ws.send('ping')},15000);}

$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
$$('[data-page-link]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.pageLink)));
$('#refresh-btn').onclick=()=>loadDashboard().catch(console.error);
$('#device-search').oninput=()=>renderDevices();$('#device-status-filter').onchange=()=>renderDevices();$('#alert-filter').onchange=()=>renderAlerts();
$('#add-device-btn').onclick=openAddDeviceModal;$('#add-site-btn').onclick=addSite;$('#device-form').onsubmit=saveDeviceForm;$('#test-snmp').onclick=testSNMP;$('#delete-device-btn').onclick=deleteCurrentDevice;
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).classList.add('hidden')));
$('#global-search').onkeydown=(e)=>{if(e.key==='Enter'){setPage('devices');$('#device-search').value=e.target.value;renderDevices();}};

loadDashboard().catch(err=>{console.error(err);toast('Backend is starting — retrying');setTimeout(()=>loadDashboard().catch(console.error),2500)});connectWS();

async function deleteDeviceQuick(id){
  const d=devicesCache.find(x=>x.id===Number(id));
  if(!confirm('Delete "'+(d?.name||'device')+'"? This removes the device and its monitoring data.'))return;
  try{
    await api('/api/devices/'+id,{method:'DELETE'});
    toast('Device deleted');
    await loadDashboard();
    await renderDevices();
  }catch(err){
    console.error(err);
    toast('Failed to delete device');
  }
}
window.openEditDeviceModal=openEditDeviceModal;
window.deleteDeviceQuick=deleteDeviceQuick;
