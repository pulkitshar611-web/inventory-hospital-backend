const express = require('express');
const { validate, inventorySchemas } = require('../middleware/validation');
const { authenticateToken, authorize } = require('../middleware/auth');
const Joi = require('joi');

const {
  getInventory,
  createWarehouseInventory,
  createWarehouseInventoryBulk,
  updateInventoryItem,
  updateStock,
  deleteInventoryItem,
  getStockMovements,
  getCategories,
  getInventoryByFacilityId,
  getInventoryByUserId,
  createInventoryFacility
} = require('../controllers/inventoryController');

const router = express.Router();

// ✅ Get categories
router.get('/categories', getCategories);

// ✅ Get inventory by facility ID
router.get('/facilities/:id', getInventoryByFacilityId);

// ✅ Get inventory by user ID
router.get('/user/:user_id', getInventoryByUserId);

// ✅ Get stock movements (must be before '/:id')
router.get('/:id/movements', getStockMovements);

// ✅ Get all inventory items
router.get('/', getInventory);

// ✅ Get single inventory item by ID
router.get('/:id', getInventory);

// ✅ Create single or multiple warehouse inventory items

// ✅ Create inventory for facilities

// ✅ Create warehouse inventory (manual create)
router.post('/create', createWarehouseInventory);

router.post('/createBulk', createWarehouseInventoryBulk);

// ✅ Update inventory item
router.put('/:id', updateInventoryItem);

// ✅ Update stock quantity
router.patch('/:id/stock', validate(inventorySchemas.stock), updateStock);

// ✅ Delete inventory item
router.delete('/:id', deleteInventoryItem);

module.exports = router;
