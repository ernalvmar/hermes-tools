import Database from 'better-sqlite3';
import path from 'path';
import {
  PROJECTS,
  PROJECT_ORDER,
  type Task,
  type TaskWithComment,
  type ProjectStats,
  type HealthStatus,
  formatAgent,
} from './kanban-types';

export type { Task, TaskWithComment, ProjectStats };
export { PROJECTS, PROJECT_ORDER };

const BOARDS_DIR = '/home/ubuntu/.hermes/kanban/boards';
const RECENT_ACTIVITY_HOURS = 48;

function getDbPath(slug: string): string {
  return path.join(BOARDS_DIR, slug, 'kanban.db');
}

function openDb(slug: string): Database.Database {
  const db = new Database(getDbPath(slug), { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

// ---------------------------------------------------------------------------
// Time helpers — everything is driven from Europe/Madrid via Intl.
// ---------------------------------------------------------------------------

interface MadridParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getMadridDateParts(timestampMs: number = Date.now()): MadridParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(timestampMs));
  const get = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function getMadridOffsetMinutes(timestampMs: number = Date.now()): number {
  const parts = getMadridDateParts(timestampMs);
  const madridAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((madridAsUtcMs - timestampMs) / 60000);
}

function madridLocalToUnixSeconds(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const naiveMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = getMadridOffsetMinutes(naiveMs) * 60000;
  const utcMs = naiveMs - offsetMs;
  // Recompute offset at the real UTC instant in case naiveMs sat near a DST transition.
  const offsetMs2 = getMadridOffsetMinutes(utcMs) * 60000;
  return Math.floor((naiveMs - offsetMs2) / 1000);
}

export function weekStartMadrid(): number {
  const { year, month, day } = getMadridDateParts(Date.now());
  const jsDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = jsDate.getUTCDay(); // 0 = Sunday, 1 = Monday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  jsDate.setUTCDate(jsDate.getUTCDate() - daysSinceMonday);

  return madridLocalToUnixSeconds(
    jsDate.getUTCFullYear(),
    jsDate.getUTCMonth() + 1,
    jsDate.getUTCDate(),
  );
}

export function workWindowMadrid(): [number, number] {
  const { year, month, day } = getMadridDateParts(Date.now());
  const start = madridLocalToUnixSeconds(year, month, day, 2, 0, 0);
  const end = madridLocalToUnixSeconds(year, month, day, 10, 0, 0);
  return [start, end];
}

export function sevenDaysAgo(): number {
  return Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
}

export function fourteenDaysAgo(): number {
  return Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
}

function todayRangeMadrid(): [number, number] {
  const { year, month, day } = getMadridDateParts(Date.now());
  const start = madridLocalToUnixSeconds(year, month, day, 0, 0, 0);
  return [start, start + 86400];
}

// ---------------------------------------------------------------------------
// Task mapping
// ---------------------------------------------------------------------------

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    body: row.body == null ? null : String(row.body),
    assignee: row.assignee == null ? null : String(row.assignee),
    status: String(row.status ?? 'backlog'),
    priority: Number(row.priority ?? 0),
    created_at: row.created_at == null ? null : Number(row.created_at),
    started_at: row.started_at == null ? null : Number(row.started_at),
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
    result: row.result == null ? null : String(row.result),
    workspace_kind:
      row.workspace_kind == null ? null : String(row.workspace_kind),
    created_by: row.created_by == null ? null : String(row.created_by),
    workflow: String(row.workflow ?? row.workspace_kind ?? 'default'),
    completion_note: row.completion_note == null ? null : String(row.completion_note),
  };
}

function mapTaskWithComment(row: Record<string, unknown>): TaskWithComment {
  return {
    ...mapTask(row),
    last_comment: row.last_comment == null ? null : String(row.last_comment),
  };
}

// ---------------------------------------------------------------------------
// Health indicator
// ---------------------------------------------------------------------------

