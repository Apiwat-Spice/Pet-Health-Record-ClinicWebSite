const express = require('express');
const router = express.Router();
const visitRecordController = require('../controllers/visitRecordController');

router.get('/', visitRecordController.showVisitRecords);
router.get('/form/:appointmentId', visitRecordController.showVisitRecordForm);
router.post('/save/:appointmentId', visitRecordController.saveVisitRecord);

module.exports = router;