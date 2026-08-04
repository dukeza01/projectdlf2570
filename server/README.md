# DLF PDF Export Backend (Headless Browser / Puppeteer)

แทนที่ระบบ export PDF เดิม (html2canvas + jsPDF ที่รันในเบราว์เซอร์ผู้ใช้ แล้ววาดหน้าเว็บ
เป็น "รูปภาพ" ก่อนตัดพิกเซลเป็นหน้า ๆ เอง) ด้วยเซิร์ฟเวอร์เล็ก ๆ ที่สั่งให้ Chromium
(headless, ผ่าน [Puppeteer](https://pptr.dev/)) เรนเดอร์ HTML แบบฟอร์ม/รายงานเดิมทุกอัน
(โลโก้และหน้าตาเอกสารเหมือนเดิมทุกประการ — ใช้ฟังก์ชันสร้าง HTML ตัวเดิมใน
`assets/app-pdf-export.js`) แล้ว "พิมพ์" ออกมาเป็น PDF จริง

**ข้อดีเทียบกับวิธีเดิม**
- ข้อความในไฟล์ PDF เป็นข้อความจริง เลือก/คัดลอก/ค้นหาได้ (ของเดิมเป็นรูปภาพทั้งหน้า)
- ตัดหน้าแม่นยำกว่า — ใช้ CSS `break-inside/break-before` ของเบราว์เซอร์เองแทนการคำนวณ
  ตำแหน่งพิกเซลด้วยมือ
- หัวกระดาษ (โลโก้) และท้ายกระดาษ (เลขหน้า/จำนวนหน้ารวม) ซ้ำทุกหน้าโดย Chromium จัดการเอง
- ไฟล์เล็กลงมาก (ไม่ใช่ JPEG เต็มหน้าซ้อนกันหลายสิบภาพ)

## โครงสร้าง

```
server/
  server.js      Express + Puppeteer — เปิด endpoint POST /api/export-pdf
  package.json
```

Backend นี้**ไม่เก็บข้อมูลโครงการใด ๆ**และไม่ต่อกับ Google Sheet — หน้าที่เดียวคือรับ HTML
(ที่หน้าเว็บสร้างไว้แล้ว) มาพิมพ์เป็น PDF แล้วส่งไฟล์กลับ

## ติดตั้งและรัน

```bash
cd server
npm install       # ครั้งแรกจะดาวน์โหลด Chromium ให้ Puppeteer อัตโนมัติ (~200MB)
npm start         # ค่าเริ่มต้น: http://localhost:4790
```

ทดสอบว่าทำงานอยู่:

```bash
curl http://localhost:4790/health
# {"ok":true,"service":"dlf-pdf-export-backend"}
```

## ตั้งค่าฝั่งหน้าเว็บ

เปิดแอป → เมนู **"Google Sheets"** (ด้านซ้าย) → หัวข้อ **"PDF Export Backend"** → วาง URL
ของ backend (เช่น `http://localhost:4790` ตอนพัฒนา หรือ URL จริงตอน deploy) แล้วกด
**"✔ ตั้งค่า URL"** ระบบจะทดสอบเชื่อมต่อให้ทันทีและจดจำค่าไว้ (localStorage) สำหรับใช้ครั้งถัดไป

จากนั้นปุ่ม "Export PDF" ทุกจุดในแอป (แบบฟอร์มโครงการ, รายงานภาพรวม/รายยุทธศาสตร์,
รายงานผลรายไตรมาส, รายงานฉบับสมบูรณ์) จะเรียก backend นี้โดยอัตโนมัติ

## ตัวแปรแวดล้อม (optional)

| ตัวแปร        | ค่าเริ่มต้น | คำอธิบาย                                                             |
|---------------|-------------|------------------------------------------------------------------------|
| `PORT`        | `4790`      | พอร์ตที่ให้บริการ                                                     |
| `PDF_API_KEY` | (ไม่มี)     | ถ้าตั้งไว้ ผู้เรียกต้องส่ง header `x-api-key: <ค่านี้>` มาด้วย         |
| `CORS_ORIGIN` | `*`         | origin ที่อนุญาตให้เรียก (เช่น `https://your-app.example.com`)         |

ตัวอย่างรันแบบตั้งค่า:

```bash
PORT=4790 PDF_API_KEY=mysecret CORS_ORIGIN=https://your-app.example.com npm start
```

ถ้าตั้ง `PDF_API_KEY` ไว้ ให้แก้ `fetch(...)` ใน `_runPdfExport` (assets/app-pdf-export.js)
เพิ่ม header `'x-api-key': '<ค่าเดียวกัน>'` เข้าไปด้วย

## Deploy จริง (production)

รันได้ทุกที่ที่รอง Node.js 18+ และอนุญาตให้ Puppeteer ดาวน์โหลด/รัน Chromium ได้ เช่น
VPS ธรรมดา, Docker, Railway, Render, Fly.io ฯลฯ ข้อควรระวัง:

1. **หน่วยความจำ**: Chromium headless กิน RAM ราว 200–400MB ต่อการ export หนึ่งครั้ง —
   เครื่อง/คอนเทนเนอร์เล็กเกินไป (เช่น 512MB) อาจ crash เวลามีคำขอพร้อมกันหลายอัน
2. **`--no-sandbox`**: จำเป็นบนคอนเทนเนอร์ส่วนใหญ่ (Docker/CI) เพราะ sandbox ของ Chromium
   ต้องการสิทธิ์ที่คอนเทนเนอร์ปกติไม่มี (มีอยู่แล้วใน `server.js`)
3. **HTTPS**: ถ้าหน้าเว็บ deploy บน HTTPS (เช่น GitHub Pages) ต้องเรียก backend ผ่าน HTTPS
   ด้วยเช่นกัน (mixed-content จะถูกเบราว์เซอร์บล็อก) — ใช้ reverse proxy (Nginx/Caddy) หรือ
   บริการที่มี TLS ให้ในตัวอยู่แล้ว
4. **ฟอนต์ไทย (Sarabun)**: ค่าเริ่มต้นโหลดจาก Google Fonts ตอนเรนเดอร์ (ต้องมีอินเทอร์เน็ต
   บนเซิร์ฟเวอร์) ถ้าต้องการรันแบบออฟไลน์ล้วน ให้ดาวน์โหลดไฟล์ `.woff2` ของ Sarabun มาไว้ใน
   `server/fonts/` แล้วแก้ `PRINT_CSS`/`wrapHtmlDocument` ใน `server.js` ให้ใช้
   `@font-face { src: url('fonts/Sarabun-Regular.woff2') ... }` แทนบรรทัด `@import`
5. ปิดกั้นการเรียกจากที่อื่นด้วย `PDF_API_KEY` และ/หรือ `CORS_ORIGIN` เมื่อ deploy ขึ้นสาธารณะ
   (endpoint นี้สั่งให้เซิร์ฟเวอร์เปิดเบราว์เซอร์เรนเดอร์ HTML ได้ ถ้าเปิดโล่งอาจถูกใช้ยิงเปลือง
   ทรัพยากรได้)

## Docker (ตัวอย่าง)

```dockerfile
FROM node:20-slim
# ไลบรารีระบบที่ Chromium ต้องใช้
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 libxcomposite1 \
    libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=4790
EXPOSE 4790
CMD ["npm", "start"]
```

## API

### `GET /health`
คืนค่า `{ ok: true, service: "dlf-pdf-export-backend" }` — ใช้ตรวจสอบว่า backend ทำงานอยู่

### `POST /api/export-pdf`
Body (JSON):

```json
{
  "html": "<div>...HTML เนื้อหาเอกสาร (จาก _buildFormHTML ฯลฯ)...</div>",
  "headerOpts": {
    "logoSrc": "data:image/png;base64,...",
    "title": "แผนปฏิบัติการประจำปีงบประมาณ พ.ศ. 2570",
    "subtitle": "มูลนิธิการศึกษาทางไกลผ่านดาวเทียม ในพระบรมราชูปถัมภ์",
    "subtitle2": "ข้อความบรรทัดที่ 3 (ไม่บังคับ)"
  },
  "filename": "แผนปฏิบัติการ_2570_ชื่อโครงการ"
}
```

- `headerOpts` ไม่บังคับ — ถ้าไม่ส่งมาจะไม่มีหัวกระดาษ (เว้นระยะขอบบนน้อยลง)
- คืนค่าเป็นไฟล์ `application/pdf` โดยตรง (ไม่ใช่ JSON) เมื่อสำเร็จ
- เมื่อเกิดข้อผิดพลาด คืนค่า `4xx/5xx` พร้อม JSON `{ success:false, message:"..." }`
