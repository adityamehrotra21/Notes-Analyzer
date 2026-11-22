import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uploadFiles } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { documentIdParams } from '../schemas/documents.js';
import { uploadDocuments, listDocuments, getDocument, deleteDocument, reindexEstimate, reindexDocument } from '../controllers/documentsController.js';

const router = Router();
router.use(requireAuth);

router.post('/upload', uploadLimiter, uploadFiles, uploadDocuments);
router.get('/', listDocuments);
router.get('/:id', validate({ params: documentIdParams }), getDocument);
router.delete('/:id', validate({ params: documentIdParams }), deleteDocument);
// Re-index is an admin maintenance tool (not exposed to normal users).
router.get('/:id/reindex/estimate', requireAdmin, validate({ params: documentIdParams }), reindexEstimate);
router.post('/:id/reindex', requireAdmin, uploadLimiter, validate({ params: documentIdParams }), reindexDocument);

export default router;
