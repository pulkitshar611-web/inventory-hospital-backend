const express = require('express');
const router = express.Router();
const { getUserApprovedReceipts } = require('../controllers/receiptsController');

// GET /api/receipts/user/:user_id/approved
router.get("/approved-receipts/:user_id", getUserApprovedReceipts);


module.exports = router;