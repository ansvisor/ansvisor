import { Router } from 'express';
import promptRoutes from './prompts.js';
import trackingRoutes from './tracking.js';
import volumeRoutes from './volumes.js';
import contentRoutes from './content.js';
import contentPageRoutes from './content-pages.js';
import contentDraftRoutes from './content-drafts.js';
import competitorRoutes from './competitors.js';
import topicRoutes from './topics.js';
import auditRoutes from './audits.js';
import reportRoutes from './reports.js';
import integrationRoutes from './integrations.js';
import mentionRoutes from './mentions.js';
import brandRoutes from './brands.js';
import actionCenterRoutes from './action-center.js';
import botRoutes from './bots.js';
import billingRoutes from './billing.js';

const router = Router();

router.use('/prompts', promptRoutes);
router.use('/tracking', trackingRoutes);
router.use('/volumes', volumeRoutes);
router.use('/content', contentRoutes);
router.use('/content-pages', contentPageRoutes);
router.use('/content-drafts', contentDraftRoutes);
router.use('/competitors', competitorRoutes);
router.use('/topics', topicRoutes);
router.use('/audits', auditRoutes);
router.use('/reports', reportRoutes);
router.use('/integrations', integrationRoutes);
router.use('/mentions', mentionRoutes);
router.use('/brands', brandRoutes);
router.use('/action-center', actionCenterRoutes);
router.use('/bots', botRoutes);
router.use('/billing', billingRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', user: req.user?.id });
});

export default router;
