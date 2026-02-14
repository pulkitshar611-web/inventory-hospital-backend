const { pool } = require('../config');

// Super Admin Dashboard
const getSuperAdminDashboard = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    // Total Inventory Items
    const [totalItems] = await connection.query(
      `SELECT COUNT(*) AS total_inventory_items FROM inventory_warehouse`
    );

    // Total Facilities
    const [totalFacilities] = await connection.query(
      `SELECT COUNT(*) AS total_facilities FROM facilities`
    );

    // Pending Requisitions
    const [pendingRequisitions] = await connection.query(
      `SELECT COUNT(*) AS pending_requisitions 
       FROM facility_requisitions 
       WHERE status = 'Pending'`
    );

    // Dispatches Today
    const [dispatchesToday] = await connection.query(
      `SELECT COUNT(*) AS dispatches_today
       FROM facility_requisitions
       WHERE delivered_at IS NOT NULL 
       AND DATE(delivered_at) = CURDATE()`
    );

    // Total Net Worth
    const [totalNetWorth] = await connection.query(
      `SELECT IFNULL(SUM(quantity * item_cost), 0) AS total_net_worth
       FROM inventory_warehouse`
    );

    res.json({
      success: true,
      data: {
        total_inventory_items: totalItems[0].total_inventory_items,
        total_facilities: totalFacilities[0].total_facilities,
        pending_requisitions: pendingRequisitions[0].pending_requisitions,
        dispatches_today: dispatchesToday[0].dispatches_today,
        total_net_worth: totalNetWorth[0].total_net_worth
      }
    });

  } catch (error) {
    console.error('Error fetching superadmin dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching superadmin dashboard',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const getWarehouseAdminDashboard = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    // -------- 1️⃣ TOTAL STOCK --------
    const [totalStockRows] = await connection.query(`
      SELECT 
        COUNT(id) AS total_items,
        SUM(quantity) AS total_quantity,
        SUM(quantity * item_cost) AS total_value
      FROM inventory_warehouse
    `);

    // -------- 2️⃣ LOW STOCK ALERTS --------
    const [lowStockRows] = await connection.query(`
      SELECT 
        id,
        item_name,
        item_code,
        quantity,
        reorder_level,
        unit,
        category
      FROM inventory_warehouse
      WHERE quantity <= reorder_level
    `);

    // -------- 3️⃣ PENDING FACILITY REQUISITIONS (with facility name) --------
    const [pendingReqs] = await connection.query(`
      SELECT 
        fr.id AS requisition_id,
        fr.facility_id,
        f.name AS facility_name,
        fr.priority,
        fr.status,
        fr.remarks,
        fr.created_at,
        COUNT(fri.item_id) AS total_items,
        SUM(fri.quantity) AS total_requested_qty
      FROM facility_requisitions fr
      JOIN facility_requisition_item fri ON fri.requisition_id = fr.id
      JOIN facilities f ON f.id = fr.facility_id
      WHERE fr.status = 'pending'
      GROUP BY fr.id
      ORDER BY fr.created_at DESC
    `);

    // -------- 4️⃣ FACILITY CONSUMPTION TREND (Monthly Last 6 Months, item-wise) --------
    const [consumptionTrend] = await connection.query(`
      SELECT 
        DATE_FORMAT(fr.approved_at, '%Y-%m') AS month,
        fr.facility_id,
        f.name AS facility_name,
        fri.item_id,
        iw.item_name,
        SUM(fri.delivered_quantity) AS total_consumed
      FROM facility_requisitions fr
      JOIN facility_requisition_item fri ON fri.requisition_id = fr.id
      JOIN facilities f ON f.id = fr.facility_id
      JOIN inventory_warehouse iw ON iw.id = fri.item_id
      WHERE fr.status = 'approved' 
        AND fr.approved_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY month, fr.facility_id, fri.item_id
      ORDER BY month ASC, fr.facility_id ASC;
    `);

    // ✅ FINAL RESPONSE
    res.status(200).json({
      success: true,
      data: {
        totalStock: totalStockRows[0],
        lowStock: lowStockRows,
        pendingRequisitions: pendingReqs,
        consumptionTrend,
      },
    });

  } catch (error) {
    console.error("Error fetching warehouse dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching warehouse dashboard data",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const getFacilityAdminDashboard = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const facilityId = req.user.facility_id;

    // 🔹 Step 1: Facility statistics
    const [statsRows] = await connection.execute(`
      SELECT 
        (SELECT COUNT(*) FROM inventory WHERE facility_id = ?) as facility_items,
        (SELECT SUM(quantity) FROM inventory WHERE facility_id = ?) as total_stock,
        (SELECT COUNT(*) FROM inventory WHERE facility_id = ? AND quantity <= reorder_level) as low_stock_items,
        (SELECT COUNT(*) FROM requisitions WHERE facility_id = ? AND status = 'pending') as pending_user_requests,
        (SELECT COUNT(*) FROM requisitions WHERE facility_id = ? AND DATE(created_at) = CURDATE()) as today_requests,
        (SELECT COUNT(*) FROM dispatches WHERE facility_id = ? AND status = 'in_transit') as incoming_dispatches,
        (SELECT COUNT(*) FROM users WHERE facility_id = ? AND status = 'active') as facility_users,
        (SELECT COUNT(*) FROM assets WHERE facility_id = ? AND status = 'active') as facility_assets
    `, [facilityId, facilityId, facilityId, facilityId, facilityId, facilityId, facilityId, facilityId]);

    const stats = statsRows[0] || {};

    // 🔹 Step 2: Pending user requisitions
    const [pendingRequests] = await connection.execute(`
      SELECT r.id, r.priority, r.created_at,
             u.name as user_name, u.department,
             (SELECT COUNT(*) FROM requisition_items WHERE requisition_id = r.id) as item_count,
             (SELECT SUM(quantity) FROM requisition_items WHERE requisition_id = r.id) as total_quantity
      FROM requisitions r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.facility_id = ? AND r.status = 'pending'
      ORDER BY 
        CASE r.priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          ELSE 3 
        END,
        r.created_at ASC
      LIMIT 10
    `, [facilityId]);

    // 🔹 Step 3: Low stock items
    const [lowStockItems] = await connection.execute(`
      SELECT item_code, item_name, category, quantity, reorder_level,
             (reorder_level - quantity) as shortage
      FROM inventory
      WHERE facility_id = ? AND quantity <= reorder_level
      ORDER BY (quantity / NULLIF(reorder_level, 0)) ASC
      LIMIT 10
    `, [facilityId]);

    // 🔹 Step 4: Top requested items (last 30 days)
    const [topRequestedItems] = await connection.execute(`
      SELECT i.item_name, i.category, SUM(ri.quantity) as total_requested,
             COUNT(ri.id) as request_count
      FROM requisition_items ri
      JOIN inventory i ON ri.item_id = i.id
      JOIN requisitions r ON ri.requisition_id = r.id
      WHERE r.facility_id = ? AND DATE(r.created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY i.id, i.item_name, i.category
      ORDER BY total_requested DESC
      LIMIT 5
    `, [facilityId]);

    // 🔹 Step 5: Recent deliveries
    const [recentDeliveries] = await connection.execute(`
      SELECT d.id, d.delivered_at, d.tracking_number,
             (SELECT COUNT(*) FROM requisition_items ri JOIN requisitions r ON ri.requisition_id = r.id WHERE r.id = d.requisition_id) as item_count
      FROM dispatches d
      WHERE d.facility_id = ? AND d.status = 'delivered'
      ORDER BY d.delivered_at DESC
      LIMIT 5
    `, [facilityId]);

    await connection.commit();

    res.status(200).json({
      success: true,
      message: "Facility admin dashboard data fetched successfully",
      data: {
        stats,
        pending_requests: pendingRequests,
        low_stock_items: lowStockItems,
        top_requested_items: topRequestedItems,
        recent_deliveries: recentDeliveries
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Facility admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const getDashboardByFacilityId = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { facility_id } = req.params;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    // 🧮 1️⃣ Total distinct items in this facility
    const [totalItems] = await connection.query(
      `SELECT COUNT(DISTINCT item_id) AS total_items 
       FROM inventory_facility 
       WHERE facility_id = ?`,
      [facility_id]
    );

    // 📦 2️⃣ Total stock quantity in this facility
    const [totalStock] = await connection.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total_stock 
       FROM inventory_facility 
       WHERE facility_id = ?`,
      [facility_id]
    );

    // 🕓 3️⃣ Pending requests (status = 'pending')
    const [pendingRequests] = await connection.query(
      `SELECT COUNT(*) AS pending_requests 
       FROM facility_requisitions 
       WHERE facility_id = ? AND status = 'pending'`,
      [facility_id]
    );

    // ⚠️ 4️⃣ Low stock items (quantity < reorder_level)
    const [lowStockItems] = await connection.query(
      `SELECT COUNT(*) AS low_stock_items 
       FROM inventory_facility 
       WHERE facility_id = ? AND quantity < reorder_level`,
      [facility_id]
    );

    // 📅 5️⃣ Today’s requests
    const [todaysRequests] = await connection.query(
      `SELECT COUNT(*) AS todays_requests 
       FROM facility_requisitions 
       WHERE facility_id = ? AND DATE(created_at) = CURDATE()`,
      [facility_id]
    );

    // 👥 6️⃣ Facility users (only role = 'facility_user')
    const [facilityUsers] = await connection.query(
      `SELECT COUNT(*) AS facility_users 
       FROM users 
       WHERE facility_id = ? AND role = 'facility_user'`,
      [facility_id]
    );

    // ✅ Combine all stats
    const dashboard = {
      total_items: totalItems[0].total_items,
      total_stock: totalStock[0].total_stock,
      pending_requests: pendingRequests[0].pending_requests,
      low_stock_items: lowStockItems[0].low_stock_items,
      todays_requests: todaysRequests[0].todays_requests,
      facility_users: facilityUsers[0].facility_users,
    };

    return res.status(200).json({
      success: true,
      message: "Facility dashboard data fetched successfully",
      data: dashboard,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const getFacilityUserDashboard = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const userId = req.user.id;
    const facilityId = req.user.facility_id;

    // 🔹 Step 1: User statistics
    const [statsRows] = await connection.execute(`
      SELECT 
        (SELECT COUNT(*) FROM requisitions WHERE user_id = ?) as my_total_requests,
        (SELECT COUNT(*) FROM requisitions WHERE user_id = ? AND status = 'pending') as my_pending_requests,
        (SELECT COUNT(*) FROM requisitions WHERE user_id = ? AND status = 'delivered') as my_delivered_requests,
        (SELECT COUNT(*) FROM requisitions WHERE user_id = ? AND DATE(created_at) = CURDATE()) as my_today_requests,
        (SELECT COUNT(*) FROM inventory WHERE facility_id = ?) as available_items
    `, [userId, userId, userId, userId, facilityId]);

    const stats = statsRows[0] || {};

    // 🔹 Step 2: My recent requisitions
    const [myRequisitions] = await connection.execute(`
      SELECT r.id, r.status, r.priority, r.created_at, r.delivered_at,
             (SELECT COUNT(*) FROM requisition_items WHERE requisition_id = r.id) as item_count,
             (SELECT SUM(quantity) FROM requisition_items WHERE requisition_id = r.id) as total_quantity,
             CASE 
               WHEN r.status = 'delivered' THEN DATEDIFF(r.delivered_at, r.created_at)
               ELSE DATEDIFF(NOW(), r.created_at)
             END as processing_days
      FROM requisitions r
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
      LIMIT 10
    `, [userId]);

    // 🔹 Step 3: Available inventory items
    const [availableItems] = await connection.execute(`
      SELECT item_code, item_name, category, quantity, unit,
             CASE WHEN quantity > 0 THEN 'Available' ELSE 'Out of Stock' END as availability
      FROM inventory
      WHERE facility_id = ? AND quantity > 0
      ORDER BY item_name
      LIMIT 20
    `, [facilityId]);

    // 🔹 Step 4: My request statistics by status
    const [statusStats] = await connection.execute(`
      SELECT 
        status,
        COUNT(*) as count,
        AVG(CASE 
          WHEN status = 'delivered' THEN DATEDIFF(delivered_at, created_at)
          ELSE DATEDIFF(NOW(), created_at)
        END) as avg_processing_days
      FROM requisitions
      WHERE user_id = ? AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
      GROUP BY status
      ORDER BY count DESC
    `, [userId]);

    // 🔹 Step 5: Notifications / Alerts
    const [notifications] = await connection.execute(`
      SELECT 
        'requisition' as type,
        CONCAT('Your requisition #', r.id, ' status changed to ', r.status) as message,
        r.updated_at as created_at,
        r.status as status
      FROM requisitions r
      WHERE r.user_id = ? AND r.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      ORDER BY r.updated_at DESC
      LIMIT 5
    `, [userId]);

    await connection.commit();

    res.status(200).json({
      success: true,
      message: 'Facility user dashboard loaded successfully',
      data: {
        stats,
        my_requisitions: myRequisitions,
        available_items: availableItems,
        status_stats: statusStats,
        notifications
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Facility user dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load facility user dashboard data',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const getFacilityUserDashboardUserId = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required",
      });
    }

    // ======================
    // 📊 1. Dashboard Stats
    // ======================
    const [[pendingReqs]] = await connection.query(
      `SELECT COUNT(DISTINCT id) AS total_pending_requests 
       FROM requisitions 
       WHERE user_id = ? 
       AND LOWER(status) IN ('pending','approved')`,
      [user_id]
    );

    const [[deliveredThisWeek]] = await connection.query(
      `SELECT COUNT(*) AS delivered_this_week 
       FROM requisitions 
       WHERE user_id = ? 
       AND LOWER(status) = 'delivered' 
       AND YEARWEEK(delivered_at, 1) = YEARWEEK(CURDATE(), 1)`,
      [user_id]
    );

    const [[lowStockItems]] = await connection.query(
      `SELECT COUNT(*) AS low_stock_items 
       FROM inventory_user 
       WHERE user_id = ? AND quantity <= reorder_level`,
      [user_id]
    );

    const [[totalInventoryItems]] = await connection.query(
      `SELECT COUNT(*) AS total_inventory_items 
       FROM inventory_user 
       WHERE user_id = ?`,
      [user_id]
    );

    // ======================
    // 🕓 2. Pending Requisitions
    // ======================
    const [pendingRequisitions] = await connection.query(
      `SELECT DISTINCT 
          r.id AS requisition_id,
          r.facility_id,
          r.warehouse_id,
          r.status,
          r.priority,
          r.remarks,
          r.created_at
       FROM requisitions r
       JOIN requisition_items ri ON r.id = ri.requisition_id
       WHERE r.user_id = ?
         AND LOWER(r.status) IN ('pending','approved')  -- allow partially approved
         AND (ri.approved_quantity IS NULL OR ri.approved_quantity = 0)
       ORDER BY r.created_at DESC`,
      [user_id]
    );

    for (let reqRow of pendingRequisitions) {
      const [items] = await connection.query(
        `SELECT 
            ri.requisition_id,
            ri.item_id,
            iu.item_name,
            iu.category,
            iu.unit,
            iu.description,
            ri.quantity,
            ri.approved_quantity,
            ri.delivered_quantity,
            ri.priority,
            ri.created_at
         FROM requisition_items ri
         LEFT JOIN inventory_user iu 
           ON ri.item_id = iu.item_id
           AND iu.user_id = ?
         WHERE ri.requisition_id = ?
           AND (ri.approved_quantity IS NULL OR ri.approved_quantity = 0)
         ORDER BY ri.created_at ASC`,
        [user_id, reqRow.requisition_id]
      );
      reqRow.items = items;
    }

    // ======================
    // ✅ 3. Approved Requisitions
    // ======================
    const [approvedRequisitions] = await connection.query(
      `SELECT DISTINCT 
          r.id AS requisition_id,
          r.facility_id,
          r.warehouse_id,
          'approved' AS status,
          r.priority,
          r.remarks,
          r.approved_at,
          r.created_at
       FROM requisitions r
       JOIN requisition_items ri ON r.id = ri.requisition_id
       WHERE r.user_id = ?
         AND (
           LOWER(r.status) = 'approved'
           OR (ri.approved_quantity IS NOT NULL AND ri.approved_quantity > 0)
         )
       ORDER BY r.approved_at DESC, r.created_at DESC`,
      [user_id]
    );

    for (let reqRow of approvedRequisitions) {
      const [items] = await connection.query(
        `SELECT 
            ri.requisition_id,
            ri.item_id,
            iu.item_name,
            iu.category,
            iu.unit,
            iu.description,
            ri.quantity,
            ri.approved_quantity,
            ri.delivered_quantity,
            ri.priority,
            ri.created_at
         FROM requisition_items ri
         LEFT JOIN inventory_user iu 
           ON ri.item_id = iu.item_id
           AND iu.user_id = ?
         WHERE ri.requisition_id = ?
           AND ri.approved_quantity IS NOT NULL
           AND ri.approved_quantity > 0
         ORDER BY ri.created_at ASC`,
        [user_id, reqRow.requisition_id]
      );
      reqRow.items = items;
    }

    // ======================
    // 📤 4. Final Response
    // ======================
    return res.status(200).json({
      success: true,
      message: "User dashboard data fetched successfully",
      data: {
        total_pending_requests: pendingReqs.total_pending_requests || 0,
        delivered_this_week: deliveredThisWeek.delivered_this_week || 0,
        low_stock_items: lowStockItems.low_stock_items || 0,
        total_inventory_items: totalInventoryItems.total_inventory_items || 0,
        my_pending_requests: pendingRequisitions,
        my_approved_requests: approvedRequisitions,
      },
    });
  } catch (error) {
    console.error("❌ Error in getFacilityUserDashboardUserId:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};







module.exports = {
  getSuperAdminDashboard,
  getWarehouseAdminDashboard,
  getFacilityAdminDashboard,
  getFacilityUserDashboard,
  getFacilityUserDashboardUserId,
  getDashboardByFacilityId,
};