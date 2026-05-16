import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const DEFAULT_ZODL_ROADMAP_HTML_PATH = ".private/zodl-roadmap/index.html";

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
