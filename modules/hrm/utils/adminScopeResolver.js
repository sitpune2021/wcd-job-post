const { Op } = require('sequelize');
const db = require('../../../models');

const STATE_ROLES = ['SUPER_ADMIN', 'STATE_ADMIN', 'TECH_ADMIN'];

const normalizeIdArray = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
));

const normalizeIdScope = (primaryId, ids) => {
  const normalized = normalizeIdArray(ids);
  const primary = Number(primaryId);
  if (Number.isInteger(primary) && primary > 0) {
    normalized.unshift(primary);
  }
  return Array.from(new Set(normalized));
};

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
  const districtIds = normalizeIdScope(districtId, adminUser?.district_ids || adminUser?.dataValues?.district_ids);
  const schemeTypeIds = normalizeIdScope(
    schemeTypeId,
    adminUser?.scheme_type_ids || adminUser?.dataValues?.scheme_type_ids
  );
  const assignedSchemeIds = normalizeIdArray(
    adminUser?.assigned_scheme_ids || adminUser?.dataValues?.assigned_scheme_ids
  );

  if (STATE_ROLES.includes(roleCode)) {
    return { level: 'STATE', filters: {} };
  }

  const hasDistrictRestriction = districtIds.length > 0;
  const hasTypeRestriction = schemeTypeIds.length > 0;
  const hasSchemeRestriction = assignedSchemeIds.length > 0;

  if (!hasDistrictRestriction && !hasTypeRestriction && !hasSchemeRestriction) {
    return { level: 'ALL', filters: {} };
  }

  if (!hasTypeRestriction && !hasSchemeRestriction && hasDistrictRestriction) {
    return {
      level: districtIds.length > 1 ? 'DISTRICT_MULTI' : 'DISTRICT',
      filters: {
        district_id: districtIds.length === 1 ? districtIds[0] : undefined,
        district_ids: districtIds
      }
    };
  }

  const schemeWhere = { is_deleted: false };
  if (hasDistrictRestriction) {
    schemeWhere.district_id = { [Op.in]: districtIds };
  }
  if (hasTypeRestriction) {
    schemeWhere.scheme_type_id = { [Op.in]: schemeTypeIds };
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

  if (hasDistrictRestriction) {
    filters.district_ids = districtIds;
    if (districtIds.length === 1) {
      filters.district_id = districtIds[0];
    }
  }
  if (hasTypeRestriction) {
    filters.scheme_type_ids = schemeTypeIds;
    if (schemeTypeIds.length === 1) {
      filters.scheme_type_id = schemeTypeIds[0];
    }
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
