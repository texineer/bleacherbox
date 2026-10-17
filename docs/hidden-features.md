# Hidden Features

BleacherBox has three finished features that are switched off for now while the
app focuses on schedules, scores, pitch counts, scoring, and streaming. Their code
is still in the repo and still works; only the app UI hides them.

To bring one back, set its flag to `true` in
[`client/src/features.js`](../client/src/features.js), rebuild the client, and
deploy. That restores the nav tab, the page route, and any related UI listed below.

| Feature | Flag | Hidden since |
|---|---|---|
| BleacherBox DJ (with walkup songs) | `dj` | 2026-10-16 |
| Lunch finder | `lunch` | 2026-10-16 |
| Baseball card maker | `baseballCard` | 2026-10-16 |

While a feature is hidden, its tab is removed from the team nav, its URL (for
example `/yardbirds/dj`) no longer opens the page, and the Features page doesn't
mention it. The server API routes and database tables stay in place, so any data
teams already saved is kept and reappears when the feature is turned back on.

---

## BleacherBox DJ — `dj`

A game-day sound system for the team's PA speaker.

- **Walkup songs:** each player gets a walkup song, from a YouTube clip (start and
  end time) or an uploaded audio file. Set on the **Roster** page, which is hidden
  along with the DJ.
- **PA announcements:** "Now batting, number 7, Mason Clark!" Generated with
  ElevenLabs text-to-speech, then played before the walkup song.
- **Soundboard:** buttons for stadium sounds and clips.
- **Playlist:** between-innings music.

**Code**

- Page: `client/src/pages/BleacherBoxDJ.jsx` (route `/:slug/dj`)
- Walkup editor: `client/src/components/WalkupSongManager.jsx` (used in `client/src/pages/Roster.jsx`)
- API (in `server/routes/api.js`):
  - `GET|PUT /api/teams/:orgId/:teamId/soundboard[/:buttonKey]`
  - `GET|POST|PUT|DELETE /api/teams/:orgId/:teamId/playlist[/:id]`
  - `GET|DELETE /api/teams/:orgId/:teamId/players/:playerName/walkup-song`
  - `POST /api/teams/:orgId/:teamId/players/:playerName/walkup-song/upload`
  - `POST /api/teams/:orgId/:teamId/players/:playerName/walkup-song/youtube`
- Tables: `player_walkup_songs`, `team_soundboard`, `team_playlist`
- Files: `data/walkups/` (served at `/walkups/...`)

**Needs to run**

- `yt-dlp` and `ffmpeg` on the server, to cut YouTube clips into MP3s (needed
  for iPhone playback)
- `ELEVENLABS_API_KEY` (optional `ELEVENLABS_VOICE_ID`) in `.env`, for the
  announcer voice

---

## Lunch finder — `lunch`

Uses the phone's location to open Google Maps searches for food near the ballpark
("lunch near me" between games).

**Code**

- Page: `client/src/pages/Lunch.jsx` (route `/:slug/lunch`)
- No server routes or tables. It links out to Google Maps.

**Needs to run:** the browser's location permission. Nothing on the server.

---

## Baseball card maker — `baseballCard`

Builds a trading-card style image for a player from an uploaded photo (with
cropping), the player's name, number, and position, and the team's name and logo,
then saves it to the player.

**Code**

- Page: `client/src/pages/BaseballCard.jsx` (route `/:slug/baseball-card`), uses `react-image-crop`
- API: `POST|DELETE /api/teams/:orgId/:teamId/players/:playerName/baseball-card`
- Column: `players.card_image_path`
- Files: `data/cards/<orgId>/<teamId>/` (served at `/cards/...`)

**Needs to run:** nothing extra.
