#!/usr/bin/env python3
"""Helpers for ktcheck.sh (see README.md).

  ktcheck.py deps CACHE OUT COORD...   resolve COORDs (group:artifact:version) and their transitive
                                       compile deps from Google Maven / Maven Central, download them
                                       into CACHE/m2, extract classes.jar from AARs into CACHE/jars,
                                       write the classpath (one jar per line) to OUT.
  ktcheck.py android CACHE API         download android.jar for compileSdk API into CACHE/android-API/.
  ktcheck.py rclass RES_DIR PACKAGE OUT   write a stub R.kt for the resources under RES_DIR.
  ktcheck.py run SOCKET MODE STRIP ARG...  send one compile (MODE check|full) to KtServer.

Resolution follows Gradle's compile classpath: Gradle module metadata (.module) when published,
the "java-api" variant (androidJvm/jvm for Kotlin multiplatform, following "available-at"),
else the POM's compile-scope deps; highest requested version wins.
"""
import os
import re
import sys
# Heavier modules are imported where used: `run` (every check) needs only socket.

GOOGLE = "https://dl.google.com/android/maven2"
CENTRAL = "https://repo.maven.apache.org/maven2"
GOOGLE_GROUPS = ("androidx.", "com.google.android.", "android.arch.", "com.android.")
# The compiler brings its own stdlib; older ones on the classpath only cause warnings.
SKIP = re.compile(r"^org\.jetbrains\.kotlin:kotlin-stdlib(-common|-jdk7|-jdk8)?$|^org\.jetbrains:annotations$")
# compileSdk -> the SDK manager's "platforms;android-N" archive (repository2-3.xml) and its sha1.
PLATFORMS = {
    "33": ("platform-33-ext3_r03.zip", "394bc86d8d3452aa4d419b67743025a6fb2cd9d0"),
    "34": ("platform-34-ext7_r03.zip", "1f2e9478d6a7601425ceaa553311dc43191f103d"),
    "35": ("platform-35_r02.zip", "0bb560a90a7a2cbd0dd8348224d518b638fe7949"),
    "36": ("platform-36_r02.zip", "2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576"),
}


def log(msg):
    print("ktcheck: " + msg, file=sys.stderr)


def repos_for(group):
    return (GOOGLE, CENTRAL) if group.startswith(GOOGLE_GROUPS) else (CENTRAL, GOOGLE)


def fetch(cache, group, artifact, version, filename):
    """Path of a cached repository file, downloading it once; None if no repo has it.
    A miss is remembered too (a .missing marker) so later runs stay offline."""
    d = os.path.join(cache, "m2", *group.split("."), artifact, version)
    path = os.path.join(d, filename)
    if os.path.exists(path):
        return path
    if os.path.exists(path + ".missing"):
        return None
    os.makedirs(d, exist_ok=True)
    import urllib.error
    import urllib.request
    rel = "/".join(group.split(".") + [artifact, version, filename])
    for repo in repos_for(group):
        try:
            with urllib.request.urlopen(repo + "/" + rel, timeout=60) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                continue
            raise
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        log("downloaded " + rel)
        return path
    open(path + ".missing", "w").close()
    return None


def vkey(v):
    parts = re.split(r"[.\-]", v)
    out = []
    for p in parts:
        if p.isdigit():
            out.append((1, int(p), ""))
        else:
            # pre-release qualifiers sort below a release: 1.0-alpha01 < 1.0
            out.append((0, 0, p))
    return out + [(0.5, 0, "")]


def max_version(a, b):
    return a if vkey(a) >= vkey(b) else b


# ---- Gradle module metadata ----

def pick_variant(variants):
    def score(v):
        a = v.get("attributes", {})
        if a.get("org.gradle.usage") != "java-api":
            return -1
        if a.get("org.gradle.category", "library") != "library":
            return -1
        plat = a.get("org.jetbrains.kotlin.platform.type")
        s = {"androidJvm": 3, "jvm": 2, None: 1}.get(plat, -1)
        if s < 0:
            return -1
        if "debug" in v.get("name", "").lower():
            s -= 0.5
        return s
    best = max(variants, key=score, default=None)
    return best if best is not None and score(best) >= 0 else None


