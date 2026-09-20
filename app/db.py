import json
import os
from datetime import datetime, timezone
from typing import Generator

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./smartcity_nms.db")
    if url.startswith("sqlite:///"):
        path = url.replace("sqlite:///", "", 1)
        if not path.startswith("/"):
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    return url


DB_URL = database_url()
connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}
engine = create_engine(DB_URL, future=True, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    devices: Mapped[list["Device"]] = relationship(back_populates="site")


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    ip: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hostname: Mapped[str | None] = mapped_column(String(180), nullable=True)
    vendor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model: Mapped[str | None] = mapped_column(String(180), nullable=True)
    device_type: Mapped[str] = mapped_column(String(60), default="Network Device")
    os: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="unknown", index=True)
    monitoring_method: Mapped[str] = mapped_column(String(20), default="snmp")
    snmp_version: Mapped[str | None] = mapped_column(String(10), nullable=True)
    snmp_community: Mapped[str | None] = mapped_column(Text, nullable=True)
    snmp_username: Mapped[str | None] = mapped_column(Text, nullable=True)
    snmp_auth_protocol: Mapped[str | None] = mapped_column(String(20), nullable=True)
    snmp_auth_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    snmp_priv_protocol: Mapped[str | None] = mapped_column(String(20), nullable=True)
    snmp_priv_password: Mapped[str | None] = mapped_column(Text, nullable=True)
    poll_interval: Mapped[int] = mapped_column(Integer, default=10)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss: Mapped[float | None] = mapped_column(Float, nullable=True)
    uptime_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"), nullable=True, index=True)
    site: Mapped[Site | None] = relationship(back_populates="devices")
    interfaces: Mapped[list["Interface"]] = relationship(back_populates="device", cascade="all, delete-orphan")


class Interface(Base):
    __tablename__ = "interfaces"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    if_index: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(180), default="unknown")
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    admin_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    oper_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_mbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    rx_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    tx_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    rx_errors: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tx_errors: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rx_discards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tx_discards: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_rx_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_tx_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_counter_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    device: Mapped[Device] = relationship(back_populates="interfaces")


class MetricSample(Base):
    __tablename__ = "metric_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    cpu_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss: Mapped[float | None] = mapped_column(Float, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    alert_type: Mapped[str] = mapped_column(String(80), index=True)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    first_detected: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_detected: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def json_safe(obj) -> str:
    return json.dumps(obj, default=str)
