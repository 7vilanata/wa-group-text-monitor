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

Endpoint ini digunakan untuk mengambil data chat/pesan teks dari satu grup. Request harus sudah login dan membawa cookie session dari endpoint login.

```http
GET /api/chats?group_id=1&limit=50
Cookie: session=...
```

`group_id` bisa memakai ID internal database (`1`) atau WA chat id (`120363000000000000@g.us`). Jika memakai WA chat id di URL, encode karakter `@` menjadi `%40`.

Login untuk mengambil cookie session:

```bash
curl -c cookies.txt -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

Contoh request dengan ID internal group:

```bash
curl -b cookies.txt \
  'http://127.0.0.1:8000/api/chats?group_id=1&limit=10'
```

Contoh request dengan WA chat id group:

```bash
curl -b cookies.txt \
  'http://127.0.0.1:8000/api/chats?group_id=120363000000000000%40g.us&limit=10'
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

## Database

Schema utama:

- `groups`
- `contacts`
- `messages`
- `users`
- `sessions`
- `webhook_events`
- `group_access`

Catatan: `data/app.db` adalah database SQLite aplikasi. Ini bukan file storage untuk konten WhatsApp.
