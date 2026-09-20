import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from .crypto import encrypt
from .db import Alert, Device, Interface, MetricSample, SessionLocal, Site, get_db, init_db
from .poller import PollScheduler
from .snmp import SNMPClient, SNMPError

BASE = Path(__file__).resolve().parent


class Hub:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def add(self, ws: WebSocket):
        await ws.accept()
        self.clients.add(ws)

    def remove(self, ws: WebSocket):
        self.clients.discard(ws)

    async def broadcast(self, event: str, data: dict):
        payload = {"event": event, "data": data}
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.remove(ws)


hub = Hub()
poller: PollScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global poller
    init_db()
    poller = PollScheduler(hub.broadcast)
    task = asyncio.create_task(poller.run())
    yield
    await poller.stop()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Smart City NMS", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


class DeviceCreate(BaseModel):
    name: str
    ip: str
    hostname: str | None = None
    vendor: str | None = None
    model: str | None = None
    device_type: str = "Network Device"
    site_id: int | None = None
    snmp_version: str = "2c"
    community: str | None = None
    poll_interval: int = Field(default=10, ge=5, le=3600)


class SiteCreate(BaseModel):
    name: str
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class SNMPTest(BaseModel):
    ip: str
    community: str = "public"
    port: int = 161
    timeout: float = 1.5


@app.get("/")
def index():
    return FileResponse(BASE / "static" / "index.html")


@app.get("/health")
def health():
    return {"ok": True, "service": "Smart City NMS", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Device.id))) or 0
    online = db.scalar(select(func.count(Device.id)).where(Device.status == "online")) or 0
    offline = db.scalar(select(func.count(Device.id)).where(Device.status == "offline")) or 0
    warning = db.scalar(select(func.count(Device.id)).where(Device.status == "warning")) or 0
    critical = db.scalar(select(func.count(Alert.id)).where(Alert.status == "active", Alert.severity == "critical")) or 0
    active = db.scalar(select(func.count(Alert.id)).where(Alert.status == "active")) or 0
    cameras = db.scalar(select(func.count(Device.id)).where(Device.device_type == "Camera", Device.status == "online")) or 0
    camera_total = db.scalar(select(func.count(Device.id)).where(Device.device_type == "Camera")) or 0
    iface_up = db.scalar(select(func.count(Interface.id)).where(Interface.oper_status == 1)) or 0
    iface_total = db.scalar(select(func.count(Interface.id))) or 0
    health = round((online / total) * 100, 1) if total else 0
    return {
        "total": total,
        "online": online,
        "offline": offline,
        "warning": warning,
        "active_alerts": active,
        "critical_alerts": critical,
        "cameras_online": cameras,
        "cameras_total": camera_total,
        "interfaces_up": iface_up,
        "interfaces_total": iface_total,
        "health": health,
    }


@app.get("/api/devices")
def devices(status: str | None = None, site_id: int | None = None, q: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Device).order_by(Device.name)
    if status:
        stmt = stmt.where(Device.status == status)
    if site_id:
        stmt = stmt.where(Device.site_id == site_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where((Device.name.ilike(like)) | (Device.ip.ilike(like)) | (Device.vendor.ilike(like)))
    rows = db.scalars(stmt).all()
    return [_device_dict(d) for d in rows]


@app.post("/api/devices")
async def create_device(payload: DeviceCreate, db: Session = Depends(get_db)):
    if db.scalar(select(Device).where(Device.ip == payload.ip)):
        raise HTTPException(409, "Device IP already exists")
    d = Device(
        name=payload.name,
        ip=payload.ip,
        hostname=payload.hostname,
        vendor=payload.vendor,
        model=payload.model,
        device_type=payload.device_type,
        site_id=payload.site_id,
        snmp_version=payload.snmp_version,
        snmp_community=encrypt(payload.community),
        monitoring_method="snmp" if payload.community else "icmp",
        poll_interval=payload.poll_interval,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _device_dict(d)


@app.get("/api/devices/{device_id}")
def device_detail(device_id: int, db: Session = Depends(get_db)):
    d = db.get(Device, device_id)
    if not d:
        raise HTTPException(404, "Device not found")
    return _device_detail_dict(d, db)


@app.delete("/api/devices/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db)):
    d = db.get(Device, device_id)
    if not d:
        raise HTTPException(404, "Device not found")
    db.delete(d)
    db.commit()
    return {"ok": True}


@app.get("/api/devices/{device_id}/metrics")
def device_metrics(device_id: int, limit: int = 60, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MetricSample)
        .where(MetricSample.device_id == device_id)
        .order_by(desc(MetricSample.timestamp))
        .limit(min(limit, 500))
    ).all()
    return [
        {
            "timestamp": r.timestamp.isoformat(),
            "cpu": r.cpu_percent,
            "memory": r.memory_percent,
            "temperature": r.temperature_c,
            "latency": r.latency_ms,
            "loss": r.packet_loss,
        }
        for r in reversed(rows)
    ]


@app.get("/api/devices/{device_id}/interfaces")
def device_interfaces(device_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(select(Interface).where(Interface.device_id == device_id).order_by(Interface.if_index)).all()
    return [_interface_dict(i) for i in rows]


@app.get("/api/alerts")
def alerts(status: str = "active", limit: int = 50, db: Session = Depends(get_db)):
    stmt = (
        select(Alert, Device.name, Device.ip)
        .join(Device, Alert.device_id == Device.id, isouter=True)
        .order_by(desc(Alert.last_detected))
        .limit(min(limit, 200))
    )
    if status != "all":
        stmt = stmt.where(Alert.status == status)
    rows = db.execute(stmt).all()
    return [
        {
            "id": a.id,
            "device": name,
            "ip": ip,
            "severity": a.severity,
            "type": a.alert_type,
            "message": a.message,
            "status": a.status,
            "first_detected": a.first_detected.isoformat(),
            "last_detected": a.last_detected.isoformat(),
        }
        for a, name, ip in rows
    ]


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: int, db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if not a:
        raise HTTPException(404, "Alert not found")
    a.status = "acknowledged"
    db.commit()
    return {"ok": True}


@app.post("/api/sites")
def create_site(payload: SiteCreate, db: Session = Depends(get_db)):
    s = Site(name=payload.name, address=payload.address, latitude=payload.latitude, longitude=payload.longitude)
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "name": s.name, "address": s.address, "latitude": s.latitude, "longitude": s.longitude}


@app.get("/api/sites")
def sites(db: Session = Depends(get_db)):
    rows = db.scalars(select(Site).order_by(Site.name)).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "address": s.address,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "device_count": len(s.devices),
        }
        for s in rows
    ]


