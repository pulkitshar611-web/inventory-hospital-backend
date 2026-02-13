const bcrypt = require('bcryptjs');
const { pool } = require('../config');

// Get all users (with filtering and pagination)
// const getUsers = async (req, res) => {
//   try {
//     const { 
//       page = 1, 
//       limit = 10, 
//       role, 
//       facility_id, 
//       status = 'active',
//       search 
//     } = req.query;

//     const offset = (page - 1) * limit;
//     let whereConditions = ['1=1'];
//     let queryParams = [];

//     // Role-based access control
//     // if (req.user.role === 'facility_admin') {
//     //   whereConditions.push('u.facility_id = ?');
//     //   queryParams.push(req.user.facility_id);
//     // } else if (req.user.role === 'facility_user') {
//     //   whereConditions.push('u.facility_id = ? AND u.id = ?');
//     //   queryParams.push(req.user.facility_id, req.user.id);
//     // }

//     // Apply filters
//     if (role) {
//       whereConditions.push('u.role = ?');
//       queryParams.push(role);
//     }

//     if (facility_id && req.user.role === 'super_admin') {
//       whereConditions.push('u.facility_id = ?');
//       queryParams.push(facility_id);
//     }

//     if (status) {
//       whereConditions.push('u.status = ?');
//       queryParams.push(status);
//     }

//     if (search) {
//       whereConditions.push('(u.name LIKE ? OR u.email LIKE ?)');
//       queryParams.push(`%${search}%`, `%${search}%`);
//     }

//     const whereClause = whereConditions.join(' AND ');

//     // Get total count
//     const [countResult] = await pool.execute(
//       `SELECT COUNT(*) as total FROM users u WHERE ${whereClause}`,
//       queryParams
//     );

//     // Get users
//     const [users] = await pool.execute(
//       `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.phone, u.department, u.status, u.created_at, u.last_login,
//               f.name as facility_name, f.location as facility_location
//        FROM users u
//        LEFT JOIN facilities f ON u.facility_id = f.id
//        WHERE ${whereClause}
//        ORDER BY u.created_at DESC
//        LIMIT ? OFFSET ?`,
//       [...queryParams, parseInt(limit), parseInt(offset)]
//     );

//     const total = countResult[0].total;
//     const totalPages = Math.ceil(total / limit);

//     res.json({
//       success: true,
//       data: {
//         users,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages,
//           totalItems: total,
//           itemsPerPage: parseInt(limit)
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Get users error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get users',
//       error: error.message
//     });
//   }
// };




const getUsers = async (req, res) => {
  try {
    const { role, facility_id, status = 'active', search } = req.query;

    let whereConditions = [];
    let queryParams = [];

    // Apply filters
    if (role) {
      whereConditions.push('u.role = ?');
      queryParams.push(role);
    }

    if (facility_id) {
      whereConditions.push('u.facility_id = ?');
      queryParams.push(facility_id);
    }

    if (status) {
      whereConditions.push('u.status = ?');
      queryParams.push(status);
    }

    if (search) {
      whereConditions.push('(u.name LIKE ? OR u.email LIKE ?)');
      queryParams.push(`%${search}%`);
      queryParams.push(`%${search}%`);
    }

    // Build WHERE clause
    const whereClause = whereConditions.length > 0 ? whereConditions.join(' AND ') : '1=1';

    // ✅ Get users (no LIMIT, no OFFSET)
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.phone, u.department, 
              u.status, u.created_at, u.last_login,
              f.name as facility_name, f.location as facility_location
       FROM users u
       LEFT JOIN facilities f ON u.facility_id = f.id
       WHERE ${whereClause}
       ORDER BY u.created_at DESC`,
      queryParams
    );

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message
    });
  }
};




// Get user by ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Check access permissions
    if (req.user.role === 'facility_user' && req.user.id != id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    let query = `
      SELECT u.id, u.name, u.email, u.role, u.facility_id, u.phone, u.department, u.status, u.created_at, u.last_login,
             f.name as facility_name, f.location as facility_location
      FROM users u
      LEFT JOIN facilities f ON u.facility_id = f.id
      WHERE u.id = ?
    `;

    const queryParams = [id];

    // Facility admin can only see users from their facility
    // if (req.user.role === 'facility_admin') {
    //   query += ' AND u.facility_id = ?';
    //   queryParams.push(req.user.facility_id);
    // }

    const [users] = await pool.execute(query, queryParams);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: users[0]
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: error.message
    });
  }
};

// Create user
const createUser = async (req, res) => {
  try {
    const { name, email, password, role, facility_id, facility_admin_id, phone, department } = req.body;

   

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user
    const [result] = await pool.execute(
      `INSERT INTO users (name, email, password, role, facility_id, facility_admin_id, phone, department, status, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?,?, 'active', NOW())`,
      [name, email, hashedPassword, role, facility_id || null, facility_admin_id || null, phone || null, department || null]
    );

    // Get created user
    // const [users] = await pool.execute(
    //   `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.facility_admin_id, u.phone, u.department, u.status, u.created_at,
    //           f.name as facility_name
    //    FROM users u
    //    LEFT JOIN facilities f ON u.facility_id = f.id
    //    WHERE u.id = ?`,
    //   [result.insertId]
    // );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      // data: users[0]
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message
    });
  }
};

