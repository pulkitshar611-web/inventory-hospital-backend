const { pool } = require('../config');

// Get all batches
const getAllBatches = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { location, facility_id, status } = req.query;

    let query = `
      SELECT 
        ib.*,
        iw.item_name,
        iw.item_code,
        iw.category,
        iw.unit,
        s.name as supplier_name,
        s.supplier_code,
        f.name as facility_name,
        u.name as recalled_by_name,
        CASE 
          WHEN ib.expiry_date < CURDATE() THEN 'expired'
          WHEN ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'near_expiry'
          WHEN ib.status = 'recalled' THEN 'recalled'
          WHEN ib.status = 'blocked' THEN 'blocked'
          ELSE 'active'
        END as calculated_status,
        DATEDIFF(ib.expiry_date, CURDATE()) as days_until_expiry
      FROM inventory_batches ib
      LEFT JOIN inventory_warehouse iw ON ib.item_id = iw.id
      LEFT JOIN suppliers s ON ib.supplier_id = s.id
      LEFT JOIN facilities f ON ib.facility_id = f.id
      LEFT JOIN users u ON ib.recalled_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (location) {
      query += ` AND ib.location = ?`;
      params.push(location);
    }

    if (facility_id) {
      query += ` AND ib.facility_id = ?`;
      params.push(facility_id);
    }

    if (status) {
      query += ` AND ib.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY ib.expiry_date ASC, ib.created_at DESC`;

    const [batches] = await connection.execute(query, params);

    res.status(200).json({
      success: true,
      data: batches,
      total: batches.length
    });
  } catch (error) {
    console.error("Error fetching all batches:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batches",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get all batches for an item
const getBatchesByItem = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { item_id } = req.params;
    const { location, facility_id, status } = req.query;

    let query = `
      SELECT 
        ib.*,
        iw.item_name,
        iw.item_code,
        iw.category,
        iw.unit,
        s.name as supplier_name,
        s.supplier_code,
        f.name as facility_name,
        u.name as recalled_by_name,
        CASE 
          WHEN ib.expiry_date < CURDATE() THEN 'expired'
          WHEN ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'near_expiry'
          WHEN ib.status = 'recalled' THEN 'recalled'
          WHEN ib.status = 'blocked' THEN 'blocked'
          ELSE 'active'
        END as calculated_status,
        DATEDIFF(ib.expiry_date, CURDATE()) as days_until_expiry
      FROM inventory_batches ib
      LEFT JOIN inventory_warehouse iw ON ib.item_id = iw.id
      LEFT JOIN suppliers s ON ib.supplier_id = s.id
      LEFT JOIN facilities f ON ib.facility_id = f.id
      LEFT JOIN users u ON ib.recalled_by = u.id
      WHERE ib.item_id = ?
    `;
    const params = [item_id];

    if (location) {
      query += ` AND ib.location = ?`;
      params.push(location);
    }

    if (facility_id) {
      query += ` AND ib.facility_id = ?`;
      params.push(facility_id);
    }

    if (status) {
      query += ` AND ib.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY ib.expiry_date ASC, ib.created_at DESC`;

    const [batches] = await connection.execute(query, params);

    res.status(200).json({
      success: true,
      data: batches,
      total: batches.length
    });
  } catch (error) {
    console.error("Error fetching batches:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batches",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get batch by ID
const getBatchById = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    const [batches] = await connection.execute(
      `SELECT 
        ib.*,
        iw.item_name,
        iw.item_code,
        iw.category,
        iw.unit,
        s.name as supplier_name,
        s.supplier_code,
        f.name as facility_name,
        u.name as recalled_by_name,
        CASE 
          WHEN ib.expiry_date < CURDATE() THEN 'expired'
          WHEN ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'near_expiry'
          WHEN ib.status = 'recalled' THEN 'recalled'
          WHEN ib.status = 'blocked' THEN 'blocked'
          ELSE 'active'
        END as calculated_status,
        DATEDIFF(ib.expiry_date, CURDATE()) as days_until_expiry
       FROM inventory_batches ib
       LEFT JOIN inventory_warehouse iw ON ib.item_id = iw.id
       LEFT JOIN suppliers s ON ib.supplier_id = s.id
       LEFT JOIN facilities f ON ib.facility_id = f.id
       LEFT JOIN users u ON ib.recalled_by = u.id
       WHERE ib.id = ?`,
      [id]
    );

    if (batches.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Batch not found"
      });
    }

    // Get batch movements
    const [movements] = await connection.execute(
      `SELECT 
        bm.*,
        u.name as user_name,
        f.name as facility_name
       FROM batch_movements bm
       LEFT JOIN users u ON bm.user_id = u.id
       LEFT JOIN facilities f ON bm.facility_id = f.id
       WHERE bm.batch_id = ?
       ORDER BY bm.created_at DESC
       LIMIT 50`,
      [id]
    );

    const batch = batches[0];
    batch.movements = movements;

    res.status(200).json({
      success: true,
      data: batch
    });
  } catch (error) {
    console.error("Error fetching batch:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batch",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Create batch
const createBatch = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const {
      item_id,
      batch_number,
      expiry_date,
      quantity,
      supplier_id,
      received_date,
      location,
      facility_id
    } = req.body;

    if (!item_id || !batch_number || !expiry_date || !quantity) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Item ID, batch number, expiry date, and quantity are required"
      });
    }

    // Check if batch already exists
    const [existing] = await connection.execute(
      `SELECT id FROM inventory_batches 
       WHERE item_id = ? AND batch_number = ? AND location = ? AND (facility_id = ? OR (facility_id IS NULL AND ? IS NULL))`,
      [item_id, batch_number, location || 'warehouse', facility_id || null, facility_id || null]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Batch already exists for this item and location"
      });
    }

    // Calculate status based on expiry
    let status = 'active';
    const expiryDate = new Date(expiry_date);
    const today = new Date();
    const daysDiff = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
      status = 'expired';
    } else if (daysDiff <= 30) {
      status = 'near_expiry';
    }

    const [result] = await connection.execute(
      `INSERT INTO inventory_batches 
       (item_id, batch_number, expiry_date, quantity, available_quantity, supplier_id, received_date, location, facility_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item_id,
        batch_number,
        expiry_date,
        parseFloat(quantity),
        parseFloat(quantity),
        supplier_id || null,
        received_date || new Date().toISOString().split('T')[0],
        location || 'warehouse',
        facility_id || null,
        status
      ]
    );

    // Add batch movement
    await connection.execute(
      `INSERT INTO batch_movements 
       (batch_id, movement_type, quantity, to_location, facility_id, remarks)
       VALUES (?, 'received', ?, ?, ?, ?)`,
      [
        result.insertId,
        parseFloat(quantity),
        location || 'warehouse',
        facility_id || null,
        'Batch created'
      ]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Batch created successfully",
      data: {
        id: result.insertId,
        batch_number,
        item_id
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error creating batch:", error);
    res.status(500).json({
      success: false,
      message: "Error creating batch",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Update batch
const updateBatch = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      expiry_date,
      quantity,
      available_quantity,
      status,
      received_date
    } = req.body;

    // Check if batch exists
    const [existing] = await connection.execute(
      `SELECT * FROM inventory_batches WHERE id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Batch not found"
      });
    }

    const batch = existing[0];
    let finalStatus = status || batch.status;

    // Auto-update status based on expiry if not explicitly set
    if (expiry_date && !status) {
      const expiryDate = new Date(expiry_date);
      const today = new Date();
      const daysDiff = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

      if (daysDiff < 0) {
        finalStatus = 'expired';
      } else if (daysDiff <= 30) {
        finalStatus = 'near_expiry';
      } else if (batch.status !== 'recalled' && batch.status !== 'blocked') {
        finalStatus = 'active';
      }
    }

    const updateFields = [];
    const updateValues = [];

    if (expiry_date) {
      updateFields.push('expiry_date = ?');
      updateValues.push(expiry_date);
    }

    if (quantity !== undefined) {
      updateFields.push('quantity = ?');
      updateValues.push(parseFloat(quantity));
    }

    if (available_quantity !== undefined) {
      updateFields.push('available_quantity = ?');
      updateValues.push(parseFloat(available_quantity));
    }

    if (status) {
      updateFields.push('status = ?');
      updateValues.push(finalStatus);
    }

    if (received_date) {
      updateFields.push('received_date = ?');
      updateValues.push(received_date);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update"
      });
    }

    updateFields.push('updated_at = NOW()');
    updateValues.push(id);

    await connection.execute(
      `UPDATE inventory_batches SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    res.status(200).json({
      success: true,
      message: "Batch updated successfully"
    });
  } catch (error) {
    console.error("Error updating batch:", error);
    res.status(500).json({
      success: false,
      message: "Error updating batch",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Recall batch
const recallBatch = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const { id } = req.params;
    const { recall_reason, recalled_by } = req.body;

    if (!recall_reason) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Recall reason is required"
      });
    }

    // Check if batch exists
    const [existing] = await connection.execute(
      `SELECT * FROM inventory_batches WHERE id = ?`,
      [id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Batch not found"
      });
    }

    // Update batch status
    await connection.execute(
      `UPDATE inventory_batches 
       SET status = 'recalled', 
           recalled_at = NOW(), 
           recalled_by = ?, 
           recall_reason = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [recalled_by || null, recall_reason, id]
    );

    // Add batch movement
    await connection.execute(
      `INSERT INTO batch_movements 
       (batch_id, movement_type, quantity, remarks, user_id)
       VALUES (?, 'recalled', ?, ?, ?)`,
      [
        id,
        existing[0].available_quantity,
        `Batch recalled: ${recall_reason}`,
        recalled_by || null
      ]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Batch recalled successfully"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error recalling batch:", error);
    res.status(500).json({
      success: false,
      message: "Error recalling batch",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get batches by batch number (for recall search)
const getBatchesByBatchNumber = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { batch_number } = req.params;

    const [batches] = await connection.execute(
      `SELECT 
        ib.*,
        iw.item_name,
        iw.item_code,
        iw.category,
        s.name as supplier_name,
        f.name as facility_name,
        CASE 
          WHEN ib.expiry_date < CURDATE() THEN 'expired'
          WHEN ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'near_expiry'
          WHEN ib.status = 'recalled' THEN 'recalled'
          WHEN ib.status = 'blocked' THEN 'blocked'
          ELSE 'active'
        END as calculated_status
       FROM inventory_batches ib
       LEFT JOIN inventory_warehouse iw ON ib.item_id = iw.id
       LEFT JOIN suppliers s ON ib.supplier_id = s.id
       LEFT JOIN facilities f ON ib.facility_id = f.id
       WHERE ib.batch_number = ?
       ORDER BY ib.location, ib.facility_id, ib.created_at DESC`,
      [batch_number]
    );

    res.status(200).json({
      success: true,
      data: batches,
      total: batches.length
    });
  } catch (error) {
    console.error("Error fetching batches by batch number:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batches",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// FEFO: Get batches for dispatch (First Expiry First Out)
const getBatchesForDispatch = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { item_id, quantity, location, facility_id } = req.query;

    if (!item_id || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Item ID and quantity are required"
      });
    }

    // Get batches sorted by expiry date (FEFO)
    const [batches] = await connection.execute(
      `SELECT 
        ib.*,
        iw.item_name,
        iw.item_code,
        iw.unit,
        CASE 
          WHEN ib.expiry_date < CURDATE() THEN 'expired'
          WHEN ib.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'near_expiry'
          WHEN ib.status = 'recalled' THEN 'recalled'
          WHEN ib.status = 'blocked' THEN 'blocked'
          ELSE 'active'
        END as calculated_status,
        DATEDIFF(ib.expiry_date, CURDATE()) as days_until_expiry
       FROM inventory_batches ib
       LEFT JOIN inventory_warehouse iw ON ib.item_id = iw.id
       WHERE ib.item_id = ?
         AND ib.status NOT IN ('expired', 'recalled', 'blocked')
         AND ib.available_quantity > 0
         ${location ? 'AND ib.location = ?' : ''}
         ${facility_id ? 'AND ib.facility_id = ?' : ''}
       ORDER BY ib.expiry_date ASC, ib.created_at ASC
       LIMIT 50`,
      [item_id, ...(location ? [location] : []), ...(facility_id ? [facility_id] : [])]
    );

    // Calculate if we have enough stock
    const totalAvailable = batches.reduce((sum, batch) => sum + parseFloat(batch.available_quantity || 0), 0);
    const requestedQty = parseFloat(quantity);

    res.status(200).json({
      success: true,
      data: batches,
      total_available: totalAvailable,
      requested_quantity: requestedQty,
      sufficient_stock: totalAvailable >= requestedQty,
      batches_needed: batches.length
    });
  } catch (error) {
    console.error("Error fetching batches for dispatch:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching batches for dispatch",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Update batch quantities after dispatch
const updateBatchAfterDispatch = async (connection, batch_id, quantity_dispatched, movement_type = 'dispatched', requisition_id = null, dispatch_id = null, facility_id = null, user_id = null) => {
  try {
    // Get current batch
    const [batch] = await connection.execute(
      `SELECT * FROM inventory_batches WHERE id = ?`,
      [batch_id]
    );

    if (batch.length === 0) {
      throw new Error('Batch not found');
    }

    const currentBatch = batch[0];
    const newAvailableQty = Math.max(0, parseFloat(currentBatch.available_quantity) - parseFloat(quantity_dispatched));

    // Update batch
    await connection.execute(
      `UPDATE inventory_batches 
       SET available_quantity = ?, updated_at = NOW()
       WHERE id = ?`,
      [newAvailableQty, batch_id]
    );

    // Add movement record
    await connection.execute(
      `INSERT INTO batch_movements 
       (batch_id, movement_type, quantity, from_location, to_location, facility_id, requisition_id, dispatch_id, user_id, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch_id,
        movement_type,
        parseFloat(quantity_dispatched),
        currentBatch.location,
        facility_id ? 'facility' : 'warehouse',
        facility_id,
        requisition_id,
        dispatch_id,
        user_id,
        `${movement_type} ${quantity_dispatched} units`
      ]
    );

    return {
      batch_id,
      quantity_dispatched,
      remaining_quantity: newAvailableQty
    };
  } catch (error) {
    console.error("Error updating batch after dispatch:", error);
    throw error;
  }
};

module.exports = {
  getAllBatches,
  getBatchesByItem,
  getBatchById,
  createBatch,
  updateBatch,
  recallBatch,
  getBatchesByBatchNumber,
  getBatchesForDispatch,
  updateBatchAfterDispatch
};

