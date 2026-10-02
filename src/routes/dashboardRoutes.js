const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { isAuthenticated } = require('../middleware/authMiddleware');

// หน้าแรก
router.get('/', (req, res) => {
    res.redirect(req.session.user ? '/dashboard' : '/login');
});

router.get('/dashboard', isAuthenticated, dashboardController.showDashboard);

module.exports = router;