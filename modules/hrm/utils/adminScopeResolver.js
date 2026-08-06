const { Op } = require('sequelize');
const db = require('../../../models');

const STATE_ROLES = ['SUPER_ADMIN', 'STATE_ADMIN', 'TECH_ADMIN'];

const normalizeIdArray = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
));

const getAdminRoleCode = (adminUser) => (
  adminUser?.dataValues?.role_code ||
  adminUser?.role?.role_code ||
  adminUser?.role ||
  null
);

const resolveAdminHRMScope = async (adminUser) => {
  const roleCode = getAdminRoleCode(adminUser);
  const districtId = Number(adminUser?.district_id) || null;
  const schemeTypeId = Number(adminUser?.scheme_type_id || adminUser?.dataValues?.scheme_type_id) || null;
  const assignedSchemeIds = normalizeIdArray(
    adminUser?.assigned_scheme_ids || adminUser?.dataValues?.assigned_scheme_ids
  );

  if (STATE_ROLES.includes(roleCode)) {
    return { level: 'STATE', filters: {} };
  }

  const hasTypeRestriction = Boolean(schemeTypeId);
  const hasSchemeRestriction = assignedSchemeIds.length > 0;

  if (!districtId && !hasTypeRestriction && !hasSchemeRestriction) {
    return { level: 'ALL', filters: {} };
  }

  if (!hasTypeRestriction && !hasSchemeRestriction && districtId) {
    return {
      level: 'DISTRICT',
      filters: { district_id: districtId }
    };
  }

  const schemeWhere = { is_deleted: false };
  if (districtId) {
    schemeWhere.district_id = districtId;
  }
  if (hasTypeRestriction) {
    schemeWhere.scheme_type_id = schemeTypeId;
  }
  if (hasSchemeRestriction) {
    schemeWhere.scheme_id = { [Op.in]: assignedSchemeIds };
  }

  const schemes = await db.Scheme.findAll({
    where: schemeWhere,
    attributes: ['scheme_id'],
    raw: true
  });

  const resolvedSchemeIds = normalizeIdArray(schemes.map((scheme) => scheme.scheme_id));
  const filters = {};

  if (districtId) {
    filters.district_id = districtId;
  }
  if (schemeTypeId) {
    filters.scheme_type_id = schemeTypeId;
  }

  if (hasTypeRestriction || hasSchemeRestriction) {
    filters.scheme_ids = resolvedSchemeIds;
    if (resolvedSchemeIds.length === 0) {
      filters.block_all = true;
    }
  }

  return {
    level: resolvedSchemeIds.length > 1 ? 'SCHEME_MULTI' : 'SCHEME',
    filters
  };
};

module.exports = {
  normalizeIdArray,
  getAdminRoleCode,
  resolveAdminHRMScope
};
