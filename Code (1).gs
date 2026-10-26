/**
 * CRM Kredit & Pemasaran — Bank Sultra Cabang Pasarwajo
 * Backend (API) Google Apps Script. Database: spreadsheet tempat script ini ditempel.
 * Tampilan: index.html di GitHub Pages (repo sofianaopi/CRMBPDpasarwajo).
 *
 * Sheet yang dipakai (dibuat otomatis oleh fungsi setup()):
 *   Pengguna : akun login pegawai & pimpinan (password disimpan sebagai hash)
 *   Target   : target bulanan per pegawai (debitur & nominal)
 *   Prospek  : daftar calon nasabah beserta statusnya
 *
 * Aturan akses (ditegakkan di server, bukan di tampilan):
 *   - Pegawai hanya menerima & mengubah prospek miliknya sendiri, dan hanya melihat targetnya sendiri.
 *   - Pimpinan melihat semua data, mengatur target, dan mengelola akun pegawai.
 *   - Spreadsheet JANGAN dibagikan ke pegawai; mereka cukup memakai alamat GitHub Pages.
 */

const SHEETS = {
  Pengguna: ['username', 'nama', 'jabatan', 'role', 'aktif', 'gantiPassword', 'salt', 'passwordHash', 'passwordAwal'],
  Target: ['username', 'periode', 'targetDebitur', 'targetNominal', 'diubahOleh', 'diubahTgl'],
  Prospek: ['id', 'username', 'nama', 'telp', 'alamat', 'produk', 'plafon', 'status', 'catatan', 'tglInput', 'tglUpdate', 'tglSelesai']
};
const TEXT_COLS = {
  Pengguna: ['username', 'salt', 'passwordHash', 'passwordAwal'],
  Target: ['username', 'periode', 'diubahTgl'],
  Prospek: ['id', 'username', 'telp', 'tglInput', 'tglUpdate', 'tglSelesai']
};
const STATUS = ['baru', 'dihubungi', 'berkas', 'analisa', 'disetujui', 'cair', 'batal'];
const ACTIVE = ['baru', 'dihubungi', 'berkas', 'analisa', 'disetujui'];
const PRODUK = ['KUR Mikro', 'KUR Kecil', 'Kredit Konsumtif ASN', 'Kredit Pensiunan', 'Kredit Modal Kerja', 'Kredit Pemilikan Rumah'];
const SESSION_SECONDS = 6 * 60 * 60; // 6 jam
const HASH_ROUNDS = 300;

/* ============================== WEB APP ============================== */

/**
 * Tampilan web ada di GitHub Pages (index.html). Apps Script hanya melayani API:
 * index.html mengirim POST berisi {fn, args} lalu menerima {ok, data | error}.
 */
const API = {
  login: login, logout: logout, gantiPassword: gantiPassword,
  getData: getData, saveProspek: saveProspek, setStatus: setStatus,
  saveTarget: saveTarget, tambahPengguna: tambahPengguna, resetPassword: resetPassword, setAktif: setAktif
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[req.fn];
    if (!fn) throw new Error('Perintah tidak dikenal.');
    out = { ok: true, data: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Dibuka langsung di browser hanya untuk mengecek server hidup. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'CRM Kredit Bank Sultra Pasarwajo', status: 'server aktif' }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================== SETUP ============================== */

/**
 * Jalankan SEKALI dari editor Apps Script (pilih fungsi "setup" lalu Run).
 * Membuat sheet + akun pimpinan pertama. Password awal ditampilkan di Execution log.
 */
function setup() {
  const ss = ss_();
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f3b35').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    TEXT_COLS[name].forEach(col => {
      const c = head.indexOf(col) + 1;
      sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });
  const pengguna = read_('Pengguna');
  if (!pengguna.some(u => u.role === 'pimpinan')) {
    const temp = tempPassword_();
    const salt = Utilities.getUuid();
    append_('Pengguna', {
      username: 'pimpinan', nama: 'Pimpinan Cabang', jabatan: 'Pimpinan Cabang', role: 'pimpinan',
      aktif: true, gantiPassword: true, salt: salt, passwordHash: hash_(salt, temp)
    });
    Logger.log('Akun pimpinan dibuat. Username: pimpinan | Password awal: ' + temp + ' (wajib diganti saat login pertama)');
  } else {
    Logger.log('Sheet sudah siap. Akun pimpinan sudah ada.');
  }
}

