const { pool } = require('../config');





// const getRequisitions = async (req, res) => {
//   try {
//     const { status, facility_id, search } = req.query;

//     let whereConditions = ['1=1'];
//     let queryParams = [];

//     // Apply filters
//     if (status) {
//       whereConditions.push('r.status = ?');
//       queryParams.push(status);
//     }

//     if (facility_id) {
//       whereConditions.push('r.facility_id = ?');
//       queryParams.push(facility_id);
//     }

//     if (search) {
//       whereConditions.push('(r.notes LIKE ? OR u.name LIKE ?)');
//       queryParams.push(`%${search}%`, `%${search}%`);
//     }

//     const whereClause = whereConditions.join(' AND ');

//     // Get requisitions
//     const [requisitions] = await pool.execute(
//       `SELECT r.*, 
//               u.name AS user_name, 
//               u.email AS user_email, 
//               f.name AS facility_name,
//               f.status AS facility_status, 
//               f.location AS facility_location
//        FROM requisitions r
//        LEFT JOIN users u ON r.user_id = u.id
//        LEFT JOIN facilities f ON r.facility_id = f.id
//        WHERE ${whereClause}
//        ORDER BY r.created_at DESC`,
//       queryParams
//     );

//     res.json({
//       success: true,
//       data: requisitions
//     });
//   } catch (error) {
//     console.error('Get requisitions error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get requisitions',
//       error: error.message
//     });
//   }
// };

const getRequisitions = async (req, res) => {
  try {
    const { status, facility_id, search } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Apply filters
    if (status) {
      whereConditions.push('r.status = ?');
      queryParams.push(status);
    }

    if (facility_id) {
      whereConditions.push('r.facility_id = ?');
      queryParams.push(facility_id);
    }

    if (search) {
      whereConditions.push('(r.notes LIKE ? OR u.name LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // 1️⃣ Get all requisitions with user + facility info
    const [requisitions] = await pool.execute(
      `SELECT r.*, 
              u.name AS user_name, 
              u.email AS user_email, 
              u.phone AS user_phone,
              f.name AS facility_name,
              f.status AS facility_status, 
              f.location AS facility_location
       FROM requisitions r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN facilities f ON r.facility_id = f.id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC`,
      queryParams
    );

    if (requisitions.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // 2️⃣ Get all requisition items (with inventory details)
    const requisitionIds = requisitions.map(r => r.id);

    const [items] = await pool.execute(
      `SELECT ri.*, 
              i.item_name, 
              i.item_code, 
              i.unit, 
              i.quantity AS available_quantity
       FROM requisition_items ri
       LEFT JOIN inventory i ON ri.item_id = i.id
       WHERE ri.requisition_id IN (${requisitionIds.map(() => '?').join(',')})`,
      requisitionIds
    );

    // 3️⃣ Attach items to each requisition
    const requisitionsWithItems = requisitions.map(reqRow => {
      const relatedItems = items.filter(i => i.requisition_id === reqRow.id);
      return {
        ...reqRow,
        items: relatedItems
      };
    });

    // 4️⃣ Send final response
    res.json({
      success: true,
      data: requisitionsWithItems
    });
  } catch (error) {
    console.error('Get requisitions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requisitions',
      error: error.message
    });
  }
};      
// Get requisition by ID
const getRequisitionById = async (req, res) => {
  try {
    const { id } = req.params;

    let query = `
      SELECT r.*, 
             u.name as user_name, u.email as user_email, u.phone as user_phone,
             f.name as facility_name, f.location as facility_location
      FROM requisitions r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN facilities f ON r.facility_id = f.id
      WHERE r.id = ?
    `;

    const queryParams = [id];

    // Role-based access control
    // if (req.user.role === 'facility_admin') {
    //   query += ' AND r.facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // } else if (req.user.role === 'facility_user') {
    //   query += ' AND r.user_id = ?';
    //   queryParams.push(req.user.id);
    // }

    const [requisitions] = await pool.execute(query, queryParams);

    if (requisitions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found or access denied'
      });
    }

    // Get requisition items
    const [items] = await pool.execute(
      `SELECT ri.*, i.item_name, i.item_code, i.unit, i.quantity as available_quantity
       FROM requisition_items ri
       LEFT JOIN inventory i ON ri.item_id = i.id
       WHERE ri.requisition_id = ?`,
      [id]
    );

    const requisition = requisitions[0];
    requisition.items = items;

    res.json({
      success: true,
      data: requisition
    });
  } catch (error) {
    console.error('Get requisition by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requisition',
      error: error.message
    });
  }
};

const createRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { user_id, facility_id, priority, remarks, items } = req.body;

    if (!user_id || !facility_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Invalid request data" });
    }

    await connection.beginTransaction();

    // Step 1: Requisition create karna
    const [requisitionResult] = await connection.execute(
      `INSERT INTO requisitions (user_id, facility_id, status, priority, remarks, created_at) 
       VALUES (?, ?, 'pending', ?, ?, NOW())`,
      [user_id, facility_id, priority, remarks]
    );

    const requisition_id = requisitionResult.insertId;

    // Step 2: Items insert karna requisition_items me
    for (const item of items) {
      // warehouse item_id utha rahe hain
      const [warehouseItem] = await connection.execute(
        `SELECT id AS warehouse_item_id, item_code, item_name, quantity 
         FROM inventory_warehouse 
         WHERE id = ?`,
        [item.item_id]
      );

      if (warehouseItem.length === 0) {
        throw new Error(`Warehouse item not found for id ${item.item_id}`);
      }

      const warehouseItemData = warehouseItem[0];

      // Requisition item insert karna
      await connection.execute(
        `INSERT INTO requisition_items 
          (requisition_id, item_id, quantity, approved_quantity, delivered_quantity, priority, created_at)
         VALUES (?, ?, ?, 0, 0, ?, NOW())`,
        [
          requisition_id,
          warehouseItemData.warehouse_item_id, // warehouse ki id use ho rahi hai
          item.quantity || 0,
          priority || "normal",
        ]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Requisition created successfully with items",
      requisition_id,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error creating requisition:", error);
    res.status(500).json({ message: "Failed to create requisition", error: error.message });
  } finally {
    connection.release();
  }
};
// Update requisition
const updateRequisition = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remarks, approved_quantity } = req.body;

    // Check access permissions
    let query = 'SELECT user_id, facility_id, status as current_status FROM requisitions WHERE id = ?';
    const queryParams = [id];

    // if (req.user.role === 'facility_admin') {
    //   query += ' AND facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // } else if (req.user.role === 'facility_user') {
    //   query += ' AND user_id = ?';
    //   queryParams.push(req.user.id);
    // }

    const [requisitions] = await pool.execute(query, queryParams);

    if (requisitions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found or access denied'
      });
    }

    // Facility users can only update pending requisitions
    // if (req.user.role === 'facility_user' && requisitions[0].current_status !== 'pending') {
    //   return res.status(403).json({
    //     success: false,
    //     message: 'Cannot update requisition in current status'
    //   });
    // }

    // Update requisition
    await pool.execute(
      'UPDATE requisitions SET status = ?, remarks = ?, updated_at = NOW() WHERE id = ?',
      [status, remarks, id]
    );

    // Get updated requisition
    const [updatedRequisitions] = await pool.execute(
      `SELECT r.*, 
              u.name as user_name, f.name as facility_name
       FROM requisitions r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN facilities f ON r.facility_id = f.id
       WHERE r.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Requisition updated successfully',
      data: updatedRequisitions[0]
    });
  } catch (error) {
    console.error('Update requisition error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update requisition',
      error: error.message
    });
  }
};


// const approveRequisition = async (req, res) => {
//   const connection = await pool.getConnection();
  
//   try {
//     await connection.beginTransaction();

//     const { id } = req.params;
//     const { items, remarks } = req.body; // items: [{ item_id, approved_quantity }]

//     // Get requisition details
//     const [requisitions] = await connection.execute(
//       'SELECT facility_id, status FROM requisitions WHERE id = ?',
//       [id]
//     );

//     if (requisitions.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Requisition not found'
//       });
//     }

//     if (requisitions[0].status !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'Requisition is not in pending status'
//       });
//     }

//     // Update requisition status
//     await connection.execute(
//       'UPDATE requisitions SET status = "approved", approved_by = ?, approved_at = NOW(), remarks = ? WHERE id = ?',
//       [req.user.id, remarks || null, id]
//     );

//     // Update approved quantities for items
//     for (const item of items) {
//       await connection.execute(
//         'UPDATE requisition_items SET approved_quantity = ? WHERE requisition_id = ? AND item_id = ?',
//         [item.approved_quantity, id, item.item_id]
//       );

//       // Reduce warehouse stock (assuming warehouse has facility_id = null or specific warehouse facility)
//       await connection.execute(
//         'UPDATE inventory SET quantity = quantity - ? WHERE item_id = ? AND facility_id IS NULL',
//         [item.approved_quantity, item.item_id]
//       );
//     }

//     // Create dispatch record
//     await connection.execute(
//       `INSERT INTO dispatches (requisition_id, facility_id, status, dispatched_by, created_at) 
//        VALUES (?, ?, 'in_transit', ?, NOW())`,
//       [id, requisitions[0].facility_id, req.user.id]
//     );

//     await connection.commit();

//     res.json({
//       success: true,
//       message: 'Requisition approved and dispatched successfully'
//     });
//   } catch (error) {
//     await connection.rollback();
//     console.error('Approve requisition error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to approve requisition',
//       error: error.message
//     });
//   } finally {
//     connection.release();
//   }
// };

const approveUserRequisition = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { requisition_id, approvedItems, remarks } = req.body; 
        // approvedItems = [{ item_id: 101, approved_quantity: 10 }, ...]

        if (!requisition_id || !approvedItems || !Array.isArray(approvedItems)) {
            return res.status(400).json({
                success: false,
                message: "Requisition ID and approved items are required",
            });
        }

        await connection.beginTransaction();

        // 1️⃣ Get the correct user ID from requisition
        const [reqData] = await connection.execute(
            `SELECT user_id FROM requisitions WHERE id = ?`,
            [requisition_id]
        );

        if (reqData.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Requisition not found" });
        }

        const user_id = reqData[0].user_id;

        // 2️⃣ Update requisition status to 'approved' and save remarks
        const [updateRequisition] = await connection.execute(
            `UPDATE requisitions 
             SET status = 'approved', approved_at = NOW(), remarks = ? 
             WHERE id = ?`,
            [remarks || null, requisition_id]
        );

        if (updateRequisition.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Requisition not found" });
        }

        // 3️⃣ Insert/Update items into inventory_user
        for (const item of approvedItems) {
            const { item_id, approved_quantity } = item;

            // Get item details from facility inventory
            const [facilityItem] = await connection.execute(
                `SELECT * FROM inventory_facility WHERE item_id = ?`,
                [item_id]
            );

            if (facilityItem.length === 0) continue; // skip if not found

            const fi = facilityItem[0];

            // Check if item already exists in user inventory
            const [existingUserItem] = await connection.execute(
                `SELECT * FROM inventory_user WHERE item_id = ? AND user_id = ?`,
                [item_id, user_id]
            );

            if (existingUserItem.length > 0) {
                // Update quantity if exists
                await connection.execute(
                    `UPDATE inventory_user 
                     SET quantity = quantity + ?, updated_at = NOW() 
                     WHERE id = ?`,
                    [approved_quantity, existingUserItem[0].id]
                );
            } else {
                // Insert new item in inventory_user
                await connection.execute(
                    `INSERT INTO inventory_user 
                    (item_code, item_name, category, description, unit, user_id, item_id, quantity, reorder_level, item_cost, expiry_date, created_at, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                    [
                        fi.item_code,
                        fi.item_name,
                        fi.category,
                        fi.description,
                        fi.unit,
                        user_id,
                        fi.item_id,
                        approved_quantity,
                        fi.reorder_level,
                        fi.item_cost,
                        fi.expiry_date
                    ]
                );
            }
        }

        await connection.commit();
        res.json({
            success: true,
            message: "Requisition approved, remarks saved, and items added to user inventory",
            requisition_id,
            user_id,
            approvedItems
        });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    } finally {
        connection.release();
    }
};

const bulkApproveRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { requisitions, userId } = req.body;

    /**
     * Expected body:
     * {
     *   userId: 1, // warehouse approver
     *   requisitions: [
     *     {
     *       id: 10,
     *       remarks: "Approved for dispatch",
     *       items: [
     *         {
     *           item_code: "ITEM-001",
     *           item_name: "Surgical Gloves",
     *           category: "Medical Supplies",
     *           description: "Latex-free surgical gloves",
     *           unit: "Box",
     *           approved_quantity: 10,
     *           reorder_level: 10,
     *           item_cost: 250,
     *           expiry_date: "2026-12-31"
     *         }
     *       ]
     *     }
     *   ]
     * }
     */

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    if (!requisitions || !Array.isArray(requisitions) || requisitions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one requisition is required"
      });
    }

    for (const reqItem of requisitions) {
      const { id, remarks, items } = reqItem;

      if (!id || !items || !Array.isArray(items) || items.length === 0) {
        throw new Error("Invalid requisition data format");
      }

      // 🔹 Get requisition info
      const [reqRows] = await connection.execute(
        `SELECT facility_id, status FROM requisitions WHERE id = ?`,
        [id]
      );

      if (reqRows.length === 0) throw new Error(`Requisition ID ${id} not found`);

      const { facility_id, status } = reqRows[0];

      if (status !== "pending" && status !== "partial_approved") {
        throw new Error(`Requisition ID ${id} is not in pending/partial_approved status`);
      }

      // 🔹 Update requisition status
      await connection.execute(
        `UPDATE requisitions 
         SET status = 'approved_by_warehouse',
             approved_by = ?,
             approved_at = NOW(),
             remarks = ?
         WHERE id = ?`,
        [userId, remarks || null, id]
      );

      for (const item of items) {
        const {
          item_code,
          item_name,
          category,
          description,
          unit,
          approved_quantity,
          reorder_level,
          item_cost,
          expiry_date
        } = item;

        const qty = approved_quantity ?? 0;

        // 1️⃣ Reduce from Warehouse Inventory
        await connection.execute(
          `UPDATE inventory 
           SET quantity = quantity - ? 
           WHERE item_code = ? AND facility_id IS NULL`,
          [qty, item_code]
        );

        // 2️⃣ Add/Update in Facility Inventory
        await connection.execute(
          `INSERT INTO inventory 
            (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, facility_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE 
             quantity = quantity + VALUES(quantity),
             item_cost = VALUES(item_cost),
             expiry_date = VALUES(expiry_date)`,
          [
            item_code,
            item_name,
            category,
            description,
            unit,
            qty,
            reorder_level || 0,
            item_cost || 0,
            expiry_date || null,
            facility_id
          ]
        );

        // 3️⃣ Update approved quantity in requisition_items
        await connection.execute(
          `UPDATE requisition_items 
           SET approved_quantity = ?
           WHERE requisition_id = ? AND item_id = ?`,
          [qty, id, item.item_id || 0]
        );
      }
    }

    await connection.commit();

    res.json({
      success: true,
      message: "All requisitions approved by warehouse and items moved to facility inventory"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Bulk Approve Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk approve requisitions",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const partialApproveRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { items, remarks, userId } = req.body;

    // 🔹 Validation
    if (!id) {
      return res.status(400).json({ success: false, message: "Requisition ID is required" });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one item is required" });
    }

    // 🔹 Get requisition details
    const [reqRows] = await connection.execute(
      `SELECT facility_id, status 
       FROM requisitions 
       WHERE id = ?`,
      [id]
    );

    if (reqRows.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const { facility_id, status } = reqRows[0];

    if (status !== "pending" && status !== "partial_approved") {
      return res.status(400).json({
        success: false,
        message: "Requisition must be pending or partial_approved to continue",
      });
    }

    // 🔹 Process each item
    for (const item of items) {
      const approvedQty = item.approved_quantity ?? 0;

      // 1️⃣ Update approved quantity in requisition_items
      await connection.execute(
        `UPDATE requisition_items 
         SET approved_quantity = ? 
         WHERE requisition_id = ? AND item_id = ?`,
        [approvedQty, id, item.item_id]
      );

      // 2️⃣ Reduce from Warehouse inventory (facility_id IS NULL)
      await connection.execute(
        `UPDATE inventory 
         SET quantity = quantity - ? 
         WHERE item_code = ? AND facility_id IS NULL`,
        [approvedQty, item.item_code]
      );

      // 3️⃣ Add/Update in Facility inventory
      await connection.execute(
        `INSERT INTO inventory 
          (item_code, item_name, category, description, unit, quantity, reorder_level, item_cost, expiry_date, facility_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE 
           quantity = quantity + VALUES(quantity),
           item_cost = VALUES(item_cost),
           expiry_date = VALUES(expiry_date)`,
        [
          item.item_code,
          item.item_name,
          item.category || null,
          item.description || null,
          item.unit,
          approvedQty,
          item.reorder_level || 0,
          item.item_cost || 0,
          item.expiry_date || null,
          facility_id
        ]
      );
    }

    // 🔹 Update requisition status to partial_approved
    await connection.execute(
      `UPDATE requisitions 
       SET status = 'partial_approved',
           approved_by = ?,
           approved_at = NOW(),
           remarks = ?
       WHERE id = ?`,
      [userId || null, remarks || null, id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Requisition partially approved by warehouse and items moved to facility inventory",
    });

  } catch (error) {
    await connection.rollback();
    console.error("Partial Approve Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to partially approve requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const warehouseApproveRequisition = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { facility_id, requisition_id, approvedItems, remarks } = req.body;

    // Validation
    if (!facility_id || !requisition_id || !approvedItems?.length) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: facility_id, requisition_id, or approvedItems",
      });
    }

    for (const item of approvedItems) {
      const { item_id, approved_quantity } = item;
      if (!item_id || !approved_quantity) continue;

      // 1️⃣ Check warehouse stock availability
      const [warehouseStock] = await connection.execute(
        `SELECT quantity FROM inventory_warehouse WHERE item_id = ?`,
        [item_id]
      );

      if (!warehouseStock.length || warehouseStock[0].quantity < approved_quantity) {
        throw new Error(`Not enough stock in warehouse for item ID: ${item_id}`);
      }

      // 2️⃣ Reduce stock from warehouse
      await connection.execute(
        `UPDATE inventory_warehouse 
         SET quantity = quantity - ? 
         WHERE item_id = ?`,
        [approved_quantity, item_id]
      );

      // 3️⃣ Add or update stock in facility inventory
      await connection.execute(
        `INSERT INTO inventory_facility (item_id, facility_id, quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [item_id, facility_id, approved_quantity]
      );

      // 4️⃣ Update approved quantity in requisition_items
      await connection.execute(
        `UPDATE requisition_items 
         SET approved_quantity = ? 
         WHERE requisition_id = ? AND item_id = ?`,
        [approved_quantity, requisition_id, item_id]
      );
    }

    // 5️⃣ Update requisition status (not final)
    await connection.execute(
      `UPDATE requisitions 
       SET status = 'approved_by_warehouse', approved_by = 'warehouse', remarks = ?, approved_at = NOW()
       WHERE id = ?`,
      [remarks, requisition_id]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Warehouse approved requisition and items moved to facility inventory successfully.",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Warehouse Approval Error:", error);
    res.status(500).json({
      success: false,
      message: "Warehouse approval failed",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const warehouseRejectRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { facility_id, requisition_id, remarks } = req.body;

    // 🔹 Validations
    if (!facility_id || !requisition_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id and requisition_id are required",
      });
    }

    if (!remarks || remarks.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Remarks are required for rejection",
      });
    }

    // 🔹 Check requisition exists
    const [requisition] = await connection.execute(
      `SELECT id, status FROM requisitions WHERE id = ? AND facility_id = ?`,
      [requisition_id, facility_id]
    );

    if (!requisition.length) {
      return res.status(404).json({
        success: false,
        message: "Requisition not found for this facility",
      });
    }

    const currentStatus = requisition[0].status;
    if (["approved_by_warehouse", "completed", "rejected_by_warehouse"].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a requisition that is already ${currentStatus}`,
      });
    }

    // 🔹 Update raise_requests (if exists)
    await connection.execute(
      `UPDATE raise_requests 
       SET status = 'rejected_by_warehouse', remarks = ?, updated_at = NOW()
       WHERE facility_id = ? AND requisition_id = ?`,
      [remarks, facility_id, requisition_id]
    );

    // 🔹 Update requisitions
    await connection.execute(
      `UPDATE requisitions 
       SET status = 'rejected_by_warehouse', remarks = ?, updated_at = NOW()
       WHERE id = ?`,
      [remarks, requisition_id]
    );

    // 🔹 Update requisition_items (optional but for traceability)
    await connection.execute(
      `UPDATE requisition_items 
       SET approved_quantity = 0, status = 'rejected'
       WHERE requisition_id = ?`,
      [requisition_id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Requisition rejected successfully by warehouse",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Warehouse Reject Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error during rejection",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const warehouseBulkApprove = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { approvedList, remarks } = req.body;

    // 🔹 Basic validation
    if (!approvedList || !Array.isArray(approvedList) || approvedList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "approvedList must be a non-empty array",
      });
    }

    // 🔁 Loop for each facility’s requisition
    for (const reqObj of approvedList) {
      const { facility_id, requisition_id, approvedItems, facilityRemarks } = reqObj;

      if (!facility_id || !requisition_id || !approvedItems || !Array.isArray(approvedItems)) {
        throw new Error("Each requisition must include facility_id, requisition_id, and approvedItems array");
      }

      // 🔹 Validate requisition exists
      const [reqCheck] = await connection.execute(
        `SELECT id, status FROM requisitions WHERE id = ? AND facility_id = ?`,
        [requisition_id, facility_id]
      );

      if (reqCheck.length === 0) {
        console.warn(`⚠️ Requisition not found for facility_id=${facility_id}, requisition_id=${requisition_id}`);
        continue;
      }

      // 🔁 Loop through approved items
      for (const item of approvedItems) {
        const { item_id, approved_qty } = item;

        if (!item_id || !approved_qty || approved_qty <= 0) continue;

        // 1️⃣ Warehouse inventory se quantity ghatao
        await connection.execute(
          `UPDATE inventory_warehouse 
           SET quantity = quantity - ? 
           WHERE item_id = ? AND quantity >= ?`,
          [approved_qty, item_id, approved_qty]
        );

        // 2️⃣ Facility inventory me add/update karo
        await connection.execute(
          `INSERT INTO inventory_facility (item_id, facility_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
          [item_id, facility_id, approved_qty]
        );

        // 3️⃣ Update requisition_items approved_quantity
        await connection.execute(
          `UPDATE requisition_items 
           SET approved_quantity = IFNULL(approved_quantity, 0) + ?, status = 'approved'
           WHERE requisition_id = ? AND item_id = ?`,
          [approved_qty, requisition_id, item_id]
        );
      }

      // 4️⃣ Update raise_requests table
      await connection.execute(
        `UPDATE raise_requests 
         SET status = 'approved_by_warehouse', remarks = ?, updated_at = NOW()
         WHERE facility_id = ? AND requisition_id = ?`,
        [facilityRemarks || remarks || null, facility_id, requisition_id]
      );

      // 5️⃣ Update requisition table
      await connection.execute(
        `UPDATE requisitions 
         SET status = 'approved_by_warehouse', remarks = ?, updated_at = NOW()
         WHERE id = ?`,
        [facilityRemarks || remarks || null, requisition_id]
      );
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "All requisitions approved successfully by warehouse and moved to facility inventory",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Warehouse Bulk Approve Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk approve requisitions",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const warehousePartialApproveRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { facility_id, requisition_id, approvedItems, remarks } = req.body;

    // 🔹 Basic Validations
    if (!facility_id || !requisition_id) {
      return res.status(400).json({ success: false, message: "facility_id and requisition_id are required" });
    }

    if (!approvedItems || !Array.isArray(approvedItems) || approvedItems.length === 0) {
      return res.status(400).json({ success: false, message: "approvedItems must be a non-empty array" });
    }

    // 🔹 Validate requisition existence
    const [reqCheck] = await connection.execute(
      `SELECT id, status FROM requisitions WHERE id = ? AND facility_id = ?`,
      [requisition_id, facility_id]
    );

    if (reqCheck.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found for this facility" });
    }

    // 🔁 Loop through each item for partial approval
    for (const item of approvedItems) {
      const { item_id, approved_qty } = item;

      if (!item_id || approved_qty == null || approved_qty < 0) continue;

      // 1️⃣ Warehouse inventory se quantity ghatao
      await connection.execute(
        `UPDATE inventory_warehouse 
         SET quantity = quantity - ? 
         WHERE item_id = ? AND quantity >= ?`,
        [approved_qty, item_id, approved_qty]
      );

      // 2️⃣ Facility inventory me add/update karo
      await connection.execute(
        `INSERT INTO inventory_facility (item_id, facility_id, quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [item_id, facility_id, approved_qty]
      );

      // 3️⃣ requisition_items me approved quantity update karo
      await connection.execute(
        `UPDATE requisition_items 
         SET approved_quantity = IFNULL(approved_quantity, 0) + ?, status = 'partial_approved'
         WHERE requisition_id = ? AND item_id = ?`,
        [approved_qty, requisition_id, item_id]
      );
    }

    // 4️⃣ raise_requests table update karo
    await connection.execute(
      `UPDATE raise_requests 
       SET status = 'partial_approved_by_warehouse', remarks = ?, updated_at = NOW()
       WHERE facility_id = ? AND requisition_id = ?`,
      [remarks || null, facility_id, requisition_id]
    );

    // 5️⃣ requisitions table update karo
    await connection.execute(
      `UPDATE requisitions 
       SET status = 'partial_approved_by_warehouse', remarks = ?, updated_at = NOW()
       WHERE id = ?`,
      [remarks || null, requisition_id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Requisition partially approved successfully by warehouse and moved to facility inventory",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Warehouse Partial Approve Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to partially approve requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};



// const rejectRequisition = async (req, res) => {
//   const connection = await pool.getConnection();

//   try {
//     await connection.beginTransaction();

//     const { id } = req.params;
//     const { remarks } = req.body;

//     // Get requisition details
//     const [requisitions] = await connection.execute(
//       'SELECT status FROM requisitions WHERE id = ?',
//       [id]
//     );

//     if (requisitions.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'Requisition not found'
//       });
//     }

//     if (requisitions[0].status !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         message: 'Only pending requisitions can be rejected'
//       });
//     }

//     // Update requisition status to rejected
//     await connection.execute(
//       'UPDATE requisitions SET status = "rejected", approved_by = ?, approved_at = NOW(), remarks = ? WHERE id = ?',
//       [req.user.id, remarks || 'Rejected by approver', id]
//     );

//     await connection.commit();

//     res.json({
//       success: true,
//       message: 'Requisition rejected successfully'
//     });
//   } catch (error) {
//     await connection.rollback();
//     console.error('Reject requisition error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to reject requisition',
//       error: error.message
//     });
//   } finally {
//     connection.release();
//   }
// };





// Reject requisition

const rejectUserRequisition = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { requisition_id, remarks } = req.body;

        if (!requisition_id) {
            return res.status(400).json({
                success: false,
                message: "Requisition ID is required",
            });
        }

        await connection.beginTransaction();

        // Update requisition status to 'rejected' and save remarks
        const [updateRequisition] = await connection.execute(
            `UPDATE requisitions 
             SET status = 'rejected', rejected_at = NOW(), remarks = ? 
             WHERE id = ?`,
            [remarks || null, requisition_id]
        );

        if (updateRequisition.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Requisition not found" });
        }

        await connection.commit();
        res.json({ success: true, message: "Requisition rejected successfully" });
    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    } finally {
        connection.release();
    }
};



// Deliver requisition (facility admin)
const deliverRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { facility_id, requisition_id, items, remarks, user_id } = req.body;

    // 🔹 Validation
    if (!facility_id || !requisition_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id and requisition_id are required",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items array is required for delivery",
      });
    }

    // 🔹 Check if requisition exists and belongs to facility
    const [requisitions] = await connection.query(
      `SELECT id, status FROM requisitions WHERE id = ? AND facility_id = ?`,
      [requisition_id, facility_id]
    );

    if (requisitions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Requisition not found or access denied",
      });
    }

    // 🔹 Check if raise request exists
    const [raiseReq] = await connection.query(
      `SELECT * FROM raise_requests WHERE requisition_id = ? AND facility_id = ?`,
      [requisition_id, facility_id]
    );

    if (raiseReq.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Raise request not found for this facility",
      });
    }

    // 🔹 Update each item (delivered_quantity + inventory)
    for (const item of items) {
      const { item_id, delivered_quantity } = item;

      if (!item_id || delivered_quantity == null || delivered_quantity < 0) continue;

      // Update delivered qty in requisition_items
      await connection.query(
        `UPDATE requisition_items 
         SET delivered_quantity = ? 
         WHERE requisition_id = ? AND item_id = ?`,
        [delivered_quantity, requisition_id, item_id]
      );

      // Reduce item quantity in facility inventory
      await connection.query(
        `UPDATE inventory 
         SET quantity = quantity - ?, updated_at = NOW()
         WHERE item_code = ? AND facility_id = ?`,
        [delivered_quantity, item_id, facility_id]
      );
    }

    // 🔹 Try to update statuses (with auto ENUM fix if needed)
    try {
      // Update requisition → delivered
      await connection.query(
        `UPDATE requisitions 
         SET status = 'delivered', delivered_by = ?, delivered_at = NOW(), remarks = ?, updated_at = NOW()
         WHERE id = ?`,
        [user_id, remarks || null, requisition_id]
      );

      // Update raise request → delivered
      await connection.query(
        `UPDATE raise_requests 
         SET status = 'delivered', remarks = ?, updated_at = NOW()
         WHERE requisition_id = ? AND facility_id = ?`,
        [remarks || null, requisition_id, facility_id]
      );

      // Update dispatches table → delivered
      await connection.query(
        `UPDATE dispatches 
         SET status = 'delivered', delivered_at = NOW()
         WHERE requisition_id = ?`,
        [requisition_id]
      );

    } catch (statusError) {
      if (statusError.code === 'WARN_DATA_TRUNCATED' || statusError.errno === 1265) {
        console.warn("⚠️ ENUM issue detected — converting status columns to VARCHAR automatically...");

        // Convert ENUM → VARCHAR in all relevant tables
        await connection.query(`
          ALTER TABLE raise_requests MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';
        `);
        await connection.query(`
          ALTER TABLE requisitions MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';
        `);
        await connection.query(`
          ALTER TABLE dispatches MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending';
        `);

        // Retry updates after schema correction
        await connection.query(
          `UPDATE requisitions 
           SET status = 'delivered', delivered_by = ?, delivered_at = NOW(), remarks = ?, updated_at = NOW()
           WHERE id = ?`,
          [user_id, remarks || null, requisition_id]
        );

        await connection.query(
          `UPDATE raise_requests 
           SET status = 'delivered', remarks = ?, updated_at = NOW()
           WHERE requisition_id = ? AND facility_id = ?`,
          [remarks || null, requisition_id, facility_id]
        );

        await connection.query(
          `UPDATE dispatches 
           SET status = 'delivered', delivered_at = NOW()
           WHERE requisition_id = ?`,
          [requisition_id]
        );
      } else {
        throw statusError;
      }
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Requisition delivered successfully and inventory updated",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Deliver Requisition Error:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// Delete requisition
const deleteRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { requisition_id } = req.params;

    if (!requisition_id) {
      return res.status(400).json({ message: "Requisition ID is required" });
    }

    await connection.beginTransaction();

    // Step 1: check requisition exist
    const [reqCheck] = await connection.execute(
      "SELECT id FROM requisitions WHERE id = ?",
      [requisition_id]
    );

    if (reqCheck.length === 0) {
      return res.status(404).json({ message: "Requisition not found" });
    }

    // Step 2: delete requisition items
    await connection.execute(
      `DELETE FROM requisition_items WHERE requisition_id = ?`,
      [requisition_id]
    );

    // Step 3: delete requisition
    await connection.execute(
      `DELETE FROM requisitions WHERE id = ?`,
      [requisition_id]
    );

    await connection.commit();

    res.status(200).json({
      message: "Requisition and its items deleted successfully",
      requisition_id,
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error deleting requisition:", error);
    res.status(500).json({ message: "Failed to delete requisition", error: error.message });
  } finally {
    connection.release();
  }
};







// const getRequisitionsByUser = async (req, res) => {
//   const userId = req.params.userId; // get user_id from route parameter

//   if (!userId) {
//     return res.status(400).json({
//       success: false,
//       message: 'User ID is required'
//     });
//   }

//   try {
//     const [requisitions] = await pool.execute(
//       'SELECT * FROM requisitions WHERE user_id = ? ORDER BY created_at DESC',
//       [userId]
//     );

//     res.status(200).json({
//       success: true,
//       data: requisitions
//     });
//   } catch (error) {
//     console.error('Get requisitions by user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get requisitions'
//     });
//   }
// };



const getRequisitionsByUser = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { user_id } = req.params;

    // ✅ Validation
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    // 🔹 Step 1: Fetch requisitions for the user
    const [requisitions] = await connection.query(
      `SELECT 
          r.id AS requisition_id,
          r.user_id,
          r.facility_id,
          r.warehouse_id,
          r.status,
          r.priority,
          r.remarks,
          r.approved_by,
          r.approved_at,
          r.delivered_by,
          r.delivered_at,
          r.created_at,
          r.updated_at,
          r.rejected_by,
          r.rejected_at
       FROM requisitions r
       WHERE r.user_id = ? 
       ORDER BY r.created_at DESC`,
      [user_id]
    );

    // 🔹 Step 2: If no requisitions found
    if (requisitions.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No requisitions found for this user",
        data: [],
      });
    }

    // 🔹 Step 3: Fetch all requisition items
    const requisitionIds = requisitions.map(r => r.requisition_id);
    const [items] = await connection.query(
      `SELECT 
          ri.id AS requisition_item_id,
          ri.requisition_id,
          ri.item_id,
          ri.quantity,
          ri.approved_quantity,
          ri.delivered_quantity,
          ri.priority,
          ri.created_at
       FROM requisition_items ri
       WHERE ri.requisition_id IN (?)`,
      [requisitionIds]
    );

    // 🔹 Step 4: Combine requisitions with their items
    const requisitionData = requisitions.map(req => ({
      ...req,
      items: items.filter(i => i.requisition_id === req.requisition_id),
    }));

    // ✅ Step 5: Send response
    return res.status(200).json({
      success: true,
      message: "Requisitions fetched successfully",
      data: requisitionData,
    });

  } catch (error) {
    console.error("Error fetching requisitions by user:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// Get requisitions by facility_id
const getRequisitionsByFacility = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const facility_id = req.params.facility_id || req.query.facility_id;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    // 🔹 Step 1: Get all requisitions for this facility
    const [requisitions] = await connection.query(
      `
      SELECT 
        r.id,
        r.user_id,
        r.facility_id,
        r.status,
        r.priority,
        r.remarks,
        r.approved_by,
        r.approved_at,
        r.delivered_by,
        r.delivered_at,
        r.created_at,
        r.updated_at,
        r.rejected_by,
        r.rejected_at,
        u.name AS user_name,
        u.email AS user_email,
        u.phone AS user_phone,
        f.name AS facility_name,
        f.location AS facility_location
      FROM requisitions r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN facilities f ON r.facility_id = f.id
      WHERE r.facility_id = ?
      ORDER BY r.created_at DESC
      `,
      [facility_id]
    );

    if (requisitions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No requisitions found for this facility",
      });
    }

    // 🔹 Step 2: For each requisition, attach its items with facility stock
    for (const requisition of requisitions) {
      const [items] = await connection.query(
        `
        SELECT 
          ri.id AS requisition_item_id,
          ri.item_id, 
          ri.quantity AS requested_quantity,
          ri.approved_quantity,
          ri.delivered_quantity,
          ri.priority AS item_priority,
          
          -- Item details from warehouse
          iw.item_code,
          iw.item_name,
          iw.category,
          iw.description,
          iw.unit,
          iw.item_cost,
          iw.expiry_date,

          -- Facility stock
          IFNULL(ifac.quantity, 0) AS facility_stock
        FROM requisition_items ri
        LEFT JOIN inventory_warehouse iw 
          ON iw.id = ri.item_id
        LEFT JOIN inventory_facility ifac
          ON ifac.item_id = ri.item_id AND ifac.facility_id = ?
        WHERE ri.requisition_id = ?
        `,
        [facility_id, requisition.id]
      );

      requisition.items = items.length ? items : [];
    }

    // 🔹 Step 3: Send response
    res.status(200).json({
      success: true,
      data: requisitions,
    });
  } catch (error) {
    console.error("Get Requisitions by Facility Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get requisitions for this facility",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const raiseToWarehouse = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const { requisition_id, facility_id, items, priority, remarks, user_id } = req.body;

    // 🔹 Validations
    if (!requisition_id || !facility_id || !items || !Array.isArray(items) || items.length === 0 || !user_id) {
      return res.status(400).json({
        success: false,
        message: "requisition_id, facility_id, items array, and user_id are required",
      });
    }

    // 🔹 Check if requisition exists
    const [requisition] = await connection.query(
      "SELECT id, status FROM requisitions WHERE id = ?",
      [requisition_id]
    );

    if (requisition.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Requisition not found",
      });
    }

    // 🔹 Insert into raise_requests
    for (const item of items) {
      const { item_id, required_quantity } = item;

      if (!item_id || !required_quantity) continue;

      await connection.query(
        `INSERT INTO raise_requests 
          (requisition_id, facility_id, item_id, required_qty, priority, remarks, status, created_at, updated_at, raised_by)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW(), ?)`,
        [requisition_id, facility_id, item_id, required_quantity, priority || "Normal", remarks || null, user_id]
      );
    }

    // 🔹 Update requisitions status to 'raised'
    await connection.query(
      `UPDATE requisitions 
       SET status = 'raised', updated_at = NOW()
       WHERE id = ?`,
      [requisition_id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Request raised to warehouse successfully",
    });
  } catch (error) {
    await connection.rollback();
    console.error("Raise to Warehouse Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to raise to warehouse",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


const getRaiseRequests = async (req, res) => {
  try {
    const query = `
      SELECT 
        rr.id AS raise_request_id,
        rr.raised_by AS user_id,
        u.name AS user_name,
        rr.requisition_id,
        rr.facility_id,
        f.name AS facility_name,
        rr.priority,
        rr.remarks,
        rr.status,
        rr.created_at,
        rr.updated_at,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'item_id', i.id,
            'item_code', i.item_code,
            'item_name', i.item_name,
            'unit', i.unit,
            'quantity', rr.required_qty,
            'approved_quantity', ri.approved_quantity,
            'delivered_quantity', ri.delivered_quantity,
            'item_cost', i.item_cost,
            'expiry_date', i.expiry_date
          )
        ) AS items
      FROM raise_requests rr
      LEFT JOIN facilities f ON rr.facility_id = f.id
      LEFT JOIN users u ON rr.raised_by = u.id
      LEFT JOIN requisition_items ri ON rr.requisition_id = ri.requisition_id AND rr.item_id = ri.item_id
      LEFT JOIN inventory i ON rr.item_id = i.id
      GROUP BY rr.id
      ORDER BY rr.created_at DESC
    `;

    const [rows] = await pool.query(query);

    res.status(200).json({
      success: true,
      message: "All raise requests fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching raise requests:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching raise requests",
      error: error.message,
    });
  }
};





module.exports = {
  getRequisitions,
  getRequisitionById,
  createRequisition,
  updateRequisition,
  approveUserRequisition,
  deliverRequisition,
  deleteRequisition,
  getRequisitionsByUser,
  rejectUserRequisition,
  getRequisitionsByFacility,
  partialApproveRequisition,
  raiseToWarehouse,
  getRaiseRequests,
  warehouseApproveRequisition,
  warehouseRejectRequisition,
  bulkApproveRequisition,
  warehouseBulkApprove,
  warehousePartialApproveRequisition
};
