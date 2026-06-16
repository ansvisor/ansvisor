import { Router } from 'express';
import promptRoutes from './prompts.js';
import trackingRoutes from './tracking.js';
import volumeRoutes from './volumes.js';
import contentRoutes from './content.js';
import competitorRoutes from './competitors.js';
import topicRoutes from './topics.js';
import auditRoutes from './audits.js';

const router = Router();

router.use('/prompts', promptRoutes);
router.use('/tracking', trackingRoutes);
router.use('/volumes', volumeRoutes);
router.use('/content', contentRoutes);
router.use('/competitors', competitorRoutes);
router.use('/topics', topicRoutes);
router.use('/audits', auditRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', user: req.user?.id });
});

export default router;
