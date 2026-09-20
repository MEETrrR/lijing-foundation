const SNAPSHOT_VERSION = "learner-snapshot-v1";

function actionBudgetMinutes(profile = {}) {
  const requested = Number(profile.daily_minutes);
  if (!Number.isInteger(requested) || requested < 5) return 30;
  return Math.min(30, requested);
}

function memoryScope(goalId) {
  return goalId === "goal-exam" || goalId === "goal-skill" || goalId === "goal-life" ? goalId : "global";
}

class LearnerSnapshotService {
  constructor({ actions, artifacts, diagnosis, memory, userState, clock = () => Date.now() }) {
    this.actions = actions;
    this.artifacts = artifacts;
    this.diagnosis = diagnosis;
    this.memory = memory;
    this.userState = userState;
    this.clock = clock;
  }

  async getSnapshot(actorId, requestId = null) {
    const state = this.userState ? (await this.userState.getState(actorId, requestId)).state : null;
    const profile = state?.profile ?? {};
    const date = this.actions.dateForState(profile);
    const scope = memoryScope(state?.goal_id);
    const [action, materials, memories] = await Promise.all([
      this.actions.getCurrent(actorId, date),
      this.artifacts.listArtifacts(actorId, 6),
      this.memory?.getConfirmedContext ? this.memory.getConfirmedContext(actorId, scope) : [],
    ]);
    let diagnosis = null;
    if (action?.diagnosis_ref && this.diagnosis) {
      try {
        diagnosis = await this.diagnosis.getDiagnosis(actorId, action.diagnosis_ref);
      } catch {
        diagnosis = null;
      }
    }
    return {
      snapshot_version: SNAPSHOT_VERSION,
      generated_at: new Date(this.clock()).toISOString(),
      date,
      goal_scope: scope,
      action_budget_minutes: actionBudgetMinutes(profile),
      current_action: action ? {
        id: action.id,
        version: action.version,
        status: action.status,
        title: action.title,
        artifact_refs: [...action.artifact_refs],
        knowledge_node_refs: [...(action.knowledge_node_refs ?? [])],
      } : null,
      unresolved: diagnosis ? {
        diagnosis_id: diagnosis.id,
        status: diagnosis.status,
        unknowns: [...diagnosis.unknowns],
        error_tags: [...diagnosis.error_tags],
      } : null,
      confirmed_memories: memories.map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        scope: memory.scope,
        content: memory.content,
        confirmed_at: memory.confirmed_at ?? null,
        updated_at: memory.updated_at,
      })),
      recent_materials: materials.map((artifact) => ({
        id: artifact.id,
        subject: artifact.subject,
        kind: artifact.kind,
        source_title: artifact.source_title,
        updated_at: artifact.updated_at,
      })),
    };
  }
}

module.exports = {
  SNAPSHOT_VERSION,
  LearnerSnapshotService,
  actionBudgetMinutes,
};
