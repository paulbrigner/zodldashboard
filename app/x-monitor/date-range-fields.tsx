"use client";

import { useMemo, useState } from "react";

type DateRangeFieldsProps = {
  initialSince?: string;
  initialUntil?: string;
};

function isoToLocalInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function applyRangePreset(hours: number): { sinceLocal: string; untilLocal: string } {
  const until = new Date();
  const since = new Date(until.getTime() - hours * 60 * 60 * 1000);
  return {
    sinceLocal: isoToLocalInput(since.toISOString()),
    untilLocal: isoToLocalInput(until.toISOString()),
  };
}

export function DateRangeFields({ initialSince, initialUntil }: DateRangeFieldsProps) {
  const [sinceLocal, setSinceLocal] = useState<string>(() => isoToLocalInput(initialSince));
  const [untilLocal, setUntilLocal] = useState<string>(() => isoToLocalInput(initialUntil));

  const sinceIso = useMemo(() => localInputToIso(sinceLocal), [sinceLocal]);
  const untilIso = useMemo(() => localInputToIso(untilLocal), [untilLocal]);

  return (
    <>
      <input name="since" type="hidden" value={sinceIso} />
      <input name="until" type="hidden" value={untilIso} />

      <div className="date-range-row">
        <label className="date-range-field">
          <span>From</span>
          <input
            aria-label="From date and time"
            onChange={(event) => setSinceLocal(event.target.value)}
            type="datetime-local"
            value={sinceLocal}
          />
        </label>

        <label className="date-range-field">
          <span>To</span>
          <input
            aria-label="To date and time"
            onChange={(event) => setUntilLocal(event.target.value)}
            type="datetime-local"
            value={untilLocal}
          />
        </label>
      </div>

      <div className="range-presets">
        <button
          className="button button-secondary button-small"
          onClick={() => {
            const preset = applyRangePreset(1);
            setSinceLocal(preset.sinceLocal);
            setUntilLocal(preset.untilLocal);
          }}
          type="button"
        >
          Last 1h
        </button>
        <button
          className="button button-secondary button-small"
          onClick={() => {
            const preset = applyRangePreset(24);
            setSinceLocal(preset.sinceLocal);
            setUntilLocal(preset.untilLocal);
          }}
          type="button"
        >
          Last 24h
        </button>
        <button
          className="button button-secondary button-small"
          onClick={() => {
            const preset = applyRangePreset(7 * 24);
            setSinceLocal(preset.sinceLocal);
            setUntilLocal(preset.untilLocal);
          }}
          type="button"
        >
          Last 7d
        </button>
        <button
          className="button button-secondary button-small"
          onClick={() => {
            const preset = applyRangePreset(30 * 24);
            setSinceLocal(preset.sinceLocal);
            setUntilLocal(preset.untilLocal);
          }}
          type="button"
        >
          Last 30d
        </button>
        <button
          className="button button-secondary button-small"
          onClick={() => {
            setSinceLocal("");
            setUntilLocal("");
          }}
          type="button"
        >
          Clear
        </button>
        <p className="subtle-text range-hint">Date/time uses your local timezone.</p>
      </div>
    </>
  );
}
