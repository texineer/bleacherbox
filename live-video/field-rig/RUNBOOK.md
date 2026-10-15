# Game-Day Runbook

Short version of `GAME_DAY_SETUP.md`. Everything runs from `live-video\field-rig` in the bleacherbox repo (`C:\Users\rpbea\Documents\bleacherbox\live-video\field-rig` on the stream laptop).
To run a script: right-click → **Run with PowerShell**, or in a terminal
`powershell -ExecutionPolicy Bypass -File .\<script>.ps1`

## 0. Pack
- [ ] Laptop + charger (OBS encoding drains the battery fast. Plan on AC or a power station)
- [ ] Slate 7 + power, Starlink Mini + power (+ its Ethernet adapter if you have one)
- [ ] NanoStation M5 + its PoE injector + 2 Ethernet cables
- [ ] Beav, Trey, VM35, all charged, + mounts
- [ ] **Two phones/tablets** with the Mevo app (one per Mevo) + chargers
- [ ] Power for the VM35 in centerfield (battery bank / power station)

## 1. Network (about 10 min)
1. **Starlink → Slate 7**
   - Best: Starlink Ethernet adapter → Slate **WAN** port.
   - No adapter: Slate admin `http://172.16.100.1` → Internet → Repeater → join the Starlink Wi-Fi **on 2.4 GHz** (keeps 5 GHz free for cameras).
2. **Slate 5 GHz channel → 36** (only if Starlink is on the WAN port; a 5 GHz repeater forces its own channel):
   Slate admin → Wireless → 5 GHz → Channel **36** → Apply. *This drops Wi-Fi for about 30 s; do it before cameras connect.*
3. **NanoStation**: Slate LAN port → injector LAN; injector POE → NanoStation. Mount it **high** at home plate, **aimed at centerfield**.
4. Laptop joins **Thundercats** (should get 172.16.100.10).

## 2. Cameras (about 10 min)
1. Run **`start-game.ps1`**: starts the relay and OBS. **Leave the minimized MediaMTX window open all game.**
2. **VM35**: power on in CF. It joins `beaver-nano` on its own, and OBS picks it up by itself (F1) within about a minute.
3. **Beav**: device 1 → Mevo app → Go Live → Custom RTMP `rtmp://172.16.100.10:1935/live` key **`mevo1`** → check F2.
4. **Trey**: device 2 → same, key **`mevo2`** → check F3.

## 3. Check everything
Run **`check-system.ps1 -Field -SpeedTest`** (or `/check-system` in Claude Code).
- **Want: no FAIL**, upload **10+ Mbps**.
- Expected WARNs you can ignore: "laptop on Wi-Fi" (no USB-C Ethernet adapter yet), "Beav IP" (until it rejoins), "5 GHz channel" if Starlink is repeated over Wi-Fi.
- CPE510 lines are **SKIP/FAIL. Ignore them** (not in use; the NanoStation replaced them).

## 4. Strike zone (warmups)
1. F1 → click **Strike Zone** in Sources → drag/resize over the plate (knees to letters, plate width).
2. Optional: after the game, close OBS and run **`save-obs-config.ps1`** to keep the position.

## 5. Go live
1. GameChanger app → game → Stream → external/RTMP → copy **Stream URL** and **Stream Key** (email to yourself, then delete).
2. OBS → Settings → Stream: URL → **Server**, key → **Stream Key** → OK.
3. Start ~10 min early: OBS **Start Streaming** on **F2 (Mevo 3B)**. Check the GameChanger app on a phone (expect about 15 s delay).

**Hotkeys:** F1 CF + zone · F2 Mevo 3B (Beav) · F3 Mevo 1B (Trey) · F5/F6 zone on/off

## 6. During the game: if something drops
| Symptom | Fix |
|---|---|
| F2/F3 black | That Mevo stopped. Go Live again in its app (same key). OBS reconnects by itself. |
| F1 black / frozen | VM35 lost `beaver-nano`. Check VM35 power and the NanoStation aim. If it won't hold, stay on F2/F3. (F1 shows Mevo 3B automatically when CF is down.) |
| OBS bottom bar shows dropped frames / red | Starlink struggling. Settings → Output → bitrate 4500 → **3000**. |
| Everything dead | Slate 7 / Starlink power. Re-run `check-system.ps1 -Field`. |

## 7. End
1. **OBS: Stop Streaming FIRST**, then end the stream in GameChanger (otherwise OBS reconnects).
2. Stop both Mevos in their apps. Close OBS. Close the MediaMTX window.
3. Backup recording is in `C:\Users\rpbea\Videos\Baseball`.

## Untested going in
- **VM35 at ~350 ft to the NanoStation** was verified only at short range. Test it during setup: walk the VM35 out while someone watches F1. If it can't hold, fall back to the Mevos only.
- **Starlink upload**: the SpeedTest in step 3 tells you. Under about 8 Mbps → set the bitrate to 3000 before going live.
