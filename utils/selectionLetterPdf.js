const { escapeHtml, buildFileUrl } = require('./applicationPdf');

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const toDevanagariDigits = (value) =>
  String(value ?? '').replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)]);

const formatDateMr = (value, fallback = '__________') => {
  if (!value) return fallback;

  const raw = String(value);
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return toDevanagariDigits(`${day}.${month}.${year}`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return toDevanagariDigits(`${day}.${month}.${year}`);
};

const valueOrDash = (...values) => {
  const found = values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
  return found ? String(found).trim() : '________________';
};

const terms = [
  'सदरची नियुक्ती ही केवळ वर नमुद कालावधीसाठीचीच असणार आहे.',
  'सदरची नियुक्ती ही तात्पुरत्या स्वरुपातील कंत्राटी व अल्प कालावधीसाठीची असल्याने वरील प्रमाणे नमुद मुदत संपल्यावर त्या पदावर कोणताही अधिकार राहणार नाही.',
  'वरील नमुद नियुक्त कालावधी व्यतिरिक्त पुढील मुदतवाढ देण्याचे अधिकार या आयुक्तालयाने राखुन ठेवले आहेत.',
  'नियुक्त कर्मचाऱ्यांविरुध्द भारतातील कोणत्याही पोलिस ठाण्यात गुन्ह्याची नोंद नाही याबाबत स्वसाक्षांकित हमीपत्र घेण्यात यावे. याबाबत पडताळणीमध्ये गुन्हयाची नोंद आढळल्यास कर्मचाऱ्याची नियुक्ती तात्काळ रद्द करण्यात येईल.',
  'सदरची योजना ही केंद्र पुरस्कृत योजना असल्याने या योजनेअंतर्गत केंद्र शासनाकडुन अनुदान प्राप्त झाल्यानंतरच कर्मचाऱ्यांचे मानधन अदा करण्यात येईल',
  'शासकिय कर्मचाऱ्यांना लागु असलेल्या सवलती कंत्राटी मनुष्यबळास लागु असणार नाहीत. सदरची नियुक्ती ही तात्पुरत्या स्वरुपाची कंत्राटी पध्दतीची असल्याने संबंधितास शासनाच्या कोणत्याही संवर्गात सेवा समावेशनाबाबत / सामावून घेण्याबाबतचे व नियमित सेवेचे इतर कोणतेही लाभ भत्ते अनुज्ञेय असणार नाही व तशी दाद मागता येणार नाही.',
  'नियुक्त कर्मचाऱ्यांचे कामकाज असमाधानकारक आढळुन आल्यास ७ दिवसाची नोटीस देऊन सेवेमधुन तात्काळ कमी करण्याचे अधिकार राखून ठेवण्यात येत आहेत.',
  'सदर पदावर हजर होताना विहीत नमुन्यातील करारनामा सादर करणे आवश्यक राहील.',
  'नियुक्त कर्मचाऱ्यास सेवा सोडायची असल्यास एक महिना आधी लेखी स्वरुपात कार्यालयास कळविणे आवश्यक राहील.',
  'नियुक्त कर्मचाऱ्याच्या ताब्यात असलेले दस्तावेज, साहित्य, वस्तु इ. रितसर वन स्टॉप सेंटरमध्ये जमा केल्याशिवाय सेवेमधुन कार्यमुक्त होता येणार नाही.',
  'विशेष परिस्थितीत कोणत्याही वेळी सदरची कंत्राटी सेवा समाप्त करण्याचा अधिकार राखून ठेवण्यात येत आहे.',
  'नियुक्त झालेले कंत्राटी मनुष्यबळास यांच्यावर सोपवलेली जबाबदारी पार पाडण्याच्या कामात व्यत्यय, अडथळा अथवा दिरंगाई निर्माण होईल, अशा कोणत्याही व्यावसायिक किंवा इतर कामात गुंतलेला नसावा.',
  'कंत्राटी पध्दतीवरील नियुक्त कर्मचाऱ्यास कार्यालयास प्राप्त होणारी प्रकरणे, कागदपत्रे व आधार सामग्री याबाबत गोपनियता व शिस्त पालनाचे नियम पाळणे बंधनकारक राहील. अशा गोपनियतेचा भंग झाल्याचे निदर्शनास आल्यास आवश्यक तो प्रशासकिय कारवाई करण्यात येईल.',
  'सदर पदावर निश्चित करण्यात आलेल्या नियमावलीनुसार कामकाज वेळा बाबतचे नियमांचे पालन करणे बंधनकारक राहील.',
  'सदर कंत्राटी नियुक्ती कागदपत्र पडताळणीच्या अधिन राहुन करण्यात येत असुन संबंधीत जिल्हा महिला व बाल विकास अधिकारी यांनी मुळ कागदपत्रांची पडताळणी करुन खात्री करावी.',
  'करार पध्दतीवरील नियुक्त कर्मचाऱ्यास एकावेळी सलग १० दिवसापेक्षा जास्त रजा घेता येणार नाही घेतल्यास त्यांच्या सेवा आपोआप संपुष्टात येतील.',
  'सदर नियुक्ती कोणत्याही स्तरावर कधीही संपुष्टात आणण्याचे अधिकार जिल्हाधिकारी यांना राहतील.',
  'करार पध्दतीवरील नियुक्त कर्मचाऱ्याच्या कामकाजाबाबत कोणत्याही तक्रारी प्राप्त झाल्यास व त्यामध्ये तथ्य आढळून आल्यास त्यांच्या सेवा तात्काळ समाप्त करण्यात येतील.'
];

const buildTermRows = (items, startIndex = 1) =>
  items
    .map((term, index) => `
      <div class="term">
        <span class="term-no">${toDevanagariDigits(startIndex + index)}.</span>
        <span class="term-text">${escapeHtml(term)}</span>
      </div>`)
    .join('');

const buildSelectionLetterHtml = (req, application) => {
  const post = application?.post || {};
  const applicant = application?.applicant || {};
  const personal = applicant?.personal || {};
  const applicationDistrict = application?.district || {};
  const postDistrict = post?.district || {};
  const scheme = post?.scheme || {};

  const fullName = valueOrDash(personal.full_name);
  const postNameMr = valueOrDash(post.post_name_mr, post.post_name);
  const schemeNameMr = valueOrDash(scheme.scheme_name_mr, scheme.scheme_name, 'जिल्हा महिला सक्षमीकरण केंद्र');
  const districtNameMr = valueOrDash(
    applicationDistrict.district_name_mr,
    postDistrict.district_name_mr,
    applicationDistrict.district_name,
    postDistrict.district_name
  );
  const generatedDate = formatDateMr(new Date());
  const appointmentStartDate = generatedDate;
  const appointmentEndDate = '३०.०९.२०२६';
  const fontUrl = buildFileUrl(req, 'fonts/NotoSansDevanagari-Regular.ttf');

  const dynamic = (text, minWidth = 110) =>
    `<span class="fill" style="min-width:${minWidth}px">${escapeHtml(text)}</span>`;

  return `<!doctype html>
<html lang="mr">
<head>
  <meta charset="utf-8" />
  <style>
    @font-face {
      font-family: 'PdfDevanagari';
      src: url('${escapeHtml(fontUrl)}') format('truetype'),
           local('Noto Sans Devanagari'),
           local('Mangal'),
           local('Kokila');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'PdfDevanagari';
      src: url('${escapeHtml(fontUrl)}') format('truetype'),
           local('Noto Sans Devanagari Bold'),
           local('Noto Sans Devanagari'),
           local('Mangal'),
           local('Kokila');
      font-weight: 700;
      font-style: normal;
    }
    @page { size: A4; margin: 18mm 20mm 16mm 22mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111;
      font-family: PdfDevanagari, Mangal, Kokila, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.68;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 100%; }
    .doc {
      width: 94%;
      margin: 0 auto;
    }
    .references {
      margin-left: 26px;
      margin-bottom: 8px;
      line-height: 1.44;
    }
    .references .ref {
      display: grid;
      grid-template-columns: 28px 1fr;
      column-gap: 2px;
      margin-bottom: 0;
    }
    .separator {
      margin: 4px 28px 6px;
      border-top: 1px dashed #222;
      height: 1px;
    }
    .order-meta {
      display: flex;
      justify-content: space-between;
      margin: 0 72px 3px 0;
      font-weight: 700;
    }
    h1 {
      text-align: center;
      font-size: 14px;
      margin: 6px 0 34px;
      text-decoration: underline;
    }
    p {
      margin: 0 0 13px;
      text-align: justify;
      text-indent: 36px;
    }
    .fill {
      display: inline-block;
      border-bottom: 0;
      line-height: 1.05;
      text-align: center;
      padding: 0 4px;
      font-weight: 700;
      text-indent: 0;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .terms { margin-top: 4px; }
    .term {
      display: grid;
      grid-template-columns: 28px 1fr;
      column-gap: 8px;
      margin-bottom: 9px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .term-no { text-align: right; }
    .term-text { text-align: justify; }
    .signature {
      margin-top: 28px;
      text-align: right;
      padding-right: 74px;
      font-weight: 700;
    }
    .copy {
      margin-top: 24px;
      line-height: 1.55;
    }
    .copy-title { margin-top: 14px; }
    .page-break {
      break-after: page;
      page-break-after: always;
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="doc">
    <div class="references">
      <div class="ref"><span>संदर्भ: १.</span><span>केंद्रीय महिला व बाल विकास मंत्रालय, नवी दिल्ली यांनी दि.१४.०७.२०२२ रोजी "मिशन शक्ती" अंतर्गत निर्गमित केलेल्या मार्गदर्शक सुचना.</span></div>
      <div class="ref"><span>२.</span><span>शासन निर्णय क्रमांक-वस्टॉर्स २०२३/प्र.क्र. २६/कार्या-२. दिनांक १२.०५.२०२३.</span></div>
      <div class="ref"><span>३.</span><span>आयुक्तालयाचे आदेश क्रं. जाक्र. मबाविआपु/मवि/मिश/मनुष्यबळ ता.नि/बस्टॉसे/२०२५-२६/७७२०/दि. २६ नोव्हेंबर, २०२५</span></div>
      <div class="ref"><span>४.</span><span>केंद्रीय महिला व बाल विकास मंत्रालय, नवी दिल्ली यांचे पत्र क्रं. IFD/११/२०२०-IFD दि. २५.०३.२०२६</span></div>
      <div class="ref"><span>५.</span><span>शासनपत्र क्रं. बैठक-२०२६/प्र.क्र.५९/का-०२ दिनांक ०८.०४.२०२६</span></div>
      <div class="ref"><span>६.</span><span>आयुक्तालयाचे पत्र जाने. मबापि आपु/मवि/मिशक्ती/कंत्राटी भरती/२०२६-२७/३२६९ दिनांक १०.०६.२०२६</span></div>
    </div>

    <div class="separator"></div>
    <div class="order-meta">
      <span>जाऊ. मवाविआपु/मवि/मिश/मनुष्यबळ ता. नि/वस्टॉसें/२०२६-२७/</span>
      <span>दि. ${escapeHtml(generatedDate)}</span>
    </div>
    <h1>आदेश</h1>

    <p>
      केंद्र पुरस्कृत मिशन शक्ती या एकछत्रीत योजनेअंतर्गत केंद्रिय महिला व बाल विकास मंत्रालय, नवी दिल्ली यांनी उपरोक्त संदर्भ क्र.१ अन्वये मार्गदर्शक सूचना निर्गमित केलेल्या आहेत. त्यानुसार राज्यात मिशन शक्ती या ${dynamic(schemeNameMr, 150)} एकछत्रीत योजनेअंतर्गत वन स्टॉप सेंटर-जिल्हा-${dynamic(districtNameMr, 112)}-ही घटक योजना ३१.०३.२०२६ पर्यंत राबविण्यास उपरोक्त संदर्भ क्र.२ अन्वये शासनाने मान्यता दिलेली आहे.
    </p>
    <p>
      मिशनशक्ती योजनेअंतर्गत राज्यात एकुण ६८ वन स्टॉप सेंटर कार्यान्वित असुन यासाठी आवश्यक असलेल्या मनुष्यबळाची कंत्राटी पध्दतीने तात्पुरत्या स्वरुपात दिनांक ३० सप्टेंबर, २०२६ पर्यंत नियुक्ती करण्यासाठी केंद्रशासनाने मान्यता दिलेली आहे. संदर्भ क्र.६ अन्वये वन स्टॉप सेंटर / महिला सक्षमीकरण केंद्र या योजनेअंतर्गत काम करण्यासाठी आवश्यक असलेले कंत्राटी मनुष्यबळ करारतत्व पध्दतीने नियुक्त करण्यासाठी जिल्हाधिकारी यांना प्राधिकृत करण्यात आले आहे.
    </p>
    <p>
      यानुसार श्री श्रीमती ${dynamic(fullName, 178)} यांची ${dynamic(postNameMr, 142)} पदावर दिनांक ${dynamic(appointmentStartDate, 86)} पासून ते दिनांक ${dynamic(appointmentEndDate, 86)} पर्यंत तात्पुरत्या स्वारुपात करार पध्दतीने नियुक्ती करण्यात येत आहे.
    </p>
    <p>
      या आदेशाद्वारे तात्पुरत्या स्वरुपात नियुक्त करण्यात येणाऱ्या कंत्राटी मनुष्यबळास खालील अटी व शती लागु असतील.
    </p>

    <div class="terms">
      ${buildTermRows(terms.slice(0, 6), 1)}
    </div>

    <div class="page-break"></div>

    <div class="terms">
      ${buildTermRows(terms.slice(6), 7)}
    </div>

    <div class="signature">
      जिल्हाधिकारी, ${dynamic(districtNameMr, 118)}
    </div>

    <div class="copy">
      प्रतः माहितीस्तव सविनय सादर<br />
      मा. सचिव, महिला व बाल विकास, मंत्रालय, मुंबई.<br />
      मा. आयुक्त, महिला व बाल विकास, महाराष्ट्र राज्य पुणे,
      <div class="copy-title">प्रतः आवश्यक कार्यवाहीस्तव,</div>
      १) जिल्हा महिला व बाल विकास अधिकारी, संबंधीत जिल्हा.<br />
      २) संबंधित कंत्राटी कर्मचारी,
    </div>
    </div>
  </main>
</body>
</html>`;
};

module.exports = {
  buildSelectionLetterHtml,
  formatDateMr
};
