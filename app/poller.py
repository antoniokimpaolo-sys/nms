import asyncio
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Callable, Awaitable

from sqlalchemy import select

from .crypto import decrypt
from .db import Alert, Device, Interface, MetricSample, SessionLocal, utcnow
from .snmp import SNMPClient, SNMPError, ping_host, safe_float, safe_int

LOG = logging.getLogger("smartcity-nms.poller")

SYS_OIDS = {
    "sysDescr": ".1.3.6.1.2.1.1.1.0",
    "sysObjectID": ".1.3.6.1.2.1.1.2.0",
    "sysUpTime": ".1.3.6.1.2.1.1.3.0",
    "sysName": ".1.3.6.1.2.1.1.5.0",
}
CPU_OID = ".1.3.6.1.2.1.25.3.3.1.2.1"

IF_NAME_BASE = ".1.3.6.1.2.1.31.1.1.1.1"
IF_DESC_BASE = ".1.3.6.1.2.1.2.2.1.2"
IF_ADMIN_BASE = ".1.3.6.1.2.1.2.2.1.7"
IF_OPER_BASE = ".1.3.6.1.2.1.2.2.1.8"
IF_HC_IN_BASE = ".1.3.6.1.2.1.31.1.1.1.6"
IF_HC_OUT_BASE = ".1.3.6.1.2.1.31.1.1.1.10"
IF_SPEED_BASE = ".1.3.6.1.2.1.31.1.1.1.15"
IF_IN_ERR_BASE = ".1.3.6.1.2.1.2.2.1.14"
IF_OUT_ERR_BASE = ".1.3.6.1.2.1.2.2.1.20"
IF_IN_DISC_BASE = ".1.3.6.1.2.1.2.2.1.13"
IF_OUT_DISC_BASE = ".1.3.6.1.2.1.2.2.1.19"

VENDOR_HINTS = [
    ("mikrotik", "MikroTik"), ("routeros", "MikroTik"), ("cisco", "Cisco"),
    ("fortigate", "Fortinet"), ("fortios", "Fortinet"), ("huawei", "Huawei"),
    ("hikvision", "Hikvision"), ("axis", "Axis"), ("tp-link", "TP-Link"),
    ("tplink", "TP-Link"), ("ubiquiti", "Ubiquiti"), ("juniper", "Juniper"),
    ("dell", "Dell"), ("hewlett", "HPE"), ("hp compaq", "HPE")
]


def _oid_with_index(base: str, idx: int) -> str:
    return f"{base}.{idx}"


def _parse_prefix_oid(oid: str, base: str) -> int | None:
    oid = oid.lstrip(".")
    prefix = base.lstrip(".").rstrip(".") + "."
    if not oid.startswith(prefix):
        return None
    tail = oid[len(prefix):]
    if "." in tail or not tail:
        return None
    try:
        return int(tail)
    except ValueError:
        return None


def detect_vendor(sys_descr: str | None, sys_object_id: str | None) -> str:
    text = f"{sys_descr or ''} {sys_object_id or ''}".lower()
    for needle, vendor in VENDOR_HINTS:
        if needle in text:
            return vendor
    return "Generic SNMP"


def detect_device_type(vendor: str, sys_descr: str | None) -> str:
    text = f"{vendor} {sys_descr or ''}".lower()
    if "camera" in text or vendor in {"Hikvision", "Axis"}:
        return "Camera"
    if "switch" in text:
        return "Switch"
    if "router" in text or vendor in {"MikroTik", "Cisco", "Juniper"}:
        return "Router / Network Device"
    if "firewall" in text or vendor == "Fortinet":
        return "Firewall"
    if "nvr" in text or "video recorder" in text:
        return "NVR"
    return "Network Device"


async def _get_system(client: SNMPClient):
    results = await client.get(list(SYS_OIDS.values()))
    d = {}
    for oid, value, _tag in results:
        norm = oid.lstrip(".")
        for k, expected in SYS_OIDS.items():
            if norm == expected.lstrip("."):
                d[k] = value
    return d


async def _discover_indexes(client: SNMPClient, base: str, limit: int = 512) -> list[int]:
    cursor = base
    found: list[int] = []
    for _ in range(limit):
        results = await client.getnext(cursor)
        if not results:
            break
        oid, value, _tag = results[0]
        idx = _parse_prefix_oid(oid, base)
        if idx is None:
            break
        found.append(idx)
        cursor = oid
        if value in ("endOfMibView", "noSuchObject", "noSuchInstance"):
            break
    return sorted(set(found))


