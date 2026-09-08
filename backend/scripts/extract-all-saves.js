const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../../fabrika-bakim.html');
const content = fs.readFileSync(targetFile, 'utf8');

// Find all onclick="save... or onclick="delete... or window.save...
const regex = /window\.(save\w+|delete\w+)\s*=\s*(?:async\s*)?function\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\};/g;

let match;
while ((match = regex.exec(content)) !== null) {
  const fnName = match[1];
  const params = match[2];
  const body = match[3];
  console.log(`\n================== ${fnName}(${params}) ==================`);
  // print first 500 chars of body
  console.log(body.slice(0, 450).replace(/\n\s+/g, '\n  '));
}
