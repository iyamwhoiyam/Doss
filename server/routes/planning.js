/** Time-phased material planning. */
import { Router } from 'express';

import { requirePermission } from '../lib/auth.js';
import { route, num } from '../lib/http.js';
import { planRequirements } from '../calc/mrp.js';

export function planningRouter(db) {
  const router = Router();
  router.use(requirePermission('cost.view'));

  router.get('/mrp', route((req, res) => {
    const weeks = Math.min(26, Math.max(4, num(req.query.weeks, 12)));
    res.json(planRequirements(db, { weeks }));
  }));

  return router;
}
