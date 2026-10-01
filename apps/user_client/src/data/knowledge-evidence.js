const KNOWLEDGE_POSITIONS = ["east", "west", "north", "south", "northeast", "southwest", "southeast", "northwest"];

export function serializeKnowledgeNodes(items) {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    domain: item.domain,
    strand: item.strand,
    mastery: item.mastery,
    state: item.state,
    gua: item.gua,
    color: item.color,
    source: item.source,
    updated: item.updated,
    summary: item.summary,
    note: item.note,
    related_ids: item.relatedIds ?? [],
    position: item.position ?? "",
    ...(item.goalId === undefined ? {} : { goal_id: item.goalId }),
    ...(item.evidenceLevel === undefined ? {} : { evidence_level: item.evidenceLevel }),
  }));
}

export function hydrateKnowledgeNodes(items) {
  return items.map((item) => ({
    ...item,
    relatedIds: Array.isArray(item.related_ids) ? item.related_ids : [],
    ...(item.goal_id === undefined ? {} : { goalId: item.goal_id }),
    ...(item.evidence_level === undefined ? {} : { evidenceLevel: item.evidence_level }),
  }));
}

function captureEvidenceKnowledge(state, action, evidence, evidenceLevel) {
  if (!action?.id) return null;
  const nodeId = `evidence-${action.id}`;
  const existing = state.knowledge.find((item) => item.id === nodeId);
  if (existing) return existing;
  const selectedGoal = state.goals?.find((goal) => goal.selected);
  const goalId = selectedGoal?.id ?? "";
  const previousGoalNode = goalId ? state.knowledge.find((item) => item.goalId === goalId) : null;
  const relatedId = previousGoalNode?.id ?? "";
  const position = KNOWLEDGE_POSITIONS.find((candidate) => !state.knowledge.some((item) => item.position === candidate)) ?? "east";
  const evidenceText = String(evidence ?? "").trim().slice(0, 1000);
  const node = {
    id: nodeId,
    title: String(action.title ?? "本次学习证据").trim().slice(0, 160),
    domain: "学习证据 · 当前行动",
    strand: state.user.stage || "当前学习",
    mastery: Math.min(100, Math.max(0, evidenceLevel * 20)),
    state: evidenceLevel >= 3 ? "连通" : "初探",
    gua: "证",
    color: evidenceLevel >= 3 ? "gold" : "rock",
    source: action.artifact_refs?.length ? "材料 · 证据账本" : "学习 · 证据账本",
    updated: "刚刚",
    summary: evidenceText || "已留下本次行动的学习证据。",
    note: `L${evidenceLevel} 证据：${evidenceText || "已留下本次行动的学习证据。"}`.slice(0, 1000),
    relatedIds: relatedId ? [relatedId] : [],
    ...(goalId ? { goalId } : {}),
    position,
    evidenceLevel,
  };
  state.knowledge.unshift(node);
  if (relatedId) {
    previousGoalNode.relatedIds = [...new Set([...(previousGoalNode.relatedIds ?? []), node.id])];
  }
  state.activeKnowledgeId = node.id;
  return node;
}

export async function persistEvidenceKnowledge({ state, action, evidence, evidenceLevel, persist }) {
  const previousKnowledge = structuredClone(state.knowledge);
  const previousActiveKnowledgeId = state.activeKnowledgeId;
  const node = captureEvidenceKnowledge(state, action, evidence, evidenceLevel);
  try {
    await persist?.();
    return node;
  } catch (error) {
    state.knowledge = previousKnowledge;
    state.activeKnowledgeId = previousActiveKnowledgeId;
    throw error;
  }
}
