const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../../fabrika-bakim.html');
let content = fs.readFileSync(targetFile, 'utf8');

// Pattern: <label class="f-label">Title</label><(input|select|textarea) id="elemId"
const regex = /<label class="f-label">([^<]+)<\/label><(input|select|textarea)\s+id="([^"]+)"/g;

let count = 0;
const updated = content.replace(regex, (match, labelText, tag, elemId) => {
  count++;
  return `<label class="f-label" for="${elemId}">${labelText}</label><${tag} id="${elemId}"`;
});

fs.writeFileSync(targetFile, updated, 'utf8');
console.log(`✅ ${count} adet form alanına WCAG uyumlu <label for="..."> eşleşmesi eklendi.`);
