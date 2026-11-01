# PRD — Boat & Yacht Rental Platform

Nov 1, 2026 · @Ambon · Versi 1.0

## 1. Ringkasan dan Ruang Lingkup

Platform reservasi kapal dan yacht untuk satu operator yang mengelola armada sendiri dan kapal mitra, dengan dua jalur booking: Private Charter dan Departure (jadwal buatan admin yang menjual kursi open trip dan area privat). Pembayaran via Midtrans Snap atau manual oleh admin, dengan skema lunas atau DP yang diatur per kapal/paket.

**Model bisnis**

- Operator tunggal yang juga memasarkan kapal milik mitra.
- Mitra tidak login ke sistem. Komisi dihitung per kapal, payout ke mitra dilakukan manual dan dicatat admin.
- Target pengunjung utama turis asing: website berbahasa Inggris dengan Indonesia sebagai bahasa kedua, harga IDR dengan perkiraan USD.

**Termasuk v1**

- Katalog kapal, area/deck, fasilitas, region, port, rute (itinerary).
- Private Charter dan Departure (kursi + area dalam satu jadwal).
- Paket all-in di atas kedua jalur booking.
- Pricing dengan season, promo, pajak/service, dan biaya per metode bayar.
- Checkout dengan identitas pemesan dan data guest.
- Midtrans Snap, pembayaran manual, DP, refund, settlement mitra.
- Tiket PDF dengan QR verifikasi, tracking order publik.
- Login Google, beberapa akun admin dengan satu role.
- CMS halaman, FAQ, review, homepage section, SEO, i18n EN/ID, dark mode di public dan customer portal.
- Media pipeline WebP dengan pembersihan file otomatis.

**Di luar v1**

- Blog, crew assignment, dokumen kapal, notifikasi WhatsApp.
- Add-on terpisah, harga anak/bayi, request rute custom (via form kontak/WhatsApp dulu).
- Login mitra, payout otomatis, check-in scan di dermaga.
- Perubahan jumlah pax setelah checkout (dilakukan dengan batal lalu booking ulang).

## 2. Terminologi dan Hierarki Produk

Setiap istilah di bawah punya satu arti dan satu tabel. Konsep "Type" dan "booking scope" di draf awal digabung menjadi Booking Mode, dan "package session" digabung ke Departure.

| Istilah | Arti | Contoh |
| --- | --- | --- |
| Category | Jenis kapal | Yacht, Speedboat, Catamaran, Phinisi |
| Class | Segmen layanan | VVIP, VIP, Premium, Deluxe |
| Partner | Pemilik kapal mitra | PT Bahari Jaya |
| Boat Unit | Kapal fisik | Ocean Majesty |
| Area | Bagian kapal yang bisa dijual terpisah, berlabel deck | Lavender Lounge (Main Deck) |
| Region | Wilayah operasi | Bali, Lombok, Labuan Bajo |
| Port | Titik keberangkatan, punya timezone | Benoa (WITA) |
| Route | Itinerary dengan titik singgah | Benoa → Nusa Penida → Benoa |
| Booking Mode | Cara menjual kapal | PRIVATE\_CHARTER, DEPARTURE |
| Departure | Jadwal buatan admin: kapal + rute + waktu | Sunset Cruise 12 Des 17:00 |
| Departure Slot | Yang dijual di Departure | Kursi open trip, Area privat |
| Package | Produk all-in di atas Private Charter atau Departure | Honeymoon Escape, End Year Night |

**Aturan istilah**

- Deck adalah label atribut pada Area (Upper, Main, Lower), bukan tabel tersendiri.
- Area hanya dijual lewat Departure. Private Charter selalu mengunci seluruh kapal.
- Kapal yang tidak punya area terpisah tetap memiliki minimal satu area sistem bernama "Whole Boat" agar logika inventory seragam (lihat bagian 7).

## 3. Katalog: Mitra, Kapal, Area, Fasilitas

Kapal adalah aset dengan kepemilikan, kapasitas resmi, dan aturan operasional; status ketersediaannya dihitung sistem, bukan diisi manual.

**Partner**

- Nama, kontak, rekening bank, catatan.
- Tidak memiliki akun login.

**Boat Unit**

| Field | Keterangan |
| --- | --- |
| Name, slug (per bahasa), code | Slug otomatis dari nama, unik, perubahan slug membuat redirect 301 |
| Category, Class | Relasi master data |
| Ownership | OWNED atau PARTNER + partner\_id |
| Commission | Tipe PERCENTAGE atau FIXED + nilai; wajib bila PARTNER |
| Regions, Routes | Wilayah dan rute yang boleh dilayani |
| Home port | Port utama |
| Max passengers | Kapasitas resmi, batas keselamatan absolut |
| Spesifikasi | Panjang, lebar, tahun, kabin, kamar mandi, kecepatan, kru |
| Turnaround buffer (menit) | Jeda wajib sebelum dan sesudah setiap trip |
| Payment policy | FULL atau DEPOSIT (persen/nominal + tenggat pelunasan H-n) |
| Thumbnail, gallery | Lewat media pipeline |
| Description, SEO | Per bahasa |
| Status | DRAFT, PUBLISHED, ARCHIVED |

Status ARCHIVED menyembunyikan kapal dari katalog tetapi menjaga referensi booking lama. Ini status bisnis, bukan soft delete. Kapal yang sudah punya booking tidak bisa dihapus.

**Area**

- Name, slug, deck label, deskripsi, gallery, fasilitas (per bahasa).
- Min pax (minimum yang ditagih), max pax.
- Tarif dasar per area (bisa di-override per Departure).
- Sort order, status aktif.

**Facility**

