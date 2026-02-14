const { pool } = require('../config');

// Get inventory items


const getInventory = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        item_code,
        item_name,
        category,
        description,
        unit,
        quantity,
        reorder_level,
        item_cost,
        expiry_date,
        COALESCE(batch_number, 'N/A') as batch_number,
        created_at,
        updated_at
      FROM inventory_warehouse
      ORDER BY created_at DESC
    `;

    const [rows] = await pool.query(query);

    res.status(200).json({
      success: true,
      message: "All warehouse inventory fetched successfully.",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching all inventory:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
};

// Get warehouse inventory item by ID
const getWarehouseInventoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        id,
        item_code,
        item_name,
        category,
        description,
        unit,
        quantity,
        reorder_level,
        item_cost,
        expiry_date,
        COALESCE(batch_number, 'N/A') as batch_number,
        created_at,
        updated_at
      FROM inventory_warehouse
      WHERE id = ?
    `;

    const [rows] = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found."
      });
    }

    res.status(200).json({
      success: true,
      message: "Item details fetched successfully.",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error fetching inventory item:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
};

// Get inventory item by ID
const getInventoryById = async (req, res) => {
  try {
    const { id } = req.params;

    let query = `
      SELECT i.*, f.name as facility_name, f.location as facility_location,
             CASE WHEN i.quantity <= i.reorder_level THEN 1 ELSE 0 END as is_low_stock
      FROM inventory i
      LEFT JOIN facilities f ON i.facility_id = f.id
      WHERE i.id = ?
    `;

    const queryParams = [id];

    // Role-based access control
    // if (req.user.role === 'facility_admin' || req.user.role === 'facility_user') {
    //   query += ' AND i.facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // }

    const [items] = await pool.execute(query, queryParams);

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }

    res.json({
      success: true,
      data: items[0]
    });
  } catch (error) {
    console.error('Get inventory by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get inventory item',
      error: error.message
    });
  }
};

const getInventoryByFacilityId = async (req, res) => {
  try {
    const { id } = req.params; // facility_id

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required"
      });
    }

    const [items] = await pool.execute(`
      SELECT 
        ifac.id AS id,
        ifac.id AS facility_inventory_id,
        ifac.facility_id,
        ifac.item_id,
        ifac.quantity,
        COALESCE(ifac.batch_number, 'N/A') as batch_number,
        ifac.item_cost,
        ifac.expiry_date,
        -- Use COALESCE to prioritize inventory_facility fields, fallback to inventory table
        COALESCE(ifac.item_code, i.item_code) AS item_code,
        COALESCE(ifac.item_name, i.item_name) AS item_name,
        COALESCE(ifac.category, i.category) AS category,
        COALESCE(ifac.unit, i.unit) AS unit,
        COALESCE(ifac.reorder_level, i.reorder_level, 0) AS reorder_level,
        COALESCE(ifac.description, i.description, '') AS description,
        ifac.supplier_id,
        ifac.procurement_date,
        ifac.created_at,
        ifac.created_at AS added_at,

        -- facility table fields
        f.name AS facility_name,
        f.location AS facility_location,
        u.name AS facility_admin_user_name,

        -- supplier table fields
        s.name AS supplier_name,

        CASE WHEN ifac.quantity <= COALESCE(ifac.reorder_level, i.reorder_level, 0) THEN 1 ELSE 0 END AS is_low_stock

      FROM inventory_facility ifac
      LEFT JOIN inventory i 
        ON ifac.item_id = i.id
      LEFT JOIN facilities f 
        ON ifac.facility_id = f.id
      LEFT JOIN users u 
        ON f.admin_user_id = u.id
      LEFT JOIN suppliers s
        ON ifac.supplier_id = s.id
      WHERE ifac.facility_id = ?
      GROUP BY ifac.id
      ORDER BY ifac.updated_at DESC, ifac.created_at DESC
    `, [id]);

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Is facility ke liye koi inventory item nahi mila"
      });
    }

    res.json({
      success: true,
      message: "Inventory with requisition items retrieved successfully",
      data: items
    });

  } catch (error) {
    console.error("Get inventory by facility ID error:", error);
    res.status(500).json({
      success: false,
      message: "Inventory items fetch karne me error aayi",
      error: error.message
    });
  }
};

