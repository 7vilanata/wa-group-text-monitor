# PRD: Platform Monitoring Percakapan WhatsApp Group

## 1. Ringkasan

Platform ini berfungsi untuk menampilkan, mencari, memfilter, dan memonitor percakapan WhatsApp khusus grup dalam format teks. Data percakapan akan dikirim dari WhatsApp API berbasis WAHA ke platform melalui webhook/API ingestion. Pengguna platform dapat melihat daftar grup, membaca percakapan teks secara kronologis, mencari pesan, memfilter berdasarkan waktu/pengirim/grup, dan melihat metadata penting dari setiap pesan.

Produk tahap awal difokuskan sebagai dashboard internal untuk observasi percakapan grup, bukan sebagai aplikasi pengirim pesan dua arah.

## 2. Latar Belakang

Percakapan WhatsApp grup sering mengandung informasi operasional penting, tetapi sulit dipantau karena tersebar di banyak grup dan hanya tersedia di aplikasi WhatsApp. Dengan WAHA sebagai penghubung ke WhatsApp, setiap pesan teks grup dapat dipush ke platform pusat agar data lebih mudah ditelusuri, diaudit, dan dianalisis.

## 3. Tujuan

- Menyediakan satu platform terpusat untuk melihat percakapan WhatsApp grup.
- Menerima data pesan dari WAHA secara real-time atau near real-time.
- Menampilkan percakapan grup dengan urutan kronologis yang jelas.
- Memudahkan pencarian pesan berdasarkan keyword, grup, pengirim, dan rentang waktu.
- Menyimpan histori pesan agar percakapan tetap dapat ditelusuri meskipun sudah lama terjadi.
- Menyediakan dasar arsitektur untuk fitur lanjutan seperti tagging, analytics, alerting, dan AI summary.

## 4. Non-Tujuan

- Tidak mengirim pesan WhatsApp dari platform pada fase awal.
- Tidak menggantikan aplikasi WhatsApp sebagai client utama.
- Tidak melakukan otomasi balasan pesan.
- Tidak membaca percakapan pribadi/non-grup pada fase awal.
- Tidak menyimpan, menampilkan, atau memproses konten maupun metadata non-teks.
- Tidak melakukan analisis sentimen atau AI summary pada MVP, kecuali disiapkan sebagai future enhancement.

## 5. Target Pengguna

- Admin operasional yang perlu memantau banyak grup WhatsApp.
- Supervisor/team lead yang ingin melihat histori komunikasi tim.
- Analyst yang perlu mencari pesan atau kejadian tertentu dari percakapan grup.
- Admin sistem yang mengelola integrasi WAHA dan status koneksi WhatsApp.

## 6. Use Case Utama

### 6.1 Melihat Daftar Grup

Pengguna membuka dashboard dan melihat daftar grup WhatsApp yang sudah terhubung. Setiap grup menampilkan nama grup, jumlah anggota jika tersedia dari WAHA, pesan teks terakhir, waktu pesan terakhir, dan indikator status sinkronisasi.

### 6.2 Membaca Percakapan Grup

Pengguna memilih satu grup, lalu platform menampilkan thread percakapan teks secara kronologis. Pesan dibedakan berdasarkan pengirim dan waktu.

### 6.3 Mencari Pesan

Pengguna mengetik keyword untuk mencari pesan. Hasil pencarian dapat difilter berdasarkan grup, pengirim, dan tanggal.

### 6.4 Filter Percakapan

Pengguna dapat memfilter percakapan dalam satu grup berdasarkan rentang tanggal, pengirim tertentu, atau pesan yang mengandung keyword.

### 6.5 Menerima Push dari WAHA

WAHA mengirim event pesan ke endpoint platform. Platform memvalidasi payload, menyimpan pesan, memperbarui metadata grup, dan menampilkan pesan baru di UI tanpa refresh manual jika memungkinkan.

### 6.6 Audit Pesan

Pengguna dapat membuka detail pesan untuk melihat metadata seperti message ID, chat ID, sender ID, timestamp WA, timestamp diterima server, dan raw payload teks terbatas untuk kebutuhan debugging.

## 7. Scope MVP

### 7.1 Ingestion API

- Endpoint untuk menerima webhook/event dari WAHA.
- Validasi secret/token webhook.
- Deduplication berdasarkan message ID dari WAHA.
- Penyimpanan pesan teks.
- Penyimpanan metadata dasar pesan.
- Penyimpanan metadata grup dan pengirim.
- Event non-teks diabaikan dan tidak disimpan.
- Logging untuk event yang gagal diproses.

### 7.2 Dashboard Web

- Login pengguna.
- Halaman daftar grup.
- Halaman detail grup dengan timeline percakapan.
- Real-time update menggunakan WebSocket/SSE atau polling singkat.
- Search global sederhana.
- Filter berdasarkan grup dan tanggal.
- Tampilan detail pesan.

### 7.3 Data Pesan

MVP minimal menyimpan:

- `message_id`
- `chat_id`
- `group_name`
- `sender_id`
- `sender_name`
- `message_body`
- `timestamp`
- `received_at`
- `raw_payload`

### 7.4 Role dan Akses

MVP minimal memiliki:

- Admin: dapat melihat semua grup dan mengelola konfigurasi.
- Viewer: dapat melihat grup yang diberikan akses.

### 7.5 Text-Only Scope

Untuk MVP, platform hanya menyimpan pesan WhatsApp grup yang memiliki konten teks. Event dan metadata non-teks dari pesan, user, maupun grup diabaikan dan tidak disimpan.

## 8. Fitur Detail

### 8.1 Authentication

Pengguna harus login sebelum mengakses dashboard. Implementasi awal dapat menggunakan email/password atau SSO jika sudah ada sistem identitas internal.

Acceptance criteria:

- Pengguna yang belum login diarahkan ke halaman login.
- Sesi login aman dan memiliki expiry.
- Password disimpan dengan hashing yang aman jika menggunakan email/password.

### 8.2 Group List

Halaman daftar grup menampilkan semua grup yang dapat diakses pengguna.

Informasi yang ditampilkan:

- Nama grup
- Pesan terakhir
- Waktu pesan terakhir
- Jumlah pesan hari ini
- Status sinkronisasi terakhir

Acceptance criteria:

- Grup dapat diurutkan berdasarkan pesan terbaru.
- Grup dapat dicari berdasarkan nama.
- Klik grup membuka halaman percakapan.

### 8.3 Conversation Timeline

Halaman percakapan menampilkan pesan dari grup tertentu.

Informasi pesan:

- Nama pengirim
- Nomor/ID pengirim
- Isi pesan
- Timestamp

Acceptance criteria:

- Pesan ditampilkan kronologis.
- Pengguna dapat memuat pesan lama.
- Pesan baru muncul tanpa refresh manual jika real-time channel aktif.
- Pesan panjang tetap mudah dibaca.

### 8.4 Search

Search memungkinkan pengguna menemukan pesan berdasarkan keyword.

Acceptance criteria:

- Search mendukung keyword pada isi pesan.
- Hasil menampilkan konteks grup, pengirim, waktu, dan cuplikan pesan.
- Pengguna dapat membuka hasil pencarian ke posisi percakapan terkait.

### 8.5 Filter

Filter tersedia di halaman percakapan dan pencarian.

Filter MVP:

- Grup
- Rentang tanggal
- Pengirim

Acceptance criteria:

- Filter dapat dikombinasikan.
- Filter dapat direset.
- State filter terlihat jelas di UI.

### 8.6 WAHA Webhook Receiver

Platform menyediakan endpoint untuk menerima event dari WAHA.

Contoh endpoint:

```http
POST /api/webhooks/waha/messages
```

Acceptance criteria:

- Request tanpa token valid ditolak.
- Payload invalid dicatat sebagai error.
- Pesan duplikat tidak membuat record ganda.
- Event pesan dari chat non-grup diabaikan atau ditandai sesuai konfigurasi.
- Event non-teks diabaikan dan tidak membuat record pesan.

### 8.7 Admin Configuration

Admin dapat melihat konfigurasi integrasi.

Scope MVP:

- Melihat status webhook.
- Melihat token/secret webhook secara masked.
- Melihat status event terakhir.
- Melihat jumlah event sukses/gagal.

## 9. Integrasi WAHA

### 9.1 Asumsi Payload

Platform diasumsikan menerima event dari WAHA yang mengandung:

- ID pesan
- ID chat/grup
- Nama grup jika tersedia
- ID pengirim
- Nama pengirim jika tersedia
- Isi pesan teks
- Timestamp WhatsApp
- Raw event teks terbatas

Struktur final payload perlu dikunci setelah melihat contoh payload WAHA yang digunakan di environment nyata.

### 9.2 Flow Data

1. Pesan masuk di WhatsApp group.
2. WAHA menerima event.
3. WAHA mengirim webhook ke platform.
4. Platform memvalidasi token.
5. Platform memastikan pesan berasal dari grup.
6. Platform melakukan deduplication.
7. Platform menyimpan pesan teks dan metadata.
8. Platform memperbarui daftar grup dan timeline.
9. UI menerima update real-time atau mengambil data terbaru lewat polling.

## 10. Data Model Awal

### 10.1 `groups`

- `id`
- `wa_chat_id`
- `name`
- `participant_count`
- `last_message_at`
- `created_at`
- `updated_at`

### 10.2 `contacts`

- `id`
- `wa_contact_id`
- `display_name`
- `phone_number`
- `created_at`
- `updated_at`

### 10.3 `messages`

- `id`
- `wa_message_id`
- `group_id`
- `sender_id`
- `body`
- `wa_timestamp`
- `received_at`
- `raw_payload`
- `created_at`

### 10.4 `users`

- `id`
- `name`
- `email`
- `password_hash`
- `role`
- `created_at`
- `updated_at`

### 10.5 `group_access`

- `id`
- `user_id`
- `group_id`
- `created_at`

## 11. UI/UX Requirements

- Tampilan utama harus terasa seperti inbox/monitoring console, bukan landing page.
- Daftar grup berada di sisi kiri atau halaman utama.
- Timeline percakapan harus mudah discan.
- Filter dan search harus selalu mudah dijangkau.
- Pesan baru harus terlihat jelas tanpa mengganggu pembacaan pesan lama.
- UI perlu mendukung layar desktop terlebih dahulu; mobile/responsive menjadi prioritas berikutnya.

## 12. Non-Functional Requirements

### 12.1 Performance

- Halaman daftar grup memuat dalam kurang dari 2 detik untuk 1.000 grup.
- Timeline percakapan memuat 50 pesan awal dalam kurang dari 2 detik.
- Search sederhana merespons dalam kurang dari 3 detik untuk volume data MVP.

### 12.2 Reliability

- Webhook ingestion harus idempotent.
- Event gagal diproses harus tercatat.
- Sistem tidak boleh gagal total hanya karena satu payload invalid.

### 12.3 Security

- Endpoint webhook dilindungi secret/token.
- Role-based access control untuk data grup.
- Raw payload hanya dapat dilihat admin.
- Data sensitif tidak ditulis sembarangan ke log.
- Semua akses dashboard membutuhkan autentikasi.

### 12.4 Privacy dan Compliance

- Platform hanya memproses grup yang disetujui/terdaftar.
- Perlu ada kebijakan retensi data.
- Akses pengguna harus dapat diaudit.
- Data pesan WhatsApp diperlakukan sebagai data sensitif.

### 12.5 Scalability

- Ingestion dipisahkan dari rendering UI.
- Index pencarian perlu disiapkan agar bisa berkembang.

## 13. Analytics dan Monitoring

MVP perlu mencatat metrik operasional:

- Jumlah pesan masuk per jam/hari.
- Jumlah event webhook sukses.
- Jumlah event webhook gagal.
- Jumlah payload duplikat.
- Latency dari timestamp WA ke `received_at`.
- Grup paling aktif.

## 14. Success Metrics

- 95% pesan teks grup yang dikirim WAHA berhasil tersimpan.
- Pesan baru muncul di dashboard dalam kurang dari 5 detik.
- Pengguna dapat menemukan pesan tertentu lewat search dalam kurang dari 3 detik.
- Tidak ada duplikasi pesan untuk message ID yang sama.
- Admin dapat melihat status ingestion tanpa perlu akses server/log langsung.

## 15. Risiko

- Payload WAHA bisa berbeda tergantung versi dan konfigurasi.
- Rate pesan tinggi dari banyak grup dapat membebani database jika indexing tidak baik.
- Penyimpanan raw payload dapat membesar cepat.
- Data WhatsApp mengandung informasi sensitif sehingga akses harus dibatasi.

## 16. Pertanyaan Terbuka

- Apakah platform ini hanya untuk internal, atau nantinya customer-facing?
- Berapa perkiraan jumlah grup aktif?
- Berapa perkiraan jumlah pesan per hari?
- Apakah semua grup boleh tampil untuk semua admin, atau akses harus granular per grup?
- Berapa lama histori pesan harus disimpan?
- Apakah perlu import histori lama, atau hanya pesan baru sejak webhook aktif?
- Apakah perlu multi-session WAHA atau hanya satu nomor WhatsApp?
- Apakah platform perlu mendukung multi-tenant?

## 17. Roadmap

### Phase 1: MVP Monitoring

- Webhook receiver WAHA.
- Penyimpanan pesan teks grup.
- Dashboard login.
- Daftar grup.
- Timeline percakapan.
- Search sederhana.
- Filter tanggal/grup/pengirim.
- Admin status ingestion.

### Phase 2: Operasional

- Export percakapan ke CSV/XLSX.
- Tagging pesan penting.
- Bookmark pesan.
- Audit log akses pengguna.
- Retry queue untuk event gagal.

### Phase 3: Intelligence

- Ringkasan percakapan per grup.
- Deteksi topik utama.
- Alert berdasarkan keyword.
- Dashboard aktivitas grup.
- Integrasi AI untuk summary dan klasifikasi pesan.

### Phase 4: Enterprise Readiness

- Multi-tenant.
- SSO.
- Advanced RBAC.
- Retention policy per tenant/grup.
- Search engine khusus seperti OpenSearch/Elasticsearch.

## 18. Rekomendasi Tech Stack Awal

Rekomendasi ini masih bisa disesuaikan dengan preferensi tim.

- Frontend: Next.js atau React.
- Backend: Next.js API routes, NestJS, atau Express/Fastify.
- Database: PostgreSQL.
- Real-time: Server-Sent Events, WebSocket, atau polling interval pendek untuk MVP.
- Search MVP: PostgreSQL full-text search.
- Search lanjutan: OpenSearch/Elasticsearch.
- Queue: Redis/BullMQ jika volume tinggi atau butuh retry.

## 19. Acceptance Criteria MVP

MVP dianggap selesai jika:

- WAHA dapat mengirim event pesan teks grup ke endpoint platform.
- Pesan teks grup tersimpan tanpa duplikasi berdasarkan WA message ID.
- Pengguna dapat login.
- Pengguna dapat melihat daftar grup.
- Pengguna dapat membuka percakapan per grup.
- Pengguna dapat mencari pesan berdasarkan keyword.
- Pengguna dapat memfilter pesan berdasarkan tanggal dan pengirim.
- Admin dapat melihat status ingestion dasar.
- Data chat personal/non-grup tidak tampil sebagai percakapan grup.
- Event non-teks dari grup tidak tersimpan sebagai pesan.
