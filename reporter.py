#!/usr/bin/env python3
"""
Hermes Daily Reporter — Reporte multi-proyecto por Telegram.
Lee los boards Kanban SQLite y envía un resumen formateado.

Uso:
  reporter.py                          # envía a Telegram (hoy)
  reporter.py --stdout                 # imprime en terminal (hoy)
  reporter.py --telegram               # envía a Telegram (hoy)
  reporter.py --date 2025-06-10        # reporte de un día concreto
  reporter.py --date 2025-06-10 --stdout
"""

import sqlite3
import os
import sys
import time
import asyncio
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# ── DEPENDENCIAS EXTERNAS ──────────────────────────────────────────────────────
# pip install python-telegram-bot
from telegram import Bot
from telegram.error import TelegramError, NetworkError, TimedOut

# ── CONFIGURACIÓN ─────────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID", "")

MADRID = ZoneInfo("Europe/Madrid")

BOARDS_BASE = Path("/home/ubuntu/.hermes/kanban/boards")

PROJECTS: dict[str, dict] = {
    "logileads":   {"name": "Logileads",   "emoji": "📊"},
    "erp-cofrade": {"name": "CofradíaOS",  "emoji": "⛪"},
    "takeflow":    {"name": "Takeflow",    "emoji": "🎬"},
    "idp":         {"name": "IDP",         "emoji": "🎵"},
}

# Perfil orquestador y ventana de trabajo
ORCHESTRATOR_PROFILE = "dev"
WINDOW_START = "2:00"
WINDOW_END   = "10:00"

# Modelos y agentes conocidos (para formatear created_by legiblemente)
AGENT_LABELS: dict[str, str] = {
    "dev":          "Orquestador",
    "claude-code":  "Claude Code",
    "claude_code":  "Claude Code",
    "opencode":     "OpenCode",
    "open-code":    "OpenCode",
    "command-code": "Command Code",
    "command_code": "Command Code",
    # Añade aquí otros valores que aparezcan en el campo created_by
}

TELEGRAM_MAX_CHARS = 4096
RETRY_ATTEMPTS     = 3
RETRY_BASE_DELAY   = 2  # segundos, backoff exponencial: 2, 4, 8


# ── ZONA HORARIA Y VENTANAS TEMPORALES ────────────────────────────────────────

def resolve_target_date(date_str: str | None) -> datetime:
    """
    Devuelve un datetime en hora de Madrid representando
    el inicio del día objetivo (medianoche local).

    Si date_str es None, usa hoy.
    Si date_str es 'YYYY-MM-DD', usa ese día.
    """
    if date_str:
        try:
            naive = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            print(f"Error: formato de fecha inválido '{date_str}'. Usa YYYY-MM-DD.")
            sys.exit(1)
        return datetime(naive.year, naive.month, naive.day, 0, 0, 0, tzinfo=MADRID)
    else:
        now_madrid = datetime.now(MADRID)
        return now_madrid.replace(hour=0, minute=0, second=0, microsecond=0)


def build_time_windows(target_day: datetime) -> dict[str, int]:
    """
    Devuelve todos los timestamps Unix que necesitan las queries,
    calculados correctamente para la zona horaria de Madrid.

    target_day debe ser datetime con tzinfo=MADRID a medianoche.
    """
    # Inicio y fin del día objetivo
    start_of_today = target_day
    end_of_today   = target_day + timedelta(days=1)

    # Inicio de la semana (lunes) que contiene target_day
    day_of_week  = target_day.weekday()          # 0=lunes … 6=domingo
    start_of_week = target_day - timedelta(days=day_of_week)

    # Ventanas de 7 y 14 días (para velocidad)
    seven_days_ago     = target_day - timedelta(days=7)
    prev_seven_days_ago = target_day - timedelta(days=14)

    # Ventana de trabajo: 2:00–10:00 AM del día objetivo
    work_window_start = target_day.replace(hour=2,  minute=0)
    work_window_end   = target_day.replace(hour=10, minute=0)

    def ts(dt: datetime) -> int:
        return int(dt.timestamp())

    return {
        "start_of_today":       ts(start_of_today),
        "end_of_today":         ts(end_of_today),
        "start_of_week":        ts(start_of_week),
        "seven_days_ago":       ts(seven_days_ago),
        "prev_seven_days_ago":  ts(prev_seven_days_ago),
        "work_window_start":    ts(work_window_start),
        "work_window_end":      ts(work_window_end),
    }


