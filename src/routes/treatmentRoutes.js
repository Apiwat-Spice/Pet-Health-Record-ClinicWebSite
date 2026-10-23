
const express = require('express');
const router = express.Router();
const treatmentController = require('../controllers/treatmentController');

router.get('/', treatmentController.index);
router.get('/:id', treatmentController.detail);
router.post('/:id/save', treatmentController.save);
router.post('/:id/complete', treatmentController.complete);

module.exports = router;
