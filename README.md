# Smart City NMS

An independent Smart City Network Monitoring System for a Network Operations Center (NOC). It uses direct **SNMP v2c** polling for live device/interface telemetry with **ICMP fallback** when SNMP is unavailable. The UI is a dark, high-density NOC dashboard based on the visual direction of the reference screenshots.

## Current capabilities

- Live dashboard with device availability, alerts, cameras and interfaces
- Direct SNMP v2c polling (no LibreNMS dependency)
- ICMP fallback when SNMP fails
- Basic vendor detection from `sysDescr` / `sysObjectID`
- Standard system telemetry: sysName, sysDescr, sysObjectID, sysUpTime
- IF-MIB interface discovery
- Interface admin/oper status, high-capacity counters, speed, errors and discards
- RX/TX bitrate calculated from SNMP counter deltas
- Device and metric history in SQLite or PostgreSQL
- WebSocket live updates
- Alert engine for device-down and best-effort high-CPU/high-memory hooks
- Sites and Smart City/CCTV device classification
- NOC wallboard view
- Docker deployment for Ubuntu or Docker Desktop on Windows

## Important monitoring behavior

This release intentionally **does not fabricate telemetry**. Empty installations show zero devices and `—` for unsupported values. CPU, memory, temperature, fan and power are collected only when the target exposes compatible MIBs; vendor-specific OID profiles are the next enhancement layer for deeper MikroTik, Cisco, Fortinet, Hikvision, Axis and TP-Link telemetry.

The browser never talks SNMP directly. The backend owns the polling engine and pushes state changes over WebSocket.

## Quick install with Docker Desktop (Windows)

1. Install Docker Desktop and make sure Docker Engine is running.
2. Open PowerShell in the repository folder.
3. Run:

```powershell
.start.ps1
```

Open: `http://localhost:8080`

## Ubuntu / Linux

```bash
./start.sh
```

Open: `http://SERVER-IP:8080`

## Configuration

For non-Docker execution, copy `.env.example` to `.env` and review:

```text
DATABASE_URL=sqlite:///./data/smartcity_nms.db
POLL_CONCURRENCY=32
SNMP_TIMEOUT=1.5
SNMP_RETRIES=1
CREDENTIAL_SECRET=replace-with-a-long-random-secret
```

Docker Compose uses PostgreSQL automatically.

## Adding a device

Go to **Devices → Add Device** and enter:

- Name
- IP address
- Device type
- SNMP v2c community
- Poll interval (5 seconds minimum)

Use **Test SNMP** before saving.

If you save a device without an SNMP community, the engine falls back to ICMP monitoring.

## Recommended Smart City deployment pattern

Run the NMS on a Linux VM/server with reachability to:

- core routers and switches
- distribution/access switches
- firewalls
- PoE switches
- cameras/NVRs
- air-quality and IoT gateways
- servers and virtual hosts

Use a dedicated NMS management IP/VLAN and restrict SNMP access to the NMS host.

## Next development layer

- SNMPv3 support
- Vendor OID profiles (MikroTik, Cisco, FortiGate, Hikvision, Axis, TP-Link)
- Temperature/fan/PSU sensor discovery from ENTITY-SENSOR-MIB
- Vendor-specific CPU/memory telemetry
- Dependency-aware root cause analysis
- Interactive map with real topology links
- Telegram/n8n alert integrations
- Maintenance windows
- PDF/CSV reporting
- Role-based access control and audit logs
- LibreNMS importer for existing device inventories
