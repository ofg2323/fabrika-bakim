const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, r, g, b, a = 255) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits per channel
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw image data: scanline filter (0) + width * 4 bytes per row
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (1 + rowBytes));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + rowBytes);
    rawData[rowOffset] = 0; // None filter
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      // Border or solid fill
      const isBorder = (x < 4 || x >= width - 4 || y < 4 || y >= height - 4);
      rawData[pxOffset] = isBorder ? Math.max(0, r - 30) : r;
      rawData[pxOffset + 1] = isBorder ? Math.max(0, g - 30) : g;
      rawData[pxOffset + 2] = isBorder ? Math.max(0, b - 30) : b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const rootDir = path.resolve(__dirname, '../../');
const icoPath = path.join(rootDir, 'Fabrika Bakım Yönetimi.ico');

if (fs.existsSync(icoPath)) {
  console.log('ℹ️ Gerçek Fabrika Bakım Yönetimi.ico mevcut, üzerine yazılmadı.');
} else {
  // Fabrika Bakım Kurumsal Yeşil (#166534 -> R:22, G:101, B:52)
  const png192 = createPng(192, 192, 22, 101, 52);
  const png512 = createPng(512, 512, 22, 101, 52);
  fs.writeFileSync(path.join(rootDir, 'icon-192.png'), png192);
  fs.writeFileSync(path.join(rootDir, 'icon-512.png'), png512);
  fs.writeFileSync(path.join(rootDir, 'favicon.ico'), png192);
  console.log('✅ icon-192.png, icon-512.png ve favicon.ico oluşturuldu.');
}
