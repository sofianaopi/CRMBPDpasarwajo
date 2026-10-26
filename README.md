# CRM Kredit & Pemasaran — Bank Sultra Cabang Pasarwajo

Aplikasi web untuk mencatat prospek nasabah per pegawai kredit/marketing sampai pencairan,
mengatur target bulanan, dan memantau capaian lewat Dashboard pimpinan.

## Cara kerja

```
Pegawai / Pimpinan ──► GitHub Pages (index.html, tampilan)
                              │  POST {fn, args}
                              ▼
                     Google Apps Script (apps-script/Code.gs, API + aturan akses)
                              │
                              ▼
                     Google Sheets (database: Pengguna, Target, Prospek, Rekap Admin)
```

- **Tampilan** (`index.html`, `config.js`) di-host gratis di GitHub Pages dan bisa memakai domain sendiri.
- **Server** (`apps-script/Code.gs`) berjalan di Apps Script milik spreadsheet. Semua aturan login dan
  hak akses dicek di sini: pegawai hanya bisa melihat dan mengubah prospek serta target miliknya sendiri.
- **Data** tersimpan di Google Sheets dan **tidak** pernah masuk ke repository ini.

## Isi repository

| File | Fungsi |
|---|---|
| `index.html` | Halaman login, Dashboard pimpinan, input prospek pegawai |
| `config.js` | Alamat server Apps Script (`API_URL`) |
| `apps-script/Code.gs` | Kode server untuk ditempel di Apps Script spreadsheet |
| `.nojekyll` | Agar GitHub Pages menyajikan file apa adanya |

## Pemasangan

### 1. Server (Apps Script)
1. Buka spreadsheet database → **Ekstensi → Apps Script**.
2. Ganti seluruh isi `Code.gs` dengan isi `apps-script/Code.gs` dari repo ini, lalu simpan (Ctrl+S).
   File HTML `Index` lama boleh dihapus; tampilannya sekarang ada di GitHub Pages.
3. **Terapkan → Deployment baru → Aplikasi web**
   - Jalankan sebagai: **Saya**
   - Yang memiliki akses: **Siapa saja**
4. Salin **URL aplikasi web** (berakhiran `/exec`). Kalau dibuka di browser, URL itu menampilkan
   `"status":"server aktif"`.

> Setiap kali `Code.gs` diubah: **Terapkan → Kelola deployment → ✏️ → Versi baru → Terapkan**,
> supaya URL tetap sama.

### 2. Tampilan (GitHub Pages)
1. Edit `config.js` di GitHub, isi `API_URL` dengan URL dari langkah 1.4, lalu Commit.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
3. Setelah 1–2 menit, aplikasi bisa dibuka di `https://sofianaopi.github.io/CRMBPDpasarwajo/`.

### 3. Domain sendiri (opsional)
1. Beli/sewa domain, misalnya `crm-pasarwajo.id`.
2. Di pengelola DNS domain, buat record **CNAME** `crm` → `sofianaopi.github.io`.
3. **Settings → Pages → Custom domain** → isi `crm.crm-pasarwajo.id` → Save → centang **Enforce HTTPS**.

Untuk domain resmi bank (mis. `crm.banksultra.co.id`) diperlukan izin dan bantuan bagian TI Bank Sultra.

## Akun pengguna

Akun dikelola di sheet **Pengguna**:

| Kolom | Isi |
|---|---|
| `username` | huruf kecil tanpa spasi, mis. `andi.s` |
| `nama`, `jabatan` | nama lengkap dan jabatan |
| `role` | `pegawai` atau `pimpinan` |
| `aktif` | kosong/TRUE = aktif, FALSE = nonaktif |
| `passwordAwal` | password sementara; wajib diganti saat login pertama, lalu otomatis dikosongkan |

Kolom `gantiPassword`, `salt`, `passwordHash` diisi otomatis oleh sistem. Untuk mereset password yang
lupa, ketik password baru di `passwordAwal`. Pimpinan juga bisa membuat akun dan mereset password dari
menu **Pegawai & target** di aplikasi.

## Keamanan

- Spreadsheet **hanya** dibagikan ke pimpinan/admin, jangan ke pegawai.
- Password tersimpan sebagai hash; `passwordAwal` hanya terlihat sampai pemiliknya menggantinya.
- Login dikunci 15 menit setelah 5 kali salah; sesi berakhir setelah 6 jam tidak aktif.
- Repository ini hanya berisi kode. Jangan commit data nasabah atau ekspor spreadsheet ke sini.
- Penggunaan untuk data nasabah sungguhan sebaiknya dikonfirmasi ke bagian TI/kepatuhan Bank Sultra.
