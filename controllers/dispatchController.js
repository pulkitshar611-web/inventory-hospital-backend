const { pool } = require('../config');

// Get dispatches
// const getDispatches = async (req, res) => {
//   try {
//     const { 
//       page = 1, 
//       limit = 10, 
//       status, 
//       facility_id,
//       date_from,
//       date_to
//     } = req.query;

//     const offset = (page - 1) * limit;
//     let whereConditions = ['1=1'];
//     let queryParams = [];

//     // Role-based access control
//     // if (req.user.role === 'facility_admin') {
//     //   whereConditions.push('d.facility_id = ?');
//     //   queryParams.push(req.user.facility_id);
//     // }

//     // Apply filters
//     if (status) {
//       whereConditions.push('d.status = ?');
//       queryParams.push(status);
//     }

//     // if (facility_id && req.user.role !== 'facility_admin') {
//     //   whereConditions.push('d.facility_id = ?');
//     //   queryParams.push(facility_id);
//     // }

//     if (date_from) {
//       whereConditions.push('DATE(d.created_at) >= ?');
//       queryParams.push(date_from);
//     }

//     if (date_to) {
//       whereConditions.push('DATE(d.created_at) <= ?');
//       queryParams.push(date_to);
//     }

//     const whereClause = whereConditions.join(' AND ');

//     // Get total count
//     const [countResult] = await pool.execute(
//       `SELECT COUNT(*) as total FROM dispatches d WHERE ${whereClause}`,
//       queryParams
//     );

//     // Get dispatches with details
//     const [dispatches] = await pool.execute(
//       `SELECT d.*, 
//               f.name as facility_name, f.location as facility_location,
//               u1.name as dispatched_by_name,
//               u2.name as received_by_name,
//               r.id as requisition_id, r.priority as requisition_priority,
//               (SELECT COUNT(*) FROM requisition_items WHERE requisition_id = r.id) as item_count
//        FROM dispatches d
//        LEFT JOIN facilities f ON d.facility_id = f.id
//        LEFT JOIN users u1 ON d.dispatched_by = u1.id
//        LEFT JOIN users u2 ON d.received_by = u2.id
//        LEFT JOIN requisitions r ON d.requisition_id = r.id
//        WHERE ${whereClause}
//        ORDER BY d.created_at DESC
//        LIMIT ? OFFSET ?`,
//       [...queryParams, parseInt(limit), parseInt(offset)]
//     );

//     // Get items for each dispatch
//     for (let dispatch of dispatches) {
//       if (dispatch.requisition_id) {
//         const [items] = await pool.execute(
//           `SELECT ri.*, i.item_name, i.item_code, i.unit
//            FROM requisition_items ri
//            LEFT JOIN inventory i ON ri.item_id = i.id
//            WHERE ri.requisition_id = ?`,
//           [dispatch.requisition_id]
//         );
//         dispatch.items = items;
//       }
//     }

//     const total = countResult[0].total;
//     const totalPages = Math.ceil(total / limit);

//     res.json({
//       success: true,
//       data: {
//         dispatches,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages,
//           totalItems: total,
//           itemsPerPage: parseInt(limit)
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Get dispatches error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get dispatches',
//       error: error.message
//     });
//   }
// };



