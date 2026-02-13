// routes/inventoryFacilityRoutes.js

const express = require('express');
const router = express.Router();
const { getInventoryByFacilityId,
        getAllInventory
 } = require('../controllers/inventory_facility.js');

// GET /api/inventory-facility/:facility_id
router.get("/inventory", getAllInventory);
router.get('/:facility_id', getInventoryByFacilityId);

module.exports = router;
