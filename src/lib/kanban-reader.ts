import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { type TaskStatus } from './status-badges';

export interface Task {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  created_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  workspace_kind: string | null;
  created_by: string | null;
  workflow: string;
  completion_note: string | null;
}

export interface ProjectStats {
  slug: string;
  name: string;
  total: number;
  backlog: number;
  ready: number;
  running: number;
  done: number;
  blocked: number;
  failed: number;
  archived: number;
  doneToday: Task[];
  runningTasks: Task[];
  blockedFailed: Task[];
  nextUp: Task[];
}

export const PROJECTS: Record<string, string> = {
  logileads: '📊 Logileads',
  'erp-cofrade': '⛪ CofradíaOS',
  takeflow: '🎬 Takeflow',
  idp: '🎵 IDP',
};

const BOARDS_DIR = '/home/ubuntu/.hermes/kanban/boards';

function getDbPath(slug: string): string {
  return path.join(BOARDS_DIR, slug, 'kanban.db');
}

function todayRange(): [number, number] {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400) - 86400 * new Date().getTimezoneOffset() / 1440;
  const normalized = dayStart - (dayStart % 86400);
  return [normalized, normalized + 86400];
}

export function readProject(slug: string): ProjectStats {
  const dbPath = getDbPath(slug);
  const db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  const name = PROJECTS[slug] ?? slug;

  const countRows = db
    .prepare("SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status")
    .all() as { status: string; cnt: number }[];

  const counts: Record<string, number> = {
    backlog: 0, ready: 0, running: 0, done: 0, blocked: 0, failed: 0, archived: 0,
  };
  for (const r of countRows) {
    counts[r.status] = r.cnt;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const [dayStart, dayEnd] = todayRange();

  const doneToday = db
    .prepare(
      "SELECT * FROM tasks WHERE completed_at >= ? AND completed_at < ? AND status = 'done'"
    )
    .all(dayStart, dayEnd) as Task[];

  const runningTasks = db
    .prepare("SELECT * FROM tasks WHERE status = 'running'")
    .all() as Task[];

  const blockedFailed = db
    .prepare("SELECT * FROM tasks WHERE status IN ('blocked', 'failed')")
    .all() as Task[];

  const nextUp = db
    .prepare(
      "SELECT * FROM tasks WHERE status = 'backlog' ORDER BY priority DESC, created_at ASC LIMIT 5"
    )
    .all() as Task[];

  db.close();

  return {
    slug,
    name,
    total,
    backlog: counts.backlog,
    ready: counts.ready,
    running: counts.running,
    done: counts.done,
    blocked: counts.blocked,
    failed: counts.failed,
    archived: counts.archived,
    doneToday,
    runningTasks,
    blockedFailed,
    nextUp,
  };
}

export function readAllProjects(): ProjectStats[] {
  return Object.keys(PROJECTS).map((slug) => readProject(slug));
}
