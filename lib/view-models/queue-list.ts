import type { QueueRecord } from '../types/crm.js';

export interface QueueListViewModel {
  total: number;
  highPriorityCount: number;
  grouped: Record<string, QueueRecord[]>;
}

export function buildQueueListViewModel(queueItems: QueueRecord[]): QueueListViewModel {
  const grouped: Record<string, QueueRecord[]> = {};
  for (const item of queueItems) {
    grouped[item.queueType] ||= [];
    grouped[item.queueType].push(item);
  }

  return {
    total: queueItems.length,
    highPriorityCount: queueItems.filter((item) => item.priorityLevel <= 1).length,
    grouped,
  };
}
