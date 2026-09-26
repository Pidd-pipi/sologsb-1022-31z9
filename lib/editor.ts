import type {
  Annotation,
  AnnotationKind,
  ConflictDecision,
  ConflictDecisionEntry,
  ConflictDecisionMethod,
  ConflictGroup,
  EditorState,
  SearchResult,
  Sentence,
  TextDocument,
  WorkspaceState
} from './types';

export const STORAGE_KEY = 'sologsb-1022/public-text-annotator/v1';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeDocument(document: TextDocument): TextDocument {
  document.conflictDecisions ??= [];
  for (const snapshot of document.snapshots) {
    snapshot.conflictDecisions ??= [];
  }
  return document;
}

export function normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
  normalizeDocument(workspace.document);
  return workspace;
}

export function createDecisionId(decidedAt: string) {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `decision-${decidedAt.replace(/[^0-9]/g, '').slice(0, 13)}-${randomSuffix}`;
}

export function createConflictDecision(
  document: TextDocument,
  group: Pick<ConflictGroup, 'key' | 'anchorId' | 'anchorType' | 'kind' | 'annotations'>,
  winnerId: string,
  method: ConflictDecisionMethod
): ConflictDecision | null {
  const sourceAnnotations = group.annotations.filter((annotation) =>
    document.annotations.some((item) => item.id === annotation.id)
  );
  const winner = sourceAnnotations.find((annotation) => annotation.id === winnerId);
  if (!winner) return null;

  const decidedAt = new Date().toISOString();
  const entries: ConflictDecisionEntry[] = sourceAnnotations.map((annotation) => ({
    annotationId: annotation.id,
    source: annotation.source,
    originalTitle: annotation.title,
    originalBody: annotation.body,
    role:
      method === 'merge'
        ? 'merged'
        : annotation.id === winner.id
          ? 'selected'
          : 'rejected',
    selectedText: method === 'select' && annotation.id === winner.id ? annotation.body : undefined
  }));
  const decision: ConflictDecision = {
    id: createDecisionId(decidedAt),
    groupKey: group.key,
    anchorId: group.anchorId,
    anchorType: group.anchorType,
    kind: group.kind,
    method,
    decidedAt,
    entries
  };

  if (method === 'merge') {
    winner.body = entries
      .map((entry) => {
        const original = sourceAnnotations.find((annotation) => annotation.id === entry.annotationId);
        return `【${entry.source}】${original?.body ?? entry.originalBody}`;
      })
      .join('\n\n');
  }

  for (const annotation of document.annotations) {
    if (annotation.anchorId !== group.anchorId || annotation.kind !== group.kind) continue;
    annotation.conflictState = 'resolved';
    annotation.conflictResolution = `${decidedAt} · ${method === 'merge' ? '合并来源' : `选用 ${winner.source}`}`;
    annotation.decisionIds = [...(annotation.decisionIds ?? []), decision.id];
    annotation.updatedAt = decidedAt;
  }

  document.conflictDecisions.push(decision);
  return decision;
}

export function getDecisionTargetLabel(document: ChapteredTextLike, decision: ConflictDecision) {
  if (decision.anchorType === 'chapter') {
    return document.chapters.find((chapter) => chapter.id === decision.anchorId)?.title ?? '未知章节';
  }

  for (const chapter of document.chapters) {
    if (decision.anchorType === 'sentence') {
      const sentence = chapter.sentences.find((item) => item.id === decision.anchorId);
      if (sentence) return `${chapter.title} · 第 ${sentence.order} 句`;
    } else {
      for (const sentence of chapter.sentences) {
        const token = sentence.tokens.find((item) => item.id === decision.anchorId);
        if (token) return `${chapter.title} · “${token.text.trim()}”`;
      }
    }
  }

  return decision.anchorId;
}

export function getDecisionMethodLabel(method: ConflictDecisionMethod) {
  return method === 'merge' ? '合并' : '选用';
}

export function getDecisionEntryLabel(entry: ConflictDecisionEntry) {
  if (entry.role === 'selected') return '选中正文';
  if (entry.role === 'rejected') return '列入校记';
  return '合并出处';
}

export function getDecisionForAnnotation(document: TextDocument, annotation: Annotation) {
  const decisionId = annotation.decisionIds?.at(-1);
  return document.conflictDecisions.find((decision) => decision.id === decisionId) ?? null;
}

