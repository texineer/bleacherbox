// Five Tool-only teams are stored with placeholder Perfect Game IDs at or above
// this value (see syntheticPgIds in server/scrapers/fivetool.js).
const SYNTHETIC_PG_ID_MIN = 900000000

// True when the team has a real Perfect Game profile.
export function hasPerfectGame(pgOrgId) {
  return pgOrgId < SYNTHETIC_PG_ID_MIN
}
