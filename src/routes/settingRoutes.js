
const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');

router.get('/', settingController.showSetting);
router.post('/profile', settingController.upload.single('profile_image'), settingController.updateProfile);
router.post('/profile/image/delete', settingController.deleteProfileImage);
router.post('/clinic', settingController.upload.single('profile_image'), settingController.updateClinicProfile);
router.get('/password', settingController.showOtp);
router.post('/password/otp', settingController.requestOtp);
router.post('/password/verify', settingController.verifyOtp);
router.post('/password/reset', settingController.resetPassword);

module.exports = router;
