const express = require('express');
const { validate, userSchemas } = require('../middleware/validation');
const { authenticateToken, authorize } = require('../middleware/auth');
const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getFacilityAdminsByFacility,
  getFacilityUsersByFacility,
  getUsersByFacilityAdmin
} = require('../controllers/userController');

const router = express.Router();

// All routes require authentication
// router.use(authenticateToken);

// Get all users
// router.get('/', authorize('super_admin', 'facility_admin'), getUsers);
router.get('/', getUsers);



// Get user by ID
router.get('/:id', getUserById);

// Create user
// router.post('/', authorize('super_admin', 'facility_admin'), validate(userSchemas.register), createUser);

router.post('/', validate(userSchemas.register), createUser);

// Update user
router.put('/:id', updateUser);

// Delete user
router.delete('/:id', deleteUser);


router.get('/facility-admins/:facilityId', getFacilityAdminsByFacility);

// GET all users for a facility
router.get('/facility-users/:facilityId', getFacilityUsersByFacility);

// GET all users under a facility admin
router.get('/facility-admin/users/:facilityAdminId', getUsersByFacilityAdmin);

module.exports = router;