def from_module(cache, g, a, v):
    """(files, deps, redirect) from the .module file, or None if there is none."""
    path = fetch(cache, g, a, v, f"{a}-{v}.module")
    if not path:
        return None
    import json
    with open(path, encoding="utf-8") as f:
        meta = json.load(f)
    var = pick_variant(meta.get("variants", []))
    if var is None:
        return [], [], None
    at = var.get("available-at")
    if at:
        return [], [], (at["group"], at["module"], at["version"])
    deps = []
    for d in var.get("dependencies", []):
        ver = d.get("version", {})
        dv = ver.get("strictly") or ver.get("requires") or ver.get("prefers")
        if dv:
            deps.append((d["group"], d["module"], dv))
    files = [fl["url"] for fl in var.get("files", [])]
    return files, deps, None


# ---- POM ----

def strip_ns(root):
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def load_pom(cache, g, a, v, depth=0):
    """(properties, managed versions, deps, packaging) with the parent chain applied."""
    path = fetch(cache, g, a, v, f"{a}-{v}.pom")
    if not path:
        return None
    import xml.etree.ElementTree as ET
    root = strip_ns(ET.parse(path).getroot())
    props, managed = {}, {}
    parent = root.find("parent")
    if parent is not None and depth < 10:
        pg, pa, pv = (parent.findtext(k, "").strip() for k in ("groupId", "artifactId", "version"))
        pp = load_pom(cache, pg, pa, pv, depth + 1)
        if pp:
            props.update(pp[0])
            managed.update(pp[1])
    g = root.findtext("groupId", g).strip()
    v = root.findtext("version", v).strip()
    props.update({"project.groupId": g, "project.version": v, "pom.version": v, "version": v,
                  "project.artifactId": a})
    pe = root.find("properties")
    if pe is not None:
        for p in pe:
            if isinstance(p.tag, str):
                props[p.tag] = (p.text or "").strip()

    def sub(s):
        for _ in range(5):
            s2 = re.sub(r"\$\{([^}]+)\}", lambda m: props.get(m.group(1), m.group(0)), s)
            if s2 == s:
                break
            s = s2
        return s

    for d in root.findall("dependencyManagement/dependencies/dependency"):
        dg, da = sub(d.findtext("groupId", "").strip()), sub(d.findtext("artifactId", "").strip())
        dv = sub(d.findtext("version", "").strip())
        if d.findtext("scope", "") == "import" and dv:
            bom = load_pom(cache, dg, da, dv, depth + 1)
            if bom:
                for k, mv in bom[1].items():
                    managed.setdefault(k, mv)
        elif dv:
            managed[(dg, da)] = dv
    deps = []
    for d in root.findall("dependencies/dependency"):
        scope = d.findtext("scope", "compile").strip()
        if scope != "compile" or d.findtext("optional", "false").strip() == "true":
            continue
        dg, da = sub(d.findtext("groupId", "").strip()), sub(d.findtext("artifactId", "").strip())
        dv = sub(d.findtext("version", "").strip()) or managed.get((dg, da), "")
        dv = dv.strip("[]()").split(",")[0]
        if dg and da and dv and "${" not in dv:
            deps.append((dg, da, dv))
    return props, managed, deps, root.findtext("packaging", "jar").strip()


def from_pom(cache, g, a, v):
    pom = load_pom(cache, g, a, v)
    if pom is None:
        raise SystemExit(f"ktcheck: {g}:{a}:{v} not found in Google Maven or Maven Central")
    pkg = pom[3]
    ext = "aar" if pkg == "aar" else "jar"
    if pkg == "pom":
        return [], pom[2]
    return [f"{a}-{v}.{ext}"], pom[2]


