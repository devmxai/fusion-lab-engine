import { canonicalJson, evidenceHash } from "./canonical.ts";
import type {
  FeedbackReasonCode,
  SmartFeedbackCommand,
  SmartFeedbackEvent,
  SmartOutcomeIdentity,
} from "./types.ts";
import { SmartBetaError } from "./types.ts";

const REASONS = new Set<FeedbackReasonCode>([
  "OUTPUT_QUALITY",
  "PROMPT_ALIGNMENT",
  "SPEED",
  "VALUE",
  "CONSISTENCY",
]);

function validOutcome(outcome: SmartOutcomeIdentity): boolean {
  return Object.values(outcome).every((value) => value.trim().length > 0);
}

export class InMemorySmartFeedbackStore {
  private readonly byEventId = new Map<string, SmartFeedbackEvent>();
  private readonly latestByFeedbackKey = new Map<string, SmartFeedbackEvent>();

  append(command: SmartFeedbackCommand): SmartFeedbackEvent {
    const feedbackKeyHash = evidenceHash(`${command.actorUserId}:${command.outcome.operationId}`);
    const uniqueReasons = new Set(command.reasonCodes);
    if (!command.eventId
      || !command.actorUserId
      || command.actorUserId !== command.operationOwnerUserId
      || !validOutcome(command.outcome)
      || !Number.isInteger(command.rating)
      || command.rating < 1
      || command.rating > 5
      || command.reasonCodes.length === 0
      || uniqueReasons.size !== command.reasonCodes.length
      || command.reasonCodes.some((reason) => !REASONS.has(reason))
      || !Number.isInteger(command.revision)
      || command.revision <= 0
      || Number.isNaN(Date.parse(command.occurredAt))) {
      throw new SmartBetaError("INVALID_FEEDBACK", "Feedback must be structured immutable evidence from the operation owner.");
    }
    const eventIntent = {
      eventId: command.eventId,
      feedbackKeyHash,
      outcome: command.outcome,
      rating: command.rating,
      reasonCodes: command.reasonCodes,
      revision: command.revision,
      supersedesEventId: command.supersedesEventId,
      occurredAt: command.occurredAt,
    };
    const priorById = this.byEventId.get(command.eventId);
    if (priorById) {
      const { eventHash: _eventHash, ...priorIntent } = priorById;
      if (canonicalJson(priorIntent) === canonicalJson(eventIntent)) return structuredClone(priorById);
      throw new SmartBetaError("FEEDBACK_CONFLICT", "Feedback Event ID was reused with different evidence.");
    }
    const latest = this.latestByFeedbackKey.get(feedbackKeyHash);
    if ((!latest && (command.revision !== 1 || command.supersedesEventId !== null))
      || (latest && (command.revision !== latest.revision + 1 || command.supersedesEventId !== latest.eventId))) {
      throw new SmartBetaError("INVALID_FEEDBACK", "Feedback revisions must append exactly after the prior event.");
    }
    const event: SmartFeedbackEvent = Object.freeze({
      ...structuredClone(eventIntent),
      reasonCodes: Object.freeze([...command.reasonCodes]),
      eventHash: evidenceHash(eventIntent),
    });
    this.byEventId.set(event.eventId, event);
    this.latestByFeedbackKey.set(feedbackKeyHash, event);
    return structuredClone(event);
  }

  latest(): readonly SmartFeedbackEvent[] {
    return [...this.latestByFeedbackKey.values()].map((event) => structuredClone(event));
  }
}
