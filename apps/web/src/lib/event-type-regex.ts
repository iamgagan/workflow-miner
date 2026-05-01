/**
 * Regex-based event type classifier.
 *
 * Maps a (source, summary) pair onto a workflow event type from a fixed
 * vocabulary. This is the cheap, dependency-free path used by the pattern
 * miner when LLM classification is disabled or unavailable.
 *
 * Resolution order:
 *   1. Gmail thread structure (Re:/Fwd:)
 *   2. Action verbs ("created", "deployed", "approved", …)
 *   3. Topic/setting nouns ("meeting", "bug", "feature", …)
 *   4. Source-aware fallback ("gmail" → email_received, "slack" → message_event)
 *   5. Last-resort `activity`
 *
 * Kept as a pure function with no I/O so it can be unit-tested and shared
 * between the API route and offline tooling (e.g. classify-harness).
 */

export function deriveEventType(
  source: string | null,
  summary: string | null,
): string {
  const raw = (summary ?? "").trim();
  const text = raw.toLowerCase();

  // Step 0: Gmail thread structure signals.
  if (source?.toLowerCase() === "gmail" || /\bemail\b/.test(text)) {
    if (/^fwd:/i.test(raw) || /\bforwarded\b/.test(text))
      return "email_forwarded";
    if (/^re:/i.test(raw) || /\breply\b/.test(text) || /\breplied\b/.test(text))
      return "email_replied";
  }

  if (text) {
    // Step 1A: action verbs.
    if (
      /\b(created from|created with|created\b|opened|filed)\b/.test(text) &&
      /\b(ticket|issue|task|story|alert)\b/.test(text)
    )
      return "issue_created";

    if (/\b(moved to|in progress|updated|reassigned)\b/.test(text))
      return "issue_updated";

    if (
      /\b(reply sent|reply received|acknowledgment|acknowledg(e|ed) email|forwarded|follow-?up email)\b/.test(
        text,
      )
    )
      return "email_replied";

    if (/\b(deploy(ed|ment)?|rollback|merged|released|shipped|release notes?)\b/.test(text))
      return "code_deployed";

    if (
      /\b(pr (review|merge)|pull request|review requested|approved|rejected|review feedback|code review|lgtm)\b/.test(
        text,
      )
    )
      return "code_reviewed";

    if (/\b(posted in|flagged in|mentioned in|thread (posted|started)|dm sent)\b/.test(text))
      return "message_posted";

    // Step 1B: topic/setting nouns.
    if (
      /\b(meeting (held|scheduled|started|invite|notes|recap|minutes|cancelled|rescheduled)|1:?1|sync(ed)? up|call held|retrospective|standup|stand-up|kickoff|kick-off|huddle|check-?in meeting|office hours|all[- ]?hands|town[- ]?hall)\b/.test(
        text,
      )
    )
      return "meeting_scheduled";

    if (/\b(invit(e|ation|ed)|rsvp|calendar invite|agenda|you'?re invited)\b/.test(text))
      return "meeting_scheduled";

    if (/\b(triag(e|ed)|severity|assigned to|assign(ed|ment))\b/.test(text))
      return "issue_triaged";

    if (/\b(escalat(ion|ed)|p0|p1|urgent|critical|blocker|blocked)\b/.test(text))
      return "escalation_raised";

    if (/\b(followup|follow-up|follow up|action item|next step|recap|summary|digest|notes shared|takeaways)\b/.test(text))
      return "followup_assigned";

    if (/\b(decision|decide(d)?|outcome|chose|sign-?off|go\/no-go|approved)\b/.test(text))
      return "decision_made";

    if (/\b(notification|automated|no-?reply|noreply|alert|monitoring|ci\/cd|build (failed|passed|succeeded)|pipeline)\b/.test(text))
      return "notification_received";

    if (/\b(request(ed|ing)?|please review|can you|could you|need your|feedback needed|input needed|awaiting)\b/.test(text))
      return "request_received";

    if (/\b(fyi|heads[- ]?up|sharing|shared|for your (info|review|reference)|attached|see attached|update on)\b/.test(text))
      return "info_shared";

    if (/\b(customer|client|vendor|partner|external|prospect|lead|onboarding|renewal|contract|invoice|quote|proposal sent)\b/.test(text))
      return "customer_interaction";

    if (/\b(schedule|availab(le|ility)|time slot|book(ed)?|when can|free at|calendar)\b/.test(text))
      return "scheduling_request";

    if (/\b(slack|channel|thread|dm)\b/.test(text)) return "message_posted";

    if (/\b(email received|email sent|inbox|email from|email to|received from|sent to)\b/.test(text))
      return "email_received";

    if (/\b(bug|incident|outage|alert|error|crash|exception|failure)\b/.test(text))
      return "bug_reported";

    if (/\b(spec|doc(ument)?|design|proposal|wiki|confluence|readme|changelog)\b/.test(text))
      return "doc_shared";

    if (/\b(feature|enhancement|improvement|roadmap|requirement|user story|epic)\b/.test(text))
      return "feature_discussed";

    if (/\b(approv(e|ed|al)|sign[- ]?off|authorize|authoriz(e|ed))\b/.test(text))
      return "approval_given";

    if (/\b(welcome|onboard(ing)?|getting started|new (hire|member|employee))\b/.test(text))
      return "onboarding_event";
  }

  // Step 2: source-aware fallback.
  if (source) {
    switch (source.toLowerCase()) {
      case "gmail":
        if (raw.length > 0 && raw.length < 50) return "email_sent";
        return "email_received";
      case "calendar":
        return "calendar_event";
      case "slack":
        return "message_event";
      case "linear":
        return "issue_event";
      default:
        return `${source.toLowerCase()}_event`;
    }
  }

  return "activity";
}

/**
 * Source-aware fallback types — events whose type was *only* resolvable
 * via Step 2 of `deriveEventType`. The harness uses this set to compute
 * "regex coverage" — i.e. how often the regex produced a specific verb
 * vs. a generic source-shaped bucket.
 */
export const GENERIC_FALLBACK_TYPES: ReadonlySet<string> = new Set([
  "email_event",
  "calendar_event",
  "message_event",
  "issue_event",
  "activity",
]);
