"""Independent PNG validator.

Checks the signature, every chunk CRC, and that the IDAT zlib stream inflates to
exactly the expected scanline byte count. Used to validate our hand-rolled
encoder (which emits stored deflate blocks) without trusting its own code.
"""
import struct
import sys
import zlib


def verify(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "bad PNG signature"

    pos = 8
    idat = b""
    width = height = depth = colour = None
    seen = []

    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        (crc,) = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])
        assert crc == zlib.crc32(ctype + body) & 0xFFFFFFFF, f"CRC mismatch in {ctype!r}"
        seen.append(ctype.decode())

        if ctype == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
        elif ctype == b"IDAT":
            idat += body

        pos += 12 + length

    assert seen[0] == "IHDR", "IHDR must come first"
    assert seen[-1] == "IEND", "IEND must come last"
    assert depth == 8, f"expected 8-bit depth, got depth={depth}"
    assert colour in (2, 6), f"expected truecolour (2) or truecolour+alpha (6), got colour={colour}"
    channels = 3 if colour == 2 else 4
    kind = "truecolour" if colour == 2 else "truecolour+alpha"

    raw = zlib.decompress(idat)
    expected = height * (1 + width * channels)
    assert len(raw) == expected, f"inflated to {len(raw)} bytes, expected {expected}"

    for y in range(height):
        f = raw[y * (1 + width * channels)]
        assert f == 0, f"scanline {y} uses filter {f}, expected 0 (None)"

    print(f"OK {path}: {width}x{height} {kind}, {len(seen)} chunks, "
          f"inflates to {len(raw)} bytes, all CRCs valid")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        verify(arg)
    print("PNG VALID")