Master data many-to-many ke Boat Unit dan Area: nama per bahasa, ikon, urutan.

## 4. Region, Port, Rute

Struktur lokasi tiga tingkat: Region → Port → Route, dengan timezone disimpan per port karena Bali, Lombok, dan Labuan Bajo memakai WITA dan Raja Ampat memakai WIT.

| Entitas | Field utama |
| --- | --- |
| Region | Name, slug, description, thumbnail, gallery, SEO (per bahasa), status |
| Port | Name, region, alamat, koordinat, IANA timezone (mis. Asia/Makassar), status |
| Route | Name, slug, region, departure port, return port, durasi (menit), deskripsi, SEO (per bahasa), status |
| Route Stop | Route, urutan, nama titik, koordinat opsional, aktivitas (per bahasa) |
| Boat Route | Kapal, rute, harga khusus rute opsional, durasi minimum |

**Aturan**

- Private Charter hanya bisa memilih rute yang terdaftar untuk kapal tersebut.
- Semua jam yang tampil ke customer dan admin memakai timezone port keberangkatan, dengan label ("09:00 WITA").
- Database menyimpan waktu dalam UTC (TIMESTAMPTZ).

## 5. Jalur Booking dan Paket

Sistem hanya punya dua mesin booking; paket adalah pembungkus komersial di atas keduanya, sehingga logika ketersediaan ada di satu tempat.

**5.1 Private Charter**

1. Customer memilih kapal, rute (dari daftar rute kapal), tanggal, jam mulai, dan durasi.
2. Durasi mengikuti rate unit kapal: HOURLY (kelipatan jam, min/maks diatur), DAILY, atau FIXED per trip rute.
3. Kapal terkunci penuh untuk rentang \[mulai − buffer, selesai + buffer\].
4. Jam operasional per kapal (mis. 07:00–19:00) membatasi pilihan jam.

**5.2 Departure**

1. Admin membuat Departure: kapal, rute, waktu berangkat dan selesai, batas waktu booking.
2. Admin menentukan slot yang dijual per area:
   - PRIVATE\_AREA: area dijual utuh ke satu pemesan, harga per area, min pax ditagih.
   - SEAT\_POOL: area dilebur menjadi kuota kursi open trip, harga per pax.
3. Satu Departure boleh mencampur kursi dan area privat.
4. Departure tetap berjalan berapa pun jumlah pesertanya. Tidak ada kuota minimum.
5. Saat dibuat, Departure langsung mereservasi seluruh kapal pada rentang waktunya, sehingga tidak bisa bentrok dengan Private Charter.
6. Admin dapat membatalkan satu Departure sekaligus (mis. cuaca); semua booking di dalamnya masuk alur refund penuh.

**5.3 Package**

- Package merujuk ke salah satu: Private Charter dengan kapal, rute, dan durasi tetap; atau Departure tertentu (mis. End Year Night 31 Desember).
- Harga all-in per kapal (package\_offerings), mengganti kalkulasi harga reguler.
- Field: name, slug, deskripsi, inklusi, eksklusi, gallery, SEO (per bahasa), min/max pax, periode berlaku, batas waktu booking, payment policy, status.
- Package yang sudah lewat periode tidak bisa dipakai untuk booking baru.

**5.4 Batasan booking (dapat diatur)**

- Minimal 24 jam sebelum keberangkatan.
- Maksimal 12 bulan ke depan.

## 6. Pricing, Pajak, Biaya Pembayaran

Harga final selalu dihitung backend dari data server; frontend hanya menampilkan hasil endpoint quote. Semua nominal disimpan sebagai BIGINT rupiah penuh, tanpa floating-point.

**6.1 Urutan kalkulasi**

1. Harga dasar: tarif kapal (Private Charter), tarif area atau kursi (Departure), atau harga package.
2. Override tanggal: harga spesifik tanggal > season (HIGH/LOW/PEAK) > weekend/weekday > harga dasar. Satu override yang menang, tidak ditumpuk.
3. Promo: harga atau diskon dengan periode aktif (mulai–selesai) dan kuota opsional. Promo dihitung setelah override.
4. Subtotal.
5. Baris pajak dan service: bisa diatur nama, persentase, dasar pengenaan, urutan (service dulu, pajak dari subtotal + service), pembulatan ke rupiah penuh.
6. Biaya metode bayar (bagian 6.2).
7. Grand total.

Tarif pajak tidak di-hard-code. Jenis dan tarif pajak untuk sewa kapal dipastikan dengan konsultan pajak.

**6.2 Biaya per metode bayar**

- Customer memilih metode di halaman checkout sebelum token Snap dibuat. Backend menambahkan biaya sebagai item terpisah dan membatasi Snap ke metode itu (`enabled_payments`).
- Biaya per metode: nominal tetap atau persen, boleh nol.
- Aturan Bank Indonesia membatasi surcharge ke customer untuk kartu kredit dan QRIS. Konfigurasi default untuk kedua metode ini adalah nol; pastikan ketentuannya dengan Midtrans sebelum go-live.
- Biaya metode bayar tidak ikut dikembalikan saat refund.

**6.3 Snapshot**

Booking menyimpan snapshot lengkap: semua baris harga, aturan yang menang, promo, pajak, biaya, payment policy, cancellation policy, dan komisi mitra. Perubahan harga atau kebijakan setelahnya tidak mengubah booking lama.

**6.4 Perkiraan USD**

- Kurs USD diisi manual oleh admin di Settings.
- Tampil sebagai "≈ USD 950 · charged in IDR". Tidak pernah dipakai untuk transaksi.

## 7. Inventory dan Concurrency

