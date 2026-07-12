export type TaskStatus =
  | 'done'
  | 'running'
  | 'blocked'
  | 'failed'
  | 'ready'
  | 'backlog'
  | 'archived';

interface BadgeConfig {
  dot:   string;
  bg:    string;
  text:  string;
  label: string;
}

export const STATUS_BADGE: Record<TaskStatus, BadgeConfig> = {
  done: {
    dot:   'bg-green-500',
    bg:    'bg-green-50 dark:bg-green-950',
    text:  'text-green-700 dark:text-green-300',
    label: 'Done',
  },
  running: {
    dot:   'bg-yellow-400',
    bg:    'bg-yellow-50 dark:bg-yellow-950',
    text:  'text-yellow-700 dark:text-yellow-300',
    label: 'Running',
  },
  blocked: {
    dot:   'bg-red-500',
    bg:    'bg-red-50 dark:bg-red-950',
    text:  'text-red-700 dark:text-red-300',
    label: 'Blocked',
  },
  failed: {
    dot:   'bg-red-700',
    bg:    'bg-red-100 dark:bg-red-900',
    text:  'text-red-800 dark:text-red-200',
    label: 'Failed',
  },
  ready: {
    dot:   'bg-blue-400',
    bg:    'bg-blue-50 dark:bg-blue-950',
    text:  'text-blue-700 dark:text-blue-300',
    label: 'Ready',
  },
  backlog: {
    dot:   'bg-gray-300',
    bg:    'bg-gray-50 dark:bg-gray-900',
    text:  'text-gray-500 dark:text-gray-400',
    label: 'Backlog',
  },
  archived: {
    dot:   'bg-gray-200',
    bg:    'bg-gray-50 dark:bg-gray-900',
    text:  'text-gray-400 dark:text-gray-600',
    label: 'Archived',
  },
};
