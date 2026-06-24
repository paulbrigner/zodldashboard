"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  ExecutionTrackerCreatePayload,
  ExecutionTrackerItem,
  ExecutionTrackerState,
  ExecutionTrackerUpdatePayload,
} from "@/lib/execution-tracker-types";

type ExecutionTrackerPanelProps = {
  dashboardId: string;
  dashboardName: string;
};

type ItemDraft = {
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  labels: string;
};

const emptyDraft: ItemDraft = {
  title: "",
  description: "",
  assignee: "",
  dueDate: "",
  labels: "",
};

function labelsFromText(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function labelsToText(labels: string[]): string {
  return labels.join(", ");
}

function itemDraft(item: ExecutionTrackerItem): ItemDraft {
  return {
    title: item.title,
    description: item.description || "",
    assignee: item.assignee || "",
    dueDate: item.dueDate || "",
    labels: labelsToText(item.labels),
  };
}

function sortedItems(items: ExecutionTrackerItem[]): ExecutionTrackerItem[] {
  return [...items].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `Request failed with ${response.status}`);
  }
  return body as T;
}

export function ExecutionTrackerPanel({ dashboardId, dashboardName }: ExecutionTrackerPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ExecutionTrackerState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<ItemDraft>(emptyDraft);
  const [newStatusKey, setNewStatusKey] = useState("not-started");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ItemDraft>(emptyDraft);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function loadTracker() {
    setLoading(true);
    setError(null);
    try {
      const nextState = await readJsonResponse<ExecutionTrackerState>(
        await fetch(`/api/v1/execution-tracker?dashboard_id=${encodeURIComponent(dashboardId)}`, {
          cache: "no-store",
        })
      );
      setState(nextState);
      setNewStatusKey(nextState.statuses[0]?.key || "not-started");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load execution tracker");
    } finally {
      setLoadedOnce(true);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !state && !loading && !loadedOnce) {
      void loadTracker();
    }
  }, [open, state, loading, loadedOnce]);

  const itemsByStatus = useMemo(() => {
    const grouped = new Map<string, ExecutionTrackerItem[]>();
    for (const status of state?.statuses || []) {
      grouped.set(status.key, []);
    }
    for (const item of state?.items || []) {
      if (!grouped.has(item.statusKey)) grouped.set(item.statusKey, []);
      grouped.get(item.statusKey)!.push(item);
    }
    for (const [key, items] of grouped) {
      grouped.set(key, sortedItems(items));
    }
    return grouped;
  }, [state]);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !state.canEdit || !newDraft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload: ExecutionTrackerCreatePayload = {
        dashboardId,
        boardKey: state.boardKey,
        title: newDraft.title,
        description: newDraft.description || null,
        statusKey: newStatusKey,
        assignee: newDraft.assignee || null,
        dueDate: newDraft.dueDate || null,
        labels: labelsFromText(newDraft.labels),
      };
      await readJsonResponse<{ item: ExecutionTrackerItem }>(
        await fetch("/api/v1/execution-tracker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      setNewDraft(emptyDraft);
      await loadTracker();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  }

  async function patchItem(item: ExecutionTrackerItem, payload: ExecutionTrackerUpdatePayload) {
    if (!state || !state.canEdit) return;
    setSaving(true);
    setError(null);
    try {
      await readJsonResponse<{ item: ExecutionTrackerItem }>(
        await fetch(`/api/v1/execution-tracker/items/${encodeURIComponent(item.itemId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dashboardId,
            boardKey: state.boardKey,
            expectedVersion: item.version,
            ...payload,
          }),
        })
      );
      await loadTracker();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Failed to update item");
      await loadTracker();
    } finally {
      setSaving(false);
    }
  }

  async function archiveItem(item: ExecutionTrackerItem) {
    if (!state || !state.canEdit) return;
    setSaving(true);
    setError(null);
    try {
      await readJsonResponse<{ item: ExecutionTrackerItem }>(
        await fetch(`/api/v1/execution-tracker/items/${encodeURIComponent(item.itemId)}`, {
          method: "DELETE",
        })
      );
      await loadTracker();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Failed to archive item");
    } finally {
      setSaving(false);
    }
  }

  function neighborsFor(statusKey: string, insertIndex: number, movingItemId: string) {
    const items = (itemsByStatus.get(statusKey) || []).filter((item) => item.itemId !== movingItemId);
    return {
      beforeItemId: items[insertIndex - 1]?.itemId || null,
      afterItemId: items[insertIndex]?.itemId || null,
    };
  }

  async function moveItem(item: ExecutionTrackerItem, statusKey: string, insertIndex?: number) {
    const items = (itemsByStatus.get(statusKey) || []).filter((entry) => entry.itemId !== item.itemId);
    const targetIndex = insertIndex === undefined ? items.length : Math.max(0, Math.min(insertIndex, items.length));
    await patchItem(item, {
      statusKey,
      ...neighborsFor(statusKey, targetIndex, item.itemId),
    });
  }

  async function moveByOffset(item: ExecutionTrackerItem, offset: -1 | 1) {
    const items = (itemsByStatus.get(item.statusKey) || []).filter((entry) => entry.itemId !== item.itemId);
    const currentIndex = (itemsByStatus.get(item.statusKey) || []).findIndex((entry) => entry.itemId === item.itemId);
    const targetIndex = Math.max(0, Math.min(currentIndex + offset, items.length));
    await patchItem(item, {
      statusKey: item.statusKey,
      ...neighborsFor(item.statusKey, targetIndex, item.itemId),
    });
  }

  function startEdit(item: ExecutionTrackerItem) {
    setEditingId(item.itemId);
    setEditDraft(itemDraft(item));
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>, item: ExecutionTrackerItem) {
    event.preventDefault();
    await patchItem(item, {
      title: editDraft.title,
      description: editDraft.description || null,
      assignee: editDraft.assignee || null,
      dueDate: editDraft.dueDate || null,
      labels: labelsFromText(editDraft.labels),
    });
    setEditingId(null);
  }

  function draggedItem(): ExecutionTrackerItem | null {
    if (!draggingId || !state) return null;
    return state.items.find((item) => item.itemId === draggingId) || null;
  }

  const activeCount = state?.items.length || 0;

  return (
    <>
      <button
        className="execution-tracker-launcher"
        onClick={() => setOpen(true)}
        type="button"
      >
        <span aria-hidden="true">+</span>
        <span>Tracker</span>
        {state ? <strong>{activeCount}</strong> : null}
      </button>

      {open ? (
        <aside className="execution-tracker-panel" aria-label={`${dashboardName} execution tracker`}>
          <div className="execution-tracker-backdrop" onClick={() => setOpen(false)} />
          <div className="execution-tracker-drawer">
            <header className="execution-tracker-header">
              <div>
                <p>Execution Tracker</p>
                <h2>{dashboardName}</h2>
              </div>
              <div className="execution-tracker-header-actions">
                <button className="button button-secondary" disabled={loading} onClick={() => void loadTracker()} type="button">
                  Refresh
                </button>
                <button className="button button-secondary" onClick={() => setOpen(false)} type="button">
                  Close
                </button>
              </div>
            </header>

            {error ? <p className="execution-tracker-error">{error}</p> : null}
            {loading && !state ? <p className="execution-tracker-loading">Loading</p> : null}

            {state ? (
              <>
                {state.canEdit ? (
                  <form className="execution-tracker-create" onSubmit={createItem}>
                    <input
                      aria-label="New item title"
                      onChange={(event) => setNewDraft((draft) => ({ ...draft, title: event.target.value }))}
                      placeholder="New item"
                      value={newDraft.title}
                    />
                    <select
                      aria-label="New item status"
                      onChange={(event) => setNewStatusKey(event.target.value)}
                      value={newStatusKey}
                    >
                      {state.statuses.map((status) => (
                        <option key={status.key} value={status.key}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="New item assignee"
                      onChange={(event) => setNewDraft((draft) => ({ ...draft, assignee: event.target.value }))}
                      placeholder="Assignee"
                      value={newDraft.assignee}
                    />
                    <input
                      aria-label="New item due date"
                      onChange={(event) => setNewDraft((draft) => ({ ...draft, dueDate: event.target.value }))}
                      type="date"
                      value={newDraft.dueDate}
                    />
                    <button className="button" disabled={saving || !newDraft.title.trim()} type="submit">
                      Add
                    </button>
                  </form>
                ) : null}

                <div className="execution-tracker-board">
                  {state.statuses.map((status) => {
                    const items = itemsByStatus.get(status.key) || [];
                    return (
                      <section
                        className="execution-tracker-column"
                        key={status.key}
                        onDragOver={(event) => {
                          if (state.canEdit && draggingId) event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const item = draggedItem();
                          setDraggingId(null);
                          if (item && state.canEdit) void moveItem(item, status.key);
                        }}
                      >
                        <h3>
                          <span>{status.label}</span>
                          <strong>{items.length}</strong>
                        </h3>
                        {items.length === 0 ? <p className="execution-tracker-empty">No items</p> : null}
                        {items.map((item, index) => (
                          <article
                            className="execution-tracker-card"
                            draggable={state.canEdit}
                            key={item.itemId}
                            onDragEnd={() => setDraggingId(null)}
                            onDragStart={() => setDraggingId(item.itemId)}
                            onDragOver={(event) => {
                              if (state.canEdit && draggingId && draggingId !== item.itemId) event.preventDefault();
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const dragged = draggedItem();
                              setDraggingId(null);
                              if (dragged && dragged.itemId !== item.itemId && state.canEdit) {
                                void moveItem(dragged, item.statusKey, index);
                              }
                            }}
                          >
                            {editingId === item.itemId ? (
                              <form className="execution-tracker-edit" onSubmit={(event) => void saveEdit(event, item)}>
                                <input
                                  aria-label="Item title"
                                  onChange={(event) => setEditDraft((draft) => ({ ...draft, title: event.target.value }))}
                                  value={editDraft.title}
                                />
                                <textarea
                                  aria-label="Item notes"
                                  onChange={(event) => setEditDraft((draft) => ({ ...draft, description: event.target.value }))}
                                  value={editDraft.description}
                                />
                                <div className="execution-tracker-card-grid">
                                  <input
                                    aria-label="Item assignee"
                                    onChange={(event) => setEditDraft((draft) => ({ ...draft, assignee: event.target.value }))}
                                    placeholder="Assignee"
                                    value={editDraft.assignee}
                                  />
                                  <input
                                    aria-label="Item due date"
                                    onChange={(event) => setEditDraft((draft) => ({ ...draft, dueDate: event.target.value }))}
                                    type="date"
                                    value={editDraft.dueDate}
                                  />
                                </div>
                                <input
                                  aria-label="Item labels"
                                  onChange={(event) => setEditDraft((draft) => ({ ...draft, labels: event.target.value }))}
                                  placeholder="Labels"
                                  value={editDraft.labels}
                                />
                                <div className="execution-tracker-card-actions">
                                  <button className="button" disabled={saving || !editDraft.title.trim()} type="submit">
                                    Save
                                  </button>
                                  <button className="button button-secondary" onClick={() => setEditingId(null)} type="button">
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <div className="execution-tracker-card-top">
                                  <strong>{item.title}</strong>
                                  {state.canEdit ? (
                                    <span className="execution-tracker-drag" aria-hidden="true">
                                      ::
                                    </span>
                                  ) : null}
                                </div>
                                {item.description ? <p>{item.description}</p> : null}
                                <dl className="execution-tracker-meta">
                                  {item.assignee ? (
                                    <>
                                      <dt>Owner</dt>
                                      <dd>{item.assignee}</dd>
                                    </>
                                  ) : null}
                                  {item.dueDate ? (
                                    <>
                                      <dt>Due</dt>
                                      <dd>{item.dueDate}</dd>
                                    </>
                                  ) : null}
                                </dl>
                                {item.labels.length ? (
                                  <div className="execution-tracker-labels">
                                    {item.labels.map((label) => (
                                      <span key={label}>{label}</span>
                                    ))}
                                  </div>
                                ) : null}
                                {state.canEdit ? (
                                  <div className="execution-tracker-card-actions">
                                    <button
                                      aria-label={`Move ${item.title} up`}
                                      className="button button-secondary"
                                      disabled={saving || index === 0}
                                      onClick={() => void moveByOffset(item, -1)}
                                      type="button"
                                    >
                                      Up
                                    </button>
                                    <button
                                      aria-label={`Move ${item.title} down`}
                                      className="button button-secondary"
                                      disabled={saving || index === items.length - 1}
                                      onClick={() => void moveByOffset(item, 1)}
                                      type="button"
                                    >
                                      Down
                                    </button>
                                    <select
                                      aria-label={`Status for ${item.title}`}
                                      disabled={saving}
                                      onChange={(event) => void moveItem(item, event.target.value)}
                                      value={item.statusKey}
                                    >
                                      {state.statuses.map((option) => (
                                        <option key={option.key} value={option.key}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                    <button className="button button-secondary" onClick={() => startEdit(item)} type="button">
                                      Edit
                                    </button>
                                    <button className="button button-secondary" onClick={() => void archiveItem(item)} type="button">
                                      Archive
                                    </button>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </article>
                        ))}
                      </section>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
    </>
  );
}
