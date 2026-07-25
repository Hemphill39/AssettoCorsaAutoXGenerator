"""Strict kn5 v5 verifier: parse a file and assert it consumes to exactly EOF.

Any field-order mistake in the writer shows up as either a struct error or
leftover/insufficient bytes, so "lands exactly on EOF" is a strong check.
"""
import struct
import sys


class R:
    def __init__(self, data):
        self.d = data
        self.p = 0

    def take(self, n):
        if self.p + n > len(self.d):
            raise EOFError(f"want {n} bytes at {self.p}, only {len(self.d) - self.p} left")
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    def u(self):    return struct.unpack("<I", self.take(4))[0]
    def i(self):    return struct.unpack("<i", self.take(4))[0]
    def us(self):   return struct.unpack("<H", self.take(2))[0]
    def byte(self): return self.take(1)[0]
    def bool(self): return self.take(1)[0] != 0
    def f(self):    return struct.unpack("<f", self.take(4))[0]
    def s(self):    return self.take(self.u()).decode("utf-8")


def verify(path, verbose=True):
    r = R(open(path, "rb").read())
    magic = r.take(6)
    assert magic == b"sc6969", f"bad magic {magic!r}"
    version = r.u()
    assert version == 5, f"unexpected version {version}"

    textures = []
    for _ in range(r.i()):
        r.i()                      # active flag
        name = r.s()
        blob = r.take(r.u())
        textures.append((name, len(blob), blob[:4]))

    materials = []
    for _ in range(r.i()):
        name = r.s()
        shader = r.s()
        r.byte()                   # blend mode
        r.bool()                   # alpha tested
        r.i()                      # depth mode
        props = {}
        for _ in range(r.u()):
            pn = r.s()
            props[pn] = r.f()
            r.take(8 + 12 + 16)    # vec2 + vec3 + vec4
        texmaps = {}
        for _ in range(r.u()):
            slot_name = r.s()
            r.u()
            texmaps[slot_name] = r.s()
        materials.append((name, shader, props, texmaps))

    nodes = []

    def read_node(depth):
        cls = r.u()
        name = r.s()
        nchild = r.u()
        r.bool()                                   # active
        info = {"class": cls, "name": name, "depth": depth}
        if cls == 1:
            m = [r.f() for _ in range(16)]
            info["translation"] = (m[12], m[13], m[14])
        elif cls == 2:
            r.bool(); r.bool(); r.bool()           # castShadows, visible, transparent
            vcount = r.u()
            verts = []
            for _ in range(vcount):
                pos = (r.f(), r.f(), r.f())
                r.take(12 + 8 + 12)                # normal + uv + tangent
                verts.append(pos)
            icount = r.u()
            idx = [r.us() for _ in range(icount)]
            info["material"] = r.u()
            r.u()                                  # layer
            r.f(); r.f()                           # lodIn, lodOut
            r.take(12 + 4)                         # bounding sphere
            r.bool()                               # isRenderable
            info.update(verts=vcount, tris=icount // 3,
                        max_index=max(idx) if idx else -1,
                        bbox=(min(p[0] for p in verts), max(p[0] for p in verts),
                              min(p[1] for p in verts), max(p[1] for p in verts)))
            assert info["max_index"] < vcount, f"{name}: index out of range"
        else:
            raise AssertionError(f"unsupported node class {cls}")
        nodes.append(info)
        for _ in range(nchild):
            read_node(depth + 1)

    read_node(0)

    leftover = len(r.d) - r.p
    if verbose:
        print(f"file          : {path}")
        print(f"version       : {version}")
        print(f"textures      : {len(textures)}  {[(n, s, bytes(m)) for n, s, m in textures]}")
        print(f"materials     : {len(materials)}")
        for n, sh, pr, tm in materials:
            print(f"  - {n:10s} shader={sh:12s} props={pr} tex={tm}")
        meshes = [n for n in nodes if n["class"] == 2]
        dummies = [n for n in nodes if n["class"] == 1]
        print(f"nodes         : {len(nodes)}  ({len(meshes)} mesh, {len(dummies)} dummy)")
        for n in dummies:
            print(f"  dummy {n['name']:14s} @ {tuple(round(v,2) for v in n['translation'])}")
        for n in meshes:
            print(f"  mesh  {n['name']:14s} verts={n['verts']:4d} tris={n['tris']:3d} "
                  f"mat={n['material']} x[{n['bbox'][0]:.1f},{n['bbox'][1]:.1f}] "
                  f"y[{n['bbox'][2]:.2f},{n['bbox'][3]:.2f}]")
        print(f"bytes consumed: {r.p} / {len(r.d)}   leftover={leftover}")

    assert leftover == 0, f"FAIL: {leftover} trailing bytes — writer/reader disagree"
    print("\n✅ PASS: parsed to exactly EOF, structure self-consistent")
    return nodes, materials, textures


if __name__ == "__main__":
    verify(sys.argv[1])
