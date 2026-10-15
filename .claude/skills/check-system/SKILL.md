---
name: check-system
description: Pre-game health check of the baseball live-stream rig (laptop, Slate 7 "Thundercats" router, internet/Starlink, Mevo Beav/Trey, NearStream VM35, CPE510 bridge, MediaMTX relay, OBS). Use when the user asks to check, verify, or troubleshoot the stream setup, cameras, Wi-Fi, or router before or during a game.
---

# Baseball stream system check

## Run it
From the field-rig folder (`live-video\field-rig` in this repo; `C:\Users\rpbea\Documents\bleacherbox\live-video\field-rig` on the stream laptop). All scripts named below live there:

```
powershell -NoProfile -ExecutionPolicy Bypass -File .\live-video\field-rig\check-system.ps1 [-Field] [-SpeedTest]
```

- Add `-Field` when the user is at the ballfield, or says "game day" or "field". It's stricter: it expects Starlink on the WAN port, 5 GHz fixed on channel 36, the laptop wired, and the CPE510s up.
- Add `-SpeedTest` when internet or Starlink quality is in question, or on the first check of a game day (about 90 s). It runs 30 s of ping to the router and to 1.1.1.1, a laptop-to-router copy, and sustained upload measured **from the Slate 7** and **from the laptop**. Comparing the two pins slow upload on Wi-Fi or on Starlink, and the OBS check then says whether the bitrate fits.
- Starlink dish checks (obstruction, drops, alerts, outages) run on every check when the dish API at 192.168.100.1:9200 answers. That needs `grpcurl`.
- After the game, run `analyze-game.ps1` while still on Thundercats. It writes `logs\games\<date>\game-report.md` and names the failing hop for each disconnect, using the `game-monitor.ps1` CSV that `start-game.ps1` records.
- The exit code is the number of FAILs. The script is read-only and changes nothing.

If the user didn't say where they are, ask, or infer from context (`-Field` if the Slate 7's internet source isn't the `sta*` repeater).

## Report back
Lead with the summary line, then list only the FAIL and WARN items, each with its fix from the table below. Don't repeat every PASS. Present it like a crew chief's pre-game checklist: what's wrong, what to do, who does it.

## Fixes

| Check | Likely cause → fix | Who |
|---|---|---|
| Laptop not on Slate 7 network | Join Wi-Fi **Thundercats**, or plug into the Slate 7 | user |
| Laptop IP not .10 | A wired adapter is a new MAC. Add a Slate 7 DHCP reservation for it (ask first), and remember the Mevo RTMP URL uses .10 | Claude (with OK) |
| Laptop on battery | Plug in AC | user |
| Router not reachable | Slate 7 power. Laptop on the wrong network | user |
| SSH failed | Key not installed or router reset. Reinstall: `cat ~/.ssh/id_ed25519.pub \| ssh root@172.16.100.1 "cat >> /etc/dropbear/authorized_keys"` in a separate terminal | user |
| Internet source = repeater (field) | Plug Starlink Mini (Ethernet adapter) into the Slate 7 **WAN** port | user |
| No default route / no internet | Starlink not connected, obstructed, or still booting. Check the Starlink app | user |
| 5 GHz channel ≠ 36 (field) | Over SSH: `uci set wireless.wifi1.channel='36'; uci commit wireless; wifi reload`. **Ask first: it briefly drops all Wi-Fi, including the Mevos and laptop** | Claude (with OK) |
| Router upload low (Starlink) | Starlink obstruction or congestion. Check the obstruction result and the Starlink app, move the dish, then lower the OBS bitrate as the "Bitrate vs upload" line says | user/Claude |
| Laptop upload much lower than router's | Laptop Wi-Fi is the limit. Plug the laptop into the Slate 7 (through the switch) | user |
| Laptop → router ping loss | Wi-Fi interference or distance. Move the laptop closer or wire it | user |
| Profile for today WARN | OBS menu **Profile → GameChanger** (1080p, 4500) or **GameChanger 720** (720p, 3000), as the check says. Then paste today's stream key into that profile (Settings → Stream). `-UploadMbps <n>` picks the profile from a number read off the Starlink app | user |
| Bitrate vs upload WARN, "even 720p is over" | Fix the upload first (Starlink view, wire the laptop). Otherwise lower the GameChanger 720 bitrate to the suggested number (Settings → Output). **Close OBS first if Claude edits the files** | user/Claude (with OK) |
| Audio WARN | OBS mixer: unmute Cam - Mevo 3B (the ambient mic), mute the others | user |
| Starlink obstruction > 0.5% / outages | Re-aim or move the dish to a clear view of the sky. Check its power | user |
| Starlink rebooted recently | Power dip or loose cable at the Starlink Mini. Check the power source | user |
| WAN port link FAIL | Starlink Ethernet adapter cable unplugged, or Starlink off | user |
| LAN port link FAIL (field) | PoE injector LAN cable not in the Slate 7 LAN port | user |
| Log saved to flash WARN | Run `setup-router-logging.ps1` (only restarts the router's logging, nothing else drops) | Claude |
| Game monitor not running | Run `start-game.ps1` (it starts the monitor if missing) | Claude |
| Mevo not on Wi-Fi | Power on, or rejoin Thundercats in the Mevo app | user |
| Mevo not streaming to relay | Mevo app (tap that camera's link on the "Mevo Quick-Start" page, or one phone: start one camera, then switch to the other; it keeps streaming): Go Live → Custom RTMP `rtmp://172.16.100.10:1935/live`, key `mevo1` (Beav) or `mevo2` (Trey) | user |
| Mevo IP ≠ reserved | Harmless. It switches to the reserved address next time it rejoins | — |
| VM35 port 554 closed | Still booting (about 40 s), or no power or link in CF | user |
| VM35 video not 1080p | NearStream app → 1080p, then **restart the camera** (the setting only applies after a reboot) | user |
| Relay not pulling VM35 | MediaMTX not running, or the camera only just came up (the relay retries by itself) | Claude |
| VM35 "RELEASED for the NearStream app" | Close the NearStream app, then run `vm35-resume.ps1` | Claude |
| NearStream app says camera busy | Run `vm35-release.ps1` (only CF goes dark; Mevos and OBS keep running). **Never stop the whole relay for this.** Re-check live status first | Claude |
| CPE510 not answering | PoE injector power, cable to injector LAN/PoE port, aim. At home they may not be set up yet (SKIP) | user |
| MediaMTX not running | Run `start-game.ps1` | Claude |
| Firewall rule missing | Run `install-obs-config.ps1` (UAC prompt) | Claude |
| OBS feeds < 3 | See which camera is down above. OBS reconnects by itself within seconds once the feed is back | — |
| OBS profile/scenes wrong | OBS → Profile → GameChanger; Scene Collection → Baseball | user |

## Rules
- Router (Slate 7) **reads are fine; any `uci set` / commit / reload needs the user's OK first**, and say what it will disrupt.
- Never print or ask for the GameChanger stream key.
- Before anything that drops feeds (stopping MediaMTX, a router change or reboot), re-run the check or look at "OBS stream" **right then**, never relying on an earlier result. If it's LIVE, say so and wait for the user.
- Don't start or stop the OBS stream. That's the user's call. (Remind them: on game end, stop in OBS first, then GameChanger.)
- Details of the whole setup are in `live-video/field-rig/GAME_DAY_SETUP.md`. Camera MACs are in `live-video/field-rig/site.local.json` (local only, never commit it).
