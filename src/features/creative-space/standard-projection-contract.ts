export type StandardMediaKind = "IMAGE" | "VIDEO" | "AUDIO";

export type StandardDraftV1 = Readonly<{
  draftId: string;
  mediaKind: StandardMediaKind;
  recipeId: string;
  prompt: string;
  offerId: string | null;
  bindingIds: readonly string[];
  settings: Readonly<Record<string, string | number | boolean | null>>;
  version: number;
  updatedAt: string;
}>;

export type StandardGenerationSessionV1 = Readonly<{
  sessionId: string;
  operationIds: readonly string[];
  outputAssetIds: readonly string[];
  createdAt: string;
}>;

export type StandardReferenceAliasV1 = Readonly<{
  bindingId: string;
  alias: string;
}>;

export type StandardTrashEntryV1 = Readonly<{
  assetId: string;
  deletedAt: string;
  purgeAfter: string;
}>;

export type StandardProjectionV1 = Readonly<{
  schemaVersion: 1;
  draftsByMedia: Readonly<Partial<Record<StandardMediaKind, StandardDraftV1>>>;
  generationSessions: readonly StandardGenerationSessionV1[];
  galleryOrder: readonly string[];
  referenceAliases: readonly StandardReferenceAliasV1[];
  trashEntries: readonly StandardTrashEntryV1[];
  libraryPreferences: Readonly<{
    sort: "NEWEST" | "OLDEST" | "CUSTOM";
    compact: boolean;
  }>;
  updatedAt: string;
}>;

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isoDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));

function validDraft(value: unknown, mediaKind: StandardMediaKind): value is StandardDraftV1 {
  if (!object(value) || value.mediaKind !== mediaKind) return false;
  if (!onlyKeys(value, ["draftId", "mediaKind", "recipeId", "prompt", "offerId", "bindingIds", "settings", "version", "updatedAt"])) return false;
  if (typeof value.draftId !== "string" || !value.draftId || typeof value.recipeId !== "string" || !value.recipeId) return false;
  if (typeof value.prompt !== "string" || !(value.offerId === null || typeof value.offerId === "string")) return false;
  if (!strings(value.bindingIds) || !object(value.settings) || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !isoDate(value.updatedAt)) return false;
  return Object.values(value.settings).every((setting) => setting === null || ["string", "number", "boolean"].includes(typeof setting));
}

export function isStandardProjectionV1(value: unknown): value is StandardProjectionV1 {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.draftsByMedia)) return false;
  if (!onlyKeys(value, ["schemaVersion", "draftsByMedia", "generationSessions", "galleryOrder", "referenceAliases", "trashEntries", "libraryPreferences", "updatedAt"])) return false;
  if (!onlyKeys(value.draftsByMedia, ["IMAGE", "VIDEO", "AUDIO"])) return false;
  if (!Array.isArray(value.generationSessions) || !strings(value.galleryOrder) || !Array.isArray(value.referenceAliases) || !Array.isArray(value.trashEntries)) return false;
  if (!object(value.libraryPreferences) || !onlyKeys(value.libraryPreferences, ["sort", "compact"]) || !["NEWEST", "OLDEST", "CUSTOM"].includes(String(value.libraryPreferences.sort)) || typeof value.libraryPreferences.compact !== "boolean") return false;
  if (!isoDate(value.updatedAt)) return false;
  for (const mediaKind of ["IMAGE", "VIDEO", "AUDIO"] as const) {
    const draft = value.draftsByMedia[mediaKind];
    if (draft !== undefined && !validDraft(draft, mediaKind)) return false;
  }
  if (!value.generationSessions.every((session) => object(session) && onlyKeys(session, ["sessionId", "operationIds", "outputAssetIds", "createdAt"])
    && typeof session.sessionId === "string" && !!session.sessionId
    && strings(session.operationIds) && strings(session.outputAssetIds) && isoDate(session.createdAt))) return false;
  if (!value.referenceAliases.every((alias) => object(alias) && onlyKeys(alias, ["bindingId", "alias"]) && typeof alias.bindingId === "string" && !!alias.bindingId && typeof alias.alias === "string" && !!alias.alias)) return false;
  if (!value.trashEntries.every((entry) => object(entry) && onlyKeys(entry, ["assetId", "deletedAt", "purgeAfter"]) && typeof entry.assetId === "string" && !!entry.assetId && isoDate(entry.deletedAt) && isoDate(entry.purgeAfter))) return false;
  return true;
}

export function createEmptyStandardProjection(now = new Date()): StandardProjectionV1 {
  return {
    schemaVersion: 1,
    draftsByMedia: {},
    generationSessions: [],
    galleryOrder: [],
    referenceAliases: [],
    trashEntries: [],
    libraryPreferences: { sort: "NEWEST", compact: false },
    updatedAt: now.toISOString(),
  };
}
