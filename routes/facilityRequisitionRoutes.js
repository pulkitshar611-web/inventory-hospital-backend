const express = require('express');
const {
  createFacilityRequisition,
  getFacilityRequisitionsByFacilityId,
  approveFacilityRequisition,
  getAllFacilityRequisitions,
  getFacilityRequisitionById,
  partialApproveFacilityRequisition,
  rejectFacilityRequisition,
  approveFacilityRequisitionsBulk,
  deleteFacilityRequisition,
  approveRequisitionUnified,
  rejectRequisitionUnified
} = require('../controllers/facilityRequisition');

const router = express.Router();


router.post("/", createFacilityRequisition); // ✅ Create new requisition
router.get('/', getAllFacilityRequisitions);
router.get("/requisition/:id", getFacilityRequisitionById); // ✅ Get facility requisition by ID (must come before /:facility_id)
router.get("/:facility_id", getFacilityRequisitionsByFacilityId);  // ✅ Get all requisitions// ✅ Get requisitions by facility id
router.post('/approve', approveFacilityRequisition);// ✅ Approve a requisition (facility_requisitions only)
router.post("/approve-bulk", approveFacilityRequisitionsBulk);
router.post('/approve/partial', partialApproveFacilityRequisition); // ✅ Partial approval (facility_requisitions only)
router.post('/reject', rejectFacilityRequisition); // ✅ Reject (facility_requisitions only)
router.post('/approve-unified', approveRequisitionUnified); // ✅ Unified approval (both tables)
router.post('/reject-unified', rejectRequisitionUnified); // ✅ Unified rejection (both tables)
router.post('/delete', deleteFacilityRequisition); // ✅ Delete a requisition
 

module.exports = router;