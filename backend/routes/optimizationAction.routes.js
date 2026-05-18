import express from 'express';
import { addAction, getActions } from '../controllers/optimizationAction.controller.js';

const router = express.Router();

// Assuming you want this to be accessible. Consider adding auth middleware like protect() here if needed.
router.post('/', addAction);
router.get('/', getActions);

export default router;