# BleacherBox Field Rig — game-day streaming

The production streaming setup: three cameras at the ballfield, switched live in OBS on a laptop
and streamed to GameChanger over Starlink. Windows / PowerShell, built and tested on a Snapdragon
(ARM64) Surface.

```
Mevo Start "Beav" (3B) ─Wi-Fi RTMP push─►┐
Mevo Start "Trey" (1B) ─Wi-Fi RTMP push─►├─► MediaMTX relay (laptop) ─RTSP─► OBS ─RTMP─► GameChanger
NearStream VM35 (CF) ◄─RTSP pull, NanoStation link─┘        └─► raw recording of every camera
```

Network: GL.iNet Slate 7 router ("Thundercats", 172.16.100.0/24) with a Starlink Mini on its WAN
port; a NanoStation M5 links centerfield.

## Start here

| Doc | For |
|---|---|
| [`RUNBOOK.md`](RUNBOOK.md) | The game-day checklist |
| [`GAME_DAY_SETUP.md`](GAME_DAY_SETUP.md) | Full setup: network, cameras, OBS, troubleshooting |
| [`mevo-quick-start.html`](mevo-quick-start.html) | Phone page with one-tap Mevo app setup links |

## First-time setup on a laptop

1. Install OBS Studio, ffmpeg and grpcurl (`winget install OBSProject.OBSStudio Gyan.FFmpeg fullstorydev.grpcurl`).
2. `.\get-mediamtx.ps1` downloads the relay (not kept in git).
3. Copy `site.example.json` to `site.local.json` and fill in the camera MAC addresses (kept out of git).
4. With OBS closed, `.\install-obs-config.ps1` installs the scenes and both profiles (GameChanger 1080p / GameChanger 720) and opens the firewall for the Mevos.
5. `.\setup-router-logging.ps1` once, while on the Slate 7, keeps the router log across reboots.

Run any script with `powershell -ExecutionPolicy Bypass -File .\<script>.ps1`.

## Scripts

| Script | What it does |
|---|---|
| `start-game.ps1 [-Rtmp]` | Starts the relay, OBS and the game monitor. Default: NDI OBS (x64) and checks NDI is on in each Mevo; `-Rtmp` for the old Mevo-to-relay path with the normal OBS |
| `check-system.ps1 [-Field] [-SpeedTest]` | Pre-game health check of every hop, with the fix for each problem. `-SpeedTest` measures upload from the router and from the laptop and picks the 1080p or 720p profile |
| `game-monitor.ps1` | Logs every network hop every 5 s during the game (started by `start-game.ps1`) |
| `analyze-game.ps1` | Post-game report: disconnects and the hop that caused each, bitrate, dark feeds, Starlink outages |
| `test-upload.ps1` | Can one connection hold the stream bitrate? (Starlink's own speed test overstates it) |
| `vm35-release.ps1` / `vm35-resume.ps1` | Free the centerfield camera for its phone app without stopping the other feeds |
| `test-cameras.ps1` | Fake Mevo feeds for practice at home |
| `save-obs-config.ps1` | Copy OBS scene/profile tweaks back into this folder (never the stream key) |
| `start-obs-x64-ndi.ps1` | x64 OBS with NDI under emulation (run by `start-game.ps1`; see `GAME_DAY_SETUP.md`) |

Local-only, ignored by git: `site.local.json`, `logs/` (game monitor, upload tests, post-game reports)
and `tools/mediamtx/mediamtx.exe`. Raw camera recordings go to `Videos\Baseball\raw` (7-day retention).

## Lessons from the field

- **Starlink upload is limited per connection.** Starlink delivered ~25 Mbps over parallel connections,
  but the single RTMP connection OBS uses held only ~2–4.5 Mbps when the dish was partly
  obstructed. Size the bitrate from `test-upload.ps1` / `check-system -SpeedTest`, not the Starlink app.
- **Keep the Slate 7's 5 GHz on a fixed channel (36).** On Auto it picked 161, which overlaps the
  NanoStation's channel 157 and made the CF feed buffer.
- **The Starlink Mini's own Wi-Fi** (sitting next to the Slate) overlaps both Slate radios. Use bypass mode or separate them.
