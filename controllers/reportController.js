const { pool } = require('../config');

// Get stock report
const getStockReport = async (req, res) => {
  try {
    const { facility_id, category, date_from, date_to, format = 'json' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Role-based access control
    // if (req.user.role === 'facility_admin' || req.user.role === 'facility_user') {
    //   whereConditions.push('i.facility_id = ?');
    //   queryParams.push(req.user.facility_id);
    // } else if (facility_id) {
    //   whereConditions.push('i.facility_id = ?');
    //   queryParams.push(facility_id);
    // }

    if (category) {
      whereConditions.push('i.category = ?');
      queryParams.push(category);
    }

    if (date_from) {
      whereConditions.push('DATE(i.created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(i.created_at) <= ?');
      queryParams.push(date_to);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get stock report data
    const [stockData] = await pool.execute(
      `SELECT i.*, f.name as facility_name, f.location as facility_location,
              CASE WHEN i.quantity <= i.reorder_level THEN 'Low Stock' ELSE 'Normal' END as stock_status,
              (SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.inventory_id = i.id AND sm.type = 'add' AND DATE(sm.created_at) >= COALESCE(?, '1900-01-01')) as stock_in,
              (SELECT SUM(sm.quantity) FROM stock_movements sm WHERE sm.inventory_id = i.id AND sm.type = 'subtract' AND DATE(sm.created_at) >= COALESCE(?, '1900-01-01')) as stock_out
       FROM inventory i
       LEFT JOIN facilities f ON i.facility_id = f.id
       WHERE ${whereClause}
       ORDER BY i.facility_id, i.category, i.item_name`,
      [...queryParams, date_from || null, date_from || null]
    );

    // Get summary statistics
    const [summary] = await pool.execute(
      `SELECT 
        COUNT(*) as total_items,
        SUM(i.quantity) as total_quantity,
        COUNT(CASE WHEN i.quantity <= i.reorder_level THEN 1 END) as low_stock_items,
        COUNT(DISTINCT i.facility_id) as facilities_count,
        COUNT(DISTINCT i.category) as categories_count
       FROM inventory i
       WHERE ${whereClause}`,
      queryParams
    );

    res.json({
      success: true,
      data: {
        summary: summary[0],
        items: stockData,
        generated_at: new Date().toISOString(),
        filters: {
          facility_id,
          category,
          date_from,
          date_to
        }
      }
    });
  } catch (error) {
    console.error('Get stock report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate stock report',
      error: error.message
    });
  }
};

// Get requisition report
const getRequisitionReport = async (req, res) => {
  try {
    const { facility_id, status, user_id, date_from, date_to, priority } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Role-based access control
    // if (req.user.role === 'facility_admin') {
    //   whereConditions.push('r.facility_id = ?');
    //   queryParams.push(req.user.facility_id);
    // } else if (req.user.role === 'facility_user') {
    //   whereConditions.push('r.user_id = ?');
    //   queryParams.push(req.user.id);
    // }

    // Apply filters
    if (facility_id && req.user.role === 'super_admin') {
      whereConditions.push('r.facility_id = ?');
      queryParams.push(facility_id);
    }

    if (status) {
      whereConditions.push('r.status = ?');
      queryParams.push(status);
    }

    // if (user_id && (req.user.role === 'super_admin' || req.user.role === 'facility_admin')) {
    //   whereConditions.push('r.user_id = ?');
    //   queryParams.push(user_id);
    // }

    if (priority) {
      whereConditions.push('r.priority = ?');
      queryParams.push(priority);
    }

    if (date_from) {
      whereConditions.push('DATE(r.created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(r.created_at) <= ?');
      queryParams.push(date_to);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get requisition report data
    const [requisitionData] = await pool.execute(
      `SELECT r.*, 
              u.name as user_name, u.email as user_email,
              f.name as facility_name, f.location as facility_location,
              (SELECT COUNT(*) FROM requisition_items WHERE requisition_id = r.id) as item_count,
              (SELECT SUM(quantity) FROM requisition_items WHERE requisition_id = r.id) as total_quantity,
              DATEDIFF(COALESCE(r.delivered_at, NOW()), r.created_at) as processing_days
       FROM requisitions r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN facilities f ON r.facility_id = f.id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC`,
      queryParams
    );

    // Get summary statistics
    const [summary] = await pool.execute(
      `SELECT 
        COUNT(*) as total_requisitions,
        COUNT(CASE WHEN r.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN r.status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN r.status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN r.status = 'rejected' THEN 1 END) as rejected_count,
        AVG(DATEDIFF(COALESCE(r.delivered_at, NOW()), r.created_at)) as avg_processing_days,
        COUNT(CASE WHEN r.priority = 'urgent' THEN 1 END) as urgent_count
       FROM requisitions r
       WHERE ${whereClause}`,
      queryParams
    );

    res.json({
      success: true,
      data: {
        summary: summary[0],
        requisitions: requisitionData,
        generated_at: new Date().toISOString(),
        filters: {
          facility_id,
          status,
          user_id,
          priority,
          date_from,
          date_to
        }
      }
    });
  } catch (error) {
    console.error('Get requisition report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate requisition report',
      error: error.message
    });
  }
};

// Get facility usage report
const getFacilityUsageReport = async (req, res) => {
  try {
    const { facility_id, date_from, date_to } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Role-based access control
    // if (req.user.role === 'facility_admin') {
    //   whereConditions.push('f.id = ?');
    //   queryParams.push(req.user.facility_id);
    // } else if (facility_id) {
    //   whereConditions.push('f.id = ?');
    //   queryParams.push(facility_id);
    // }

    if (date_from) {
      whereConditions.push('DATE(r.created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(r.created_at) <= ?');
      queryParams.push(date_to);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get facility usage data
    const [facilityData] = await pool.execute(
      `SELECT f.id, f.name, f.location, f.type,
              COUNT(DISTINCT u.id) as user_count,
              COUNT(DISTINCT i.id) as inventory_count,
              SUM(i.quantity) as total_stock,
              COUNT(DISTINCT r.id) as requisition_count,
              COUNT(CASE WHEN r.status = 'delivered' THEN 1 END) as delivered_requisitions,
              COUNT(DISTINCT a.id) as asset_count,
              AVG(DATEDIFF(COALESCE(r.delivered_at, NOW()), r.created_at)) as avg_fulfillment_time
       FROM facilities f
       LEFT JOIN users u ON f.id = u.facility_id AND u.status = 'active'
       LEFT JOIN inventory i ON f.id = i.facility_id
       LEFT JOIN requisitions r ON f.id = r.facility_id
       LEFT JOIN assets a ON f.id = a.facility_id AND a.status = 'active'
       WHERE ${whereClause}
       GROUP BY f.id, f.name, f.location, f.type
       ORDER BY f.name`,
      queryParams
    );

    // Get top requested items per facility
    for (let facility of facilityData) {
      const [topItems] = await pool.execute(
        `SELECT i.item_name, i.category, SUM(ri.quantity) as total_requested
         FROM requisition_items ri
         JOIN inventory i ON ri.item_id = i.id
         JOIN requisitions r ON ri.requisition_id = r.id
         WHERE r.facility_id = ? AND DATE(r.created_at) >= COALESCE(?, '1900-01-01') AND DATE(r.created_at) <= COALESCE(?, '2100-12-31')
         GROUP BY i.id, i.item_name, i.category
         ORDER BY total_requested DESC
         LIMIT 5`,
        [facility.id, date_from || null, date_to || null]
      );
      facility.top_requested_items = topItems;
    }

    res.json({
      success: true,
      data: {
        facilities: facilityData,
        generated_at: new Date().toISOString(),
        filters: {
          facility_id,
          date_from,
          date_to
        }
      }
    });
  } catch (error) {
    console.error('Get facility usage report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate facility usage report',
      error: error.message
    });
  }
};

// Get asset report
const getAssetReport = async (req, res) => {
  try {
    const { facility_id, type, status = 'active', assigned_to } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    // Role-based access control
    // if (req.user.role === 'facility_admin' || req.user.role === 'facility_user') {
    //   whereConditions.push('a.facility_id = ?');
    //   queryParams.push(req.user.facility_id);
    // } else if (req.user.role === 'warehouse_admin') {
    //   whereConditions.push('a.facility_id IS NULL');
    // }

    // Apply filters
    if (facility_id && req.user.role === 'super_admin') {
      whereConditions.push('a.facility_id = ?');
      queryParams.push(facility_id);
    }

    if (type) {
      whereConditions.push('a.type = ?');
      queryParams.push(type);
    }

    if (status) {
      whereConditions.push('a.status = ?');
      queryParams.push(status);
    }

    if (assigned_to) {
      whereConditions.push('a.assigned_to = ?');
      queryParams.push(assigned_to);
    }

    const whereClause = whereConditions.join(' AND ');

    // Get asset report data
    const [assetData] = await pool.execute(
      `SELECT a.*, 
              f.name as facility_name, f.location as facility_location,
              u.name as assigned_to_name, u.email as assigned_to_email,
              CASE 
                WHEN a.warranty_expiry IS NOT NULL AND a.warranty_expiry < NOW() THEN 'Expired'
                WHEN a.warranty_expiry IS NOT NULL AND a.warranty_expiry < DATE_ADD(NOW(), INTERVAL 30 DAY) THEN 'Expiring Soon'
                ELSE 'Valid'
              END as warranty_status,
              DATEDIFF(NOW(), a.purchase_date) as age_days
       FROM assets a
       LEFT JOIN facilities f ON a.facility_id = f.id
       LEFT JOIN users u ON a.assigned_to = u.id
       WHERE ${whereClause}
       ORDER BY a.facility_id, a.type, a.name`,
      queryParams
    );

    // Get summary statistics
    const [summary] = await pool.execute(
      `SELECT 
        COUNT(*) as total_assets,
        COUNT(CASE WHEN a.status = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN a.status = 'maintenance' THEN 1 END) as maintenance_count,
        COUNT(CASE WHEN a.status = 'retired' THEN 1 END) as retired_count,
        COUNT(CASE WHEN a.assigned_to IS NOT NULL THEN 1 END) as assigned_count,
        COUNT(CASE WHEN a.warranty_expiry < NOW() THEN 1 END) as expired_warranty_count,
        COUNT(DISTINCT a.type) as asset_types_count,
        COUNT(DISTINCT a.facility_id) as facilities_count
       FROM assets a
       WHERE ${whereClause}`,
      queryParams
    );

    res.json({
      success: true,
      data: {
        summary: summary[0],
        assets: assetData,
        generated_at: new Date().toISOString(),
        filters: {
          facility_id,
          type,
          status,
          assigned_to
        }
      }
    });
  } catch (error) {
    console.error('Get asset report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate asset report',
      error: error.message
    });
  }
};