def next_window_label(target_day: datetime) -> str:
    """
    Devuelve la etiqueta de la próxima ventana de trabajo.
    Si el reporte es de hoy, la próxima ventana es "mañana 2:00 AM".
    Si es de un día pasado, indica la fecha concreta.
    """
    now_madrid = datetime.now(MADRID)
    tomorrow = (target_day + timedelta(days=1)).strftime("%d %b")
    
    today_start = now_madrid.replace(hour=0, minute=0, second=0, microsecond=0)
    if target_day.date() == today_start.date():
        return f"mañana {WINDOW_START} AM"
    else:
        return f"{tomorrow} {WINDOW_START} AM"


# ── LECTURA DE DATOS ──────────────────────────────────────────────────────────

def get_db(slug: str) -> sqlite3.Connection | None:
    db_path = BOARDS_BASE / slug / "kanban.db"
    if not db_path.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"[WARN] No se pudo abrir {db_path}: {e}")
        return None


def format_agent(created_by: str | None) -> str:
    """Convierte el valor raw de created_by a etiqueta legible."""
    if not created_by:
        return ""
    return AGENT_LABELS.get(created_by.lower(), created_by)


def read_board(slug: str, windows: dict[str, int]) -> dict | None:
    conn = get_db(slug)
    if conn is None:
        return None

    try:
        cur = conn.cursor()

        # ── Completadas en la ventana de trabajo (2–10 AM) del día objetivo
        cur.execute("""
            SELECT title, result as completion_note, result, completed_at,
                   assignee, created_by
            FROM tasks
            WHERE status = 'done'
              AND completed_at >= :work_window_start
              AND completed_at <  :work_window_end
            ORDER BY completed_at DESC
        """, windows)
        done_in_window = [dict(r) for r in cur.fetchall()]

        # ── Completadas en el día completo (para el conteo de "hoy")
        cur.execute("""
            SELECT COUNT(*) as c FROM tasks
            WHERE status = 'done'
              AND completed_at >= :start_of_today
              AND completed_at <  :end_of_today
        """, windows)
        done_today_count = cur.fetchone()["c"]

        # ── Completadas esta semana
        cur.execute("""
            SELECT COUNT(*) as c FROM tasks
            WHERE status = 'done'
              AND completed_at >= :start_of_week
        """, windows)
        done_week_count = cur.fetchone()["c"]

        # ── En curso ahora mismo
        cur.execute("""
            SELECT title, assignee, started_at, priority, created_by
            FROM tasks
            WHERE status = 'running'
            ORDER BY priority ASC, started_at ASC
        """)
        running = [dict(r) for r in cur.fetchall()]

        # ── Bloqueadas / fallidas (requieren atención humana)
        cur.execute("""
            SELECT t.title, t.status, t.assignee, t.priority, t.created_by,
                   t.last_failure_error as last_comment
            FROM tasks t
            WHERE t.status IN ('blocked', 'failed')
            ORDER BY t.priority ASC
        """)
        attention = [dict(r) for r in cur.fetchall()]

        # ── Siguiente en cola (ready primero, luego backlog)
        cur.execute("""
            SELECT title, status, priority, created_by
            FROM tasks
            WHERE status IN ('ready', 'backlog')
            ORDER BY
              CASE WHEN status = 'ready' THEN 0 ELSE 1 END,
              priority ASC,
              created_at ASC
            LIMIT 5
        """)
        next_up = [dict(r) for r in cur.fetchall()]

        # ── Contadores por estado
        cur.execute("""
            SELECT status, COUNT(*) as count
            FROM tasks
            WHERE status NOT IN ('archived')
            GROUP BY status
        """)
        counts = {r["status"]: r["count"] for r in cur.fetchall()}

        # ── Velocidad: semana actual vs semana anterior
        cur.execute("""
            SELECT COUNT(*) as c FROM tasks
            WHERE status = 'done'
              AND completed_at >= :seven_days_ago
        """, windows)
        velocity_current = cur.fetchone()["c"]

        cur.execute("""
            SELECT COUNT(*) as c FROM tasks
            WHERE status = 'done'
              AND completed_at >= :prev_seven_days_ago
              AND completed_at <  :seven_days_ago
        """, windows)
        velocity_previous = cur.fetchone()["c"]

        # ── Tareas creadas por el orquestador vs agentes (hoy)
        cur.execute("""
            SELECT created_by, COUNT(*) as count
            FROM tasks
            WHERE created_at >= :start_of_today
              AND created_at <  :end_of_today
            GROUP BY created_by
        """, windows)
        created_by_breakdown = {r["created_by"]: r["count"] for r in cur.fetchall()}

        # ── Última actividad (para detectar proyectos dormidos)
        cur.execute("""
            SELECT MAX(COALESCE(completed_at, started_at, created_at)) AS t
            FROM tasks
            WHERE status NOT IN ('archived')
        """)
        row = cur.fetchone()
        last_activity = row["t"] if row else None

        return {
            "done_in_window":        done_in_window,
            "done_today_count":      done_today_count,
            "done_week_count":       done_week_count,
            "running":               running,
            "attention":             attention,
            "next_up":               next_up,
            "counts":                counts,
            "velocity_current":      velocity_current,
            "velocity_previous":     velocity_previous,
            "created_by_breakdown":  created_by_breakdown,
            "last_activity":         last_activity,
        }

    except sqlite3.Error as e:
        print(f"[ERROR] Leyendo board {slug}: {e}")
        return None
    finally:
        conn.close()