/* ============================== AUTH ============================== */

function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.');

  const user = read_('Pengguna').find(u => u.username === username);
  if (!user || user.aktif === false || !cekPassword_(user, password)) {
    cache.put(failKey, String(fails + 1), 15 * 60);
    throw new Error('Username atau password salah.');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('s_' + token, user.username, SESSION_SECONDS);
  const pub = pub_(user);
  if (pakaiPasswordAwal_(user)) pub.gantiPassword = true; // wajib ganti saat login pakai password awal
  return { token: token, user: pub };
}

/**
 * Password awal diketik admin langsung di kolom passwordAwal sheet Pengguna.
 * Selama kolom itu terisi, password itulah yang berlaku (juga untuk mereset password lupa).
 * Begitu pengguna mengganti password, kolom ini dikosongkan dan diganti hash.
 */
function pakaiPasswordAwal_(user) {
  return String(user.passwordAwal || '') !== '';
}
function cekPassword_(user, password) {
  password = String(password || '');
  if (pakaiPasswordAwal_(user)) return password === String(user.passwordAwal);
  return !!user.passwordHash && hash_(user.salt, password) === user.passwordHash;
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('s_' + token);
  return true;
}

function gantiPassword(token, lama, baru) {
  const me = auth_(token);
  if (!cekPassword_(me, lama)) throw new Error('Password lama salah.');
  baru = String(baru || '');
  if (baru.length < 8) throw new Error('Password baru minimal 8 karakter.');
  if (baru === lama) throw new Error('Password baru harus berbeda dari password lama.');
  return withLock_(() => {
    const salt = Utilities.getUuid();
    update_('Pengguna', me._row, Object.assign({}, me, { salt: salt, passwordHash: hash_(salt, baru), gantiPassword: false, passwordAwal: '' }));
    return true;
  });
}

/* ============================== DATA ============================== */

/** Data untuk layar. Pegawai hanya menerima miliknya sendiri. */
function getData(token, periode) {
  const me = auth_(token);
  periode = validPeriode_(periode);
  const users = read_('Pengguna');
  const targets = read_('Target');
  let prospek = read_('Prospek');
  const isPimpinan = me.role === 'pimpinan';
  if (!isPimpinan) prospek = prospek.filter(p => p.username === me.username);

  const subjects = isPimpinan ? users.filter(u => u.role === 'pegawai') : [me];
  const stats = subjects.map(u => {
    const mine = prospek.filter(p => p.username === u.username);
    const cair = mine.filter(p => p.status === 'cair' && String(p.tglSelesai).slice(0, 7) === periode);
    const t = targetFor_(targets, u.username, periode);
    return {
      username: u.username, nama: u.nama, jabatan: u.jabatan, aktif: u.aktif !== false,
      berjalan: mine.filter(p => ACTIVE.indexOf(p.status) >= 0).length,
      masuk: mine.filter(p => String(p.tglInput).slice(0, 7) === periode).length,
      debitur: cair.length,
      nominal: cair.reduce((a, p) => a + (Number(p.plafon) || 0), 0),
      targetDebitur: t.debitur, targetNominal: t.nominal, targetPeriode: t.periode
    };
  });

  return {
    me: pub_(me),
    periode: periode,
    today: today_(),
    produk: PRODUK,
    stats: stats,
    prospek: prospek.map(p => {
      const o = clean_(p);
      if (isPimpinan) {
        const u = users.find(x => x.username === p.username);
        o.namaPegawai = u ? u.nama : p.username;
      }
      return o;
    })
  };
}

