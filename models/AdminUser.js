const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/db');
const { getBcryptRounds } = require('../config/security');

const AdminUser = sequelize.define('AdminUser', {
  admin_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  plain_password: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  full_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      isEmail: true
    }
  },
  mobile_no: {
    type: DataTypes.STRING(15),
    allowNull: true
  },
  role_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'roles',
      key: 'role_id'
    }
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'district_master',
      key: 'district_id'
    },
    comment: 'District assignment for district-level admins'
  },
  district_ids: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: true,
    comment: 'Optional multiple district scope for CHRMS admins'
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_schemes',
      key: 'scheme_id'
    },
    comment: 'Scheme assignment for scheme-level admins'
  },
  scheme_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_scheme_types',
      key: 'scheme_type_id'
    },
    comment: 'Optional scheme type filter for CHRMS scope'
  },
  scheme_type_ids: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: true,
    comment: 'Optional multiple scheme type scope for CHRMS admins'
  },
  linked_employee_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_employee_master',
      key: 'employee_id'
    },
    comment: 'Linked employee for attendance reminders and password sync'
  },
  review_batch_start: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Global starting rank number for reviewer (inclusive) - applies to ALL posts'
  },
  review_batch_end: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Global ending rank number for reviewer (inclusive) - applies to ALL posts'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'admin_users',
      key: 'admin_id'
    }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true
  },
  password_reset_token: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  password_reset_token_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  failed_login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  account_locked_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_login_ip: {
    type: DataTypes.STRING(45),
    allowNull: true
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
  tableName: 'ms_admin_users',
  timestamps: false,
  hooks: {
    beforeCreate: async (admin) => {
      if (admin.password_hash && !admin.password_hash.startsWith('$2')) {
        if (!admin.plain_password) {
          admin.plain_password = admin.password_hash;
        }
        admin.password_hash = await bcrypt.hash(admin.password_hash, getBcryptRounds());
      }
    },
    beforeUpdate: async (admin) => {
      if (admin.changed('password_hash') && !admin.password_hash.startsWith('$2')) {
        if (!admin.plain_password) {
          admin.plain_password = admin.password_hash;
        }
        admin.password_hash = await bcrypt.hash(admin.password_hash, getBcryptRounds());
      }
    }
  }
});

// Instance methods
AdminUser.prototype.validatePassword = async function(password) {
  try {
    if (!this.password_hash) return false;
 
    if (!String(this.password_hash).startsWith('$2')) {
      const isMatch = String(password) === String(this.password_hash);
      if (isMatch) {
        this.password_hash = password;
        this.plain_password = password;
        await this.save();
      }
      return isMatch;
    }
 
    return await bcrypt.compare(password, this.password_hash);
  } catch (_) {
    return false;
  }
};
 

module.exports = AdminUser;
