// ══════════════════════════════════════════════════════════════════════════
// DLF-Project2570 — PDF Export Backend (Headless Browser / Puppeteer)
// ──────────────────────────────────────────────────────────────────────────
// หน้าที่: รับ HTML ที่หน้าเว็บ (assets/app-pdf-export.js) สร้างไว้แล้ว (ใช้
// ฟังก์ชันเดิมทั้งหมด เช่น _buildFormHTML / _buildOverviewHTML ฯลฯ — โลโก้และ
// รูปแบบหน้าเหมือนเดิมทุกประการ) แล้วสั่งให้ Chromium (headless) เรนเดอร์และ
// พิมพ์เป็น PDF จริง (มีข้อความที่เลือก/คัดลอกได้ ไม่ใช่รูปภาพเหมือนวิธีเดิมที่
// ใช้ html2canvas + jsPDF) พร้อมหัวกระดาษ (โลโก้) และท้ายกระดาษ (เลขหน้า) ที่
// เบราว์เซอร์จัดการให้อัตโนมัติทุกหน้า — แก้ปัญหาการตัดหน้ากลางตาราง/ข้อความ
// ที่วิธีเดิม (ตัด canvas เป็นพิกเซล) เคยพลาดได้ง่าย
//
// วิธีรัน:
//   cd server
//   npm install
//   npm start            # ค่าเริ่มต้น: http://localhost:4790
//
// ตัวแปรแวดล้อม (optional):
//   PORT           พอร์ตที่ให้บริการ (ค่าเริ่มต้น 4790)
//   PDF_API_KEY    ถ้าตั้งค่าไว้ ผู้เรียกต้องส่ง header  x-api-key: <ค่านี้>  มาด้วย
//   CORS_ORIGIN    origin ที่อนุญาต (ค่าเริ่มต้น "*" — เปิดกว้าง เหมือนพฤติกรรม GAS เดิม)
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 4790;
const API_KEY = process.env.PDF_API_KEY || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
// เนื้อหา HTML ของรายงานฉบับสมบูรณ์ (หลายสิบโครงการ) อาจมีขนาดใหญ่ได้ — เผื่อไว้ 40MB
app.use(express.json({ limit: '40mb' }));

// ── ป้องกันการเรียกโดยไม่ได้รับอนุญาต (ทางเลือก เปิดใช้ด้วย env PDF_API_KEY) ──
function checkApiKey(req, res, next) {
  if (!API_KEY) return next(); // ไม่ได้ตั้งค่า key ไว้ = อนุญาตทุกคน (ค่าเริ่มต้น)
  const got = req.get('x-api-key') || '';
  if (got !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Invalid or missing x-api-key' });
  }
  next();
}

// ── Puppeteer: ใช้เบราว์เซอร์ instance เดียวซ้ำ (เร็วกว่าเปิดใหม่ทุกครั้งมาก) ──
// ถ้า process ของเบราว์เซอร์หลุด/ปิดตัวเอง จะเปิดใหม่ให้อัตโนมัติในคำขอถัดไป
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // กัน crash บนคอนเทนเนอร์ที่ /dev/shm เล็ก
      '--font-render-hinting=none',
    ],
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