const getFacilityReports = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { facility_id } = req.params;
    const { from_date, to_date } = req.query;

    if (!facility_id) {
      return res.status(400).json({
        success: false,
        message: "facility_id is required",
      });
    }

    // 🗓️ Date Filter Logic
    let dateFilter = "";
    const params = [facility_id];

    if (from_date && to_date) {
      dateFilter = "AND DATE(created_at) BETWEEN ? AND ?";
      params.push(from_date, to_date);
    } else if (from_date) {
      dateFilter = "AND DATE(created_at) >= ?";
      params.push(from_date);
    } else if (to_date) {
      dateFilter = "AND DATE(created_at) <= ?";
      params.push(to_date);
    }

    // 1️⃣ Low Stock Items (with full item info)
    const [lowStockItems] = await connection.query(
      `SELECT 
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
          created_at
       FROM inventory_facility
       WHERE facility_id = ?
         AND quantity <= reorder_level
       ${dateFilter}
       ORDER BY quantity ASC`,
      params
    );

    // 2️⃣ Total Stock (summary + full items)
    const [stockItems] = await connection.query(
      `SELECT 
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
          created_at
       FROM inventory_facility
       WHERE facility_id = ?
       ${dateFilter}
       ORDER BY item_name ASC`,
      params
    );

    const totalStockSummary = {
      total_items: stockItems.length,
      total_quantity: stockItems.reduce((sum, i) => sum + (i.quantity || 0), 0),
      total_value: stockItems.reduce((sum, i) => sum + (i.quantity * (i.item_cost || 0)), 0),
    };

    // 3️⃣ Pending Requisitions (with items)
    const [pendingRequisitions] = await connection.query(
      `SELECT 
          id AS requisition_id,
          facility_id,
          user_id,
          status,
          priority,
          remarks,
          created_at
       FROM requisitions
       WHERE facility_id = ?
         AND LOWER(status) = 'pending'
       ${dateFilter}
       ORDER BY created_at DESC`,
      params
    );

    for (let reqRow of pendingRequisitions) {
      const [items] = await connection.query(
        `SELECT 
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
         LEFT JOIN inventory_facility iu ON ri.item_id = iu.item_id AND iu.facility_id = ?
         WHERE ri.requisition_id = ?
         ORDER BY ri.created_at ASC`,
        [facility_id, reqRow.requisition_id]
      );
      reqRow.items = items;
    }

    // 4️⃣ Approved Requisitions (with items)
    const [approvedRequisitions] = await connection.query(
      `SELECT 
          id AS requisition_id,
          facility_id,
          user_id,
          status,
          priority,
          remarks,
          created_at,
          approved_at
       FROM requisitions
       WHERE facility_id = ?
         AND LOWER(status) = 'approved'
       ${dateFilter}
       ORDER BY created_at DESC`,
      params
    );

    for (let reqRow of approvedRequisitions) {
      const [items] = await connection.query(
        `SELECT 
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
         LEFT JOIN inventory_facility iu ON ri.item_id = iu.item_id AND iu.facility_id = ?
         WHERE ri.requisition_id = ?
         ORDER BY ri.created_at ASC`,
        [facility_id, reqRow.requisition_id]
      );
      reqRow.items = items;
    }

    // ✅ Final Response
    return res.status(200).json({
      success: true,
      message: "Facility reports fetched successfully",
      filters: { from_date: from_date || null, to_date: to_date || null },
      data: {
        facility_id,
        total_stock_summary: totalStockSummary,
        total_stock_items: stockItems,
        low_stock_items: lowStockItems,
        pending_requisitions: pendingRequisitions,
        approved_requisitions: approvedRequisitions,
      },
    });
  } catch (error) {
    console.error("❌ Error in getFacilityReports:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// Export report (placeholder for future CSV/PDF export functionality)
const exportReport = async (req, res) => {
  try {
    const { type } = req.params;
    const { format = 'csv' } = req.query;

    // This is a placeholder for export functionality
    // In a real implementation, you would generate CSV/PDF files here

    res.json({
      success: true,
      message: `Export functionality for ${type} reports in ${format} format is not yet implemented`,
      data: {
        type,
        format,
        note: 'This endpoint will be implemented to generate downloadable reports'
      }
    });
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export report',
      error: error.message
    });
  }
};

module.exports = {
  getStockReport,
  getRequisitionReport,
  getFacilityUsageReport,
  getAssetReport,
  exportReport,
  getFacilityReports
};