const getDispatches = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // Group by requisition_id - fetch from all requisition types
    const [rows] = await connection.query(`
      SELECT 
        d.id,
        d.requisition_id,
        d.facility_id,
        f.name AS facility_name,
        d.item_id,
        i.item_name,
        i.item_code,
        i.unit,
        i.quantity AS available_quantity,
        d.tracking_number,
        d.remark,
        d.status,
        d.quantity,
        COALESCE(
          (SELECT COALESCE(approved_quantity, 0) FROM facility_requisition_item 
           WHERE requisition_id = d.requisition_id AND item_id = d.item_id 
           LIMIT 1),
          (SELECT COALESCE(approved_quantity, 0) FROM requisition_items 
           WHERE requisition_id = d.requisition_id AND item_id = d.item_id 
           LIMIT 1),
          0
        ) AS approved_quantity,
        COALESCE(
          fr.priority, 
          r.priority, 
          (SELECT priority FROM raise_requests WHERE requisition_id = d.requisition_id LIMIT 1),
          'normal'
        ) AS priority,
        COALESCE(
          fr.created_at, 
          r.created_at, 
          (SELECT created_at FROM raise_requests WHERE requisition_id = d.requisition_id LIMIT 1)
        ) as requisition_date
      FROM dispatches d
      LEFT JOIN facilities f ON d.facility_id = f.id
      LEFT JOIN inventory_warehouse i ON d.item_id = i.id
      LEFT JOIN facility_requisitions fr ON d.requisition_id = fr.id
      LEFT JOIN requisitions r ON d.requisition_id = r.id
      ORDER BY d.requisition_id DESC, d.id DESC
    `);

    // Group by requisition_id
    const grouped = {};
    rows.forEach(row => {
      if (!grouped[row.requisition_id]) {
        grouped[row.requisition_id] = {
          requisition_id: row.requisition_id,
          facility_id: row.facility_id,
          facility_name: row.facility_name,
          priority: row.priority,
          requisition_date: row.requisition_date,
          status: row.status,
          items: []
        };
      }
      // Ensure approved_quantity is properly set (even if 0)
      const approvedQty = row.approved_quantity !== null && row.approved_quantity !== undefined 
        ? Number(row.approved_quantity) 
        : 0;
      
      // Debug log for requisition #176 and #54
      if (row.requisition_id === 176 || row.requisition_id === 54) {
        console.log(`[DEBUG] Requisition ${row.requisition_id}, Item ${row.item_id}:`, {
          raw_approved_quantity: row.approved_quantity,
          processed_approved_quantity: approvedQty,
          item_name: row.item_name
        });
      }
      
      grouped[row.requisition_id].items.push({
        id: row.id,
        item_id: row.item_id,
        item_name: row.item_name,
        item_code: row.item_code,
        unit: row.unit,
        available_quantity: row.available_quantity,
        tracking_number: row.tracking_number,
        remark: row.remark,
        status: row.status,
        quantity: row.quantity,
        approved_quantity: approvedQty
      });
    });

    const groupedData = Object.values(grouped);

    return res.status(200).json({
      success: true,
      message: "Dispatch records fetched successfully",
      count: groupedData.length,
      data: groupedData
    });

  } catch (error) {
    console.error("Error fetching dispatches:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching dispatch records",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Get dispatch by ID
const getDispatchById = async (req, res) => {
  try {
    const { id } = req.params;

    const [dispatches] = await pool.execute(
      `
      SELECT d.*, 
             f.name AS facility_name, f.location AS facility_location,
             u1.name AS dispatched_by_name, u1.email AS dispatched_by_email,
             u2.name AS received_by_name, u2.email AS received_by_email,
             r.id AS requisition_id, r.priority AS requisition_priority, 
             r.remarks AS requisition_remarks, r.status AS requisition_status
      FROM dispatches d
      LEFT JOIN facilities f ON d.facility_id = f.id
      LEFT JOIN users u1 ON d.dispatched_by = u1.id
      LEFT JOIN users u2 ON d.received_by = u2.id
      LEFT JOIN requisitions r ON d.requisition_id = r.id
      WHERE d.id = ?
      `,
      [id]
    );

    if (dispatches.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Dispatch not found'
      });
    }

    const dispatch = dispatches[0];

    // Get dispatch items with full details
    if (dispatch.requisition_id) {
      const [items] = await pool.execute(
        `
        SELECT 
          ri.item_id,
          i.item_code,
          i.item_name,
          i.unit,
          ri.quantity,
          ri.approved_quantity,
          ri.delivered_quantity,
          i.item_cost,
          i.expiry_date
        FROM requisition_items ri
        LEFT JOIN inventory i ON ri.item_id = i.id
        WHERE ri.requisition_id = ?
        `,
        [dispatch.requisition_id]
      );
      dispatch.items = items;
    }

    res.status(200).json({
      success: true,
      data: dispatch
    });
  } catch (error) {
    console.error('Get dispatch by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dispatch',
      error: error.message
    });
  }
};