const getInventoryByUserId = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const user_id = req.params.user_id || req.query.user_id;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    console.log(`Fetching inventory for user_id: ${user_id}`);

    const [rows] = await connection.query(
      `SELECT 
          id,
          item_code,
          item_name,
          category,
          description,
          unit,
          user_id,
          item_id,
          quantity,
          reorder_level,
          item_cost,
          expiry_date,
          created_at,
          updated_at
       FROM inventory_user
       WHERE user_id = ?`,
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No inventory items found for this user",
      });
    }

    // Add batch_number as 'N/A' since inventory_user table doesn't have this column
    // If you want to add batch_number to inventory_user table, run:
    // ALTER TABLE inventory_user ADD COLUMN batch_number VARCHAR(100) DEFAULT NULL AFTER expiry_date;
    const rowsWithBatchNumber = rows.map(row => ({
      ...row,
      batch_number: 'N/A'
    }));

    res.status(200).json({
      success: true,
      data: rowsWithBatchNumber,
    });
  } catch (error) {
    console.error("Error fetching inventory by user_id:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


// Create inventory item
const createWarehouseInventory = async (req, res) => {
  try {
    const {
      item_code,
      item_name,
      category,
      description,
      unit,
      quantity,
      reorder_level,
      item_cost,
      expiry_date,
      batch_number
    } = req.body;

    if (
      !item_code ||
      !item_name ||
      !category ||
      !unit ||
      quantity == null ||
      reorder_level == null ||
      item_cost == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields."
      });
    }

    const [result] = await pool.query(
      `INSERT INTO inventory_warehouse 
      (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, batch_number, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        item_code,
        item_name,
        category,
        description || null,
        unit,
        quantity,
        reorder_level,
        item_cost,
        expiry_date || null,
        batch_number || null
      ]
    );

    res.status(201).json({
      success: true,
      message: "Warehouse inventory item created successfully.",
      id: result.insertId
    });
  } catch (error) {
    console.error("Error creating warehouse inventory:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
};


const createWarehouseInventoryBulk = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    let itemsData = req.body;

    // Convert single object to array if needed
    if (!Array.isArray(itemsData)) itemsData = [itemsData];

    if (itemsData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No inventory items provided."
      });
    }

    // Validate required fields for each item
    for (const item of itemsData) {
      const { item_code, item_name, category, unit, quantity, reorder_level, item_cost } = item;

      if (!item_code || !item_name || !category || !unit || quantity == null || reorder_level == null || item_cost == null) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required fields for every item."
        });
      }
    }

    await connection.beginTransaction();

    // Prepare data for bulk insert
    const values = itemsData.map(item => [
      item.item_code,
      item.item_name,
      item.category,
      item.description || null,
      item.unit,
      item.quantity,
      item.reorder_level,
      item.item_cost,
      item.expiry_date || null,
      item.batch_number || null,
      new Date(), // created_at
      new Date()  // updated_at
    ]);

    const query = `INSERT INTO inventory_warehouse 
      (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, batch_number, created_at, updated_at) 
      VALUES ?`;

    const [result] = await connection.query(query, [values]);

    await connection.commit();

    res.status(201).json({
      success: true,
      message: `${result.affectedRows} warehouse inventory items created successfully.`,
      ids: [] // Bulk insert doesn't easily return all IDs in MySQL, simply returning success count
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error creating warehouse inventory bulk:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
};



const createInventoryFacility = async (req, res) => {
  try {
    let itemsData = req.body;

    // Agar single item aaya ho (object form me)
    if (!Array.isArray(itemsData)) {
      itemsData = [itemsData];
    }

    console.log('Creating inventory items for all facilities:', itemsData.length);

    // 🔹 Get all facilities
    const [facilities] = await pool.execute('SELECT id, name FROM facilities');

    if (facilities.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No facilities found in the database',
      });
    }

    const createdItems = [];

    // 🔁 Loop over each item user sent
    for (const item of itemsData) {
      const {
        item_code,
        item_cost,
        expiry_date,
        item_name,
        category,
        description,
        unit,
        quantity,
        reorder_level = 0
      } = item;

      // ✅ Loop over each facility to insert same item
      for (const facility of facilities) {
        const facility_id = facility.id;

        // Check duplicate in same facility
        const [existing] = await pool.execute(
          'SELECT id FROM inventory WHERE item_code = ? AND facility_id = ?',
          [item_code, facility_id]
        );

        if (existing.length > 0) {
          console.warn(`Item already exists in facility (${facility.name}): ${item_code}`);
          continue;
        }

        // Insert item into inventory
        const [result] = await pool.execute(
          `INSERT INTO inventory 
            (item_code, item_cost, expiry_date, item_name, category, description, unit, quantity, reorder_level, facility_id, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            item_code,
            item_cost,
            expiry_date || null,
            item_name,
            category || null,
            description || null,
            unit,
            quantity || 0,
            reorder_level,
            facility_id
          ]
        );

        // Get inserted item detail with facility name
        const [inserted] = await pool.execute(
          `SELECT i.*, f.name as facility_name
           FROM inventory i
           LEFT JOIN facilities f ON i.facility_id = f.id
           WHERE i.id = ?`,
          [result.insertId]
        );

        createdItems.push(inserted[0]);
      }
    }

    if (createdItems.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'No new inventory items created (all duplicates already exist)',
      });
    }

    res.status(201).json({
      success: true,
      message: `${createdItems.length} inventory entries created successfully across facilities`,
      data: createdItems,
    });

  } catch (error) {
    console.error('Create inventory items error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create inventory items',
      error: error.message,
    });
  }
};