def resolve(cache, roots):
    chosen = {}          # (g, a) -> version
    info = {}            # (g, a, v) -> (real coordinate, files, deps)

    def describe(g, a, v):
        key = (g, a, v)
        if key not in info:
            m = from_module(cache, g, a, v)
            if m is not None and m[2]:
                rg, ra, rv = m[2]
                files, deps = describe(rg, ra, rv)[1:]
                info[key] = ((rg, ra, rv), files, deps + [])
            elif m is not None:
                info[key] = ((g, a, v), m[0], m[1])
            else:
                files, deps = from_pom(cache, g, a, v)
                info[key] = ((g, a, v), files, deps)
        return info[key]

    for g, a, v in roots:
        chosen[(g, a)] = max_version(chosen.get((g, a), v), v)
    while True:
        seen, queue, changed = set(), [(g, a) for g, a, _ in roots], False
        while queue:
            ga = queue.pop()
            if ga in seen or SKIP.match("%s:%s" % ga):
                continue
            seen.add(ga)
            for dg, da, dv in describe(ga[0], ga[1], chosen[ga])[2]:
                cur = chosen.get((dg, da))
                if cur is None or max_version(cur, dv) != cur:
                    chosen[(dg, da)] = dv
                    changed = True
                queue.append((dg, da))
        if not changed:
            break
    out = []
    for g, a in sorted(seen):
        real, files, _ = describe(g, a, chosen[(g, a)])
        for fn in files:
            out.append((real, fn))
    return out


def jars_for(cache, real, fn):
    g, a, v = real
    path = fetch(cache, g, a, v, fn)
    if path is None:
        raise SystemExit(f"ktcheck: missing {fn} for {g}:{a}:{v}")
    if not fn.endswith(".aar"):
        return [path] if fn.endswith(".jar") else []
    import zipfile
    outdir = os.path.join(cache, "jars", f"{g}__{a}__{v}")
    done = os.path.join(outdir, ".done")
    if not os.path.exists(done):
        os.makedirs(outdir, exist_ok=True)
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name == "classes.jar" or (name.startswith("libs/") and name.endswith(".jar")):
                    target = os.path.join(outdir, name.replace("/", "_"))
                    with z.open(name) as src, open(target, "wb") as dst:
                        dst.write(src.read())
        open(done, "w").close()
    return sorted(os.path.join(outdir, n) for n in os.listdir(outdir) if n.endswith(".jar"))


def cmd_deps(cache, out, coords):
    roots = [tuple(c.split(":")[:3]) for c in coords]
    jars = []
    for real, fn in resolve(cache, roots):
        jars.extend(jars_for(cache, real, fn))
    tmp = out + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(jars) + "\n")
    os.replace(tmp, out)
    log(f"classpath: {len(jars)} jars")


def cmd_android(cache, api):
    import hashlib
    import urllib.request
    import zipfile
    if api not in PLATFORMS:
        raise SystemExit(f"ktcheck: no android.jar known for compileSdk {api}; add it to PLATFORMS in ktcheck.py")
    zname, sha1 = PLATFORMS[api]
    url = "https://dl.google.com/android/repository/" + zname
    d = os.path.join(cache, "android-" + api)
    jar = os.path.join(d, "android.jar")
    if os.path.exists(jar):
        return
    os.makedirs(d, exist_ok=True)
    zpath = os.path.join(d, "platform.zip")
    log("downloading " + url + " (about 60 MB, once)")
    urllib.request.urlretrieve(url, zpath + ".part")
    h = hashlib.sha1()
    with open(zpath + ".part", "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != sha1:
        os.remove(zpath + ".part")
        raise SystemExit("ktcheck: android platform zip checksum mismatch")
    os.replace(zpath + ".part", zpath)
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith("/android.jar"))
        with z.open(name) as src, open(jar + ".part", "wb") as dst:
            dst.write(src.read())
    os.replace(jar + ".part", jar)
    os.remove(zpath)