export function createInitialWorkspace(document: TextDocument): WorkspaceState {
  return {
    document: normalizeDocument(clone(document)),
    mode: 'reading',
    selectedChapterId: document.chapters[0]?.id ?? '',
    selectedSentenceId: document.chapters[0]?.sentences[0]?.id ?? '',
    selectedAnnotationId: null,
    query: '',
    dirty: false
  };
}

export function createInitialEditorState(document: TextDocument): EditorState {
  return {
    workspace: createInitialWorkspace(document),
    past: [],
    future: [],
    lastAction: '已载入整理底本'
  };
}

function pushHistory(state: EditorState, next: WorkspaceState, label: string): EditorState {
  return {
    workspace: next,
    past: [...state.past.slice(-39), clone(state.workspace)],
    future: [],
    lastAction: label
  };
}

export type EditorAction =
  | { type: 'hydrate'; workspace: WorkspaceState }
  | { type: 'commit'; label: string; mutate: (document: TextDocument) => void }
  | { type: 'selectChapter'; chapterId: string }
  | { type: 'selectSentence'; chapterId: string; sentenceId: string }
  | { type: 'selectAnnotation'; annotationId: string | null }
  | { type: 'setMode'; mode: WorkspaceState['mode'] }
  | { type: 'setQuery'; query: string }
  | { type: 'undo' }
  | { type: 'redo' };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'hydrate':
      return {
        workspace: normalizeWorkspace(action.workspace),
        past: [],
        future: [],
        lastAction: '已恢复离线草稿'
      };
    case 'commit': {
      const next = clone(state.workspace);
      action.mutate(next.document);
      next.document.updatedAt = new Date().toISOString();
      next.dirty = true;
      return pushHistory(state, next, action.label);
    }
    case 'selectChapter': {
      const chapter = state.workspace.document.chapters.find((item) => item.id === action.chapterId);
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: chapter?.sentences[0]?.id ?? '',
          selectedAnnotationId: null
        }
      };
    }
    case 'selectSentence':
      return {
        ...state,
        workspace: {
          ...state.workspace,
          selectedChapterId: action.chapterId,
          selectedSentenceId: action.sentenceId,
          selectedAnnotationId: null
        }
      };
    case 'selectAnnotation':
      return {
        ...state,
        workspace: { ...state.workspace, selectedAnnotationId: action.annotationId }
      };
    case 'setMode':
      return { ...state, workspace: { ...state.workspace, mode: action.mode } };
    case 'setQuery':
      return { ...state, workspace: { ...state.workspace, query: action.query } };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        workspace: clone(previous),
        past: state.past.slice(0, -1),
        future: [clone(state.workspace), ...state.future].slice(0, 40),
        lastAction: '已撤销上一步操作'
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        workspace: clone(next),
        past: [...state.past, clone(state.workspace)].slice(-40),
        future: state.future.slice(1),
        lastAction: '已重做上一步操作'
      };
    }
    default:
      return state;
  }
}

type AnnotatedTextLike = Pick<TextDocument, 'chapters' | 'annotations'>;
type ChapteredTextLike = Pick<TextDocument, 'chapters'>;

export function getSentence(document: ChapteredTextLike, sentenceId: string): Sentence | undefined {
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (sentence) return sentence;
  }
  return undefined;
}

export function getTargetLabel(document: ChapteredTextLike, annotation: Annotation): string {
  if (annotation.anchorType === 'chapter') {
    return document.chapters.find((chapter) => chapter.id === annotation.anchorId)?.title ?? '未知章节';
  }

  for (const chapter of document.chapters) {
    if (annotation.anchorType === 'sentence') {
      const sentence = chapter.sentences.find((item) => item.id === annotation.anchorId);
      if (sentence) return `${chapter.title} · 第 ${sentence.order} 句`;
    } else {
      for (const sentence of chapter.sentences) {
        const token = sentence.tokens.find((item) => item.id === annotation.anchorId);
        if (token) return `${chapter.title} · “${token.text.trim()}”`;
      }
    }
  }

  return '引用目标已迁移到所属句';
}

