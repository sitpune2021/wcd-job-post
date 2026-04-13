const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const EmployeeMaster = sequelize.define('EmployeeMaster', {
  employee_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_code: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: false,
    comment: 'Auto-generated unique employee code (EMP0001, EMP0002, etc.)'
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_applicant_master',
      key: 'applicant_id'
    },
    comment: 'Link to applicant record (for both Flow A and Flow B)'
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_applications',
      key: 'application_id'
    },
    comment: 'Link to application record (for Flow A - CRM selected)'
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_post_master',
      key: 'post_id'
    }
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_district_master',
      key: 'district_id'
    }
  },
  component_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_components',
      key: 'component_id'
    },
    comment: 'OSC assignment'
  },
  hub_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_hub_master',
      key: 'hub_id'
    },
    comment: 'Hub assignment'
  },
  contract_start_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Contract start date (YYYY-MM-DD format, no timezone conversion)'
  },
  contract_end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Contract end date (YYYY-MM-DD format, no timezone conversion)'
  },
  onboarding_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: {
      isIn: [['CRM_SELECTED', 'EXISTING_IMPORT', 'DIRECT_ADMIN']]
    },
    comment: 'CRM_SELECTED = Flow A, EXISTING_IMPORT = Flow B, DIRECT_ADMIN = admin-created employee'
  },
  onboarding_status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING',
    validate: {
      isIn: [['PENDING', 'EMAIL_SENT', 'ONBOARDING_INCOMPLETE', 'ONBOARDING_COMPLETE', 'ACTIVE', 'INACTIVE', 'TERMINATED']]
    },
    comment: 'Tracks employee onboarding lifecycle'
  },
  onboarding_completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  temp_password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'For Flow B: temporary password hash (User@123)'
  },
  password_change_required: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'For Flow B: forces password change on first login'
  },
  allotment_letter_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'For Flow B: uploaded allotment letter PDF path'
  },
  allotment_letter_uploaded_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  onboarding_email_sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  onboarding_email_sent_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  employment_status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'ACTIVE',
    validate: {
      isIn: [['ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE']]
    },
    comment: 'Employment status for HRM operations'
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reporting_officer_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Reporting officer (admin user)'
  },
  employee_pay: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Monthly pay for this employee (copied from post at onboarding, maintains consistency even if post changes)'
  }
}, {
  tableName: 'ms_employee_master',
  timestamps: false
});

module.exports = EmployeeMaster;
