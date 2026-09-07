const { PlatformError } = require("../../platform/errors/error-catalog.ts");
const { OFFICIAL_KNOWLEDGE_CHUNKS, OFFICIAL_SOURCE_REGISTRY } = require("./knowledge-catalog.ts");

const KNOWLEDGE_INDEX_KEY = "rag:official:knowledge-base:v1";
const KNOWLEDGE_INDEX_VERSION = "2026-09-06.rag-v4";
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const SUPPORTED_GOAL_TYPES = new Set([
  "postgraduate_entrance_exam",
  "civil_service_exam",
  "employment",
  "professional_certificate",
  "personal_growth",
]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function tokenSet(value) {
  const normalized = normalize(value);
  const tokens = new Set(normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]/g) ?? []);
  for (const segment of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (let index = 0; index < segment.length - 1; index += 1) tokens.add(segment.slice(index, index + 2));
  }
  return tokens;
}

function publicSource(source) {
  return { ...source };
}

function sourceMatchesRegion(source, region) {
  const normalizedRegion = normalize(region);
  if (!normalizedRegion || source.region_scope === "全国") return true;
  return source.region_scope.includes("报考地区") || normalize(source.region_scope).includes(normalizedRegion);
}

function scoreChunk(chunk, source, query, goalType, region) {
  const queryTokens = tokenSet(query);
  const corpusText = `${chunk.title} ${chunk.content} ${(chunk.keywords ?? []).join(" ")}`;
  const corpusTokens = tokenSet(corpusText);
  const overlap = [...queryTokens].filter((token) => corpusTokens.has(token)).length;
  const lexicalScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
  const exactPhrase = normalize(query).length >= 4 && normalize(`${chunk.title} ${chunk.content}`).includes(normalize(query)) ? 0.35 : 0;
  const queryTerms = normalize(query).match(/[a-z0-9]{2,}/g) ?? [];
  const corpusTerms = new Set(normalize(corpusText).match(/[a-z0-9]{2,}/g) ?? []);
  const keywordTerms = new Set(normalize((chunk.keywords ?? []).join(" ")).match(/[a-z0-9]{2,}/g) ?? []);
  const technicalTermScore = queryTerms.length > 0
    ? queryTerms.filter((term) => corpusTerms.has(term)).length / queryTerms.length
    : 0;
  const keywordScore = queryTerms.length > 0
    ? queryTerms.filter((term) => keywordTerms.has(term)).length / queryTerms.length
    : 0;
  const titleScore = queryTokens.size > 0
    ? [...queryTokens].filter((token) => tokenSet(chunk.title).has(token)).length / queryTokens.size
    : 0;
  const goalScore = chunk.goal_types.includes(goalType) ? 0.35 : 0.08;
  const regionScore = sourceMatchesRegion(source, region) ? 0.12 : -0.35;
  return Number((lexicalScore * 0.4 + technicalTermScore * 0.28 + keywordScore * 0.16 + titleScore * 0.15 + exactPhrase + goalScore + regionScore).toFixed(6));
}

function validateSearch(input = {}) {
  const goalType = input.goal_type ?? input.goalType;
  const query = input.query ?? "";
  const region = input.region ?? "";
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (typeof goalType !== "string" || goalType.length < 1 || goalType.length > 80) throw new PlatformError("VALIDATION_ERROR", "goal_type is required");
  if (!SUPPORTED_GOAL_TYPES.has(goalType)) throw new PlatformError("VALIDATION_ERROR", "goal_type is not supported");
  if (typeof query !== "string" || query.length > 1200) throw new PlatformError("VALIDATION_ERROR", "query must contain at most 1200 characters");
  if (typeof region !== "string" || region.length > 120) throw new PlatformError("VALIDATION_ERROR", "region must contain at most 120 characters");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new PlatformError("VALIDATION_ERROR", `limit must be an integer from 1 to ${MAX_LIMIT}`);
  return { goalType, query: query.trim(), region: region.trim(), limit };
}

class KnowledgeRetrievalService {
  constructor({ database, clock = () => Date.now() }) {
    this.database = database;
    this.clock = clock;
  }

  async loadIndex() {
    const stored = await this.database.get(KNOWLEDGE_INDEX_KEY);
    if (stored?.version === KNOWLEDGE_INDEX_VERSION && Array.isArray(stored.chunks) && Array.isArray(stored.sources)) return stored;
    const seeded = {
      version: KNOWLEDGE_INDEX_VERSION,
      sources: OFFICIAL_SOURCE_REGISTRY.map(publicSource),
      chunks: OFFICIAL_KNOWLEDGE_CHUNKS.map((chunk) => ({ ...chunk, keywords: [...chunk.keywords], goal_types: [...chunk.goal_types] })),
      seeded_at: new Date(this.clock()).toISOString(),
    };
    await this.database.set(KNOWLEDGE_INDEX_KEY, seeded);
    return seeded;
  }

  async getSources(goalType) {
    if (goalType !== undefined && !SUPPORTED_GOAL_TYPES.has(goalType)) throw new PlatformError("VALIDATION_ERROR", "goal_type is not supported");
    const index = await this.loadIndex();
    return index.sources.filter((source) => !goalType || source.goal_type === goalType).map(publicSource);
  }

  async search(input) {
    const { goalType, query, region, limit } = validateSearch(input);
    const index = await this.loadIndex();
    const sources = new Map(index.sources.map((source) => [source.id, source]));
    const results = index.chunks
      .filter((chunk) => chunk.review_status === "reviewed" && chunk.goal_types.includes(goalType))
      .map((chunk) => {
        const source = sources.get(chunk.source_id);
        return {
          chunk,
          source,
          score: scoreChunk(chunk, source, query, goalType, region),
        };
      })
      .filter((item) => item.source && item.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, limit)
      .map(({ chunk, source, score }) => ({
        chunk_id: chunk.id,
        source_id: source.id,
        title: chunk.title,
        content: chunk.content,
        score,
        source: publicSource(source),
        source_links: [...(chunk.source_links ?? [source.official_url])],
        metadata: chunk.metadata ?? {},
        provenance: {
          knowledge_index_version: index.version,
          review_status: chunk.review_status,
          region_scope: chunk.region_scope,
          claim_status: chunk.metadata?.claim_status ?? "reviewed",
          review_note: chunk.metadata?.review_note ?? "审核知识片段",
        },
      }));

    return {
      query,
      goal_type: goalType,
      region: region || null,
      knowledge_index_version: index.version,
      retrieved_at: new Date(this.clock()).toISOString(),
      results,
    };
  }

  formatContext(retrieval, maxCharacters = 9000) {
    if (!retrieval?.results?.length) return "没有检索到可用的官方知识片段。只能生成学习行动建议，不能把动态事实写成已核实结论。";
    let context = "";
    for (const item of retrieval.results) {
      const entry = `[${item.source_id}/${item.chunk_id}] ${item.title}\n${item.content}\n来源：${item.source.title}（${(item.source_links ?? [item.source.official_url]).join("；")}）\n审核边界：${item.provenance.review_note}\n`;
      if (context.length + entry.length > maxCharacters) break;
      context += `${entry}\n`;
    }
    return context.trim();
  }
}

module.exports = {
  DEFAULT_LIMIT,
  KNOWLEDGE_INDEX_KEY,
  KNOWLEDGE_INDEX_VERSION,
  KnowledgeRetrievalService,
  tokenSet,
  validateSearch,
};