# ---- R stub ----

VALUE_TAGS = {"string": "string", "color": "color", "dimen": "dimen", "bool": "bool",
              "integer": "integer", "style": "style", "plurals": "plurals", "attr": "attr",
              "array": "array", "string-array": "array", "integer-array": "array",
              "fraction": "fraction", "drawable": "drawable"}
FILE_DIRS = ("drawable", "layout", "mipmap", "xml", "raw", "anim", "animator", "color",
             "menu", "font", "navigation", "interpolator", "transition")


def cmd_rclass(res, package, out):
    import xml.etree.ElementTree as ET
    types = {}

    def add(t, name):
        types.setdefault(t, set()).add(re.sub(r"[.\-:]", "_", name))

    id_re = re.compile(r'@\+id/([A-Za-z0-9_.]+)')
    for d in sorted(os.listdir(res)) if os.path.isdir(res) else []:
        full = os.path.join(res, d)
        if not os.path.isdir(full):
            continue
        base = d.split("-")[0]
        for fn in sorted(os.listdir(full)):
            path = os.path.join(full, fn)
            if base == "values" and fn.endswith(".xml"):
                root = ET.parse(path).getroot()
                for el in root:
                    tag, name = el.tag, el.get("name")
                    if not isinstance(tag, str) or not name:
                        continue
                    if tag == "item":
                        tag = el.get("type", "")
                    if tag == "declare-styleable":
                        add("styleable", name)
                        for at in el.findall("attr"):
                            add("styleable", name + "_" + at.get("name", "").replace("android:", "android_"))
                            if not at.get("name", "").startswith("android:"):
                                add("attr", at.get("name"))
                    elif tag in VALUE_TAGS:
                        add(VALUE_TAGS[tag], name)
                    elif tag == "id":
                        add("id", name)
            elif base in FILE_DIRS:
                add(base, fn.split(".")[0])
            if fn.endswith(".xml") and base != "values":
                with open(path, encoding="utf-8", errors="replace") as f:
                    for m in id_re.finditer(f.read()):
                        add("id", m.group(1))
    lines = [f"package {package}", "", "// Generated by tools/ktcheck for type-checking only.",
             "@Suppress(\"ClassName\", \"unused\")", "object R {"]
    n = 0x7f000000
    for t in sorted(types):
        lines.append(f"    object {t} {{")
        for name in sorted(types[t]):
            n += 1
            if t == "styleable" and "_" not in name:
                lines.append(f"        val {name}: IntArray = IntArray(0)")
            else:
                lines.append(f"        const val {name}: Int = {n}")
        lines.append("    }")
    lines.append("}")
    tmp = out + ".part"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, out)


def cmd_run(sock, mode, strip, args):
    """Send one check to the compile server; print its messages (paths under `strip` shortened).
    Exit code: the compiler's (0 ok, 1 errors), or 100 if no server is listening."""
    import socket
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.connect(sock)
    except OSError:
        return 100
    s.sendall(("\n".join([mode] + args) + "\n\n").encode())
    data = bytearray()
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        data += chunk
    text = data.decode("utf-8", "replace")
    text, sep, tail = text.rpartition("\0EXIT ")
    if not sep:
        print(data.decode("utf-8", "replace"), end="")
        return 3
    if strip:
        text = text.replace(strip.rstrip("/") + "/", "")
    sys.stdout.write(text)
    return int(tail.strip() or 3)


def main(argv):
    if len(argv) >= 5 and argv[1] == "run":
        return cmd_run(argv[2], argv[3], argv[4], argv[5:])
    if len(argv) >= 4 and argv[1] == "deps":
        cmd_deps(argv[2], argv[3], argv[4:])
    elif len(argv) == 4 and argv[1] == "android":
        cmd_android(argv[2], argv[3])
    elif len(argv) == 5 and argv[1] == "rclass":
        cmd_rclass(argv[2], argv[3], argv[4])
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