// Update inventory item
const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params; // Item ID from URL

    const {
      item_code,
      item_name,
      category,
      description,
      unit,
      quantity,
      reorder_level,
      item_cost,
      expiry_date,
      batch_number
    } = req.body;

    // ✅ Validate ID
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required."
      });
    }

    // ✅ Check if item exists
    const [existingItem] = await pool.query(
      "SELECT id FROM inventory_warehouse WHERE id = ?",
      [id]
    );

    if (!existingItem || existingItem.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found."
      });
    }

    // ✅ Build dynamic update query (so null fields don't overwrite existing values)
    const updateFields = [];
    const values = [];

    if (item_code !== undefined) {
      updateFields.push("item_code = ?");
      values.push(item_code);
    }
    if (item_name !== undefined) {
      updateFields.push("item_name = ?");
      values.push(item_name);
    }
    if (category !== undefined) {
      updateFields.push("category = ?");
      values.push(category);
    }
    if (description !== undefined) {
      updateFields.push("description = ?");
      values.push(description);
    }
    if (unit !== undefined) {
      updateFields.push("unit = ?");
      values.push(unit);
    }
    if (quantity !== undefined) {
      updateFields.push("quantity = ?");
      values.push(quantity);
    }
    if (reorder_level !== undefined) {
      updateFields.push("reorder_level = ?");
      values.push(reorder_level);
    }
    if (item_cost !== undefined) {
      updateFields.push("item_cost = ?");
      values.push(item_cost);
    }
    if (expiry_date !== undefined) {
      updateFields.push("expiry_date = ?");
      values.push(expiry_date);
    }
    if (batch_number !== undefined) {
      updateFields.push("batch_number = ?");
      values.push(batch_number);
    }

    // Always update updated_at
    updateFields.push("updated_at = NOW()");

    values.push(id);

    const updateQuery = `
      UPDATE inventory_warehouse 
      SET ${updateFields.join(", ")} 
      WHERE id = ?
    `;

    // ✅ Execute query
    const [result] = await pool.query(updateQuery, values);

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: "No changes were made to the item."
      });
    }

    res.status(200).json({
      success: true,
      message: "Inventory item updated successfully."
    });

  } catch (error) {
    console.error("❌ Error updating inventory item:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
};

// Update stock quantity
const updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, type, remarks } = req.body; // type: 'add', 'subtract', 'set'

    // Check access permissions
    let query = 'SELECT quantity, facility_id FROM inventory WHERE id = ?';
    const queryParams = [id];

    // if (req.user.role === 'facility_admin') {
    //   query += ' AND facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // } else if (req.user.role === 'facility_user') {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Facility users cannot update stock'
    //   });
    // }

    const [items] = await pool.execute(query, queryParams);

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found or access denied'
      });
    }

    const currentQuantity = items[0].quantity;
    let newQuantity;

    switch (type) {
      case 'add':
        newQuantity = currentQuantity + quantity;
        break;
      case 'subtract':
        newQuantity = Math.max(0, currentQuantity - quantity);
        break;
      case 'set':
        newQuantity = quantity;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid stock update type'
        });
    }

    // Update stock
    await pool.execute(
      'UPDATE inventory SET quantity = ?, updated_at = NOW() WHERE id = ?',
      [newQuantity, id]
    );

    // Log stock movement
    await pool.execute(
      `INSERT INTO stock_movements (inventory_id, type, quantity, previous_quantity, new_quantity, remarks, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, type, quantity, currentQuantity, newQuantity, remarks || null, req.user.id]
    );

    // Get updated item
    const [updatedItems] = await pool.execute(
      `SELECT i.*, f.name as facility_name
       FROM inventory i
       LEFT JOIN facilities f ON i.facility_id = f.id
       WHERE i.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Stock updated successfully',
      data: updatedItems[0]
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update stock',
      error: error.message
    });
  }
};

