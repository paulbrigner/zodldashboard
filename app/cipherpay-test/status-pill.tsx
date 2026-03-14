"use client";

import type { CipherPayTestSessionStatus } from "@/lib/cipherpay-test/types";
import { cipherPayStatusClassName, cipherPayStatusLabel } from "./client-utils";

export function CipherPayStatusPill({ status }: { status: CipherPayTestSessionStatus }) {
  return <span className={cipherPayStatusClassName(status)}>{cipherPayStatusLabel(status)}</span>;
}
