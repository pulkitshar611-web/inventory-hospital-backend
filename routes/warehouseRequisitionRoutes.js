const express = require('express');
const { raiseToWarehouse,
  getRaiseRequests,
  warehouseApproveRequisition,
  warehouseRejectRequisition,
  warehouseBulkApprove,
  warehousePartialApproveRequisition
} = require('../controllers/requisitionController.js');

  const router = express.Router();



router.get('/raise', getRaiseRequests);
router.post('/raise-to-warehouse', raiseToWarehouse);
router.patch("/warehouse/approve", warehouseApproveRequisition);
router.patch("/warehouse/bulk-approve", warehouseBulkApprove);
router.patch("/warehouse/reject", warehouseRejectRequisition);
router.patch("/warehouse/partial-approve", warehousePartialApproveRequisition);



  module.exports = router;