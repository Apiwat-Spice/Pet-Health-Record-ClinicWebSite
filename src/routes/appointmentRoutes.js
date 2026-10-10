
const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');

router.get('/', appointmentController.showAppointments);
router.get('/calendar-events', appointmentController.getAppointmentCalendarEvents);
router.post('/create', appointmentController.createAppointment);
router.post('/confirm', appointmentController.confirmAppointment);
router.post('/cancel', appointmentController.cancelAppointment);

module.exports = router;
