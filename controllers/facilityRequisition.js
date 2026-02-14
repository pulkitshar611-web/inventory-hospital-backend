const { pool } = require('../config');

const createFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { facility_id, priority, remarks, items } = req.body;

    // 🔹 Validation
    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });
    }

    await connection.beginTransaction();

    // 🔹 Step 1: Insert into facility_requisitions
    const [requisitionResult] = await connection.execute(
      `INSERT INTO facility_requisitions 
        (facility_id, status, priority, remarks, created_at, updated_at)
       VALUES (?, 'pending', ?, ?, NOW(), NOW())`,
      [facility_id, priority || "medium", remarks || null]
    );

    const facilityRequisitionId = requisitionResult.insertId;

    // 🔹 Step 2: Insert items into facility_requisition_item
    for (const item of items) {
      await connection.execute(
        `INSERT INTO facility_requisition_item
          (requisition_id, item_id, quantity, approved_quantity, delivered_quantity, priority, created_at)
         VALUES (?, ?, ?, 0, 0, ?, NOW())`,
        [
          facilityRequisitionId,
          item.item_id,
          item.quantity,
          item.priority || "medium",
        ]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Facility requisition created successfully 🚀",
      data: {
        facility_requisition_id: facilityRequisitionId,
        facility_id,
        items,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("❌ Error creating facility requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error occurred while creating facility requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const getAllFacilityRequisitions = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // 🔹 Step 1: Fetch all requisitions with facility name
    const [requisitions] = await connection.execute(
      `SELECT fr.*, f.name AS facility_name
       FROM facility_requisitions fr
       JOIN facilities f ON fr.facility_id = f.id
       ORDER BY fr.created_at DESC`
    );

    if (requisitions.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // 🔹 Step 2: Fetch items with item_name, requisition_id, and available quantity
    const requisitionIds = requisitions.map(r => r.id);
    const [items] = await connection.query(
      `SELECT 
          fri.id AS item_id, 
          fri.requisition_id, 
          fri.item_id, 
          fri.quantity, 
          fri.approved_quantity, 
          fri.delivered_quantity, 
          iw.item_name,
          iw.quantity AS available_quantity  -- added available quantity
       FROM facility_requisition_item fri
       JOIN inventory_warehouse iw ON fri.item_id = iw.id
       WHERE fri.requisition_id IN (?)`,
      [requisitionIds]
    );

    // 🔹 Step 3: Attach items to their parent requisition
    const result = requisitions.map(r => ({
      ...r,
      items: items.filter(i => i.requisition_id === r.id)
    }));

    res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error("❌ Error fetching all facility requisitions:", error);
    res.status(500).json({
      success: false,
      message: "Error occurred while fetching all facility requisitions",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

          
const getFacilityRequisitionsByFacilityId = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    let { facility_id } = req.params;

    facility_id = Number(facility_id);

    if (!facility_id || isNaN(facility_id)) {
      return res.status(400).json({
        success: false,
        message: "facility_id is missing or invalid",
      });
    }

    const [requisitions] = await connection.execute(
      `SELECT * FROM facility_requisitions WHERE facility_id = ?`,
      [facility_id]
    );

    if (requisitions.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const ids = requisitions.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");

    const [items] = await connection.query(
      `
      SELECT fri.*, iw.item_name
      FROM facility_requisition_item fri
      JOIN inventory_warehouse iw ON fri.item_id = iw.id
      WHERE fri.requisition_id IN (${placeholders})
      `,
      ids
    );

    const result = requisitions.map(r => ({
      ...r,
      items: items.filter(i => i.requisition_id === r.id),
    }));

    return res.status(200).json({ success: true, data: result });

  } catch (error) {
    console.error("❌ Error fetching facility requisitions:", error);
    return res.status(500).json({
      success: false,
      message: "Error occurred while fetching facility requisitions",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


// const approveFacilityRequisition = async (req, res) => {

//   const connection = await pool.getConnection();

//   try {
//     const { requisition_id, approvedItems, remarks } = req.body; 
//     // approvedItems = [{ item_id: 101, approved_quantity: 10 }, ...]

//     if (!requisition_id || !approvedItems || !Array.isArray(approvedItems)) {
//       return res.status(400).json({
//         success: false,
//         message: "requisition_id and approvedItems are required",
//       });
//     }

//     await connection.beginTransaction();

//     // 🔹 Get facility_id once
//     const [[requisitionRow]] = await connection.execute(
//       `SELECT facility_id FROM facility_requisitions WHERE id = ?`,
//       [requisition_id]
//     );
//     if (!requisitionRow) throw new Error(`Requisition ${requisition_id} not found`);
//     const facility_id = requisitionRow.facility_id;

//     for (const item of approvedItems) {
//       const { item_id, approved_quantity } = item;

//       if (!approved_quantity || approved_quantity <= 0) continue;

//       // 🔹 Update approved_quantity in facility_requisition_item
//       await connection.execute(
//         `UPDATE facility_requisition_item
//          SET approved_quantity = ?
//          WHERE requisition_id = ? AND item_id = ?`,
//         [approved_quantity, requisition_id, item_id]
//       );

//       // 🔹 Deduct from inventory_warehouse (use id)
//       await connection.execute(
//         `UPDATE inventory_warehouse
//          SET quantity = quantity - ?
//          WHERE id = ?`,
//         [approved_quantity, item_id]
//       );

//       // 🔹 Add or update item in inventory_facility
//       const [existing] = await connection.execute(
//         `SELECT * FROM inventory_facility WHERE item_id = ? AND facility_id = ?`,
//         [item_id, facility_id]
//       );

//       if (existing.length > 0) {
//         // Update existing facility inventory
//         await connection.execute(
//           `UPDATE inventory_facility
//            SET quantity = quantity + ?, updated_at = NOW()
//            WHERE item_id = ? AND facility_id = ?`,
//           [approved_quantity, item_id, facility_id]
//         );
//       } else {
//         // Insert new item into facility inventory
//         const [itemData] = await connection.execute(
//           `SELECT * FROM inventory_warehouse WHERE id = ?`,
//           [item_id] // use id here
//         );

//         if (itemData.length === 0) throw new Error(`Item ${item_id} not found in warehouse`);
//         const data = itemData[0];

//         await connection.execute(
//           `INSERT INTO inventory_facility
//            (item_code, item_name, category, description, unit, facility_id, item_id, quantity, reorder_level, item_cost, expiry_date, created_at, updated_at)
//            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
//           [
//             data.item_code,
//             data.item_name,
//             data.category,
//             data.description,
//             data.unit,
//             facility_id,
//             item_id,
//             approved_quantity,
//             data.reorder_level,
//             data.item_cost,
//             data.expiry_date
//           ]
//         );
//       }
//     }

//     // 🔹 Update requisition status and remarks
//     await connection.execute(
//       `UPDATE facility_requisitions
//        SET status = 'approved', remarks = ?, updated_at = NOW()
//        WHERE id = ?`,
//       [remarks || null, requisition_id]
//     );

//     await connection.commit();

//     res.status(200).json({
//       success: true,
//       message: "Facility requisition approved and inventory updated successfully 🚀"
//     });

//   } catch (error) {
//     await connection.rollback();
//     console.error("❌ Error approving requisition:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error occurred while approving requisition",
//       error: error.message
//     });
//   } finally {
//     connection.release();
//   }
// };

const approveFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, remark } = req.body;

    // 1️⃣ Check if requisition exists
    const [requisition] = await connection.query(
      `SELECT * FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    if (requisition.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const facility_id = requisition[0].facility_id;

    // 2️⃣ Update facility_requisitions (status = approved)
    await connection.query(
      `UPDATE facility_requisitions 
       SET status = 'approved', updated_at = NOW()
       WHERE id = ?`,
      [requisition_id]
    );

    // 3️⃣ Get all items for that requisition
    const [items] = await connection.query(
      `SELECT id, item_id, quantity, approved_quantity
       FROM facility_requisition_item 
       WHERE requisition_id = ?`,
      [requisition_id]
    );

    if (items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "No items found in requisition" });
    }

    // 3️⃣a Ensure approved_quantity is set
    for (const item of items) {
      if (!item.approved_quantity || item.approved_quantity === 0) {
        await connection.query(
          `UPDATE facility_requisition_item 
           SET approved_quantity = ? 
           WHERE id = ?`,
          [item.quantity, item.id]
        );
        item.approved_quantity = item.quantity; // update locally for later use
      }
    }

    // 4️⃣ Insert each item into dispatches table with status = pending and quantity = approved_quantity
    for (const item of items) {
      const tracking_number = `TRK-${Date.now()}-${item.item_id}`;

      await connection.query(
        `INSERT INTO dispatches (requisition_id, facility_id, item_id, quantity, tracking_number, remark, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [requisition_id, facility_id, item.item_id, item.approved_quantity, tracking_number, remark || '']
      );
    }

    // 5️⃣ Calculate total approved quantity
    const totalQuantity = items.reduce((sum, item) => sum + item.approved_quantity, 0);

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Requisition approved successfully and dispatch entries created",
      data: {
        requisition_id,
        facility_id,
        quantity: totalQuantity,   // total approved quantity
        dispatch_status: "pending",
        requisition_status: "approved"
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error approving requisition:", error);
    return res.status(500).json({
      success: false,
      message: "Error approving requisition",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


const approveFacilityRequisitionsBulk = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_ids, remark } = req.body;

    if (!requisition_ids || !Array.isArray(requisition_ids) || requisition_ids.length === 0) {
      return res.status(400).json({ success: false, message: "requisition_ids must be a non-empty array" });
    }

    let totalApprovedQuantity = 0;
    const results = [];

    for (const requisition_id of requisition_ids) {
      // 1️⃣ Fetch requisition
      const [requisition] = await connection.query(
        `SELECT * FROM facility_requisitions WHERE id = ?`,
        [requisition_id]
      );

      if (requisition.length === 0) {
        results.push({ requisition_id, success: false, message: "Requisition not found" });
        continue; // skip to next requisition
      }

      const facility_id = requisition[0].facility_id;

      // 2️⃣ Update facility_requisitions status to approved
      await connection.query(
        `UPDATE facility_requisitions 
         SET status = 'approved', updated_at = NOW()
         WHERE id = ?`,
        [requisition_id]
      );

      // 3️⃣ Get all items for that requisition
      const [items] = await connection.query(
        `SELECT id, item_id, quantity, approved_quantity
         FROM facility_requisition_item 
         WHERE requisition_id = ?`,
        [requisition_id]
      );

      if (items.length === 0) {
        results.push({ requisition_id, success: false, message: "No items found in requisition" });
        continue;
      }

      // 3️⃣a Ensure approved_quantity is set
      for (const item of items) {
        if (!item.approved_quantity || item.approved_quantity === 0) {
          await connection.query(
            `UPDATE facility_requisition_item 
             SET approved_quantity = ? 
             WHERE id = ?`,
            [item.quantity, item.id]
          );
          item.approved_quantity = item.quantity;
        }
      }

      // 4️⃣ Insert each item into dispatches table
      let requisitionTotalQuantity = 0;
      for (const item of items) {
        const tracking_number = `TRK-${Date.now()}-${item.item_id}-${Math.floor(Math.random() * 1000)}`;

        await connection.query(
          `INSERT INTO dispatches (requisition_id, facility_id, item_id, quantity, tracking_number, remark, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [requisition_id, facility_id, item.item_id, item.approved_quantity, tracking_number, remark || '']
        );

        requisitionTotalQuantity += item.approved_quantity;
      }

      totalApprovedQuantity += requisitionTotalQuantity;

      results.push({
        requisition_id,
        facility_id,
        approved_quantity: requisitionTotalQuantity,
        dispatch_status: "pending",
        requisition_status: "approved",
        success: true
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Bulk requisition approval completed",
      totalApprovedQuantity,
      results
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error approving bulk requisitions:", error);
    return res.status(500).json({
      success: false,
      message: "Error approving bulk requisitions",
      error: error.message
    });
  } finally {
    connection.release();
  }
};


const partialApproveFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, remark, items: approvedItems } = req.body;

    if (!approvedItems || !approvedItems.length) {
      return res.status(400).json({ success: false, message: "No items provided for approval" });
    }

    // 1️⃣ Check if requisition exists
    const [requisition] = await connection.query(
      `SELECT * FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    if (requisition.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const facility_id = requisition[0].facility_id;

    // 2️⃣ Get all items of requisition
    const [allItems] = await connection.query(
      `SELECT id, item_id, quantity, approved_quantity 
       FROM facility_requisition_item 
       WHERE requisition_id = ?`,
      [requisition_id]
    );

    if (!allItems.length) {
      return res.status(400).json({ success: false, message: "No items found in requisition" });
    }

    let totalApprovedQuantity = 0;
    let anyApproved = false;

    // 3️⃣ Update approved_quantity for each item
    for (const item of allItems) {
      const approvedItem = approvedItems.find(i => i.item_id === item.item_id);
      const approvedQty = approvedItem ? Number(approvedItem.approved_quantity) : 0;

      if (approvedQty > 0) {
        anyApproved = true;
        totalApprovedQuantity += approvedQty;

        // Update facility_requisition_item table
        await connection.query(
          `UPDATE facility_requisition_item 
           SET approved_quantity = ? 
           WHERE id = ?`,
          [approvedQty, item.id]
        );

        // Create dispatch entry
        const tracking_number = `TRK-${Date.now()}-${item.item_id}`;
        await connection.query(
          `INSERT INTO dispatches (requisition_id, facility_id, item_id, quantity, tracking_number, remark, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
          [requisition_id, facility_id, item.item_id, approvedQty, tracking_number, remark || '']
        );
      }
    }

    if (!anyApproved) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "No items were approved" });
    }

    // 4️⃣ Update requisition status
    const newStatus = anyApproved && totalApprovedQuantity < allItems.reduce((sum, i) => sum + i.quantity, 0)
      ? 'partially_approved'
      : 'approved';

    await connection.query(
      `UPDATE facility_requisitions 
       SET status = ?, updated_at = NOW() 
       WHERE id = ?`,
      [newStatus, requisition_id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Requisition partially approved successfully",
      data: {
        requisition_id,
        facility_id,
        total_approved_quantity: totalApprovedQuantity,
        requisition_status: newStatus,
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error("Error in partial approval:", error);
    return res.status(500).json({ success: false, message: "Error in partial approval", error: error.message });
  } finally {
    connection.release();
  }
};

const rejectFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { requisition_id, remarks, rejected_by } = req.body;

    if (!requisition_id) {
      return res.status(400).json({
        success: false,
        message: "requisition_id is required",
      });
    }

    await connection.beginTransaction();

    // 🔹 Step 1: Check if requisition exists
    const [reqCheck] = await connection.execute(
      `SELECT id FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    if (reqCheck.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Requisition not found for this facility",
      });
    }

    // 🔹 Step 2: Update requisition status to 'rejected'
    await connection.execute(
      `UPDATE facility_requisitions
       SET status = 'rejected',
           remarks = ?,
           rejected_by = ?,
           rejected_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [remarks || null, rejected_by || null, requisition_id]
    );

    // 🔹 Step 3 (Optional): Reset approved_quantity of all items to 0
    await connection.execute(
      `UPDATE facility_requisition_item
       SET approved_quantity = 0
       WHERE requisition_id = ?`,
      [requisition_id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Facility requisition rejected successfully ❌",
    });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error rejecting requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error occurred while rejecting requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


const deleteFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id, facility_id } = req.body;

    // 🔹 Validation
    if (!id || !facility_id) {
      return res.status(400).json({
        success: false,
        message: "id and facility_id are required",
      });
    }

    await connection.beginTransaction();

    // 🔹 Step 1: Check if requisition exists and belongs to same facility
    const [checkReq] = await connection.execute(
      `SELECT id FROM facility_requisitions 
       WHERE id = ? AND facility_id = ? LIMIT 1`,
      [id, facility_id]
    );

    if (checkReq.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Requisition not found or does not belong to this facility",
      });
    }

    // 🔹 Step 2: Delete child items
    await connection.execute(
      `DELETE FROM facility_requisition_item WHERE requisition_id = ?`,
      [id]
    );

    // 🔹 Step 3: Delete parent requisition
    await connection.execute(
      `DELETE FROM facility_requisitions WHERE id = ?`,
      [id]
    );

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Facility requisition deleted successfully 🗑️",
      requisition_id: id,
    });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Error deleting facility requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error occurred while deleting facility requisition",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};




module.exports = {
  createFacilityRequisition,
  getFacilityRequisitionsByFacilityId,
  getAllFacilityRequisitions,
  approveFacilityRequisition,
  partialApproveFacilityRequisition,
  rejectFacilityRequisition,
  approveFacilityRequisitionsBulk,
  deleteFacilityRequisition
};