'use client';

import { useEffect, useState } from 'react';
import type { ProjectStats, Task, TaskWithComment } from '@/lib/kanban-types';
import {
  HEALTH_ICON,
  PROJECTS,
  PROJECT_ORDER,
  PROJECT_META,
  formatAgent,
} from '@/lib/kanban-types';
import { STATUS_BADGE, type TaskStatus } from '@/lib/status-badges';

type FilterKey = 'todos' | string;

function normalizeStatus(status: string): TaskStatus {
  if (status in STATUS_BADGE) return status as TaskStatus;
  return 'backlog';
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function TaskRow({ task }: { task: Task | TaskWithComment }) {
  const note = task.completion_note ?? task.result;
  return (
    <div className="flex flex-col gap-0.5 py-1.5 px-2 rounded transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <div className="flex items-center gap-2 min-w-0">
        <StatusBadge status={task.status} />
        <span className="flex-1 text-sm truncate text-gray-900 dark:text-gray-100">
          {task.title}
        </span>
        {task.created_by && task.created_by !== 'dev' && (
          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
            {formatAgent(task.created_by)}
          </span>
        )}
      </div>
      {note && (
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate pl-[calc(0.5rem+2px)]">
          {note}
        </span>
      )}
    </div>
  );
}

function ProjectColumn({ stats }: { stats: ProjectStats }) {
  const hasAny =
    stats.done_today.length > 0 ||
    stats.running.length > 0 ||
    stats.attention.length > 0 ||
    stats.next_up.length > 0;

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden transition-colors ${
        PROJECT_META[stats.slug]?.color ?? 'border-gray-200'
      } border-t-4`}
    >
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">
            {PROJECT_META[stats.slug]?.emoji ?? '📁'}
          </span>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {stats.name}
          </h2>
          <span
            className="ml-auto text-lg"
            title={`Health: ${stats.health}`}
          >
            {HEALTH_ICON[stats.health]}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400">Hoy</div>
            <div className="text-lg font-bold text-green-600 dark:text-green-400">
              {stats.done_today_count}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Running
            </div>
            <div className="text-lg font-bold text-yellow-500 dark:text-yellow-400">
              {stats.running.length}
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 text-center">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Semana
            </div>
            <div className="text-lg font-bold text-blue-500 dark:text-blue-400">
              {stats.done_week_count}
            </div>
          </div>
        </div>

        {!hasAny ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No hay tareas activas en este proyecto.
          </p>
        ) : (
          <div className="space-y-4">
            {stats.attention.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-red-600 dark:text-red-400 mb-1">
                  ⚠️ Atención
                </h3>
                {stats.attention.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
            {stats.done_today.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-green-600 dark:text-green-400 mb-1">
                  ✅ Completado hoy
                </h3>
                {stats.done_today.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
            {stats.running.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-yellow-600 dark:text-yellow-400 mb-1">
                  🔄 En curso
                </h3>
                {stats.running.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
            {stats.next_up.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">
                  📋 Siguiente
                </h3>
                {stats.next_up.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<ProjectStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterKey>('todos');

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ProjectStats[];
        if (mounted) {
          setData(json);
          setLastUpdate(new Date());
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const filterButtons: { key: FilterKey; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    ...PROJECT_ORDER.map((slug) => ({ key: slug, label: PROJECTS[slug] })),
  ];

  const visible =
    filter === 'todos' ? data : data.filter((s) => s.slug === filter);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            🤖 Hermes Dashboard
          </h1>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {lastUpdate
              ? `Actualizado: ${formatTime(lastUpdate)}`
              : loading
                ? 'Cargando...'
                : '—'}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {filterButtons.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  active
                    ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-gray-900 dark:border-white'
                    : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {loading && data.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-64 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div
            className={`grid gap-4 ${
              filter === 'todos'
                ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
                : 'grid-cols-1 max-w-lg mx-auto'
            }`}
          >
            {visible.map((stats) => (
              <ProjectColumn key={stats.slug} stats={stats} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
