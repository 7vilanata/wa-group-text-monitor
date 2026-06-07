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
