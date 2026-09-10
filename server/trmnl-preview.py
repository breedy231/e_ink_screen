#!/usr/bin/env python3
"""
TRMNL preview — render exactly what the Kindle would show, locally.

Pulls a screen PNG from a BYOS instance and composites it through the same
transform the `trmnl` layout applies in production (90-degree rotation into
the 600x800 portrait canvas, scale-to-fit on white, then the mandatory
e-ink pass from optimize-for-eink.py). No Pi, no Kindle, no SSH.

This deliberately reimplements TrmnlComponent's transform in Pillow rather
than reusing dashboard-engine.js: node-canvas is broken on this Mac (renders
solid black — see the project notes), and the `trmnl` layout is a pure
full-canvas passthrough, so there is nothing else in the Node pipeline for
this path to miss. Keep the geometry below in sync with TrmnlComponent.render().

Sources (pick one):
  --peek     GET /api/current_screen  — what the device would get right now.
                                        Read-only, does NOT advance the playlist. (default)
  --next     GET /api/display         — advance the playlist by one, then render it.
                                        This has a real side effect on the live rotation.
  --plugin X GET /api/display/<uuid>/alias — render one plugin fresh, by name or uuid.
                                        No playlist side effect; needs "alias" enabled
                                        on that plugin. Best loop for iterating a recipe.

Usage:
  python3 trmnl-preview.py                      # peek, write + open the PNG
  python3 trmnl-preview.py --plugin Weather
  python3 trmnl-preview.py --next --no-open -o /tmp/shot.png
  python3 trmnl-preview.py --plugin Weather --raw  # skip the Kindle transform

Config resolution: CLI flags > environment > server/.env > defaults.
"""

import argparse
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))

# Must match the Kindle canvas in generate.js / optimize-for-eink.py.
CANVAS_SIZE = (600, 800)
BACKGROUND = 255  # generate.js backgroundColor '#FFFFFF'

DEFAULTS = {
    "TRMNL_BASE_URL": "http://localhost:4567",
    "TRMNL_ROTATION": "cw",
    "TRMNL_DEVICE_MAC": "",
    "TRMNL_API_KEY": "",
}


def load_config():
    """CLI > env > server/.env > DEFAULTS."""
    cfg = dict(DEFAULTS)

    env_file = os.path.join(SERVER_DIR, ".env")
    if os.path.isfile(env_file):
        with open(env_file) as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip().strip('"').strip("'")
                if key in DEFAULTS and value:
                    cfg[key] = value

    for key in DEFAULTS:
        if os.environ.get(key):
            cfg[key] = os.environ[key]

    return cfg


def http_get(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read(), res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:400]
        die(f"HTTP {exc.code} from {url}\n{body}")
    except urllib.error.URLError as exc:
        die(f"Could not reach {url}: {exc.reason}")


class PreviewError(Exception):
    """A user-facing failure. The CLI prints it and exits; --serve shows it in the page."""


def die(message):
    raise PreviewError(message)


def auth_headers(cfg):
    if not cfg["TRMNL_DEVICE_MAC"] or not cfg["TRMNL_API_KEY"]:
        die(
            "device credentials missing. Set TRMNL_DEVICE_MAC and TRMNL_API_KEY "
            "in the environment or server/.env (or use --plugin, which needs neither)."
        )
    return {"ID": cfg["TRMNL_DEVICE_MAC"], "Access-Token": cfg["TRMNL_API_KEY"]}


def fetch_device_screen(cfg, advance):
    """Resolve a screen via the device API, then download the image it points at.

    `advance=False` uses /api/current_screen, which is read-only. `advance=True`
    uses /api/display, which steps the playlist forward by one — the same call
    the Pi makes, so it really does change what the Kindle sees next.
    """
    endpoint = "/api/display" if advance else "/api/current_screen"
    url = urllib.parse.urljoin(cfg["TRMNL_BASE_URL"], endpoint)
    body, _ = http_get(url, auth_headers(cfg))

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        die(f"{endpoint} did not return JSON")

    image_url = payload.get("image_url")
    if not image_url:
        die(f"{endpoint} returned no image_url (payload: {body[:200]!r})")

    # byos_laravel builds this from its own APP_URL, which has been wrong in
    # production before — resolve relative URLs, and say which host we hit.
    image_url = urllib.parse.urljoin(cfg["TRMNL_BASE_URL"], image_url)
    print(f"  {endpoint} -> {image_url}")
    data, _ = http_get(image_url)
    return data, payload


