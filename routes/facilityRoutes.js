const express = require('express');
const { validate, facilitySchemas } = require('../middleware/validation');
const { authenticateToken, authorize } = require('../middleware/auth');
const {
  getFacilities,
  getFacilityById,
  createFacility,
  updateFacility,
  deleteFacility,
  getFacilityStats,
  assignFacilityAdmin
} = require('../controllers/facilityController');

const router = express.Router();

// All routes require authentication
// router.use(authenticateToken);

// Get all facilities
router.get('/', getFacilities);

// Get facility by ID
router.get('/:id', getFacilityById);


// Get facility statistics
router.get('/:id/stats', getFacilityStats);

// Create facility
// router.post('/', authorize('super_admin'), validate(facilitySchemas.create), createFacility);
router.post('/',  validate(facilitySchemas.create), createFacility);

// router.put('/:id', authorize('super_admin'), validate(facilitySchemas.update), updateFacility);
router.put('/:id', validate(facilitySchemas.update), updateFacility);

router.put('/:facility_id/assign-admin', assignFacilityAdmin);


// Delete facility
router.delete('/:id', deleteFacility);

module.exports = router;
