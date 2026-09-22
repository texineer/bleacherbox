const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'bleacherbox.db');

let db = null;
let initPromise = null;

async function getDb() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const SQL = await initSqlJs();
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    initSchema();
    return db;
  })();

  return initPromise;
}

function initSchema() {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      name TEXT,
      age_group TEXT,
      hometown TEXT,
      classification TEXT,
      record TEXT,
      pg_url TEXT,
      last_scraped TEXT,
      PRIMARY KEY (pg_org_id, pg_team_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      number TEXT,
      position TEXT,
      bats TEXT,
      throws TEXT,
      grad_year TEXT,
      height TEXT,
      weight TEXT,
      hometown TEXT,
      UNIQUE(pg_org_id, pg_team_id, name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS player_walkup_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      song_type TEXT NOT NULL CHECK(song_type IN ('upload', 'youtube')),
      file_path TEXT,
      youtube_url TEXT,
      youtube_video_id TEXT,
      start_seconds REAL NOT NULL DEFAULT 0,
      end_seconds REAL NOT NULL DEFAULT 45,
      song_title TEXT,
      artist_name TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(pg_org_id, pg_team_id, player_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_soundboard (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      button_key TEXT NOT NULL,
      label TEXT NOT NULL,
      emoji TEXT,
      youtube_video_id TEXT,
      start_seconds REAL NOT NULL DEFAULT 0,
      end_seconds REAL NOT NULL DEFAULT 20,
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(pg_org_id, pg_team_id, button_key)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_playlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      song_title TEXT NOT NULL,
      artist_name TEXT,
      youtube_video_id TEXT,
      start_seconds REAL NOT NULL DEFAULT 0,
      end_seconds REAL NOT NULL DEFAULT 180,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tournaments (
      pg_event_id INTEGER PRIMARY KEY,
      name TEXT,
      start_date TEXT,
      end_date TEXT,
      location TEXT,
      pg_url TEXT,
      last_scraped TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS team_tournaments (
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      pg_event_id INTEGER NOT NULL,
      PRIMARY KEY (pg_org_id, pg_team_id, pg_event_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pg_game_id INTEGER UNIQUE,
      pg_event_id INTEGER,
      team_org_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      opponent_name TEXT,
      opponent_org_id INTEGER,
      opponent_team_id INTEGER,
      game_date TEXT,
      game_time TEXT,
      field TEXT,
      score_us INTEGER,
      score_them INTEGER,
      result TEXT,
      pg_box_url TEXT,
      pg_recap_url TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pitch_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER,
      pg_event_id INTEGER,
      player_name TEXT NOT NULL,
      team_name TEXT,
      pitches INTEGER,
      innings REAL,
      strikeouts INTEGER,
      walks INTEGER
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_games_team ON games(team_org_id, team_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_games_event ON games(pg_event_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pitch_counts_game ON pitch_counts(game_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pitch_counts_event ON pitch_counts(pg_event_id)');

  // Migration: add source columns for multi-source support (PG + Five Tool)
  try { db.run("ALTER TABLE tournaments ADD COLUMN source TEXT DEFAULT 'pg'"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN source TEXT DEFAULT 'pg'"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN source_game_key TEXT"); } catch(e) {}
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_games_source_key ON games(source_game_key)');

  // Migration: add multi-tenant fields to teams
  try { db.run("ALTER TABLE teams ADD COLUMN slug TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE teams ADD COLUMN ft_team_uuid TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE teams ADD COLUMN ft_seasons TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE teams ADD COLUMN logo_url TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE teams ADD COLUMN ft_base_url TEXT"); } catch(e) {}
  db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_slug ON teams(slug)');

  // Live scorebook tables
  db.run(`
    CREATE TABLE IF NOT EXISTS game_scorebook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      inning INTEGER NOT NULL DEFAULT 1,
      half TEXT NOT NULL DEFAULT 'top',
      outs INTEGER NOT NULL DEFAULT 0,
      balls INTEGER NOT NULL DEFAULT 0,
      strikes INTEGER NOT NULL DEFAULT 0,
      runner_1b TEXT,
      runner_2b TEXT,
      runner_3b TEXT,
      home_team_name TEXT,
      away_team_name TEXT,
      our_side TEXT NOT NULL DEFAULT 'home',
      started_at TEXT,
      ended_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lineup_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      team_side TEXT NOT NULL,
      batting_order INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      jersey_number TEXT,
      position TEXT,
      active INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS inning_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      inning INTEGER NOT NULL,
      half TEXT NOT NULL,
      runs INTEGER NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      UNIQUE(game_id, inning, half)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS plate_appearances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      inning INTEGER NOT NULL,
      half TEXT NOT NULL,
      batting_order_pos INTEGER NOT NULL,
      team_side TEXT NOT NULL,
      player_name TEXT NOT NULL,
      pitcher_name TEXT,
      outcome TEXT,
      pitch_sequence TEXT,
      rbi INTEGER NOT NULL DEFAULT 0,
      pa_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_pitches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL,
      pa_id INTEGER,
      pitcher_name TEXT NOT NULL,
      pitcher_team_side TEXT NOT NULL,
      pitch_type TEXT NOT NULL,
      inning INTEGER NOT NULL,
      half TEXT NOT NULL,
      pitch_seq INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add scoring_status to games
  try { db.run("ALTER TABLE games ADD COLUMN scoring_status TEXT DEFAULT 'none'"); } catch(e) {}

  // Migration: add hit tracking fields to plate_appearances
  try { db.run("ALTER TABLE plate_appearances ADD COLUMN hit_type TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE plate_appearances ADD COLUMN hit_x REAL"); } catch(e) {}
  try { db.run("ALTER TABLE plate_appearances ADD COLUMN hit_y REAL"); } catch(e) {}
  try { db.run("ALTER TABLE plate_appearances ADD COLUMN fielder TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE plate_appearances ADD COLUMN runs_scored INTEGER DEFAULT 0"); } catch(e) {}

  // Migration: extracted audio for iOS compatibility
  try { db.run("ALTER TABLE team_soundboard ADD COLUMN extracted_audio_path TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE team_playlist ADD COLUMN extracted_audio_path TEXT"); } catch(e) {}

  // Migration: extracted audio for YouTube walkup songs (iOS compatibility)
  try { db.run("ALTER TABLE player_walkup_songs ADD COLUMN extracted_audio_path TEXT"); } catch(e) {}

  // Migration: add bracket fields to games
  try { db.run("ALTER TABLE games ADD COLUMN game_type TEXT DEFAULT 'pool'"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN bracket_name TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN bracket_round TEXT"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN home_seed INTEGER"); } catch(e) {}
  try { db.run("ALTER TABLE games ADD COLUMN away_seed INTEGER"); } catch(e) {}

  // Migration: add batting order index tracking to game_scorebook
  try { db.run("ALTER TABLE game_scorebook ADD COLUMN home_batter_idx INTEGER DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE game_scorebook ADD COLUMN away_batter_idx INTEGER DEFAULT 0"); } catch(e) {}

  db.run('CREATE INDEX IF NOT EXISTS idx_lineup_game ON lineup_entries(game_id, team_side)');
  db.run('CREATE INDEX IF NOT EXISTS idx_pa_game ON plate_appearances(game_id, pa_order)');
  db.run('CREATE INDEX IF NOT EXISTS idx_live_pitches_game ON live_pitches(game_id, pitcher_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_inning_scores_game ON inning_scores(game_id)');

  // Auth tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_team_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'scorekeeper', 'viewer')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, pg_org_id, pg_team_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired_at)');

  // Migration: add announce flag and ElevenLabs audio path to walkup songs
  try { db.run("ALTER TABLE player_walkup_songs ADD COLUMN announce INTEGER NOT NULL DEFAULT 1"); } catch(e) {}
  try { db.run("ALTER TABLE player_walkup_songs ADD COLUMN announce_audio_path TEXT"); } catch(e) {}

  // Migration: add global admin and contact email fields to users
  try { db.run("ALTER TABLE users ADD COLUMN is_global_admin INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
  try { db.run("ALTER TABLE users ADD COLUMN contact_email TEXT"); } catch(e) {}

  // Migration: add baseball card image path to players
  try { db.run("ALTER TABLE players ADD COLUMN card_image_path TEXT"); } catch(e) {}

  // Stream config table
  db.run(`
    CREATE TABLE IF NOT EXISTS team_stream_config (
      pg_org_id INTEGER NOT NULL,
      pg_team_id INTEGER NOT NULL,
      youtube_url TEXT,
      is_live INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pg_org_id, pg_team_id)
    )
  `);
}

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function closeDb() {
  if (db) {
    saveDb();
    db.close();
    db = null;
    initPromise = null;
  }
}

async function seedGlobalAdmin() {
  const bcrypt = require('bcryptjs');
  const email = process.env.GLOBAL_ADMIN_EMAIL || 'ray@bleacherbox.app';
  const contactEmail = process.env.GLOBAL_ADMIN_CONTACT_EMAIL || 'ray@texineer.com';

  // If the admin already exists, just ensure the flag is set — never touch the password.
  const existing = db.exec('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    db.run('UPDATE users SET is_global_admin = 1, contact_email = ? WHERE email = ?', [contactEmail, email]);
    saveDb();
    return;
  }

  // First-time seed requires an explicitly provided password — no hardcoded default.
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!password) {
    console.warn(`[db] GLOBAL_ADMIN_PASSWORD not set — skipping global admin seed for ${email}. Set it to create the initial admin.`);
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  db.run(
    `INSERT INTO users (email, password_hash, display_name, is_global_admin, contact_email) VALUES (?, ?, ?, 1, ?)`,
    [email, hash, 'Ray', contactEmail]
  );
  saveDb();
  console.log(`[db] Global admin seeded: ${email}`);
}

module.exports = { getDb, saveDb, closeDb, seedGlobalAdmin };