def byos_query(sql, params=()):
    """Read from the BYOS sqlite DB through the container (no sqlite3 CLI in the image).

    Read-only by construction: callers pass SELECTs, and values go in as bound
    parameters. The live DB is production config — never write to it from here,
    use the admin UI.
    """
    php = (
        '$d=new PDO("sqlite:database/storage/database.sqlite");'
        f'$s=$d->prepare({json.dumps(sql)});'
        f'$s->execute({json.dumps(list(params))});'
        'echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));'
    )
    try:
        out = subprocess.run(
            ["docker", "exec", os.environ.get("BYOS_CONTAINER", "prod-app-1"), "php", "-r", php],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
        die(f"could not read the BYOS database via the container: {exc}")

    return json.loads(out) if out else []


def list_plugins():
    return byos_query(
        'select id, name, uuid, alias, plugin_type from plugins order by name'
    )


def resolve_plugin_uuid(cfg, name_or_uuid):
    """Accept a plugin uuid directly, or look one up by name via the container."""
    if len(name_or_uuid) >= 32 and "-" in name_or_uuid:
        return name_or_uuid

    rows = byos_query(
        'select uuid, alias from plugins where name = ? collate nocase', [name_or_uuid]
    )
    if not rows:
        die(f"no plugin named {name_or_uuid!r} in BYOS")
    if not int(rows[0]["alias"]):
        die(
            f"plugin {name_or_uuid!r} does not have 'alias' enabled, so BYOS refuses to "
            "render it standalone. Enable it in the plugin's settings in the admin UI "
            "(recipe page -> gear icon -> Enable Alias)."
        )
    return rows[0]["uuid"]


def fetch_plugin_screen(cfg, name_or_uuid, device_model=None):
    uuid = resolve_plugin_uuid(cfg, name_or_uuid)
    url = urllib.parse.urljoin(cfg["TRMNL_BASE_URL"], f"/api/display/{uuid}/alias")
    if device_model:
        url += "?" + urllib.parse.urlencode({"device-model": device_model})
    print(f"  alias -> {url}")
    data, content_type = http_get(url)
    if "json" in content_type:
        die(f"BYOS returned an error instead of an image: {data.decode('utf-8', 'replace')[:300]}")
    return data, {"source": "alias", "plugin": name_or_uuid}


def to_kindle_png(png_bytes, rotation):
    """Mirror TrmnlComponent.render() + optimize-for-eink.py.

    TRMNL screens are landscape (e.g. 800x480); the Kindle canvas is portrait
    600x800. Rotate 90 degrees, scale the rotated footprint to fit, centre it
    on white, then grayscale + autocontrast.

    rotation='none' letterboxes the screen upright instead — smaller, but
    readable without turning the Kindle sideways.
    """
    source = Image.open(io.BytesIO(png_bytes))

    if rotation == "none":
        placed = source
    else:
        # ROTATE_270 is a 90-degree clockwise turn in Pillow's counter-clockwise naming.
        placed = source.transpose(Image.ROTATE_270 if rotation == "cw" else Image.ROTATE_90)

    scale = min(CANVAS_SIZE[0] / placed.width, CANVAS_SIZE[1] / placed.height)
    target = (max(1, round(placed.width * scale)), max(1, round(placed.height * scale)))
    placed = placed.resize(target, Image.LANCZOS)

    canvas = Image.new("L", CANVAS_SIZE, BACKGROUND)
    canvas.paste(
        placed.convert("L"),
        ((CANVAS_SIZE[0] - target[0]) // 2, (CANVAS_SIZE[1] - target[1]) // 2),
    )

    return ImageOps.autocontrast(canvas, cutoff=1)


PAGE_CSS = """
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 24px;
       background: #f5f5f4; color: #1c1917; }
h1 { font-size: 20px; margin: 0 0 4px; }
.sub { color: #78716c; margin: 0 0 20px; }
.row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.shot { background: #fff; padding: 12px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.shot img { display: block; width: 300px; height: 400px; image-rendering: pixelated;
            border: 1px solid #d6d3d1; }
.shot .cap { font-size: 13px; color: #57534e; margin-top: 8px; text-align: center; }
ul { list-style: none; padding: 0; }
li { padding: 7px 0; border-bottom: 1px solid #e7e5e4; }
a { color: #1d4ed8; text-decoration: none; }
a:hover { text-decoration: underline; }
.off { color: #a8a29e; font-size: 13px; }
.err { background: #fee2e2; border: 1px solid #fca5a5; padding: 12px 14px; border-radius: 8px;
       white-space: pre-wrap; }
nav { margin-bottom: 18px; }
"""


def html_page(title, body):
    return (
        f"<!doctype html><meta charset=utf-8><title>{title}</title>"
        f"<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<style>{PAGE_CSS}</style>"
        f"<nav><a href='/'>&larr; all screens</a></nav>{body}"
    ).encode("utf-8")


def esc(text):
    return (
        str(text).replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace('"', "&quot;")
    )


def make_handler(cfg):
    from http.server import BaseHTTPRequestHandler

    class PreviewHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            print(f"  [{self.address_string()}] {fmt % args}")

        def _send(self, body, content_type, status=200):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            # Renders change every time a recipe is edited; never let a browser
            # or proxy show a stale screen — that's the whole bug class this
            # tool exists to catch.
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(url.query)
            try:
                if url.path == "/":
                    self._index()
                elif url.path == "/view":
                    self._view(query.get("plugin", [None])[0])
                elif url.path == "/img":
                    self._img(query)
                else:
                    self._send(html_page("Not found", "<p>Not found</p>"), "text/html", 404)
            except PreviewError as exc:
                self._send(
                    html_page("Error", f"<div class=err>{esc(exc)}</div>"), "text/html", 500
                )
            except Exception as exc:  # noqa: BLE001 - a preview server should never die
                self._send(
                    html_page("Error", f"<div class=err>{esc(repr(exc))}</div>"),
                    "text/html", 500,
                )

        def _index(self):
            items = [
                "<li><a href='/view'><b>Current device screen</b></a> "
                "<span class=off>&mdash; what the Kindle would fetch right now</span></li>"
            ]
            for plugin in list_plugins():
                name = esc(plugin["name"])
                if int(plugin["alias"]):
                    items.append(f"<li><a href='/view?plugin={urllib.parse.quote(plugin['name'])}'>{name}</a></li>")
                else:
                    items.append(
                        f"<li><span class=off>{name} &mdash; alias off "
                        "(recipe page &rarr; gear &rarr; Enable Alias)</span></li>"
                    )
            body = (
                "<h1>TRMNL preview</h1>"
                "<p class=sub>Rendered as the Kindle would show it. Reload to re-render.</p>"
                f"<ul>{''.join(items)}</ul>"
            )
            self._send(html_page("TRMNL preview", body), "text/html")

        def _view(self, plugin):
            label = esc(plugin) if plugin else "Current device screen"
            src = f"plugin={urllib.parse.quote(plugin)}" if plugin else "peek=1"
            shots = "".join(
                f"<div class=shot><img src='/img?{src}&rotation={rot}' alt='{rot}'>"
                f"<div class=cap>{cap}</div></div>"
                for rot, cap in [
                    ("cw", "TRMNL_ROTATION=cw &mdash; fills the screen, reads sideways"),
                    ("none", "TRMNL_ROTATION=none &mdash; upright, 600&times;360"),
                ]
            )
            raw = (
                f"<div class=shot><img src='/img?{src}&rotation=raw' "
                "style='width:400px;height:240px' alt='raw'>"
                "<div class=cap>Raw BYOS screen (landscape, pre-Kindle)</div></div>"
            )
            body = (
                f"<h1>{label}</h1><p class=sub>600&times;800, e-ink processed. "
                "Shown at half size.</p>"
                f"<div class=row>{shots}{raw}</div>"
            )
            self._send(html_page(f"Preview: {label}", body), "text/html")

        def _img(self, query):
            rotation = query.get("rotation", ["cw"])[0]
            plugin = query.get("plugin", [None])[0]

            # Deliberately no /api/display path here: serving it over HTTP would
            # let a page reload silently advance the live playlist. Use --next.
            if plugin:
                png, _ = fetch_plugin_screen(cfg, plugin, query.get("device-model", [None])[0])
            else:
                png, _ = fetch_device_screen(cfg, advance=False)

            if rotation == "raw":
                self._send(png, "image/png")
                return

            buf = io.BytesIO()
            to_kindle_png(png, rotation).save(buf, "PNG", optimize=True, compress_level=9)
            self._send(buf.getvalue(), "image/png")

    return PreviewHandler


def serve(cfg, port):
    import socket
    from http.server import ThreadingHTTPServer

    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(cfg))

    # Best-effort LAN address, so the URL can be pasted into another machine.
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.168.50.1", 1))
        lan = probe.getsockname()[0]
    except OSError:
        lan = socket.gethostbyname(socket.gethostname())
    finally:
        probe.close()

    print(f"TRMNL preview server on:")
    print(f"  http://{lan}:{port}   (LAN — open this from your other machine)")
    print(f"  http://localhost:{port}")
    print("Ctrl-C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


def main():
    parser = argparse.ArgumentParser(
        description="Render a BYOS screen as the Kindle would show it, without touching the Kindle.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--peek", action="store_true",
                        help="read the device's current screen without advancing (default)")
    source.add_argument("--next", action="store_true",
                        help="advance the live playlist by one, then render it")
    source.add_argument("--plugin", metavar="NAME_OR_UUID",
                        help="render one plugin standalone (needs alias enabled)")
    parser.add_argument("-o", "--output", default="/tmp/trmnl-preview.png",
                        help="where to write the PNG (default: %(default)s)")
    parser.add_argument("--raw", action="store_true",
                        help="save BYOS's landscape screen as-is, skipping the Kindle transform")
    parser.add_argument("--rotation", choices=["cw", "ccw", "none"],
                        help="override TRMNL_ROTATION ('none' = upright and letterboxed)")
    parser.add_argument("--device-model", metavar="NAME",
                        help="BYOS device model to render at, e.g. og_png (--plugin only)")
    parser.add_argument("--base-url", help="override TRMNL_BASE_URL")
    parser.add_argument("--no-open", action="store_true", help="don't open the result")
    parser.add_argument("--serve", action="store_true",
                        help="serve the previews over the LAN instead of writing a file")
    parser.add_argument("--port", type=int, default=4568,
                        help="port for --serve (default: %(default)s, next to BYOS's 4567)")
    args = parser.parse_args()

    cfg = load_config()
    if args.base_url:
        cfg["TRMNL_BASE_URL"] = args.base_url
    if args.rotation:
        cfg["TRMNL_ROTATION"] = args.rotation

    print(f"BYOS: {cfg['TRMNL_BASE_URL']}")
    if args.serve:
        serve(cfg, args.port)
        return

    if args.plugin:
        png_bytes, meta = fetch_plugin_screen(cfg, args.plugin, args.device_model)
    else:
        if args.device_model:
            die("--device-model only applies to --plugin; the device API always uses the device's own model")
        png_bytes, meta = fetch_device_screen(cfg, advance=args.next)

    if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        die(
            "BYOS returned something that is not a PNG. trmnl-service.js rejects "
            "this too (magic-byte check) — check the device model's image format."
        )

    if args.raw:
        with open(args.output, "wb") as fh:
            fh.write(png_bytes)
        size = Image.open(io.BytesIO(png_bytes)).size
        print(f"wrote {args.output} (raw {size[0]}x{size[1]})")
    else:
        to_kindle_png(png_bytes, cfg["TRMNL_ROTATION"]).save(
            args.output, "PNG", optimize=True, compress_level=9
        )
        print(f"wrote {args.output} (600x800 grayscale, rotation={cfg['TRMNL_ROTATION']})")

    if meta.get("refresh_rate"):
        print(f"  device refresh_rate: {meta['refresh_rate']}s")

    if not args.no_open:
        subprocess.run(["open", args.output], check=False)


if __name__ == "__main__":
    try:
        main()
    except PreviewError as exc:
        # die() raises rather than exits so --serve can render an error page;
        # on the CLI it still has to look like a plain failure.
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
