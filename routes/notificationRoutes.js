const express = require('express');
const {
  getUserNotifications,
  getFacilityNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
} = require('../controllers/notificationController');

const router = express.Router();

router.get('/user/:user_id', getUserNotifications);
router.get('/facility/:facility_id', getFacilityNotifications);
router.put('/:id/read', markAsRead);
router.put('/user/:user_id/read-all', markAllAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;