// ── CSS การพิมพ์ ──────────────────────────────────────────────────────────
// - .pdf-noBreak / .pdf-pageBreakBefore ใช้ชื่อเดียวกับที่ assets/app-pdf-export.js
//   ใส่ไว้ในเนื้อหาอยู่แล้ว (เดิมใช้แค่คำนวณจุดตัด canvas ฝั่ง client เฉยๆ ไม่มีผลจริง
//   ตอนนี้กลายเป็น CSS rule จริงที่ Chromium ใช้ตัดสินใจแบ่งหน้า)
// - thead ทำให้หัวตารางซ้ำทุกหน้าอัตโนมัติถ้าตารางยาวเกินหนึ่งหน้า
const PRINT_CSS = `
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
  body { font-family: 'Sarabun', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, sans-serif; }
  .pdf-noBreak { break-inside: avoid; page-break-inside: avoid; }
  .pdf-pageBreakBefore { break-before: page; page-break-before: always; }
  table { border-collapse: collapse; }
  tr, td, th { break-inside: avoid; page-break-inside: avoid; }
  thead { display: table-header-group; }
  img { max-width: 100%; }
`;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapHtmlDocument(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<style>
  /* โหลดฟอนต์ไทย Sarabun จาก Google Fonts — ต้องมีอินเทอร์เน็ตบนเซิร์ฟเวอร์ที่รัน Puppeteer
     ถ้าต้องการใช้งานแบบออฟไลน์ล้วน ให้ดาวน์โหลดไฟล์ฟอนต์มาไว้ที่ server/fonts/ แล้วเปลี่ยนมาใช้
     @font-face ชี้ไฟล์ในเครื่องแทน (ดูคำแนะนำใน README.md) */
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap');
  ${PRINT_CSS}
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

// หัวกระดาษ/ท้ายกระดาษ ใช้กลไก headerTemplate/footerTemplate ของ Puppeteer เอง
// (เรนเดอร์ซ้ำทุกหน้าโดย Chromium อัตโนมัติ ไม่ต้องคำนวณตำแหน่งเองแบบวิธีเดิม)
function buildHeaderTemplate(headerOpts) {
  if (!headerOpts) return '<span></span>'; // ต้อง return element ว่างเสมอ ห้าม string ว่างเปล่า
  const { logoSrc, title, subtitle, subtitle2 } = headerOpts;
  return `
  <div style="font-family:'Sarabun','Noto Sans Thai',Tahoma,sans-serif;width:100%;font-size:9px;color:#111;padding:0 8mm;box-sizing:border-box;-webkit-print-color-adjust:exact">
    <div style="display:flex;align-items:center;gap:10px;border-bottom:1.5px solid #2c3e70;padding-bottom:4px">
      ${logoSrc ? `<img src="${logoSrc}" style="height:28px;width:auto;object-fit:contain;flex-shrink:0">` : ''}
      <div style="flex:1;text-align:center">
        <div style="font-size:10.5px;font-weight:700">${esc(title)}</div>
        ${subtitle ? `<div style="font-size:8px;color:#555;margin-top:1px">${esc(subtitle)}</div>` : ''}
        ${subtitle2 ? `<div style="font-size:7.5px;color:#888;margin-top:1px">${esc(subtitle2)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

function buildFooterTemplate() {
  const dateStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  // คลาส pageNumber / totalPages เป็นคลาสพิเศษของ Puppeteer ที่แทนที่ด้วยเลขหน้าจริงให้อัตโนมัติ
  return `
  <div style="font-family:'Sarabun','Noto Sans Thai',Tahoma,sans-serif;width:100%;font-size:8px;color:#888;padding:0 8mm;box-sizing:border-box;display:flex;justify-content:flex-end;border-top:1px solid #ddd;padding-top:2px">
    <span>หน้า <span class="pageNumber"></span> จาก <span class="totalPages"></span>&nbsp;|&nbsp;พิมพ์เมื่อ ${dateStr}</span>
  </div>`;
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'dlf-pdf-export-backend' }));

app.post('/api/export-pdf', checkApiKey, async (req, res) => {
  const { html, headerOpts, filename } = req.body || {};
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ success: false, message: 'ต้องส่ง field "html" (string) มาด้วย' });
  }

  let page = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(wrapHtmlDocument(html), { waitUntil: 'networkidle0', timeout: 60000 });
    // รอให้ฟอนต์ + รูปภาพ (โลโก้/รูปแนบ) โหลดและ decode เสร็จสมบูรณ์ก่อนพิมพ์เป็น PDF
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      const imgs = Array.from(document.images || []);
      await Promise.all(imgs.map(img => (img.complete ? Promise.resolve() : new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }))));
    });

    const hasHeader = !!headerOpts;
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: buildHeaderTemplate(headerOpts),
      footerTemplate: buildFooterTemplate(),
      margin: {
        top: hasHeader ? '26mm' : '10mm',
        bottom: '14mm',
        left: '8mm',
        right: '8mm',
      },
    });

    const safeName = String(filename || 'เอกสาร').replace(/[\/\\:*?"<>|]/g, '').substring(0, 120) || 'เอกสาร';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(safeName)}.pdf`,
      'Content-Length': pdfBuffer.length,
    });
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error('[export-pdf] error:', err);
    res.status(500).json({ success: false, message: err.message || 'PDF generation failed' });
  } finally {
    if (page) { try { await page.close(); } catch (e) {} }
  }
});

app.listen(PORT, () => {
  console.log(`✅ DLF PDF export backend listening on http://localhost:${PORT}`);
  console.log(`   POST /api/export-pdf   { html, headerOpts, filename }`);
  if (API_KEY) console.log('   🔒 x-api-key required');
});

// ปิดเบราว์เซอร์ให้เรียบร้อยเมื่อ process ถูกสั่งหยุด
process.on('SIGINT', async () => { if (_browser) await _browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (_browser) await _browser.close(); process.exit(0); });
