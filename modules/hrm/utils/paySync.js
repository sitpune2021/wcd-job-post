const { ApiError } = require('../../../middleware/errorHandler');

const normalizeMonthlyPay = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, 'Monthly pay must be a valid number');
  }

  return Number(parsed.toFixed(2));
};

const syncEmployeePayFromPostAmount = async ({
  db,
  postId,
  amount,
  updatedBy,
  transaction
}) => {
  if (!postId) return;

  await db.EmployeeMaster.update({
    employee_pay: amount,
    updated_by: updatedBy,
    updated_at: new Date()
  }, {
    where: {
      post_id: postId,
      is_deleted: false
    },
    transaction
  });
};

const syncPostAmountAndEmployeePay = async ({
  db,
  postId,
  amount,
  updatedBy,
  transaction
}) => {
  if (!postId) return;

  await db.PostMaster.update({
    amount,
    updated_by: updatedBy,
    updated_at: new Date()
  }, {
    where: {
      post_id: postId,
      is_deleted: false
    },
    transaction
  });

  await syncEmployeePayFromPostAmount({
    db,
    postId,
    amount,
    updatedBy,
    transaction
  });
};

module.exports = {
  normalizeMonthlyPay,
  syncEmployeePayFromPostAmount,
  syncPostAmountAndEmployeePay
};
