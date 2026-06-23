'use client';

import { useState, useEffect } from 'react';
import type { ProjectStats, Task } from '@/lib/kanban-types';
import { STATUS_BADGE, type TaskStatus } from '@/lib/status-badges';
import { PROJECTS } from '@/lib/kanban-types';

type Filter = 'todos' | string;

function StatusDot({ status }: { status: TaskStatus }) {
  const cfg = STATUS_BADGE[status];
  if (!cfg) return null;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${cfg.dotColor} mr-1.5`}
    />
  );
}

function TaskRow({ task }: { task: Task }) {
  const status = (task.status || 'backlog') as TaskStatus;
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
      <StatusDot status={status} />
      <span className="flex-1 text-sm truncate">{task.title}</span>
      {task.created_by && (
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          {task.created_by}
        </span>
      )}
      {task.assignee && (
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          👤 {task.assignee}
        </span>
      )}
    </div>
  );
}

function ProjectColumn({
  stats,
  filter,
}: {
  stats: ProjectStats;
  filter: Filter;
}) {
  if (filter !== 'todos' && stats.slug !== filter) return null;

  const statusCounts: { status: TaskStatus; count: number }[] = [
    { status: 'backlog', count: stats.backlog },
    { status: 'ready', count: stats.ready },
    { status: 'running', count: stats.running },
    { status: 'done', count: stats.done },
    { status: 'blocked', count: stats.blocked },
    { status: 'failed', count: stats.failed },
    { status: 'archived', count: stats.archived },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-lg font-semibold mb-1 dark:text-white">{stats.name}</h2>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {statusCounts.map(({ status, count }) => (
          <span
            key={status}
            className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[status].bgColor} ${STATUS_BADGE[status].textColor}`}
          >
            <StatusDot status={status} />
            {count}
          </span>
        ))}
      </div>

      {stats.blockedFailed.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase text-red-600 dark:text-red-400 mb-1">
            🚫 Blocked / Failed ({stats.blockedFailed.length})
          </h3>
          {stats.blockedFailed.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {stats.runningTasks.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase text-yellow-600 dark:text-yellow-400 mb-1">
            🔄 Running ({stats.runningTasks.length})
          </h3>
          {stats.runningTasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {stats.doneToday.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs font-semibold uppercase text-green-600 dark:text-green-400 mb-1">
            ✅ Done today ({stats.doneToday.length})
          </h3>
          {stats.doneToday.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      {stats.nextUp.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">
            📋 Next up
          </h3>
          {stats.nextUp.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<ProjectStats[]>([]);
  const [filter, setFilter] = useState<Filter>('todos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      try {
        const res = await fetch('/api/dashboard');
        if (res.ok) {
          const data: ProjectStats[] = await res.json();
          if (mounted) setStats(data);
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

  const filterButtons: { key: Filter; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    ...Object.entries(PROJECTS).map(([key, label]) => ({ key, label })),
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 flex items-center justify-center">
        <div className="animate-pulse text-gray-400 dark:text-gray-500">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 sm:p-6">
      <div className="flex flex-wrap gap-2 mb-6">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              filter === key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((project) => (
          <ProjectColumn key={project.slug} stats={project} filter={filter} />
        ))}
      </div>
    </div>
  );
}
