const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sequelize = require('../config/db');
const { OTP } = require('../utils/constants');

const OtpLog = sequelize.define('OtpLog', {
    otp_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    mobile_no: {
      type: DataTypes.STRING,
      allowNull: false
    },
    otp_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    purpose: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [['REGISTRATION', 'LOGIN', 'RESET']]
      }
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'ms_otp_logs',
    timestamps: false,
    hooks: {
      beforeCreate: async (otpLog) => {
        if (otpLog.otp_hash) {
          otpLog.otp_hash = await bcrypt.hash(otpLog.otp_hash, 8);
        }
      }
    }
  });

  // Instance methods
  OtpLog.prototype.validateOtp = async function(otp) {
    return bcrypt.compare(otp, this.otp_hash);
  };

  OtpLog.prototype.isExpired = function() {
    return new Date() > this.expires_at;
  };

  OtpLog.prototype.incrementAttempts = async function() {
    this.attempts += 1;
    await this.save();
    return this.attempts;
  };

  OtpLog.prototype.markVerified = async function() {
    this.is_verified = true;
    this.verified_at = new Date();
    await this.save();
  };

  // Class methods
  OtpLog.generateOtp = function() {
    // Generate a cryptographically secure 6-digit OTP
    return crypto.randomInt(100000, 1000000).toString();
  };

  OtpLog.createOtp = async function(mobile_no, purpose) {
    // Invalidate any existing OTPs for this mobile and purpose
    await this.update(
      { is_verified: true },
      { where: { mobile_no, purpose, is_verified: false } }
    );
    
    // Generate new OTP
    const otp = this.generateOtp();
    
    // Set expiry time (configurable via env, default 5 minutes)
    const expiresAt = new Date();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || 5, 10);
    expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);
    
    // Create OTP record
    const otpRecord = await this.create({
      mobile_no,
      otp_hash: otp, // Will be hashed in beforeCreate hook
      purpose,
      expires_at: expiresAt
    });
    
    // Return plain OTP for sending to user
    return {
      otp,
      expires_at: expiresAt
    };
  };
  
  OtpLog.getMaxAttempts = function() {
    return parseInt(process.env.OTP_MAX_ATTEMPTS || 5, 10);
  };

module.exports = OtpLog;
