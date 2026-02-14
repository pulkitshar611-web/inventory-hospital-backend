const { pool } = require('../config');

// Helper: Generate unique supplier code
const generateSupplierCode = async (connection) => {
  let code;
  let isUnique = false;
  let attempts = 0;
  
  while (!isUnique && attempts < 100) {
    const prefix = 'SUP';
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    code = `${prefix}-${timestamp}-${random}`;
    
    const [existing] = await connection.execute(
      `SELECT id FROM suppliers WHERE supplier_code = ?`,
      [code]
    );
    
    if (existing.length === 0) {
      isUnique = true;
    }
    attempts++;
  }
  
  return code;
};

// Get all suppliers with item count
const getAllSuppliers = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const [suppliers] = await connection.execute(
      `SELECT 
        s.*,
        COUNT(DISTINCT sim.id) as total_items_supplied,
        COUNT(DISTINCT sh.id) as total_transactions
       FROM suppliers s
       LEFT JOIN supplier_item_mapping sim ON s.id = sim.supplier_id AND sim.status = 'active'
       LEFT JOIN supplier_history sh ON s.id = sh.supplier_id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    );

    res.status(200).json({
      success: true,
      data: suppliers,
      total: suppliers.length
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching suppliers",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get supplier by ID with items and history
const getSupplierById = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { includeItems, includeHistory } = req.query;
    
    const [suppliers] = await connection.execute(
      `SELECT * FROM suppliers WHERE id = ?`,
      [id]
    );

    if (suppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found"
      });
    }

    const supplier = suppliers[0];
    const result = { ...supplier };

    // Get supplied items if requested
    if (includeItems === 'true') {
      const [items] = await connection.execute(
        `SELECT 
          sim.*,
          iw.item_code as warehouse_item_code,
          iw.item_name as warehouse_item_name,
          iw.category as warehouse_category
         FROM supplier_item_mapping sim
         LEFT JOIN inventory_warehouse iw ON sim.item_id = iw.id
         WHERE sim.supplier_id = ? AND sim.status = 'active'
         ORDER BY sim.created_at DESC`,
        [id]
      );
      result.supplied_items = items;
      result.total_items = items.length;
    }

    // Get supplier history if requested
    if (includeHistory === 'true') {
      const [history] = await connection.execute(
        `SELECT 
          sh.*,
          u.name as created_by_name
         FROM supplier_history sh
         LEFT JOIN users u ON sh.created_by = u.id
         WHERE sh.supplier_id = ?
         ORDER BY sh.created_at DESC
         LIMIT 100`,
        [id]
      );
      result.history = history;
      result.total_transactions = history.length;
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Create supplier with auto-generated code
const createSupplier = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      name,
      contact_person,
      email,
      phone,
      address,
      city,
      state,
      country,
      zip_code,
      tax_id,
      payment_terms,
      status,
      notes,
      supplier_code
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Supplier name is required"
      });
    }

    // Generate supplier code if not provided
    let finalSupplierCode = supplier_code;
    if (!finalSupplierCode) {
      finalSupplierCode = await generateSupplierCode(connection);
    } else {
      // Check if provided code is unique
      const [existing] = await connection.execute(
        `SELECT id FROM suppliers WHERE supplier_code = ?`,
        [finalSupplierCode]
      );
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Supplier code already exists"
        });
      }
    }

    const [result] = await connection.execute(
      `INSERT INTO suppliers 
       (supplier_code, name, contact_person, email, phone, address, city, state, country, zip_code, tax_id, payment_terms, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalSupplierCode,
        name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        city || null,
        state || null,
        country || null,
        zip_code || null,
        tax_id || null,
        payment_terms || null,
        status || 'active',
        notes || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: {
        id: result.insertId,
        supplier_code: finalSupplierCode,
        name
      }
    });
  } catch (error) {
    console.error("Error creating supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error creating supplier",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Update supplier
const updateSupplier = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      name,
      contact_person,
      email,
      phone,
      address,
      city,
      state,
      country,
      zip_code,
      tax_id,
      payment_terms,
      status,
      notes
    } = req.body;

    // Check if supplier exists
    const [existing] = await connection.execute(
      `SELECT id FROM suppliers WHERE id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found"
      });
    }

    await connection.execute(
      `UPDATE suppliers SET
       name = ?, contact_person = ?, email = ?, phone = ?, address = ?,
       city = ?, state = ?, country = ?, zip_code = ?, tax_id = ?,
       payment_terms = ?, status = ?, notes = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        city || null,
        state || null,
        country || null,
        zip_code || null,
        tax_id || null,
        payment_terms || null,
        status || 'active',
        notes || null,
        id
      ]
    );

    res.status(200).json({
      success: true,
      message: "Supplier updated successfully"
    });
  } catch (error) {
    console.error("Error updating supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error updating supplier",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Delete supplier
const deleteSupplier = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    // Check if supplier exists
    const [existing] = await connection.execute(
      `SELECT id FROM suppliers WHERE id = ?`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found"
      });
    }

    // Check if supplier is used in inventory
    const [inventoryCheck] = await connection.execute(
      `SELECT COUNT(*) as count FROM inventory_warehouse WHERE supplier_id = ?
       UNION ALL
       SELECT COUNT(*) as count FROM inventory_facility WHERE supplier_id = ?`,
      [id, id]
    );

    if (inventoryCheck.length > 0 && inventoryCheck[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete supplier. It is being used in inventory records."
      });
    }

    await connection.execute(
      `DELETE FROM suppliers WHERE id = ?`,
      [id]
    );

    res.status(200).json({
      success: true,
      message: "Supplier deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting supplier",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Add item to supplier mapping
const addSupplierItem = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { supplier_id } = req.params;
    const { item_id, item_name, item_category, item_code } = req.body;

    if (!item_name) {
      return res.status(400).json({
        success: false,
        message: "Item name is required"
      });
    }

    // Check if supplier exists
    const [supplier] = await connection.execute(
      `SELECT id FROM suppliers WHERE id = ?`,
      [supplier_id]
    );

    if (supplier.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found"
      });
    }

    // Check if mapping already exists
    const [existing] = await connection.execute(
      `SELECT id FROM supplier_item_mapping 
       WHERE supplier_id = ? AND item_id = ? AND status = 'active'`,
      [supplier_id, item_id || null]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Item already mapped to this supplier"
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO supplier_item_mapping 
       (supplier_id, item_id, item_name, item_category, item_code, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [
        supplier_id,
        item_id || null,
        item_name,
        item_category || null,
        item_code || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Item added to supplier successfully",
      data: {
        id: result.insertId,
        supplier_id,
        item_name
      }
    });
  } catch (error) {
    console.error("Error adding supplier item:", error);
    res.status(500).json({
      success: false,
      message: "Error adding supplier item",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Remove item from supplier mapping
const removeSupplierItem = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { supplier_id, mapping_id } = req.params;

    const [result] = await connection.execute(
      `UPDATE supplier_item_mapping 
       SET status = 'inactive', updated_at = NOW()
       WHERE id = ? AND supplier_id = ?`,
      [mapping_id, supplier_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Mapping not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Item removed from supplier successfully"
    });
  } catch (error) {
    console.error("Error removing supplier item:", error);
    res.status(500).json({
      success: false,
      message: "Error removing supplier item",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Add supplier history entry
const addSupplierHistory = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { supplier_id } = req.params;
    const {
      item_id,
      item_name,
      transaction_type,
      quantity,
      batch_number,
      expiry_date,
      unit_price,
      purchase_order_number,
      received_date,
      remarks,
      created_by
    } = req.body;

    if (!item_name || !transaction_type || !quantity) {
      return res.status(400).json({
        success: false,
        message: "Item name, transaction type, and quantity are required"
      });
    }

    const total_amount = unit_price ? parseFloat(unit_price) * parseFloat(quantity) : null;

    const [result] = await connection.execute(
      `INSERT INTO supplier_history 
       (supplier_id, item_id, item_name, transaction_type, quantity, batch_number, 
        expiry_date, unit_price, total_amount, purchase_order_number, received_date, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_id,
        item_id || null,
        item_name,
        transaction_type,
        parseFloat(quantity),
        batch_number || null,
        expiry_date || null,
        unit_price || null,
        total_amount,
        purchase_order_number || null,
        received_date || null,
        remarks || null,
        created_by || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "History entry added successfully",
      data: {
        id: result.insertId,
        supplier_id
      }
    });
  } catch (error) {
    console.error("Error adding supplier history:", error);
    res.status(500).json({
      success: false,
      message: "Error adding supplier history",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get supplier history
const getSupplierHistory = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { supplier_id } = req.params;
    const { start_date, end_date, transaction_type } = req.query;

    let query = `
      SELECT 
        sh.*,
        u.name as created_by_name
      FROM supplier_history sh
      LEFT JOIN users u ON sh.created_by = u.id
      WHERE sh.supplier_id = ?
    `;
    const params = [supplier_id];

    if (start_date) {
      query += ` AND sh.created_at >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      query += ` AND sh.created_at <= ?`;
      params.push(end_date);
    }

    if (transaction_type) {
      query += ` AND sh.transaction_type = ?`;
      params.push(transaction_type);
    }

    query += ` ORDER BY sh.created_at DESC LIMIT 500`;

    const [history] = await connection.execute(query, params);

    res.status(200).json({
      success: true,
      data: history,
      total: history.length
    });
  } catch (error) {
    console.error("Error fetching supplier history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching supplier history",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  getAllSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  addSupplierItem,
  removeSupplierItem,
  addSupplierHistory,
  getSupplierHistory
};

