const express = require('express');
const multer = require('multer');
const { validate, assetSchemas } = require('../middleware/validation');
const { authenticateToken, authorize } = require('../middleware/auth');
const {
  getAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
  uploadAssetImage,
  updateAssetFacility,
  getAssetsByFacilityId  
} = require('../controllers/assetController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// -------------------- ROUTES -------------------- //

// Static & facility-specific routes first
router.get('/facility/:facility_id', getAssetsByFacilityId);
router.put('/facility/:assetId', updateAssetFacility);

// Image upload
router.post('/:id/image', upload.single('image'), uploadAssetImage);

// CRUD operations
router.get('/', getAssets);
router.get('/:id', getAssetById);
router.post('/', validate(assetSchemas.create), createAsset);
router.put('/:id', validate(assetSchemas.update), updateAsset);
router.delete('/:id', deleteAsset);


module.exports = router;
