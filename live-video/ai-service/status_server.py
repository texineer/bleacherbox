"""
FastAPI app exposing director state + per-camera previews + manual override.

Mounted in-process from broadcast.py via uvicorn running in a thread.

Endpoints:
    GET  /status                 director snapshot as JSON
    GET  /preview/{cam_id}.jpg   most-recent overlaid frame, JPEG-encoded
    GET  /dashboard              tiny HTML page that polls /status and
                                 refreshes thumbnails
    POST /override               body: {"cam_id": "cam2"} or {"cam_id": null}
                                 to pin / unpin the broadcast camera
"""
from __future__ import annotations

import logging
import threading
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
import uvicorn

from director import Director
from frame_bus import FrameReader

log = logging.getLogger(__name__)


DASHBOARD_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BleacherBox Director</title>
<style>
  :root {
    --bg: #0e1322; --fg: #e7ecf6; --muted: #8895b3; --gold: #c9a84c;
    --row: #18213a; --row-alt: #141c33; --hot: #1b2b4b;
  }
  body { background: var(--bg); color: var(--fg); margin: 0;
         font: 14px system-ui, sans-serif; }
  header { padding: 12px 18px; background: var(--row);
           border-bottom: 1px solid #232c4a; display: flex; align-items: center; gap: 14px; }
  h1 { font-size: 16px; margin: 0; color: var(--gold); }
  .pill { padding: 2px 8px; border-radius: 6px; background: #2a355c;
          font-size: 12px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: 280px 1fr; gap: 1px;
          background: #232c4a; }
  .grid > * { background: var(--bg); padding: 10px 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 6px 10px;
           border-bottom: 1px solid #232c4a; font-size: 13px; }
  th { color: var(--muted); font-weight: 600; }
  tr.current td { background: var(--hot); }
  tr.challenger td { box-shadow: inset 3px 0 0 var(--gold); }
  .num { font-variant-numeric: tabular-nums; color: var(--gold); }
  .components { font-size: 11px; color: var(--muted); }
  .thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 12px; padding: 14px; }
  .thumb { background: var(--row); border: 1px solid #232c4a; border-radius: 6px;
           overflow: hidden; }
  .thumb.current { border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold) inset; }
  .thumb img { width: 100%; display: block; }
  .thumb .label { padding: 6px 10px; display: flex; justify-content: space-between; }
  .thumb .label small { color: var(--muted); }
  button { background: #2a355c; color: var(--fg); border: 0; border-radius: 4px;
           padding: 4px 10px; cursor: pointer; font: inherit; }
  button.primary { background: var(--gold); color: #1b2b4b; }
  button:hover { filter: brightness(1.15); }
</style>
</head>
<body>
<header>
  <h1>BleacherBox Director</h1>
  <span id="overall" class="pill">connecting…</span>
  <span id="override" class="pill"></span>
  <span style="margin-left:auto"><button onclick="clearOverride()">clear override</button></span>
</header>
<div class="grid">
  <div>
    <h3>Cameras</h3>
    <table id="cams">
      <thead><tr><th>id</th><th>role</th><th>fps</th><th>EWMA</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>
  <div>
    <h3>Live previews</h3>
    <div id="thumbs" class="thumbs"></div>
  </div>
</div>

<script>
async function poll() {
  try {
    const r = await fetch('/status', {cache: 'no-store'});
    const s = await r.json();
    render(s);
  } catch (e) {
    document.getElementById('overall').textContent = 'disconnected';
  }
}

function render(s) {
  const overall = document.getElementById('overall');
  overall.textContent = `current=${s.current}  ball=${s.global_ball_recent ? 'yes' : 'no'}` +
    (s.challenger ? `  challenger=${s.challenger}` : '');
  const ov = document.getElementById('override');
  ov.textContent = s.overridden ? `OVERRIDE → ${s.overridden}` : '';

  // Table
  const tbody = document.querySelector('#cams tbody');
  tbody.innerHTML = '';
  const camIds = Object.keys(s.cameras).sort();
  for (const cid of camIds) {
    const c = s.cameras[cid];
    const tr = document.createElement('tr');
    if (cid === s.current) tr.classList.add('current');
    if (cid === s.challenger) tr.classList.add('challenger');
    const bd = c.breakdown || {};
    tr.innerHTML = `
      <td>${cid}<div class="components">${formatBreakdown(bd)}</div></td>
      <td>${c.role || ''}</td>
      <td class="num">${(c.fps || 0).toFixed(1)}</td>
      <td class="num">${(c.ewma || 0).toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  }

  // Thumbnails — append on first render, then just bump the cache-bust ts.
  const thumbs = document.getElementById('thumbs');
  if (thumbs.children.length !== camIds.length) {
    thumbs.innerHTML = '';
    for (const cid of camIds) {
      const div = document.createElement('div');
      div.className = 'thumb';
      div.id = `thumb-${cid}`;
      div.innerHTML = `
        <img id="img-${cid}" alt="${cid}" src="/preview/${cid}.jpg">
        <div class="label">
          <span>${cid}</span>
          <small><button onclick="pin('${cid}')">pin</button></small>
        </div>`;
      thumbs.appendChild(div);
    }
  }
  const ts = Date.now();
  for (const cid of camIds) {
    const img = document.getElementById(`img-${cid}`);
    if (img) img.src = `/preview/${cid}.jpg?ts=${ts}`;
    const div = document.getElementById(`thumb-${cid}`);
    if (div) div.classList.toggle('current', cid === s.current);
  }
}

function formatBreakdown(bd) {
  if (!bd || !Object.keys(bd).length) return '';
  const keys = ['ball_visible','ball_centrality','ball_size','player_density','role_bonus'];
  return keys
    .filter(k => k in bd)
    .map(k => `${k.replace('ball_','b/').replace('_',' ')}: ${(+bd[k]).toFixed(2)}`)
    .join(' · ');
}

async function pin(cid) {
  await fetch('/override', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cam_id: cid})
  });
}
async function clearOverride() {
  await fetch('/override', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({cam_id: null})
  });
}

setInterval(poll, 500);
poll();
</script>
</body>
</html>
"""


def make_app(director: Director, readers: dict[str, FrameReader]) -> FastAPI:
    app = FastAPI(title="BleacherBox Director", docs_url=None, redoc_url=None)

    @app.get("/status")
    def get_status():
        snap = director.snapshot()
        return JSONResponse(asdict(snap))

    @app.get("/preview/{cam_id}.jpg")
    def get_preview(cam_id: str):
        reader = readers.get(cam_id)
        if reader is None:
            raise HTTPException(status_code=404, detail=f"unknown cam_id {cam_id!r}")
        # Lazy-import cv2 — uvicorn boots in a thread, by which point cv2 is
        # already initialized in the main process.
        import cv2
        frame = reader.latest_frame()
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if not ok:
            raise HTTPException(status_code=500, detail="encode failed")
        return Response(content=buf.tobytes(), media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})

    @app.post("/override")
    async def post_override(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid JSON body")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="body must be an object")
        cam_id: Optional[str] = body.get("cam_id")
        try:
            director.set_override(cam_id)
        except KeyError as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {"override": cam_id}

    @app.get("/dashboard", response_class=HTMLResponse)
    def get_dashboard():
        return HTMLResponse(content=DASHBOARD_HTML)

    @app.get("/")
    def root_redirect():
        return Response(status_code=302, headers={"Location": "/dashboard"})

    return app


def start_status_server(
    director: Director,
    readers: dict[str, FrameReader],
    host: str = "127.0.0.1",
    port: int = 8888,
) -> threading.Thread:
    """
    Boot uvicorn in a daemon thread and return immediately. Logs go through
    the existing python logging config.
    """
    app = make_app(director, readers)
    config = uvicorn.Config(
        app, host=host, port=port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)

    def _run():
        try:
            server.run()
        except Exception:
            log.exception("status_server crashed")

    t = threading.Thread(target=_run, name="status_server", daemon=True)
    t.start()
    log.info("status_server listening on http://%s:%d/dashboard", host, port)
    return t
