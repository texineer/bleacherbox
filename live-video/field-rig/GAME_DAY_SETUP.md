# Baseball Stream Setup: OBS → GameChanger

**Signal flow**

```
Mevo Start #1 ───── RTMP ─────┐
Mevo Start #2 ───── RTMP ─────┼──> Slate 7 ──> Laptop: MediaMTX relay ──> OBS
VM35 (CF) ── CPE510 bridge ───┘                                          │  you switch cameras (F1-F3)
                                                                         │  strike zone on the CF scene
                                                                         ▼
                                                  Starlink Mini ──RTMP──> GameChanger
                                                                         (adds the scorebug from the scorekeeper's app)
```

GameChanger adds its own scorebug on top of your feed, so OBS only needs the cameras and the strike zone.

---

## 1. Network (GL.iNet Slate 7 + 2x TP-Link CPE510)

```
                         HOME PLATE AREA                                   CENTERFIELD
Starlink Mini ─(Ethernet adapter or Wi-Fi)─> Slate 7 (172.16.100.1)
                                              ├─ LAN ── Laptop (OBS)
                                              ├─ 5 GHz Wi-Fi ── Mevo #1, Mevo #2
                                              └─ LAN ── PoE inj ── CPE510 "HP"  ))) 5 GHz )))  CPE510 "CF" ── PoE inj ── VM35
                                                                   (Access Point)               (Client)
```

Everything ends up on one flat network (172.16.100.x), so OBS sees the VM35 as if it were plugged into the Slate 7.

### Slate 7
- **Internet from Starlink:** best is the **Starlink Mini Ethernet adapter** into the Slate 7's WAN port. If you don't have one, use **Repeater** mode joined to the Starlink Wi-Fi **on 2.4 GHz**, which keeps 5 GHz free for the Mevos.
- Wi-Fi name: **Thundercats** (WPA2, one name on 2.4 + 5 GHz).
- **At the field:** set 5 GHz to a **fixed channel 36** (80 MHz), not Auto, so it stays clear of the CPE510 link on 149/157. (At home it's pinned to 149 because the Slate repeats "Beaver Den" on its 5 GHz radio. A repeater always follows its upstream's channel.)

#### Verified 2026-10-03 (laptop on Thundercats)
| Item | Value |
|---|---|
| Slate 7 LAN / admin page | **172.16.100.1** (`http://172.16.100.1`). It uses 172.16.100.x, *not* the GL.iNet default 192.168.8.x |
| Laptop (Surface) Wi-Fi MAC | `B8-5C-5C-01-11-EF` |
| Laptop IP | **172.16.100.10** (DHCP reservation `ray-surface`, added 2026-10-03) |
| Link | 5 GHz, ch 149, 802.11ax, about 1.4 Gbps, 100% signal (at home, next to the router) |
| Internet through Slate 7 | Working |
| Windows network type | Set to **Private** |

Planned addresses: laptop `.10`, CPE510 HP `.2`, CPE510 CF `.3`, VM35 `.50`, Mevo 3B `.51`, Mevo 1B `.52` (all 172.16.100.x).

#### Slate 7 config (read over SSH, 2026-10-03)
- GL-BE3600, firmware **4.10.1**. SSH key access set up from this laptop (`ssh root@172.16.100.1`).
- LAN 172.16.100.1/24 static; DHCP pool **.100–.249**, 12 h leases. Addresses .2–.99 are free for reservations.
- Thundercats on 2.4 GHz (auto, HT40 → ch 11) and 5 GHz (auto, 80 MHz → ch 149); WPA2; **client isolation off** (required); TX power max.
- Guest, IoT, and MLO networks disabled.
- Internet: **repeater on the 5 GHz radio to "Beaver Den"** (home). The Ethernet WAN (`eth0`, DHCP) is configured but unused. Saved repeater networks include hotel/cabin Wi-Fi.
- Reservations (added 2026-10-03). MAC addresses are kept out of this public repo, in `site.local.json` (copy `site.example.json`):

  | Name | MAC | IP |
  |---|---|---|
  | `ray-surface` (laptop Wi-Fi) | `site.local.json` → laptop | **172.16.100.10** |
  | `mevo-beav` (Mevo **Beav** = 3B cam, key `mevo1`) | `site.local.json` → beav | **172.16.100.51** (takes effect next time it joins; was .131) |
  | `mevo-trey` (Mevo **Trey** = 1B cam, key `mevo2`) | `site.local.json` → trey | **172.16.100.52** (active) |
  | `vm35-cf` (NearStream **VM35**, centerfield) | `site.local.json` → vm35 | **172.16.100.50** (takes effect next time it joins; was .164 on 5 GHz Wi-Fi) |

