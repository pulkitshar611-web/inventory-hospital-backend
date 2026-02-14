const { pool } = require('../config');

const createFacilityRequisition = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { facility_id, priority, remarks, items, estimated_usage_duration } = req.body;

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
        (facility_id, status, priority, remarks, estimated_usage_duration, created_at, updated_at)
       VALUES (?, 'pending', ?, ?, ?, NOW(), NOW())`,
      [facility_id, priority || "medium", remarks || null, estimated_usage_duration || null]
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
    // 🔹 Step 1: Fetch from facility_requisitions table
    const [facilityRequisitions] = await connection.execute(
      `SELECT fr.*, 
              COALESCE(f.name, 'Unknown Facility') AS facility_name,
              COALESCE(
                (SELECT u.name FROM users u 
                 WHERE u.facility_id = fr.facility_id 
                 AND u.role = 'facility_admin' 
                 LIMIT 1),
                (SELECT u.name FROM users u 
                 WHERE u.facility_id = fr.facility_id 
                 LIMIT 1),
                f.contact_person,
                'Facility Admin'
              ) AS user_name,
              'facility_requisition' AS requisition_type
       FROM facility_requisitions fr
       LEFT JOIN facilities f ON fr.facility_id = f.id
       ORDER BY fr.created_at DESC`
    );

    // 🔹 Step 1b: Also fetch from requisitions table (for facility user created requisitions)
    const [userRequisitions] = await connection.execute(
      `SELECT r.*,
              COALESCE(f.name, 'Unknown Facility') AS facility_name,
              COALESCE(u.name, 'Unknown User') AS user_name,
              COALESCE(u.email, '') AS user_email,
              'user_requisition' AS requisition_type
       FROM requisitions r
       LEFT JOIN facilities f ON r.facility_id = f.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.status NOT IN ('completed', 'cancelled')
       ORDER BY r.created_at DESC`
    );

    // 🔹 Step 1c: Also fetch raised requests (from raise_requests table - when facility admin raises to warehouse)
    // Group by requisition_id to get unique requisitions
    const [raisedRequestsRaw] = await connection.execute(
      `SELECT 
              rr.requisition_id AS id,
              rr.requisition_id,
              rr.facility_id,
              COALESCE(MAX(rr.status), 'pending') AS status,
              COALESCE(MAX(rr.priority), 'normal') AS priority,
              COALESCE(MAX(rr.remarks), '') AS remarks,
              MIN(rr.created_at) AS created_at,
              MAX(rr.updated_at) AS updated_at,
              COALESCE(f.name, 'Unknown Facility') AS facility_name,
              COALESCE(MAX(rr.user_name), 'Facility Admin') AS user_name,
              'raised_request' AS requisition_type
       FROM raise_requests rr
       LEFT JOIN facilities f ON rr.facility_id = f.id
       WHERE rr.status IN ('pending', 'partially_approved')
       GROUP BY rr.requisition_id, rr.facility_id, f.name
       ORDER BY created_at DESC`
    );

    const raisedRequests = raisedRequestsRaw;

    // 🔹 Combine all three types of requisitions
    const allRequisitions = [
      ...facilityRequisitions.map(r => ({ ...r, id: r.id, requisition_id: r.id })),
      ...userRequisitions.map(r => ({ ...r, id: r.id, requisition_id: r.id })),
      ...raisedRequests.map(r => ({ ...r, id: r.id, requisition_id: r.requisition_id, status: r.status || 'raised' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (allRequisitions.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // 🔹 Step 2: Fetch items from facility_requisition_item table
    const facilityReqIds = facilityRequisitions.map(r => r.id);
    let facilityItems = [];
    if (facilityReqIds.length > 0) {
      const [facItems] = await connection.query(
        `SELECT 
            fri.id AS item_id, 
            fri.requisition_id, 
            fri.item_id, 
            COALESCE(fri.quantity, 0) AS quantity, 
            COALESCE(fri.approved_quantity, 0) AS approved_quantity, 
            COALESCE(fri.delivered_quantity, 0) AS delivered_quantity, 
            COALESCE(iw.item_name, 'Unknown Item') AS item_name,
            COALESCE(iw.item_code, 'N/A') AS item_code,
            COALESCE(iw.quantity, 0) AS available_quantity
         FROM facility_requisition_item fri
         LEFT JOIN inventory_warehouse iw ON fri.item_id = iw.id
         WHERE fri.requisition_id IN (?)`,
        [facilityReqIds]
      );
      facilityItems = facItems;
    }

    // 🔹 Step 2b: Fetch items from requisition_items table
    const userReqIds = userRequisitions.map(r => r.id);
    let userItems = [];
    if (userReqIds.length > 0) {
      const [usrItems] = await connection.query(
        `SELECT 
            ri.id AS item_id,
            ri.requisition_id,
            ri.item_id,
            COALESCE(ri.quantity, 0) AS quantity,
            COALESCE(ri.approved_quantity, 0) AS approved_quantity,
            COALESCE(ri.delivered_quantity, 0) AS delivered_quantity,
            COALESCE(iw.item_name, i.item_name, 'Unknown Item') AS item_name,
            COALESCE(iw.item_code, i.item_code, 'N/A') AS item_code,
            COALESCE(iw.quantity, 0) AS available_quantity
         FROM requisition_items ri
         LEFT JOIN inventory_warehouse iw ON ri.item_id = iw.id
         LEFT JOIN inventory i ON (iw.item_id = i.id OR ri.item_id = i.id)
         WHERE ri.requisition_id IN (?)`,
        [userReqIds]
      );
      userItems = usrItems;
    }

    // 🔹 Step 2c: Fetch items from raise_requests table (for raised to warehouse)
    const raisedReqIds = raisedRequests.map(r => r.requisition_id);
    let raisedItems = [];
    if (raisedReqIds.length > 0) {
      const [raiseItems] = await connection.query(
        `SELECT 
            rr.id AS item_id,
            rr.requisition_id,
            rr.item_id,
            COALESCE(rr.required_qty, 0) AS quantity,
            COALESCE(rr.required_qty, 0) AS requested_quantity,
            0 AS approved_quantity,
            0 AS delivered_quantity,
            COALESCE(iw.item_name, i.item_name, 'Unknown Item') AS item_name,
            COALESCE(iw.item_code, i.item_code, 'N/A') AS item_code,
            COALESCE(iw.quantity, 0) AS available_quantity,
            COALESCE(iw.quantity, 0) AS warehouse_stock,
            COALESCE(rr.priority, 'normal') AS item_priority,
            COALESCE(rr.status, 'pending') AS item_status
         FROM raise_requests rr
         LEFT JOIN inventory_warehouse iw ON rr.item_id = iw.id
         LEFT JOIN inventory i ON (iw.item_id = i.id OR rr.item_id = i.id)
         WHERE rr.requisition_id IN (?) AND rr.status IN ('pending', 'partially_approved')
         ORDER BY rr.id`,
        [raisedReqIds]
      );
      raisedItems = raiseItems;
    }

    // 🔹 Step 3: Attach items to their parent requisition and ensure no null values
    const result = allRequisitions.map(r => {
      const baseRequisition = {
        ...r,
        facility_name: r.facility_name || 'Unknown Facility',
        user_name: r.user_name || 'Unknown User',
        user_email: r.user_email || '',
        priority: r.priority || 'normal',
        status: r.status || 'pending',
        remarks: r.remarks || '',
        estimated_usage_duration: r.estimated_usage_duration || null,
        approved_by: r.approved_by || null,
        approved_at: r.approved_at || null,
        delivered_by: r.delivered_by || null,
        delivered_at: r.delivered_at || null,
        rejected_by: r.rejected_by || null,
        rejected_at: r.rejected_at || null,
      };

      if (r.requisition_type === 'facility_requisition') {
        return {
          ...baseRequisition,
          items: facilityItems.filter(i => i.requisition_id === r.id).map(item => ({
            ...item,
            item_name: item.item_name || 'Unknown Item',
            item_code: item.item_code || 'N/A',
            quantity: item.quantity || 0,
            approved_quantity: item.approved_quantity || 0,
            delivered_quantity: item.delivered_quantity || 0,
            available_quantity: item.available_quantity || 0,
          }))
        };
      } else if (r.requisition_type === 'raised_request') {
        return {
          ...baseRequisition,
          items: raisedItems.filter(i => i.requisition_id === r.requisition_id).map(item => ({
            ...item,
            item_name: item.item_name || 'Unknown Item',
            item_code: item.item_code || 'N/A',
            quantity: item.quantity || 0,
            approved_quantity: item.approved_quantity || 0,
            delivered_quantity: item.delivered_quantity || 0,
            available_quantity: item.available_quantity || 0,
          })),
          status: r.status || 'pending'
        };
      } else {
        return {
          ...baseRequisition,
          items: userItems.filter(i => i.requisition_id === r.id).map(item => ({
            ...item,
            item_name: item.item_name || 'Unknown Item',
            item_code: item.item_code || 'N/A',
            quantity: item.quantity || 0,
            approved_quantity: item.approved_quantity || 0,
            delivered_quantity: item.delivered_quantity || 0,
            available_quantity: item.available_quantity || 0,
          }))
        };
      }
    });

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

// Get facility requisition by ID (checks both facility_requisitions and requisitions tables)
const getFacilityRequisitionById = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;
    console.log('🔍 Fetching requisition ID:', id);

    // Validate and parse ID
    const requisitionId = parseInt(id, 10);
    if (isNaN(requisitionId) || requisitionId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid requisition ID'
      });
    }

    // First, try to find in facility_requisitions table
    let [requisitions] = await connection.execute(
      `SELECT fr.*, 
              f.name AS facility_name,
              f.location AS facility_location,
              COALESCE(
                (SELECT u.name FROM users u 
                 WHERE u.facility_id = fr.facility_id 
                 AND u.role = 'facility_admin' 
                 LIMIT 1),
                (SELECT u.name FROM users u 
                 WHERE u.facility_id = fr.facility_id 
                 LIMIT 1),
                f.contact_person,
                'Facility Admin'
              ) AS user_name,
              'facility_requisition' AS requisition_type
       FROM facility_requisitions fr
       LEFT JOIN facilities f ON fr.facility_id = f.id
       WHERE fr.id = ?`,
      [requisitionId]
    );

    // If not found, try requisitions table (user-created requisitions)
    if (requisitions.length === 0) {
      [requisitions] = await connection.execute(
        `SELECT r.*,
                f.name AS facility_name,
                f.location AS facility_location,
                u.name AS user_name,
                u.email AS user_email,
                'user_requisition' AS requisition_type
         FROM requisitions r
         LEFT JOIN facilities f ON r.facility_id = f.id
         LEFT JOIN users u ON r.user_id = u.id
         WHERE r.id = ?`,
        [requisitionId]
      );
    }

    // If still not found, try raise_requests table (raised to warehouse)
    if (requisitions.length === 0) {
      const [raiseReqs] = await connection.execute(
        `SELECT DISTINCT
                rr.requisition_id AS id,
                rr.requisition_id,
                rr.facility_id,
                MAX(rr.status) AS status,
                MAX(rr.priority) AS priority,
                MAX(rr.remarks) AS remarks,
                MIN(rr.created_at) AS created_at,
                MAX(rr.updated_at) AS updated_at,
                f.name AS facility_name,
                f.location AS facility_location,
                MAX(rr.user_name) AS user_name,
                'raised_request' AS requisition_type
         FROM raise_requests rr
         LEFT JOIN facilities f ON rr.facility_id = f.id
         WHERE rr.requisition_id = ?
         GROUP BY rr.requisition_id, rr.facility_id, f.name, f.location
         LIMIT 1`,
        [requisitionId]
      );
      if (raiseReqs.length > 0) {
        requisitions = raiseReqs;
      }
    }

    if (requisitions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Requisition not found'
      });
    }

    const requisition = requisitions[0];

    // Get requisition items based on requisition type
    let items = [];

    if (requisition.requisition_type === 'raised_request') {
      // Get items from raise_requests table
      const [raiseItems] = await connection.query(
        `SELECT 
            rr.id AS requisition_item_id,
            rr.item_id, 
            rr.required_qty AS requested_quantity,
            0 AS approved_quantity,
            0 AS delivered_quantity,
            rr.priority AS item_priority,
            COALESCE(iw.item_code, i.item_code, 'N/A') AS item_code,
            COALESCE(iw.item_name, i.item_name, 'N/A') AS item_name,
            COALESCE(iw.category, i.category, 'N/A') AS category,
            COALESCE(iw.description, i.description, NULL) AS description,
            COALESCE(iw.unit, i.unit, 'N/A') AS unit,
            COALESCE(iw.item_cost, i.item_cost, 0) AS item_cost,
            COALESCE(iw.expiry_date, i.expiry_date, NULL) AS expiry_date,
            COALESCE(iw.quantity, 0) AS warehouse_stock,
            IFNULL(ifac.quantity, 0) AS facility_stock,
            rr.status AS item_status
         FROM raise_requests rr
         LEFT JOIN inventory_warehouse iw ON rr.item_id = iw.id
         LEFT JOIN inventory i ON (iw.item_id = i.id OR rr.item_id = i.id)
         LEFT JOIN inventory_facility ifac ON ifac.item_id = rr.item_id AND ifac.facility_id = ?
         WHERE rr.requisition_id = ? AND rr.status IN ('pending', 'partially_approved')
         ORDER BY rr.id`,
        [requisition.facility_id, requisitionId]
      );
      items = raiseItems;
    } else if (requisition.requisition_type === 'facility_requisition') {
      // Get items from facility_requisition_item table
      const [facItems] = await connection.query(
        `SELECT 
            fri.id AS requisition_item_id,
            fri.item_id, 
            fri.quantity AS requested_quantity,
            fri.approved_quantity,
            fri.delivered_quantity,
            fri.priority AS item_priority,
            COALESCE(iw.item_code, i.item_code, 'N/A') AS item_code,
            COALESCE(iw.item_name, i.item_name, 'N/A') AS item_name,
            COALESCE(iw.category, i.category, 'N/A') AS category,
            COALESCE(iw.description, i.description, NULL) AS description,
            COALESCE(iw.unit, i.unit, 'N/A') AS unit,
            COALESCE(iw.item_cost, i.item_cost, 0) AS item_cost,
            COALESCE(iw.expiry_date, i.expiry_date, NULL) AS expiry_date,
            COALESCE(iw.quantity, 0) AS warehouse_stock,
            IFNULL(ifac.quantity, 0) AS facility_stock
         FROM facility_requisition_item fri
         LEFT JOIN inventory_warehouse iw ON fri.item_id = iw.id
         LEFT JOIN inventory i ON (iw.item_id = i.id OR fri.item_id = i.id)
         LEFT JOIN inventory_facility ifac ON ifac.item_id = fri.item_id AND ifac.facility_id = ?
         WHERE fri.requisition_id = ?
         ORDER BY fri.id`,
        [requisition.facility_id, requisitionId]
      );
      items = facItems;
    } else {
      // Get items from requisition_items table
      const [userItems] = await connection.query(
        `SELECT 
            ri.id AS requisition_item_id,
            ri.item_id, 
            ri.quantity AS requested_quantity,
            ri.approved_quantity,
            ri.delivered_quantity,
            ri.priority AS item_priority,
            COALESCE(iw.item_code, i.item_code, 'N/A') AS item_code,
            COALESCE(iw.item_name, i.item_name, 'N/A') AS item_name,
            COALESCE(iw.category, i.category, 'N/A') AS category,
            COALESCE(iw.description, i.description, NULL) AS description,
            COALESCE(iw.unit, i.unit, 'N/A') AS unit,
            COALESCE(iw.item_cost, i.item_cost, 0) AS item_cost,
            COALESCE(iw.expiry_date, i.expiry_date, NULL) AS expiry_date,
            COALESCE(iw.quantity, 0) AS warehouse_stock,
            IFNULL(ifac.quantity, 0) AS facility_stock
         FROM requisition_items ri
         LEFT JOIN inventory_warehouse iw ON ri.item_id = iw.id
         LEFT JOIN inventory i ON (iw.item_id = i.id OR ri.item_id = i.id)
         LEFT JOIN inventory_facility ifac ON ifac.item_id = ri.item_id AND ifac.facility_id = ?
         WHERE ri.requisition_id = ?
         ORDER BY ri.id`,
        [requisition.facility_id, requisitionId]
      );
      items = userItems;
    }

    console.log('📦 Fetched items for requisition:', requisitionId, 'Items count:', items.length);
    if (items.length > 0) {
      console.log('📦 First item sample:', {
        item_id: items[0].item_id,
        item_name: items[0].item_name,
        item_code: items[0].item_code
      });
    }

    requisition.items = items || [];
    requisition.total_items = items.length;

    res.status(200).json({
      success: true,
      data: requisition
    });

  } catch (error) {
    console.error('Get facility requisition by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get facility requisition',
      error: error.message
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

    // 1️⃣ Check if requisition exists (check both facility_requisitions and requisitions tables)
    let [requisition] = await connection.query(
      `SELECT id, facility_id, status FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    let requisitionType = 'facility_requisition';

    // If not found in facility_requisitions, check requisitions table (user requisitions)
    if (requisition.length === 0) {
      [requisition] = await connection.query(
        `SELECT id, facility_id, status FROM requisitions WHERE id = ?`,
        [requisition_id]
      );
      if (requisition.length > 0) {
        requisitionType = 'user_requisition';
      }
    }

    if (requisition.length === 0) {
      return res.status(404).json({ success: false, message: "Requisition not found" });
    }

    const facility_id = requisition[0].facility_id;

    // 2️⃣ Get all items of requisition (from appropriate table)
    let allItems;
    if (requisitionType === 'facility_requisition') {
      [allItems] = await connection.query(
        `SELECT id, item_id, quantity, approved_quantity 
         FROM facility_requisition_item 
         WHERE requisition_id = ?`,
        [requisition_id]
      );
    } else {
      [allItems] = await connection.query(
        `SELECT id, item_id, quantity, approved_quantity 
         FROM requisition_items 
         WHERE requisition_id = ?`,
        [requisition_id]
      );
    }

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

        // Update approved_quantity in appropriate table
        if (requisitionType === 'facility_requisition') {
          await connection.query(
            `UPDATE facility_requisition_item 
             SET approved_quantity = ? 
             WHERE id = ?`,
            [approvedQty, item.id]
          );
        } else {
          await connection.query(
            `UPDATE requisition_items 
             SET approved_quantity = ? 
             WHERE id = ?`,
            [approvedQty, item.id]
          );
        }

        // Deduct from warehouse inventory
        await connection.query(
          `UPDATE inventory_warehouse 
           SET quantity = quantity - ? 
           WHERE id = ? AND quantity >= ?`,
          [approvedQty, item.item_id, approvedQty]
        );

        // Add to facility inventory
        await connection.query(
          `INSERT INTO inventory_facility (item_id, facility_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
          [item.item_id, facility_id, approvedQty]
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

    // 4️⃣ Update requisition status (in appropriate table)
    const newStatus = anyApproved && totalApprovedQuantity < allItems.reduce((sum, i) => sum + i.quantity, 0)
      ? 'partially_approved'
      : 'approved';

    if (requisitionType === 'facility_requisition') {
      await connection.query(
        `UPDATE facility_requisitions 
         SET status = ?, updated_at = NOW() 
         WHERE id = ?`,
        [newStatus, requisition_id]
      );
    } else {
      await connection.query(
        `UPDATE requisitions 
         SET status = ?, updated_at = NOW() 
         WHERE id = ?`,
        [newStatus, requisition_id]
      );
    }

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




// Unified approval function that handles both facility_requisitions and requisitions
const approveRequisitionUnified = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, approvedItems, remarks } = req.body;

    if (!requisition_id) {
      return res.status(400).json({ success: false, message: "requisition_id is required" });
    }

    // Check which table the requisition is in
    let [facilityReq] = await connection.query(
      `SELECT * FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    // Check raise_requests table (raised to warehouse)
    let [raiseReq] = await connection.query(
      `SELECT DISTINCT requisition_id, facility_id, status FROM raise_requests WHERE requisition_id = ? LIMIT 1`,
      [requisition_id]
    );

    if (raiseReq.length > 0) {
      // Handle raised request (from raise_requests table)
      const facility_id = raiseReq[0].facility_id;

      if (approvedItems && Array.isArray(approvedItems) && approvedItems.length > 0) {
        // Partial approval with specific items
        for (const item of approvedItems) {
          const { item_id, approved_quantity } = item;
          if (!approved_quantity || approved_quantity <= 0) continue;

          // Update raise_requests status to approved
          await connection.query(
            `UPDATE raise_requests 
             SET status = 'approved', updated_at = NOW() 
             WHERE requisition_id = ? AND item_id = ?`,
            [requisition_id, item_id]
          );
        }

        // Check if all items are approved
        const [items] = await connection.query(
          `SELECT status FROM raise_requests WHERE requisition_id = ?`,
          [requisition_id]
        );
        const allApproved = items.every(i => i.status === 'approved');
        const someApproved = items.some(i => i.status === 'approved');

        // Update requisition status if it exists
        await connection.query(
          `UPDATE requisitions 
           SET status = ?, remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [allApproved ? 'approved' : (someApproved ? 'partially_approved' : 'raised'), remarks || null, requisition_id]
        );
      } else {
        // Approve all items in raise_requests
        await connection.query(
          `UPDATE raise_requests 
           SET status = 'approved', updated_at = NOW() 
           WHERE requisition_id = ?`,
          [requisition_id]
        );

        // Update requisition status
        await connection.query(
          `UPDATE requisitions 
           SET status = 'approved', remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [remarks || null, requisition_id]
        );
      }
    } else if (facilityReq.length > 0) {
      // Handle facility_requisition
      const facility_id = facilityReq[0].facility_id;

      if (approvedItems && Array.isArray(approvedItems) && approvedItems.length > 0) {
        // Partial approval with specific items
        for (const item of approvedItems) {
          const { item_id, approved_quantity } = item;
          if (!approved_quantity || approved_quantity <= 0) continue;

          await connection.query(
            `UPDATE facility_requisition_item 
             SET approved_quantity = ? 
             WHERE requisition_id = ? AND item_id = ?`,
            [approved_quantity, requisition_id, item_id]
          );
        }

        // Check if all items are approved
        const [items] = await connection.query(
          `SELECT quantity, approved_quantity FROM facility_requisition_item WHERE requisition_id = ?`,
          [requisition_id]
        );
        const allApproved = items.every(i => i.approved_quantity >= i.quantity);
        const someApproved = items.some(i => i.approved_quantity > 0);

        const newStatus = allApproved ? 'approved' : (someApproved ? 'partially_approved' : 'pending');

        await connection.query(
          `UPDATE facility_requisitions 
           SET status = ?, remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [newStatus, remarks || null, requisition_id]
        );
      } else {
        // Approve all items
        await connection.query(
          `UPDATE facility_requisition_item 
           SET approved_quantity = quantity 
           WHERE requisition_id = ?`,
          [requisition_id]
        );

        await connection.query(
          `UPDATE facility_requisitions 
           SET status = 'approved', remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [remarks || null, requisition_id]
        );
      }
    } else {
      // Handle user requisition (from requisitions table)
      const [userReq] = await connection.query(
        `SELECT facility_id, status FROM requisitions WHERE id = ?`,
        [requisition_id]
      );

      if (userReq.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: "Requisition not found" });
      }

      const facility_id = userReq[0].facility_id;

      if (approvedItems && Array.isArray(approvedItems) && approvedItems.length > 0) {
        // Partial approval with specific items
        for (const item of approvedItems) {
          const { item_id, approved_quantity } = item;
          if (!approved_quantity || approved_quantity <= 0) continue;

          await connection.query(
            `UPDATE requisition_items 
             SET approved_quantity = ? 
             WHERE requisition_id = ? AND item_id = ?`,
            [approved_quantity, requisition_id, item_id]
          );
        }

        // Check if all items are approved
        const [items] = await connection.query(
          `SELECT quantity, approved_quantity FROM requisition_items WHERE requisition_id = ?`,
          [requisition_id]
        );
        const allApproved = items.every(i => i.approved_quantity >= i.quantity);
        const someApproved = items.some(i => i.approved_quantity > 0);

        const newStatus = allApproved ? 'approved' : (someApproved ? 'partially_approved' : 'pending');

        await connection.query(
          `UPDATE requisitions 
           SET status = ?, remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [newStatus, remarks || null, requisition_id]
        );
      } else {
        // Approve all items
        await connection.query(
          `UPDATE requisition_items 
           SET approved_quantity = quantity 
           WHERE requisition_id = ?`,
          [requisition_id]
        );

        await connection.query(
          `UPDATE requisitions 
           SET status = 'approved', remarks = ?, updated_at = NOW() 
           WHERE id = ?`,
          [remarks || null, requisition_id]
        );
      }
    }

    // Create dispatch records for approved items
    // Use approvedItems from request body if provided, otherwise fetch from database
    let approvedItemsList = [];

    if (approvedItems && Array.isArray(approvedItems) && approvedItems.length > 0) {
      // Use approved items from request body (these have the exact approved quantities)
      approvedItemsList = approvedItems
        .filter(item => item.approved_quantity > 0)
        .map(item => ({
          item_id: item.item_id,
          quantity: item.approved_quantity
        }));
    } else {
      // If no approvedItems in request, fetch from database (full approval case)
      if (raiseReq.length > 0) {
        // Get approved items from raise_requests
        const [approvedRaiseItems] = await connection.query(
          `SELECT item_id, required_qty as quantity FROM raise_requests 
           WHERE requisition_id = ? AND status = 'approved'`,
          [requisition_id]
        );
        approvedItemsList = approvedRaiseItems.map(item => ({
          item_id: item.item_id,
          quantity: item.quantity
        }));
      } else if (facilityReq.length > 0) {
        // Get approved items from facility_requisition_item
        const [approvedFacItems] = await connection.query(
          `SELECT item_id, approved_quantity as quantity FROM facility_requisition_item 
           WHERE requisition_id = ? AND approved_quantity > 0`,
          [requisition_id]
        );
        approvedItemsList = approvedFacItems.map(item => ({
          item_id: item.item_id,
          quantity: item.quantity
        }));
      } else {
        // Get approved items from requisition_items
        const [approvedUserItems] = await connection.query(
          `SELECT item_id, approved_quantity as quantity FROM requisition_items 
           WHERE requisition_id = ? AND approved_quantity > 0`,
          [requisition_id]
        );
        approvedItemsList = approvedUserItems.map(item => ({
          item_id: item.item_id,
          quantity: item.quantity
        }));
      }
    }

    // Create dispatch records for each approved item (if not already exists)
    for (const item of approvedItemsList) {
      // Check if dispatch record already exists
      const [existingDispatch] = await connection.query(
        `SELECT id FROM dispatches WHERE requisition_id = ? AND item_id = ?`,
        [requisition_id, item.item_id]
      );

      if (existingDispatch.length === 0) {
        // Generate tracking number
        const trackingNumber = `TRK-${requisition_id}-${item.item_id}-${Date.now()}`;

        // Get facility_id
        let facility_id = null;
        if (raiseReq.length > 0) {
          facility_id = raiseReq[0].facility_id;
        } else if (facilityReq.length > 0) {
          facility_id = facilityReq[0].facility_id;
        } else {
          const [userReq] = await connection.query(
            `SELECT facility_id FROM requisitions WHERE id = ?`,
            [requisition_id]
          );
          if (userReq.length > 0) {
            facility_id = userReq[0].facility_id;
          }
        }

        if (facility_id) {
          await connection.query(
            `INSERT INTO dispatches 
             (requisition_id, facility_id, item_id, quantity, status, tracking_number, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?, NOW())`,
            [requisition_id, facility_id, item.item_id, item.quantity, trackingNumber]
          );
        }
      }
    }

    await connection.commit();
    res.status(200).json({
      success: true,
      message: "Requisition approved successfully"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error approving requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error approving requisition",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// Unified rejection function
const rejectRequisitionUnified = async (req, res) => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();

  try {
    const { requisition_id, item_id, remarks } = req.body; // item_id for individual item rejection

    if (!requisition_id) {
      return res.status(400).json({ success: false, message: "requisition_id is required" });
    }

    // Check which table
    let [facilityReq] = await connection.query(
      `SELECT * FROM facility_requisitions WHERE id = ?`,
      [requisition_id]
    );

    // Check raise_requests table
    let [raiseReq] = await connection.query(
      `SELECT DISTINCT requisition_id FROM raise_requests WHERE requisition_id = ? LIMIT 1`,
      [requisition_id]
    );

    if (raiseReq.length > 0) {
      // Handle raised request rejection
      if (item_id) {
        // Reject individual item in raise_requests
        await connection.query(
          `UPDATE raise_requests 
           SET status = 'rejected', remarks = ?, updated_at = NOW() 
           WHERE requisition_id = ? AND item_id = ?`,
          [remarks || null, requisition_id, item_id]
        );

        // Check if all items are rejected
        const [items] = await connection.query(
          `SELECT status FROM raise_requests WHERE requisition_id = ?`,
          [requisition_id]
        );
        const allRejected = items.every(i => i.status === 'rejected');
        const someRejected = items.some(i => i.status === 'rejected');

        // Update requisition status if all items rejected
        if (allRejected) {
          await connection.query(
            `UPDATE requisitions 
             SET status = 'rejected', remarks = ?, rejected_at = NOW(), updated_at = NOW() 
             WHERE id = ?`,
            [remarks || null, requisition_id]
          );
        }
      } else {
        // Reject entire raised request
        await connection.query(
          `UPDATE raise_requests 
           SET status = 'rejected', remarks = ?, updated_at = NOW() 
           WHERE requisition_id = ?`,
          [remarks || null, requisition_id]
        );

        // Also update requisition status if exists
        await connection.query(
          `UPDATE requisitions 
           SET status = 'rejected', remarks = ?, rejected_at = NOW(), updated_at = NOW() 
           WHERE id = ?`,
          [remarks || null, requisition_id]
        );
      }
    } else if (facilityReq.length > 0) {
      // Reject facility requisition
      await connection.query(
        `UPDATE facility_requisitions 
         SET status = 'rejected', remarks = ?, rejected_at = NOW(), updated_at = NOW() 
         WHERE id = ?`,
        [remarks || null, requisition_id]
      );
    } else {
      // Reject user requisition
      await connection.query(
        `UPDATE requisitions 
         SET status = 'rejected', remarks = ?, rejected_at = NOW(), updated_at = NOW() 
         WHERE id = ?`,
        [remarks || null, requisition_id]
      );
    }

    await connection.commit();
    res.status(200).json({
      success: true,
      message: "Requisition rejected successfully"
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error rejecting requisition:", error);
    res.status(500).json({
      success: false,
      message: "Error rejecting requisition",
      error: error.message
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  createFacilityRequisition,
  getFacilityRequisitionsByFacilityId,
  getAllFacilityRequisitions,
  getFacilityRequisitionById,
  approveFacilityRequisition,
  partialApproveFacilityRequisition,
  rejectFacilityRequisition,
  approveFacilityRequisitionsBulk,
  deleteFacilityRequisition,
  approveRequisitionUnified,
  rejectRequisitionUnified
};