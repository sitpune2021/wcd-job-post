const db = require('../../models');
const { QueryTypes } = require('sequelize');

const parseOptionalInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getPostWiseReport = async (filters = {}) => {
  const componentId = parseOptionalInt(filters.component_id);
  const districtId = parseOptionalInt(filters.district_id);
  const postId = parseOptionalInt(filters.post_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      pm.post_id,
      pm.post_code,
      pm.post_name,
      pm.post_name_mr,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS selected_count
    FROM ms_post_master pm
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
    WHERE pm.is_deleted = false
      AND (:componentId IS NULL OR pm.component_id = :componentId)
      AND (:postId IS NULL OR pm.post_id = :postId)
    GROUP BY pm.post_id, pm.post_code, pm.post_name, pm.post_name_mr, pm.created_at
    ORDER BY pm.created_at DESC, pm.post_id DESC
    `,
    {
      replacements: { componentId, districtId, postId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getPostSelectedCandidatesReport = async (filters = {}) => {
  const componentId = parseOptionalInt(filters.component_id);
  const districtId = parseOptionalInt(filters.district_id);
  const postId = parseOptionalInt(filters.post_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      pm.post_id,
      pm.component_id,
      c.component_name,
      pm.post_code,
      pm.post_name,
      pm.post_name_mr,
      COALESCE(
        json_agg(DISTINCT ap.full_name ORDER BY ap.full_name) FILTER (
          WHERE ap.full_name IS NOT NULL
            AND (:districtId IS NULL OR a.district_id = :districtId)
        ),
        '[]'::json
      ) AS selected_candidates
    FROM ms_post_master pm
    LEFT JOIN ms_components c
      ON c.component_id = pm.component_id
     AND c.is_deleted = false
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
     AND a.status = 'SELECTED'
    LEFT JOIN ms_applicant_personal ap
      ON ap.applicant_id = a.applicant_id
     AND ap.is_deleted = false
    WHERE pm.is_deleted = false
      AND (:componentId IS NULL OR pm.component_id = :componentId)
      AND (:postId IS NULL OR pm.post_id = :postId)
    GROUP BY pm.post_id, pm.component_id, c.component_name, pm.post_code, pm.post_name, pm.post_name_mr, pm.created_at
    ORDER BY pm.created_at DESC, pm.post_id DESC
    `,
    {
      replacements: { componentId, districtId, postId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getDistrictWiseReport = async (filters = {}) => {
  const componentId = parseOptionalInt(filters.component_id);
  const districtId = parseOptionalInt(filters.district_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      dm.district_id,
      dm.district_name,
      dm.district_name_mr,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:componentId IS NULL OR pm.component_id = :componentId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:componentId IS NULL OR pm.component_id = :componentId)
      )::int AS selected_count
    FROM ms_district_master dm
    LEFT JOIN ms_applications a
      ON a.district_id = dm.district_id
     AND a.is_deleted = false
    LEFT JOIN ms_post_master pm
      ON pm.post_id = a.post_id
    WHERE dm.is_deleted = false
      AND (:districtId IS NULL OR dm.district_id = :districtId)
    GROUP BY dm.district_id, dm.district_name, dm.district_name_mr
    ORDER BY dm.district_name ASC
    `,
    {
      replacements: { componentId, districtId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getComponentWiseReport = async (filters = {}) => {
  const componentId = parseOptionalInt(filters.component_id);
  const districtId = parseOptionalInt(filters.district_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      c.component_id,
      c.component_name,
      c.component_name_mr,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS selected_count
    FROM ms_components c
    LEFT JOIN ms_post_master pm
      ON pm.component_id = c.component_id
     AND pm.is_deleted = false
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
    WHERE c.is_deleted = false
      AND (:componentId IS NULL OR c.component_id = :componentId)
    GROUP BY c.component_id, c.component_name, c.component_name_mr
    ORDER BY c.component_name ASC
    `,
    {
      replacements: { componentId, districtId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getHubWiseReport = async (filters = {}) => {
  const hubId = parseOptionalInt(filters.hub_id);
  const districtId = parseOptionalInt(filters.district_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      h.hub_id,
      h.hub_name,
      h.hub_name_mr,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS selected_count
    FROM ms_hub_master h
    LEFT JOIN ms_post_master pm
      ON pm.hub_id = h.hub_id
     AND pm.is_deleted = false
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
    WHERE h.is_deleted = false
      AND (:hubId IS NULL OR h.hub_id = :hubId)
    GROUP BY h.hub_id, h.hub_name, h.hub_name_mr
    ORDER BY h.hub_name ASC
    `,
    {
      replacements: { hubId, districtId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

module.exports = {
  getPostWiseReport,
  getPostSelectedCandidatesReport,
  getDistrictWiseReport,
  getComponentWiseReport,
  getHubWiseReport
};
