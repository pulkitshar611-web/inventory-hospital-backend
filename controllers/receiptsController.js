const { pool } = require('../config');

const getUserApprovedReceipts = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    // 1️⃣ Get Approved Requisitions
    const [approvedRequisitions] = await connection.query(
      `SELECT 
          r.id AS requisition_id,
          r.facility_id,
          r.warehouse_id,
          r.status,
          r.priority,
          r.remarks,
          r.created_at
       FROM requisitions r
       WHERE r.user_id = ?
         AND LOWER(r.status) = 'approved'
       ORDER BY r.created_at DESC`,
      [user_id]
    );

    if (!approvedRequisitions.length) {
      return res.status(200).json({
        success: true,
        message: "No approved requisitions found for this user",
        data: [],
      });
    }

    // 2️⃣ Attach Items for each approved requisition
    for (const reqRow of approvedRequisitions) {
      const [items] = await connection.query(
        `SELECT 
            ri.item_id,
            COALESCE(iu.item_name, CONCAT('Item-', ri.item_id)) AS item_name,
            iu.category,
            iu.unit,
            iu.description,
            iu.item_cost,
            ri.quantity,
            ri.approved_quantity,
            ri.delivered_quantity,
            ri.priority,
            ri.created_at
         FROM requisition_items ri
         LEFT JOIN inventory_user iu 
           ON ri.item_id = iu.item_id
         WHERE ri.requisition_id = ?
         ORDER BY ri.created_at ASC`,
        [reqRow.requisition_id]
      );

      console.log("🟢 Requisition:", reqRow.requisition_id, "Items found:", items.length);

      reqRow.items = items;

      reqRow.total_approved_value = items.reduce(
        (sum, i) => sum + ((i.approved_quantity || 0) * (i.item_cost || 0)),
        0
      );
    }

    // 3️⃣ Send response
    return res.status(200).json({
      success: true,
      message: "Approved receipts fetched successfully",
      data: approvedRequisitions,
    });
  } catch (error) {
    console.error("❌ Error in getUserApprovedReceipts:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


module.exports = { getUserApprovedReceipts };