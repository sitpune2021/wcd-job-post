const bcrypt = require('bcryptjs');
const { getBcryptRounds } = require('../config/security');

const hashPassword = async (plainPassword) => bcrypt.hash(plainPassword, getBcryptRounds());

const buildStoredPasswordValues = async (plainPassword) => ({
  password_hash: await hashPassword(plainPassword),
  plain_password: plainPassword
});

const buildStoredTempPasswordValues = async (plainPassword) => ({
  temp_password_hash: await hashPassword(plainPassword),
  plain_temp_password: plainPassword
});

module.exports = {
  hashPassword,
  buildStoredPasswordValues,
  buildStoredTempPasswordValues
};
