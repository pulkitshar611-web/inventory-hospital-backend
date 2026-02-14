const express = require('express');
const {
  createFacilityRequisition,
  getFacilityRequisitionsByFacilityId,
  approveFacilityRequisition,
  getAllFacilityRequisitions,
  partialApproveFacilityRequisition,
  rejectFacilityRequisition,
  approveFacilityRequisitionsBulk,
  deleteFacilityRequisition
} = require('../controllers/facilityRequisition');

const router = express.Router();


router.post("/", createFacilityRequisition); // ✅ Create new requisition
router.get('/', getAllFacilityRequisitions);
router.get("/:facility_id", getFacilityRequisitionsByFacilityId);  // ✅ Get all requisitions// ✅ Get requisitions by facility id
router.post('/approve', approveFacilityRequisition);// ✅ Approve a requisition
router.post("/approve-bulk", approveFacilityRequisitionsBulk);
router.post('/approve/partial', partialApproveFacilityRequisition); // ✅ Partial approval
router.post('/reject', rejectFacilityRequisition);
router.post('/delete', deleteFacilityRequisition); // ✅ Delete a requisition
 

module.exports = router;