// Delete inventory item
const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params; // Item ID from URL

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required."
      });
    }

    // Check if item exists
    const [existing] = await pool.query(
      "SELECT * FROM inventory_warehouse WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found."
      });
    }

    // Delete the item
    await pool.query("DELETE FROM inventory_warehouse WHERE id = ?", [id]);

    res.status(200).json({
      success: true,
      message: "Inventory item deleted successfully."
    });
  } catch (error) {
    console.error("Error deleting inventory item:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
};

// Get stock movements
const getStockMovements = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Check access permissions
    let query = 'SELECT facility_id FROM inventory WHERE id = ?';
    const queryParams = [id];

    // if (req.user.role === 'facility_admin' || req.user.role === 'facility_user') {
    //   query += ' AND facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // }

    const [items] = await pool.execute(query, queryParams);

    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found or access denied'
      });
    }

    // Get stock movements
    const [movements] = await pool.execute(
      `SELECT sm.*, u.name as user_name
       FROM stock_movements sm
       LEFT JOIN users u ON sm.user_id = u.id
       WHERE sm.inventory_id = ?
       ORDER BY sm.created_at DESC
       LIMIT ? OFFSET ?`,
      [id, parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM stock_movements WHERE inventory_id = ?',
      [id]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        movements,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get stock movements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stock movements',
      error: error.message
    });
  }
};

// Get categories
const getCategories = async (req, res) => {
  try {
    const [categories] = await pool.execute(
      `SELECT DISTINCT category 
       FROM inventory 
       WHERE category IS NOT NULL 
       ORDER BY category`
    );

    if (categories.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Koi category available nahi hai',
        data: []
      });
    }

    res.json({
      success: true,
      message: 'Categories fetched successfully',
      data: categories.map(cat => cat.category)
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Categories fetch karne me error aayi',
      error: error.message
    });
  }
};


