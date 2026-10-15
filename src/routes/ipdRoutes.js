
const express = require('express');
const router = express.Router();
const ipdController = require('../controllers/ipdController');
const { requireClinic } = require('../controllers/memberController');

// Room
router.get('/rooms', requireClinic, ipdController.listRooms);
router.get('/rooms/create', requireClinic, ipdController.showCreateRoom);
router.post('/rooms/create', requireClinic, ipdController.createRoom);
router.get('/rooms/:id', requireClinic, ipdController.roomDetail);

// Admit Plans
router.get('/admit-plans', requireClinic, ipdController.listAdmitPlans);
router.get('/admit-plans/create', requireClinic, ipdController.showCreateAdmitPlan);
router.post('/admit-plans/create', requireClinic, ipdController.createAdmitPlan);

module.exports = router;
