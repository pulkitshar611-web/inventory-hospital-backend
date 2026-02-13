// controllers/inventoryFacilityController.js

const { pool } = require('../config'); // apna MySQL pool import karo

const getInventoryByFacilityId = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { facility_id } = req.params;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required"
      });
    }

    const [rows] = await connection.execute(
      `SELECT id, item_code, item_name, category, description, unit, facility_id, item_id, quantity, reorder_level, item_cost, expiry_date, created_at, updated_at
       FROM inventory_facility
       WHERE facility_id = ?`,
      [facility_id]
    );

    res.status(200).json({
      success: true,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error fetching inventory_facility:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching inventory_facility",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const getAllInventory = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(
      `SELECT 
        inv.id,
        inv.item_code,
        inv.item_name,
        inv.category,
        inv.description,
        inv.unit,
        inv.facility_id,
        f.name AS facility_name,     -- 👈 yaha change kiya
        inv.item_id,
        inv.quantity,
        inv.reorder_level,
        inv.item_cost,
        inv.expiry_date,
        inv.created_at,
        inv.updated_at
      FROM inventory_facility inv
      LEFT JOIN facilities f ON inv.facility_id = f.id
      ORDER BY inv.created_at DESC`
    );

    res.status(200).json({
      success: true,
      total: rows.length,
      data: rows
    });

  } catch (error) {
    console.error("❌ Error fetching all inventory:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching all inventory",
      error: error.message
    });
  } finally {
    connection.release();
  }
};




module.exports = { getInventoryByFacilityId,
  getAllInventory
 };
