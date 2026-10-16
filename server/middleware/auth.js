const queries = require('../db/queries');

// Accounts awaiting admin approval are treated as signed out.
async function getApprovedUser(id) {
  const user = await queries.getUserById(id);
  return user?.approved ? user : null;
}

async function loadUser(req) {
  if (!req.user && req.session?.userId) {
    req.user = await getApprovedUser(req.session.userId);
  }
  return req.user;
}

async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = await loadUser(req);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User not found' });
  }
  next();
}

function requireTeamRole(allowedRoles) {
  return async (req, res, next) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await loadUser(req);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found' });
    }

    // Global admins bypass team role checks
    if (user.is_global_admin) {
      req.teamRole = 'admin';
      return next();
    }

    try {
      let orgId = parseInt(req.params.orgId);
      let teamId = parseInt(req.params.teamId);

      if (!orgId || !teamId) {
        const gameId = parseInt(req.params.gameId);
        if (gameId) {
          const team = await queries.getTeamFromGameId(gameId);
          if (!team) return res.status(404).json({ error: 'Game not found' });
          orgId = team.team_org_id;
          teamId = team.team_id;
        }
      }

      if (!orgId || !teamId) {
        return res.status(400).json({ error: 'Cannot determine team context' });
      }

      const role = await queries.getUserRoleForTeam(req.user.id, orgId, teamId);
      if (!role || !allowedRoles.includes(role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.teamRole = role;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

async function requireGlobalAdmin(req, res, next) {
  await loadUser(req);
  if (!req.user?.is_global_admin) {
    return res.status(403).json({ error: 'Global admin access required' });
  }
  next();
}

// Reject requests whose orgId/teamId route params aren't plain positive
// integers. Runs BEFORE multer disk storage so a value like "5/../../etc"
// can never reach path.join() and traverse outside the data directory.
function validateTeamParams(req, res, next) {
  const intRe = /^\d+$/;
  for (const key of ['orgId', 'teamId']) {
    const val = req.params[key];
    if (val !== undefined && !intRe.test(val)) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }
  next();
}

async function optionalAuth(req, res, next) {
  if (req.session?.userId) {
    req.user = await getApprovedUser(req.session.userId);
  } else {
    req.user = null;
  }
  next();
}

module.exports = { requireAuth, requireTeamRole, requireGlobalAdmin, optionalAuth, validateTeamParams };
