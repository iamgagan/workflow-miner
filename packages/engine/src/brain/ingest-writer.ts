import type { BrainClient } from './client.js';
import type { BrainPage } from './types.js';
import type { NormalizedEvent, Entity, EntityType } from '../normalize/schema.js';
import { EntityType as EntityTypeEnum } from '../normalize/schema.js';

export interface WriteResult {
  readonly pagesCreated: number;
  readonly timelineEntries: number;
  readonly linksCreated: number;
}

/**
 * Writes normalized events into gbrain (Supabase Postgres) via BrainClient.
 *
 * For each event it:
 * 1. Upserts a tool page for the event source (e.g. "tools/gmail")
 * 2. Adds a timeline entry on that tool page
 * 3. Creates person pages for any person entities and links them to the tool
 */
export class IngestWriter {
  constructor(private readonly brain: BrainClient) {}

  async writeEvents(events: readonly NormalizedEvent[]): Promise<WriteResult> {
    let pagesCreated = 0;
    let timelineEntries = 0;
    let linksCreated = 0;

    // Cache tool pages by slug to avoid redundant upserts within a batch
    const toolPageCache = new Map<string, BrainPage>();

    for (const event of events) {
      const sourceSlug = this.sourceToSlug(event.source);

      // 1. Upsert tool page for the event source
      let toolPage = toolPageCache.get(sourceSlug);
      if (!toolPage) {
        toolPage = await this.brain.putPage({
          slug: sourceSlug,
          type: 'tool',
          title: this.sourceToTitle(event.source),
        });
        toolPageCache.set(sourceSlug, toolPage);
        pagesCreated += 1;
      }

      // 2. Add timeline entry
      await this.brain.addTimelineEntry({
        page_id: toolPage.id,
        date: event.timestamp.toISOString().slice(0, 10),
        source: event.source,
        summary: this.buildSummary(event),
        detail: JSON.stringify(event.metadata),
      });
      timelineEntries += 1;

      // 3. Extract person entities, create pages and links
      const { people, projects } = this.extractEntities(event);

      for (const personName of people) {
        const personSlug = this.nameToSlug('people', personName);
        await this.brain.putPage({
          slug: personSlug,
          type: 'person',
          title: personName,
        });
        pagesCreated += 1;

        await this.brain.addLink({
          from_slug: personSlug,
          to_slug: sourceSlug,
          link_type: 'appeared_in',
          context: `Event ${event.type} on ${event.timestamp.toISOString().slice(0, 10)}`,
        });
        linksCreated += 1;
      }

      for (const projectName of projects) {
        const projectSlug = this.nameToSlug('projects', projectName);
        await this.brain.putPage({
          slug: projectSlug,
          type: 'project',
          title: projectName,
        });
        pagesCreated += 1;

        await this.brain.addLink({
          from_slug: projectSlug,
          to_slug: sourceSlug,
          link_type: 'referenced_in',
          context: `Event ${event.type} on ${event.timestamp.toISOString().slice(0, 10)}`,
        });
        linksCreated += 1;
      }
    }

    return { pagesCreated, timelineEntries, linksCreated };
  }

  /** Convert a source system name to a gbrain slug. */
  private sourceToSlug(source: string): string {
    return `tools/${source.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /** Convert a source system name to a human-readable title. */
  private sourceToTitle(source: string): string {
    return source
      .split(/[\s_-]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  /** Convert an entity name to a gbrain slug under a given prefix. */
  private nameToSlug(prefix: string, name: string): string {
    return `${prefix}/${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-/]/g, '')}`;
  }

  /** Build a short summary string from the event type and metadata. */
  private buildSummary(event: NormalizedEvent): string {
    const label = event.type.replace(/_/g, ' ');
    const entityNames = event.entities.map((e) => e.name).join(', ');
    return entityNames ? `${label}: ${entityNames}` : label;
  }

  /** Extract people and project entities from a normalized event. */
  private extractEntities(event: NormalizedEvent): {
    readonly people: readonly string[];
    readonly projects: readonly string[];
  } {
    const people: string[] = [];
    const projects: string[] = [];

    for (const entity of event.entities) {
      if (entity.type === EntityTypeEnum.Person) {
        people.push(entity.name);
      }
      // Map issues and artifacts to project-like concepts
      if (
        entity.type === EntityTypeEnum.Issue ||
        entity.type === EntityTypeEnum.Artifact
      ) {
        projects.push(entity.name);
      }
    }

    return { people, projects };
  }
}