async def _poll_interfaces(client: SNMPClient, db, device: Device, now: datetime) -> None:
    indexes = await _discover_indexes(client, IF_NAME_BASE)
    if not indexes:
        indexes = await _discover_indexes(client, IF_DESC_BASE)
    if not indexes:
        return

    existing = {i.if_index: i for i in db.scalars(select(Interface).where(Interface.device_id == device.id)).all()}
    for idx in indexes[:256]:
        oids = [
            _oid_with_index(IF_NAME_BASE, idx),
            _oid_with_index(IF_DESC_BASE, idx),
            _oid_with_index(IF_ADMIN_BASE, idx),
            _oid_with_index(IF_OPER_BASE, idx),
            _oid_with_index(IF_HC_IN_BASE, idx),
            _oid_with_index(IF_HC_OUT_BASE, idx),
            _oid_with_index(IF_SPEED_BASE, idx),
            _oid_with_index(IF_IN_ERR_BASE, idx),
            _oid_with_index(IF_OUT_ERR_BASE, idx),
            _oid_with_index(IF_IN_DISC_BASE, idx),
            _oid_with_index(IF_OUT_DISC_BASE, idx),
        ]
        try:
            vals = await client.get(oids)
        except SNMPError:
            continue
        mapping = {oid.lstrip("."): value for oid, value, _tag in vals}
        name = str(mapping.get(oids[0].lstrip(".")) or mapping.get(oids[1].lstrip(".")) or f"if{idx}")
        iface = existing.get(idx)
        if iface is None:
            iface = Interface(device_id=device.id, if_index=idx, name=name)
            db.add(iface)
            existing[idx] = iface
        iface.name = name
        iface.description = str(mapping.get(oids[1].lstrip(".")) or "")[:255] or None
        iface.admin_status = safe_int(mapping.get(oids[2].lstrip(".")))
        iface.oper_status = safe_int(mapping.get(oids[3].lstrip(".")))
        in_octets = safe_int(mapping.get(oids[4].lstrip(".")))
        out_octets = safe_int(mapping.get(oids[5].lstrip(".")))
        iface.speed_mbps = safe_float(mapping.get(oids[6].lstrip(".")))
        iface.rx_errors = safe_int(mapping.get(oids[7].lstrip(".")))
        iface.tx_errors = safe_int(mapping.get(oids[8].lstrip(".")))
        iface.rx_discards = safe_int(mapping.get(oids[9].lstrip(".")))
        iface.tx_discards = safe_int(mapping.get(oids[10].lstrip(".")))
        if iface.last_counter_at and iface.last_rx_octets is not None and in_octets is not None:
            dt = (now - iface.last_counter_at).total_seconds()
            if dt > 0 and in_octets >= iface.last_rx_octets:
                iface.rx_bps = round((in_octets - iface.last_rx_octets) * 8 / dt, 2)
            if dt > 0 and out_octets is not None and iface.last_tx_octets is not None and out_octets >= iface.last_tx_octets:
                iface.tx_bps = round((out_octets - iface.last_tx_octets) * 8 / dt, 2)
        iface.last_rx_octets = in_octets
        iface.last_tx_octets = out_octets
        iface.last_counter_at = now
        iface.updated_at = now


def _active_alert(db, device_id: int, alert_type: str):
    return db.scalars(
        select(Alert).where(
            Alert.device_id == device_id,
            Alert.alert_type == alert_type,
            Alert.status == "active"
        ).order_by(Alert.id.desc())
    ).first()


def _raise_alert(db, device: Device, severity: str, alert_type: str, message: str, now: datetime):
    alert = _active_alert(db, device.id, alert_type)
    if alert:
        alert.last_detected = now
        alert.message = message
        return
    db.add(Alert(
        device_id=device.id,
        severity=severity,
        alert_type=alert_type,
        message=message,
        first_detected=now,
        last_detected=now,
    ))


def _resolve_alert(db, device: Device, alert_type: str, now: datetime):
    alert = _active_alert(db, device.id, alert_type)
    if alert:
        alert.status = "resolved"
        alert.resolved_at = now
        alert.last_detected = now


