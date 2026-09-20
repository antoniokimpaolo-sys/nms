from app.snmp import decode_oid, encode_oid


def test_oid_roundtrip():
    oid = ".1.3.6.1.2.1.1.5.0"
    assert decode_oid(encode_oid(oid)) == "1.3.6.1.2.1.1.5.0"


def test_app_import():
    from app.main import app
    assert app.title == "Smart City NMS"
