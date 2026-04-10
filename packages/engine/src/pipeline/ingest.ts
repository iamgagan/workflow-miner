import type { Config } from "../config/schema.js";
import type { ConnectorInterface, ConnectorConfig, RawEvent } from "../connectors/types.js";
import { GmailConnector } from "../connectors/gmail.js";
import { SlackConnector } from "../connectors/slack.js";
import { LinearConnector } from "../connectors/linear.js";
import { CalendarConnector } from "../connectors/calendar.js";
import { Normalizer, type NormalizeError } from "../normalize/normalizer.js";
import type { NormalizedEvent } from "../normalize/schema.js";
import type { InsertEvent } from "../db/repositories/event-repository.js";

export interface IngestOptions {
  readonly source: string;
  readonly days: number;
  readonly dryRun: boolean;
}

export interface IngestResult {
  readonly totalEvents: number;
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly errors: readonly NormalizeError[];
  readonly skippedSources: readonly string[];
}

export interface IngestDependencies {
  readonly config: Config;
  readonly insertMany: (events: InsertEvent[]) => void;
  readonly connectors?: Readonly<Record<string, ConnectorInterface>>;
  readonly normalizer?: Normalizer;
  readonly log?: (message: string) => void;
}

type SourceName = "gmail" | "slack" | "linear" | "calendar";

const ALL_SOURCES: readonly SourceName[] = ["gmail", "slack", "linear", "calendar"];

function buildCredentials(config: Config, source: SourceName): Record<string, string> | null {
  switch (source) {
    case "gmail": {
      const g = config.gmail;
      if (!g) return null;
      return {
        GMAIL_CLIENT_ID: g.clientId,
        GMAIL_CLIENT_SECRET: g.clientSecret,
        GMAIL_REFRESH_TOKEN: g.refreshToken,
      };
    }
    case "slack": {
      const s = config.slack;
      if (!s) return null;
      return {
        SLACK_BOT_TOKEN: s.botToken,
      };
    }
    case "linear": {
      const l = config.linear;
      if (!l) return null;
      return {
        LINEAR_API_KEY: l.apiKey,
      };
    }
    case "calendar": {
      const c = config.calendar;
      if (!c) return null;
      return {
        CALENDAR_CLIENT_ID: c.clientId,
        CALENDAR_CLIENT_SECRET: c.clientSecret,
        CALENDAR_REFRESH_TOKEN: c.refreshToken,
      };
    }
  }
}

function defaultConnectors(): Record<string, ConnectorInterface> {
  return {
    gmail: new GmailConnector(),
    slack: new SlackConnector(),
    linear: new LinearConnector(),
    calendar: new CalendarConnector(),
  };
}

function toInsertEvent(event: NormalizedEvent): InsertEvent {
  const actor = event.entities.find((e) => e.type === "person");
  return {
    event_id: event.id,
    source_system: event.source,
    source_object_type: event.type,
    source_object_id: event.rawEventId,
    actor_id: actor?.id ?? "unknown",
    timestamp: event.timestamp.toISOString(),
    entity_refs: JSON.stringify(event.entities.map((e) => ({ id: e.id, type: e.type, name: e.name }))),
    event_type: event.type,
    metadata: JSON.stringify(event.metadata),
  };
}

export async function runIngest(
  options: IngestOptions,
  deps: IngestDependencies,
): Promise<IngestResult> {
  const { config, insertMany, log = console.log } = deps;
  const normalizer = deps.normalizer ?? new Normalizer();
  const connectors = deps.connectors ?? defaultConnectors();

  const sourcesToIngest: readonly SourceName[] =
    options.source === "all"
      ? ALL_SOURCES
      : [options.source as SourceName];

  const sourceCounts: Record<string, number> = {};
  const allErrors: NormalizeError[] = [];
  const skippedSources: string[] = [];
  let totalEvents = 0;

  for (const source of sourcesToIngest) {
    const credentials = buildCredentials(config, source);
    if (!credentials) {
      log(`Skipping ${source}: not configured`);
      skippedSources.push(source);
      continue;
    }

    const connector = connectors[source];
    if (!connector) {
      log(`Skipping ${source}: no connector available`);
      skippedSources.push(source);
      continue;
    }

    const connectorConfig: ConnectorConfig = {
      credentials,
      lookbackDays: options.days,
    };

    let rawEvents: readonly RawEvent[];
    try {
      rawEvents = await connector.fetchEvents(connectorConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Error fetching from ${source}: ${message}`);
      allErrors.push({ rawEventId: `${source}-fetch`, message });
      continue;
    }

    const { events: normalized, errors } = normalizer.normalize(rawEvents);

    if (errors.length > 0) {
      for (const error of errors) {
        log(`Normalization error (${source}): ${error.rawEventId} — ${error.message}`);
      }
      allErrors.push(...errors);
    }

    const insertEvents = normalized.map(toInsertEvent);

    if (options.dryRun) {
      log(`[dry-run] ${source}: ${insertEvents.length} events would be ingested`);
    } else {
      insertMany(insertEvents);
      log(`${source}: ${insertEvents.length} events ingested`);
    }

    sourceCounts[source] = insertEvents.length;
    totalEvents += insertEvents.length;
  }

  return { totalEvents, sourceCounts, errors: allErrors, skippedSources };
}
