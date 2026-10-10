
const express = require('express');
const multer = require('multer');
const router = express.Router();
const petController = require('../controllers/petController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WebP'));
    }
  }
});

// Pets
router.get('/pets', petController.showPets);
router.get('/pets/create', petController.showSelectPetOwner);
router.get('/pets/create/form', petController.showCreatePet);
router.post('/pets/create', upload.single('pet_image'), petController.createPet);
router.get('/pets/:id/edit', petController.showEditPet);
router.post('/pets/:id/edit', upload.single('pet_image'), petController.updatePet);
router.post('/pets/:id/delete', petController.deletePet);
router.get('/pets/:id', petController.showPetDetail);

// Pet Owners
router.get('/pet-owners', petController.showPetOwners);
router.get('/pet-owners/create', petController.showCreatePetOwner);
router.post(
  '/pet-owners/create',
  upload.single('profile_image'),
  petController.createPetOwner
);
router.post('/pet-owners/:id/delete', petController.deletePetOwner);
router.get('/pet-owners/:id/edit', petController.showEditPetOwner);
router.post(
  '/pet-owners/:id/edit',
  upload.single('profile_image'),
  petController.updatePetOwner
);
module.exports = router;