PostgreSQL adalah satu-satunya sumber kebenaran ketersediaan; konflik jadwal ditolak oleh constraint database, bukan oleh pengecekan di aplikasi saja. Redis atau tombol yang di-disable di frontend tidak pernah menjadi penjaga inventory.

**7.1 Tingkat kapal: area\_reservations**

- Setiap baris berisi `area_id`, rentang waktu `period` (tstzrange), jenis (CHARTER, DEPARTURE, BLOCK), referensi sumber, status (HELD, ACTIVE), dan `expires_at` untuk HELD.
- Exclusion constraint (btree\_gist): tidak boleh ada dua baris pada area yang sama dengan rentang beririsan.
- Private Charter menyisipkan satu baris untuk setiap area kapal, dengan rentang diperluas sebesar buffer.
- Departure menyisipkan satu baris untuk setiap area kapal saat jadwal dibuat.
- Maintenance dan blokir manual menyisipkan baris BLOCK (seluruh kapal atau area tertentu).
- Dengan pola ini, aturan "charter vs charter", "charter vs departure", dan "apa pun vs maintenance" ditegakkan oleh satu constraint.

**7.2 Tingkat jadwal: slot Departure**

- PRIVATE\_AREA: partial unique index memastikan satu slot hanya dimiliki satu booking aktif.
- SEAT\_POOL: transaksi mengunci baris Departure (`SELECT ... FOR UPDATE`), menghitung pax aktif, lalu menyisipkan booking hanya bila kursi slot dan kapasitas resmi kapal (kursi + area privat) masih cukup.

**7.3 Hold dan kedaluwarsa**

- Checkout membuat hold 15 menit (dapat diatur). Masa berlaku Snap sama dengan masa hold (`custom_expiry`).
- Hold kedaluwarsa tidak bergantung pada job: setiap transaksi booking terlebih dahulu menghapus hold kedaluwarsa yang beririsan dengan slot yang diminta. Job periodik hanya membersihkan sisa dan mengubah booking menjadi EXPIRED.
- Semua operasi pelepasan aman dijalankan berulang (idempotent).

**7.4 Duplikasi request**

- POST booking dan pembuatan pembayaran wajib membawa header `Idempotency-Key`. Request ulang dengan key dan isi yang sama mengembalikan hasil pertama; key sama dengan isi berbeda ditolak (409).
- Ketersediaan yang tampil di frontend bersifat informasi; ketersediaan selalu diperiksa ulang saat transaksi booking.
- Hasil availability tidak di-cache publik.

## 8. Checkout dan Data Penumpang

Login Google wajib sebelum checkout, tetapi tidak untuk browsing. Data pemesan lengkap dengan identitas, guest lain cukup nama dan nomor HP opsional, semuanya diisi lengkap saat checkout.

**8.1 Pemesan (lead guest)**

| Field | Aturan |
| --- | --- |
| Full name | Wajib |
| Email | Dari akun Google, tidak dapat diubah di form |
| Phone | Wajib, format internasional E.164 dengan pemilih kode negara |
| Nationality | Dropdown dapat dicari, kode ISO 3166-1, nama negara via `Intl.DisplayNames` sesuai bahasa, default Indonesia |
| ID type | KTP, SIM, Passport, KITAS/KITAP (pilihan menyesuaikan nationality) |
| ID number | Wajib, divalidasi sesuai jenis |
| Special request | Opsional |

**8.2 Validasi identitas (server dan frontend)**

| Jenis | Nationality | Format |
| --- | --- | --- |
| KTP | Indonesia saja | 16 digit angka |
| SIM | Indonesia (default) | Angka, panjang longgar |
| Passport | Semua | Alfanumerik |
| KITAS/KITAP | Selain Indonesia | Alfanumerik |

SIM perlu dikonfirmasi ke syahbandar apakah diterima untuk manifest.

**8.3 Guest tambahan**

- Jumlah guest wajib sama dengan pax − 1, divalidasi server.
- Field: full name (wajib), phone (opsional).
- Setelah checkout, data guest hanya dapat diubah oleh admin dan tercatat di audit log. Jumlah pax tidak dapat diubah di v1.

**8.4 Persetujuan**

Checkbox wajib sebelum bayar: syarat dan ketentuan, cancellation policy, aturan DP hangus bila pelunasan terlambat, serta persetujuan pemrosesan data identitas. Versi dokumen yang disetujui disimpan di booking.

**8.5 Urutan checkout**

1. Pilih produk, jadwal, pax.
2. Login Google (jika belum).
3. Isi data pemesan dan guest.
4. Pilih metode bayar dan skema (lunas atau DP jika tersedia).
5. Backend menghitung ulang harga, membuat booking PENDING\_PAYMENT + hold, lalu token Snap.
6. Bayar, lalu halaman status pembayaran (bagian 11).

## 9. Pembayaran, DP, dan State Machine

Status booking, status pembayaran booking, dan status tiap transaksi disimpan terpisah; booking menjadi CONFIRMED hanya setelah pembayaran terverifikasi di server.

**9.1 Status**

| Objek | Nilai |
| --- | --- |
| Booking | PENDING\_PAYMENT, CONFIRMED, IN\_PROGRESS, COMPLETED, CANCELLED, EXPIRED |
| Booking payment status | UNPAID, DEPOSIT\_PAID, PAID, PARTIALLY\_REFUNDED, REFUNDED |
| Payment (tiap transaksi) | PENDING, SUCCEEDED, FAILED, EXPIRED, CANCELLED |
| Refund | REQUESTED, APPROVED, PROCESSING, COMPLETED, REJECTED |

Status mentah Midtrans (`transaction_status`, `fraud_status`) disimpan di kolom terpisah dan dipetakan ke status internal di satu fungsi.

**9.2 Transisi booking yang sah**

