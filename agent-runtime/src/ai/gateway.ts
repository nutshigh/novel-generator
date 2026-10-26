export type GenerateKind =
  | "bible"
  | "outline"
  | "outline_extension"
  | "chapter"
  | "review"
  | "ending_audit"
  | "boundary_audit"
  | "seam_repair"
  | "state"
  | "chapter_memory"
  | "revise";

export interface GenerateRequest {
  kind: GenerateKind;
  system: string;
  user: string;
  chapterNumber?: number;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiGateway {
  generateText(req: GenerateRequest): Promise<string>;
}
