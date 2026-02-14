const { pool } = require('../config');

// Create notification
const createNotification = async (userId, facilityId, type, title, message, relatedId = null, relatedType = null) => {
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `INSERT INTO notifications 
       (user_id, facility_id, type, title, message, related_id, related_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, facilityId, type, title, message, relatedId, relatedType]
    );
  } catch (error) {
    console.error("Error creating notification:", error);
  } finally {
    connection.release();
  }
};

// Get notifications for user
const getUserNotifications = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { user_id } = req.params;
    const { unread_only, limit = 50 } = req.query;

    let query = `SELECT * FROM notifications WHERE user_id = ?`;
    const params = [user_id];

    if (unread_only === 'true') {
      query += ` AND is_read = 0`;
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const [notifications] = await connection.execute(query, params);

    res.status(200).json({
      success: true,
      data: notifications,
      total: notifications.length
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get notifications for facility
const getFacilityNotifications = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { facility_id } = req.params;
    const { unread_only, limit = 50 } = req.query;

    let query = `SELECT * FROM notifications WHERE facility_id = ?`;
    const params = [facility_id];

    if (unread_only === 'true') {
      query += ` AND is_read = 0`;
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit));

    const [notifications] = await connection.execute(query, params);

    res.status(200).json({
      success: true,
      data: notifications,
      total: notifications.length
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.execute(
      `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ?`,
      [id]
    );

    res.status(200).json({
      success: true,
      message: "Notification marked as read"
    });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking notification as read",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Mark all notifications as read for user
const markAllAsRead = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { user_id } = req.params;

    await connection.execute(
      `UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0`,
      [user_id]
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read"
    });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Delete notification
const deleteNotification = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.execute(
      `DELETE FROM notifications WHERE id = ?`,
      [id]
    );

    res.status(200).json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting notification",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  getFacilityNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
};

