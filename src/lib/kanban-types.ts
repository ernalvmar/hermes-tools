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

export type HealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

export const HEALTH_ICON: Record<HealthStatus, string> = {
  green:   '🟢',
  yellow:  '🟡',
  red:     '🔴',
  unknown: '⚪',
};

export const AGENT_LABELS: Record<string, string> = {
  dev:          'Orquestador',
  'claude-code':  'Claude Code',
  claude_code:  'Claude Code',
  opencode:     'OpenCode',
  'open-code':    'OpenCode',
  'command-code': 'Command Code',
  command_code: 'Command Code',
};

export function formatAgent(createdBy: string | null): string {
  if (!createdBy) return '';
  const key = createdBy.toLowerCase();
  return AGENT_LABELS[key] ?? createdBy;
}

export interface TaskWithComment extends Task {
  last_comment?: string | null;
}

export interface ProjectStats {
  slug: string;
  name: string;
  health: HealthStatus;

  // Contadores
  done_today: Task[];
  done_today_count: number;
  done_week_count: number;
  running: Task[];
  attention: TaskWithComment[];
  next_up: Task[];

  // Velocidad
  velocity_current: number;
  velocity_previous: number;

  // Breakdown
  created_by_breakdown: Record<string, number>;

  // Timestamps
  last_activity: number | null;

  // Counts por status (legacy, para compatibilidad)
  counts: Record<string, number>;
}

export const PROJECTS: Record<string, string> = {
  logileads:   '📊 Logileads',
  'erp-cofrade': '⛪ CofradíaOS',
  takeflow:    '🎬 Takeflow',
  idp:         '🎵 IDP',
};

export const PROJECT_ORDER = ['logileads', 'erp-cofrade', 'takeflow', 'idp'] as const;

export const PROJECT_META: Record<string, { emoji: string; color: string }> = {
  'logileads':   { emoji: '📊', color: 'border-blue-400' },
  'erp-cofrade': { emoji: '⛪', color: 'border-purple-400' },
  'takeflow':    { emoji: '🎬', color: 'border-emerald-400' },
  'idp':         { emoji: '🎵', color: 'border-amber-400' },
};
