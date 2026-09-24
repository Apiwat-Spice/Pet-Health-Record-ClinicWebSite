const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
// Login
router.get('/login', authController.showLogin);
router.post('/login', authController.login);
// Register
router.get('/register', authController.showRegister);
router.post('/register', authController.register);
module.exports = router;