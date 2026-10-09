
const express = require('express');
const multer = require('multer');
const router = express.Router();
const petController = require('../controllers/petController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WebP'));
    }
  }
});

router.get('/pets', petController.showPets);
router.get('/pet-owners', petController.showPetOwners);
router.get('/pet-owners/create', petController.showCreatePetOwner);
router.post(
  '/pet-owners/create',
  upload.single('profile_image'),
  petController.createPetOwner
);
router.post(
  '/pet-owners/:id/delete',
  petController.deletePetOwner
);
module.exports = router;