function determineHealth(
  counts: Record<string, number>,
  doneTodayCount: number,
  runningCount: number,
): HealthStatus {
  if ((counts.failed ?? 0) > 0) return 'red';
  if ((counts.blocked ?? 0) > 0) return 'yellow';
  if (runningCount > 0 || doneTodayCount > 0) return 'green';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Project reader
// ---------------------------------------------------------------------------

export function readProject(slug: string): ProjectStats {
  if (!PROJECTS[slug]) {
    throw new Error(`Unknown project slug: ${slug}`);
  }

  const name = PROJECTS[slug];
  const db = openDb(slug);

  try {
    const [workStart, workEnd] = workWindowMadrid();
    const [todayStart, todayEnd] = todayRangeMadrid();
    const weekStart = weekStartMadrid();
    const sevenAgo = sevenDaysAgo();
    const fourteenAgo = fourteenDaysAgo();

    // g) Counts by status
    const countRows = db
      .prepare("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status")
      .all() as { status: string; cnt: number }[];

    const counts: Record<string, number> = {
      backlog: 0,
      ready: 0,
      running: 0,
      done: 0,
      blocked: 0,
      failed: 0,
      archived: 0,
    };
    for (const r of countRows) {
      counts[r.status] = r.cnt;
    }

    // a) Done in work window (2-10h Madrid today)
    const doneTodayRows = db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ? ORDER BY completed_at DESC",
      )
      .all(workStart, workEnd) as Record<string, unknown>[];

    // b) Done today count
    const doneTodayCount =
      (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?",
          )
          .get(todayStart, todayEnd) as { cnt: number }
      )?.cnt ?? 0;

    // c) Done this week count
    const doneWeekCount =
      (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND completed_at >= ?",
          )
          .get(weekStart) as { cnt: number }
      )?.cnt ?? 0;

    // d) Running tasks
    const runningRows = db
      .prepare(
        "SELECT * FROM tasks WHERE status = 'running' ORDER BY started_at DESC",
      )
      .all() as Record<string, unknown>[];

    // e) Attention (blocked/failed with last comment)
    const attentionRows = db
      .prepare(
        `SELECT t.*, c.body as last_comment
         FROM tasks t
         LEFT JOIN (
           SELECT task_id, body
           FROM task_comments
           WHERE id IN (
             SELECT MAX(id) FROM task_comments GROUP BY task_id
           )
         ) c ON c.task_id = t.id
         WHERE t.status IN ('blocked', 'failed')
         ORDER BY t.started_at DESC`,
      )
      .all() as Record<string, unknown>[];

    // f) Next up (ready first, then backlog, limit 5)
    const nextUpRows = db
      .prepare(
        `SELECT * FROM tasks
         WHERE status IN ('ready', 'backlog')
         ORDER BY CASE status WHEN 'ready' THEN 0 ELSE 1 END,
                  priority ASC,
                  created_at DESC
         LIMIT 5`,
      )
      .all() as Record<string, unknown>[];

    // h) Velocity current (7 days)
    const velocityCurrent =
      (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND completed_at >= ?",
          )
          .get(sevenAgo) as { cnt: number }
      )?.cnt ?? 0;

    // i) Velocity previous (7-14 days ago)
    const velocityPrevious =
      (
        db
          .prepare(
            "SELECT COUNT(*) as cnt FROM tasks WHERE status = 'done' AND completed_at >= ? AND completed_at < ?",
          )
          .get(fourteenAgo, sevenAgo) as { cnt: number }
      )?.cnt ?? 0;

    // j) Created by breakdown (today)
    const createdByRows = db
      .prepare(
        "SELECT created_by, COUNT(*) as cnt FROM tasks WHERE created_at >= ? AND created_at < ? GROUP BY created_by",
      )
      .all(todayStart, todayEnd) as { created_by: string | null; cnt: number }[];

    const createdByBreakdown: Record<string, number> = {};
    for (const r of createdByRows) {
      const key = formatAgent(r.created_by) || 'Unknown';
      createdByBreakdown[key] = (createdByBreakdown[key] ?? 0) + r.cnt;
    }

    // k) Last activity
    const lastActivityRow = db
      .prepare(
        "SELECT MAX(MAX(IFNULL(created_at, 0), IFNULL(started_at, 0)), IFNULL(completed_at, 0)) as last_activity FROM tasks",
      )
      .get() as { last_activity: number | null };

    const health = determineHealth(counts, doneTodayCount, runningRows.length);

    return {
      slug,
      name,
      health,
      done_today: doneTodayRows.map(mapTask),
      done_today_count: doneTodayCount,
      done_week_count: doneWeekCount,
      running: runningRows.map(mapTask),
      attention: attentionRows.map(mapTaskWithComment),
      next_up: nextUpRows.map(mapTask),
      velocity_current: velocityCurrent,
      velocity_previous: velocityPrevious,
      created_by_breakdown: createdByBreakdown,
      last_activity: lastActivityRow?.last_activity ?? null,
      counts,
    };
  } finally {
    db.close();
  }
}

export function readAllProjects(): ProjectStats[] {
  return PROJECT_ORDER.map((slug) => readProject(slug));
}

// ---------------------------------------------------------------------------
// Task fetchers
// ---------------------------------------------------------------------------

export function getTasks(slug: string): Task[] {
  const db = openDb(slug);
  try {
    const rows = db
      .prepare(
        "SELECT * FROM tasks WHERE status != 'archived' ORDER BY priority ASC, created_at DESC",
      )
      .all() as Record<string, unknown>[];
    return rows.map(mapTask);
  } finally {
    db.close();
  }
}

export function getTaskById(slug: string, id: string): Task | undefined {
  const db = openDb(slug);
  try {
    const row = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapTask(row) : undefined;
  } finally {
    db.close();
  }
}

export function getRecentActivity(slug?: string): Task[] {
  const cutoff = Math.floor(
    (Date.now() - RECENT_ACTIVITY_HOURS * 60 * 60 * 1000) / 1000,
  );
  const slugs = slug ? [slug] : PROJECT_ORDER;

  const all: Task[] = [];
  for (const s of slugs) {
    const db = openDb(s);
    try {
      const rows = db
        .prepare(
          `SELECT *,
             MAX(MAX(IFNULL(completed_at, 0), IFNULL(started_at, 0)), IFNULL(created_at, 0)) as last_updated_at
           FROM tasks
           WHERE MAX(MAX(IFNULL(completed_at, 0), IFNULL(started_at, 0)), IFNULL(created_at, 0)) >= ?
           ORDER BY last_updated_at DESC`,
        )
        .all(cutoff) as Record<string, unknown>[];
      all.push(...rows.map(mapTask));
    } finally {
      db.close();
    }
  }

  return all.sort(
    (a, b) =>
      Math.max(b.completed_at ?? 0, b.started_at ?? 0, b.created_at ?? 0) -
      Math.max(a.completed_at ?? 0, a.started_at ?? 0, a.created_at ?? 0),
  );
}
