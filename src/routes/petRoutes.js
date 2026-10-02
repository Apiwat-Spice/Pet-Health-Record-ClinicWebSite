const express = require('express');
const router = express.Router();
const petController = require('../controllers/petController');

router.get('/pets', petController.showPets);
router.get('/pet-owners', petController.showPetOwners);

module.exports = router;