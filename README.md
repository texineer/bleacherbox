# Yardbirds Baseball

Mobile-friendly web app for Perfect Game baseball parents. View schedules, tournament results, and opposing teams' pitch counts.

Default team: **RR Yardbirds 14U** (Perfect Game org 50903)

## Quick Start

```bash
npm install
cd client && npm install && npx vite build && cd ..
npm run scrape    # Fetch data from Perfect Game
npm run server    # Start server at http://localhost:3001
```

Open `http://localhost:3001` on your phone or desktop.

## Development

```bash
# Terminal 1: Start backend
npm run server

# Terminal 2: Start frontend dev server (with hot reload)
cd client && npm run dev
```

The Vite dev server proxies `/api` requests to the backend at `:3001`.

## Docker

```bash
docker-compose up -d
```

## How It Works

1. **Scraper** fetches your team's page from perfectgame.org (roster, schedule, tournament links)
2. **Pitching data** comes from each tournament's Pitching Restrictions page (free, no subscription required)
3. **Data is cached** in a local SQLite database
4. **Auto-refreshes** every 6 hours via cron, or manually via the Refresh button

Some finished features (DJ and walkup songs, Lunch, Baseball cards) are hidden for now. See
[docs/hidden-features.md](docs/hidden-features.md) for what they include and how to turn them back on.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/teams/:orgId/:teamId` | Team info + roster |
| `GET /api/teams/:orgId/:teamId/schedule` | Games grouped by tournament |
| `GET /api/teams/:orgId/:teamId/tournaments` | Tournament list |
| `GET /api/games/:gameId` | Game detail |
| `GET /api/tournaments/:eventId/pitching-report` | Pitch counts per player |
| `GET /api/pitch-rules/:ageGroup` | PG pitch count rules |
| `POST /api/scrape/:orgId/:teamId` | Trigger manual data refresh |

## Adding Another Team

Navigate to `/team/{orgId}/{teamId}` or use the Teams search tab. To find IDs, look at the team's Perfect Game URL:

```
https://www.perfectgame.org/PGBA/Team/default.aspx?orgid=50903&orgteamid=276649
                                                          ^^^^^          ^^^^^^
                                                          orgId          teamId
```
