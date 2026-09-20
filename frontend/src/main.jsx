import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = '/api';

const h = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

function formatRate(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '—';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function formatSpeed(bits) {
  const n = Number(bits || 0);
  if (!Number.isFinite(n) || n <= 0) return 'N/A';
  return formatRate(n);
}

function interfaceStatus(i) {
  if (String(i.admin_status) === '2') return 'ADMIN DOWN';
  if (String(i.oper_status) === '1') return 'UP';
  if (String(i.oper_status) === '2') return 'DOWN';
  return 'UNKNOWN';
}

function utilizationText(i) {
  if (i.utilization_pct == null || !Number.isFinite(Number(i.utilization_pct))) return 'N/A';
  return `${Number(i.utilization_pct).toFixed(1)}%`;
}

function utilizationClass(i) {
  const u = Number(i.utilization_pct);
  if (!Number.isFinite(u)) return 'muted';
  if (u >= 90) return 'error';
  if (u >= 70) return 'warning';
  return '';
}

function Sparkline({ values = [], label }) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return <div className="muted">No historical data available.</div>;
  const width = 640;
  const height = 160;
  const pad = 8;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const points = nums.map((v, idx) => {
    const x = pad + (idx / Math.max(nums.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div>
      <div className="muted" style={{ marginBottom: 6 }}>{label} · min {formatRate(min)} · max {formatRate(max)}</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="160" role="img" aria-label={label}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [view, setView] = useState('dashboard');
  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        fetch(API + '/dashboard/summary', { headers: h(token) }),
        fetch(API + '/devices', { headers: h(token) }),
      ]);
      if (s.ok) setSummary(await s.json());
      if (d.ok) setDevices(await d.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = () => load();
    return () => ws.close();
  }, [token]);

  if (!token) return <Login onLogin={(t) => { localStorage.setItem('token', t); setToken(t); }} />;

  return (
    <div className="app">
      <aside>
        <div className="brand">SC3 NMS</div>
        <button onClick={() => setView('dashboard')}>Dashboard</button>
        <button onClick={() => setView('devices')}>Devices</button>
        <button onClick={() => setView('interfaces')}>Interfaces</button>
        <button onClick={() => setView('traffic')}>Traffic</button>
        <button onClick={() => setView('wan')}>WAN</button>
        <button onClick={() => setView('alerts')}>Alerts</button>
        <button onClick={() => setView('about')}>Deployment</button>
        <div className="spacer" />
        <button onClick={() => { localStorage.removeItem('token'); setToken(''); }}>Logout</button>
      </aside>

      <main>
        <header>
          <div>
            <h1>
              {view === 'dashboard' ? 'Network Operations Center'
                : view === 'devices' ? 'Devices'
                : view === 'interfaces' ? 'Interfaces'
                : view === 'traffic' ? 'Live Traffic'
                : view === 'wan' ? 'WAN'
                : view === 'alerts' ? 'Alerts'
                : 'Deployment'}
            </h1>
            <span className="muted">Standalone on-premise Smart City NMS</span>
          </div>
          <button className="ghost" onClick={load}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </header>

        {view === 'dashboard' && <Dashboard summary={summary} devices={devices} />}
        {view === 'devices' && <Devices devices={devices} token={token} refresh={load} />}
        {view === 'interfaces' && <InterfacesPage devices={devices} token={token} />}
        {view === 'traffic' && <TrafficPage devices={devices} token={token} />}
        {view === 'wan' && <WanComingSoon />}
        {view === 'alerts' && <Alerts token={token} />}
        {view === 'about' && <About />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [e, setE] = useState('');
  const submit = async (ev) => {
    ev.preventDefault();
    const r = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    const j = await r.json();
    if (!r.ok) return setE(j.detail || 'Login failed');
    onLogin(j.access_token);
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>SC3 NMS</h1>
        <p className="muted">Smart City Network Monitoring System</p>
        <input placeholder="Username" value={u} onChange={(e) => setU(e.target.value)} />
        <input placeholder="Password" type="password" value={p} onChange={(e) => setP(e.target.value)} />
        <button>Sign in</button>
        {e && <div className="error">{e}</div>}
      </form>
    </div>
  );
}

function Dashboard({ summary, devices }) {
  return (
    <section>
      <div className="grid cards">
        {[
          ['Devices', summary?.devices?.total ?? 0],
          ['Online', summary?.devices?.online ?? 0],
          ['Offline', summary?.devices?.offline ?? 0],
          ['Warnings', summary?.devices?.warning ?? 0],
          ['Interfaces', summary?.interfaces ?? 0],
          ['Open Alerts', summary?.open_alerts ?? 0],
        ].map(([k, v]) => (
          <div className="card stat" key={k}><span>{k}</span><b>{v}</b></div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Device Health</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>IP</th><th>Type</th><th>Brand</th><th>Status</th><th>Latency</th><th>Last Seen</th></tr></thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.ip_address}</td>
                  <td>{d.device_type}</td>
                  <td>{d.detected_brand || d.brand || 'Unknown'}</td>
                  <td><Status s={d.status} /></td>
                  <td>{d.latency_ms != null ? `${Number(d.latency_ms).toFixed(1)} ms` : '—'}</td>
                  <td>{d.last_seen ? new Date(d.last_seen).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Status({ s }) {
  return <span className={`status ${String(s).toLowerCase().replaceAll(' ', '-')}`}>{s}</span>;
}

function Devices({ devices, token, refresh }) {
  const [form, setForm] = useState({
    name: '', ip_address: '', device_type: 'OTHER', monitoring_method: 'AUTO', criticality: 'MEDIUM', poll_interval: 30,
  });
  const [msg, setMsg] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const r = await fetch(API + '/devices', {
      method: 'POST',
      headers: { ...h(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const j = await r.json();
    if (!r.ok) return setMsg(j.detail || 'Failed');
    setMsg('Device added');
    setForm({ ...form, name: '', ip_address: '' });
    refresh();
  };
  return (
    <section>
      <div className="grid two">
        <form className="card" onSubmit={save}>
          <div className="card-title">Add Device</div>
          <input placeholder="Device name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input placeholder="IP address" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} />
          <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })}>
            {['CAMERA', 'SWITCH', 'ROUTER', 'FIREWALL', 'NVR', 'ACCESS_POINT', 'SERVER', 'UPS', 'OTHER'].map((x) => <option key={x}>{x}</option>)}
          </select>
          <select value={form.monitoring_method} onChange={(e) => setForm({ ...form, monitoring_method: e.target.value })}>
            <option>AUTO</option><option>ICMP</option><option>SNMP</option>
          </select>
          <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })}>
            <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
          </select>
          <input type="number" min="5" max="3600" value={form.poll_interval} onChange={(e) => setForm({ ...form, poll_interval: Number(e.target.value) })} />
          <button>Add Device</button>
          {msg && <div className="muted">{msg}</div>}
        </form>

        <div className="card">
          <div className="card-title">Current Inventory</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>IP</th><th>Status</th><th>Detected</th><th>SNMP</th></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>{d.ip_address}</td>
                    <td><Status s={d.status} /></td>
                    <td>{d.detected_brand || 'Generic'}</td>
                    <td>{d.snmp_last_ok ? 'OK' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function InterfacesPage({ devices, token }) {
  const [deviceId, setDeviceId] = useState(devices.find((d) => d.id && d.snmp_last_ok)?.id ?? devices[0]?.id ?? '');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadInterfaces = async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const r = await fetch(API + `/interfaces?device_id=${deviceId}`, { headers: h(token) });
      if (r.ok) setItems(await r.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInterfaces(); }, [deviceId, token]);
  useEffect(() => {
    const t = setInterval(loadInterfaces, 5000);
    return () => clearInterval(t);
  }, [deviceId, token]);

  useEffect(() => {
    if (!selected) { setMetrics([]); return; }
    let cancelled = false;
    const loadMetrics = async () => {
      const r = await fetch(API + `/interfaces/${selected.id}/metrics?minutes=15&limit=300`, { headers: h(token) });
      if (r.ok && !cancelled) setMetrics(await r.json());
    };
    loadMetrics();
    const t = setInterval(loadMetrics, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [selected?.id, token]);

  const filtered = useMemo(() => items.filter((i) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || `${i.name || ''} ${i.description || ''} ${i.if_index}`.toLowerCase().includes(q);
    const matchesStatus = !status || interfaceStatus(i) === status;
    const matchesRole = !role || i.role === role;
    return matchesSearch && matchesStatus && matchesRole;
  }), [items, search, status, role]);

  const up = items.filter((i) => interfaceStatus(i) === 'UP').length;
  const down = items.filter((i) => interfaceStatus(i) === 'DOWN').length;
  const wan = items.filter((i) => i.role === 'WAN').length;

  const selectDevice = devices.find((d) => String(d.id) === String(deviceId));

  return (
    <section>
      <div className="grid cards">
        <div className="card stat"><span>Interfaces</span><b>{items.length}</b></div>
        <div className="card stat"><span>UP</span><b>{up}</b></div>
        <div className="card stat"><span>DOWN</span><b>{down}</b></div>
        <div className="card stat"><span>WAN</span><b>{wan}</b></div>
      </div>

      <div className="card">
        <div className="card-title">Interface Inventory</div>
        <div className="grid two">
          <select value={deviceId} onChange={(e) => { setDeviceId(e.target.value); setSelected(null); }}>
            {devices.map((d) => <option value={d.id} key={d.id}>{d.name} — {d.ip_address}</option>)}
          </select>
          <input placeholder="Search interface / description / index" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option>UP</option><option>DOWN</option><option>ADMIN DOWN</option><option>UNKNOWN</option>
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All Roles</option>
            <option>WAN</option><option>LAN</option><option>UPLINK</option><option>CAMERA</option><option>MANAGEMENT</option><option>OTHER</option>
          </select>
        </div>

        <div className="muted" style={{ margin: '10px 0' }}>
          {selectDevice ? `${selectDevice.name} · ${selectDevice.ip_address}` : 'No device selected'} · {loading ? 'Refreshing…' : 'Live data refreshes every 5 seconds'}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Interface</th><th>IfIndex</th><th>Status</th><th>Speed</th><th>RX</th><th>TX</th><th>Utilization</th><th>Role</th><th>Monitored</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} onClick={() => setSelected(i)} style={{ cursor: 'pointer' }}>
                  <td><strong>{i.name || `ifIndex ${i.if_index}`}</strong><div className="muted">{i.description || ''}</div></td>
                  <td>{i.if_index}</td>
                  <td><Status s={interfaceStatus(i)} /></td>
                  <td>{formatSpeed(i.speed_bps || (Number(i.high_speed_mbps || 0) * 1e6))}</td>
                  <td>{formatRate(i.in_bps)}</td>
                  <td>{formatRate(i.out_bps)}</td>
                  <td className={utilizationClass(i)}>
                    {utilizationText(i)}
                    {Number(i.utilization_pct) > 100 ? <div className="muted">over capacity</div> : null}
                  </td>
                  <td>{i.role}</td>
                  <td>{i.monitored ? 'YES' : 'NO'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <InterfaceDetail item={selected} metrics={metrics} token={token} onUpdated={(next) => {
        setSelected(next);
        setItems((prev) => prev.map((x) => x.id === next.id ? next : x));
      }} />}
    </section>
  );
}

function InterfaceDetail({ item, metrics, token, onUpdated }) {
  const deviceSeries = metrics.filter((m) => m.metric_name === 'interface_in_bps');
  const outSeries = metrics.filter((m) => m.metric_name === 'interface_out_bps');
  const utilSeries = metrics.filter((m) => m.metric_name === 'interface_utilization');
  const [saving, setSaving] = useState(false);

  const update = async (patch) => {
    setSaving(true);
    try {
      const r = await fetch(API + `/interfaces/${item.id}`, {
        method: 'PUT',
        headers: { ...h(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) onUpdated(await r.json());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">{item.name || `Interface ${item.if_index}`} — Live Detail</div>
      <div className="grid cards">
        <div className="card stat"><span>Status</span><b>{interfaceStatus(item)}</b></div>
        <div className="card stat"><span>RX</span><b>{formatRate(item.in_bps)}</b></div>
        <div className="card stat"><span>TX</span><b>{formatRate(item.out_bps)}</b></div>
        <div className="card stat"><span>Utilization</span><b>{utilizationText(item)}</b></div>
      </div>

      <div className="grid two">
        <div>
          <div className="muted">Description</div>
          <div>{item.description || '—'}</div>
          <div className="muted" style={{ marginTop: 10 }}>IfIndex</div>
          <div>{item.if_index}</div>
          <div className="muted" style={{ marginTop: 10 }}>Speed</div>
          <div>{formatSpeed(item.speed_bps || (Number(item.high_speed_mbps || 0) * 1e6))}</div>
          <div className="muted" style={{ marginTop: 10 }}>Last Polled</div>
          <div>{item.last_polled ? new Date(item.last_polled).toLocaleString() : '—'}</div>
        </div>

        <div>
          <label className="muted">Role</label>
          <select value={item.role} onChange={(e) => update({ role: e.target.value })} disabled={saving}>
            <option>OTHER</option><option>WAN</option><option>LAN</option><option>UPLINK</option><option>CAMERA</option><option>MANAGEMENT</option>
          </select>
          <button onClick={() => update({ monitored: !item.monitored })} disabled={saving}>
            {item.monitored ? 'Disable Monitoring' : 'Enable Monitoring'}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <Sparkline label="RX" values={deviceSeries.map((x) => x.value)} />
        <Sparkline label="TX" values={outSeries.map((x) => x.value)} />
        <Sparkline label="Utilization" values={utilSeries.map((x) => x.value)} />
      </div>
    </div>
  );
}

function TrafficPage({ devices, token }) {
  const [deviceId, setDeviceId] = useState(devices.find((d) => d.id && d.snmp_last_ok)?.id ?? devices[0]?.id ?? '');
  const [items, setItems] = useState([]);

  const load = async () => {
    if (!deviceId) return;
    const r = await fetch(API + `/interfaces?device_id=${deviceId}`, { headers: h(token) });
    if (r.ok) setItems(await r.json());
  };

  useEffect(() => { load(); }, [deviceId, token]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [deviceId, token]);

  const active = [...items].sort((a, b) => Math.max(Number(b.in_bps || 0), Number(b.out_bps || 0)) - Math.max(Number(a.in_bps || 0), Number(a.out_bps || 0)));

  return (
    <section>
      <div className="card">
        <div className="card-title">Live Traffic</div>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.map((d) => <option value={d.id} key={d.id}>{d.name} — {d.ip_address}</option>)}
        </select>
        <div className="muted" style={{ margin: '10px 0' }}>Traffic is collected by the NMS worker through SNMP; the browser reads the local API.</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Interface</th><th>Role</th><th>Status</th><th>RX</th><th>TX</th><th>Utilization</th></tr></thead>
            <tbody>
              {active.map((i) => (
                <tr key={i.id}>
                  <td>{i.name || `ifIndex ${i.if_index}`}</td>
                  <td>{i.role}</td>
                  <td><Status s={interfaceStatus(i)} /></td>
                  <td>{formatRate(i.in_bps)}</td>
                  <td>{formatRate(i.out_bps)}</td>
                  <td className={utilizationClass(i)}>{utilizationText(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function WanComingSoon() {
  return (
    <section>
      <div className="card">
        <div className="card-title">WAN Monitoring</div>
        <p className="muted">The WAN backend model is already present. The next UI milestone will bind actual WAN links to monitored interfaces and show ISP health and aggregate traffic.</p>
      </div>
    </section>
  );
}

function Alerts({ token }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    fetch(API + '/devices', { headers: h(token) })
      .then((r) => r.json())
      .then((ds) => Promise.all(ds.map((d) => fetch(API + `/devices/${d.id}/alerts`, { headers: h(token) }).then((r) => r.json()))))
      .then((a) => setItems(a.flat().sort((x, y) => new Date(y.started_at) - new Date(x.started_at))));
  }, [token]);

  return (
    <section>
      <div className="card">
        <div className="card-title">Alerts</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Severity</th><th>Message</th><th>Status</th><th>Started</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>{a.alert_type}</td>
                  <td><Status s={a.severity} /></td>
                  <td>{a.message}</td>
                  <td>{a.status}</td>
                  <td>{new Date(a.started_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section>
      <div className="card">
        <div className="card-title">On-Premise Deployment</div>
        <pre>{`Ubuntu Server
  └─ Docker Compose
      ├─ frontend (Nginx)
      ├─ backend (FastAPI)
      ├─ worker (ICMP/SNMP)
      ├─ postgres
      └─ redis

The worker performs monitoring independently of the browser.
Interface traffic is read from PostgreSQL-backed API data.
`}</pre>
      </div>
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
