// Shared types and constants — safe to import from client components
// NO better-sqlite3 dependency here

import type { TaskStatus } from './status-badges';

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
