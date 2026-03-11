"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  SCHEDULE_DAY_CODES,
  type ComposeAnswerStyle,
  type ComposeDraftFormat,
  type ComposeJobCreatedResponse,
  type ComposeJobStatus,
  type ComposeJobStatusResponse,
  type ComposeQueryResponse,
  type ScheduleDayCode,
  type ScheduledEmailJob,
  type ScheduledEmailJobListResponse,
  type ScheduleVisibility,
} from "@/lib/xmonitor/types";

type ViewerAccessLevel = "workspace" | "guest" | "local-bypass";
type ScheduleEditorMode = "daily" | "weekdays" | "selected_days" | "interval";
type ScheduleIntervalUnit = "minutes" | "hours" | "days" | "weeks";
type LookbackUnit = "hours" | "days" | "weeks";

type ComposePanelProps = {
  enabled: boolean;
  unavailableReason?: string | null;
  initialSince?: string;
  initialUntil?: string;
  initialTiers?: string[];
  initialHandle?: string;
  initialSignificant?: boolean;
  initialRetrievalLimit?: number;
  initialContextLimit?: number;
  emailEnabled?: boolean;
  emailSchedulesEnabled?: boolean;
  viewerEmail?: string | null;
  viewerAccessLevel?: ViewerAccessLevel;
};

const DEFAULT_RETRIEVAL_LIMIT = 50;
const DEFAULT_CONTEXT_LIMIT = 14;
const DEFAULT_POLL_MS = 2500;
const MIN_POLL_MS = 1000;
const MAX_POLL_MS = 10000;
const DEFAULT_SCHEDULE_NAME = "Scheduled X Monitor email";
const DEFAULT_SCHEDULE_TIME = "09:00";
const ALL_WEEK_DAYS = [...SCHEDULE_DAY_CODES] as ScheduleDayCode[];
const WEEKDAY_CODES: ScheduleDayCode[] = ["mon", "tue", "wed", "thu", "fri"];
const DAY_LABELS: Record<ScheduleDayCode, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};
const INTERVAL_UNIT_MINUTES: Record<ScheduleIntervalUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};
const LOOKBACK_UNIT_HOURS: Record<LookbackUnit, number> = {
  hours: 1,
  days: 24,
  weeks: 168,
};

function asPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function arraysEqual<T>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function isScheduleDayCode(value: string): value is ScheduleDayCode {
  return (SCHEDULE_DAY_CODES as readonly string[]).includes(value);
}