| Dari | Ke | Pemicu |
| --- | --- | --- |
| PENDING\_PAYMENT | CONFIRMED | Pembayaran pertama (DP atau lunas) SUCCEEDED |
| PENDING\_PAYMENT | EXPIRED | Hold habis tanpa pembayaran |
| CONFIRMED | IN\_PROGRESS | Job: waktu berangkat tercapai |
| IN\_PROGRESS | COMPLETED | Job: waktu selesai tercapai |
| CONFIRMED | CANCELLED | Customer/admin batal, Departure dibatalkan, atau pelunasan lewat tenggat |

Transisi lain ditolak server. Refund tidak mengubah status booking; nilainya tercatat di ledger refund.

**9.3 Midtrans**

- `order_id` unik per transaksi (DP, pelunasan, percobaan ulang), bukan per booking.
- Webhook diproses dengan urutan: validasi `signature_key` (SHA512 dari order\_id + status\_code + gross\_amount + server key) dengan perbandingan constant-time; cek status ke Midtrans Status API; cocokkan order\_id, nominal, mata uang, dan merchant dengan data server; simpan event mentah di `payment_events`; terapkan transisi dalam satu transaksi database.
- Event duplikat atau datang tidak berurutan tidak mengubah hasil: transisi hanya maju, tidak pernah mundur.
- Efek samping (email, tiket) dijadwalkan lewat job yang dibuat di transaksi yang sama.
- Callback Snap di browser tidak pernah dipakai untuk mengubah status.
- Dana yang masuk untuk booking EXPIRED atau CANCELLED tidak mengaktifkan ulang booking. Payment dicatat SUCCEEDED dan booking masuk antrean exception admin untuk refund atau pemulihan manual.

**9.4 DP dan pelunasan**

- Payment policy diambil dari package atau kapal: FULL, atau DEPOSIT dengan nilai persen/nominal dan tenggat pelunasan H-n dari keberangkatan.
- DP dihitung dari grand total. Bila keberangkatan sudah lebih dekat dari tenggat, hanya opsi lunas yang tersedia.
- Pelunasan dibayar dari dashboard customer. Masa berlaku Snap pelunasan tidak melewati tenggat.
- Pengingat email H-3 dan H-1 sebelum tenggat.
- Pada tenggat, booking yang belum PAID dibatalkan otomatis dan DP dicatat sebagai forfeited.

**9.5 Pembayaran manual**

- Admin mencatat: metode (BANK\_TRANSFER, CASH), nominal, tanggal, bukti (upload), catatan.
- Nominal tidak boleh melebihi sisa tagihan; dilindungi idempotency key; tercatat di audit log.
- Laporan pendapatan dipisah per metode untuk rekonsiliasi kas.

## 10. Pembatalan, Refund, Settlement Mitra

Pembatalan oleh operator selalu refund penuh, pembatalan oleh customer mengikuti snapshot cancellation policy, dan setiap rupiah keluar-masuk tercatat di ledger terpisah.

**10.1 Cancellation policy**

- Admin membuat policy bertingkat, misalnya >7 hari 100%, 3–7 hari 50%, <3 hari 0% (contoh).
- Policy dipasang per kapal atau package dan disimpan sebagai snapshot di booking.
- Persentase dihitung dari jumlah yang sudah dibayar, di luar biaya metode bayar.

**10.2 Jenis pembatalan**

| Penyebab | Refund |
| --- | --- |
| Customer (request, disetujui admin) | Sesuai snapshot policy |
| Operator, cuaca, Departure dibatalkan | 100% dari yang dibayar |
| Pelunasan lewat tenggat | 0%, DP forfeited |
| Reschedule | Request customer, diproses manual oleh admin |

**10.3 Refund**

- Refund lewat Midtrans API hanya untuk metode yang mendukung. Metode lain (VA, transfer, cash) diproses manual: customer mengisi rekening tujuan, admin mencatat bukti transfer.
- Status refund berakhir COMPLETED hanya setelah konfirmasi provider atau bukti transfer, bukan saat tombol ditekan.
- Partial refund tercatat sebagai baris terpisah di ledger.

**10.4 Settlement mitra**

- Komisi dari snapshot booking: PERCENTAGE atau FIXED, dihitung dari subtotal sebelum pajak dan biaya bayar.
- Hak mitra = subtotal − komisi − refund terkait. DP forfeited dibagi dengan aturan komisi yang sama.
- Laporan settlement per mitra per periode, hanya untuk booking COMPLETED atau forfeited.
- Admin mencatat payout manual: periode, nominal, tanggal, bukti transfer. Booking yang sudah dibayarkan ditandai agar tidak dibayar dua kali.

## 11. Tiket, Verifikasi, Tracking, Status Pembayaran

URL publik memakai UUID v4 yang tidak bisa ditebak, tetapi UUID bukan pengganti otorisasi: data detail tetap hanya untuk pemilik booking yang login.

**11.1 Identitas booking**

| Identitas | Format | Dipakai untuk |
| --- | --- | --- |
| Public ID | UUID v4 | URL order, tracking, invoice |
| Booking number | `BK-261101-7XK3` | Komunikasi customer dan admin |
| Invoice number | Berurutan per tahun, mis. `INV/2026/000123` | Administrasi pajak |
| Verify token | Acak 128-bit, terpisah dari Public ID | QR tiket |

**11.2 Halaman status pembayaran**

- Callback Snap hanya mengarahkan ke `/orders/{uuid}/status`.
- Halaman mengecek backend tiap 3 detik (maksimal 10 menit) dan otomatis memperbarui tampilan saat status berubah: berhasil, pending (instruksi VA), gagal, atau kedaluwarsa.
- Lewat 10 menit, halaman menampilkan instruksi dan tombol cek ulang.