/** Tambah / ubah prospek. Hanya pegawai, dan hanya milik sendiri. */
function saveProspek(token, p) {
  const me = auth_(token);
  if (me.role !== 'pegawai') throw new Error('Hanya pegawai yang menginput prospek.');
  p = p || {};
  const nama = String(p.nama || '').trim().slice(0, 80);
  if (!nama) throw new Error('Nama calon nasabah wajib diisi.');
  const status = STATUS.indexOf(p.status) >= 0 ? p.status : 'baru';
  const produk = PRODUK.indexOf(p.produk) >= 0 ? p.produk : PRODUK[0];
  const data = {
    nama: nama,
    telp: String(p.telp || '').replace(/[^\d+]/g, '').slice(0, 20),
    alamat: String(p.alamat || '').trim().slice(0, 80),
    produk: produk,
    plafon: Math.max(0, Math.round(Number(p.plafon) || 0)),
    status: status,
    catatan: String(p.catatan || '').trim().slice(0, 200)
  };
  return withLock_(() => {
    const now = today_();
    if (p.id) {
      const row = read_('Prospek').find(x => x.id === p.id);
      if (!row || row.username !== me.username) throw new Error('Prospek tidak ditemukan.');
      const selesai = (status === 'cair' || status === 'batal') ? (row.status === status && row.tglSelesai ? row.tglSelesai : now) : '';
      update_('Prospek', row._row, Object.assign({}, row, data, { tglUpdate: now, tglSelesai: selesai }));
    } else {
      append_('Prospek', Object.assign({
        id: Utilities.getUuid().slice(0, 8), username: me.username, tglInput: now, tglUpdate: now,
        tglSelesai: (status === 'cair' || status === 'batal') ? now : ''
      }, data));
    }
    return true;
  });
}

/** Ubah status saja (tombol "Lanjut" / pilihan status). */
function setStatus(token, id, status) {
  const me = auth_(token);
  if (me.role !== 'pegawai') throw new Error('Hanya pegawai yang mengubah status prospek.');
  if (STATUS.indexOf(status) < 0) throw new Error('Status tidak dikenal.');
  return withLock_(() => {
    const row = read_('Prospek').find(x => x.id === id);
    if (!row || row.username !== me.username) throw new Error('Prospek tidak ditemukan.');
    if (row.status === status) return true;
    const now = today_();
    update_('Prospek', row._row, Object.assign({}, row, {
      status: status, tglUpdate: now, tglSelesai: (status === 'cair' || status === 'batal') ? now : ''
    }));
    return true;
  });
}

/* ============================== PIMPINAN ============================== */

function saveTarget(token, username, periode, debitur, nominal) {
  const me = requirePimpinan_(token);
  periode = validPeriode_(periode);
  const u = read_('Pengguna').find(x => x.username === username && x.role === 'pegawai');
  if (!u) throw new Error('Pegawai tidak ditemukan.');
  const obj = {
    username: username, periode: periode,
    targetDebitur: Math.max(0, Math.round(Number(debitur) || 0)),
    targetNominal: Math.max(0, Math.round(Number(nominal) || 0)),
    diubahOleh: me.username, diubahTgl: today_()
  };
  return withLock_(() => {
    const row = read_('Target').find(t => t.username === username && t.periode === periode);
    if (row) update_('Target', row._row, obj); else append_('Target', obj);
    return true;
  });
}

/** Tambah akun baru. Mengembalikan password sementara untuk diberikan ke pegawai. */
function tambahPengguna(token, u) {
  requirePimpinan_(token);
  u = u || {};
  const username = String(u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._]{3,30}$/.test(username)) throw new Error('Username 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.');
  const nama = String(u.nama || '').trim().slice(0, 60);
  if (!nama) throw new Error('Nama pegawai wajib diisi.');
  const role = u.role === 'pimpinan' ? 'pimpinan' : 'pegawai';
  return withLock_(() => {
    if (read_('Pengguna').some(x => x.username === username)) throw new Error('Username sudah dipakai.');
    const temp = tempPassword_();
    const salt = Utilities.getUuid();
    append_('Pengguna', {
      username: username, nama: nama, jabatan: String(u.jabatan || '').slice(0, 40), role: role,
      aktif: true, gantiPassword: true, salt: salt, passwordHash: hash_(salt, temp)
    });
    return { username: username, passwordSementara: temp };
  });
}

function resetPassword(token, username) {
  requirePimpinan_(token);
  return withLock_(() => {
    const u = read_('Pengguna').find(x => x.username === username);
    if (!u) throw new Error('Akun tidak ditemukan.');
    const temp = tempPassword_();
    const salt = Utilities.getUuid();
    update_('Pengguna', u._row, Object.assign({}, u, { salt: salt, passwordHash: hash_(salt, temp), gantiPassword: true, passwordAwal: '' }));
    return { username: username, passwordSementara: temp };
  });
}