function browserTimeZone(): string {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function normalizeScheduleDays(value: unknown): ScheduleDayCode[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<ScheduleDayCode>();
  for (const item of value) {
    if (typeof item === "string") {
      const normalized = item.trim().toLowerCase();
      if (isScheduleDayCode(normalized)) {
        unique.add(normalized);
      }
    }
  }
  return SCHEDULE_DAY_CODES.filter((code) => unique.has(code));
}

function summarizeScope(props: ComposePanelProps): string {
  const parts: string[] = [];
  if (props.initialSince) parts.push(`since ${new Date(props.initialSince).toLocaleString()}`);
  if (props.initialUntil) parts.push(`until ${new Date(props.initialUntil).toLocaleString()}`);
  if (props.initialTiers && props.initialTiers.length > 0) parts.push(`tiers ${props.initialTiers.join(", ")}`);
  if (props.initialHandle) parts.push(`handle ${props.initialHandle}`);
  if (props.initialSignificant !== undefined) parts.push(`significant=${String(props.initialSignificant)}`);
  if (parts.length === 0) return "Scope: all posts in current corpus.";
  return `Scope: ${parts.join(" | ")}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // fall through
  }
  return `Request failed (${response.status})`;
}

function isComposeQueryResponse(value: unknown): value is ComposeQueryResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.answer_text !== "string") return false;
  if (!Array.isArray(record.key_points) || !Array.isArray(record.citations)) return false;
  const stats = record.retrieval_stats;
  if (!stats || typeof stats !== "object") return false;
  const statsRecord = stats as Record<string, unknown>;
  return (
    Number.isFinite(Number(statsRecord.retrieved_count)) &&
    Number.isFinite(Number(statsRecord.used_count)) &&
    typeof statsRecord.model === "string" &&
    Number.isFinite(Number(statsRecord.latency_ms))
  );
}

function isScheduledEmailJob(value: unknown): value is ScheduledEmailJob {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.job_id === "string" &&
    typeof record.owner_email === "string" &&
    typeof record.name === "string" &&
    typeof record.enabled === "boolean" &&
    (record.visibility === "personal" || record.visibility === "shared") &&
    Array.isArray(record.recipients) &&
    (record.schedule_kind === "interval" || record.schedule_kind === "weekly") &&
    Array.isArray(record.schedule_days) &&
    (record.schedule_time_local === null || typeof record.schedule_time_local === "string") &&
    typeof record.schedule_interval_minutes === "number" &&
    typeof record.lookback_hours === "number" &&
    typeof record.timezone === "string" &&
    typeof record.next_run_at === "string"
  );
}

function isScheduledEmailJobListResponse(value: unknown): value is ScheduledEmailJobListResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return false;
  return record.items.every((item) => isScheduledEmailJob(item));
}

function isComposeJobStatus(value: unknown): value is ComposeJobStatus {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "expired";
}

function isComposeJobCreatedResponse(value: unknown): value is ComposeJobCreatedResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.job_id === "string" &&
    isComposeJobStatus(record.status) &&
    typeof record.created_at === "string" &&
    typeof record.expires_at === "string"
  );
}

function isComposeJobStatusResponse(value: unknown): value is ComposeJobStatusResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.job_id !== "string" ||
    !isComposeJobStatus(record.status) ||
    typeof record.created_at !== "string" ||
    typeof record.expires_at !== "string"
  ) {
    return false;
  }

  if (record.result !== undefined && record.result !== null && !isComposeQueryResponse(record.result)) {
    return false;
  }

  return true;
}

function clampPollMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.floor(parsed)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function normalizeRecipientsText(value: string): string[] {
  return value
    .split(/[,\n;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function inferLookbackInputs(hours: number): { value: string; unit: LookbackUnit } {
  if (hours % LOOKBACK_UNIT_HOURS.weeks === 0) {
    return { value: String(hours / LOOKBACK_UNIT_HOURS.weeks), unit: "weeks" };
  }
  if (hours % LOOKBACK_UNIT_HOURS.days === 0) {
    return { value: String(hours / LOOKBACK_UNIT_HOURS.days), unit: "days" };
  }
  return { value: String(hours), unit: "hours" };
}

function inferIntervalInputs(minutes: number): { value: string; unit: ScheduleIntervalUnit } {
  if (minutes % INTERVAL_UNIT_MINUTES.weeks === 0) {
    return { value: String(minutes / INTERVAL_UNIT_MINUTES.weeks), unit: "weeks" };
  }
  if (minutes % INTERVAL_UNIT_MINUTES.days === 0) {
    return { value: String(minutes / INTERVAL_UNIT_MINUTES.days), unit: "days" };
  }
  if (minutes % INTERVAL_UNIT_MINUTES.hours === 0) {
    return { value: String(minutes / INTERVAL_UNIT_MINUTES.hours), unit: "hours" };
  }
  return { value: String(minutes), unit: "minutes" };
}

function lookbackHoursFromInputs(value: string, unit: LookbackUnit): number | undefined {
  const quantity = asPositiveInt(value);
  if (!quantity) return undefined;
  return quantity * LOOKBACK_UNIT_HOURS[unit];
}

function intervalMinutesFromInputs(value: string, unit: ScheduleIntervalUnit): number | undefined {
  const quantity = asPositiveInt(value);
  if (!quantity) return undefined;
  return quantity * INTERVAL_UNIT_MINUTES[unit];
}

function titleCaseUnit(unit: string, count: number): string {
  return count === 1 ? unit.slice(0, -1) : unit;
}

function formatTimeLocal(value: string | null | undefined): string {
  if (!value) return "unspecified time";
  const [hoursText, minutesText] = value.split(":");
  const hours = Number.parseInt(hoursText || "", 10);
  const minutes = Number.parseInt(minutesText || "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hours, minutes, 0, 0));
}

function formatLookback(hours: number): string {
  const inferred = inferLookbackInputs(hours);
  const count = Number.parseInt(inferred.value, 10) || 0;
  return `${inferred.value} ${titleCaseUnit(inferred.unit, count)}`;
}

function formatInterval(minutes: number): string {
  const inferred = inferIntervalInputs(minutes);
  const count = Number.parseInt(inferred.value, 10) || 0;
  return `${inferred.value} ${titleCaseUnit(inferred.unit, count)}`;
}

function inferEditorMode(job: ScheduledEmailJob): ScheduleEditorMode {
  if (job.schedule_kind === "interval") return "interval";
  const days = normalizeScheduleDays(job.schedule_days);
  if (arraysEqual(days, ALL_WEEK_DAYS)) return "daily";
  if (arraysEqual(days, WEEKDAY_CODES)) return "weekdays";
  return "selected_days";
}

function formatScheduleSummary(job: ScheduledEmailJob): string {
  if (job.schedule_kind === "interval") {
    return `Every ${formatInterval(job.schedule_interval_minutes)}`;
  }
  const timeText = formatTimeLocal(job.schedule_time_local);
  const days = normalizeScheduleDays(job.schedule_days);
  if (arraysEqual(days, ALL_WEEK_DAYS)) {
    return `Daily at ${timeText}`;
  }
  if (arraysEqual(days, WEEKDAY_CODES)) {
    return `Weekdays at ${timeText}`;
  }
  const labels = days.map((day) => DAY_LABELS[day]).join(", ");
  return `${labels || "Selected days"} at ${timeText}`;
}

function canManageScheduledJob(job: ScheduledEmailJob, viewerEmail?: string | null): boolean {
  return Boolean(viewerEmail) && job.owner_email.toLowerCase() === String(viewerEmail).toLowerCase();
}

function FieldHelp({ label, text }: { label: string; text: string }) {
  return (
    <details className="field-help">
      <summary aria-label={`${label} help`} className="field-help-trigger" title={`${label} help`}>
        i
      </summary>
      <div className="field-help-popover">
        <p>{text}</p>
      </div>
    </details>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="compose-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function ComposePanel(props: ComposePanelProps) {
  const initialRetrievalLimit =
    typeof props.initialRetrievalLimit === "number" && props.initialRetrievalLimit > 0
      ? Math.floor(props.initialRetrievalLimit)
      : DEFAULT_RETRIEVAL_LIMIT;
  const initialContextLimitRaw =
    typeof props.initialContextLimit === "number" && props.initialContextLimit > 0
      ? Math.floor(props.initialContextLimit)
      : DEFAULT_CONTEXT_LIMIT;
  const initialContextLimit = Math.min(initialContextLimitRaw, initialRetrievalLimit);
  const shareEnabled = props.viewerAccessLevel === "workspace";

  const [taskText, setTaskText] = useState("");
  const [answerStyle, setAnswerStyle] = useState<ComposeAnswerStyle>("balanced");
  const [draftFormat, setDraftFormat] = useState<ComposeDraftFormat>("none");
  const [retrievalLimit, setRetrievalLimit] = useState(() => String(initialRetrievalLimit));
  const [contextLimit, setContextLimit] = useState(() => String(initialContextLimit));
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeQueryResponse | null>(null);
  const [copyState, setCopyState] = useState<"answer" | "draft" | null>(null);
  const [activeJob, setActiveJob] = useState<{ jobId: string; status: ComposeJobStatus } | null>(null);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyMarkdown, setEmailBodyMarkdown] = useState("");
  const [emailStatusText, setEmailStatusText] = useState<string | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledEmailJob[]>([]);
  const [scheduleStatusText, setScheduleStatusText] = useState<string | null>(null);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState(DEFAULT_SCHEDULE_NAME);
  const [scheduleVisibility, setScheduleVisibility] = useState<ScheduleVisibility>("personal");
  const [scheduleMode, setScheduleMode] = useState<ScheduleEditorMode>("daily");
  const [scheduleSelectedDays, setScheduleSelectedDays] = useState<ScheduleDayCode[]>([...WEEKDAY_CODES]);
  const [scheduleTimeLocal, setScheduleTimeLocal] = useState(DEFAULT_SCHEDULE_TIME);
  const [scheduleIntervalValue, setScheduleIntervalValue] = useState("1");
  const [scheduleIntervalUnit, setScheduleIntervalUnit] = useState<ScheduleIntervalUnit>("days");
  const [scheduleLookbackValue, setScheduleLookbackValue] = useState("1");
  const [scheduleLookbackUnit, setScheduleLookbackUnit] = useState<LookbackUnit>("days");
  const [scheduleTimeZone, setScheduleTimeZone] = useState("UTC");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const runTokenRef = useRef(0);

  const scopeSummary = useMemo(() => summarizeScope(props), [props]);
  const personalSchedules = useMemo(
    () => schedules.filter((job) => job.visibility !== "shared"),
    [schedules]
  );
  const sharedSchedules = useMemo(
    () => schedules.filter((job) => job.visibility === "shared"),
    [schedules]
  );

  useEffect(() => {
    setScheduleTimeZone(browserTimeZone());
  }, []);

  useEffect(() => {
    if (shareEnabled) return;
    setScheduleVisibility("personal");
  }, [shareEnabled]);

  useEffect(() => {
    if (!result?.email_draft) return;
    setEmailSubject(result.email_draft.subject || "");
    setEmailBodyMarkdown(result.email_draft.body_markdown || "");
    if (!scheduleName.trim()) {
      const trimmedTask = taskText.trim();
      setScheduleName(trimmedTask ? `Scheduled: ${trimmedTask.slice(0, 80)}` : DEFAULT_SCHEDULE_NAME);
    }
  }, [result?.email_draft, taskText, scheduleName]);

  useEffect(() => {
    if (!props.emailSchedulesEnabled) return;
    let isMounted = true;

    const load = async () => {
      setIsLoadingSchedules(true);
      setScheduleStatusText(null);
      try {
        const response = await fetch("/api/v1/email/schedules", {
          method: "GET",
          headers: {
            accept: "application/json",
          },
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(await parseError(response));
        }
        const body = await response.json();
        if (!isScheduledEmailJobListResponse(body)) {
          throw new Error("Invalid scheduled email list response payload");
        }
        if (!isMounted) return;
        setSchedules(body.items);
      } catch (error) {
        if (!isMounted) return;
        setScheduleStatusText(error instanceof Error ? error.message : "Failed to load schedules.");
      } finally {
        if (isMounted) {
          setIsLoadingSchedules(false);
        }
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [props.emailSchedulesEnabled]);

  async function handleCopy(kind: "answer" | "draft", text: string) {
    const ok = await copyToClipboard(text);
    if (!ok) {
      setErrorText("Copy failed in this browser context.");
      return;
    }
    setCopyState(kind);
    setTimeout(() => setCopyState((current) => (current === kind ? null : current)), 1500);
  }

  async function reloadSchedules() {
    if (!props.emailSchedulesEnabled) return;
    setIsLoadingSchedules(true);
    try {
      const response = await fetch("/api/v1/email/schedules", {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      const body = await response.json();
      if (!isScheduledEmailJobListResponse(body)) {
        throw new Error("Invalid scheduled email list response payload");
      }
      setSchedules(body.items);
    } finally {
      setIsLoadingSchedules(false);
    }
  }

  function resetScheduleEditor() {
    setEditingScheduleId(null);
    setScheduleName(taskText.trim() ? `Scheduled: ${taskText.trim().slice(0, 80)}` : DEFAULT_SCHEDULE_NAME);
    setScheduleVisibility("personal");
    setScheduleMode("daily");
    setScheduleSelectedDays([...WEEKDAY_CODES]);
    setScheduleTimeLocal(DEFAULT_SCHEDULE_TIME);
    setScheduleIntervalValue("1");
    setScheduleIntervalUnit("days");
    setScheduleLookbackValue("1");
    setScheduleLookbackUnit("days");
    setScheduleEnabled(true);
    setScheduleStatusText(null);
  }

  function buildSchedulePayload() {
    const task = taskText.trim();
    if (!task) {
      throw new Error("Task text is required to create a schedule.");
    }
    const recipients = normalizeRecipientsText(emailTo);
    if (recipients.length === 0) {
      throw new Error("At least one recipient is required for schedule delivery.");
    }
    if (scheduleVisibility === "shared" && !shareEnabled) {
      throw new Error("Shared schedules require a zodl.com workspace account.");
    }

    const lookbackHours = lookbackHoursFromInputs(scheduleLookbackValue, scheduleLookbackUnit);
    if (!lookbackHours || lookbackHours < 1 || lookbackHours > 336) {
      throw new Error("Lookback must be between 1 hour and 2 weeks.");
    }

    const retrieval = asPositiveInt(retrievalLimit);
    const context = asPositiveInt(contextLimit);
    const composeRequest = {
      task_text: task,
      answer_style: answerStyle,
      draft_format: "email" as const,
      retrieval_limit: retrieval,
      context_limit: context,
      tiers: props.initialTiers,
      handle: props.initialHandle,
      significant: props.initialSignificant,
    };

    const payload: Record<string, unknown> = {
      name: scheduleName.trim() || `Scheduled: ${task.slice(0, 80)}`,
      recipients,
      subject_override: emailSubject.trim() || null,
      visibility: scheduleVisibility,
      lookback_hours: lookbackHours,
      timezone: scheduleTimeZone || "UTC",
      enabled: scheduleEnabled,
      compose_request: composeRequest,
    };

    if (scheduleMode === "interval") {
      const scheduleIntervalMinutes = intervalMinutesFromInputs(scheduleIntervalValue, scheduleIntervalUnit);
      if (!scheduleIntervalMinutes || scheduleIntervalMinutes < 15 || scheduleIntervalMinutes > 10080) {
        throw new Error("Custom interval must be between 15 minutes and 1 week.");
      }
      payload.schedule_kind = "interval";
      payload.schedule_interval_minutes = scheduleIntervalMinutes;
      return payload;
    }

    const scheduleDays =
      scheduleMode === "daily"
        ? ALL_WEEK_DAYS
        : scheduleMode === "weekdays"
          ? WEEKDAY_CODES
          : normalizeScheduleDays(scheduleSelectedDays);
    if (scheduleDays.length === 0) {
      throw new Error("Choose at least one day for the schedule.");
    }
    if (!/^\d{2}:\d{2}$/.test(scheduleTimeLocal)) {
      throw new Error("Choose a valid delivery time.");
    }

    payload.schedule_kind = "weekly";
    payload.schedule_days = scheduleDays;
    payload.schedule_time_local = scheduleTimeLocal;
    return payload;
  }

  async function handleSendEmail() {
    setEmailStatusText(null);
    if (!props.emailEnabled) {
      setEmailStatusText("Email sending is disabled.");
      return;
    }
    if (!result || draftFormat !== "email") {
      setEmailStatusText("Generate an Email draft first.");
      return;
    }
    const recipients = normalizeRecipientsText(emailTo);
    if (recipients.length === 0) {
      setEmailStatusText("At least one recipient is required.");
      return;
    }
    if (!emailSubject.trim() || !emailBodyMarkdown.trim()) {
      setEmailStatusText("Subject and body are required.");
      return;
    }

    setIsSendingEmail(true);
    try {
      const response = await fetch("/api/v1/email/send", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: recipients,
          subject: emailSubject.trim(),
          body_markdown: emailBodyMarkdown,
          compose_job_id: activeJob?.jobId || undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      setEmailStatusText("Email sent.");
    } catch (error) {
      setEmailStatusText(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setIsSendingEmail(false);
    }
  }

  async function handleSaveSchedule() {
    setScheduleStatusText(null);
    if (!props.emailSchedulesEnabled) {
      setScheduleStatusText("Email schedules are disabled.");
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = buildSchedulePayload();
    } catch (error) {
      setScheduleStatusText(error instanceof Error ? error.message : "Failed to prepare schedule.");
      return;
    }

    setIsSavingSchedule(true);
    try {
      const route = editingScheduleId
        ? `/api/v1/email/schedules/${encodeURIComponent(editingScheduleId)}`
        : "/api/v1/email/schedules";
      const method = editingScheduleId ? "PATCH" : "POST";
      const response = await fetch(route, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await reloadSchedules();
      setScheduleStatusText(editingScheduleId ? "Schedule updated." : "Schedule created.");
      if (!editingScheduleId) {
        resetScheduleEditor();
      } else {
        setEditingScheduleId(null);
      }
    } catch (error) {
      setScheduleStatusText(error instanceof Error ? error.message : "Failed to save schedule.");
    } finally {
      setIsSavingSchedule(false);
    }
  }

  function handleEditSchedule(job: ScheduledEmailJob) {
    setEditingScheduleId(job.job_id);
    setScheduleName(job.name);
    setScheduleVisibility(job.visibility);
    setScheduleEnabled(job.enabled);
    setEmailTo(job.recipients.join(", "));
    setEmailSubject(job.subject_override || emailSubject);

    const lookbackInputs = inferLookbackInputs(job.lookback_hours);
    setScheduleLookbackValue(lookbackInputs.value);
    setScheduleLookbackUnit(lookbackInputs.unit);

    if (job.schedule_kind === "interval") {
      const intervalInputs = inferIntervalInputs(job.schedule_interval_minutes);
      setScheduleMode("interval");
      setScheduleIntervalValue(intervalInputs.value);
      setScheduleIntervalUnit(intervalInputs.unit);
    } else {
      const nextMode = inferEditorMode(job);
      setScheduleMode(nextMode);
      setScheduleSelectedDays(normalizeScheduleDays(job.schedule_days));
      setScheduleTimeLocal(job.schedule_time_local || DEFAULT_SCHEDULE_TIME);
    }

    if (job.timezone) {
      setScheduleTimeZone(job.timezone);
    }
    if (job.compose_request?.task_text) {
      setTaskText(job.compose_request.task_text);
    }
    if (job.compose_request?.answer_style) {
      setAnswerStyle(job.compose_request.answer_style);
    }
    if (job.compose_request?.retrieval_limit && Number.isFinite(job.compose_request.retrieval_limit)) {
      setRetrievalLimit(String(job.compose_request.retrieval_limit));
    }
    if (job.compose_request?.context_limit && Number.isFinite(job.compose_request.context_limit)) {
      setContextLimit(String(job.compose_request.context_limit));
    }
    setDraftFormat("email");
    setScheduleStatusText(`Editing schedule ${job.name}`);
  }

  async function handleDeleteSchedule(jobId: string) {
    setScheduleStatusText(null);
    try {
      const response = await fetch(`/api/v1/email/schedules/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await reloadSchedules();
      if (editingScheduleId === jobId) {
        resetScheduleEditor();
      }
      setScheduleStatusText("Schedule deleted.");
    } catch (error) {
      setScheduleStatusText(error instanceof Error ? error.message : "Failed to delete schedule.");
    }
  }

  async function handleToggleSchedule(job: ScheduledEmailJob) {
    setScheduleStatusText(null);
    try {
      const response = await fetch(`/api/v1/email/schedules/${encodeURIComponent(job.job_id)}`, {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      await reloadSchedules();
      setScheduleStatusText(`Schedule ${!job.enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setScheduleStatusText(error instanceof Error ? error.message : "Failed to update schedule.");
    }
  }

  async function handleRunScheduleNow(jobId: string) {
    setScheduleStatusText(null);
    try {
      const response = await fetch(`/api/v1/email/schedules/${encodeURIComponent(jobId)}/run-now`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await parseError(response));
      }
      setScheduleStatusText("Run-now queued.");
      await reloadSchedules();
    } catch (error) {
      setScheduleStatusText(error instanceof Error ? error.message : "Failed to run schedule now.");
    }
  }

  function toggleSelectedDay(day: ScheduleDayCode) {
    setScheduleSelectedDays((current) => {
      const set = new Set(current);
      if (set.has(day)) {
        set.delete(day);
      } else {
        set.add(day);
      }
      return SCHEDULE_DAY_CODES.filter((code) => set.has(code));
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);
    setResult(null);
    setEmailStatusText(null);

    if (!props.enabled) {
      setErrorText(props.unavailableReason || "Compose mode is unavailable.");
      return;
    }

    const task = taskText.trim();
    if (!task) {
      setErrorText("Task text is required.");
      return;
    }

    const retrieval = asPositiveInt(retrievalLimit);
    const context = asPositiveInt(contextLimit);

    const payload = {
      task_text: task,
      answer_style: answerStyle,
      draft_format: draftFormat,
      retrieval_limit: retrieval,
      context_limit: context,
      since: props.initialSince,
      until: props.initialUntil,
      tiers: props.initialTiers,
      handle: props.initialHandle,
      significant: props.initialSignificant,
    };

    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;
    setIsLoading(true);
    setActiveJob(null);
    try {
      const response = await fetch("/api/v1/query/compose/jobs", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const body = await response.json();
      if (!isComposeJobCreatedResponse(body)) {
        throw new Error("Invalid compose job create response payload");
      }
      if (runTokenRef.current !== runToken) return;

      setActiveJob({ jobId: body.job_id, status: body.status });

      let pollDelayMs = clampPollMs(body.poll_after_ms, DEFAULT_POLL_MS);
      while (runTokenRef.current === runToken) {
        await sleep(pollDelayMs);
        if (runTokenRef.current !== runToken) return;

        const pollResponse = await fetch(`/api/v1/query/compose/jobs/${encodeURIComponent(body.job_id)}`, {
          method: "GET",
          headers: {
            accept: "application/json",
          },
          cache: "no-store",
        });
        if (!pollResponse.ok) {
          throw new Error(await parseError(pollResponse));
        }

        const pollBody = await pollResponse.json();
        if (!isComposeJobStatusResponse(pollBody)) {
          throw new Error("Invalid compose job status response payload");
        }

        setActiveJob({ jobId: pollBody.job_id, status: pollBody.status });

        if (pollBody.status === "succeeded") {
          if (!pollBody.result || !isComposeQueryResponse(pollBody.result)) {
            throw new Error("Compose job completed without a valid result payload");
          }
          setResult(pollBody.result);
          break;
        }

        if (pollBody.status === "failed" || pollBody.status === "expired") {
          const message =
            pollBody.error?.message ||
            (pollBody.status === "expired"
              ? "Compose job expired before completing."
              : "Compose job failed.");
          throw new Error(message);
        }

        pollDelayMs = clampPollMs(pollBody.poll_after_ms, pollDelayMs);
      }
    } catch (error) {
      if (runTokenRef.current === runToken) {
        setResult(null);
        setErrorText(error instanceof Error ? error.message : "Compose request failed");
      }
    } finally {
      if (runTokenRef.current === runToken) {
        setIsLoading(false);
      }
    }
  }

  return (
    <details className="compose-panel">
      <summary className="compose-panel-summary">
        <span className="compose-panel-title-wrap">
          <span className="compose-panel-title">Answer Mode</span>
          <span aria-hidden className="disclosure-caret">
            ▾
          </span>
        </span>
        <span className="summary-panel-state">{result ? `${result.citations.length} citations` : "grounded RAG"}</span>
      </summary>

      <div className="compose-panel-body">
        {!props.enabled ? <p className="error-text">{props.unavailableReason || "Compose mode is unavailable."}</p> : null}

        <form className="compose-form" onSubmit={handleSubmit}>
          <label className="compose-task-field">
            <span>Task</span>
            <textarea
              onChange={(event) => setTaskText(event.target.value)}
              placeholder="Describe what you want answered and optionally drafted."
              rows={5}
              value={taskText}
            />
          </label>

          <div className="compose-controls">
            <label>
              <span>Answer style</span>
              <select onChange={(event) => setAnswerStyle(event.target.value as ComposeAnswerStyle)} value={answerStyle}>
                <option value="brief">Brief</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>

            <label>
              <span>Draft format</span>
              <select onChange={(event) => setDraftFormat(event.target.value as ComposeDraftFormat)} value={draftFormat}>
                <option value="none">None</option>
                <option value="x_post">X post</option>
                <option value="thread">Thread</option>
                {props.emailEnabled ? <option value="email">Email</option> : null}
              </select>
            </label>

            <label>
              <div className="compose-label-row">
                <span>Retrieval limit</span>
                <FieldHelp
                  label="Retrieval limit"
                  text="Higher values search more candidate posts, which can improve coverage but increase latency. Keep this moderate for routine use."
                />
              </div>
              <input
                min={1}
                onChange={(event) => setRetrievalLimit(event.target.value)}
                step={1}
                type="number"
                value={retrievalLimit}
              />
            </label>

            <label>
              <div className="compose-label-row">
                <span>Context limit</span>
                <FieldHelp
                  label="Context limit"
                  text="Higher values pass more evidence into synthesis, which may improve detail but can increase model timeouts. Increase only when needed."
                />
              </div>
              <input
                min={1}
                onChange={(event) => setContextLimit(event.target.value)}
                step={1}
                type="number"
                value={contextLimit}
              />
            </label>
          </div>

          <p className="subtle-text compose-scope">{scopeSummary}</p>

          <div className="compose-actions">
            <button className="button" disabled={isLoading || !props.enabled} type="submit">
              {isLoading ? "Generating..." : "Generate answer"}
            </button>
            <button
              className="button button-secondary"
              disabled={isLoading}
              onClick={() => {
                runTokenRef.current += 1;
                setTaskText("");
                setResult(null);
                setErrorText(null);
                setActiveJob(null);
                setIsLoading(false);
                setEmailStatusText(null);
                setEmailSubject("");
                setEmailBodyMarkdown("");
                setEmailTo("");
                resetScheduleEditor();
              }}
              type="button"
            >
              Clear
            </button>
          </div>
        </form>

        {errorText ? <p className="error-text">{errorText}</p> : null}
        {isLoading && activeJob ? (
          <p className="subtle-text">Answer job {activeJob.jobId.slice(0, 8)}... is {activeJob.status}.</p>
        ) : null}

        {props.emailSchedulesEnabled ? (
          <details className="compose-section email-schedules-panel">
            <summary className="email-schedules-summary">
              <span className="compose-panel-title-wrap">
                <span className="compose-panel-title">Email schedules</span>
                <span aria-hidden className="disclosure-caret">
                  ▾
                </span>
              </span>
              <span className="summary-panel-state">
                {isLoadingSchedules ? "Loading..." : `${personalSchedules.length + sharedSchedules.length} saved`}
              </span>
            </summary>

            <div className="email-schedules-body">
              <label className="compose-task-field">
                <span>Recipients</span>
                <textarea
                  onChange={(event) => setEmailTo(event.target.value)}
                  placeholder="recipient1@example.com, recipient2@example.com"
                  rows={2}
                  value={emailTo}
                />
              </label>

              <label className="compose-task-field">
                <span>Subject override (optional)</span>
                <input
                  onChange={(event) => setEmailSubject(event.target.value)}
                  placeholder="Optional subject override for scheduled runs"
                  type="text"
                  value={emailSubject}
                />
              </label>

              <div className="compose-controls">
                <label>
                  <span>Schedule name</span>
                  <input onChange={(event) => setScheduleName(event.target.value)} type="text" value={scheduleName} />
                </label>

                <label>
                  <span>Availability</span>
                  {shareEnabled ? (
                    <select
                      onChange={(event) => setScheduleVisibility(event.target.value as ScheduleVisibility)}
                      value={scheduleVisibility}
                    >
                      <option value="personal">Only me</option>
                      <option value="shared">All signed-in zodl.com users</option>
                    </select>
                  ) : (
                    <input disabled type="text" value="Only me" />
                  )}
                </label>

                <label>
                  <span>Delivery cadence</span>
                  <select onChange={(event) => setScheduleMode(event.target.value as ScheduleEditorMode)} value={scheduleMode}>
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="selected_days">Selected days</option>
                    <option value="interval">Custom interval</option>
                  </select>
                </label>

                {scheduleMode === "interval" ? (
                  <>
                    <label>
                      <span>Repeat every</span>
                      <input
                        min={1}
                        onChange={(event) => setScheduleIntervalValue(event.target.value)}
                        step={1}
                        type="number"
                        value={scheduleIntervalValue}
                      />
                    </label>
                    <label>
                      <span>Interval unit</span>
                      <select
                        onChange={(event) => setScheduleIntervalUnit(event.target.value as ScheduleIntervalUnit)}
                        value={scheduleIntervalUnit}
                      >
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="minutes">Minutes (advanced)</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <label>
                    <span>Send time</span>
                    <input onChange={(event) => setScheduleTimeLocal(event.target.value)} type="time" value={scheduleTimeLocal} />
                  </label>
                )}

                <label>
                  <div className="compose-label-row">
                    <span>Lookback window</span>
                    <FieldHelp
                      label="Lookback window"
                      text="Each scheduled run looks back from its run time by this amount before collecting posts for the answer. For example, 3 days at 9:00 AM means each email covers the trailing 3-day window ending at 9:00 AM."
                    />
                  </div>
                  <input
                    min={1}
                    onChange={(event) => setScheduleLookbackValue(event.target.value)}
                    step={1}
                    type="number"
                    value={scheduleLookbackValue}
                  />
                </label>

                <label>
                  <span>Lookback unit</span>
                  <select
                    onChange={(event) => setScheduleLookbackUnit(event.target.value as LookbackUnit)}
                    value={scheduleLookbackUnit}
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                  </select>
                </label>

                <label className="schedule-enabled-label">
                  <span>Enabled</span>
                  <input
                    checked={scheduleEnabled}
                    onChange={(event) => setScheduleEnabled(event.target.checked)}
                    type="checkbox"
                  />
                </label>
              </div>

              {scheduleMode === "selected_days" ? (
                <fieldset className="schedule-day-picker">
                  <legend>Days</legend>
                  <div className="schedule-day-grid">
                    {SCHEDULE_DAY_CODES.map((day) => {
                      const active = scheduleSelectedDays.includes(day);
                      return (
                        <label className={`schedule-day-chip${active ? " schedule-day-chip-active" : ""}`} key={day}>
                          <input
                            checked={active}
                            onChange={() => toggleSelectedDay(day)}
                            type="checkbox"
                          />
                          <span>{DAY_LABELS[day]}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <p className="subtle-text">
                {scheduleMode === "interval"
                  ? "Custom interval schedules repeat based on elapsed time."
                  : "Choose the local time and days when this email should be generated."}
              </p>
              <p className="subtle-text">Runs use your local timezone: {scheduleTimeZone}</p>
              <p className="subtle-text">Schedules use the current Task and answer settings, and always send Email draft format.</p>

              <div className="compose-actions">
                <button className="button" disabled={isSavingSchedule} onClick={handleSaveSchedule} type="button">
                  {isSavingSchedule ? "Saving..." : editingScheduleId ? "Update schedule" : "Create schedule"}
                </button>
                {editingScheduleId ? (
                  <button className="button button-secondary" onClick={resetScheduleEditor} type="button">
                    Cancel edit
                  </button>
                ) : null}
              </div>
              {scheduleStatusText ? <p className="subtle-text">{scheduleStatusText}</p> : null}

              <div className="scheduled-jobs-columns">
                <section className="scheduled-jobs-group">
                  <div className="compose-section-header">
                    <h4>My schedules</h4>
                    <span className="subtle-text">{personalSchedules.length}</span>
                  </div>
                  {personalSchedules.length > 0 ? (
                    <ul className="scheduled-jobs-list">
                      {personalSchedules.map((job) => (
                        <li className="scheduled-job-item" key={job.job_id}>
                          <p className="scheduled-job-title">{job.name}</p>
                          <p className="subtle-text">
                            {formatScheduleSummary(job)} • Lookback {formatLookback(job.lookback_hours)}
                          </p>
                          <p className="subtle-text">
                            {job.enabled ? "Enabled" : "Disabled"} • Next {new Date(job.next_run_at).toLocaleString()}
                          </p>
                          <p className="subtle-text">Last status {job.last_status || "n/a"}</p>
                          {canManageScheduledJob(job, props.viewerEmail) ? (
                            <div className="compose-actions">
                              <button className="button button-secondary" onClick={() => handleEditSchedule(job)} type="button">
                                Edit
                              </button>
                              <button className="button button-secondary" onClick={() => handleToggleSchedule(job)} type="button">
                                {job.enabled ? "Disable" : "Enable"}
                              </button>
                              <button
                                className="button button-secondary"
                                onClick={() => handleRunScheduleNow(job.job_id)}
                                type="button"
                              >
                                Run now
                              </button>
                              <button
                                className="button button-secondary"
                                onClick={() => handleDeleteSchedule(job.job_id)}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="subtle-text">No personal schedules yet.</p>
                  )}
                </section>

                {shareEnabled ? (
                  <section className="scheduled-jobs-group">
                    <div className="compose-section-header">
                      <h4>Shared schedules</h4>
                      <span className="subtle-text">{sharedSchedules.length}</span>
                    </div>
                    {sharedSchedules.length > 0 ? (
                      <ul className="scheduled-jobs-list">
                        {sharedSchedules.map((job) => (
                          <li className="scheduled-job-item" key={job.job_id}>
                            <p className="scheduled-job-title">{job.name}</p>
                            <p className="subtle-text">
                              {formatScheduleSummary(job)} • Lookback {formatLookback(job.lookback_hours)}
                            </p>
                            <p className="subtle-text">
                              Shared by {job.owner_email} • Next {new Date(job.next_run_at).toLocaleString()}
                            </p>
                            <p className="subtle-text">
                              {job.enabled ? "Enabled" : "Disabled"} • Last status {job.last_status || "n/a"}
                            </p>
                            {canManageScheduledJob(job, props.viewerEmail) ? (
                              <div className="compose-actions">
                                <button className="button button-secondary" onClick={() => handleEditSchedule(job)} type="button">
                                  Edit
                                </button>
                                <button className="button button-secondary" onClick={() => handleToggleSchedule(job)} type="button">
                                  {job.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  className="button button-secondary"
                                  onClick={() => handleRunScheduleNow(job.job_id)}
                                  type="button"
                                >
                                  Run now
                                </button>
                                <button
                                  className="button button-secondary"
                                  onClick={() => handleDeleteSchedule(job.job_id)}
                                  type="button"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : (
                              <p className="subtle-text">Shared schedules are viewable by all signed-in zodl.com users.</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="subtle-text">No shared schedules yet.</p>
                    )}
                  </section>
                ) : null}
              </div>
            </div>
          </details>
        ) : null}

        {result ? (
          <div className="compose-result">
            <div className="compose-result-meta">
              <p className="subtle-text">
                Retrieved {result.retrieval_stats.retrieved_count} candidates, used {result.retrieval_stats.used_count} evidence posts.
              </p>
            </div>

            <section className="compose-section">
              <div className="compose-section-header">
                <h3>Answer</h3>
                <button className="button button-secondary button-small" onClick={() => handleCopy("answer", result.answer_text)} type="button">
                  {copyState === "answer" ? "Copied" : "Copy answer"}
                </button>
              </div>
              <MarkdownText text={result.answer_text} />
            </section>

            {result.draft_text ? (
              <section className="compose-section">
                <div className="compose-section-header">
                  <h3>Draft</h3>
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleCopy("draft", result.draft_text || "")}
                    type="button"
                  >
                    {copyState === "draft" ? "Copied" : "Copy draft"}
                  </button>
                </div>
                <MarkdownText text={result.draft_text} />
              </section>
            ) : null}

            {props.emailEnabled && draftFormat === "email" ? (
              <section className="compose-section">
                <div className="compose-section-header">
                  <h3>Email draft</h3>
                </div>
                <label className="compose-task-field">
                  <span>To</span>
                  <textarea
                    onChange={(event) => setEmailTo(event.target.value)}
                    placeholder="recipient1@example.com, recipient2@example.com"
                    rows={2}
                    value={emailTo}
                  />
                </label>
                <label className="compose-task-field">
                  <span>Subject</span>
                  <input
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Subject"
                    type="text"
                    value={emailSubject}
                  />
                </label>
                <label className="compose-task-field">
                  <span>Body (Markdown)</span>
                  <textarea
                    onChange={(event) => setEmailBodyMarkdown(event.target.value)}
                    placeholder="Email body"
                    rows={8}
                    value={emailBodyMarkdown}
                  />
                </label>
                <div className="compose-actions">
                  <button className="button" disabled={isSendingEmail} onClick={handleSendEmail} type="button">
                    {isSendingEmail ? "Sending..." : "Send email"}
                  </button>
                </div>
                {emailStatusText ? <p className="subtle-text">{emailStatusText}</p> : null}
              </section>
            ) : null}

            {result.key_points.length > 0 ? (
              <section className="compose-section">
                <h3>Key points</h3>
                <ul className="compose-key-points">
                  {result.key_points.map((point, index) => (
                    <li key={`${index}-${point}`}>{point}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="compose-section">
              <h3>Citations</h3>
              <ul className="compose-citations">
                {result.citations.map((citation) => (
                  <li className="compose-citation-item" key={citation.status_id}>
                    <p className="compose-citation-top">
                      <strong>@{citation.author_handle}</strong>
                      <span className="subtle-text">status {citation.status_id}</span>
                    </p>
                    <p className="compose-citation-excerpt">{citation.excerpt}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </details>
  );
}
