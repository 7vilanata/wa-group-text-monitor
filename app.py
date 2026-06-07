#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "app.db"
WEBHOOK_SECRET = os.environ.get("WAHA_WEBHOOK_SECRET", "dev-secret")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip().lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
ADMIN_NAME = os.environ.get("ADMIN_NAME", "Admin")
SESSION_TTL_SECONDS = int(os.environ.get("SESSION_TTL_SECONDS", str(60 * 60 * 12)))


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def db():
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_bytes(16)
    elif isinstance(salt, str):
        salt = base64.b64decode(salt.encode("ascii"))
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120000)
    return (
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(derived).decode("ascii"),
    )


def verify_password(password, salt, stored_hash):
    _, candidate = hash_password(password, salt)
    return hmac.compare_digest(candidate, stored_hash)


def init_db():
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wa_chat_id TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                participant_count INTEGER,
                last_message_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wa_contact_id TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                phone_number TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wa_message_id TEXT NOT NULL UNIQUE,
                group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                sender_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
                body TEXT NOT NULL,
                wa_timestamp TEXT NOT NULL,
                received_at TEXT NOT NULL,
                raw_payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wa_message_id TEXT,
                chat_id TEXT,
                status TEXT NOT NULL,
                reason TEXT,
                received_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS group_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, group_id)
            );

            CREATE INDEX IF NOT EXISTS idx_groups_last_message_at
                ON groups(last_message_at DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_group_time
                ON messages(group_id, wa_timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_messages_sender
                ON messages(sender_id);
            CREATE INDEX IF NOT EXISTS idx_messages_body
                ON messages(body);
            CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
                ON webhook_events(received_at DESC);
            """
        )

        user = conn.execute("SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,)).fetchone()
        salt, password_hash = hash_password(ADMIN_PASSWORD)
        if not user:
            now = utc_now()
            conn.execute(
                """
                INSERT INTO users (name, email, password_salt, password_hash, role, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (ADMIN_NAME, ADMIN_EMAIL, salt, password_hash, "admin", now, now),
            )
        elif os.environ.get("ADMIN_PASSWORD"):
            conn.execute(
                """
                UPDATE users
                SET name = ?, password_salt = ?, password_hash = ?, updated_at = ?
                WHERE email = ?
                """,
                (ADMIN_NAME, salt, password_hash, utc_now(), ADMIN_EMAIL),
            )


def row_to_dict(row):
    return dict(row) if row else None


def query_value(query, key, default=""):
    return query.get(key, [default])[0]


def query_int(query, key, default, minimum=None, maximum=None):
    raw = query_value(query, key, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(value, minimum)
    if maximum is not None:
        value = min(value, maximum)
    return value


def deep_get(payload, paths, default=None):
    for path in paths:
        current = payload
        found = True
        for part in path:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                found = False
                break
        if found and current not in (None, ""):
            return current
    return default


def normalize_timestamp(value):
    if value in (None, ""):
        return utc_now()
    if isinstance(value, (int, float)):
        if value > 100000000000:
            value = value / 1000
        return datetime.fromtimestamp(value, tz=timezone.utc).replace(microsecond=0).isoformat()
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return normalize_timestamp(int(stripped))
        if stripped.endswith("Z"):
            return stripped[:-1] + "+00:00"
        return stripped
    return utc_now()


def first_text(*values):
    for value in values:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
    return None


def is_probably_text_event(data, message):
    message_type = first_text(
        data.get("type"),
        data.get("messageType"),
        data.get("message_type"),
        data.get("event"),
        message.get("type"),
        message.get("messageType"),
    )
    if not message_type:
        return True
    normalized = message_type.lower()
    return normalized in {
        "message",
        "text",
        "chat",
        "conversation",
        "extendedtextmessage",
        "textmessage",
    }


def extract_waha_message(payload):
    data = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    sender = data.get("sender") if isinstance(data.get("sender"), dict) else {}
    chat = data.get("chat") if isinstance(data.get("chat"), dict) else {}

    chat_id = first_text(
        deep_get(data, [("chatId",), ("chat_id",), ("from",), ("to",), ("chat", "id")]),
        deep_get(payload, [("chatId",), ("payload", "chatId"), ("payload", "from")]),
    )
    is_group = bool(
        str(chat_id or "").endswith("@g.us")
        or data.get("isGroup") is True
        or chat.get("isGroup") is True
        or chat.get("is_group") is True
    )

    body = first_text(
        data.get("body"),
        data.get("text"),
        data.get("message_body"),
        message.get("body"),
        message.get("text"),
        message.get("conversation"),
        deep_get(data, [("message", "extendedTextMessage", "text")]),
    )
    if not is_probably_text_event(data, message):
        body = None

    wa_message_id = first_text(
        data.get("id"),
        data.get("messageId"),
        data.get("message_id"),
        message.get("id"),
        deep_get(data, [("key", "id"), ("message", "key", "id")]),
    )
    if not wa_message_id and chat_id and body:
        wa_message_id = hashlib.sha256(
            f"{chat_id}|{data.get('timestamp')}|{data.get('from')}|{body}".encode("utf-8")
        ).hexdigest()

    sender_id = first_text(
        data.get("author"),
        data.get("participant"),
        data.get("from"),
        sender.get("id"),
        sender.get("pushname"),
        deep_get(data, [("key", "participant")]),
    )
    sender_name = first_text(
        data.get("notifyName"),
        data.get("pushName"),
        data.get("senderName"),
        sender.get("name"),
        sender.get("pushname"),
        sender_id,
        "Unknown",
    )
    group_name = first_text(
        data.get("groupName"),
        data.get("chatName"),
        chat.get("name"),
        chat.get("subject"),
        chat_id,
        "Unknown Group",
    )
    participant_count = data.get("participantCount") or chat.get("participantCount")
    try:
        participant_count = int(participant_count) if participant_count not in (None, "") else None
    except (TypeError, ValueError):
        participant_count = None

    wa_timestamp = normalize_timestamp(
        data.get("timestamp") or data.get("t") or message.get("timestamp") or payload.get("timestamp")
    )

    return {
        "wa_message_id": wa_message_id,
        "chat_id": chat_id,
        "group_name": group_name,
        "participant_count": participant_count,
        "sender_id": sender_id or "unknown",
        "sender_name": sender_name,
        "body": body,
        "wa_timestamp": wa_timestamp,
    }


def insert_webhook_event(conn, parsed, status, reason=None):
    conn.execute(
        """
        INSERT INTO webhook_events (wa_message_id, chat_id, status, reason, received_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            parsed.get("wa_message_id") if parsed else None,
            parsed.get("chat_id") if parsed else None,
            status,
            reason,
            utc_now(),
        ),
    )


def upsert_message(payload):
    parsed = extract_waha_message(payload)
    if not parsed["chat_id"] or not str(parsed["chat_id"]).endswith("@g.us"):
        with db() as conn:
            insert_webhook_event(conn, parsed, "ignored", "not_group")
        return {"status": "ignored", "reason": "not_group"}
    if not parsed["body"]:
        with db() as conn:
            insert_webhook_event(conn, parsed, "ignored", "non_text")
        return {"status": "ignored", "reason": "non_text"}
    if not parsed["wa_message_id"]:
        with db() as conn:
            insert_webhook_event(conn, parsed, "failed", "missing_message_id")
        return {"status": "failed", "reason": "missing_message_id"}

    now = utc_now()
    sanitized_payload = {
        "wa_message_id": parsed["wa_message_id"],
        "chat_id": parsed["chat_id"],
        "group_name": parsed["group_name"],
        "participant_count": parsed["participant_count"],
        "sender_id": parsed["sender_id"],
        "sender_name": parsed["sender_name"],
        "body": parsed["body"],
        "wa_timestamp": parsed["wa_timestamp"],
    }
    raw_payload = json.dumps(sanitized_payload, ensure_ascii=True, separators=(",", ":"))
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM messages WHERE wa_message_id = ?", (parsed["wa_message_id"],)
        ).fetchone()
        if existing:
            insert_webhook_event(conn, parsed, "duplicate", "message_exists")
            return {"status": "duplicate", "message_id": existing["id"]}

        conn.execute(
            """
            INSERT INTO groups (wa_chat_id, name, participant_count, last_message_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(wa_chat_id) DO UPDATE SET
                name = excluded.name,
                participant_count = COALESCE(excluded.participant_count, groups.participant_count),
                last_message_at = CASE
                    WHEN groups.last_message_at IS NULL OR excluded.last_message_at > groups.last_message_at
                    THEN excluded.last_message_at
                    ELSE groups.last_message_at
                END,
                updated_at = excluded.updated_at
            """,
            (
                parsed["chat_id"],
                parsed["group_name"],
                parsed["participant_count"],
                parsed["wa_timestamp"],
                now,
                now,
            ),
        )
        group = conn.execute("SELECT id FROM groups WHERE wa_chat_id = ?", (parsed["chat_id"],)).fetchone()

        conn.execute(
            """
            INSERT INTO contacts (wa_contact_id, display_name, phone_number, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(wa_contact_id) DO UPDATE SET
                display_name = excluded.display_name,
                phone_number = COALESCE(excluded.phone_number, contacts.phone_number),
                updated_at = excluded.updated_at
            """,
            (
                parsed["sender_id"],
                parsed["sender_name"],
                parsed["sender_id"].split("@")[0] if "@" in parsed["sender_id"] else None,
                now,
                now,
            ),
        )
        sender = conn.execute(
            "SELECT id FROM contacts WHERE wa_contact_id = ?", (parsed["sender_id"],)
        ).fetchone()

        cur = conn.execute(
            """
            INSERT INTO messages (
                wa_message_id, group_id, sender_id, body, wa_timestamp, received_at, raw_payload, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                parsed["wa_message_id"],
                group["id"],
                sender["id"],
                parsed["body"],
                parsed["wa_timestamp"],
                now,
                raw_payload,
                now,
            ),
        )
        insert_webhook_event(conn, parsed, "stored")
        return {"status": "stored", "message_id": cur.lastrowid, "group_id": group["id"]}


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "WAGroupTextMonitor/0.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def current_user(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        try:
            jar.load(header)
        except cookies.CookieError:
            return None
        token = jar.get("session")
        if not token:
            return None
        with db() as conn:
            row = conn.execute(
                """
                SELECT users.id, users.name, users.email, users.role
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ? AND sessions.expires_at > ?
                """,
                (token.value, int(time.time())),
            ).fetchone()
            return row_to_dict(row)

    def require_user(self):
        user = self.current_user()
        if not user:
            self.send_json(401, {"error": "unauthorized"})
            return None
        return user

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, query)
            return
        if path == "/" or path == "/login":
            self.serve_static("index.html")
            return
        if path.startswith("/static/"):
            self.serve_static(path.replace("/static/", "", 1))
            return
        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed.path)
            return
        self.send_error(404)

    def serve_static(self, relative_path):
        safe_path = Path(unquote(relative_path)).name
        file_path = STATIC_DIR / safe_path
        if not file_path.exists():
            self.send_error(404)
            return
        content_type = "text/plain; charset=utf-8"
        if file_path.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif file_path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api_get(self, path, query):
        if path == "/api/me":
            user = self.current_user()
            self.send_json(200, {"user": user})
            return
        user = self.require_user()
        if not user:
            return
        if path == "/api/groups":
            self.api_groups(query, user)
            return
        if path == "/api/chats":
            self.api_chats(query, user)
            return
        if path.startswith("/api/groups/") and path.endswith("/messages"):
            group_id = path.split("/")[3]
            self.api_group_messages(group_id, query, user)
            return
        if path == "/api/search":
            self.api_search(query, user)
            return
        if path == "/api/admin/stats":
            self.api_stats()
            return
        if path == "/api/contacts":
            self.api_contacts(query)
            return
        self.send_json(404, {"error": "not_found"})

    def handle_api_post(self, path):
        if path == "/api/auth/login":
            self.api_login()
            return
        if path == "/api/auth/logout":
            self.api_logout()
            return
        if path == "/api/webhooks/waha/messages":
            self.api_waha_webhook()
            return
        self.send_json(404, {"error": "not_found"})

    def api_login(self):
        try:
            payload = self.read_json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return
        email = str(payload.get("email", "")).strip().lower()
        password = str(payload.get("password", ""))
        with db() as conn:
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                self.send_json(401, {"error": "invalid_credentials"})
                return
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + SESSION_TTL_SECONDS
            conn.execute(
                "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (token, user["id"], expires_at, utc_now()),
            )
        body = json.dumps(
            {"user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_TTL_SECONDS}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api_logout(self):
        header = self.headers.get("Cookie", "")
        jar = cookies.SimpleCookie()
        try:
            jar.load(header)
        except cookies.CookieError:
            pass
        token = jar.get("session")
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token.value,))
        self.send_response(204)
        self.send_header("Set-Cookie", "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        self.end_headers()

    def api_waha_webhook(self):
        supplied = self.headers.get("X-Webhook-Secret", "")
        if not hmac.compare_digest(supplied, WEBHOOK_SECRET):
            self.send_json(401, {"error": "invalid_webhook_secret"})
            return
        try:
            payload = self.read_json()
            result = upsert_message(payload)
            status = 200 if result["status"] in ("stored", "duplicate", "ignored") else 422
            self.send_json(status, result)
        except (json.JSONDecodeError, UnicodeDecodeError):
            with db() as conn:
                insert_webhook_event(conn, None, "failed", "invalid_json")
            self.send_json(400, {"error": "invalid_json"})

    def api_groups(self, query, user):
        search = f"%{query_value(query, 'q').strip()}%"
        params = [search]
        access_join = ""
        access_where = ""
        if user["role"] != "admin":
            access_join = "JOIN group_access ga ON ga.group_id = groups.id"
            access_where = "AND ga.user_id = ?"
            params.append(user["id"])
        with db() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    groups.id,
                    groups.wa_chat_id,
                    groups.name,
                    groups.participant_count,
                    groups.last_message_at,
                    (
                        SELECT body FROM messages
                        WHERE messages.group_id = groups.id
                        ORDER BY wa_timestamp DESC, id DESC
                        LIMIT 1
                    ) AS last_message,
                    (
                        SELECT COUNT(*) FROM messages
                        WHERE messages.group_id = groups.id
                        AND substr(messages.wa_timestamp, 1, 10) = substr(?, 1, 10)
                    ) AS messages_today
                FROM groups
                {access_join}
                WHERE groups.name LIKE ?
                {access_where}
                ORDER BY groups.last_message_at DESC, groups.name ASC
                LIMIT 500
                """,
                [utc_now()] + params,
            ).fetchall()
        self.send_json(200, {"groups": [row_to_dict(row) for row in rows]})

    def api_group_messages(self, group_id, query, user):
        if not self.can_access_group(user, group_id):
            self.send_json(403, {"error": "forbidden"})
            return
        messages = self.load_group_messages(group_id, query)
        self.send_json(200, {"messages": messages})

    def api_chats(self, query, user):
        group = self.resolve_group(query)
        if not group:
            self.send_json(404, {"error": "group_not_found"})
            return
        if not self.can_access_group(user, group["id"]):
            self.send_json(403, {"error": "forbidden"})
            return

        messages = self.load_group_messages(group["id"], query)
        self.send_json(
            200,
            {
                "group": group,
                "filters": {
                    "q": query_value(query, "q").strip() or None,
                    "sender_id": query_value(query, "sender_id") or None,
                    "from": query_value(query, "from") or None,
                    "to": query_value(query, "to") or None,
                },
                "pagination": {
                    "limit": query_int(query, "limit", 80, 1, 200),
                    "returned": len(messages),
                    "order": "asc",
                },
                "messages": [
                    {
                        "id": message["id"],
                        "wa_message_id": message["wa_message_id"],
                        "group_id": message["group_id"],
                        "wa_chat_id": group["wa_chat_id"],
                        "group_name": group["name"],
                        "body": message["body"],
                        "wa_timestamp": message["wa_timestamp"],
                        "received_at": message["received_at"],
                        "sender": {
                            "id": message["sender_pk"],
                            "wa_contact_id": message["wa_contact_id"],
                            "display_name": message["sender_name"],
                        },
                    }
                    for message in messages
                ],
            },
        )

    def resolve_group(self, query):
        group_id = query_value(query, "group_id").strip()
        wa_chat_id = query_value(query, "wa_chat_id").strip()
        if not group_id and not wa_chat_id:
            return None

        if not wa_chat_id and "@" in group_id:
            wa_chat_id = group_id
            group_id = ""

        with db() as conn:
            if wa_chat_id:
                row = conn.execute(
                    """
                    SELECT id, wa_chat_id, name, participant_count, last_message_at
                    FROM groups
                    WHERE wa_chat_id = ?
                    """,
                    (wa_chat_id,),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT id, wa_chat_id, name, participant_count, last_message_at
                    FROM groups
                    WHERE id = ?
                    """,
                    (group_id,),
                ).fetchone()
        return row_to_dict(row)

    def load_group_messages(self, group_id, query):
        clauses = ["messages.group_id = ?"]
        params = [group_id]
        if query_value(query, "sender_id"):
            clauses.append("contacts.id = ?")
            params.append(query_value(query, "sender_id"))
        if query_value(query, "from"):
            clauses.append("messages.wa_timestamp >= ?")
            params.append(query_value(query, "from"))
        if query_value(query, "to"):
            clauses.append("messages.wa_timestamp <= ?")
            params.append(query_value(query, "to"))
        if query_value(query, "q").strip():
            clauses.append("messages.body LIKE ?")
            params.append(f"%{query_value(query, 'q').strip()}%")
        limit = query_int(query, "limit", 80, 1, 200)
        with db() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    messages.id,
                    messages.wa_message_id,
                    messages.group_id,
                    messages.body,
                    messages.wa_timestamp,
                    messages.received_at,
                    contacts.id AS sender_pk,
                    contacts.wa_contact_id,
                    contacts.display_name AS sender_name
                FROM messages
                JOIN contacts ON contacts.id = messages.sender_id
                WHERE {" AND ".join(clauses)}
                ORDER BY messages.wa_timestamp DESC, messages.id DESC
                LIMIT ?
                """,
                params + [limit],
            ).fetchall()
        messages = [row_to_dict(row) for row in rows]
        messages.reverse()
        return messages

    def api_search(self, query, user):
        keyword = query_value(query, "q").strip()
        if not keyword:
            self.send_json(200, {"results": []})
            return
        clauses = ["messages.body LIKE ?"]
        params = [f"%{keyword}%"]
        if query_value(query, "group_id"):
            clauses.append("groups.id = ?")
            params.append(query_value(query, "group_id"))
        if query_value(query, "from"):
            clauses.append("messages.wa_timestamp >= ?")
            params.append(query_value(query, "from"))
        if query_value(query, "to"):
            clauses.append("messages.wa_timestamp <= ?")
            params.append(query_value(query, "to"))
        if user["role"] != "admin":
            clauses.append("groups.id IN (SELECT group_id FROM group_access WHERE user_id = ?)")
            params.append(user["id"])
        with db() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    messages.id,
                    messages.body,
                    messages.wa_timestamp,
                    groups.id AS group_id,
                    groups.name AS group_name,
                    contacts.display_name AS sender_name
                FROM messages
                JOIN groups ON groups.id = messages.group_id
                JOIN contacts ON contacts.id = messages.sender_id
                WHERE {" AND ".join(clauses)}
                ORDER BY messages.wa_timestamp DESC, messages.id DESC
                LIMIT 100
                """,
                params,
            ).fetchall()
        self.send_json(200, {"results": [row_to_dict(row) for row in rows]})

    def api_contacts(self, query):
        group_id = query_value(query, "group_id")
        if not group_id:
            self.send_json(200, {"contacts": []})
            return
        with db() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT contacts.id, contacts.display_name, contacts.wa_contact_id
                FROM messages
                JOIN contacts ON contacts.id = messages.sender_id
                WHERE messages.group_id = ?
                ORDER BY contacts.display_name ASC
                """,
                (group_id,),
            ).fetchall()
        self.send_json(200, {"contacts": [row_to_dict(row) for row in rows]})

    def api_stats(self):
        with db() as conn:
            totals = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM groups) AS groups,
                    (SELECT COUNT(*) FROM contacts) AS contacts,
                    (SELECT COUNT(*) FROM messages) AS messages,
                    (SELECT COUNT(*) FROM webhook_events WHERE status = 'stored') AS stored,
                    (SELECT COUNT(*) FROM webhook_events WHERE status = 'ignored') AS ignored,
                    (SELECT COUNT(*) FROM webhook_events WHERE status = 'duplicate') AS duplicate,
                    (SELECT COUNT(*) FROM webhook_events WHERE status = 'failed') AS failed
                """
            ).fetchone()
            recent = conn.execute(
                """
                SELECT status, reason, wa_message_id, chat_id, received_at
                FROM webhook_events
                ORDER BY received_at DESC, id DESC
                LIMIT 20
                """
            ).fetchall()
        self.send_json(200, {"totals": row_to_dict(totals), "recent_events": [row_to_dict(row) for row in recent]})

    def can_access_group(self, user, group_id):
        if user["role"] == "admin":
            return True
        with db() as conn:
            row = conn.execute(
                "SELECT 1 FROM group_access WHERE user_id = ? AND group_id = ?",
                (user["id"], group_id),
            ).fetchone()
        return bool(row)


def main():
    init_db()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    httpd = ThreadingHTTPServer((host, port), AppHandler)
    print(f"WA group text monitor running on http://{host}:{port}")
    print(f"Admin login email: {ADMIN_EMAIL}")
    print(f"Webhook secret header X-Webhook-Secret: {WEBHOOK_SECRET}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
