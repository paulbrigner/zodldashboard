import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_ZODL_ROADMAP_HTML_PATH = ".private/zodl-roadmap/index.html";
const DEFAULT_PGPZ_ROADMAP_HTML_PATH = ".private/pgpz-roadmap/index.html";
const DEFAULT_ARKTOUROS_HTML_PATH = ".private/arktouros/index.html";
const DEFAULT_PLACEHODLR_HTML_PATH = ".private/placehodlr/index.html";
const DEFAULT_ZODL_SUMMIT_HTML_PATH = ".private/2026-zodl-summit/index.html";

type NodeSystemError = Error & {
  code?: string;
};

function resolvePrivatePath(configuredPath: string | undefined, fallbackPath: string): string {
  const rawPath = configuredPath?.trim() || fallbackPath;
  return isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath);
}

function isMissingFileError(error: unknown): error is NodeSystemError {
  const code = (error as NodeSystemError | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function getZodlRoadmapHtmlPath(): string {
  return resolvePrivatePath(process.env.ZODL_ROADMAP_HTML_PATH, DEFAULT_ZODL_ROADMAP_HTML_PATH);
}

export function getPgpzRoadmapHtmlPath(): string {
  return resolvePrivatePath(process.env.PGPZ_ROADMAP_HTML_PATH, DEFAULT_PGPZ_ROADMAP_HTML_PATH);
}

export function getArktourosHtmlPath(): string {
  return resolvePrivatePath(process.env.ARKTOUROS_HTML_PATH, DEFAULT_ARKTOUROS_HTML_PATH);
}

export function getPlacehodlrHtmlPath(): string {
  return resolvePrivatePath(process.env.PLACEHODLR_HTML_PATH, DEFAULT_PLACEHODLR_HTML_PATH);
}

export function getZodlSummitHtmlPath(): string {
  return resolvePrivatePath(process.env.ZODL_SUMMIT_HTML_PATH, DEFAULT_ZODL_SUMMIT_HTML_PATH);
}

export async function readZodlRoadmapHtml(): Promise<string | null> {
  const htmlPath = getZodlRoadmapHtmlPath();

  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readPgpzRoadmapHtml(): Promise<string | null> {
  const htmlPath = getPgpzRoadmapHtmlPath();

  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readArktourosHtml(): Promise<string | null> {
  const htmlPath = getArktourosHtmlPath();

  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readPlacehodlrHtml(): Promise<string | null> {
  const htmlPath = getPlacehodlrHtmlPath();

  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readZodlSummitHtml(): Promise<string | null> {
  const htmlPath = getZodlSummitHtmlPath();

  try {
    return await readFile(htmlPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}
