const express = require('express');
const {
  getAllBatches,
  getBatchesByItem,
  getBatchById,
  createBatch,
  updateBatch,
  recallBatch,
  getBatchesByBatchNumber,
  getBatchesForDispatch
} = require('../controllers/batchController');

const router = express.Router();

// Get batches
router.get('/', getAllBatches);
router.get('/item/:item_id', getBatchesByItem);
router.get('/batch-number/:batch_number', getBatchesByBatchNumber);
router.get('/dispatch', getBatchesForDispatch);
router.get('/:id', getBatchById);

// Create batch
router.post('/', createBatch);

// Update batch
router.put('/:id', updateBatch);

// Recall batch
router.post('/:id/recall', recallBatch);

module.exports = router;