**11.3 Tiket PDF**

- Terbit setelah pembayaran pertama (DP atau lunas). Tiket booking DP mencantumkan sisa tagihan dan tenggatnya.
- Dibuat saat diunduh, tidak disimpan, sehingga selalu sesuai status terkini.
- Isi: booking number, kapal, rute, port, waktu berangkat (timezone port), pemesan, daftar guest, ringkasan pembayaran, QR.
- Bahasa mengikuti pilihan customer. Font mendukung karakter Unicode.

**11.4 QR verifikasi**

- QR berisi URL `/verify/{token}`.
- Halaman verifikasi menampilkan: status valid/batal, booking number, tanggal, kapal, jumlah pax, nama pemesan tersamar ("J\*\*\* S\*\*\*\*").
- Token dicabut saat booking dibatalkan atau di-reschedule, lalu tiket baru diterbitkan dengan token baru.

**11.5 Tracking tanpa login**

- Input: booking number + email pemesan, atau URL `/orders/{uuid}`.
- Tampil: status booking, status pembayaran, tanggal, kapal, rute.
- Tidak pernah tampil: nama lengkap, nomor HP, nomor identitas, data guest.
- Dilindungi Cloudflare Turnstile dan rate limit per IP.
- Tombol "Lihat detail" mewajibkan login; server mengembalikan 404 bila user yang login bukan pemilik booking.

## 12. Akun dan Autentikasi

Login dan registrasi hanya lewat Google (OIDC, authorization code flow + PKCE) yang diselesaikan di backend Go; sesi disimpan di cookie HttpOnly, bukan token di localStorage.

**12.1 Alur dan sesi**

- Identitas user = pasangan provider + Google `sub`, bukan email.
- Email harus `email_verified = true`.
- Backend menerbitkan session cookie HttpOnly, Secure, SameSite=Lax; sesi disimpan di tabel `sessions` (bisa dicabut), masa aktif 30 hari bergulir.
- Mutasi berbasis cookie dilindungi CSRF token (double submit).
- Server SSR meneruskan cookie ke API untuk halaman customer; respons berisi data pribadi tidak pernah di-cache.
- Endpoint auth dibatasi rate limit.

**12.2 Role**

- Dua role: ADMIN dan CUSTOMER. Semua admin memiliki akses yang sama.
- Admin pertama dibuat lewat perintah CLI saat deploy.
- Admin lain diundang lewat allowlist email; role ADMIN diberikan saat email tersebut login Google pertama kali.
- Admin terakhir yang aktif tidak bisa dinonaktifkan.

**12.3 Customer**

- Profil: nama, foto, nomor HP, nationality, bahasa pilihan (EN/ID).
- Booking manual oleh admin hanya untuk user yang sudah terdaftar; admin memilih user dari daftar.
- Admin dapat menonaktifkan akun customer.
- Permintaan hapus akun: data pribadi dianonimkan, catatan transaksi dan keuangan tetap disimpan.

## 13. Media Pipeline

Setiap gambar yang di-upload dikonversi ke WebP dalam beberapa ukuran, diberi nama baru oleh server, dan file lama dihapus otomatis setelah tidak dipakai lagi.

**13.1 Upload dan konversi**

- Diproses di backend Go dengan libvips (govips); libvips dipasang di image Docker backend.
- Validasi: ukuran maksimal 15 MB, MIME terdeteksi dari isi file (bukan nama), decode penuh untuk menolak file rusak, batas dimensi piksel untuk mencegah decompression bomb.
- Orientasi EXIF diterapkan, lalu semua metadata dibuang.
- Varian WebP: 400, 800, 1600 px lebar, tanpa upscale; gambar yang lebih kecil dari varian tidak dibuatkan varian itu.
- File asli tidak disimpan; varian 1600 px menjadi versi terbesar.
- Nama file: slug entitas + kode acak, mis. `ocean-majesty-7f3k2a-800.webp`. Nama dari klien tidak pernah dipakai.
- Penulisan file atomik; konversi berjalan di job dengan status (PROCESSING, READY, FAILED) yang tampil di admin.
- Setiap gambar wajib punya alt text per bahasa.

**13.2 Penyimpanan**

- Storage S3-compatible (MinIO, Cloudflare R2, atau sejenis) lewat satu interface, dikonfigurasi dari environment.
- Gambar publik dengan cache immutable jangka panjang; bukti transfer dan dokumen privat di bucket privat dengan signed URL berumur pendek.

**13.3 Penghapusan otomatis**

- Mengganti gambar selalu menghasilkan nama file baru, tidak menimpa file lama.
- Tabel `media` mencatat setiap file; relasi pemakaian dicatat di `media_usages`.
- Saat gambar diganti atau entitas dihapus, file lama dijadwalkan dihapus lewat job yang dibuat di transaksi yang sama, sehingga file hanya terhapus bila perubahan database berhasil.
- File yang masih dipakai entitas lain tidak dihapus.
- Job harian membersihkan upload yatim (tidak pernah dipakai) berumur lebih dari 24 jam.
- Gambar yang dirujuk review atau bukti pembayaran mengikuti masa retensi entitas tersebut.

## 14. CMS, Review, SEO, Bahasa, Tema

Website public dua bahasa (Inggris default, Indonesia di `/id`) dengan SSR untuk semua halaman yang diindeks; admin hanya berbahasa Inggris dan selalu light mode.

**14.1 CMS**

- Dynamic pages: title, slug, konten blok terstruktur (bukan HTML bebas), featured image, SEO, status, published\_at; semuanya per bahasa.
- Homepage section bertipe tetap: hero, featured boats, regions, featured packages, keunggulan, review pilihan, FAQ, CTA, banner promo. Admin mengatur urutan dan isi.
- FAQ: pertanyaan, jawaban (per bahasa), kategori, urutan, relasi opsional ke kapal/package.
- Testimonial diambil dari review yang ditandai featured, bukan modul terpisah.

**14.2 Review**

- Hanya booking COMPLETED milik user tersebut; satu review per booking.
- Rating keseluruhan 1–5 + rating kapal, layanan, kru; judul, isi, foto opsional.
- Label Verified Booking; moderasi admin (PENDING, PUBLISHED, REJECTED).
- Email permintaan review 1 hari setelah trip selesai.

**14.3 SEO**

- SSR: home, listing kapal, detail kapal, region, rute, package, dynamic page, FAQ.
- Per halaman: title, meta description, canonical, Open Graph, Twitter Card, hreflang EN/ID + x-default.
- JSON-LD: Organization, BreadcrumbList, Article untuk halaman konten; FAQPage dan Product hanya bila memenuhi ketentuan Google.
- Sitemap XML per bahasa, robots.txt, redirect 301 saat slug berubah, 404/410 yang benar.
- Halaman akun, checkout, tracking, dan verifikasi: noindex.
- Kombinasi filter listing tidak diindeks (canonical ke listing utama).

**14.4 Bahasa (i18n)**

- URL: Inggris di root (`/boats/ocean-majesty`), Indonesia di `/id/boats/ocean-majesty`. Slug boleh berbeda per bahasa.
- Teks UI di file locale per bahasa dan namespace, dengan key type-safe:

```
frontend/app/locales/en/{common,booking,account,validation,admin}.json
frontend/app/locales/id/{common,booking,account,validation}.json
backend/locales/{en,id}/email.json
```

- Menambah bahasa: salin folder `en`, terjemahkan, daftarkan kode bahasa di satu file config. Tidak perlu migration database.
- Konten dari admin disimpan di tabel terjemahan dengan kolom `locale`; form admin punya tab per bahasa.
- API mengembalikan kode error; teks pesan diterjemahkan di frontend.
- Format tanggal, angka, mata uang lewat `Intl` sesuai locale.

**14.5 Tema**

- Public dan customer portal: Light (default), Dark, System.
- Preferensi disimpan di cookie agar SSR merender tema yang benar tanpa kedipan.
- Warna lewat design token; tidak ada warna hard-code di komponen.
- Admin, email, dan tiket PDF selalu light.

## 15. Notifikasi dan Background Jobs

Email dikirim lewat SMTP generik yang dikonfigurasi dari environment, dan semua pekerjaan asinkron memakai job queue berbasis PostgreSQL sehingga aman dari restart dan tidak memerlukan Redis.

**15.1 Email**

