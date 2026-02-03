const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const { generateApplicationNo } = require('../utils/idGenerator');

const Application = sequelize.define('Application', {
  application_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'applicant_master',
      key: 'applicant_id'
    }
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'post_master',
      key: 'post_id'
    }
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'district_master',
      key: 'district_id'
    }
  },
  application_no: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'DRAFT'
  },
  is_locked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  declaration_accepted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  submitted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  gender: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  date_of_birth: {
    type: DataTypes.DATE,
    allowNull: true
  },
  aadhaar_number: {
    type: DataTypes.STRING(12),
    allowNull: true
  },
  address_line1: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  address_line2: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  state: {
    type: DataTypes.STRING(100),
    defaultValue: 'Maharashtra'
  },
  pincode: {
    type: DataTypes.STRING(6),
    allowNull: true
  },
  is_local_resident: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  local_resident_proof_type: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  local_resident_years: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  system_eligibility: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    comment: 'Auto-calculated eligibility result'
  },
  system_eligibility_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  admin_eligibility_override: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  admin_eligibility_decision: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  document_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  verified_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'admin_users',
      key: 'admin_id'
    }
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  verification_remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  merit_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Calculated merit score for ranking'
  },
  eligibility_checked_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when eligibility was checked'
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  selection_status: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'SELECTED, REJECTED, SELECTED_IN_OTHER_POST'
  },
  selected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  auto_rejected_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Reason for auto-rejection (e.g., selected in other post)'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_applications',
  timestamps: false
});

// Generate application number using atomic sequence (state-level, no ZP)
// Uses PostgreSQL function for race-condition-safe ID generation
// Format: YY-MM-XXXXX (e.g., 25-12-00001)
Application.generateApplicationNo = async function() {
  return await generateApplicationNo();
};

module.exports = Application;