- Verified 2026-10-03, custom RTMP to the relay works for both:
  - **Beav:** 1920x1080 30 fps H.264 Main + AAC stereo, about 5.8 Mbps → OBS "Cam - Mevo 3B"
  - **Trey:** 1920x1080 30 fps H.264 + AAC stereo, about 5.3 Mbps → OBS "Cam - Mevo 1B"
  - Mevos expose only ports 80/443 (no RTSP/NDI enabled).

#### Field changes still needed on the Slate 7
1. Plug the Starlink Mini (with its Ethernet adapter) into the **WAN port**. Don't repeat Starlink Wi-Fi on 5 GHz.
2. Fix 5 GHz to **channel 36 / 80 MHz**.
3. Address reservations for the Mevos, VM35, and CPEs (the laptop is done).
- Under LAN/DHCP, reserve addresses: VM35 → `172.16.100.50`, Mevo #1 → `.51`, Mevo #2 → `.52`.

### CPE510 pair (do this once at home, on a table, before mounting)
Set up each one by plugging it into a laptop through its PoE injector (LAN port → laptop). The default address is `http://192.168.0.254`, login admin/admin.

| Setting | CPE510 "HP" (home plate) | CPE510 "CF" (centerfield) |
|---|---|---|
| Operation mode | **Access Point** | **Client** |
| SSID | `CF-LINK` (hidden is fine) | Survey → join `CF-LINK` |
| Security | WPA2-PSK, same password | same |
| WDS | **On** | **On** (needed so the VM35 is reachable on 172.16.100.x) |
| Channel / width | Fixed, **149 or 157**, 20–40 MHz (well away from the Slate 7's ch 36) | follows AP |
| MAXtream | On or Off, **same on both** | same |
| Distance setting | ~0.2 km | ~0.2 km |
| Management IP | `172.16.100.2` / gw `172.16.100.1` | `172.16.100.3` / gw `172.16.100.1` |
| DHCP server | **Off** | **Off** |

After that you can manage both from the field laptop at .2 and .3.

### Mounting and aiming
- Put each CPE510 **high**, above players' heads: backstop or press box at home plate, and the top of the CF fence or a light pole in the outfield. Aim them at each other; their beam is fairly narrow.
- Use the CPE's signal LEDs or the **Status** page (signal around -50 to -65 dBm is great at this distance). Expect 50–100+ Mbps; the VM35 needs about 10.
- Putting the CPE in a different spot than the VM35 is fine. Any normal Ethernet cable up to 100 m runs between the CF injector and the camera.

### Power in centerfield
The CF CPE's PoE injector and the VM35 both need power. With no outlet, a small **portable power station** (Jackery/EcoFlow class) runs both for a full doubleheader. Test the runtime once at home.

### Other notes
- Laptop: **wired** to the Slate 7.
- The camera feeds (Mevo RTMP, VM35) stay on the local network and **don't use Starlink upload**.
- Mevo Starts work on the Slate 7's 5 GHz Wi-Fi. A USB-C Ethernet adapter with power pass-through is more reliable if a cable can reach.

## 2. The laptop (Surface, Snapdragon X Elite)

This is an **ARM** laptop, which shapes the setup:
- **OBS 32.2.2 native ARM64** is installed (via winget). It has **no hardware encoder** on Snapdragon, so it uses x264 (software). Tested at 1080p30 / 4500 kbps with 3 sources: **0 dropped frames, low CPU**.
- The **NDI plugin (DistroAV) has no Windows ARM64 build**, so the Mevos don't use NDI. Each Mevo instead sends **RTMP** to a small relay (**MediaMTX**) on the laptop, and OBS reads from the relay.
- Browser-source hardware acceleration is **off** (required on ARM64 for the strike zone).

### Files in this folder
| File | What it does |
|---|---|
| `start-game.ps1` | **Game day:** starts the relay, prints the Mevo RTMP settings, opens OBS, starts the game monitor |
| `check-system.ps1` | **Health check** of everything: laptop, Slate 7, internet, Starlink dish, each camera, CPE510s, relay, OBS and its settings. PASS/WARN/FAIL list. Add `-Field` at the ballfield (stricter), `-SpeedTest` for the network tests (~90 s: ping quality, and upload measured from the router and from the laptop, which separates Starlink from Wi-Fi). In Claude Code, `/check-system` runs it and explains fixes. |
| `game-monitor.ps1` | Runs during the game (started by `start-game.ps1`), logging each network hop every 5 s to `logs\games\<date>\` |
| `analyze-game.ps1` | **After the game**, still on Thundercats: writes `logs\games\<date>\game-report.md`. Covers disconnects and which hop caused each, bitrate, dark camera feeds, audio, the Starlink outages and router WAN events |
| `vm35-release.ps1` / `vm35-resume.ps1` | Frees the VM35 for the NearStream app (zoom, focus, resolution) without stopping the relay: the Mevos stay live and OBS stays open, only Cam - CF goes dark until resume. **Close the NearStream app before resuming.** For framing changes, cropping Cam - CF in OBS needs no camera access at all (lossless up to 1.5x when streaming 720p) |
| `test-upload.ps1` | Can one connection hold the stream bitrate? Uploads at a steady rate like OBS (default 2000/3000/4500 kbps) and reports HOLDS/MARGINAL/FAILS. Starlink's app speed test uses many connections and overstates this |
| `setup-router-logging.ps1` | One-time: keeps the Slate 7 log in flash so a reboot doesn't erase it |
| `test-cameras.ps1` | Fake Mevo feeds to practice switching at home (`-Stop` to end) |
| `install-obs-config.ps1` | Copies the scenes/profile below into OBS (`-Force` to overwrite) |
| `save-obs-config.ps1` | The reverse: after adjusting things in OBS (strike zone etc.), close OBS and run this to save them here. It never copies the stream key. |
| `obs/scenes/Baseball.json` | OBS scene collection |
| `obs/profiles/GameChanger/` | OBS profile (video, encoder, output settings) |
| `tools/mediamtx/baseball.yml` | Relay config, **including the VM35's RTSP URL**. It also **records every camera raw** to `Videos\Baseball\raw\<camera>\` (about 2-3 GB per camera per hour, deleted after 7 days; set `record: no` to turn off). That footage is for the ball-tracer work and serves as a backup of each angle |
| `overlays/strikezone.html` | Strike zone overlay |

To run a script: right-click → **Run with PowerShell**, or in a terminal
`powershell -ExecutionPolicy Bypass -File .\start-game.ps1`

### Laptop IP
In the Slate 7 admin page (`172.16.100.1`) → LAN/DHCP, **reserve 172.16.100.10 for this laptop's wired adapter** (and its Wi-Fi too if you ever use it). The Mevos are pointed at that address. When Windows asks about the Slate 7 network, choose **Private**.

## 3. Mevo Starts → OBS (RTMP via the relay)

**The Mevo app can only have ONE camera live to RTMP at a time per device.** So use **two devices** (phone + tablet or second phone), one per Mevo. (Mevo Studio/Multicam isn't used: it mixes cameras into a single stream, which would bypass OBS switching.)

**Game-day routine:**
1. Run `start-game.ps1` first, so the relay is listening.
2. Both devices on **Thundercats**. Power on both Mevos (they rejoin Thundercats on their own).
3. **Device 1 → Beav:** 1080p / 30 fps → Go Live → **Custom RTMP** → server + key `mevo1`. Confirm **Cam - Mevo 3B** shows video in OBS (F2).
4. **Device 2 → Trey:** same, key `mevo2`. Confirm **Cam - Mevo 1B** in OBS (F3).
5. Leave both live for the whole game, and keep both devices on charge. Stopping a Mevo in its app cuts its feed; OBS picks it back up within a few seconds of going live again.

Verified 2026-10-03: both live at once from two devices, about 7.7 Mbps total on the Slate 7's 5 GHz, both feeds in OBS. Measured delay camera → OBS: **1–2 s** on each Mevo (wave test).

   | Camera | Server URL | Stream key |
   |---|---|---|
   | **Beav** (3B side) | `rtmp://172.16.100.10:1935/live` | `mevo1` |
   | **Trey** (1B side) | `rtmp://172.16.100.10:1935/live` | `mevo2` |

   Bitrate in the Mevo app: about 4–6 Mbps. This only travels over the local Wi-Fi and doesn't touch Starlink.
4. The camera keeps streaming itself, so you can switch the app to the other Mevo and start it too.
5. In OBS they appear as **Cam - Mevo 3B** and **Cam - Mevo 1B**. If a Mevo drops, OBS reconnects automatically within a few seconds (tested).

Expect the Mevo feeds to run about 1–2 s behind real time. Because everything is delayed the same way, switching still looks natural.

## 4. NearStream VM35 → OBS

**Centerfield link (decided 2026-10-04): NanoStation M5 at home plate, VM35 on its Wi-Fi.** The VM35 has no Ethernet port, and you didn't want a cable to the camera. The CPE510s are on hold (no 24 V PoE injectors).

```
Slate 7 LAN ── PoE injector ── NanoStation M5 (172.16.100.4, AP, aimed at CF)  )))  ~350 ft  )))  VM35 (Wi-Fi)
```
| NanoStation setting | Value |
|---|---|
| Mode | Access Point, network mode **Bridge** |
| SSID | `beaver-nano` (WPA2) |
| Channel | **157** (5785 MHz). Clear of Thundercats (149 home / 36 field) |
| airMAX | **Off** (required, or the VM35 can't join) |
| Management IP | 172.16.100.4 (static), gateway 172.16.100.1 |

Verified at home 2026-10-04: VM35 joined `beaver-nano`, kept 172.16.100.50 (bridged; the Slate sees it on its LAN port), relay reconnected on its own, 1080p30. **Distance test (~350 ft) still to do.**
Backup plans if the VM35's own antenna can't reach: NanoStation + EAP225-Outdoor (2.4 GHz AP next to the VM35) in CF, or the CPE510 pair with two 24 V passive injectors.

- MediaMTX pulls the camera over the CPE510 link and keeps reconnecting if the link drops. OBS reads it as **Cam - CF** (`rtsp://127.0.0.1:8554/vm35`).
- **RTSP address (verified 2026-10-03):** `rtsp://172.16.100.50:554/live/mainstream` (no login). Already set in `tools/mediamtx/baseball.yml`. No "Go Live" needed on the camera; the relay pulls it automatically whenever it's powered on and reachable.
- The camera's `/live/substream` doesn't exist, and it has no web page (ports open: 554 RTSP, 1935 RTMP). Settings are in the NearStream app.
- Stream: **1920x1080 30 fps H.264, about 4.2 Mbps** (AAC audio, muted in OBS). It came as 720p / 2.3 Mbps; after setting 1080p in the NearStream app, **the camera had to be restarted** before the RTSP stream changed.
- Recovery tested: after a VM35 power cycle, OBS reconnected "Cam - CF" on its own about 40 s later.
- Lock the camera's position, zoom, and focus after you place the strike zone. Any bump means re-aligning it.

## 5. OBS scenes and hotkeys (already set up)

Profile **GameChanger**, scene collection **Baseball**. 1920x1080, 30 fps.

| Scene | Contents | Hotkey |
|---|---|---|
| `CF - Pitch` | VM35 + **Strike Zone** | **F1** |
| `Mevo 3B` | Mevo #1 | **F2** |
| `Mevo 1B` | Mevo #2 | **F3** |
| Strike Zone on / off | (in CF - Pitch) | **F5 / F6** |

- Hotkeys work even when OBS isn't the active window.
- **Audio:** Mevo 3B is the ambient mic for every scene (it sits hidden behind the other cameras). The other cameras are muted. If the CF feed is ever down, the CF scene shows Mevo 3B instead of black.
- Each game is also **recorded locally** to `Videos\Baseball` as a backup (hybrid MP4, no extra CPU).

### Lining up the strike zone
1. Switch to `CF - Pitch` (F1) during warmups.
2. Click **Strike Zone** in Sources, then drag and resize the red-outlined box over the plate, from the knees to the letters and as wide as the plate. Lock it (padlock icon) when done.
3. Change the look by right-clicking Strike Zone → Properties and editing the URL options: `style=corners` (brackets only), `grid=1` (3x3 grid), `fill=0.08` (light tint), `color=ffd400`, `width=4`, `shadow=0`.

## 6. Streaming to GameChanger

1. In the GameChanger app, open the game → Stream → choose the **external / RTMP** streaming option. It gives you a **Server URL** and a **Stream Key**. (It's RTMP, not RTSP.)
2. In OBS, go to Settings → Stream (Service is already **Custom**) and paste the server URL and key.
3. Output is preconfigured: x264 veryfast, **CBR 4500 kbps**, keyframe **2 s**, AAC 128 kbps, **dynamic bitrate on** (OBS lowers bitrate automatically if Starlink dips), auto-reconnect on.
   - **Two OBS profiles** (menu Profile): **GameChanger** = 1080p at 4500 kbps; **GameChanger 720** = 720p at 3000 kbps (Lanczos scaling). `check-system.ps1 -Field -SpeedTest` names the one to use. 1080p needs a minimum upload of about 8 Mbps; below that, 720p at a steady 3000 looks better than a starved 1080p. The stream key is per profile, so paste today's key into the one you use.
4. The scorekeeper scores in GameChanger as usual, and the scorebug appears on the stream automatically.
5. **Ending: click "Stop Streaming" in OBS FIRST, then end the stream in GameChanger.** If GameChanger ends first, OBS's auto-reconnect connects again and keeps pushing video.
6. Then run `analyze-game.ps1` before leaving Thundercats.

**Game 2026-10-07 (Starlink):** live 2 h, 10 disconnects, 5.6 min off air. The average bitrate sent was about 1400 of 4500 kbps. No test separated Starlink from Wi-Fi, which is why the router-side upload test and the game monitor exist.

**Test stream 2026-10-03 (home internet via Slate 7 repeater):** RTMPS to GameChanger (Amazon IVS ingest) connected in under 1 s; 4 min 20 s at 4500 kbps with all 3 cameras; **no dropped frames**; OBS used under 1 of 12 CPU cores. Viewer delay in the GameChanger app is **about 15 s**. That's normal for the platform's buffering, not something our setup adds. Check whether the scorebug runs ahead of the video.

## 7. Pre-game checklist
- [ ] Starlink Mini has a clear sky view and is connected; run a speed test (upload should be at least 2x your bitrate)
- [ ] Slate 7 on; laptop wired in
- [ ] CF power station on; CPE510 link up (ping 172.16.100.3, then the VM35 at .50)
- [ ] Run `start-game.ps1` (relay + OBS)
- [ ] Run `check-system.ps1 -Field -SpeedTest`: no FAILs, "Bitrate vs upload" PASS, Starlink obstruction under 0.5%, Audio PASS
- [ ] All three cameras live and VM35 zoom/resolution set **before** going live: after that, no relay restarts or router changes
- [ ] Both Mevos streaming to the laptop (OBS shows Cam - Mevo 3B / 1B live)
- [ ] CF camera feed is live (F1) and its position/zoom is locked
- [x] (One-time) VM35 set to 1080p30 in the NearStream app + restarted (done 2026-10-03)
- [ ] Strike zone lined up on a batter during warmups
- [ ] Scene hotkeys tested
- [ ] Stream key pasted for **today's** game (GameChanger keys can be per-game)
- [ ] Start streaming about 10 min early on the Mevo 3B scene; check the GameChanger app on a phone
- [ ] Laptop on AC power; disable sleep and Windows Update for game time