// Create dispatch
// const createDispatch = async (req, res) => {
//   try {
//     const { requisition_id, facility_id, remarks, tracking_number } = req.body;

//     // Verify requisition exists and is approved
//     const [requisitions] = await pool.execute(
//       'SELECT id, status FROM requisitions WHERE id = ? AND status = "approved"',
//       [requisition_id]
//     );

//     if (requisitions.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Approved requisition not found'
//       });
//     }

//     // Check if dispatch already exists for this requisition
//     const [existingDispatches] = await pool.execute(
//       'SELECT id FROM dispatches WHERE requisition_id = ?',
//       [requisition_id]
//     );

//     if (existingDispatches.length > 0) {
//       return res.status(409).json({
//         success: false,
//         message: 'Dispatch already exists for this requisition'
//       });
//     }

//     // Create dispatch
//     const [result] = await pool.execute(
//       `INSERT INTO dispatches (requisition_id, facility_id, status, dispatched_by, tracking_number, remarks, created_at) 
//        VALUES (?, ?, 'in_transit', ?, ?, ?, NOW())`,
//       [requisition_id, facility_id, req.user.id, tracking_number || null, remarks || null]
//     );

//     // Update requisition status
//     await pool.execute(
//       'UPDATE requisitions SET status = "dispatched" WHERE id = ?',
//       [requisition_id]
//     );

//     // Get created dispatch
//     const [dispatches] = await pool.execute(
//       `SELECT d.*, 
//               f.name as facility_name, u.name as dispatched_by_name
//        FROM dispatches d
//        LEFT JOIN facilities f ON d.facility_id = f.id
//        LEFT JOIN users u ON d.dispatched_by = u.id
//        WHERE d.id = ?`,
//       [result.insertId]
//     );

//     res.status(201).json({
//       success: true,
//       message: 'Dispatch created successfully',
//       data: dispatches[0]
//     });
//   } catch (error) {
//     console.error('Create dispatch error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create dispatch',
//       error: error.message
//     });
//   }
// };


// const createDispatch = async (req, res) => {
//   try {
//     const { requisition_id, facility_id, remarks, tracking_number } = req.body;

//     // Ensure authenticated user exists
//     if (!req.user || !req.user.id) {
//       return res.status(401).json({
//         success: false,
//         message: 'Unauthorized: User not found'
//       });
//     }

//     // Verify requisition exists and is approved
//     const [requisitions] = await pool.execute(
//       'SELECT id, status FROM requisitions WHERE id = ? AND status = "approved"',
//       [requisition_id]
//     );

//     if (requisitions.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Approved requisition not found'
//       });
//     }

//     // Check if dispatch already exists for this requisition
//     const [existingDispatches] = await pool.execute(
//       'SELECT id FROM dispatches WHERE requisition_id = ?',
//       [requisition_id]
//     );

//     if (existingDispatches.length > 0) {
//       return res.status(409).json({
//         success: false,
//         message: 'Dispatch already exists for this requisition'
//       });
//     }

//     // Create dispatch
//     const [result] = await pool.execute(
//       `INSERT INTO dispatches (requisition_id, facility_id, status, dispatched_by, tracking_number, remarks, created_at) 
//        VALUES (?, ?, 'in_transit', ?, ?, ?, NOW())`,
//       [requisition_id, facility_id, req.user.id, tracking_number || null, remarks || null]
//     );

//     if (!result.insertId) {
//       throw new Error('Dispatch creation failed');
//     }

//     // Update requisition status
//     await pool.execute(
//       'UPDATE requisitions SET status = "dispatched" WHERE id = ?',
//       [requisition_id]
//     );

