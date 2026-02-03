const { DataTypes } = require('sequelize');
const crypto = require('crypto');
const sequelize = require('../config/db');

const RefreshToken = sequelize.define('RefreshToken', {
    token_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    user_type: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [['APPLICANT', 'ADMIN']]
      }
    },
    token_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    is_revoked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    device_info: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ip_address: {
      type: DataTypes.INET,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'ms_refresh_tokens',
    timestamps: false
  });

  // Instance methods
  RefreshToken.prototype.isExpired = function() {
    return new Date() > this.expires_at;
  };

  RefreshToken.prototype.revoke = async function() {
    this.is_revoked = true;
    this.revoked_at = new Date();
    await this.save();
  };

  // Class methods
  RefreshToken.generateToken = function() {
    return crypto.randomBytes(40).toString('hex');
  };

  RefreshToken.hashToken = function(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  };

  RefreshToken.createToken = async function(userId, userType, deviceInfo, ipAddress) {
    // Generate token
    const token = this.generateToken();
    
    // Hash token for storage
    const tokenHash = this.hashToken(token);
    
    // Set expiry time (7 days from now or as configured)
    const expiresAt = new Date();
    const expirySeconds = parseInt(process.env.REFRESH_TOKEN_EXPIRY_SECONDS || (7 * 24 * 60 * 60), 10);
    expiresAt.setSeconds(expiresAt.getSeconds() + expirySeconds);
    
    // Create token record
    const tokenRecord = await this.create({
      user_id: userId,
      user_type: userType,
      token_hash: tokenHash,
      expires_at: expiresAt,
      device_info: deviceInfo,
      ip_address: ipAddress
    });
    
    // Return plain token for client
    return {
      token,
      expires_at: expiresAt
    };
  };

  RefreshToken.findByToken = async function(token) {
    const tokenHash = this.hashToken(token);
    return await this.findOne({
      where: {
        token_hash: tokenHash,
        is_revoked: false
      }
    });
  };

  RefreshToken.revokeAllUserTokens = async function(userId, userType) {
    return await this.update(
      { 
        is_revoked: true,
        revoked_at: new Date()
      },
      { 
        where: { 
          user_id: userId,
          user_type: userType,
          is_revoked: false
        }
      }
    );
  };

module.exports = RefreshToken;