// Update user
// const updateUser = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { name, phone, department, status } = req.body;


//     // Update user
//     await pool.execute(
//       'UPDATE users SET name = ?, phone = ?, department = ?, status = ?, updated_at = NOW() WHERE id = ?',
//       [name, phone, department, status, id]
//     );

//     // Get updated user
//     const [users] = await pool.execute(
//       `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.phone, u.department, u.status,
//               f.name as facility_name
//        FROM users u
//        LEFT JOIN facilities f ON u.facility_id = f.id
//        WHERE u.id = ?`,
//       [id]
//     );

//     if (users.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     res.json({
//       success: true,
//       message: 'User updated successfully',
//       data: users[0]
//     });
//   } catch (error) {
//     console.error('Update user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update user',
//       error: error.message
//     });
//   }
// };


const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      department,
      role,
      facility_id,
      facility_admin_id,
      status
    } = req.body;

    // Build dynamic update fields
    const fields = [];
    const values = [];

    if (name !== undefined) {
      fields.push("name = ?");
      values.push(name);
    }
    if (email !== undefined) {
      fields.push("email = ?");
      values.push(email);
    }
    if (phone !== undefined) {
      fields.push("phone = ?");
      values.push(phone);
    }
    if (department !== undefined) {
      fields.push("department = ?");
      values.push(department);
    }
    if (role !== undefined) {
      fields.push("role = ?");
      values.push(role);
    }
    if (facility_id !== undefined) {
      fields.push("facility_id = ?");
      values.push(facility_id);
    }
    if (facility_admin_id !== undefined) {
      fields.push("facility_admin_id = ?");
      values.push(facility_admin_id);
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update"
      });
    }

    fields.push("updated_at = NOW()");
    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const [result] = await pool.execute(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get updated user
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role, u.facility_id, u.facility_admin_id, u.phone, u.department, u.status, u.updated_at,
              f.name as facility_name
       FROM users u
       LEFT JOIN facilities f ON u.facility_id = f.id
       WHERE u.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: "User updated successfully",
      data: users[0]
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: error.message
    });
  }
};







// Delete user (soft delete)
// const deleteUser = async (req, res) => {
//   try {
//     const { id } = req.params;

   
//     if (req.user.id == id) {
//       return res.status(400).json({
//         success: false,
//         message: 'Cannot delete your own account'
//       });
//     }

//     // Soft delete user
//     const [result] = await pool.execute(
//       'UPDATE users SET status = "deleted", updated_at = NOW() WHERE id = ?',
//       [id]
//     );

//     if (result.affectedRows === 0) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found'
//       });
//     }

//     res.json({
//       success: true,
//       message: 'User deleted successfully'
//     });
//   } catch (error) {
//     console.error('Delete user error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to delete user',
//       error: error.message
//     });
//   }
// };


const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'users not found' });
    res.json({ success: true, message: 'users deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};





const getFacilityAdminsByFacility = async (req, res) => {
  try {
    const { facilityId } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, department, status FROM users WHERE role = "facility_admin" AND facility_id = ?',
      [facilityId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching facility admins:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


const getFacilityUsersByFacility = async (req, res) => {
  try {
    const { facilityId } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, department, status FROM users WHERE role = "facility_user" AND facility_id = ?',
      [facilityId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching facility users:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


const getUsersByFacilityAdmin = async (req, res) => {
  try {
    const { facilityAdminId } = req.params;

    const [rows] = await pool.execute(
      `SELECT 
         u.id, 
         u.name, 
         u.email, 
         u.phone, 
         u.department AS department_id, 
         d.department_name AS department_name, 
         u.status
       FROM users u
       LEFT JOIN department d ON u.department = d.id
       WHERE u.role = 'facility_user' AND u.facility_admin_id = ?`,
      [facilityAdminId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching users by facility admin:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};







module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getFacilityAdminsByFacility,
  getFacilityUsersByFacility,
  getUsersByFacilityAdmin
};
