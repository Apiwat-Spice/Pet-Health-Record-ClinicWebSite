const express = require('express');
const router = express.Router();
const receiptController = require('../controllers/receiptController');

router.get('/', receiptController.requireRole, receiptController.getReceipt);
router.post('/save', receiptController.requireRole, receiptController.saveReceipt);
router.post('/payment/:receiptId', receiptController.requireRole, receiptController.updatePaymentStatus);

module.exports = router;