
const express = require('express');
const multer = require('multer');
const controller = require('../controllers/memberController');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('อนุญาตให้อัปโหลดเฉพาะไฟล์รูปภาพ'));
  }
});

router.use(controller.requireClinic);
router.get('/clinic-staff', controller.listClinicStaff);
router.get('/clinic-staff/create', controller.showCreate('clinic-staff'));
router.post('/clinic-staff/create', upload.single('profile_image'), controller.create('clinic-staff'));
router.get('/clinic-staff/:id/edit', controller.showEdit('clinic-staff'));
router.post('/clinic-staff/:id/edit', upload.single('profile_image'), controller.update('clinic-staff'));
router.post('/clinic-staff/:id/delete', controller.remove('clinic-staff'));

router.get('/vets', controller.listVets);
router.get('/vets/create', controller.showCreate('vets'));
router.post('/vets/create', upload.single('profile_image'), controller.create('vets'));
router.get('/vets/:id/edit', controller.showEdit('vets'));
router.post('/vets/:id/edit', upload.single('profile_image'), controller.update('vets'));
router.post('/vets/:id/delete', controller.remove('vets'));

module.exports = router;