//     // Get created dispatch
//     const [dispatches] = await pool.execute(
//       `SELECT d.*, 
//               f.name as facility_name, u.name as dispatched_by_name
//        FROM dispatches d
//        LEFT JOIN facilities f ON d.facility_id = f.id
//        LEFT JOIN users u ON d.dispatched_by = u.id
//        WHERE d.id = ?`,
//       [result.insertId]
//     );

//     res.status(201).json({
//       success: true,
//       message: 'Dispatch created successfully',
//       data: dispatches[0]
//     });
//   } catch (error) {
//     console.error('Create dispatch error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create dispatch',
//       error: error.message
//     });
//   }
// };


const createDispatch = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, remark, items } = req.body;

    // 1️⃣ Check if requisition exists (check both facility_requisitions and requisitions tables)
    let [requisition] = await connection.query(
      `SELECT id, facility_id, status FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    // If not found in facility_requisitions, check requisitions table (user requisitions)
    if (requisition.length === 0) {
      [requisition] = await connection.query(
        `SELECT id, facility_id, status FROM requisitions WHERE id = ?`,
        [requisition_id]
      );
    }

    if (requisition.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const facilityId = requisition[0].facility_id;

    // 2️⃣ Update quantities and status in dispatches table
    // items = [{ dispatch_id, quantity }, ...]
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await connection.query(
          `UPDATE dispatches 
           SET quantity = ?, status = 'dispatched', remark = ?, tracking_number = tracking_number, updated_at = NOW()
           WHERE id = ? AND requisition_id = ?`,
          [item.quantity, remark || '', item.dispatch_id, requisition_id]
        );
      }
    } else {
      // Fallback: update all dispatches for that requisition to "dispatched"
      await connection.query(
        `UPDATE dispatches 
         SET status = 'dispatched', remark = ?, tracking_number = tracking_number, updated_at = NOW()
         WHERE requisition_id = ?`,
        [remark || '', requisition_id]
      );
    }

    // 3️⃣ Fetch updated dispatches to create incoming goods records
    const [dispatches] = await connection.query(
      `SELECT * FROM dispatches WHERE requisition_id = ?`,
      [requisition_id]
    );

    // 4️⃣ Create incoming goods records and send notifications
    const { createNotification } = require('./notificationController');
    const { createIncomingGoods } = require('./incomingGoodsController');

    for (const dispatch of dispatches) {
      if (dispatch.status !== 'dispatched') continue;

      // Create incoming goods record
      await createIncomingGoods(
        requisition_id,
        facilityId,
        dispatch.id,
        dispatch.item_id,
        dispatch.quantity
      );

      // Get facility admin
      const [facilityAdmin] = await connection.query(
        `SELECT admin_user_id FROM facilities WHERE id = ?`,
        [facilityId]
      );

      if (facilityAdmin.length > 0 && facilityAdmin[0].admin_user_id) {
        // Send notification to facility admin
        await createNotification(
          facilityAdmin[0].admin_user_id,
          facilityId,
          'dispatch',
          'Items Dispatched',
          `Items for requisition #${requisition_id} have been dispatched from warehouse.`,
          requisition_id,
          'requisition'
        );
      }
    }

    // 5️⃣ Update requisition status to "dispatched" (check both tables)
    // First try facility_requisitions
    const [facilityReqUpdate] = await connection.query(
      `UPDATE facility_requisitions 
       SET status = 'dispatched', delivered_at = NOW()
       WHERE id = ?`,
      [requisition_id]
    );
    
    // If no rows affected, try requisitions table (user requisitions)
    if (facilityReqUpdate.affectedRows === 0) {
      // Check if delivered_at column exists in requisitions table
      try {
        await connection.query(
          `UPDATE requisitions 
           SET status = 'dispatched', delivered_at = NOW()
           WHERE id = ?`,
          [requisition_id]
        );
      } catch (err) {
        // If delivered_at column doesn't exist, update without it
        if (err.code === 'ER_BAD_FIELD_ERROR' || err.message.includes('delivered_at')) {
          await connection.query(
            `UPDATE requisitions 
             SET status = 'dispatched'
             WHERE id = ?`,
            [requisition_id]
          );
        } else {
          throw err;
        }
      }
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Requisition dispatched successfully",
      data: {
        requisition_id,
        status: "dispatched"
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error dispatching requisition:", error);
    return res.status(500).json({
      success: false,
      message: "Error dispatching requisition",
      error: error.message
    });
  } finally {
    connection.release();
  }
};



