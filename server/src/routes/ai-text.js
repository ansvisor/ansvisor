import { Router } from 'express';
import { z } from 'zod';
import { MAX_ROWS, TRANSLATABLE, translatedTexts } from '../lib/ai-text-translate.js';
import { aiTextLimiter } from '../middleware/rate-limiter.js';

/**
 * AI-written text in the reader's language (LOC-010): the web app asks for
 * the rows on screen, by kind and id, in the person's interface language,
 * and gets back their translated fields (ai-text-translate.js). The rows are
 * read here and kept to the caller's brands; the request never carries text.
 */

const router = Router();

const translateBody = z.object({
  kind: z.enum(Object.keys(TRANSLATABLE)),
  ids: z.array(z.guid()).min(1).max(MAX_ROWS),
  locale: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/),
});

router.post('/translate', aiTextLimiter, async (req, res) => {
  const parsed = translateBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const texts = await translatedTexts({ ...parsed.data, userId: req.user.id });
    return res.json({ texts });
  } catch (err) {
    req.log.error({ err }, 'ai text translation error');
    return res.status(500).json({ error: 'Failed to translate', code: 'failed' });
  }
});

export default router;
