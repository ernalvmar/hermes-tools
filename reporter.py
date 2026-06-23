#!/usr/bin/env python3
"""Hermes Daily Reporter — reads all Kanban boards and sends a Telegram report."""

import argparse
import os
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# Lazy imports for Telegram (only needed for --telegram mode)
Bot = None
TelegramError = None

def _ensure_telegram():
    global Bot, TelegramError
    if Bot is None:
        from telegram import Bot as _Bot
        from telegram.error import TelegramError as _TelegramError
        Bot = _Bot
        TelegramError = _TelegramError

PROJECTS = {
    "logileads": "📊 Logileads",
    "erp-cofrade": "⛪ CofradíaOS",
    "takeflow": "🎬 Takeflow",
    "idp": "🎵 IDP",
}

BOARDS_DIR = Path("/home/ubuntu/.hermes/kanban/boards")
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or os.environ.get("HERMES_TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID") or os.environ.get("HERMES_TELEGRAM_CHAT_ID")
WORK_WINDOW_START = 2
WORK_WINDOW_END = 10
TZ = ZoneInfo("Europe/Madrid")


def get_db_path(slug: str) -> str:
    return os.path.join(BOARDS_DIR, slug, "kanban.db")


def connect_board(slug: str) -> sqlite3.Connection:
    path = get_db_path(slug)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def query_board(conn: sqlite3.Connection, target_date: date) -> dict:
    cursor = conn.cursor()
    day_start = int(
        datetime(target_date.year, target_date.month, target_date.day, tzinfo=TZ).timestamp()
    )
    day_end = day_start + 86400

    cursor.execute(
        "SELECT * FROM tasks WHERE completed_at >= ? AND completed_at < ? AND status = 'done'",
        (day_start, day_end),
    )
    done_tasks = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT * FROM tasks WHERE status = 'running'")
    running_tasks = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT * FROM tasks WHERE status IN ('blocked', 'failed')")
    blocked_failed = [dict(r) for r in cursor.fetchall()]

    cursor.execute(
        "SELECT * FROM tasks WHERE status = 'backlog' ORDER BY priority DESC, created_at ASC LIMIT 5"
    )
    next_up = [dict(r) for r in cursor.fetchall()]

    cursor.execute("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status")
    status_counts = {r["status"]: r["cnt"] for r in cursor.fetchall()}

    return {
        "done_tasks": done_tasks,
        "running_tasks": running_tasks,
        "blocked_failed": blocked_failed,
        "next_up": next_up,
        "status_counts": status_counts,
    }


def health_indicator(data: dict) -> str:
    if len(data["blocked_failed"]) > 0:
        return "🔴"
    if len(data["running_tasks"]) == 0 and len(data["done_tasks"]) == 0:
        return "🟡"
    return "🟢"


def build_project_report(slug: str, name: str, data: dict) -> str:
    lines = []
    health = health_indicator(data)
    lines.append(f"{health} **{name}** (`{slug}`)")
    lines.append("")
    lines.append(f"⏰ Work window: {WORK_WINDOW_START}:00–{WORK_WINDOW_END}:00 Madrid")
    lines.append("")

    sc = data["status_counts"]
    total = sum(sc.values())
    lines.append(f"📊 Total tasks: {total}")
    lines.append("")

    done = data["done_tasks"]
    if done:
        lines.append(f"✅ **Done ({len(done)}):**")
        for t in done:
            parts = [f"  • {t['title'][:80]}"]
            if t.get("created_by"):
                parts.append(f"[{t['created_by']}]")
            if t.get("assignee"):
                parts.append(f"👤 {t['assignee']}")
            lines.append(" ".join(parts))
        lines.append("")

    running = data["running_tasks"]
    if running:
        lines.append(f"🔄 **Running ({len(running)}):**")
        for t in running:
            parts = [f"  • {t['title'][:80]}"]
            if t.get("created_by"):
                parts.append(f"[{t['created_by']}]")
            if t.get("assignee"):
                parts.append(f"👤 {t['assignee']}")
            lines.append(" ".join(parts))
        lines.append("")

    bf = data["blocked_failed"]
    if bf:
        lines.append(f"🚫 **Blocked/Failed ({len(bf)}):**")
        for t in bf:
            icon = "🚫" if t["status"] == "blocked" else "❌"
            parts = [f"  {icon} {t['title'][:80]}"]
            if t.get("created_by"):
                parts.append(f"[{t['created_by']}]")
            if t.get("assignee"):
                parts.append(f"👤 {t['assignee']}")
            lines.append(" ".join(parts))
        lines.append("")

    nu = data["next_up"]
    if nu:
        lines.append("📋 **Next up:**")
        for t in nu:
            prio = "🔥" if t["priority"] == 1 else ("⏳" if t["priority"] == 2 else "  ")
            lines.append(f"  {prio} {t['title'][:80]}")
        lines.append("")

    return "\n".join(lines)


def build_report(target_date: date) -> str:
    header = [
        f"📋 **Hermes Daily Report** — {target_date.isoformat()}",
        "🌍 Europe/Madrid",
        "",
    ]
    sections = []
    for slug, name in PROJECTS.items():
        try:
            conn = connect_board(slug)
            data = query_board(conn, target_date)
            conn.close()
            sections.append(build_project_report(slug, name, data))
        except Exception as e:
            sections.append(f"🔴 **{name}** — Error: {e}")

    return "\n".join(header) + "\n\n" + "\n\n".join(sections)


def send_telegram(report: str):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("⚠️  TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set. Skipping send.")
        return

    bot = Bot(token=TELEGRAM_TOKEN)
    max_len = 4096

    if len(report) <= max_len:
        messages = [report]
    else:
        sections = report.split("\n\n")
        messages = []
        current = ""
        for section in sections:
            if len(current) + len(section) + 2 > max_len:
                if current:
                    messages.append(current.strip())
                current = section
            else:
                current = (current + "\n\n" + section) if current else section
        if current:
            messages.append(current.strip())

    for msg in messages:
        try:
            bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=msg, parse_mode="Markdown")
        except TelegramError as e:
            print(f"⚠️  Telegram send failed, retrying: {e}")
            try:
                bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=msg, parse_mode="Markdown")
            except TelegramError as e2:
                print(f"❌ Telegram send failed after retry: {e2}")


def main():
    parser = argparse.ArgumentParser(description="Hermes Daily Reporter")
    parser.add_argument("--date", type=str, default=None, help="Date YYYY-MM-DD")
    args = parser.parse_args()

    if args.date:
        target_date = date.fromisoformat(args.date)
    else:
        now = datetime.now(TZ)
        if now.hour < WORK_WINDOW_END:
            target_date = now.date() - timedelta(days=1)
        else:
            target_date = now.date()

    report = build_report(target_date)
    print(report)
    send_telegram(report)


if __name__ == "__main__":
    main()
