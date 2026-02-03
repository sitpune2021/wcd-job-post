const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/db');
const { getBcryptRounds } = require('../config/security');

const ApplicantMaster = sequelize.define('ApplicantMaster', {
  applicant_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_no: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: true,
    comment: 'System-generated unique applicant number (YY-MM-XXXXX)'
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: true,
    validate: {
      isEmail: true
    },
    comment: 'Primary identifier for applicant login'
  },
  mobile_no: {
    type: DataTypes.STRING(15),
    allowNull: true,
    comment: 'Optional mobile number for notifications'
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Email/mobile verification status'
  },
  failed_login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  locked_until: {
    type: DataTypes.DATE,
    allowNull: true
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
  activation_token: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  activation_token_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  email_verified_at: {
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
  last_login_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_login_ip: {
    type: DataTypes.STRING(45),
    allowNull: true
  }
}, {
  tableName: 'ms_applicant_master',
  timestamps: false,
  hooks: {
    beforeCreate: async (applicant) => {
      if (applicant.password_hash && !applicant.password_hash.startsWith('$2')) {
        applicant.password_hash = await bcrypt.hash(applicant.password_hash, getBcryptRounds());
      }
    },
    beforeUpdate: async (applicant) => {
      if (applicant.changed('password_hash') && !applicant.password_hash.startsWith('$2')) {
        applicant.password_hash = await bcrypt.hash(applicant.password_hash, getBcryptRounds());
      }
    }
  }
});

// Instance methods
// ApplicantMaster.prototype.validatePassword = async function(password) {
//   return bcrypt.compare(password, this.password_hash);
// };
ApplicantMaster.prototype.validatePassword = async function(password) {
  try {
    if (!this.password_hash) return false;
 
    // Handle legacy/plain-text passwords
    if (!String(this.password_hash).startsWith('$2')) {
      const isMatch = String(password) === String(this.password_hash);
 
      // Auto-upgrade password to bcrypt after successful login
      if (isMatch) {
        this.password_hash = password; // will be hashed by beforeUpdate hook
        await this.save();
      }
 
      return isMatch;
    }
 
    // Normal bcrypt comparison
    return await bcrypt.compare(password, this.password_hash);
  } catch (err) {
    return false;
  }
};

ApplicantMaster.prototype.isAccountLocked = function() {
  return this.locked_until && new Date() < this.locked_until;
};

// Class methods
ApplicantMaster.incrementLoginAttempts = async function(mobile_no) {
  const applicant = await this.findOne({ where: { mobile_no } });
  if (applicant) {
    applicant.failed_login_attempts += 1;
    if (applicant.failed_login_attempts >= 5) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 10);
      applicant.locked_until = lockUntil;
    }
    await applicant.save();
  }
};

ApplicantMaster.resetLoginAttempts = async function(mobile_no) {
  const applicant = await this.findOne({ where: { mobile_no } });
  if (applicant) {
    applicant.failed_login_attempts = 0;
    applicant.locked_until = null;
    await applicant.save();
  }
};

module.exports = ApplicantMaster;
