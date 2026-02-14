const Joi = require('joi');

// Generic validation middleware
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      });
    }
    next();
  };
};

// User validation schemas
const userSchemas = {
  register: Joi.object({
    name: Joi.any(),
    email: Joi.any(),
    password: Joi.any(),
    role: Joi.string().valid('super_admin', 'warehouse_admin', 'facility_admin', 'facility_user').required(),
    facility_id: Joi.number().integer().when('role', {
      is: Joi.string().valid('facility_admin', 'facility_user'),
      then: Joi.required(),
      otherwise: Joi.any().optional(),
    }),
    facility_admin_id: Joi.any(),
    phone: Joi.any().optional(),
    department: Joi.string().optional(),
  }),

  login: Joi.object({
    email: Joi.any(),
    password: Joi.any(),
  }),

  update: Joi.object({
    name: Joi.any().optional(),
    phone: Joi.any().optional(),
    email: Joi.any(),
    role: Joi.string().valid('super_admin', 'warehouse_admin', 'facility_admin', 'facility_user').required(),
    password: Joi.any(),
    facility_admin_id: Joi.any(),
    department: Joi.any().optional(),
    status: Joi.string().valid('active', 'inactive').optional()
  })
};

// Facility validation schemas
const facilitySchemas = {
  create: Joi.object({
    name: Joi.any(),
    location: Joi.any(),
    type: Joi.any(),
    contact_person: Joi.any().optional(),
    phone: Joi.any().optional(),
    email: Joi.string().email().optional(),
    address: Joi.string().optional()
  }),

  update: Joi.object({
    name: Joi.any().optional(),
    location: Joi.any().optional(),
    type: Joi.any().optional(),
    contact_person: Joi.any().optional(),
    phone: Joi.any().optional(),
    email: Joi.string().email().optional(),
    address: Joi.any().optional(),
    status: Joi.string().valid('active', 'inactive').optional()
  })
};

// Inventory validation schemas
const inventorySchemas = {
  create: Joi.object({
    item_code: Joi.any(),
    item_name: Joi.any(),
    item_cost: Joi.any(),
    category: Joi.any(),
    description: Joi.any().optional(),
    unit: Joi.any(),
    reorder_level: Joi.any().optional(),
    facility_id: Joi.any().optional(),
    quantity: Joi.any().optional(),
    standard_cost: Joi.any().optional(),
    moving_avg_cost: Joi.any().optional(), 
    last_po_cost: Joi.any().optional(), 
    batch_no: Joi.any().optional(),
    expiry_date: Joi.any().optional(),
    manufacturer: Joi.any().optional(),
    supplier: Joi.any().optional(),
    location: Joi.any().optional(),
    remarks: Joi.any().optional(),
    abc_class: Joi.any().optional(),
    facility_transfer_price: Joi.any().optional()
  }),

  update: Joi.object({
    item_name: Joi.any().optional(),
    category: Joi.any().optional(),
    description: Joi.any().optional(),
    unit: Joi.any().optional(),
    quantity: Joi.any().optional(),
    reorder_level: Joi.any().optional(),
    item_cost: Joi.any(),
    expiry_date: Joi.any().optional(),
  }),

  stock: Joi.object({
    quantity: Joi.any().optional(),
    type: Joi.string().valid('add', 'subtract', 'set').required(),
    remarks: Joi.string().optional()
  })
};

// Requisition validation schemas
const   requisitionSchemas = {
  create: Joi.object({
    items: Joi.array().items(
      Joi.object({
        item_id: Joi.any().optional(),
        quantity: Joi.any().optional(),
        priority: Joi.string()
          .valid('normal', 'high', 'urgent')
          .default('normal')
          .optional(),
        estimated_usage_duration: Joi.number().integer().min(1).optional().allow(null)
      })
    ).min(1).required(),

    // 👇 ye line add karo
    priority: Joi.string()
      .valid('normal', 'high', 'urgent')    
      .default('normal')
      .optional(),

    remarks: Joi.any().optional(),
    facility_id: Joi.any().optional(),
    user_id: Joi.number().optional(),
    estimated_usage_duration: Joi.number().integer().min(1).optional(),
  }),

  update: Joi.object({
    status: Joi.string()
      .valid('pending', 'processing', 'approved', 'rejected', 'dispatched', 'delivered', 'completed')
      .optional(),
    remarks: Joi.any().optional(),
    approved_quantity: Joi.any().optional(),
    priority: Joi.string()
      .valid('normal', 'high', 'urgent')
      .optional(),
    estimated_usage_duration: Joi.number().integer().min(1).optional().allow(null)
  })
};


// Asset validation schemas
const assetSchemas = {
  create: Joi.object({
    name: Joi.string().required(),
    type: Joi.string().required(),
    serial_number: Joi.any().optional(),
    model: Joi.any().optional(),
    manufacturer: Joi.any().optional(),
    purchase_date: Joi.date().optional(),
    warranty_expiry: Joi.date().optional(),
    assigned_to: Joi.number().integer().optional(),
    facility_id: Joi.number().integer().optional(),
    department: Joi.string().optional()
  }),

  update: Joi.object({
    name: Joi.any().optional(),
    type: Joi.any().optional(),
    serial_number: Joi.any().optional(),
    model: Joi.any().optional(),
    manufacturer: Joi.any().optional(),
    purchase_date: Joi.date().optional(),
    warranty_expiry: Joi.date().optional(),
    assigned_to: Joi.any().optional(),
    department: Joi.any().optional(),
    status: Joi.string().valid('active', 'maintenance', 'retired').optional()
  })
};

module.exports = {
  validate,
  userSchemas,
  facilitySchemas,
  inventorySchemas,
  requisitionSchemas,
  assetSchemas
};