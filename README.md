# Open Crit — Pameran Karya Studio

Platform galeri kiriman dan kritik karya studio Departemen Arsitektur, Fakultas Teknik Sipil, Perencanaan, dan Kebumian, Institut Teknologi Sepuluh Nopember.

![Status](https://img.shields.io/badge/status-active-success)
![Year](https://img.shields.io/badge/year-2026-black)
![Stack](https://img.shields.io/badge/stack-HTML%20%C2%B7%20CSS%20%C2%B7%20JS-lightgrey)

---

## Tentang

Open Crit adalah ruang terbuka digital untuk menampilkan, mengkritisi, dan mengapresiasi karya studio mahasiswa Departemen Arsitektur ITS. Kiriman berupa teks, gambar, dan video dapat ditambahkan melalui Google Form dan akan ditampilkan secara real-time sebagai galeri kartu di halaman utama.

Konsep desainnya merujuk pada estetika katalog pameran arsitektur — monokrom, tipografi editorial, layout asimetris.

## Fitur

- Submit kiriman lewat Google Form yang ter-embed di halaman (teks bebas, URL gambar/video)
- Auto-detect tag (`#PA2`, `#DPA1`, dll.) sebagai filter visual
- Galeri masonry responsif (3 kolom desktop, 2 kolom tablet, 1 kolom mobile)
- Sortir berdasarkan **Top** (total reaksi) atau **Recent** (terbaru)
- Tiga reaksi tanpa identitas: **Love**, **Awe**, **Inspired**
- Dukungan media: gambar langsung, Google Drive thumbnail, YouTube, Vimeo, video mp4
- Read-more otomatis untuk kiriman panjang
- Modal lightbox untuk gambar
- Reaksi tersimpan lokal (anti-spam) di sisi pengunjung

## Teknologi

- HTML5, CSS3, JavaScript (vanilla, tanpa framework)
- Google Sheets sebagai basis data
- Google Apps Script sebagai endpoint untuk menyimpan reaksi
- Google Fonts (Roboto)
- Hosted di GitHub Pages

## Struktur File

```
.
├── index.html      # halaman utama
├── style.css       # styling (monokrom editorial)
├── script.js       # logika galeri, fetch data, reaksi
└── README.md       # file ini
```

## Sumber Data

Data kiriman diambil dari Google Sheets yang terhubung dengan Google Form, lalu diekspor sebagai CSV publik. Konfigurasi sumber data ada di bagian atas `script.js`:

```js
const SHEET_ID  = '...';     // ID Google Sheet
const WEBAPP_URL = '...';    // URL Google Apps Script untuk reaksi
```

Kolom Sheet harus berurutan: `Timestamp | Konten | Nama | Like | Hug | Idea`.

## Cara Menjalankan Lokal

Buka terminal di folder proyek, lalu jalankan salah satu server statis:

```bash
# dengan Python
python -m http.server 8000

# atau dengan Node
npx serve
```

Buka `http://localhost:8000` di browser. Membuka `index.html` langsung dengan double-click tidak akan bekerja karena fetch ke Google Sheets memerlukan konteks HTTP.

## Deploy ke GitHub Pages

1. Push semua file ke branch `main`
2. Masuk ke **Settings → Pages**
3. Source: `Deploy from a branch` → `main` → `/ (root)`
4. Tunggu beberapa menit; URL akan tampil di atas halaman Settings tersebut

---

## Hak Cipta & Ketentuan Penggunaan

© 2026 Departemen Arsitektur, Institut Teknologi Sepuluh Nopember. Hak cipta dilindungi.

Repository ini dibuat **publik** untuk keperluan transparansi dan dokumentasi pendidikan. Seluruh kode sumber, desain visual, identitas, dan konten kiriman adalah milik Departemen Arsitektur ITS.

**Anda diperbolehkan untuk:**
- Melihat dan mempelajari kode sumber
- Membuat *fork* untuk eksperimen pribadi atau pembelajaran (tanpa publikasi ulang)

**Anda TIDAK diperbolehkan untuk:**
- Menggunakan kode ini untuk proyek komersial
- Menyalin desain atau identitas visual untuk publikasi atas nama institusi atau pihak lain
- Mendistribusikan ulang dalam bentuk apa pun tanpa izin tertulis
- Mengakses, menyalin, atau menyalahgunakan data kiriman yang tampil di galeri

Setiap kiriman dalam galeri ini dilindungi sebagai karya akademis. Penggunaan tanpa izin dapat melanggar UU No. 28 Tahun 2014 tentang Hak Cipta.

## Kontribusi

Repository ini *tidak menerima* pull request publik. Perbaikan, masukan, atau laporan bug dapat disampaikan langsung kepada pengelola.

## Kontak

**Departemen Arsitektur**
Fakultas Teknik Sipil, Perencanaan, dan Kebumian
Institut Teknologi Sepuluh Nopember
Kampus ITS Sukolilo, Surabaya 60111

---

*Open Crit — Karya Studio · 2026*
