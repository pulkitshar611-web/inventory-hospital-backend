const { pool } = require('../config');

// Get all departments
const getDepartments = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM department');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

const getDepartmentsByFacilityId = async (req, res) => {
  const { facility_id } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT 
        d.id,
        d.department_name,
        d.description,
        d.facility_id,
        f.facility_name
      FROM department d
      LEFT JOIN facilities f ON d.facility_id = f.id
      WHERE d.facility_id = ?
      `,
      [facility_id]
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error('Error fetching departments by facility:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
    });
  }
};

// Get a single department by ID
const getDepartmentById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM department WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Department not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Create a new department
const createDepartment = async (req, res) => {
  const { department_name, department_head } = req.body;
//   if (!name || !head) return res.status(400).json({ success: false, message: 'All fields are required' });

  try {
    const [result] = await pool.query('INSERT INTO department (department_name, department_head) VALUES (?, ?)', [department_name, department_head]);
    res.json({ success: true, message: 'Department created', id: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Update a department
const updateDepartment = async (req, res) => {
  const { id } = req.params;
  const { department_name, department_head } = req.body;
  try {
    const [result] = await pool.query('UPDATE department SET department_name = ?, department_head = ? WHERE id = ?', [department_name, department_head, id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Department not found' });
    res.json({ success: true, message: 'Department updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Delete a department
const deleteDepartment = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM department WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Department not found' });
    res.json({ success: true, message: 'Department deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

module.exports = {
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentsByFacilityId
};
