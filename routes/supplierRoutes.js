const express = require('express');
const {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addSupplierItem,
  removeSupplierItem,
  addSupplierHistory,
  getSupplierHistory
} = require('../controllers/supplierController');

const router = express.Router();

// Basic CRUD
router.get('/', getAllSuppliers);
router.get('/:id', getSupplierById);
router.post('/', createSupplier);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

// Supplier-Item Mapping
router.post('/:supplier_id/items', addSupplierItem);
router.delete('/:supplier_id/items/:mapping_id', removeSupplierItem);

// Supplier History
router.post('/:supplier_id/history', addSupplierHistory);
router.get('/:supplier_id/history', getSupplierHistory);

module.exports = router;

