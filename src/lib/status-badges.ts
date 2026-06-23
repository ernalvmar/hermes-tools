export type TaskStatus = 'backlog' | 'ready' | 'running' | 'done' | 'blocked' | 'failed' | 'archived';

export interface StatusBadgeConfig {
  label: string;
  dotColor: string;
  bgColor: string;
  textColor: string;
}

export const STATUS_BADGE: Record<TaskStatus, StatusBadgeConfig> = {
  backlog: {
    label: 'Backlog',
    dotColor: 'bg-gray-400',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
  },
  ready: {
    label: 'Ready',
    dotColor: 'bg-blue-400',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
  },
  running: {
    label: 'Running',
    dotColor: 'bg-yellow-400',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-700',
  },
  done: {
    label: 'Done',
    dotColor: 'bg-green-400',
    bgColor: 'bg-green-100',
    textColor: 'text-green-700',
  },
  blocked: {
    label: 'Blocked',
    dotColor: 'bg-red-400',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
  },
  failed: {
    label: 'Failed',
    dotColor: 'bg-red-600',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
  },
  archived: {
    label: 'Archived',
    dotColor: 'bg-gray-400',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-500',
  },
};
