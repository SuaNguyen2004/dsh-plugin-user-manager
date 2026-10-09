import fs from "node:fs";
import path from "node:path";

// Standard CRC32 calculator for ZIP archives
function crc32(buf) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c;
    }
    let crc = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
}

// Minimal in-memory ZIP builder (creates valid .docx archives)
export function createZipArchive(entries) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const entry of entries) {
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
        const nameBuf = Buffer.from(entry.name, "utf8");
        const crc = crc32(data);

        // Local file header (30 bytes + name)
        const lh = Buffer.alloc(30 + nameBuf.length);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4); // version needed
        lh.writeUInt16LE(0, 6); // flags
        lh.writeUInt16LE(0, 8); // compression = 0 (store)
        lh.writeUInt16LE(0, 10);
        lh.writeUInt16LE(0, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(data.length, 18);
        lh.writeUInt32LE(data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        nameBuf.copy(lh, 30);
        localHeaders.push(lh, data);

        // Central directory header (46 bytes + name)
        const ch = Buffer.alloc(46 + nameBuf.length);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0, 8);
        ch.writeUInt16LE(0, 10);
        ch.writeUInt16LE(0, 12);
        ch.writeUInt16LE(0, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(data.length, 20);
        ch.writeUInt32LE(data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt16LE(0, 30);
        ch.writeUInt16LE(0, 32);
        ch.writeUInt16LE(0, 34);
        ch.writeUInt16LE(0, 36);
        ch.writeUInt32LE(0, 38);
        ch.writeUInt32LE(offset, 42);
        nameBuf.copy(ch, 46);
        centralHeaders.push(ch);

        offset += lh.length + data.length;
    }

    const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * 1. Generate 2-page valid PDF with distinct text on Page 1 and Page 2
 */
export function buildMultiPagePdfBuffer() {
    const p1Text = "TRANG 1: CONG HOA XA HOI CHU NGHIA VIET NAM - DOC LAP TU DO HANH PHUC";
    const p2Text = "TRANG 2: KET QUA DANH GIA VA TIEP TUC NOI DUNG TRANG THU HAI";

    const stream1 = `BT /F1 12 Tf 50 700 Td (${p1Text}) Tj ET`;
    const stream2 = `BT /F1 12 Tf 50 700 Td (${p2Text}) Tj ET`;

    let pdf = "%PDF-1.4\n";
    const offsets = [];

    function addObj(content) {
        offsets.push(pdf.length);
        pdf += content + "\n";
    }

    addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj");
    addObj(
        "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj",
    );
    addObj(
        "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj",
    );
    addObj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
    addObj(`6 0 obj\n<< /Length ${Buffer.byteLength(stream1)} >>\nstream\n${stream1}\nendstream\nendobj`);
    addObj(`7 0 obj\n<< /Length ${Buffer.byteLength(stream2)} >>\nstream\n${stream2}\nendstream\nendobj`);

    const xrefOffset = pdf.length;
    pdf += "xref\n0 8\n0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

/**
 * 2. Generate DOCX with paragraphs and a Markdown-convertible table
 */
export function buildTableDocxBuffer() {
    const contentTypes =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>";

    const rels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>";

    const documentXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        "<w:body>" +
        "<w:p><w:r><w:t>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>BẢNG KÊ TIẾN ĐỘ THỰC HIỆN CÔNG VIỆC</w:t></w:r></w:p>" +
        "<w:tbl>" +
        "<w:tr>" +
        "<w:tc><w:p><w:r><w:t>Hạng mục công việc</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>Trạng thái thực hiện</w:t></w:r></w:p></w:tc>" +
        "</w:tr>" +
        "<w:tr>" +
        "<w:tc><w:p><w:r><w:t>Xác thực người dùng DSH</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>Hoàn thành xuất sắc</w:t></w:r></w:p></w:tc>" +
        "</w:tr>" +
        "<w:tr>" +
        "<w:tc><w:p><w:r><w:t>Trích xuất PDF/DOCX/TXT</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>Đạt yêu cầu bảo mật</w:t></w:r></w:p></w:tc>" +
        "</w:tr>" +
        "</w:tbl>" +
        "<w:p><w:r><w:t>Ghi chú kết thúc bảng: Tất cả mục đã được kiểm duyệt.</w:t></w:r></w:p>" +
        "</w:body>" +
        "</w:document>";

    return createZipArchive([
        { name: "[Content_Types].xml", data: contentTypes },
        { name: "_rels/.rels", data: rels },
        { name: "word/document.xml", data: documentXml },
    ]);
}

/**
 * 3. Generate UTF-8 text with BOM and Vietnamese diacritics
 */
export function buildVietnameseBomTxtBuffer() {
    const content =
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\nNội dung văn bản tiếng Việt có dấu: Hà Nội, Đà Nẵng, TP. Hồ Chí Minh.\nCác ký tự: ă, â, đ, ê, ô, ơ, ư, ỹ, ỷ, ạ, ặ, ậ.";
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")]);
}

/**
 * 4. Generate invalid UTF-8 without null bytes (fails TextDecoder fatal check)
 */
export function buildInvalidUtf8NoNullBuffer() {
    // 0xC3 0x28 is an invalid UTF-8 byte sequence (leading 2-byte without valid trail)
    return Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xc3, 0x28, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
}

/**
 * 5. Generate Blank PDF (1 page with NO text and NO graphics)
 */
export function buildBlankPdfBuffer() {
    let pdf = "%PDF-1.4\n";
    const offsets = [];

    function addObj(content) {
        offsets.push(pdf.length);
        pdf += content + "\n";
    }

    addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj");

    const xrefOffset = pdf.length;
    pdf += "xref\n0 4\n0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

/**
 * 6. Generate Scanned PDF (1 page with real inline image bitmap, NO text layer)
 */
export function buildScannedPdfBuffer() {
    const imgStream = "q 50 0 0 50 100 100 cm\nBI\n/W 1\n/H 1\n/CS /DeviceGray\n/BPC 8\nID\n\xffEI\nQ";

    let pdf = "%PDF-1.4\n";
    const offsets = [];

    function addObj(content) {
        offsets.push(pdf.length);
        pdf += content + "\n";
    }

    addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj");
    addObj(`4 0 obj\n<< /Length ${imgStream.length} >>\nstream\n${imgStream}\nendstream\nendobj`);

    const xrefOffset = pdf.length;
    pdf += "xref\n0 5\n0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

/**
 * 6b. Generate Vector PDF (1 page with vector shapes, NO text layer and NO images)
 */
export function buildVectorNoTextPdfBuffer() {
    const graphicsStream = "100 100 200 200 re f";

    let pdf = "%PDF-1.4\n";
    const offsets = [];

    function addObj(content) {
        offsets.push(pdf.length);
        pdf += content + "\n";
    }

    addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj");
    addObj(`4 0 obj\n<< /Length ${graphicsStream.length} >>\nstream\n${graphicsStream}\nendstream\nendobj`);

    const xrefOffset = pdf.length;
    pdf += "xref\n0 5\n0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

/**
 * 7. Generate Password-protected PDF
 */
export function buildPasswordProtectedPdfBuffer() {
    let pdf = "%PDF-1.4\n";
    const offsets = [];

    function addObj(content) {
        offsets.push(pdf.length);
        pdf += content + "\n";
    }

    addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
    addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
    addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj");
    addObj(
        "4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (12345678901234567890123456789012) /U (12345678901234567890123456789012) /P -4 >>\nendobj",
    );

    const xrefOffset = pdf.length;
    pdf += "xref\n0 5\n0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += String(off).padStart(10, "0") + " 00000 n \n";
    }
    pdf += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(pdf, "utf8");
}

/**
 * 8. Generate Corrupted file (garbage bytes)
 */
export function buildCorruptedBuffer() {
    return Buffer.from("NOT A VALID DOCUMENT CONTENT - CORRUPTED HEADER");
}

/**
 * 9. Generate Large DOCX file (>100KB text payload) for IPC transmission tests
 */
export function buildLargeDocxBuffer(paragraphCount = 500) {
    const contentTypes =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>';

    const rels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>';

    const paragraphs = [];
    for (let i = 1; i <= paragraphCount; i++) {
        paragraphs.push(`<w:p><w:r><w:t>Đoạn văn ${i}: Nội dung tài liệu kiểm tra dung lượng lớn qua worker IPC với dữ liệu tiếng Việt đầy đủ.</w:t></w:r></w:p>`);
    }

    const documentXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        paragraphs.join('') +
        '</w:body>' +
        '</w:document>';

    return createZipArchive([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: documentXml }
    ]);
}

/**
 * Write all synthetic test fixtures into target directory
 */
export function writeAllFixtures(targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    const files = {
        pdfMultiPage: path.join(targetDir, "sample_multipage.pdf"),
        docxTable: path.join(targetDir, "sample_table.docx"),
        txtBom: path.join(targetDir, "sample_bom.txt"),
        txtInvalidUtf8: path.join(targetDir, "sample_invalid_utf8.txt"),
        pdfBlank: path.join(targetDir, "sample_blank.pdf"),
        pdfVectorNoText: path.join(targetDir, "sample_vector_notext.pdf"),
        pdfScanned: path.join(targetDir, "sample_scanned.pdf"),
        pdfPassword: path.join(targetDir, "sample_password.pdf"),
        pdfCorrupt: path.join(targetDir, "sample_corrupt.pdf"),
        docxCorrupt: path.join(targetDir, "sample_corrupt.docx"),
        over20Mb: path.join(targetDir, "sample_over20mb.txt"),
    };

    fs.writeFileSync(files.pdfMultiPage, buildMultiPagePdfBuffer());
    fs.writeFileSync(files.docxTable, buildTableDocxBuffer());
    fs.writeFileSync(files.txtBom, buildVietnameseBomTxtBuffer());
    fs.writeFileSync(files.txtInvalidUtf8, buildInvalidUtf8NoNullBuffer());
    fs.writeFileSync(files.pdfBlank, buildBlankPdfBuffer());
    fs.writeFileSync(files.pdfVectorNoText, buildVectorNoTextPdfBuffer());
    fs.writeFileSync(files.pdfScanned, buildScannedPdfBuffer());
    fs.writeFileSync(files.pdfPassword, buildPasswordProtectedPdfBuffer());
    fs.writeFileSync(files.pdfCorrupt, buildCorruptedBuffer());
    fs.writeFileSync(files.docxCorrupt, buildCorruptedBuffer());

    // Create >20MB file efficiently
    const largeHeader = Buffer.from("LARGE FILE OVER 20MB\n");
    const fd = fs.openSync(files.over20Mb, "w");
    fs.writeSync(fd, largeHeader, 0, largeHeader.length, 0);
    // Truncate to 20MB + 1024 bytes
    fs.ftruncateSync(fd, 20 * 1024 * 1024 + 1024);
    fs.closeSync(fd);

    return files;
}
