export type ExecutionTrackerStatus = {
  key: string;
  label: string;
  terminal?: boolean;
};

export type ExecutionTrackerLink = {
  label: string;
  url: string;
};

export type ExecutionTrackerItem = {
  itemId: string;
  dashboardId: string;
  boardKey: string;
  title: string;
  description: string | null;
  statusKey: string;
  position: number;
  assignee: string | null;
  dueDate: string | null;
  labels: string[];
  links: ExecutionTrackerLink[];
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
};

export type ExecutionTrackerState = {
  dashboardId: string;
  dashboardName: string;
  boardKey: string;
  title: string;
  statuses: ExecutionTrackerStatus[];
  items: ExecutionTrackerItem[];
  canEdit: boolean;
  available: boolean;
};

export type ExecutionTrackerCreatePayload = {
  dashboardId: string;
  boardKey?: string;
  title: string;
  description?: string | null;
  statusKey?: string;
  assignee?: string | null;
  dueDate?: string | null;
  labels?: string[];
  links?: ExecutionTrackerLink[];
  beforeItemId?: string | null;
  afterItemId?: string | null;
};

export type ExecutionTrackerUpdatePayload = {
  dashboardId?: string;
  boardKey?: string;
  title?: string;
  description?: string | null;
  statusKey?: string;
  assignee?: string | null;
  dueDate?: string | null;
  labels?: string[];
  links?: ExecutionTrackerLink[];
  beforeItemId?: string | null;
  afterItemId?: string | null;
  expectedVersion?: number;
};
