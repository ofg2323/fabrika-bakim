const fs = require('fs');
const path = require('path');

const targetFile = path.resolve(__dirname, '../../fabrika-bakim.html');
const content = fs.readFileSync(targetFile, 'utf8');

const saveFns = [
  'saveAsset',
  'saveAssetGroup',
  'saveMaterial',
  'saveStockAdjust',
  'saveNeed',
  'saveSupplier',
  'savePurchase',
  'saveMaintenance',
  'saveFault',
  'saveInspectionForm',
  'saveExtMaintForm',
  'saveProject',
  'saveUser',
  'saveFirstUser'
];

for (const fn of saveFns) {
  const idx = content.indexOf(`window.${fn} =`);
  if (idx !== -1) {
    console.log(`\n================= ${fn} =================`);
    console.log(content.slice(idx, idx + 800));
  } else {
    // try function fn(
    const idx2 = content.indexOf(`function ${fn}(`);
    if (idx2 !== -1) {
      console.log(`\n================= function ${fn} =================`);
      console.log(content.slice(idx2, idx2 + 800));
    } else {
      console.log(`\n❌ NOT FOUND: ${fn}`);
    }
  }
}
