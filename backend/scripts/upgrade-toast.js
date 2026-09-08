const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../../cmms-sync.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace alert with toast.error or toast.info
content = content.replace(/alert\((.*?)\);/g, (match, p1) => {
  if (p1.includes('zorunludur') || p1.includes('geçmemelidir') || p1.includes('seçmelisiniz') || p1.includes('gereklidir')) {
    return `toast.error(${p1});`;
  }
  return `toast.error(${p1});`;
});

// Add toast.success messages before closeModal / renderTab in save functions
const successReplacements = [
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Varlık kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success(id ? 'Varlık güncellendi.' : 'Yeni varlık başarıyla kaydedildi.');\n    } catch (err) {\n      toast.error('Varlık kaydedilemedi"
  },
  {
    target: "await loadDB();\n        renderTab();\n      } catch (err) {\n        toast.error('Silme başarısız: '",
    replace: "await loadDB();\n        renderTab();\n        toast.success('Varlık silindi.');\n      } catch (err) {\n        toast.error('Silme başarısız: '"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Grup kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success(id ? 'Varlık grubu güncellendi.' : 'Yeni grup kaydedildi.');\n    } catch (err) {\n      toast.error('Grup kaydedilemedi"
  },
  {
    target: "await loadDB();\n        renderTab();\n      } catch (err) {\n        toast.error('Grup silinemedi: '",
    replace: "await loadDB();\n        renderTab();\n        toast.success('Grup silindi.');\n      } catch (err) {\n        toast.error('Grup silinemedi: '"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Malzeme kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success(id ? 'Malzeme güncellendi.' : 'Yeni malzeme kaydedildi.');\n    } catch (err) {\n      toast.error('Malzeme kaydedilemedi"
  },
  {
    target: "await loadDB();\n        renderTab();\n      } catch (err) {\n        toast.error('Malzeme silinemedi: '",
    replace: "await loadDB();\n        renderTab();\n        toast.success('Malzeme silindi.');\n      } catch (err) {\n        toast.error('Malzeme silinemedi: '"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Stok düzeltmesi başarısız",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success('Stok düzeltmesi uygulandı.');\n    } catch (err) {\n      toast.error('Stok düzeltmesi başarısız"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('İhtiyaç eklenemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success('İhtiyaç listesine eklendi.');\n    } catch (err) {\n      toast.error('İhtiyaç eklenemedi"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Tedarikçi kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success(id ? 'Tedarikçi güncellendi.' : 'Yeni tedarikçi eklendi.');\n    } catch (err) {\n      toast.error('Tedarikçi kaydedilemedi"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Satın alma kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success(editId ? 'Satın alma güncellendi.' : 'Satın alma işlendi ve stok güncellendi.');\n    } catch (err) {\n      toast.error('Satın alma kaydedilemedi"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderTab();\n    } catch (err) {\n      toast.error('Arıza kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderTab();\n      toast.success('Arıza bildirimi oluşturuldu.');\n    } catch (err) {\n      toast.error('Arıza kaydedilemedi"
  },
  {
    target: "await loadDB();\n      closeModal();\n      renderApp();\n    } catch (err) {\n      toast.error('Kullanıcı kaydedilemedi",
    replace: "await loadDB();\n      closeModal();\n      renderApp();\n      toast.success(id ? 'Kullanıcı güncellendi.' : 'Yeni kullanıcı oluşturuldu.');\n    } catch (err) {\n      toast.error('Kullanıcı kaydedilemedi"
  },
];

for (const r of successReplacements) {
  content = content.replace(r.target, r.replace);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ cmms-sync.js dosyasındaki alert çağrıları toast ile güncellendi.');