// Date validation and conversion helper
const validateAndConvertDate = (dateStr) => {
  if (!dateStr || dateStr.toString().trim() === '' || dateStr.toString().toLowerCase() === 'n/a' || dateStr.toString().toLowerCase() === 'na') {
    return null;
  }

  // Remove quotes and trim
  dateStr = dateStr.toString().replace(/['"]/g, '').trim();

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // Validate the date
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return null;
    }
    return dateStr;
  }

  // Handle MM/DD/YYYY format (e.g., 12/26/2025)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const parts = dateStr.split('/');
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    const convertedDate = `${year}-${month}-${day}`;

    // Validate
    const date = new Date(convertedDate);
    if (isNaN(date.getTime())) {
      return null;
    }
    return convertedDate;
  }

  // Try to parse as Date object
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // Invalid date
  }

  return null;
};

// CSV/Excel Bulk Import
const bulkImportInventory = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { items } = req.body; // Array of items from CSV/Excel

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required"
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const item of items) {
      try {
        const {
          item_code,
          item_name,
          category,
          description,
          unit,
          quantity,
          reorder_level,
          item_cost,
          expiry_date,
          batch_number,
          supplier_id
        } = item;

        if (!item_name || !category) {
          results.failed.push({
            item: item_name || 'Unknown',
            error: 'Missing required fields: item_name and category'
          });
          continue;
        }

        // Validate and convert date
        const validExpiryDate = validateAndConvertDate(expiry_date);
        if (expiry_date && expiry_date.toString().trim() !== '' && expiry_date.toString().toLowerCase() !== 'n/a' && !validExpiryDate) {
          results.failed.push({
            item: item_name,
            error: `Invalid date format for expiry_date: "${expiry_date}". Use YYYY-MM-DD format (e.g., 2025-12-31) or MM/DD/YYYY format (e.g., 12/31/2025)`
          });
          continue;
        }

        // Check if item exists
        const [existing] = await connection.execute(
          `SELECT id FROM inventory_warehouse WHERE item_code = ? OR (item_name = ? AND category = ?)`,
          [item_code || null, item_name, category]
        );

        if (existing.length > 0) {
          // Update existing
          await connection.execute(
            `UPDATE inventory_warehouse SET
             quantity = quantity + ?,
             item_cost = ?,
             expiry_date = ?,
             batch_number = ?,
             supplier_id = ?,
             updated_at = NOW()
             WHERE id = ?`,
            [
              parseFloat(quantity) || 0,
              item_cost || null,
              validExpiryDate,
              batch_number || null,
              supplier_id || null,
              existing[0].id
            ]
          );
          results.success.push({ item: item_name, action: 'updated' });
        } else {
          // Insert new
          const [result] = await connection.execute(
            `INSERT INTO inventory_warehouse 
             (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, batch_number, supplier_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
              item_code || null,
              item_name,
              category,
              description || null,
              unit || 'units',
              parseFloat(quantity) || 0,
              parseInt(reorder_level) || 0,
              item_cost || null,
              validExpiryDate,
              batch_number || null,
              supplier_id || null
            ]
          );
          results.success.push({ item: item_name, action: 'created', id: result.insertId });
        }
      } catch (error) {
        results.failed.push({
          item: item.item_name || 'Unknown',
          error: error.message
        });
      }
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: `Bulk import completed. ${results.success.length} succeeded, ${results.failed.length} failed.`,
      data: results
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error in bulk import:", error);
    res.status(500).json({
      success: false,
      message: "Error in bulk import",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Manual Entry for External Procurement
const manualEntryInventory = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const {
      facility_id,
      item_code,
      item_name,
      category,
      description,
      unit,
      quantity,
      reorder_level,
      item_cost,
      expiry_date,
      batch_number,
      supplier_id,
      procurement_date
    } = req.body;

    if (!facility_id || !item_name || !category) {
      return res.status(400).json({
        success: false,
        message: "facility_id, item_name, and category are required"
      });
    }

    // Check if item exists in facility inventory
    const [existing] = await connection.execute(
      `SELECT id, quantity FROM inventory_facility 
       WHERE facility_id = ? AND item_name = ? AND category = ?`,
      [facility_id, item_name, category]
    );

    if (existing.length > 0) {
      // Update existing
      await connection.execute(
        `UPDATE inventory_facility SET
         quantity = quantity + ?,
         item_cost = ?,
         expiry_date = ?,
         batch_number = ?,
         supplier_id = ?,
         procurement_date = ?,
         source_type = 'external',
         updated_at = NOW()
         WHERE id = ?`,
        [
          parseFloat(quantity) || 0,
          item_cost || null,
          expiry_date || null,
          batch_number || null,
          supplier_id || null,
          procurement_date || null,
          existing[0].id
        ]
      );

      await connection.commit();
      return res.status(200).json({
        success: true,
        message: "Inventory updated successfully (external procurement)",
        data: { id: existing[0].id, action: 'updated' }
      });
    } else {
      // Insert new - First check/create item in inventory_warehouse for item_id
      let warehouse_item_id = null;
      
      // Check if item exists in inventory_warehouse by item_code or item_name
      if (item_code) {
        const [existingWarehouse] = await connection.execute(
          `SELECT id FROM inventory_warehouse WHERE item_code = ?`,
          [item_code]
        );
        if (existingWarehouse.length > 0) {
          warehouse_item_id = existingWarehouse[0].id;
        }
      }
      
      // If not found by code, check by name
      if (!warehouse_item_id) {
        const [existingWarehouseByName] = await connection.execute(
          `SELECT id FROM inventory_warehouse WHERE item_name = ? AND category = ?`,
          [item_name, category]
        );
        if (existingWarehouseByName.length > 0) {
          warehouse_item_id = existingWarehouseByName[0].id;
        }
      }
      
      // If still not found, create new item in inventory_warehouse
      if (!warehouse_item_id) {
        const [warehouseResult] = await connection.execute(
          `INSERT INTO inventory_warehouse 
           (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, batch_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NOW(), NOW())`,
          [
            item_code || `EXT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            item_name,
            category,
            description || null,
            unit || 'units',
            parseInt(reorder_level) || 0,
            item_cost || null,
            expiry_date || null,
            batch_number || null
          ]
        );
        warehouse_item_id = warehouseResult.insertId;
      }
      
      // Now insert into inventory_facility with the warehouse_item_id
      const [result] = await connection.execute(
        `INSERT INTO inventory_facility 
         (item_code, item_name, category, description, unit, facility_id, item_id, quantity, reorder_level, item_cost, expiry_date, batch_number, source_type, supplier_id, procurement_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, ?, NOW(), NOW())`,
        [
          item_code || null,
          item_name,
          category,
          description || null,
          unit || 'units',
          facility_id,
          warehouse_item_id,
          parseFloat(quantity) || 0,
          parseInt(reorder_level) || 0,
          item_cost || null,
          expiry_date || null,
          batch_number || null,
          supplier_id || null,
          procurement_date || null
        ]
      );

      await connection.commit();
      return res.status(201).json({
        success: true,
        message: "Inventory added successfully (external procurement)",
        data: { id: result.insertId, action: 'created', warehouse_item_id: warehouse_item_id }
      });
    }
  } catch (error) {
    await connection.rollback();
    console.error("Error in manual entry:", error);
    res.status(500).json({
      success: false,
      message: "Error in manual entry",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  getInventory,
  getWarehouseInventoryById,
  getInventoryById,
  createWarehouseInventory,
  updateInventoryItem,
  updateStock,
  deleteInventoryItem,
  getStockMovements,
  getCategories,
  getInventoryByFacilityId,
  getInventoryByUserId,
  createWarehouseInventoryBulk,
  createInventoryFacility,
  bulkImportInventory,
  manualEntryInventory
};
