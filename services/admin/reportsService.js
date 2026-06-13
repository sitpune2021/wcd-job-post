const db = require('../../models');
const { QueryTypes } = require('sequelize');

const parseOptionalInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getPostWiseReport = async (filters = {}) => {
  const recruitmentDriveId = parseOptionalInt(filters.recruitment_drive_id);
  const schemeId = parseOptionalInt(filters.scheme_id);
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
      AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
      AND (:schemeId IS NULL OR pm.scheme_id = :schemeId)
      AND (:postId IS NULL OR pm.post_id = :postId)
    GROUP BY pm.post_id, pm.post_code, pm.post_name, pm.post_name_mr, pm.created_at
    ORDER BY pm.created_at DESC, pm.post_id DESC
    `,
    {
      replacements: { recruitmentDriveId, schemeId, districtId, postId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getPostSelectedCandidatesReport = async (filters = {}) => {
  const recruitmentDriveId = parseOptionalInt(filters.recruitment_drive_id);
  const schemeId = parseOptionalInt(filters.scheme_id);
  const districtId = parseOptionalInt(filters.district_id);
  const postId = parseOptionalInt(filters.post_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      pm.post_id,
      pm.recruitment_drive_id,
      pm.scheme_id,
      s.scheme_name,
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
    LEFT JOIN ms_schemes s
      ON s.scheme_id = pm.scheme_id
     AND s.is_deleted = false
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
     AND a.status = 'SELECTED'
    LEFT JOIN ms_applicant_personal ap
      ON ap.applicant_id = a.applicant_id
     AND ap.is_deleted = false
    WHERE pm.is_deleted = false
      AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
      AND (:schemeId IS NULL OR pm.scheme_id = :schemeId)
      AND (:postId IS NULL OR pm.post_id = :postId)
    GROUP BY pm.post_id, pm.recruitment_drive_id, pm.scheme_id, s.scheme_name, pm.post_code, pm.post_name, pm.post_name_mr, pm.created_at
    HAVING COUNT(a.application_id) FILTER (
      WHERE a.application_id IS NOT NULL
        AND (:districtId IS NULL OR a.district_id = :districtId)
    ) > 0
    ORDER BY pm.created_at DESC, pm.post_id DESC
    `,
    {
      replacements: { recruitmentDriveId, schemeId, districtId, postId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getDistrictWiseReport = async (filters = {}) => {
  const recruitmentDriveId = parseOptionalInt(filters.recruitment_drive_id);
  const schemeId = parseOptionalInt(filters.scheme_id);
  const districtId = parseOptionalInt(filters.district_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      dm.district_id,
      dm.district_name,
      dm.district_name_mr,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
          AND (:schemeId IS NULL OR pm.scheme_id = :schemeId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
          AND (:schemeId IS NULL OR pm.scheme_id = :schemeId)
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
      replacements: { recruitmentDriveId, schemeId, districtId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};

const getSchemeWiseReport = async (filters = {}) => {
  const recruitmentDriveId = parseOptionalInt(filters.recruitment_drive_id);
  const schemeId = parseOptionalInt(filters.scheme_id);
  const districtId = parseOptionalInt(filters.district_id);

  const rows = await db.sequelize.query(
    `
    SELECT
      s.scheme_id,
      s.scheme_code,
      s.scheme_name,
      s.scheme_name_mr,
      st.scheme_code as scheme_type_code,
      st.scheme_name as scheme_type_name,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS application_count,
      COUNT(a.application_id) FILTER (
        WHERE a.application_id IS NOT NULL
          AND a.status = 'SELECTED'
          AND (:recruitmentDriveId IS NULL OR pm.recruitment_drive_id = :recruitmentDriveId)
          AND (:districtId IS NULL OR a.district_id = :districtId)
      )::int AS selected_count
    FROM ms_schemes s
    LEFT JOIN ms_scheme_types st
      ON st.scheme_type_id = s.scheme_type_id
     AND st.is_deleted = false
    LEFT JOIN ms_post_master pm
      ON pm.scheme_id = s.scheme_id
     AND pm.is_deleted = false
    LEFT JOIN ms_applications a
      ON a.post_id = pm.post_id
     AND a.is_deleted = false
    WHERE s.is_deleted = false
      AND (:schemeId IS NULL OR s.scheme_id = :schemeId)
      AND (:districtId IS NULL OR s.district_id = :districtId)
    GROUP BY s.scheme_id, s.scheme_code, s.scheme_name, s.scheme_name_mr, st.scheme_code, st.scheme_name
    ORDER BY s.scheme_name ASC
    `,
    {
      replacements: { recruitmentDriveId, schemeId, districtId },
      type: QueryTypes.SELECT
    }
  );

  return rows;
};


module.exports = {
  getPostWiseReport,
  getPostSelectedCandidatesReport,
  getDistrictWiseReport,
  getSchemeWiseReport
};