const updateDispatchStatus = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { status, remarks, tracking_number } = req.body;

    // ✅ Valid status transitions
    const validStatuses = ['in_transit', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dispatch status'
      });
    }

    // ✅ Check if dispatch exists
    const [dispatches] = await connection.execute(
      'SELECT * FROM dispatches WHERE id = ?',
      [id]
    );

    if (dispatches.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Dispatch not found'
      });
    }

    const dispatch = dispatches[0];

    // ✅ Update dispatch status
    await connection.execute(
      'UPDATE dispatches SET status = ?, remarks = ?, tracking_number = ?, updated_at = NOW() WHERE id = ?',
      [status, remarks || null, tracking_number || null, id]
    );

    // ✅ If cancelled, revert requisition status to 'approved'
    if (status === 'cancelled' && dispatch.requisition_id) {
      await connection.execute(
        'UPDATE requisitions SET status = "approved", updated_at = NOW() WHERE id = ?',
        [dispatch.requisition_id]
      );
    }

    // ✅ Get updated dispatch with facility & user info
    const [updatedDispatches] = await connection.execute(
      `SELECT d.*, 
              f.name AS facility_name, f.location AS facility_location,
              u.name AS dispatched_by_name, u.email AS dispatched_by_email
       FROM dispatches d
       LEFT JOIN facilities f ON d.facility_id = f.id
       LEFT JOIN users u ON d.dispatched_by = u.id
       WHERE d.id = ?`,
      [id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: 'Dispatch status updated successfully',
      data: updatedDispatches[0]
    });
  } catch (error) {
    await connection.rollback();
    console.error('Update dispatch status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update dispatch status',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Confirm delivery (facility admin)
const confirmDelivery = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, remark, items } = req.body;
    if (!requisition_id) {
      return res.status(400).json({ success: false, message: "requisition_id is required" });
    }

    // 1️⃣ Fetch requisition
    const [requisitionRows] = await connection.query(
      `SELECT * FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );
    if (!requisitionRows.length) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const requisition = requisitionRows[0];
    const facility_id = requisition.facility_id;

    // 2️⃣ Get items to process
    let itemsToProcess = [];
    if (items && Array.isArray(items)) {
      // items = [{ dispatch_id, quantity }, ...]
      const [dispatchRows] = await connection.query(
        `SELECT d.*, iw.item_code, iw.item_name, iw.category, iw.description, iw.unit, iw.item_cost, iw.expiry_date
         FROM dispatches d
         JOIN inventory_warehouse iw ON d.item_id = iw.id
         WHERE d.requisition_id = ? AND d.id IN (?)`,
        [requisition_id, items.map(i => i.dispatch_id)]
      );

      itemsToProcess = dispatchRows.map(row => {
        const provided = items.find(i => i.dispatch_id === row.id);
        return {
          ...row,
          deliver_quantity: provided ? provided.quantity : row.quantity
        };
      });
    } else {
      // Fallback: Get items from facility_requisition_item
      const [itemRows] = await connection.query(
        `SELECT 
           fri.item_id,
           fri.approved_quantity as deliver_quantity,
           iw.id AS warehouse_id,
           iw.item_code,
           iw.item_name,
           iw.category,
           iw.description,
           iw.unit,
           iw.item_cost,
           iw.expiry_date
         FROM facility_requisition_item fri
         JOIN inventory_warehouse iw ON fri.item_id = iw.id
         WHERE fri.requisition_id = ?`,
        [requisition_id]
      );
      itemsToProcess = itemRows.map(row => ({ ...row, warehouse_id: row.item_id }));
    }

    if (!itemsToProcess.length) {
      throw new Error("No items found to deliver");
    }

    const DEFAULT_REORDER_LEVEL = 10;

    // 3️⃣ Process each item
    for (const item of itemsToProcess) {
      const { item_id, deliver_quantity } = item;
      const warehouse_id = item.warehouse_id || item.item_id; // Support both structures
      const qtyToDeliver = Number(deliver_quantity) || 0;

      if (qtyToDeliver <= 0) {
        console.log(`Skipping item ${item_id} because deliver_quantity is <= 0`);
        continue;
      }

      // 🔻 Lock and decrease warehouse quantity
      const [warehouseRows] = await connection.query(
        `SELECT id, quantity FROM inventory_warehouse WHERE id = ? FOR UPDATE`,
        [warehouse_id]
      );
      if (!warehouseRows.length)
        throw new Error(`Warehouse item not found for warehouse_id ${warehouse_id}`);

      const currentWarehouseQty = Number(warehouseRows[0].quantity) || 0;
      const newWarehouseQty = currentWarehouseQty - qtyToDeliver;
      if (newWarehouseQty < 0)
        throw new Error(`Insufficient stock for warehouse_id ${warehouse_id}. Available: ${currentWarehouseQty}, required: ${qtyToDeliver}`);

      await connection.query(
        `UPDATE inventory_warehouse SET quantity = ?, updated_at = NOW() WHERE id = ?`,
        [newWarehouseQty, warehouse_id]
      );

      // 🔺 Lock and update/insert facility inventory
      const [facilityRows] = await connection.query(
        `SELECT id, quantity FROM inventory_facility WHERE item_id = ? AND facility_id = ? FOR UPDATE`,
        [item_id, facility_id]
      );

      if (facilityRows.length > 0) {
        const newFacilityQty = Number(facilityRows[0].quantity) + qtyToDeliver;
        await connection.query(
          `UPDATE inventory_facility SET quantity = ?, updated_at = NOW() WHERE id = ?`,
          [newFacilityQty, facilityRows[0].id]
        );
      } else {
        await connection.query(
          `INSERT INTO inventory_facility 
           (item_code, item_name, category, description, unit, facility_id, item_id, quantity, reorder_level, item_cost, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            item.item_code,
            item.item_name,
            item.category,
            item.description,
            item.unit,
            facility_id,
            item_id,
            qtyToDeliver,
            DEFAULT_REORDER_LEVEL,
            item.item_cost,
            item.expiry_date,
          ]
        );
      }

      // 🔹 Update delivered quantity in requisition items
      await connection.query(
        `UPDATE facility_requisition_item 
         SET delivered_quantity = COALESCE(delivered_quantity, 0) + ?
         WHERE requisition_id = ? AND item_id = ?`,
        [qtyToDeliver, requisition_id, item_id]
      );

      // 🔹 Update quantity in dispatches table
      const dispatchIdToUpdate = item.id || null; // item.id is from SELECT d.*
      if (dispatchIdToUpdate) {
        await connection.query(
          `UPDATE dispatches 
           SET quantity = ?, status = 'delivered', remark = ? 
           WHERE id = ?`,
          [qtyToDeliver, remark || null, dispatchIdToUpdate]
        );
      } else {
        await connection.query(
          `UPDATE dispatches 
           SET quantity = ?, status = 'delivered', remark = ? 
           WHERE requisition_id = ? AND item_id = ?`,
          [qtyToDeliver, remark || null, requisition_id, item_id]
        );
      }
    }

    // 4️⃣ Update requisition status
    await connection.query(
      `UPDATE facility_requisitions 
       SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() 
       WHERE id = ?`,
      [requisition_id]
    );

    // ✅ Commit transaction
    await connection.commit();
    res.status(200).json({ success: true, message: "Requisition delivered successfully" });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error in confirmDelivery:", error);
    res.status(500).json({
      success: false,
      message: "Error delivering requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};






module.exports = {
  getDispatches,
  getDispatchById,
  createDispatch,
  updateDispatchStatus,
  confirmDelivery
};

