'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ProjectStats, Task, TaskWithComment } from '@/lib/kanban-types';
import {
  HEALTH_ICON,
  PROJECTS,
  PROJECT_META,
  formatAgent,
} from '@/lib/kanban-types';
import { STATUS_BADGE, type TaskStatus } from '@/lib/status-badges';

type PageProps = {
  params: { slug: string };
};

type DateFilter = 'todos' | 'hoy' | 'semana' | 'mes';

const STATUS_ORDER: TaskStatus[] = [
  'done',
  'running',
  'blocked',
  'failed',
  'ready',
  'backlog',
  'archived',
];

function normalizeStatus(status: string): TaskStatus {
  if (status in STATUS_BADGE) return status as TaskStatus;
  return 'backlog';
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function elapsedSince(ts: number | null): string {
  if (!ts) return '—';
  const total = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function lastUpdatedAt(task: Task): number {
  return Math.max(
    task.created_at ?? 0,
    task.started_at ?? 0,
    task.completed_at ?? 0,
  );
}

function startOfTodaySeconds(): number {
  const now = new Date();
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000,
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[normalizeStatus(status)];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 text-center transition-colors">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
        {value}
      </div>
    </div>
  );
}

function ExpandableTask({
  task,
  showElapsed,
}: {
  task: Task | TaskWithComment;
  showElapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const lastComment = 'last_comment' in task ? task.last_comment : null;

  return (
    <div
      className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 min-w-0"
      >
        <StatusBadge status={task.status} />
        <span className="flex-1 text-sm truncate text-gray-900 dark:text-gray-100">
          {task.title}
        </span>
        {showElapsed && task.started_at && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400 shrink-0">
            {elapsedSince(task.started_at)}
          </span>
        )}
        {task.created_by && task.created_by !== 'dev' && (
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {formatAgent(task.created_by)}
          </span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 pt-0 text-sm space-y-2">
          {task.body && (
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">
              {task.body}
            </p>
          )}
          {task.result && (
            <div className="bg-green-50 dark:bg-green-950/30 rounded p-2 text-green-800 dark:text-green-200">
              <span className="font-semibold">Resultado:</span> {task.result}
            </div>
          )}
          {task.completion_note && (
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-2 text-blue-800 dark:text-blue-200">
              <span className="font-semibold">Nota:</span>{' '}
              {task.completion_note}
            </div>
          )}
          {lastComment && (
            <div className="bg-red-50 dark:bg-red-950/30 rounded p-2 text-red-800 dark:text-red-200">
              <span className="font-semibold">Último comentario:</span>{' '}
              {lastComment}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
            <div>Creado: {formatDate(task.created_at)}</div>
            <div>Inicio: {formatDate(task.started_at)}</div>
            <div>Completado: {formatDate(task.completed_at)}</div>
            <div>Agente: {formatAgent(task.created_by)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectPage({ params }: PageProps) {
  const { slug } = params;

  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'todos'>('todos');
  const [agentFilter, setAgentFilter] = useState<string>('todos');
  const [dateFilter, setDateFilter] = useState<DateFilter>('todos');

  useEffect(() => {
    let mounted = true;

    async function fetchAll() {
      try {
        setLoading(true);
        setError(null);

        const [statsRes, tasksRes, activityRes] = await Promise.all([
          fetch(`/api/dashboard?project=${encodeURIComponent(slug)}`),
          fetch(`/api/projects/${encodeURIComponent(slug)}`),
          fetch(`/api/activity?project=${encodeURIComponent(slug)}`),
        ]);

        if (!statsRes.ok) throw new Error(`Stats HTTP ${statsRes.status}`);
        if (!tasksRes.ok) throw new Error(`Tasks HTTP ${tasksRes.status}`);
        if (!activityRes.ok) throw new Error(`Activity HTTP ${activityRes.status}`);

        const statsJson = (await statsRes.json()) as ProjectStats;
        const tasksJson = (await tasksRes.json()) as Task[];
        const activityJson = (await activityRes.json()) as Task[];

        if (mounted) {
          setStats(statsJson);
          setTasks(tasksJson);
          setActivity(activityJson);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchAll();
  }, [slug]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.created_by) set.add(t.created_by);
    }
    return Array.from(set).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const todayStart = startOfTodaySeconds();
    const weekStart = todayStart - 7 * 24 * 60 * 60;
    const monthStart = todayStart - 30 * 24 * 60 * 60;

    return tasks.filter((t) => {
      if (statusFilter !== 'todos' && normalizeStatus(t.status) !== statusFilter) {
        return false;
      }
      if (agentFilter !== 'todos' && t.created_by !== agentFilter) {
        return false;
      }
      if (dateFilter !== 'todos') {
        const ts = t.created_at ?? 0;
        if (!ts) return false;
        if (dateFilter === 'hoy' && ts < todayStart) return false;
        if (dateFilter === 'semana' && ts < weekStart) return false;
        if (dateFilter === 'mes' && ts < monthStart) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, agentFilter, dateFilter]);

  const projectName = PROJECTS[slug] ?? slug;
  const projectEmoji = PROJECT_META[slug]?.emoji ?? '📁';
  const health: ProjectStats['health'] = stats?.health ?? 'unknown';

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
        <div className="max-w-5xl mx-auto space-y-4 animate-pulse">
          <div className="h-8 bg-white dark:bg-gray-900 rounded w-1/3" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-white dark:bg-gray-900 rounded-xl" />
            ))}
          </div>
          <div className="h-40 bg-white dark:bg-gray-900 rounded-xl" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
        <div className="max-w-5xl mx-auto">
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Volver al dashboard
          </Link>
          <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{projectEmoji}</span>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {projectName}
            </h1>
            <span className="text-2xl" title={`Health: ${health}`}>
              {HEALTH_ICON[health]}
            </span>
          </div>
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            ← Volver al dashboard
          </Link>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Hoy" value={stats.done_today_count} />
            <StatCard label="Semana" value={stats.done_week_count} />
            <StatCard label="Velocidad 7d" value={stats.velocity_current} />
            <StatCard label="Running" value={stats.running.length} />
            <StatCard
              label="Estados"
              value={Object.entries(stats.counts)
                .filter(([, c]) => c > 0)
                .map(([s, c]) => `${s}: ${c}`)
                .join(' / ') || '—'}
            />
          </div>
        )}

        {stats && stats.done_today.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              ✅ Completado hoy
            </h2>
            <div className="space-y-2">
              {stats.done_today.map((t) => (
                <ExpandableTask key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        {stats && stats.running.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              🔄 En curso
            </h2>
            <div className="space-y-2">
              {stats.running.map((t) => (
                <ExpandableTask key={t.id} task={t} showElapsed />
              ))}
            </div>
          </section>
        )}

        {stats && stats.attention.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
              ⚠️ Atención
            </h2>
            <div className="space-y-2">
              {stats.attention.map((t) => (
                <ExpandableTask key={t.id} task={t} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            📋 Tareas
          </h2>

          <div className="flex flex-wrap gap-2 mb-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'todos')}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
            >
              <option value="todos">Todos los estados</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_BADGE[s].label}
                </option>
              ))}
            </select>

            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
            >
              <option value="todos">Todos los agentes</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {formatAgent(a)}
                </option>
              ))}
            </select>

            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
            >
              <option value="todos">Todas las fechas</option>
              <option value="hoy">Hoy</option>
              <option value="semana">Esta semana</option>
              <option value="mes">Este mes</option>
            </select>
          </div>

          <div className="space-y-2">
            {filteredTasks.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No hay tareas que coincidan con los filtros.
              </p>
            ) : (
              filteredTasks.map((t) => <ExpandableTask key={t.id} task={t} />)
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            🕓 Actividad reciente
          </h2>
          <div className="space-y-2">
            {activity.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Sin actividad reciente.
              </p>
            ) : (
              activity.slice(0, 20).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                >
                  <StatusBadge status={t.status} />
                  <span className="flex-1 text-sm truncate text-gray-900 dark:text-gray-100">
                    {t.title}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    {formatShortDate(lastUpdatedAt(t))}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
