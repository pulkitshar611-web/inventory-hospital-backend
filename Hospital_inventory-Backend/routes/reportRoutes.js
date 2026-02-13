const express = require('express');
const { authenticateToken, authorize } = require('../middleware/auth');
const {
  getStockReport,
  getRequisitionReport,
  getFacilityUsageReport,
  getAssetReport,
  exportReport,
  getFacilityReports
} = require('../controllers/reportController');

const router = express.Router();

// All routes require authentication
// router.use(authenticateToken);

// Stock reports
router.get('/stock', getStockReport);

router.get("/facility/:facility_id", getFacilityReports);

// Requisition reports
router.get('/requisitions', getRequisitionReport);

// Facility usage reports
router.get('/facility-usage', getFacilityUsageReport);

// Asset reports
router.get('/assets', getAssetReport);

// Export report
router.get('/export/:type', exportReport);

module.exports = router;