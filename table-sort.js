/* Tüm liste tablolarında sütun başlığına tıklayarak sıralama (artan/azalan).
   Uygulama tabloları innerHTML ile yeniden çizdiği için MutationObserver ile
   yeni tablolar otomatik algılanır ve son sıralama durumu geri yüklenir. */
(function () {
  'use strict';

  var collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
  var sortState = {}; // başlık imzası -> { col, dir }

  var DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
  var NUM_RE = /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:\s*\S{0,12})?$/;

  function cellText(td) {
    if (!td) return '';
    var v = td.getAttribute('data-sort');
    if (v !== null) return v.trim();
    return (td.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isEmpty(t) { return t === '' || t === '—' || t === '-'; }

  function toDate(t) {
    var m = DATE_RE.exec(t);
    return m ? parseInt(m[3] + m[2] + m[1], 10) : null;
  }

  function toNum(t) {
    if (!NUM_RE.test(t)) return null;
    var m = /^[-+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?/.exec(t);
    if (!m) return null;
    var n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function columnType(rows, col) {
    var allDate = true, allNum = true, any = false;
    rows.forEach(function (r) {
      var t = cellText(r.cells[col]);
      if (isEmpty(t)) return;
      any = true;
      if (toDate(t) === null) allDate = false;
      if (toNum(t) === null) allNum = false;
    });
    if (!any) return 'text';
    if (allDate) return 'date';
    if (allNum) return 'num';
    return 'text';
  }

  function signature(table) {
    return Array.prototype.map.call(table.tHead.rows[0].cells, function (th) {
      return (th.textContent || '').trim();
    }).join('|');
  }

  function sortTable(table, col, dir) {
    var tbody = table.tBodies[0];
    if (!tbody) return;
    var rows = Array.prototype.slice.call(tbody.rows);
    var type = columnType(rows, col);

    var keyed = rows.map(function (r, i) {
      var t = cellText(r.cells[col]);
      var v = null;
      if (!isEmpty(t)) v = type === 'date' ? toDate(t) : (type === 'num' ? toNum(t) : t);
      return { r: r, i: i, v: v };
    });

    keyed.sort(function (a, b) {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;   // boş değerler her zaman sonda
      if (b.v === null) return -1;
      var c = type === 'text' ? collator.compare(a.v, b.v) : (a.v - b.v);
      if (c === 0) return a.i - b.i;
      return dir === 'asc' ? c : -c;
    });

    var frag = document.createDocumentFragment();
    keyed.forEach(function (k) { frag.appendChild(k.r); });
    tbody.appendChild(frag);

    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th, idx) {
      th.removeAttribute('aria-sort');
      th.classList.remove('sort-asc', 'sort-desc');
      if (idx === col) {
        th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function eligible(table) {
    if (table.getAttribute('data-sortinit')) return false;
    if (table.classList.contains('print-table') || table.classList.contains('print-header-table')) return false;
    if (table.closest('.print-area, #print-area, .print-root')) return false;
    if (!table.tHead || !table.tHead.rows.length || !table.tBodies.length) return false;
    // Birleştirilmiş hücre (boş durum / grup satırı) içeren tabloları atla
    var rows = table.tBodies[0].rows;
    if (!rows.length) return false;
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < rows[i].cells.length; j++) {
        if (rows[i].cells[j].colSpan > 1) return false;
      }
    }
    return true;
  }

  function init(table) {
    table.setAttribute('data-sortinit', '1');
    var sig = signature(table);
    var ths = table.tHead.rows[0].cells;
    Array.prototype.forEach.call(ths, function (th, idx) {
      if (!(th.textContent || '').trim()) return; // işlem sütunları
      th.classList.add('sortable-th');
      th.setAttribute('title', 'Sıralamak için tıklayın');
      th.addEventListener('click', function () {
        var st = sortState[sig];
        var dir = (st && st.col === idx && st.dir === 'asc') ? 'desc' : 'asc';
        sortState[sig] = { col: idx, dir: dir };
        sortTable(table, idx, dir);
      });
    });
    var st = sortState[sig];
    if (st && st.col < ths.length) sortTable(table, st.col, st.dir);
  }

  function scan() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      if (eligible(tables[i])) init(tables[i]);
    }
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; scan(); }, 0);
  }

  var css = document.createElement('style');
  css.textContent =
    'th.sortable-th{cursor:pointer; user-select:none; white-space:nowrap;}' +
    'th.sortable-th:hover{color:var(--ink,#222);}' +
    'th.sortable-th::after{content:" \\2195"; opacity:.3; font-size:10px;}' +
    'th.sortable-th.sort-asc::after{content:" \\25B2"; opacity:1;}' +
    'th.sortable-th.sort-desc::after{content:" \\25BC"; opacity:1;}';
  document.head.appendChild(css);

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
