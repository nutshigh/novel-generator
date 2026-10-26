import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  ProjectSchema,
  type Project,
  type ProjectStatus,
} from "./schemas.js";

export interface CreateProjectInput {
  premise: string;
  language?: string;
  targetWords: number;
  chapterWords: number;
  maxChapters: number;
  reviewEnabled?: boolean;
  id?: string;
  status?: ProjectStatus;
  createdAt?: string;
}

export interface ProjectStore {
  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  saveArtifact(projectId: string, name: string, content: string): Promise<string>;
  appendArtifact(projectId: string, name: string, content: string): Promise<string>;
  readArtifact(projectId: string, name: string): Promise<string | undefined>;
  listArtifacts(projectId: string): Promise<string[]>;
  listProjects(): Promise<Project[]>;
  /** Absolute on-disk project directory, or undefined for in-memory stores. */
  getProjectDir(id: string): string | undefined;
}

function buildProject(input: CreateProjectInput): Project {
  return ProjectSchema.parse({
    id: input.id ?? randomUUID(),
    premise: input.premise,
    language: input.language ?? "简体中文",
    targetWords: input.targetWords,
    chapterWords: input.chapterWords,
    maxChapters: input.maxChapters,
    reviewEnabled: input.reviewEnabled ?? false,
    status: input.status ?? "draft",
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

function sortProjects(projects: Project[]): Project[] {
  return projects.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, Project>();
  private readonly artifacts = new Map<string, string>();

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project = buildProject(input);
    await this.saveProject(project);
    return structuredClone(project);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project ? structuredClone(project) : undefined;
  }

  async saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project);
    this.projects.set(parsed.id, structuredClone(parsed));
  }

  async saveArtifact(projectId: string, name: string, content: string): Promise<string> {
    validateProjectId(projectId);
    resolveArtifactPath(join(resolve("."), "__memory_artifacts__"), name);

    this.artifacts.set(`${projectId}/${name}`, content);
    return `memory://${projectId}/${name}`;
  }

  async appendArtifact(
    projectId: string,
    name: string,
    content: string,
  ): Promise<string> {
    validateProjectId(projectId);
    resolveArtifactPath(join(resolve("."), "__memory_artifacts__"), name);

    const key = `${projectId}/${name}`;
    this.artifacts.set(key, (this.artifacts.get(key) ?? "") + content);
    return `memory://${key}`;
  }

  async readArtifact(
    projectId: string,
    name: string,
  ): Promise<string | undefined> {
    validateProjectId(projectId);
    resolveArtifactPath(join(resolve("."), "__memory_artifacts__"), name);

    return this.artifacts.get(`${projectId}/${name}`);
  }

  async listProjects(): Promise<Project[]> {
    return sortProjects(
      Array.from(this.projects.values(), (project) => structuredClone(project)),
    );
  }

  async listArtifacts(projectId: string): Promise<string[]> {
    validateProjectId(projectId);
    const prefix = `${projectId}/`;
    return Array.from(this.artifacts.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort((left, right) => left.localeCompare(right));
  }

  getArtifact(projectId: string, name: string): string | undefined {
    return this.artifacts.get(`${projectId}/${name}`);
  }

  getProjectDir(id: string): string | undefined {
    validateProjectId(id);
    return undefined;
  }
}

function validateProjectId(id: string): void {
  if (!id || id === "." || id === ".." || /[\\/]/.test(id)) {
    throw new Error(`Invalid project id: ${id}`);
  }
}

function projectDir(rootDir: string, id: string): string {
  validateProjectId(id);
  return join(rootDir, id);
}

function resolveArtifactPath(dir: string, name: string): string {
  if (!name.trim()) {
    throw new Error("Artifact name must not be empty.");
  }

  const root = resolve(dir);
  const target = resolve(root, name);
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Artifact path escapes project directory: ${name}`);
  }
  return target;
}

function artifactPath(dir: string, name: string): string {
  return resolveArtifactPath(dir, name);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function isRetryableRenameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  const delays = [0, 10, 25, 50, 100];
  let lastError: unknown;

  for (const wait of delays) {
    if (wait > 0) await delay(wait);
    try {
      await rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRenameError(error)) throw error;
    }
  }

  throw lastError;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, content, "utf8");
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export class JsonProjectStore implements ProjectStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const project = buildProject(input);
    await this.saveProject(project);
    return project;
  }

  async getProject(id: string): Promise<Project | undefined> {
    try {
      const raw = await readFile(join(projectDir(this.rootDir, id), "project.json"), "utf8");
      return ProjectSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project);
    const filePath = join(projectDir(this.rootDir, parsed.id), "project.json");
    await atomicWrite(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  async saveArtifact(projectId: string, name: string, content: string): Promise<string> {
    const dir = projectDir(this.rootDir, projectId);
    const target = artifactPath(dir, name);
    await atomicWrite(target, content);
    return target;
  }

  async appendArtifact(
    projectId: string,
    name: string,
    content: string,
  ): Promise<string> {
    const dir = projectDir(this.rootDir, projectId);
    const target = artifactPath(dir, name);
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, content, "utf8");
    return target;
  }

  async readArtifact(
    projectId: string,
    name: string,
  ): Promise<string | undefined> {
    const dir = projectDir(this.rootDir, projectId);
    const target = artifactPath(dir, name);
    try {
      return await readFile(target, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async listArtifacts(projectId: string): Promise<string[]> {
    try {
      const entries = await readdir(projectDir(this.rootDir, projectId), {
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  getProjectDir(id: string): string | undefined {
    return projectDir(this.rootDir, id);
  }

  async listProjects(): Promise<Project[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const projects: Project[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const raw = await readFile(
          join(this.rootDir, entry.name, "project.json"),
          "utf8",
        );
        projects.push(ProjectSchema.parse(JSON.parse(raw)));
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
    }

    return sortProjects(projects);
  }
}
