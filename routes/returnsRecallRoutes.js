const express = require("express");
const router = express.Router();
const {
  getAllReturns,
  getReturnById,
  getReturnsByFacility,
  createReturn,
  updateReturn,
  deleteReturn,
  acceptReturn,
  rejectReturn,
} = require("../controllers/returnsRecallController");

router.get("/", getAllReturns);
router.get("/:id", getReturnById);
router.get("/facility/:facility_id", getReturnsByFacility);
router.post("/", createReturn);
router.put("/:id", updateReturn);       
router.delete("/:id", deleteReturn);
router.put("/:id/accept", acceptReturn);
router.patch("/:id/reject", rejectReturn);

module.exports = router;
