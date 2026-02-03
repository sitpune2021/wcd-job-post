const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/db');

const LoginAttempt = sequelize.define('LoginAttempt', {
    attempt_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    mobile_or_username: {
      type: DataTypes.STRING,
      allowNull: false
    },
    user_type: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [['APPLICANT', 'ADMIN']]
      }
    },
    attempt_time: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    success: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    ip_address: {
      type: DataTypes.INET,
      allowNull: true
    },
    locked_until: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'ms_login_attempts',
    timestamps: false
  });

  // Class methods
  LoginAttempt.recordAttempt = async function(mobileOrUsername, userType, success, ipAddress) {
    return await this.create({
      mobile_or_username: mobileOrUsername,
      user_type: userType,
      success,
      ip_address: ipAddress
    });
  };

  LoginAttempt.getRecentFailedAttempts = async function(mobileOrUsername, userType, minutes = 3) {
    const cutoffTime = new Date();
    cutoffTime.setMinutes(cutoffTime.getMinutes() - minutes);
    
    return await this.count({
      where: {
        mobile_or_username: mobileOrUsername,
        user_type: userType,
        success: false,
        attempt_time: {
          [Op.gte]: cutoffTime
        }
      }
    });
  };

  LoginAttempt.isLocked = async function(mobileOrUsername, userType, maxAttempts, lockoutMinutes) {
    const attemptsThreshold = maxAttempts || 5;
    const windowMinutes = lockoutMinutes || 3;

    // If there is an active lock record, honor it
    const activeLock = await this.findOne({
      where: {
        mobile_or_username: mobileOrUsername,
        user_type: userType,
        locked_until: { [Op.gte]: new Date() }
      },
      order: [['locked_until', 'DESC']]
    });
    if (activeLock) {
      return activeLock.locked_until;
    }

    const failedAttempts = await this.getRecentFailedAttempts(
      mobileOrUsername,
      userType,
      windowMinutes
    );

    return failedAttempts >= attemptsThreshold;
  };

  LoginAttempt.lockAccount = async function(mobileOrUsername, userType, lockUntil) {
    const lockedUntil = lockUntil || null;

    await this.create({
      mobile_or_username: mobileOrUsername,
      user_type: userType,
      success: false,
      locked_until: lockedUntil
    });

    return lockedUntil;
  };

module.exports = LoginAttempt;
