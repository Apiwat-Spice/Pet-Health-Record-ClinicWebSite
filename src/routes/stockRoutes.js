const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

function requireStockRole(req, res, next) {
  const user = req.user || req.session?.user || req.session?.account;

  if (!user || !['clinic', 'clinic_staff'].includes(user.role)) {
    return res.status(403).send('ผิดตำแหน่ง ไม่สามารถทำรายการได้');
  }

  next();
}

router.get('/overview', requireStockRole, stockController.getOverview);
router.get('/create', requireStockRole, stockController.getCreate);
router.post('/create', requireStockRole, stockController.createStock);
router.get('/:id/edit',requireStockRole, stockController.getEdit);
router.post('/:id/edit',requireStockRole, stockController.updateStock);

module.exports = router;