export function collectSearchResults(document: TextDocument, query: string): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];

  const results: SearchResult[] = [];
  for (const chapter of document.chapters) {
    if (chapter.title.toLocaleLowerCase().includes(normalized)) {
      results.push({
        chapterId: chapter.id,
        title: chapter.title,
        excerpt: chapter.summary,
        kind: 'text'
      });
    }
    for (const sentence of chapter.sentences) {
      if (sentence.text.toLocaleLowerCase().includes(normalized)) {
        results.push({
          chapterId: chapter.id,
          sentenceId: sentence.id,
          title: `${chapter.title} · 第 ${sentence.order} 句`,
          excerpt: sentence.text,
          kind: 'text'
        });
      }
    }
  }

  for (const annotation of document.annotations) {
    const searchable = `${annotation.title} ${annotation.body} ${annotation.source}`.toLocaleLowerCase();
    if (searchable.includes(normalized)) {
      const sentence = getSentence(document, annotation.anchorType === 'sentence' ? annotation.anchorId : '');
      results.push({
        chapterId: findChapterIdForAnnotation(document, annotation),
        sentenceId: sentence?.id,
        annotationId: annotation.id,
        title: annotation.title,
        excerpt: `${annotation.source} · ${annotation.body}`,
        kind: 'annotation'
      });
    }
  }

  return results.slice(0, 24);
}

function findChapterIdForAnnotation(document: TextDocument, annotation: Annotation) {
  if (annotation.anchorType === 'chapter') return annotation.anchorId;
  for (const chapter of document.chapters) {
    if (chapter.sentences.some((sentence) => sentence.id === annotation.anchorId)) return chapter.id;
    if (
      annotation.anchorType === 'word' &&
      chapter.sentences.some((sentence) => sentence.tokens.some((token) => token.id === annotation.anchorId))
    ) {
      return chapter.id;
    }
  }
  return document.chapters[0]?.id ?? '';
}

export function getConflictGroups(document: TextDocument): ConflictGroup[] {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of document.annotations) {
    if (annotation.conflictState === 'resolved') continue;
    const key = `${annotation.anchorId}:${annotation.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), annotation]);
  }

  return Array.from(groups.entries())
    .filter(([, items]) => {
      const bodies = new Set(items.map((item) => item.body.trim()));
      return bodies.size > 1;
    })
    .map(([key, items]) => {
      const first = items[0];
      const sentence = first.anchorType === 'sentence' ? getSentence(document, first.anchorId) : undefined;
      const tokenText = findTokenText(document, first.anchorId);
      return {
        key,
        anchorId: first.anchorId,
        anchorType: first.anchorType,
        kind: first.kind,
        anchorLabel: sentence ? `“${sentence.text}”` : tokenText ? `“${tokenText}”` : '文本片段',
        annotations: items
      };
    });
}

function findTokenText(document: ChapteredTextLike, tokenId: string) {
  for (const chapter of document.chapters) {
    for (const sentence of chapter.sentences) {
      const token = sentence.tokens.find((item) => item.id === tokenId);
      if (token) return token.text.trim();
    }
  }
  return '';
}

export function kindLabel(kind: AnnotationKind) {
  return {
    footnote: '脚注',
    variant: '异文',
    background: '背景',
    crossref: '互见'
  }[kind];
}

export function updateSentenceText(
  document: TextDocument,
  sentenceId: string,
  text: string,
  tokenize: (value: string, id: string, existing: Sentence['tokens']) => Sentence['tokens']
) {
  let remappedAnnotations = 0;
  for (const chapter of document.chapters) {
    const sentence = chapter.sentences.find((item) => item.id === sentenceId);
    if (!sentence) continue;
    const previousIds = new Set(sentence.tokens.map((token) => token.id));
    sentence.text = text;
    sentence.tokens = tokenize(text, sentence.id, sentence.tokens);
    const remainingIds = new Set(sentence.tokens.map((token) => token.id));

    for (const annotation of document.annotations) {
      if (annotation.anchorType === 'word' && previousIds.has(annotation.anchorId) && !remainingIds.has(annotation.anchorId)) {
        annotation.anchorId = sentence.id;
        annotation.anchorType = 'sentence';
        annotation.title = `${annotation.title}（引用已随修订迁移）`;
        remappedAnnotations += 1;
      }
    }
    break;
  }
  return remappedAnnotations;
}

export function removeAnnotationReferences(document: TextDocument, removedId: string) {
  for (const annotation of document.annotations) {
    annotation.references = annotation.references.filter((id) => id !== removedId);
  }
}

export function toWorkspace(document: TextDocument, fallback: WorkspaceState): WorkspaceState {
  const chapter = document.chapters.find((item) => item.id === fallback.selectedChapterId) ?? document.chapters[0];
  const sentence = chapter?.sentences.find((item) => item.id === fallback.selectedSentenceId) ?? chapter?.sentences[0];
  return {
    document,
    mode: fallback.mode,
    selectedChapterId: chapter?.id ?? '',
    selectedSentenceId: sentence?.id ?? '',
    selectedAnnotationId: fallback.selectedAnnotationId,
    query: fallback.query,
    dirty: false
  };
}
