const express = require('express');
const {
  getIncomingGoods,
  markAsReceived
} = require('../controllers/incomingGoodsController');

const router = express.Router();

router.get('/facility/:facility_id', getIncomingGoods);
router.put('/:id/receive', markAsReceived);

module.exports = router;

