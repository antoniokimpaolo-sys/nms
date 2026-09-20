from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import current_user, get_db
from ..models import Device, Interface, MetricSample

router = APIRouter(prefix="/interfaces", tags=["interfaces"])


class InterfaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    if_index: int
    name: str | None = None
    description: str | None = None
    if_type: str | None = None
    speed_bps: float | None = None
    high_speed_mbps: float | None = None
    admin_status: str | None = None
    oper_status: str | None = None
    mac_address: str | None = None
    in_bps: float | None = None
    out_bps: float | None = None
    utilization_pct: float | None = None
    monitored: bool
    role: str
    last_polled: datetime | None = None


class InterfaceUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(OTHER|WAN|LAN|UPLINK|CAMERA|MANAGEMENT)$")
    monitored: bool | None = None


class MetricOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    timestamp: datetime
    metric_name: str
    value: float
    unit: str | None = None


@router.get("", response_model=list[InterfaceOut])
async def list_interfaces(
    device_id: int | None = Query(default=None),
    role: str | None = Query(default=None),
    status: str | None = Query(default=None),
    monitored: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(current_user),
):
    query = select(Interface).order_by(Interface.device_id, Interface.if_index)

    if device_id is not None:
        query = query.where(Interface.device_id == device_id)
    if role:
        query = query.where(Interface.role == role)
    if monitored is not None:
        query = query.where(Interface.monitored == monitored)
    if status:
        query = query.where(Interface.oper_status == status)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{interface_id}", response_model=InterfaceOut)
async def get_interface(
    interface_id: int,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(current_user),
):
    row = await db.get(Interface, interface_id)
    if not row:
        raise HTTPException(status_code=404, detail="Interface not found")
    return row


@router.put("/{interface_id}", response_model=InterfaceOut)
async def update_interface(
    interface_id: int,
    body: InterfaceUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(current_user),
):
    row = await db.get(Interface, interface_id)
    if not row:
        raise HTTPException(status_code=404, detail="Interface not found")

    if body.role is not None:
        row.role = body.role
    if body.monitored is not None:
        row.monitored = body.monitored

    await db.commit()
    await db.refresh(row)
    return row


@router.get("/{interface_id}/metrics", response_model=list[MetricOut])
async def get_interface_metrics(
    interface_id: int,
    minutes: int = Query(default=15, ge=1, le=1440),
    limit: int = Query(default=300, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(current_user),
):
    row = await db.get(Interface, interface_id)
    if not row:
        raise HTTPException(status_code=404, detail="Interface not found")

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    query = (
        select(MetricSample)
        .where(
            MetricSample.interface_id == interface_id,
            MetricSample.timestamp >= since,
            MetricSample.metric_name.in_(
                ["interface_in_bps", "interface_out_bps", "interface_utilization"]
            ),
        )
        .order_by(MetricSample.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    rows = list(result.scalars().all())
    rows.reverse()
    return rows
