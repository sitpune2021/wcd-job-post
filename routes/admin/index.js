const express = require('express');
const router = express.Router();

// NOTE:
// This router is the new entrypoint for /api/admin.
// We mount modular admin routes here first, then fall back to the legacy router.

router.use('/applicants', require('./applicants'));
router.use('/dashboard', require('./dashboard'));

// Legacy fallback (keep last)
router.use(require('./legacy'));

module.exports = router;