# ── LÓGICA DE SALUD ───────────────────────────────────────────────────────────

def health_indicator(stats: dict, windows: dict[str, int]) -> str:
    counts = stats.get("counts", {})
    now    = int(time.time())

    if counts.get("failed", 0) > 0:
        return "🔴"
    if counts.get("blocked", 0) > 0:
        return "🟡"
    if not stats["done_in_window"] and not stats["running"]:
        last = stats.get("last_activity")
        if last and (now - last) > 86400:
            return "🔴"
        return "🟡"
    return "🟢"


# ── FORMATEO DEL REPORTE ──────────────────────────────────────────────────────

def fmt_task(task: dict, show_agent: bool = True) -> str:
    """Formatea una tarea en una línea con agente y nota."""
    title = task.get("title", "(sin título)")
    note  = task.get("completion_note") or task.get("result") or ""
    agent = format_agent(task.get("created_by")) if show_agent else ""

    agent_str = f" [{agent}]" if agent and agent != "Orquestador" else ""
    note_str  = f' — "{note[:60]}"' if note else ""

    return f"    • {title}{agent_str}{note_str}"


def format_project_block(slug: str, config: dict, stats: dict | None,
                          windows: dict[str, int]) -> str:
    """Devuelve el bloque de texto completo de un proyecto."""
    if stats is None:
        return (
            f"\n{config['emoji']} {config['name']} ⚪\n"
            f"  📁 Board no encontrado: {BOARDS_BASE / slug}\n"
        )

    health = health_indicator(stats, windows)
    lines  = [f"\n{config['emoji']} {config['name']} {health}"]

    # Completadas en la ventana de trabajo
    done = stats["done_in_window"]
    if done:
        lines.append(f"  ✅ Ventana 2–10h ({len(done)}):")
        for t in done[:6]:
            lines.append(fmt_task(t))
        if len(done) > 6:
            lines.append(f"    … y {len(done) - 6} más")
    else:
        lines.append("  ✅ Nada completado en la ventana 2–10h")

    # En curso
    running = stats["running"]
    if running:
        lines.append(f"  🔄 En curso ({len(running)}):")
        for t in running:
            agent  = format_agent(t.get("created_by"))
            a_str  = f" [{agent}]" if agent and agent != "Orquestador" else ""
            elapsed = ""
            if t.get("started_at"):
                hours = (int(time.time()) - t["started_at"]) / 3600
                elapsed = f" ({hours:.1f}h)"
            lines.append(f"    • {t['title']}{a_str}{elapsed}")

    # Atención requerida
    attention = stats["attention"]
    if attention:
        lines.append(f"  ⚠️  Atención ({len(attention)}):")
        for t in attention:
            icon    = "🚫" if t["status"] == "failed" else "🔒"
            comment = t.get("last_comment") or ""
            c_str   = f' — "{comment[:55]}"' if comment else ""
            lines.append(f"    {icon} {t['title']}{c_str}")

    # Siguiente en cola
    next_up = stats["next_up"]
    if next_up:
        lines.append("  📋 Siguiente:")
        for t in next_up[:3]:
            fire = " 🔥" if t.get("priority") == 1 else ""
            lines.append(f"    • {t['title']}{fire}")

    return "\n".join(lines)