@app.post("/api/snmp/test")
async def test_snmp(payload: SNMPTest):
    try:
        client = SNMPClient(payload.ip, payload.community, payload.port, payload.timeout, retries=0)
        standard_oids = [
            ".1.3.6.1.2.1.1.1.0",
            ".1.3.6.1.2.1.1.2.0",
            ".1.3.6.1.2.1.1.3.0",
            ".1.3.6.1.2.1.1.5.0",
        ]
        hikvision_oids = [
            ".1.3.6.1.4.1.50001.1.1.0",
            ".1.3.6.1.4.1.50001.1.100.0",
            ".1.3.6.1.4.1.50001.1.102.0",
            ".1.3.6.1.4.1.50001.1.221.0",
            ".1.3.6.1.4.1.50001.1.230.0",
        ]
        standard = await client.get(standard_oids)
        usable_standard = any(v not in ("noSuchObject", "noSuchInstance", "endOfMibView", None) for _, v, _ in standard)
        if usable_standard:
            return {"ok": True, "profile": "SNMPv2-MIB", "message": "SNMP v2c response received.", "values": standard}
        hik = await client.get(hikvision_oids)
        usable_hik = any(v not in ("noSuchObject", "noSuchInstance", "endOfMibView", None) for _, v, _ in hik)
        return {
            "ok": usable_hik,
            "profile": "Hikvision MIB" if usable_hik else "Unknown",
            "message": "SNMP agent responded; Hikvision enterprise MIB detected." if usable_hik else "SNMP agent responded but none of the tested standard/Hikvision objects were available.",
            "standard_values": standard,
            "hikvision_values": hik,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await hub.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.remove(ws)
    except Exception:
        hub.remove(ws)


def _device_dict(d: Device):
    return {
        "id": d.id,
        "name": d.name,
        "ip": d.ip,
        "hostname": d.hostname,
        "vendor": d.vendor,
        "model": d.model,
        "device_type": d.device_type,
        "os": d.os,
        "status": d.status,
        "monitoring_method": d.monitoring_method,
        "site_id": d.site_id,
        "site": d.site.name if d.site else None,
        "uptime_seconds": d.uptime_seconds,
        "cpu_percent": d.cpu_percent,
        "memory_percent": d.memory_percent,
        "temperature_c": d.temperature_c,
        "latency_ms": d.latency_ms,
        "packet_loss": d.packet_loss,
        "last_poll_at": d.last_poll_at.isoformat() if d.last_poll_at else None,
        "last_success_at": d.last_success_at.isoformat() if d.last_success_at else None,
        "last_error": d.last_error,
    }


def _device_detail_dict(d: Device, db: Session):
    obj = _device_dict(d)
    obj["interfaces"] = [
        _interface_dict(i)
        for i in db.scalars(select(Interface).where(Interface.device_id == d.id).order_by(Interface.if_index)).all()
    ]
    return obj


def _interface_dict(i: Interface):
    return {
        "id": i.id,
        "if_index": i.if_index,
        "name": i.name,
        "description": i.description,
        "admin_status": i.admin_status,
        "oper_status": i.oper_status,
        "speed_mbps": i.speed_mbps,
        "rx_bps": i.rx_bps,
        "tx_bps": i.tx_bps,
        "rx_errors": i.rx_errors,
        "tx_errors": i.tx_errors,
        "rx_discards": i.rx_discards,
        "tx_discards": i.tx_discards,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }
