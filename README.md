# WA Group Text Monitor

Platform MVP untuk menerima push percakapan WhatsApp group dari WAHA dan menampilkannya sebagai dashboard text-only.

## Scope

- Hanya menyimpan pesan teks grup.
- Semua data masuk ke SQLite database di `data/app.db`.
- Tidak ada file storage, upload file, download file, thumbnail, avatar, atau foto grup.
- Event non-teks dari WAHA diabaikan dan tidak membuat record pesan.

## Menjalankan Aplikasi

```bash
python3 app.py
```

Buka:

```text
http://127.0.0.1:8000
```

Login default:

```text
Email: admin@example.com
Password: admin123
```

Webhook secret default:

```text
dev-secret
```

Untuk mengganti port atau secret:

```bash
PORT=8080 WAHA_WEBHOOK_SECRET=secret-production ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=password-kuat python3 app.py
```

## Deploy ke EasyPanel

1. Buat app baru di EasyPanel dari GitHub repository.
2. Pilih build method `Dockerfile`.
3. Set port aplikasi ke `8000`.
4. Tambahkan environment variable:

```text
HOST=0.0.0.0
PORT=8000
WAHA_WEBHOOK_SECRET=isi-secret-produksi
ADMIN_EMAIL=email-admin-anda
ADMIN_PASSWORD=password-admin-yang-kuat
ADMIN_NAME=Admin
```

5. Tambahkan persistent volume agar SQLite tidak hilang saat redeploy:

```text
/app/data
```

Semua data aplikasi disimpan di database SQLite pada volume tersebut. Tidak ada file storage untuk konten WhatsApp.

Catatan admin login:

- `ADMIN_EMAIL` menentukan email admin yang dibuat otomatis.
- `ADMIN_PASSWORD` menentukan password admin.
- Jika `ADMIN_PASSWORD` diset, password admin untuk `ADMIN_EMAIL` akan disinkronkan ulang saat container start.
- Jika env admin tidak diset, aplikasi memakai default `admin@example.com` / `admin123`, hanya cocok untuk development lokal.

## Endpoint Webhook WAHA

```http
POST /api/webhooks/waha/messages
X-Webhook-Secret: dev-secret
Content-Type: application/json
```

Contoh submit pesan teks:

```bash
curl -X POST http://127.0.0.1:8000/api/webhooks/waha/messages \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: dev-secret' \
  -d '{
    "payload": {
      "id": "msg-001",
      "chatId": "120363000000000000@g.us",
      "groupName": "Ops Team",
      "author": "6281234567890@c.us",
      "senderName": "Budi",
      "body": "Update: order batch pagi sudah selesai.",
      "timestamp": 1780783200
    }
  }'
```

Response sukses:

```json
{
  "status": "stored",
  "message_id": 1,
  "group_id": 1
}
```

Jika event bukan dari grup atau tidak memiliki isi teks, response akan `ignored` dan tidak membuat record di tabel `messages`.

## Endpoint Tarik Chat Berdasarkan Group ID

Endpoint ini digunakan untuk mengambil data chat/pesan teks dari satu grup. Request bisa memakai cookie session dari login dashboard atau header `X-Webhook-Secret` agar mudah dipakai dari n8n.

```http
GET /api/chats?group_id=1&limit=50
X-Webhook-Secret: dev-secret
```

`group_id` bisa memakai ID internal database (`1`) atau WA chat id (`120363000000000000@g.us`). Jika memakai WA chat id di URL, encode karakter `@` menjadi `%40`.

Contoh request untuk n8n atau integrasi server-to-server:

```bash
curl -H 'X-Webhook-Secret: dev-secret' \
  'http://127.0.0.1:8000/api/chats?group_id=1&limit=10'
```

Contoh request dengan WA chat id group:

```bash
curl -H 'X-Webhook-Secret: dev-secret' \
  'http://127.0.0.1:8000/api/chats?group_id=120363000000000000%40g.us&limit=10'
```

Jika ingin memakai login dashboard, ambil cookie session dulu:

```bash
curl -c cookies.txt -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

Lalu kirim request dengan cookie:

```bash
curl -b cookies.txt \
  'http://127.0.0.1:8000/api/chats?group_id=1&limit=10'
```

Query parameter yang didukung:

| Parameter | Wajib | Contoh | Keterangan |
| --- | --- | --- | --- |
| `group_id` | Ya* | `1` atau `120363000000000000@g.us` | ID internal group atau WA chat id group. |
| `wa_chat_id` | Ya* | `120363000000000000@g.us` | Alternatif eksplisit untuk WA chat id. |
| `limit` | Tidak | `50` | Jumlah pesan, minimal `1`, maksimal `200`, default `80`. |
| `q` | Tidak | `order` | Filter keyword pada isi pesan. |
| `sender_id` | Tidak | `1` | Filter berdasarkan ID internal contact/sender. |
| `from` | Tidak | `2026-06-01T00:00:00+00:00` | Ambil pesan mulai timestamp ini. |
| `to` | Tidak | `2026-06-07T23:59:59+00:00` | Ambil pesan sampai timestamp ini. |

`*` Isi salah satu dari `group_id` atau `wa_chat_id`.

Contoh response sukses:

```json
{
  "group": {
    "id": 1,
    "wa_chat_id": "120363000000000000@g.us",
    "name": "Ops Team",
    "participant_count": 12,
    "last_message_at": "2026-06-06T22:00:00+00:00"
  },
  "filters": {
    "q": null,
    "sender_id": null,
    "from": null,
    "to": null
  },
  "pagination": {
    "limit": 10,
    "returned": 1,
    "order": "asc"
  },
  "messages": [
    {
      "id": 1,
      "wa_message_id": "msg-api-001",
      "group_id": 1,
      "wa_chat_id": "120363000000000000@g.us",
      "group_name": "Ops Team",
      "body": "Update: order batch pagi sudah selesai.",
      "wa_timestamp": "2026-06-06T22:00:00+00:00",
      "received_at": "2026-06-07T05:36:53+00:00",
      "sender": {
        "id": 1,
        "wa_contact_id": "6281234567890@c.us",
        "display_name": "Budi"
      }
    }
  ]
}
```

Response error umum:

```json
{ "error": "unauthorized" }
```

```json
{ "error": "group_not_found" }
```

## Dashboard Harian Perubahan Grup

Aplikasi juga memiliki tab `Dashboard` terpisah dari fitur chat. Data dashboard disimpan di tabel `daily_group_changes` dengan kolom utama:

| Kolom | Keterangan |
| --- | --- |
| `group_id` | ID grup dari sumber laporan harian. Nilai ini langsung disimpan dan tidak wajib sudah ada di tabel `groups`. |
| `report_date` | Tanggal laporan harian, format `YYYY-MM-DD`. |
| `teacher_name` | Nama guru. |
| `student_name` | Nama murid. |
| `bot` | Bot yang terkait, bisa nama bot atau status boolean dari integrasi. |
| `changed` | Nilai/peristiwa yang berubah. |
| `changed_by` | Nama pengubah. |

Endpoint untuk mengisi data dashboard:

```http
POST /api/daily-changes
X-Webhook-Secret: dev-secret
Content-Type: application/json
```

Contoh payload dengan nama field Bahasa Indonesia:

```bash
curl -X POST http://127.0.0.1:8000/api/daily-changes \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: dev-secret' \
  -d '{
    "group_id": 1,
    "tanggal": "2026-06-09",
    "nama_guru": "Bu Rina",
    "nama_murid": "Andi",
    "bot": "Reminder Bot",
    "berubah": "Status tugas menjadi selesai",
    "pengubah": "Admin Sekolah"
  }'
```

Contoh payload dengan field API:

```json
{
  "group_id": 1,
  "report_date": "2026-06-09",
  "teacher_name": "Bu Rina",
  "student_name": "Andi",
  "bot": true,
  "changed": "Status tugas menjadi selesai",
  "changed_by": "Admin Sekolah"
}
```

Data juga bisa memakai `wa_chat_id` sebagai pengganti `group_id`. Nilai tersebut akan disimpan sebagai `group_id` laporan harian:

```json
{
  "wa_chat_id": "120363000000000000@g.us",
  "tanggal": "2026-06-09",
  "nama_guru": "Bu Rina",
  "nama_murid": "Andi",
  "bot": "Reminder Bot",
  "berubah": "Status tugas menjadi selesai",
  "pengubah": "Admin Sekolah"
}
```

Endpoint untuk membaca data dashboard:

```http
GET /api/daily-changes?group_id=1&date=2026-06-09&q=andi
```

Query parameter yang didukung:

| Parameter | Wajib | Keterangan |
| --- | --- | --- |
| `group_id` | Tidak | Filter group id laporan. Jika memakai WA chat id, dashboard juga mencocokkan ke grup WA yang sudah tersimpan bila ada. |
| `date` | Tidak | Filter satu tanggal laporan. |
| `from` | Tidak | Ambil laporan mulai tanggal ini. |
| `to` | Tidak | Ambil laporan sampai tanggal ini. |
| `q` | Tidak | Cari di nama grup, guru, murid, bot, berubah, atau pengubah. |
| `limit` | Tidak | Jumlah baris, minimal `1`, maksimal `500`, default `200`. |

## Database

Schema utama:

- `groups`
- `contacts`
- `messages`
- `users`
- `sessions`
- `webhook_events`
- `group_access`
- `daily_group_changes`

Catatan: `data/app.db` adalah database SQLite aplikasi. Ini bukan file storage untuk konten WhatsApp.
