const { pool } = require('../config');

// Get incoming goods for facility - Fetch from dispatches table (dynamic data)
const getIncomingGoods = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { facility_id } = req.params;
    const { status } = req.query;

    // Fetch from dispatches table joined with requisition items to get requested vs approved quantities
    let query = `
      SELECT 
        d.id,
        d.requisition_id,
        d.facility_id,
        d.item_id,
        d.quantity as quantity_dispatched,
        d.status as dispatch_status,
        d.tracking_number,
        d.remark,
        d.updated_at as created_at,
        iw.item_name,
        iw.item_code,
        iw.category,
        iw.unit,
        iw.expiry_date,
        iw.batch_number,
        -- Fetch original requested quantity and approved quantity from different possible requisition tables
        COALESCE(fri.quantity, ri.quantity, rr.required_qty, 0) as requested_quantity,
        COALESCE(fri.approved_quantity, ri.approved_quantity, d.quantity) as approved_quantity,
        -- Get received quantity from incoming_goods if exists
        COALESCE(ig.quantity_received, 0) as quantity_received,
        -- Get received_by from incoming_goods
        u.name as received_by_name,
        -- Enhanced Status Mapping
        CASE 
          -- ✅ When warehouse delivers, show "delivered" status (not "received")
          WHEN d.status = 'delivered' AND COALESCE(ig.quantity_received, 0) = 0 THEN 'delivered'
          WHEN d.status = 'delivered' AND COALESCE(ig.quantity_received, 0) > 0 AND COALESCE(ig.quantity_received, 0) < d.quantity THEN 'partial'
          WHEN d.status = 'delivered' AND COALESCE(ig.quantity_received, 0) >= d.quantity THEN 'received'
          WHEN d.status = 'dispatched' AND COALESCE(ig.quantity_received, 0) = 0 THEN 'dispatched'
          WHEN d.status = 'dispatched' AND COALESCE(ig.quantity_received, 0) > 0 AND COALESCE(ig.quantity_received, 0) < d.quantity THEN 'partial'
          WHEN d.status = 'dispatched' AND COALESCE(ig.quantity_received, 0) >= d.quantity THEN 'received'
          WHEN d.status = 'pending' THEN 'approved'
          WHEN d.status = 'rejected' THEN 'rejected'
          ELSE d.status
        END as incoming_status
      FROM dispatches d
      LEFT JOIN inventory_warehouse iw ON d.item_id = iw.id
      LEFT JOIN incoming_goods ig ON ig.dispatch_id = d.id
      LEFT JOIN users u ON ig.received_by = u.id
      -- Join with various requisition item tables
      LEFT JOIN facility_requisition_item fri ON d.requisition_id = fri.requisition_id AND d.item_id = fri.item_id
      LEFT JOIN requisition_items ri ON d.requisition_id = ri.requisition_id AND d.item_id = ri.item_id
      LEFT JOIN raise_requests rr ON d.requisition_id = rr.requisition_id AND d.item_id = rr.item_id
      WHERE d.facility_id = ?
    `;
    const params = [facility_id];

    if (status && status !== 'All') {
      if (status === 'pending' || status === 'approved') {
        query += ` AND d.status = 'pending'`;
      } else if (status === 'dispatched') {
        query += ` AND d.status = 'dispatched' AND COALESCE(ig.quantity_received, 0) = 0`;
      } else if (status === 'delivered') {
        query += ` AND d.status = 'delivered' AND COALESCE(ig.quantity_received, 0) = 0`;
      } else if (status === 'received') {
        query += ` AND ((d.status = 'delivered' OR d.status = 'dispatched') AND COALESCE(ig.quantity_received, 0) >= d.quantity)`;
      } else if (status === 'partial') {
        query += ` AND (d.status = 'dispatched' OR d.status = 'delivered') AND COALESCE(ig.quantity_received, 0) > 0 AND COALESCE(ig.quantity_received, 0) < d.quantity`;
      } else if (status === 'rejected') {
        query += ` AND d.status = 'rejected'`;
      }
    }

    query += ` ORDER BY d.updated_at DESC, d.id DESC`;

    const [goods] = await connection.execute(query, params);

    // Transform data to match frontend expectations
    const transformedGoods = goods.map(g => ({
      id: g.id,
      requisition_id: g.requisition_id,
      facility_id: g.facility_id,
      dispatch_id: g.id,
      item_id: g.item_id,
      item_name: g.item_name || 'N/A',
      item_code: g.item_code || 'N/A',
      category: g.category || 'N/A',
      unit: g.unit || 'N/A',
      requested_quantity: g.requested_quantity || 0,
      approved_quantity: g.approved_quantity || 0,
      quantity_dispatched: g.quantity_dispatched || 0,
      quantity_received: g.quantity_received || 0,
      status: g.incoming_status || 'pending',
      dispatch_status: g.dispatch_status,
      tracking_number: g.tracking_number || null,
      remark: g.remark || null,
      received_by_name: g.received_by_name || null,
      expiry_date: g.expiry_date || null,
      batch_number: g.batch_number || null,
      created_at: g.created_at || new Date().toISOString()
    }));

    res.status(200).json({
      success: true,
      data: transformedGoods,
      total: transformedGoods.length
    });
  } catch (error) {
    console.error("Error fetching incoming goods:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching incoming goods",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Mark goods as received - Works with dispatch_id
const markAsReceived = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params; // This is now dispatch_id
    const { quantity_received, remarks, received_by } = req.body;

    // Get dispatch record
    const [dispatch] = await connection.execute(
      `SELECT * FROM dispatches WHERE id = ?`,
      [id]
    );

    if (dispatch.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Dispatch record not found"
      });
    }

    const dispatchRecord = dispatch[0];
    const qtyReceived = parseFloat(quantity_received) || parseFloat(dispatchRecord.quantity);
    const requisition_id = dispatchRecord.requisition_id;
    const facility_id = dispatchRecord.facility_id;
    const item_id = dispatchRecord.item_id;

    // Check if incoming_goods record exists, if not create it
    const [existingIncoming] = await connection.execute(
      `SELECT * FROM incoming_goods WHERE dispatch_id = ?`,
      [id]
    );

    let newStatus = 'received';
    if (qtyReceived < parseFloat(dispatchRecord.quantity)) {
      newStatus = 'partial';
    }

    if (existingIncoming.length > 0) {
      // Update existing incoming_goods record
      await connection.execute(
        `UPDATE incoming_goods 
         SET quantity_received = ?, status = ?, received_by = ?, received_at = NOW(), remarks = ?, updated_at = NOW()
         WHERE dispatch_id = ?`,
        [qtyReceived, newStatus, received_by || null, remarks || null, id]
      );
    } else {
      // Create new incoming_goods record
      const [itemData] = await connection.execute(
        `SELECT item_name, item_code FROM inventory_warehouse WHERE id = ?`,
        [item_id]
      );

      await connection.execute(
        `INSERT INTO incoming_goods 
         (requisition_id, facility_id, dispatch_id, item_id, item_name, quantity_dispatched, quantity_received, status, received_by, received_at, remarks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
        [
          requisition_id,
          facility_id,
          id,
          item_id,
          itemData.length > 0 ? itemData[0].item_name : null,
          dispatchRecord.quantity,
          qtyReceived,
          newStatus,
          received_by || null,
          remarks || null
        ]
      );
    }

    // Auto-update facility inventory
    // ✅ Try multiple sources for item data (warehouse -> requisition_items -> inventory)
    let itemData = null;
    
    // First try: inventory_warehouse
    const [warehouseData] = await connection.execute(
      `SELECT * FROM inventory_warehouse WHERE id = ?`,
      [item_id]
    );
    
    if (warehouseData.length > 0) {
      itemData = warehouseData[0];
    } else {
      // Fallback: Try requisition_items (for user requisitions)
      const [reqItemData] = await connection.execute(
        `SELECT ri.*, iw.item_code, iw.item_name, iw.category, iw.description, iw.unit, iw.item_cost, iw.expiry_date, iw.reorder_level, iw.batch_number
         FROM requisition_items ri
         LEFT JOIN inventory_warehouse iw ON ri.item_id = iw.id
         WHERE ri.requisition_id = ? AND ri.item_id = ?
         LIMIT 1`,
        [requisition_id, item_id]
      );
      
      if (reqItemData.length > 0) {
        itemData = reqItemData[0];
      } else {
        // Final fallback: Try inventory table
        const [inventoryData] = await connection.execute(
          `SELECT * FROM inventory WHERE item_id = ? OR id = ? LIMIT 1`,
          [item_id, item_id]
        );
        
        if (inventoryData.length > 0) {
          itemData = inventoryData[0];
        }
      }
    }

    if (itemData) {
      // Check if item exists in facility inventory
      const [existing] = await connection.execute(
        `SELECT id, quantity, item_code, item_name, category, description, unit FROM inventory_facility WHERE item_id = ? AND facility_id = ?`,
        [item_id, facility_id]
      );

      if (existing.length > 0) {
        // ✅ Update existing - Also update item details if they are null
        const existingItem = existing[0];
        const updateFields = ['quantity = quantity + ?', 'updated_at = NOW()'];
        const updateValues = [qtyReceived];
        
        // ✅ Update item details if they are null in existing record
        if (!existingItem.item_code && itemData.item_code) {
          updateFields.push('item_code = ?');
          updateValues.push(itemData.item_code);
        }
        if (!existingItem.item_name && itemData.item_name) {
          updateFields.push('item_name = ?');
          updateValues.push(itemData.item_name);
        }
        if (!existingItem.category && itemData.category) {
          updateFields.push('category = ?');
          updateValues.push(itemData.category);
        }
        if (!existingItem.description && itemData.description) {
          updateFields.push('description = ?');
          updateValues.push(itemData.description);
        }
        if (!existingItem.unit && itemData.unit) {
          updateFields.push('unit = ?');
          updateValues.push(itemData.unit);
        }
        
        updateValues.push(existingItem.id);
        
        await connection.execute(
          `UPDATE inventory_facility 
           SET ${updateFields.join(', ')}
           WHERE id = ?`,
          updateValues
        );
      } else {
        // Insert new
        await connection.execute(
          `INSERT INTO inventory_facility 
           (item_code, item_name, category, description, unit, facility_id, item_id, quantity, reorder_level, item_cost, expiry_date, batch_number, source_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'warehouse', NOW(), NOW())`,
          [
            itemData.item_code || null,
            itemData.item_name || null,
            itemData.category || null,
            itemData.description || null,
            itemData.unit || 'units',
            facility_id,
            item_id,
            qtyReceived,
            itemData.reorder_level || 10,
            itemData.item_cost || 0,
            itemData.expiry_date || null,
            itemData.batch_number || null
          ]
        );
      }
    } else {
      // ✅ If item data not found anywhere, still update quantity but log warning
      console.warn(`Item data not found for item_id: ${item_id}, requisition_id: ${requisition_id}. Updating quantity only.`);
      
      const [existing] = await connection.execute(
        `SELECT id FROM inventory_facility WHERE item_id = ? AND facility_id = ?`,
        [item_id, facility_id]
      );
      
      if (existing.length > 0) {
        await connection.execute(
          `UPDATE inventory_facility 
           SET quantity = quantity + ?, updated_at = NOW()
           WHERE id = ?`,
          [qtyReceived, existing[0].id]
        );
      } else {
        // Insert with minimal data
        await connection.execute(
          `INSERT INTO inventory_facility 
           (facility_id, item_id, quantity, source_type, created_at, updated_at)
           VALUES (?, ?, ?, 'warehouse', NOW(), NOW())`,
          [facility_id, item_id, qtyReceived]
        );
      }
    }

    // ✅ Deduct quantity from warehouse inventory when facility receives
    const [warehouseItem] = await connection.execute(
      `SELECT id, quantity FROM inventory_warehouse WHERE id = ?`,
      [item_id]
    );

    if (warehouseItem.length > 0) {
      const currentWarehouseQty = parseFloat(warehouseItem[0].quantity) || 0;
      const newWarehouseQty = Math.max(0, currentWarehouseQty - qtyReceived); // Prevent negative

      if (currentWarehouseQty >= qtyReceived) {
        // ✅ Deduct from warehouse inventory
        await connection.execute(
          `UPDATE inventory_warehouse 
           SET quantity = ?, updated_at = NOW()
           WHERE id = ?`,
          [newWarehouseQty, item_id]
        );
        console.log(`✅ Warehouse inventory updated: Item ${item_id}, Deducted: ${qtyReceived}, Remaining: ${newWarehouseQty}`);
      } else {
        // ⚠️ Warning if warehouse doesn't have enough stock
        console.warn(`⚠️ Warehouse inventory insufficient: Item ${item_id}, Available: ${currentWarehouseQty}, Requested: ${qtyReceived}`);
        // Still deduct what's available
        await connection.execute(
          `UPDATE inventory_warehouse 
           SET quantity = 0, updated_at = NOW()
           WHERE id = ?`,
          [item_id]
        );
      }
    } else {
      console.warn(`⚠️ Item ${item_id} not found in warehouse inventory. Cannot deduct quantity.`);
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Goods marked as received and inventory updated",
      data: {
        id,
        quantity_received: qtyReceived,
        status: newStatus
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error marking goods as received:", error);
    res.status(500).json({
      success: false,
      message: "Error marking goods as received",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Create incoming goods record (called when dispatch is created)
const createIncomingGoods = async (requisitionId, facilityId, dispatchId, itemId, quantity) => {
  const connection = await pool.getConnection();
  try {
    // Get item name and code
    const [item] = await connection.execute(
      `SELECT item_name, item_code FROM inventory_warehouse WHERE id = ?`,
      [itemId]
    );

    // Check if record already exists
    const [existing] = await connection.execute(
      `SELECT id FROM incoming_goods 
       WHERE requisition_id = ? AND item_id = ? AND dispatch_id = ?`,
      [requisitionId, itemId, dispatchId]
    );

    if (existing.length === 0) {
      await connection.execute(
        `INSERT INTO incoming_goods 
         (requisition_id, facility_id, dispatch_id, item_id, item_name, quantity_dispatched, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [
          requisitionId,
          facilityId,
          dispatchId,
          itemId,
          item.length > 0 ? item[0].item_name : null,
          quantity
        ]
      );
    }
  } catch (error) {
    console.error("Error creating incoming goods record:", error);
  } finally {
    connection.release();
  }
};

module.exports = {
  getIncomingGoods,
  markAsReceived,
  createIncomingGoods
};

