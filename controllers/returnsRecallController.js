const { pool } = require('../config');

// ✅ Get all records
const getAllReturns = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT 
          rr.id,
          rr.facility_id,
          rr.item_id,
          f.item_name,
          rr.quantity,
          rr.reason,
          rr.remark,
          rr.status,
          rr.reject_reason,
          rr.accept_reason,
          rr.created_at,
          rr.updated_at
       FROM returns_recall rr
       LEFT JOIN inventory_facility f 
              ON f.item_id = rr.item_id AND f.facility_id = rr.facility_id
       ORDER BY rr.created_at DESC`
    );

    res.status(200).json({
      success: true,
      message: "All Returns & Recalls fetched successfully",
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching all returns/recall:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
// ✅ Get single record by ID
const getReturnById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Return ID is required"
      });
    }

    const query = `
      SELECT r.*, 
             f.name AS facility_name, 
             inv.item_name, 
             inv.category AS item_category
      FROM returns_recall r
      LEFT JOIN facilities f ON r.facility_id = f.id
      LEFT JOIN inventory inv ON r.item_id = inv.id
      WHERE r.id = ?
      LIMIT 1
    `;

    const [results] = await pool.query(query, [id]);

    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Return record not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Return record fetched successfully",
      data: results[0]
    });
  } catch (err) {
    console.error("Get return by ID error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch return record",
      error: err.message
    });
  }
};
// ✅ Get by Facility ID
const getReturnsByFacility = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { facility_id } = req.params;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    // ✅ Fetch returns/recalls with facility_name & item_name
    const [rows] = await connection.query(
      `SELECT 
          rr.id,
          rr.facility_id,
          f.name AS facility_name,      -- 👈 Change this column if your facilities table uses a different name
          rr.item_id,
          i.item_name,
          rr.quantity,
          rr.reason,
          rr.remark,
          rr.status,
          rr.reject_reason,
          rr.accept_reason,
          rr.created_at,
          rr.updated_at
        FROM returns_recall rr
        LEFT JOIN inventory_facility i ON rr.item_id = i.item_id
        LEFT JOIN facilities f ON rr.facility_id = f.id
        WHERE rr.facility_id = ?
        ORDER BY rr.created_at DESC`,
      [facility_id]
    );

    res.status(200).json({
      success: true,
      message: "Returns/Recall fetched successfully",
      total: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching returns/recall:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
// ✅ Create new return record
const createReturn = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { facility_id, item_id, quantity, reason, remark, status } = req.body;

    if (!facility_id || !item_id || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        message: "facility_id, item_id, quantity, and reason are required",
      });
    }

    const [result] = await connection.query(
      `INSERT INTO returns_recall 
        (facility_id, item_id, quantity, reason, remark, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [facility_id, item_id, quantity, reason, remark || "", status || "pending"]
    );

    res.status(201).json({
      success: true,
      message: "Return/Recall request created successfully",
      data: { id: result.insertId },
    });
  } catch (error) {
    console.error("Error adding return/recall:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};
// ✅ Update return record
const updateReturn = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { facility_id, item_id, quantity, reason, remark, status, reject_reason } = req.body;

    // 🔹 Validation
    if (!facility_id || !item_id || !quantity || !reason) {
      return res.status(400).json({
        success: false,
        message: "facility_id, item_id, quantity, and reason are required"
      });
    }

    // 🔹 Update return record
    const [result] = await connection.query(
      `UPDATE returns_recall 
       SET facility_id = ?, item_id = ?, quantity = ?, reason = ?, remark = ?, status = ?, reject_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [facility_id, item_id, quantity, reason, remark || null, status || 'pending', reject_reason || null, id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Return record not found"
      });
    }

    await connection.commit();

    res.json({
      success: true,
      message: "Return record updated successfully",
      data: { id }
    });
  } catch (err) {
    await connection.rollback();
    console.error("Update return error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update return record",
      error: err.message
    });
  } finally {
    connection.release();
  }
};
// ✅ Delete return record
const deleteReturn = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;

    // 🔹 Check if record exists
    const [existing] = await connection.query(
      "SELECT id FROM returns_recall WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Return record not found"
      });
    }

    // 🔹 Delete the record
    await connection.query(
      "DELETE FROM returns_recall WHERE id = ?",
      [id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Return record deleted successfully",
      data: { id }
    });
  } catch (err) {
    await connection.rollback();
    console.error("Delete return error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to delete return record",
      error: err.message
    });
  } finally {
    connection.release();
  }
}
// ✅ Accept return record
const acceptReturn = async (req, res) => {
  const { id } = req.params;
  const { accept_reason, remark } = req.body;
  
  // Validate required parameters
  if (!accept_reason) {
    return res.status(400).json({ error: 'accept_reason is required' });
  }
  
  let connection;
  
  try {
    // Get connection from pool
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Get return recall details (including facility_id)
    const [recallRows] = await connection.execute(
      `SELECT facility_id, item_id, quantity FROM returns_recall WHERE id = ? AND status != 'accepted'`,
      [id]
    );

    if (recallRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Return recall not found or already accepted' });
    }

    const { facility_id, item_id, quantity } = recallRows[0];

    // 2. Update return recall status
    await connection.execute(
      `UPDATE returns_recall 
       SET status = 'accepted', 
           accept_reason = ?, 
           remark = COALESCE(?, remark),
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [accept_reason, remark || null, id]
    );

    // 3. Remove item from inventory_facility
    const [inventoryUpdate] = await connection.execute(
      `DELETE FROM inventory_facility 
       WHERE facility_id = ? AND item_id = ?`,
      [facility_id, item_id]
    );

    // 4. Check if item was found and removed
    if (inventoryUpdate.affectedRows === 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ error: 'Item not found in facility inventory' });
    }

    // Commit transaction
    await connection.commit();
    
    // Release connection back to pool
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Return recall accepted and item removed from facility successfully',
      removedQuantity: quantity
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// ✅ Reject return record
const rejectReturn = async (req, res) => {
  let connection;
  
  try {
    const { id } = req.params;
    const { reject_reason } = req.body;

    // Validate required parameters
    if (!id) {
      return res.status(400).json({ success: false, message: "Return ID is required" });
    }
    
    if (!reject_reason) {
      return res.status(400).json({ success: false, message: "Reject reason is required" });
    }

    // Get connection from pool
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update return recall status to rejected
    const [updateResult] = await connection.execute(
      `UPDATE returns_recall 
       SET status = 'rejected', 
           reject_reason = ?, 
           accept_reason = NULL, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND status != 'rejected'`,
      [reject_reason, id]
    );

    // Check if the update was successful
    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ 
        success: false, 
        message: "Return recall not found or already rejected" 
      });
    }

    // Commit transaction
    await connection.commit();
    
    // Release connection back to pool
    connection.release();
    
    res.status(200).json({
      success: true,
      message: "Return/Recall rejected successfully",
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Error rejecting return/recall:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


module.exports = {
  getAllReturns,
  getReturnById,
  getReturnsByFacility,
  createReturn,
  updateReturn,
  deleteReturn,
  acceptReturn,
  rejectReturn,
};
