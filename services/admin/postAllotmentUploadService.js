const path = require('path');
const fs = require('fs');
const db = require('../../models');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath, getAbsolutePath } = require('../../utils/fileUpload');
const { getCurrentUserId } = require('../../utils/auditContext');

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

const getByPostId = async (postId) => {
  const parsedPostId = Number.parseInt(postId, 10);
  if (!Number.isFinite(parsedPostId) || parsedPostId <= 0) {
    throw new ApiError(400, 'Invalid post id');
  }

  const row = await db.PostAllotmentUpload.findOne({
    where: { post_id: parsedPostId, is_deleted: false }
  });

  if (!row) return null;

  const json = row.toJSON();
  json.file_path = toPublicUploadPath(json.file_path);
  return json;
};

const deletePhysicalFileIfExists = (dbPath) => {
  if (!dbPath) return;
  const fsPath = path.isAbsolute(dbPath) ? dbPath : getAbsolutePath(dbPath);
  if (fs.existsSync(fsPath)) {
    fs.unlinkSync(fsPath);
  }
};

const upsertForPost = async (postId, fileData) => {
  const parsedPostId = Number.parseInt(postId, 10);
  if (!Number.isFinite(parsedPostId) || parsedPostId <= 0) {
    throw new ApiError(400, 'Invalid post id');
  }

  const post = await db.PostMaster.findOne({
    where: { post_id: parsedPostId, is_deleted: false }
  });

  if (!post) {
    throw new ApiError(404, 'Post not found');
  }

  const relativePath = getRelativePath(fileData.path).replace(/\\/g, '/');

  const existing = await db.PostAllotmentUpload.findOne({
    where: { post_id: parsedPostId, is_deleted: false }
  });

  if (existing) {
    if (existing.file_path && existing.file_path !== relativePath) {
      deletePhysicalFileIfExists(existing.file_path);
    }

    await existing.update({
      file_name: fileData.filename,
      original_name: fileData.originalname,
      file_path: relativePath,
      file_size: fileData.size,
      mime_type: fileData.mimetype,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null
    });

    const json = existing.toJSON();
    json.file_path = toPublicUploadPath(json.file_path);
    return json;
  }

  const created = await db.PostAllotmentUpload.create({
    post_id: parsedPostId,
    file_name: fileData.filename,
    original_name: fileData.originalname,
    file_path: relativePath,
    file_size: fileData.size,
    mime_type: fileData.mimetype,
    is_deleted: false
  });

  const json = created.toJSON();
  json.file_path = toPublicUploadPath(json.file_path);
  return json;
};

const softDeleteForPost = async (postId) => {
  const parsedPostId = Number.parseInt(postId, 10);
  if (!Number.isFinite(parsedPostId) || parsedPostId <= 0) {
    throw new ApiError(400, 'Invalid post id');
  }

  const existing = await db.PostAllotmentUpload.findOne({
    where: { post_id: parsedPostId, is_deleted: false }
  });

  if (!existing) {
    return null;
  }

  if (existing.file_path) {
    deletePhysicalFileIfExists(existing.file_path);
  }

  await existing.update({
    is_deleted: true,
    deleted_at: new Date(),
    deleted_by: getCurrentUserId() || null
  });

  return true;
};

module.exports = {
  getByPostId,
  upsertForPost,
  softDeleteForPost
};
