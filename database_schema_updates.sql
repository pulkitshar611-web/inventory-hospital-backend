-- =====================================================
-- SUPPLIER & BATCH MANAGEMENT DATABASE SCHEMA UPDATES
-- =====================================================

-- IMPORTANT: Select your database first!
-- Replace 'railway' with your actual database name
USE `railway`;

-- If your database name is different, change it above
-- Common database names: railway, hospital_inventory, hospital_inventory_db

-- =====================================================

-- 1. Add supplier_code to suppliers table (if not exists)
-- Note: Run this only if column doesn't exist, or ignore error if it already exists
ALTER TABLE `suppliers` 
ADD COLUMN `supplier_code` VARCHAR(50) UNIQUE DEFAULT NULL COMMENT 'Auto-generated supplier code' AFTER `id`;

-- 2. Create supplier_item_mapping table
CREATE TABLE IF NOT EXISTS `supplier_item_mapping` (
  `id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int NOT NULL,
  `item_id` int DEFAULT NULL COMMENT 'Item ID from inventory_warehouse',
  `item_name` varchar(255) NOT NULL,
  `item_category` varchar(100) DEFAULT NULL,
  `item_code` varchar(50) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `item_id` (`item_id`),
  KEY `status` (`status`),
  CONSTRAINT `supplier_item_mapping_ibfk_1` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3. Create supplier_history table
CREATE TABLE IF NOT EXISTS `supplier_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `supplier_id` int NOT NULL,
  `item_id` int DEFAULT NULL,
  `item_name` varchar(255) NOT NULL,
  `transaction_type` enum('purchase','stock_received','return','adjustment') NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `batch_number` varchar(100) DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `unit_price` decimal(10,2) DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT NULL,
  `purchase_order_number` varchar(100) DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `remarks` text,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `supplier_id` (`supplier_id`),
  KEY `item_id` (`item_id`),
  KEY `transaction_type` (`transaction_type`),
  KEY `received_date` (`received_date`),
  CONSTRAINT `supplier_history_ibfk_1` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 4. Create inventory_batches table for batch-level tracking
CREATE TABLE IF NOT EXISTS `inventory_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL COMMENT 'Item ID from inventory_warehouse',
  `batch_number` varchar(100) NOT NULL,
  `expiry_date` date NOT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '0.00',
  `available_quantity` decimal(10,2) NOT NULL DEFAULT '0.00',
  `supplier_id` int DEFAULT NULL,
  `received_date` date DEFAULT NULL,
  `location` enum('warehouse','facility') DEFAULT 'warehouse',
  `facility_id` int DEFAULT NULL COMMENT 'If location is facility',
  `status` enum('active','near_expiry','expired','recalled','blocked') DEFAULT 'active',
  `recalled_at` timestamp NULL DEFAULT NULL,
  `recalled_by` int DEFAULT NULL,
  `recall_reason` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_batch_item` (`item_id`, `batch_number`, `location`, `facility_id`),
  KEY `item_id` (`item_id`),
  KEY `batch_number` (`batch_number`),
  KEY `expiry_date` (`expiry_date`),
  KEY `status` (`status`),
  KEY `supplier_id` (`supplier_id`),
  KEY `facility_id` (`facility_id`),
  CONSTRAINT `inventory_batches_ibfk_1` FOREIGN KEY (`item_id`) REFERENCES `inventory_warehouse` (`id`) ON DELETE CASCADE,
  CONSTRAINT `inventory_batches_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `inventory_batches_ibfk_3` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 5. Create batch_movements table for audit trail
CREATE TABLE IF NOT EXISTS `batch_movements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` int NOT NULL,
  `movement_type` enum('received','dispatched','issued','returned','expired','recalled','adjusted') NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `from_location` enum('warehouse','facility') DEFAULT NULL,
  `to_location` enum('warehouse','facility') DEFAULT NULL,
  `facility_id` int DEFAULT NULL,
  `requisition_id` int DEFAULT NULL,
  `dispatch_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `remarks` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `batch_id` (`batch_id`),
  KEY `movement_type` (`movement_type`),
  KEY `created_at` (`created_at`),
  CONSTRAINT `batch_movements_ibfk_1` FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 6. Add indexes for better performance
-- Note: Run these only if indexes don't exist, or ignore error if they already exist
CREATE INDEX `idx_supplier_code` ON `suppliers` (`supplier_code`);
CREATE INDEX `idx_batch_expiry` ON `inventory_batches` (`expiry_date`, `status`);
CREATE INDEX `idx_batch_item_status` ON `inventory_batches` (`item_id`, `status`);


-- 7. Incoming Goods
CREATE TABLE IF NOT EXISTS `incoming_goods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `requisition_id` int NOT NULL,
  `facility_id` int NOT NULL,
  `dispatch_id` int NOT NULL,
  `item_id` int NOT NULL,
  `item_name` varchar(255) DEFAULT NULL,
  `quantity_dispatched` decimal(10,2) DEFAULT '0.00',
  `quantity_received` decimal(10,2) DEFAULT '0.00',
  `status` varchar(50) DEFAULT 'pending',
  `received_by` int DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `remarks` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_incoming_dispatch` (`dispatch_id`),
  KEY `idx_incoming_facility` (`facility_id`),
  KEY `idx_incoming_requisition` (`requisition_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 8. Notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `facility_id` int DEFAULT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `related_id` int DEFAULT NULL,
  `related_type` varchar(50) DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `read_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `facility_id` (`facility_id`),
  KEY `is_read` (`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

