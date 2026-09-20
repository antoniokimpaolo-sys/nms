import asyncio
import ipaddress
import random
import socket
import time
from dataclasses import dataclass
from typing import Any


class SNMPError(Exception):
    pass


def _enc_len(n: int) -> bytes:
    if n < 128:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _tlv(tag: int, payload: bytes) -> bytes:
    return bytes([tag]) + _enc_len(len(payload)) + payload


def _enc_int(n: int) -> bytes:
    """Encode a BER INTEGER payload without signed-size overflow."""
    if n == 0:
        return b"\x00"

    if n > 0:
        length = max(1, (n.bit_length() + 7) // 8)
        raw = n.to_bytes(length, "big", signed=False)
        if raw[0] & 0x80:
            raw = b"\x00" + raw
        return raw

    length = max(1, ((-n).bit_length() + 8) // 8)
    while True:
        try:
            raw = n.to_bytes(length, "big", signed=True)
            if length > 1 and raw[0] == 0xFF and raw[1] & 0x80:
                length -= 1
                continue
            return raw
        except OverflowError:
            length += 1


def encode_oid(oid: str) -> bytes:
    parts = [int(x) for x in oid.strip(".").split(".") if x != ""]
    if len(parts) < 2:
        raise ValueError("Invalid OID")
    out = bytearray([40 * parts[0] + parts[1]])
    for subid in parts[2:]:
        if subid == 0:
            out.append(0)
            continue
        chunks = []
        while subid:
            chunks.append(subid & 0x7F)
            subid >>= 7
        for i, c in enumerate(reversed(chunks)):
            out.append(c | (0x80 if i < len(chunks) - 1 else 0))
    return bytes(out)


def decode_oid(data: bytes) -> str:
    if not data:
        return ""
    first = data[0]
    a, b = divmod(first, 40)
    if a > 2:
        a, b = 2, first - 80
    parts = [a, b]
    cur = 0
    for byte in data[1:]:
        cur = (cur << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(cur)
            cur = 0
    return ".".join(str(x) for x in parts)


def parse_tlv(buf: bytes, pos: int = 0):
    if pos >= len(buf):
        raise SNMPError("Unexpected end of BER data")
    tag = buf[pos]
    pos += 1
    first = buf[pos]
    pos += 1
    if first < 128:
        length = first
    else:
        count = first & 0x7F
        if count == 0 or pos + count > len(buf):
            raise SNMPError("Invalid BER length")
        length = int.from_bytes(buf[pos:pos + count], "big")
        pos += count
    end = pos + length
    if end > len(buf):
        raise SNMPError("BER length exceeds packet")
    return tag, buf[pos:end], end


def decode_value(tag: int, data: bytes) -> Any:
    if tag == 0x02:
        return int.from_bytes(data, "big", signed=True)
    if tag == 0x04:
        return data.decode("utf-8", errors="replace")
    if tag == 0x05:
        return None
    if tag == 0x06:
        return decode_oid(data)
    if tag in (0x41, 0x42, 0x43, 0x46):
        return int.from_bytes(data, "big", signed=False)
    if tag == 0x40:
        return ".".join(str(x) for x in data)
    if tag == 0x80:
        return "noSuchObject"
    if tag == 0x81:
        return "noSuchInstance"
    if tag == 0x82:
        return "endOfMibView"
    return data.hex()


def parse_response(packet: bytes) -> tuple[int, list[tuple[str, Any, int]]]:
    tag, message, _ = parse_tlv(packet, 0)
    if tag != 0x30:
        raise SNMPError("Invalid SNMP message")
    p = 0
    _, _, p = parse_tlv(message, p)
    _, _, p = parse_tlv(message, p)
    pdu_tag, pdu, _ = parse_tlv(message, p)
    if pdu_tag not in (0xA0, 0xA1, 0xA2):
        raise SNMPError(f"Unsupported PDU tag {pdu_tag:#x}")
    q = 0
    _, rid_bytes, q = parse_tlv(pdu, q)
    request_id = int.from_bytes(rid_bytes, "big", signed=True)
    _, _, q = parse_tlv(pdu, q)
    _, _, q = parse_tlv(pdu, q)
    vb_tag, vblist, _ = parse_tlv(pdu, q)
    if vb_tag != 0x30:
        raise SNMPError("Invalid variable bindings")
    r = 0
    results = []
    while r < len(vblist):
        vbt, vb, r = parse_tlv(vblist, r)
        if vbt != 0x30:
            continue
        x = 0
        ot, oidbytes, x = parse_tlv(vb, x)
        if ot != 0x06:
            continue
        vt, value, _ = parse_tlv(vb, x)
        results.append((decode_oid(oidbytes), decode_value(vt, value), vt))
    return request_id, results


@dataclass
class SNMPClient:
    host: str
    community: str
    port: int = 161
    timeout: float = 1.5
    retries: int = 1

    async def get(self, oids: list[str]) -> list[tuple[str, Any, int]]:
        return await asyncio.to_thread(self._request, 0xA0, oids)

    async def getnext(self, oid: str) -> list[tuple[str, Any, int]]:
        return await asyncio.to_thread(self._request, 0xA1, [oid])

    def _request(self, pdu_tag: int, oids: list[str]) -> list[tuple[str, Any, int]]:
        request_id = random.randint(1, 0x6FFFFFFF)
        version = _tlv(0x02, _enc_int(1))
        community = _tlv(0x04, self.community.encode())
        varbinds = b"".join(
            _tlv(0x30, _tlv(0x06, encode_oid(oid)) + _tlv(0x05, b""))
            for oid in oids
        )
        vblist = _tlv(0x30, varbinds)
        pdu = _tlv(
            pdu_tag,
            _tlv(0x02, _enc_int(request_id))
            + _tlv(0x02, _enc_int(0))
            + _tlv(0x02, _enc_int(0))
            + vblist,
        )
        message = _tlv(0x30, version + community + pdu)
        last_exc: Exception | None = None
        for _ in range(self.retries + 1):
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(self.timeout)
            try:
                sock.sendto(message, (self.host, self.port))
                while True:
                    data, _ = sock.recvfrom(65535)
                    rid, results = parse_response(data)
                    if rid == request_id:
                        return results
            except Exception as exc:
                last_exc = exc
            finally:
                sock.close()
        raise SNMPError(str(last_exc or "SNMP request failed"))


async def ping_host(host: str, timeout_ms: int = 1000) -> tuple[bool, float | None]:
    start = time.perf_counter()
    try:
        ip = ipaddress.ip_address(host)
        if ip.version == 6:
            return False, None
    except ValueError:
        pass
    if __import__("platform").system().lower().startswith("win"):
        cmd = ["ping", "-n", "1", "-w", str(timeout_ms), host]
    else:
        cmd = ["ping", "-c", "1", "-W", str(max(1, timeout_ms // 1000)), host]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        rc = await asyncio.wait_for(proc.wait(), timeout=(timeout_ms / 1000) + 0.5)
        if rc == 0:
            return True, round((time.perf_counter() - start) * 1000, 2)
    except Exception:
        pass
    return False, None


def is_exception_value(value: Any) -> bool:
    return value in ("noSuchObject", "noSuchInstance", "endOfMibView")


def safe_float(v):
    try:
        return float(v)
    except Exception:
        return None


def safe_int(v):
    try:
        return int(v)
    except Exception:
        return None
