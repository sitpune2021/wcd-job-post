/*new*/
const fs = require('fs');
const path = require('path');
const htmlToPdf = require('html-pdf-node');
const logger = require('../config/logger');

let devanagariFontDataUrl = null;
try {
  const fontPath = path.join(__dirname, '..', 'public', 'fonts', 'NotoSansDevanagari-Regular.ttf');
  if (fs.existsSync(fontPath)) {
    const fontBuffer = fs.readFileSync(fontPath);
    devanagariFontDataUrl = `data:font/ttf;charset=utf-8;base64,${fontBuffer.toString('base64')}`;
    logger.info('Devanagari font embedded for PDF generation', {
      fontPath,
      bytes: fontBuffer.length
    });
  } else {
    logger.warn('Devanagari font file not found; using server URL fallback', { fontPath });
  }
} catch (fontError) {
  logger.warn('Failed to preload Devanagari font; using server URL fallback', {
    message: fontError?.message
  });
}

const escapeHtml = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const toBool = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return defaultValue;
};

const buildFileUrl = (req, filePath) => {
  if (!filePath) return null;
  const cleanPath = String(filePath).replace(/^\/+/, '');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/${cleanPath}`;
};

const sendPdfFromHtml = async (res, filename, html) => {
  try {
    logger.info('Application PDF generation started', {
      filename,
      fontSource: devanagariFontDataUrl ? 'embedded' : 'url'
    });
    const pdfBuffer = await htmlToPdf.generatePdf(
      { content: html },
      {
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=medium',
          '--enable-font-antialiasing',
          '--disable-lcd-text'
        ]
      }
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    logger.error('Application PDF export failed (html-pdf-node)', {
      filename,
      nodeVersion: process.version,
      stack: error?.stack || String(error)
    });
    throw error;
  }
};

const buildApplicationPdfHtml = (req, application, options = {}) => {
  const includeImages = options.includeImages === true;
  const photoUrl = options.photoUrl || null;
  const signatureUrl = options.signatureUrl || null;
  const acknowledgement = options.acknowledgement || null;
  const payment = options.payment || null;
  const isFreeApplication = options.isFreeApplication || false;
  const applicant = application?.applicant || {};
  const personal = applicant?.personal || {};
  const address = applicant?.address || {};
  const education = Array.isArray(applicant?.education) ? applicant.education : [];
  const experience = Array.isArray(applicant?.experience) ? applicant.experience : [];
  const skills = Array.isArray(applicant?.skills) ? applicant.skills : [];
  const documents = Array.isArray(applicant?.documents) ? applicant.documents : [];
  const post = application?.post || {};
  const district = application?.district || {};

  const fmtDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return d.toLocaleDateString();
  };

  const fmtDateTimeAmPm = (value) => {
    if (!value) return { date: '-', time: '-' };
    // Ensure we're working with a proper date object
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { date: '-', time: '-' };
    
    // Format options for IST
    const dateOptions = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const timeOptions = { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true };
    
    return {
      date: d.toLocaleDateString('en-IN', dateOptions),
      time: d.toLocaleTimeString('en-IN', timeOptions)
    };
  };

  const yesNo = (value) => (value ? 'Yes' : 'No');

  const fileNameFromPath = (p) => {
    if (!p) return null;
    const s = String(p);
    const parts = s.split(/[\\/]/);
    return parts[parts.length - 1] || s;
  };

  const docTypeLabel = (d) => {
    // Prefer descriptive type name; fall back to code; support both documentType and docType keys
    return (
      d?.doc_type_name ||
      d?.documentType?.doc_type_name ||
      d?.docType?.doc_type_name ||
      d?.doc_type ||
      d?.documentType?.doc_type_code ||
      d?.docType?.doc_code ||
      d?.doc_code ||
      d?.docType?.doc_type ||
      '-'
    );
  };

  const docNameLabel = (d) => {
    // Use document type display name as the document name; do not show file names
    return (
      d?.doc_type_name ||
      d?.documentType?.doc_type_name ||
      d?.docType?.doc_type_name ||
      d?.doc_name ||
      '-'
    );
  };

  const docRows = documents
    .map((d, idx) => {
      const type = docTypeLabel(d);
      const name = docNameLabel(d);
      const uploaded = !!d?.file_path;
      return `<tr>
        <td style="text-align:center">${escapeHtml(idx + 1)}</td>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(name)}</td>
        <td style="text-align:center">${escapeHtml(yesNo(uploaded))}</td>
      </tr>`;
    })
    .join('');

  const sortedEducation = [...education].sort((a, b) => {
    const aOrder = a?.educationLevel?.display_order;
    const bOrder = b?.educationLevel?.display_order;
    const aNum = Number.isFinite(Number(aOrder)) ? Number(aOrder) : Number.MAX_SAFE_INTEGER;
    const bNum = Number.isFinite(Number(bOrder)) ? Number(bOrder) : Number.MAX_SAFE_INTEGER;
    if (aNum !== bNum) return aNum - bNum;
    return (a?.education_id || 0) - (b?.education_id || 0);
  });

  const educationRows = sortedEducation
    .map((e, idx) => {
      const level = e?.educationLevel?.level_name || e?.qualification_level || '-';
      const degree = e?.degree_name || e?.stream_subject || '-';
      const board = e?.university_board || '-';
      const year = e?.passing_year || '-';
      const percent = e?.percentage ? `${e.percentage}%` : '-';
      const uploaded = !!e?.certificate_path;
      return `<tr>
        <td style="text-align:center">${escapeHtml(idx + 1)}</td>
        <td>${escapeHtml(level)}</td>
        <td>${escapeHtml(degree)}</td>
        <td>${escapeHtml(board)}</td>
        <td style="text-align:center">${escapeHtml(year)}</td>
        <td style="text-align:center">${escapeHtml(percent)}</td>
        <td style="text-align:center">${escapeHtml(yesNo(uploaded))}</td>
      </tr>`;
    })
    .join('');

  const experienceRows = experience
    .map((e, idx) => {
      const org = e?.organization_name || '-';
      const desg = e?.designation || '-';
      const domain = e?.domain?.domain_name || e?.domain?.domain_name_en || e?.domain_name || '-';
      const months = (e?.total_months !== null && e?.total_months !== undefined) ? `${e.total_months}` : '-';
      const start = e?.start_date ? fmtDate(e.start_date) : '-';
      const end = e?.is_current ? 'Present' : (e?.end_date ? fmtDate(e.end_date) : '-');
      const uploaded = !!e?.certificate_path;
      return `<tr>
        <td style="text-align:center">${escapeHtml(idx + 1)}</td>
        <td>${escapeHtml(org)}</td>
        <td>${escapeHtml(desg)}</td>
        <td style="text-align:center">${escapeHtml(start)}</td>
        <td style="text-align:center">${escapeHtml(end)}</td>
        <td style="text-align:center">${escapeHtml(months)}</td>
        <td style="text-align:center">${escapeHtml(yesNo(uploaded))}</td>
      </tr>`;
    })
    .join('');

  const skillRows = skills
    .map((s, idx) => {
      const name = s?.skill?.skill_name || s?.skill_name || '-';
      const notes = s?.notes || '-';
      const uploaded = !!s?.certificate_path;
      return `<tr>
        <td style="text-align:center">${escapeHtml(idx + 1)}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(notes)}</td>
        <td style="text-align:center">${escapeHtml(yesNo(uploaded))}</td>
      </tr>`;
    })
    .join('');

  const fullName = personal?.full_name || application?.full_name || '-';
  const dob = personal?.dob || application?.date_of_birth || application?.dob || '-';
  const gender = personal?.gender || application?.gender || '-';
  const aadhaarNo = personal?.aadhar_no || personal?.aadhaar_no || application?.aadhaar_number || application?.aadhar_no || '-';
  // PAN temporarily disabled
  // const panNo = personal?.pan_no || application?.pan_no || '-';
  const addressLine = address?.address_line || application?.address_line1 || application?.address_line || '-';
  const addressLine2 = address?.address_line2 || application?.address_line2 || '';
  const pincode = address?.pincode || application?.pincode || '-';
  const addressDistrictName = address?.district?.district_name || '-';
  const postDistrictName = district?.district_name || '-';
  const talukaName = address?.taluka?.taluka_name || '-';

  const postName = post?.post_name || '-';
  const postCode = post?.post_code || '-';
  const componentName = post?.component?.component_name || post?.component?.component_name_en || '-';
  const openingDate = post?.opening_date ? fmtDate(post.opening_date) : '-';
  const closingDate = post?.closing_date ? fmtDate(post.closing_date) : '-';

  const appNo = application?.application_no || application?.application_id || '-';
  const appStatus = application?.status || '-';
  const submittedAt = application?.submitted_at ? fmtDate(application.submitted_at) : '-';
  const eligibility = (application?.eligibility && Object.prototype.hasOwnProperty.call(application.eligibility, 'is_eligible'))
    ? yesNo(!!application.eligibility.is_eligible)
    : (Object.prototype.hasOwnProperty.call(application || {}, 'system_eligibility') ? yesNo(!!application.system_eligibility) : '-');

  const showPermanent = address && address.permanent_address_same === false;
  const permLine = address?.permanent_address_line || '-';
  const permLine2 = address?.permanent_address_line2 || '';
  const permPincode = address?.permanent_pincode || address?.pincode || application?.permanent_pincode || '-';
  // Prefer explicit acknowledgement timestamp (shows when declaration was accepted), then fall back to submission/creation time
  const declarationDateTimeSource = acknowledgement?.accepted_at || application?.submitted_at || application?.created_at || null;
  const declarationPlace = acknowledgement?.place || application?.place || '-';
  const declarationDateTime = fmtDateTimeAmPm(declarationDateTimeSource);
  const fontUrl = devanagariFontDataUrl || buildFileUrl(req, 'fonts/NotoSansDevanagari-Regular.ttf');

  logger.info('Building application PDF HTML', {
    applicationId: application?.application_id || application?.application_no || null,
    hasEmbeddedFont: Boolean(devanagariFontDataUrl)
  });

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: 'EmbeddedDevanagari';
        src: url('${escapeHtml(fontUrl)}') format('truetype'),
             local('Noto Sans Devanagari'),
             local('Mangal'),
             local('Kokila'),
             local('Lohit Devanagari');
        font-weight: 400;
        font-style: normal;
        unicode-range: U+0900-097F, U+200C, U+200D, U+0020-007E;
      }
      @font-face {
        font-family: 'EmbeddedDevanagari';
        src: url('${escapeHtml(fontUrl)}') format('truetype'),
             local('Noto Sans Devanagari Bold'),
             local('Noto Sans Devanagari'),
             local('Mangal'),
             local('Kokila'),
             local('Lohit Devanagari');
        font-weight: 700;
        font-style: normal;
        unicode-range: U+0900-097F, U+200C, U+200D, U+0020-007E;
      }
      * { box-sizing: border-box; }
      body { font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.35; -webkit-font-smoothing: antialiased; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
      .title { font-size: 16px; font-weight: 700; margin: 0; }
      .muted { color: #475569; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .section { margin-top: 12px; }
      .section h2 { font-size: 13px; margin: 0 0 6px 0; padding: 7px 10px; background: #dbeafe; border: 1px solid #bfdbfe; border-left: 4px solid #2563eb; }
      .kv { width: 100%; border-collapse: collapse; }
      .kv td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: top; }
      .kv td.key { width: 34%; color: #475569; font-weight: 700; background: #fafafa; }
      .identity-docs { display: flex; gap: 12px; flex-wrap: wrap; }
      .identity-docs .identity-table { flex: 1 1 180px; min-width: 180px; }
      .identity-docs .doc-grid { flex: 2 1 260px; min-width: 220px; }
      .kv.doc-grid td { padding: 5px 6px; }
      .kv.doc-grid td.key { width: auto; background: #f8fafc; font-size: 11px; }
      .kv.doc-grid td.value { width: 36px; text-align: center; font-weight: 600; color: #0f172a; }
      table.tbl { width: 100%; border-collapse: collapse; }
      table.tbl th, table.tbl td { border: 1px solid #e2e8f0; padding: 6px 8px; vertical-align: top; }
      table.tbl th { background: #f8fafc; color: #0f172a; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
      .images { display: flex; gap: 10px; align-items: flex-start; }
      .imgStack { display: flex; flex-direction: column; gap: 10px; width: 140px; }
      .imgBox { width: 120px; }
      .imgLabel { font-size: 10px; color: #475569; margin-bottom: 4px; }
      .imgFrame { width: 120px; height: 140px; border: 1px solid #cbd5e1; background: #f8fafc; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .imgFrame.signature { height: 60px; }
      .imgFrame img { width: 100%; height: 100%; object-fit: cover; }
      .imgFrame.signature img { object-fit: contain; }
      .page-break { page-break-before: always; margin-top: 18px; }
      .declaration-card { border: 1px solid #cbd5e1; background: #ffffff; padding: 16px 18px; border-radius: 6px; font-family: 'EmbeddedDevanagari', 'Noto Sans Devanagari', 'Mangal', 'Kokila', sans-serif !important; }
      .declaration-card * { font-family: inherit !important; }
      .declaration-heading { font-size: 15px; font-weight: 700; margin: 0 0 10px 0; color: #0f172a; }
      .declaration-body { font-size: 13px; margin: 0 0 12px 0; line-height: 1.65; color: #0f172a; }
      .declaration-points { margin: 0 0 12px 18px; padding: 0; color: #0f172a; }
      .declaration-points li { margin-bottom: 6px; }
      .declaration-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: 14px; align-items: flex-end; }
      .declaration-meta { font-size: 12px; line-height: 1.6; color: #0f172a; }
      .signature-block { text-align: right; min-width: 180px; }
      .signature-label { font-size: 11px; color: #475569; margin-bottom: 6px; }
      .signature-name { margin-top: 8px; font-weight: 700; font-size: 13px; }
      .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #475569; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <p class="title">अर्ज फॉर्म</p>
        <!-- <p class="title">Application Form</p> -->
        <div class="muted">
          <div>अर्ज क्रमांक: <b>${escapeHtml(appNo)}</b></div>
          <!-- <div>Application No: <b>${escapeHtml(appNo)}</b></div> -->
          <div>स्थिती: <b>${escapeHtml(appStatus)}</b></div>
          <!-- <div>Status: <b>${escapeHtml(appStatus)}</b></div> -->
        </div>
      </div>
      ${includeImages ? `
      <div class="images">
        <div class="imgStack">
          ${photoUrl ? `
          <div class="imgBox">
            <div class="imgLabel">फोटो</div>
            <!-- <div class="imgLabel">Photo</div> -->
            <div class="imgFrame"><img src="${escapeHtml(photoUrl)}" /></div>
          </div>` : ''}
          ${signatureUrl ? `
          <div class="imgBox">
            <div class="imgLabel">स्वाक्षरी</div>
            <!-- <div class="imgLabel">Signature</div> -->
            <div class="imgFrame signature"><img src="${escapeHtml(signatureUrl)}" /></div>
          </div>` : ''}
        </div>
      </div>` : ''}
    </div>

    <div class="grid">
      <div class="section" style="margin-top:0">
        <h2>अर्जाचा आढावा</h2>
        <!-- <h2>Application Overview</h2> -->
        <table class="kv">
          <tr><td class="key">सादर केल्याची तारीख</td><td>${escapeHtml(submittedAt)}</td></tr>
          <!-- <tr><td class="key">Submitted On</td><td>${escapeHtml(submittedAt)}</td></tr> -->
          <tr><td class="key">निवडलेला जिल्हा</td><td>${escapeHtml(postDistrictName)}</td></tr>
          <!-- <tr><td class="key">Selected District</td><td>${escapeHtml(postDistrictName)}</td></tr> -->
        </table>
      </div>

      <div class="section" style="margin-top:0">
        <h2>पद तपशील</h2>
        <!-- <h2>Post Details</h2> -->
        <table class="kv">
          <tr><td class="key">पद</td><td>${escapeHtml(postName)}</td></tr>
          <!-- <tr><td class="key">Post</td><td>${escapeHtml(postName)}</td></tr> -->
          <tr><td class="key">पद कोड</td><td>${escapeHtml(postCode)}</td></tr>
          <!-- <tr><td class="key">Post Code</td><td>${escapeHtml(postCode)}</td></tr> -->
          <tr><td class="key">घटक</td><td>${escapeHtml(componentName)}</td></tr>
          <!-- <tr><td class="key">Component</td><td>${escapeHtml(componentName)}</td></tr> -->
          <tr><td class="key">सुरुवात - समाप्ती</td><td>${escapeHtml(openingDate)} - ${escapeHtml(closingDate)}</td></tr>
          <!-- <tr><td class="key">Opening - Closing</td><td>${escapeHtml(openingDate)} - ${escapeHtml(closingDate)}</td></tr> -->
        </table>
      </div>
    </div>

    <div class="section">
      <h2>अर्जदाराचा तपशील</h2>
      <!-- <h2>Applicant Details</h2> -->
      <table class="kv">
        <tr><td class="key">अर्जदार क्रमांक</td><td>${escapeHtml(applicant?.applicant_no || '-')}</td></tr>
        <!-- <tr><td class="key">Applicant No</td><td>${escapeHtml(applicant?.applicant_no || '-')}</td></tr> -->
        <tr><td class="key">पूर्ण नाव</td><td>${escapeHtml(fullName)}</td></tr>
        <!-- <tr><td class="key">Full Name</td><td>${escapeHtml(fullName)}</td></tr> -->
        <tr><td class="key">लिंग</td><td>${escapeHtml(gender)}</td></tr>
        <!-- <tr><td class="key">Gender</td><td>${escapeHtml(gender)}</td></tr> -->
        <tr><td class="key">जन्मतारीख</td><td>${escapeHtml(dob ? fmtDate(dob) : '-')}</td></tr>
        <!-- <tr><td class="key">Date of Birth</td><td>${escapeHtml(dob ? fmtDate(dob) : '-')}</td></tr> -->
        <tr><td class="key">ईमेल</td><td>${escapeHtml(applicant?.email || '-')}</td></tr>
        <!-- <tr><td class="key">Email</td><td>${escapeHtml(applicant?.email || '-')}</td></tr> -->
        <tr><td class="key">मोबाईल</td><td>${escapeHtml(applicant?.mobile_no || '-')}</td></tr>
        <!-- <tr><td class="key">Mobile</td><td>${escapeHtml(applicant?.mobile_no || '-')}</td></tr> -->
      </table>
    </div>

    <div class="section">
      <h2>पत्ता</h2>
      <!-- <h2>Address</h2> -->
      <table class="kv">
        <tr><td class="key">सध्याचा पत्ता</td><td>${escapeHtml(addressLine)}${addressLine2 ? `<br/>${escapeHtml(addressLine2)}` : ''}</td></tr>
        <!-- <tr><td class="key">Current Address</td><td>${escapeHtml(addressLine)}${addressLine2 ? `<br/>${escapeHtml(addressLine2)}` : ''}</td></tr> -->
        <tr><td class="key">जिल्हा</td><td>${escapeHtml(addressDistrictName)}</td></tr>
        <!-- <tr><td class="key">District</td><td>${escapeHtml(addressDistrictName)}</td></tr> -->
        <tr><td class="key">तालुका</td><td>${escapeHtml(talukaName)}</td></tr>
        <!-- <tr><td class="key">Taluka</td><td>${escapeHtml(talukaName)}</td></tr> -->
        <tr><td class="key">पिनकोड</td><td>${escapeHtml(pincode)}</td></tr>
        <!-- <tr><td class="key">Pincode</td><td>${escapeHtml(pincode)}</td></tr> -->
        ${showPermanent ? `
        <tr><td class="key">कायमचा पत्ता</td><td>${escapeHtml(permLine)}${permLine2 ? `<br/>${escapeHtml(permLine2)}` : ''}</td></tr>
        <!-- <tr><td class="key">Permanent Address</td><td>${escapeHtml(permLine)}${permLine2 ? `<br/>${escapeHtml(permLine2)}` : ''}</td></tr> -->
        <tr><td class="key">कायमचा पिनकोड</td><td>${escapeHtml(permPincode)}</td></tr>
        <!-- <tr><td class="key">Permanent Pincode</td><td>${escapeHtml(permPincode)}</td></tr> -->
        ` : ''}
      </table>
    </div>

    <div class="section">
      <h2>ओळख आणि कागदपत्रे (प्रोफाइल)</h2>
      <!-- <h2>Identity & Documents (Profile)</h2> -->
      <div class="identity-docs">
        <table class="kv identity-table">
          <tr><td class="key">आधार क्रमांक</td><td>${escapeHtml(aadhaarNo)}</td></tr>
          <!-- <tr><td class="key">Aadhaar</td><td>${escapeHtml(aadhaarNo)}</td></tr> -->
        </table>
        <table class="kv doc-grid identity-table">
          <tr>
            <td class="key">फोटो अपलोड</td><td class="value">${escapeHtml(yesNo(!!(personal?.photo_path || photoUrl)))}</td>
            <!-- <td class="key">Photo Upload</td><td class="value">${escapeHtml(yesNo(!!(personal?.photo_path || photoUrl)))}</td> -->
            <td class="key">स्वाक्षरी अपलोड</td><td class="value">${escapeHtml(yesNo(!!(personal?.signature_path || signatureUrl)))}</td>
            <!-- <td class="key">Signature Upload</td><td class="value">${escapeHtml(yesNo(!!(personal?.signature_path || signatureUrl)))}</td> -->
          </tr>
          <tr>
            <td class="key">कामाचा तपशील अपलोड</td><td class="value">${escapeHtml(yesNo(!!personal?.resume_path))}</td>
            <!-- <td class="key">Resume Upload</td><td class="value">${escapeHtml(yesNo(!!personal?.resume_path))}</td> -->
            <td class="key">आधार अपलोड</td><td class="value">${escapeHtml(yesNo(!!personal?.aadhaar_path))}</td>
            <!-- <td class="key">Aadhaar Upload</td><td class="value">${escapeHtml(yesNo(!!personal?.aadhaar_path))}</td> -->
          </tr>
          <!-- PAN upload temporarily disabled -->
        </table>
      </div>
    </div>

    <div class="section">
      <h2>शैक्षणिक पात्रता</h2>
      <!-- <h2>Education</h2> -->
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:34px">#</th>
            <th>स्तर</th>
            <!-- <th>Level</th> -->
            <th>पदवी / प्रवाह</th>
            <!-- <th>Degree / Stream</th> -->
            <th>विद्यापीठ/मंडळ</th>
            <!-- <th>University/Board</th> -->
            <th style="width:56px">वर्ष</th>
            <!-- <th style="width:56px">Year</th> -->
            <th style="width:56px">%</th>
            <th style="width:70px">प्रमाणपत्र</th>
            <!-- <th style="width:70px">Certificate</th> -->
          </tr>
        </thead>
        <tbody>
          ${educationRows || `<tr><td colspan="7" style="text-align:center" class="muted">शैक्षणिक नोंदी नाहीत</td></tr>`}
          <!-- ${educationRows || `<tr><td colspan="7" style="text-align:center" class="muted">No education records</td></tr>`} -->
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>अनुभव</h2>
      <!-- <h2>Experience</h2> -->
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:34px">#</th>
            <th>संस्था</th>
            <!-- <th>Organization</th> -->
            <th>पदनाम</th>
            <!-- <th>Designation</th> -->
            <th style="width:80px">पासून</th>
            <!-- <th style="width:80px">From</th> -->
            <th style="width:80px">पर्यंत</th>
            <!-- <th style="width:80px">To</th> -->
            <th style="width:70px">महिने</th>
            <!-- <th style="width:70px">Months</th> -->
            <th style="width:70px">प्रमाणपत्र</th>
            <!-- <th style="width:70px">Certificate</th> -->
          </tr>
        </thead>
        <tbody>
          ${experienceRows || `<tr><td colspan="8" style="text-align:center" class="muted">अनुभवाच्या नोंदी नाहीत</td></tr>`}
          <!-- ${experienceRows || `<tr><td colspan="8" style="text-align:center" class="muted">No experience records</td></tr>`} -->
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>कौशल्ये</h2>
      <!-- <h2>Skills</h2> -->
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:34px">#</th>
            <th>कौशल्य</th>
            <!-- <th>Skill</th> -->
            <th>टिपा</th>
            <!-- <th>Notes</th> -->
            <th style="width:90px">प्रमाणपत्र</th>
            <!-- <th style="width:90px">Certificate</th> -->
          </tr>
        </thead>
        <tbody>
          ${skillRows || `<tr><td colspan="4" style="text-align:center" class="muted">कौशल्ये जोडलेली नाहीत</td></tr>`}
          <!-- ${skillRows || `<tr><td colspan="4" style="text-align:center" class="muted">No skills added</td></tr>`} -->
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>अपलोड केलेली कागदपत्रे</h2>
      <!-- <h2>Uploaded Documents</h2> -->
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:34px">#</th>
            <th style="width:120px">प्रकार</th>
            <!-- <th style="width:120px">Type</th> -->
            <th>कागदपत्र</th>
            <!-- <th>Document</th> -->
            <th style="width:80px">अपलोड केले</th>
            <!-- <th style="width:80px">Uploaded</th> -->
          </tr>
        </thead>
        <tbody>
          ${docRows || `<tr><td colspan="4" style="text-align:center" class="muted">कागदपत्रे अपलोड केलेली नाहीत</td></tr>`}
          <!-- ${docRows || `<tr><td colspan="4" style="text-align:center" class="muted">No documents uploaded</td></tr>`} -->
        </tbody>
      </table>
    </div>

    ${payment ? `
    <div class="section">
      <h2>पेमेंट तपशील</h2>
      <!-- <h2>Payment Details</h2> -->
      ${isFreeApplication ? `
      <div style="background: #d1ecf1; border: 2px solid #0c5460; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; color: #0c5460;">
          <span style="font-size: 16px; margin-right: 6px;">ℹ</span>
          <strong>मोफत अर्ज / Free Application</strong>
        </p>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #0c5460; line-height: 1.5;">
          या अर्जासाठी पेमेंट आवश्यक नाही कारण तुम्ही याच जिल्ह्यात समान पदनामासाठी आधीच पेमेंट केले आहे. खालील तपशील तुमच्या मूळ पेमेंटचे आहेत.<br/>
          <em>No payment required for this application as you have already paid for a similar post name in this district. Details below show your original payment.</em>
        </p>
      </div>
      ` : ''}
      <div class="payment-card" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 2px solid #28a745;">
          <div>
            <p style="margin: 0; font-size: 14px; color: #6c757d;">पेमेंट स्थिती / Payment Status</p>
            <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #28a745;">
              <span style="display: inline-block; width: 10px; height: 10px; background: #28a745; border-radius: 50%; margin-right: 6px;"></span>
              यशस्वी / SUCCESS
            </p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-size: 14px; color: #6c757d;">${isFreeApplication ? 'मूळ पेमेंट तारीख / Original Payment Date' : 'पेमेंट तारीख / Payment Date'}</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; font-weight: 600; color: #212529;">${escapeHtml(payment.paid_at ? fmtDateTimeAmPm(payment.paid_at).date : '-')}</p>
            <p style="margin: 2px 0 0 0; font-size: 13px; color: #6c757d;">${escapeHtml(payment.paid_at ? fmtDateTimeAmPm(payment.paid_at).time : '-')}</p>
          </div>
        </div>

        <table class="kv" style="margin-bottom: 12px;">
          <tr>
            <td class="key" style="width: 50%;">व्यवहार क्रमांक / Transaction ID</td>
            <td style="font-family: monospace; font-size: 12px; color: #495057;">${escapeHtml(payment.razorpay_payment_id || payment.razorpay_order_id || '-')}</td>
          </tr>
          <tr>
            <td class="key">ऑर्डर क्रमांक / Order ID</td>
            <td style="font-family: monospace; font-size: 12px; color: #495057;">${escapeHtml(payment.razorpay_order_id || '-')}</td>
          </tr>
        </table>

        <div style="background: white; border-radius: 6px; padding: 12px; border: 1px solid #e9ecef;">
          <p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #495057;">रक्कम तपशील / Amount Breakdown</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #e9ecef;">
              <td style="padding: 6px 0; font-size: 13px; color: #6c757d;">मूळ शुल्क / Base Fee</td>
              <td style="padding: 6px 0; text-align: right; font-size: 13px; font-weight: 500;">₹ ${escapeHtml(parseFloat(payment.base_fee || 0).toFixed(2))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e9ecef;">
              <td style="padding: 6px 0; font-size: 13px; color: #6c757d;">प्लॅटफॉर्म शुल्क / Platform Fee</td>
              <td style="padding: 6px 0; text-align: right; font-size: 13px; font-weight: 500;">₹ ${escapeHtml(parseFloat(payment.platform_fee || 0).toFixed(2))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e9ecef;">
              <td style="padding: 6px 0; font-size: 13px; color: #6c757d;">CGST (9%)</td>
              <td style="padding: 6px 0; text-align: right; font-size: 13px; font-weight: 500;">₹ ${escapeHtml(parseFloat(payment.cgst || 0).toFixed(2))}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e9ecef;">
              <td style="padding: 6px 0; font-size: 13px; color: #6c757d;">SGST (9%)</td>
              <td style="padding: 6px 0; text-align: right; font-size: 13px; font-weight: 500;">₹ ${escapeHtml(parseFloat(payment.sgst || 0).toFixed(2))}</td>
            </tr>
            <tr style="background: #f8f9fa;">
              <td style="padding: 10px 8px; font-size: 15px; font-weight: 700; color: #212529;">एकूण रक्कम / Total Amount</td>
              <td style="padding: 10px 8px; text-align: right; font-size: 16px; font-weight: 700; color: #28a745;">₹ ${escapeHtml(parseFloat(payment.amount || 0).toFixed(2))}</td>
            </tr>
          </table>
        </div>

      </div>
    </div>
    ` : ''}

    <div class="section page-break">
      <h2>घोषणापत्र</h2>
      <!-- <h2>Declaration</h2> -->
      <div class="declaration-card">
        <p class="declaration-heading">स्वयं घोषणापत्र</p>
        <p class="declaration-body">
          मी, <b>${escapeHtml(fullName)}</b>, याद्वारे घोषित करतो / करते की, महिला व बालविकास विभागा अंतर्गत अत्यंत तात्पुरत्या स्वरूपात करार पद्धतीने <b>${escapeHtml(postName)}</b> या पदासाठी सादर केलेला अर्ज आणि त्यासोबत जोडलेली सर्व कागदपत्रे माझ्या माहितीनुसार खरी अचूक आणि सत्य आहे.
        </p>
        <p class="declaration-title" style="font-size:13px; font-weight:600; margin: 0 0 6px 0;">मी हे देखील घोषित करतो / करते की:</p>
        <ol class="declaration-points">
          <li>मी अर्जामध्ये दिलेली सर्व माहिती (उदा. शैक्षणिक पात्रता, वय, पत्ता) सत्य आहे.</li>
          <li>मी अर्जात नमूद केलेल्या कागदपत्रांची मूळ प्रत पडताळणीच्या वेळी सादर करण्यास तयार आहे.</li>
           <!-- <li>माझ्याकडून कोणतीही माहिती लपवली गेली नाही किंवा चुकीची दिलेली नाही.</li> -->
          <li>जर माझ्याकडून दिलेली कोणतीही माहिती खोटी किंवा चुकीची आढळली, तर माझ्यावर कायदेशीर कारवाई होऊ शकते आणि/किंवा माझा अर्ज/निवड रद्द होऊ शकते.</li>
        </ol>

        <div class="declaration-footer">
          <div class="declaration-meta">
            <div><b>ठिकाण:</b> ${escapeHtml(declarationPlace)}</div>
            <div><b>दिनांक:</b> ${escapeHtml(declarationDateTime.date)}</div>
            <div><b>वेळ:</b> ${escapeHtml(declarationDateTime.time)}</div>
          </div>

          ${includeImages && signatureUrl ? `
          <div class="signature-block">
            <div class="signature-label">अर्जदाराची स्वाक्षरी</div>
            <!-- <div class="signature-label">Applicant Signature</div> -->
            <div class="imgFrame signature" style="margin-left:auto;"><img src="${escapeHtml(signatureUrl)}" /></div>
            <div class="signature-name">${escapeHtml(fullName)}</div>
          </div>
          ` : `
          <div class="signature-block">
            <div class="signature-label">अर्जदाराची स्वाक्षरी</div>
            <!-- <div class="signature-label">Applicant Signature</div> -->
            <div class="signature-name">${escapeHtml(fullName)}</div>
          </div>
          `}
        </div>
      </div>
    </div>

    <div class="footer">
      <!-- तयार केल्याची तारीख: ${escapeHtml(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }))} -->
       Generated on ${escapeHtml(new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }))} 
    </div>
  </body>
  </html>`;
};

module.exports = {
  escapeHtml,
  toBool,
  buildFileUrl,
  sendPdfFromHtml,
  buildApplicationPdfHtml
};