def format_header(target_day: datetime) -> str:
    now_madrid = datetime.now(MADRID)
    is_today   = target_day.date() == now_madrid.date()

    date_label = (
        f"Hoy, {target_day.strftime('%A %d %b %Y')}"
        if is_today
        else f"📆 Histórico: {target_day.strftime('%A %d %b %Y')}"
    )
    next_w = next_window_label(target_day)

    return (
        "━━━━━━━━━━━━━━━━━━━━━━━\n"
        "🤖 HERMES — Reporte Diario\n"
        f"📅 {date_label}, {now_madrid.strftime('%H:%M')}\n"
        f"🪟 Ventana: {WINDOW_START}–{WINDOW_END} | Próxima: {next_w}\n"
        f"🤖 Orquestador: {ORCHESTRATOR_PROFILE}\n"
        "🔧 Agentes: Claude Code · OpenCode · Command Code\n"
        "━━━━━━━━━━━━━━━━━━━━━━━"
    )


def format_summary(all_stats: dict[str, dict | None],
                   windows: dict[str, int]) -> str:
    """Bloque de resumen global + acciones requeridas."""
    total_done    = sum(len(s["done_in_window"]) for s in all_stats.values() if s)
    total_running = sum(len(s["running"])         for s in all_stats.values() if s)
    total_blocked = sum(len(s["attention"])        for s in all_stats.values() if s)

    vel_curr = sum(s.get("velocity_current",  0) for s in all_stats.values() if s)
    vel_prev = sum(s.get("velocity_previous", 0) for s in all_stats.values() if s)

    vel_daily      = vel_curr / 7 if vel_curr else 0
    vel_prev_daily = vel_prev / 7 if vel_prev else 0

    if vel_prev_daily > 0:
        trend  = "↑" if vel_daily > vel_prev_daily else ("↓" if vel_daily < vel_prev_daily else "→")
        trend_str = f" ({trend} vs {vel_prev_daily:.1f}/día sem. ant.)"
    else:
        trend_str = ""

    lines = [
        "\n━━━━━━━━━━━━━━━━━━━━━━━",
        "📈 RESUMEN",
        f"  Ventana: {total_done} hechas | {total_running} en curso | {total_blocked} bloqueadas",
        f"  Velocidad: {vel_daily:.1f} tareas/día{trend_str}",
    ]

    # Acciones requeridas por el humano
    actions: list[str] = []
    now = int(time.time())

    for slug, stats in all_stats.items():
        if stats is None:
            continue
        config = PROJECTS[slug]
        for t in stats.get("attention", []):
            comment = t.get("last_comment") or ""
            c_str   = f" — {comment[:50]}" if comment else ""
            actions.append(f"  {config['emoji']} {t['title']}{c_str}")

        # Proyecto dormido: sin actividad y sin running
        if not stats["done_in_window"] and not stats["running"]:
            last = stats.get("last_activity")
            if last and (now - last) > 86400:
                hours_ago = (now - last) // 3600
                actions.append(f"  {config['emoji']} Sin actividad ({hours_ago}h) — ¿repriorizar?")

    if actions:
        lines.append("\n🎯 REQUIERE TU ATENCIÓN:")
        lines.extend(actions[:6])

    lines.append("━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def build_report(target_day: datetime) -> list[str]:
    """
    Construye el reporte y lo devuelve como lista de bloques,
    uno por proyecto más cabecera y pie. Cada bloque cabe en 4096 chars.
    """
    windows   = build_time_windows(target_day)
    all_stats = {slug: read_board(slug, windows) for slug in PROJECTS}

    header  = format_header(target_day)
    summary = format_summary(all_stats, windows)

    # Bloque 0: cabecera + proyectos que quepan en un mensaje
    # Estrategia: un bloque por proyecto para no cortar en medio de una tarea
    blocks: list[str] = []

    # Cabecera siempre va sola si es larga, o con el primer proyecto
    project_blocks = []
    for slug, config in PROJECTS.items():
        stats = all_stats[slug]
        project_blocks.append(format_project_block(slug, config, stats, windows))

    # Intentar meter cabecera + todos los proyectos en el primer mensaje
    first_msg = header + "".join(project_blocks) + summary
    if len(first_msg) <= TELEGRAM_MAX_CHARS:
        return [first_msg]

    # Si no cabe, cabecera sola + un proyecto por mensaje + resumen al final
    blocks.append(header)
    for pb in project_blocks:
        blocks.append(pb)
    blocks.append(summary)

    return blocks


# ── ENVÍO A TELEGRAM ──────────────────────────────────────────────────────────

async def send_blocks(blocks: list[str]) -> None:
    """
    Envía cada bloque como mensaje Telegram independiente.
    Reintenta hasta RETRY_ATTEMPTS veces con backoff exponencial.
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("[ERROR] TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados.")
        print("  Exporta las variables de entorno o usa --stdout.")
        sys.exit(1)

    bot = Bot(token=TELEGRAM_BOT_TOKEN)

    for i, block in enumerate(blocks, 1):
        sent = False
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                await bot.send_message(
                    chat_id=TELEGRAM_CHAT_ID,
                    text=block,
                    read_timeout=30,
                    write_timeout=30,
                    connect_timeout=15,
                )
                sent = True
                print(f"  ✓ Bloque {i}/{len(blocks)} enviado.")
                break

            except (NetworkError, TimedOut) as e:
                delay = RETRY_BASE_DELAY ** attempt
                print(f"  [WARN] Bloque {i}, intento {attempt}: {e}. Reintentando en {delay}s…")
                await asyncio.sleep(delay)

            except TelegramError as e:
                # Error de la API (token inválido, chat_id erróneo, etc.) — no reintentar
                print(f"  [ERROR] Telegram API en bloque {i}: {e}")
                break

        if not sent:
            print(f"  [ERROR] No se pudo enviar bloque {i} tras {RETRY_ATTEMPTS} intentos.")
            print("  Contenido del bloque:")
            print(block)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Hermes Daily Reporter — reporte multi-proyecto Kanban."
    )
    parser.add_argument(
        "--date",
        metavar="YYYY-MM-DD",
        help="Genera el reporte de un día concreto (por defecto: hoy).",
        default=None,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--stdout",
        action="store_true",
        help="Imprime el reporte en la terminal sin enviar a Telegram.",
    )
    mode.add_argument(
        "--telegram",
        action="store_true",
        help="Envía el reporte a Telegram (comportamiento por defecto).",
    )
    return parser.parse_args()


def main() -> None:
    args       = parse_args()
    target_day = resolve_target_date(args.date)
    blocks     = build_report(target_day)

    if args.stdout:
        print("\n".join(blocks))
        return

    # Por defecto (sin flag o con --telegram) → enviar a Telegram + stdout
    print("\n".join(blocks))
    asyncio.run(send_blocks(blocks))


if __name__ == "__main__":
    main()