const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../../fabrika-bakim.html');
const content = fs.readFileSync(targetFile, 'utf8');

function findSnippet(keyword) {
  let pos = 0;
  while ((pos = content.indexOf(keyword, pos)) !== -1) {
    console.log(`\n--- FOUND "${keyword}" at ${pos} ---`);
    console.log(content.slice(Math.max(0, pos - 100), Math.min(content.length, pos + 400)));
    pos += keyword.length;
  }
}

console.log('=== SEARCHING FOR GROUP MODAL ===');
findSnippet('Varlık Grubu Düzenle');
findSnippet('Yeni Varlık Grubu');

console.log('=== SEARCHING FOR MAINTENANCE SAVE ===');
findSnippet('Bakımı Tamamla');
findSnippet('saveMaint');

console.log('=== SEARCHING FOR PROJECT SAVE ===');
findSnippet('Yeni Proje');
findSnippet('Proje Düzenle');