async def poll_device(device_id: int, event_callback: Callable[[str, dict], Awaitable[None]], sem: asyncio.Semaphore):
    async with sem:
        db = SessionLocal()
        try:
            device = db.get(Device, device_id)
            if not device:
                return
            now = utcnow()
            device.last_poll_at = now
            success = False
            error = None

            community = decrypt(device.snmp_community)
            if device.snmp_version == "2c" and community:
                client = SNMPClient(
                    device.ip,
                    community,
                    timeout=float(os.getenv("SNMP_TIMEOUT", "1.5")),
                    retries=int(os.getenv("SNMP_RETRIES", "1")),
                )
                try:
                    system = await _get_system(client)
                    success = True
                    device.monitoring_method = "snmp"
                    descr = str(system.get("sysDescr") or "")
                    device.vendor = detect_vendor(descr, str(system.get("sysObjectID") or ""))
                    device.device_type = detect_device_type(device.vendor, descr)
                    device.os = descr[:120] or device.os
                    device.hostname = str(system.get("sysName") or device.hostname or device.ip)[:180]
                    uptime = safe_int(system.get("sysUpTime"))
                    device.uptime_seconds = int(uptime / 100) if uptime is not None else None
                    try:
                        metrics = await client.get([CPU_OID])
                        md = {oid.lstrip("."): val for oid, val, _ in metrics}
                        device.cpu_percent = safe_float(md.get(CPU_OID.lstrip(".")))
                    except Exception:
                        pass
                    await _poll_interfaces(client, db, device, now)
                except Exception as exc:
                    error = str(exc)

            if not success:
                ok, latency = await ping_host(device.ip)
                device.monitoring_method = "icmp"
                device.latency_ms = latency
                device.packet_loss = 0.0 if ok else 100.0
                if ok:
                    success = True
                    device.status = "online"
                    device.last_success_at = now
                    device.last_error = error
                    _resolve_alert(db, device, "DEVICE_DOWN", now)
                else:
                    device.status = "offline"
                    device.last_error = error or "ICMP unreachable"
                    _raise_alert(db, device, "critical", "DEVICE_DOWN", f"{device.name} ({device.ip}) is unreachable.", now)
            else:
                device.packet_loss = 0.0
                device.status = "online"
                device.last_success_at = now
                device.last_error = None
                _resolve_alert(db, device, "DEVICE_DOWN", now)

            if device.cpu_percent is not None:
                if device.cpu_percent >= 90:
                    _raise_alert(db, device, "major", "HIGH_CPU", f"CPU utilization is {device.cpu_percent:.1f}%.", now)
                else:
                    _resolve_alert(db, device, "HIGH_CPU", now)

            db.add(MetricSample(
                device_id=device.id,
                timestamp=now,
                cpu_percent=device.cpu_percent,
                memory_percent=device.memory_percent,
                temperature_c=device.temperature_c,
                latency_ms=device.latency_ms,
                packet_loss=device.packet_loss,
            ))
            db.commit()
            await event_callback("device.updated", {
                "device_id": device.id,
                "status": device.status,
                "last_poll_at": now.isoformat()
            })
        except Exception:
            LOG.exception("Polling failure for device %s", device_id)
            db.rollback()
        finally:
            db.close()


class PollScheduler:
    def __init__(self, event_callback: Callable[[str, dict], Awaitable[None]]):
        self.event_callback = event_callback
        self.sem = asyncio.Semaphore(int(os.getenv("POLL_CONCURRENCY", "32")))
        self.running = True
        self.last_run: dict[int, datetime] = defaultdict(lambda: datetime.min.replace(tzinfo=timezone.utc))
        self._tasks: set[asyncio.Task] = set()

    async def run(self):
        while self.running:
            try:
                db = SessionLocal()
                devices = db.scalars(select(Device)).all()
                db.close()
                now = utcnow()
                for d in devices:
                    last = self.last_run[d.id]
                    interval = max(5, int(d.poll_interval or 10))
                    if (now - last).total_seconds() >= interval:
                        self.last_run[d.id] = now
                        task = asyncio.create_task(poll_device(d.id, self.event_callback, self.sem))
                        self._tasks.add(task)
                        task.add_done_callback(self._tasks.discard)
            except Exception:
                LOG.exception("Poll scheduler iteration failed")
            await asyncio.sleep(1)

    async def stop(self):
        self.running = False
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
