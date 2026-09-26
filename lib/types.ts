export type ViewMode = 'reading' | 'editing' | 'critical';
export type AnchorType = 'chapter' | 'sentence' | 'word';
export type AnnotationKind = 'footnote' | 'variant' | 'background' | 'crossref';
export type AnnotationStatus = 'open' | 'resolved';

export interface TextToken {
  id: string;
  text: string;
}

export interface Sentence {
  id: string;
  order: number;
  text: string;
  tokens: TextToken[];
}

export interface Chapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  sentences: Sentence[];
}

export interface ResolutionSourceEntry {
  annotationId: string;
  source: string;
  title: string;
  body: string;
}

export interface ResolutionRecord {
  id: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  strategy: 'select' | 'merge';
  winnerId: string;
  winnerSource: string;
  /** 选用时保留的选中正文；合并时为合并前的主条正文 */
  keptBody: string;
  /** 参与裁决的全部来源，逐条标明出处 */
  entries: ResolutionSourceEntry[];
  /** 选用时被舍弃的来源及原文 */
  discarded: ResolutionSourceEntry[];
  createdAt: string;
}

export interface Annotation {
  id: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  title: string;
  body: string;
  source: string;
  references: string[];
  status: AnnotationStatus;
  tags: string[];
  conflictState: 'open' | 'resolved';
  conflictResolution?: string;
  /** 合并条文时逐条保留的出处 */
  mergedFrom?: ResolutionSourceEntry[];
  updatedAt: string;
}

export interface VersionSnapshot {
  id: string;
  label: string;
  note: string;
  createdAt: string;
  chapters: Chapter[];
  annotations: Annotation[];
  resolutions: ResolutionRecord[];
}

export interface TextDocument {
  id: string;
  title: string;
  author: string;
  edition: string;
  chapters: Chapter[];
  annotations: Annotation[];
  resolutions: ResolutionRecord[];
  snapshots: VersionSnapshot[];
  updatedAt: string;
}

export interface WorkspaceState {
  document: TextDocument;
  mode: ViewMode;
  selectedChapterId: string;
  selectedSentenceId: string;
  selectedAnnotationId: string | null;
  query: string;
  dirty: boolean;
}

export interface EditorState {
  workspace: WorkspaceState;
  past: WorkspaceState[];
  future: WorkspaceState[];
  lastAction: string;
}

export interface SearchResult {
  chapterId: string;
  sentenceId?: string;
  annotationId?: string;
  title: string;
  excerpt: string;
  kind: 'text' | 'annotation';
}

export interface ConflictGroup {
  key: string;
  anchorId: string;
  anchorType: AnchorType;
  kind: AnnotationKind;
  anchorLabel: string;
  annotations: Annotation[];
}