- Konfigurasi: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS_MODE` (none, starttls, tls), `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`. Penyedia bisa diganti tanpa ubah kode.
- Domain pengirim wajib SPF, DKIM, DMARC.
- Template HTML + teks polos, bahasa mengikuti pilihan customer.
- Template customer: welcome, booking dibuat, pembayaran berhasil, booking terkonfirmasi, pengingat pelunasan (H-3, H-1), booking batal, refund, pengingat trip (H-1), permintaan review.
- Notifikasi admin: booking baru, pembayaran masuk, request pembatalan atau reschedule, pembayaran masuk untuk booking batal/kedaluwarsa.
- Setiap pengiriman tercatat di `notification_logs`; pengiriman ulang tidak menggandakan email (kunci unik per jenis + booking).

**15.2 Jobs**

| Job | Jadwal |
| --- | --- |
| Bersihkan hold kedaluwarsa, booking → EXPIRED | Tiap menit |
| Booking → IN\_PROGRESS / COMPLETED | Tiap 5 menit |
| Batalkan booking yang lewat tenggat pelunasan | Tiap 5 menit |
| Pengingat pelunasan H-3, H-1 | Tiap jam |
| Rekonsiliasi payment PENDING ke Midtrans Status API | Tiap 15 menit |
| Pengingat trip H-1, permintaan review H+1 | Tiap jam |
| Hapus nomor identitas 90 hari setelah trip | Harian |
| Bersihkan media yatim dan file yang dijadwalkan dihapus | Harian |
| Retry email gagal dengan backoff | Otomatis |

Semua job idempotent, punya retry dengan backoff, dan berjalan aman di lebih dari satu instance worker.

## 16. Admin Dashboard dan Laporan

Admin dashboard berbahasa Inggris, compact, mobile-friendly, dan semua aksi sensitif tercatat di audit log yang tidak bisa diubah lewat API.

| Menu | Isi |
| --- | --- |
| Overview | Booking hari ini dan minggu ini, keberangkatan mendatang, pendapatan bulan berjalan, pembayaran pending, antrean exception |
| Calendar | Kalender semua kapal dan per kapal: charter, Departure, hold, blokir, maintenance |
| Fleet | Kapal, area, fasilitas, partner, blokir jadwal, maintenance |
| Locations | Region, port, rute, titik singgah |
| Departures | Buat dan kelola jadwal, slot kursi dan area, batalkan jadwal, manifest |
| Packages | Package dan harga per kapal |
| Pricing | Season, harga tanggal khusus, promo, pajak/service, biaya metode bayar, kurs USD |
| Policies | Cancellation policy, payment policy |
| Bookings | Daftar, detail, booking manual, edit guest, batal, reschedule, catat pembayaran manual |
| Payments | Transaksi, event Midtrans, exception queue, refund |
| Partners | Settlement per periode, catat payout |
| Customers | Daftar, detail, riwayat booking, nonaktifkan, anonimkan |
| Content | Halaman, homepage section, FAQ, moderasi review |
| Settings | Identitas situs, kontak, SEO default, analytics, durasi hold, batas booking, admin allowlist |
| Audit Log | Siapa, apa, kapan, sebelum/sesudah |

**Manifest penumpang**

Per Departure dan per Private Charter: daftar pemesan dan guest, nationality, jenis identitas, nomor identitas (tersamar kecuali dibuka admin, tercatat di audit log). Ekspor PDF dan CSV.

**Laporan (CSV dan Excel)**

Booking, pendapatan per metode bayar, performa kapal, performa rute/package, pembatalan dan refund, settlement mitra. Pendapatan dihitung dari pembayaran SUCCEEDED dikurangi refund COMPLETED.

## 17. Arsitektur, Stack, Database, API

Modular monolith Go sebagai satu-satunya pemilik logika bisnis, Node.js hanya untuk SSR frontend, PostgreSQL sebagai sumber kebenaran dan job queue.

**17.1 Komponen**

| Komponen | Teknologi | Peran |
| --- | --- | --- |
| API server | Go, Chi, pgx, sqlc | REST `/api/v1`, semua logika bisnis |
| Worker | Go, River (job queue PostgreSQL) | Job, email, media, rekonsiliasi |
| Migrasi | goose | Skema database berversi |
| Frontend | React, TypeScript, React Router (framework mode, SSR), Vite, Tailwind CSS | Public, customer portal, admin |
| Database | PostgreSQL + btree\_gist | Data, inventory, queue |
| Storage | S3-compatible | Media dan file privat |
| Image | libvips (govips) | Konversi WebP |
| PDF | Library PDF Go berbasis kode (bukan headless browser) | Tiket, invoice, manifest |
| Proxy | Caddy | HTTPS otomatis, routing `/api` ke Go dan sisanya ke SSR |
| Observability | Log terstruktur (slog), metrics Prometheus, request ID | Operasional |

Versi semua dependensi diverifikasi dari sumber resmi saat implementasi dan dikunci di lockfile. Redis tidak dipakai di v1; bisa ditambahkan untuk cache bila terbukti perlu.

**17.2 Aturan database**

- UUID primary key; foreign key, unique, check constraint untuk nilai bisnis.
- TIMESTAMPTZ dalam UTC; uang BIGINT rupiah.
- JSONB hanya untuk snapshot dan konfigurasi fleksibel, bukan pengganti relasi.
- Tanpa soft delete. Penghapusan entitas yang dirujuk transaksi ditolak; gunakan status ARCHIVED.
- Tabel inti: users, sessions, admin\_invites, partners, boat\_categories, boat\_classes, boats, areas, facilities, regions, ports, routes, route\_stops, boat\_routes, departures, departure\_slots, area\_reservations, packages, package\_offerings, price\_overrides, seasons, promotions, tax\_lines, payment\_method\_fees, payment\_policies, cancellation\_policies, bookings, booking\_guests, booking\_identities (terenkripsi), payments, payment\_events, refunds, payouts, reviews, pages, page\_sections, faqs, media, media\_usages, translations, settings, idempotency\_keys, notification\_logs, audit\_logs.

**17.3 API (ringkas)**

| Kelompok | Endpoint utama |
| --- | --- |
| Public | `GET /boats`, `/boats/{slug}`, `/regions`, `/routes`, `/packages`, `/departures`, `/availability`, `POST /quotes`, `GET /pages/{slug}`, `/faqs`, `/reviews`, `/orders/track`, `/verify/{token}` |
| Auth | `GET /auth/google`, `/auth/google/callback`, `POST /auth/logout`, `GET /auth/me` |
| Customer | `/account/profile`, `/account/bookings`, `POST /bookings`, `POST /bookings/{id}/payments`, `/bookings/{id}/ticket.pdf`, `/bookings/{id}/cancel-request`, `/bookings/{id}/reschedule-request`, `/bookings/{id}/review` |
| Webhook | `POST /webhooks/midtrans` |
| Admin | `/admin/*` sesuai menu bagian 16 |

Standar: respons `{data, meta}` dan error `{error: {code, message, fields}}`; pagination, filter, sort dengan whitelist kolom; tanggal ISO 8601 UTC; `X-Request-ID` di setiap respons; dokumentasi OpenAPI.

## 18. Keamanan dan Privasi Data

Server tidak pernah mempercayai nilai dari klien (harga, status, role, kepemilikan), dan data identitas diperlakukan sebagai data pribadi yang dilindungi UU PDP (UU 27/2022).

**18.1 Anti manipulasi**

- Request booking hanya membawa pilihan (ID produk, jadwal, pax, data guest). Harga, pajak, biaya, dan total selalu dihitung ulang server; nilai harga yang dikirim klien diabaikan.
- Setiap akses resource customer dicek kepemilikannya (anti IDOR); booking milik orang lain menghasilkan 404.
- Mass assignment dicegah dengan DTO input eksplisit per endpoint.
- Webhook: lihat bagian 9.3. Notifikasi palsu, nominal berbeda, atau order tidak dikenal ditolak dan dicatat.
- Frontend menonaktifkan tombol submit saat proses berjalan, sebagai pelengkap; penjaga sebenarnya ada di server.

**18.2 Data identitas**

- Nomor identitas dienkripsi di level aplikasi (AES-256-GCM, kunci dari environment/secret manager, mendukung rotasi kunci).
- Admin melihat 4 digit terakhir; tombol "lihat penuh" tercatat di audit log.
- Dihapus otomatis 90 hari setelah trip selesai (dapat diatur).
- Tidak pernah muncul di log, tracking publik, halaman verifikasi, atau email.

**18.3 Umum**

- Header keamanan (CSP, HSTS, X-Content-Type-Options, Referrer-Policy), CORS allowlist eksplisit.
- Rate limit: auth, tracking, quote, booking, webhook.
- Validasi environment saat startup; secret tidak pernah di-commit atau tampil penuh di admin.
- Server key Midtrans dan kredensial SMTP hanya di environment, tidak di tabel settings.
- Log terstruktur dengan redaksi data sensitif.
- Cookie consent untuk analytics (GA4/GTM dimuat hanya setelah persetujuan).
- Backup PostgreSQL harian + point-in-time recovery, backup storage, uji restore berkala.

## 19. Skenario Uji Wajib

Setiap skenario di bawah wajib punya test otomatis (integration test dengan PostgreSQL sungguhan, bukan mock) sebelum fitur terkait dianggap selesai.

| No | Skenario | Hasil yang diharapkan |
| --- | --- | --- |
| 1 | 20 request paralel memesan Private Charter kapal dan jam yang sama | Tepat 1 berhasil, 19 ditolak 409 |
| 2 | Private Charter beririsan dengan Departure atau maintenance | Ditolak |
| 3 | Jarak antar charter lebih pendek dari buffer | Ditolak |
| 4 | Request paralel memesan area privat yang sama di satu Departure | Tepat 1 berhasil |
| 5 | Request paralel melebihi sisa kursi atau kapasitas resmi kapal | Total pax tidak pernah melewati batas |
| 6 | Double click checkout dengan Idempotency-Key sama | Satu booking, respons kedua identik |
| 7 | Hold kedaluwarsa, job belum jalan, customer lain memesan slot itu | Booking baru berhasil |
| 8 | Webhook dengan signature salah | Ditolak, status tidak berubah |
| 9 | Webhook valid dikirim 3 kali dan paralel | Satu transisi, satu email |
| 10 | Nominal webhook berbeda dengan data server | Tidak mengonfirmasi, masuk exception |
| 11 | Webhook settlement datang sebelum pending | Status akhir tetap SUCCEEDED |
| 12 | Pembayaran sukses setelah booking EXPIRED/CANCELLED | Tidak diaktifkan ulang, masuk exception |
| 13 | Klien mengirim harga atau status palsu | Diabaikan, server hitung sendiri |
| 14 | Customer membuka booking milik orang lain | 404 |
| 15 | Tracking publik | Tidak memuat nama, HP, identitas, guest |
| 16 | Harga atau policy diubah setelah booking | Snapshot booking tetap |
| 17 | Pelunasan lewat tenggat | Booking batal otomatis, DP forfeited, email terkirim sekali |
| 18 | Departure dibatalkan admin | Semua booking batal, refund 100% dibuat |
| 19 | Admin mencatat pembayaran manual melebihi sisa tagihan | Ditolak |
| 20 | KTP dipilih untuk nationality non-Indonesia | Ditolak server |
| 21 | Jumlah guest tidak sama dengan pax − 1 | Ditolak server |
| 22 | Upload file bukan gambar berekstensi .jpg, atau gambar raksasa | Ditolak |
| 23 | Gambar diganti lalu transaksi gagal | File lama tetap ada dan dipakai |
| 24 | Worker mati saat mengirim email | Dilanjutkan tanpa email ganda |
| 25 | Email Google belum terverifikasi | Login ditolak |
| 26 | Token QR booking yang dibatalkan dipindai | Tampil "Cancelled" |
| 27 | Commit berisi trailer Co-authored-by AI | Ditolak hook dan CI |

## 20. Fase Pengembangan dan Default

Pengembangan dibagi lima fase; fase berikutnya dimulai setelah skenario uji fase sebelumnya lulus.

| Fase | Isi | Gerbang selesai |
| --- | --- | --- |
| 1. Fondasi | Docker Compose, Go API, worker, PostgreSQL, SSR, i18n, tema, Google login, admin bootstrap, media pipeline, audit log, git hook | Login, upload gambar, build produksi berjalan |
| 2. Katalog | Partner, kapal, area, fasilitas, region, port, rute, CMS, halaman public SSR + SEO | Katalog tampil EN/ID, Lighthouse > 85 di halaman kapal |
| 3. Booking | Pricing, Departure, package, inventory, hold, checkout, data guest | Skenario 1–7, 13–16, 20–21 lulus |
| 4. Pembayaran | Midtrans, DP, pembayaran manual, status page, tiket + QR, tracking, email | Skenario 8–12, 17, 19, 24–26 lulus di Midtrans sandbox |
| 5. Operasional | Pembatalan, refund, settlement mitra, manifest, review, laporan, jobs lengkap, backup | Semua skenario lulus, uji restore backup, go-live |

Lingkungan: local, staging (Midtrans sandbox, data dummy), production.

**Default yang dapat dikoreksi**

| Parameter | Default |
| --- | --- |
| Durasi hold checkout | 15 menit |
| Batas booking | Min 24 jam sebelum berangkat, maks 12 bulan ke depan |
| Pengingat pelunasan | H-3 dan H-1 |
| Retensi nomor identitas | 90 hari setelah trip |
| Varian gambar | 400, 800, 1600 px |
| Ukuran upload maksimal | 15 MB |
| Polling status pembayaran | Tiap 3 detik, maksimal 10 menit |
| Masa sesi login | 30 hari bergulir |

**Perlu dikonfirmasi di luar tim teknis**

- [ ] Jenis dan tarif pajak sewa kapal (konsultan pajak).
- [ ] Ketentuan surcharge per metode bayar (Midtrans).
- [ ] Apakah SIM diterima untuk manifest (syahbandar).
- [ ] Teks syarat dan ketentuan, kebijakan privasi, cancellation policy (legal).