function setAktif(token, username, aktif) {
  const me = requirePimpinan_(token);
  if (username === me.username) throw new Error('Anda tidak bisa menonaktifkan akun sendiri.');
  return withLock_(() => {
    const u = read_('Pengguna').find(x => x.username === username);
    if (!u) throw new Error('Akun tidak ditemukan.');
    update_('Pengguna', u._row, Object.assign({}, u, { aktif: !!aktif }));
    return true;
  });
}

/* ============================== HELPERS ============================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return Session.getScriptTimeZone() || 'Asia/Makassar'; }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

function auth_(token) {
  const username = token ? CacheService.getScriptCache().get('s_' + token) : null;
  if (!username) throw new Error('SESI_HABIS');
  const user = read_('Pengguna').find(u => u.username === username);
  if (!user || user.aktif === false) throw new Error('SESI_HABIS');
  CacheService.getScriptCache().put('s_' + token, username, SESSION_SECONDS); // perpanjang sesi
  return user;
}
function requirePimpinan_(token) {
  const me = auth_(token);
  if (me.role !== 'pimpinan') throw new Error('Menu ini hanya untuk pimpinan.');
  return me;
}
function pub_(u) {
  return { username: u.username, nama: u.nama, jabatan: u.jabatan, role: u.role, gantiPassword: u.gantiPassword === true || pakaiPasswordAwal_(u) };
}
function hash_(salt, pw) {
  let h = salt + '|' + pw;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}
function tempPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function validPeriode_(p) {
  p = String(p || '');
  return /^\d{4}-\d{2}$/.test(p) ? p : today_().slice(0, 7);
}
function targetFor_(targets, username, periode) {
  const rows = targets
    .filter(t => t.username === username && String(t.periode) <= periode)
    .sort((a, b) => String(b.periode).localeCompare(String(a.periode)));
  if (!rows.length) return { debitur: 0, nominal: 0, periode: '' };
  return { debitur: Number(rows[0].targetDebitur) || 0, nominal: Number(rows[0].targetNominal) || 0, periode: rows[0].periode };
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Server sedang sibuk. Coba lagi sebentar.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Baca sheet menjadi array objek; tanggal dinormalkan ke teks. */
function read_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" belum ada. Jalankan setup() dulu.');
  const values = sh.getDataRange().getValues();
  const head = values.shift() || [];
  const out = [];
  values.forEach((r, i) => {
    if (r[0] === '' || r[0] === null) return;
    const o = { _row: i + 2 };
    head.forEach((k, j) => { o[k] = norm_(k, r[j]); });
    out.push(o);
  });
  return out;
}
function norm_(key, v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), key === 'periode' ? 'yyyy-MM' : 'yyyy-MM-dd');
  // aktif: kosong dianggap aktif; hanya FALSE / "tidak" / "nonaktif" yang menonaktifkan
  if (key === 'aktif') return !(v === false || /^(false|tidak|nonaktif|0)$/i.test(String(v).trim()));
  if (key === 'gantiPassword') return v === true || String(v).toUpperCase() === 'TRUE';
  if (key === 'username') return String(v).trim().toLowerCase();
  if (key === 'role') return String(v).trim().toLowerCase() === 'pimpinan' ? 'pimpinan' : 'pegawai';
  if (typeof v === 'number' && (key === 'telp' || key === 'id' || key === 'passwordAwal')) return String(v);
  return v;
}
/** Susun baris mengikuti urutan judul kolom yang ADA di sheet, jadi urutan kolom aman diubah admin. */
function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }
function rowOf_(sh, obj) { return headers_(sh).map(k => (obj[k] === undefined || obj[k] === null) ? '' : obj[k]); }
function append_(name, obj) { const sh = ss_().getSheetByName(name); sh.appendRow(rowOf_(sh, obj)); }
function update_(name, row, obj) {
  const sh = ss_().getSheetByName(name);
  const vals = rowOf_(sh, obj);
  sh.getRange(row, 1, 1, vals.length).setValues([vals]);
}
function clean_(o) { const c = Object.assign({}, o); delete c._row; return c; }
