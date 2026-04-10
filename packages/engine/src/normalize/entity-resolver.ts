import type { Entity } from "./schema.js";

/**
 * Merges entity references that share a sourceId, producing canonical entities.
 * For example, the same person appearing via Slack and Gmail gets unified.
 */
export class EntityResolver {
  private readonly entities: Map<string, Entity> = new Map();
  /** Maps "source:sourceId" → canonical entity id */
  private readonly sourceIndex: Map<string, string> = new Map();

  resolve(entity: Entity): Entity {
    const existingId = this.findBySourceIds(entity);

    if (existingId !== undefined) {
      return this.merge(existingId, entity);
    }

    this.entities.set(entity.id, entity);
    this.indexSourceIds(entity);
    return entity;
  }

  resolveAll(entities: readonly Entity[]): readonly Entity[] {
    return entities.map((e) => this.resolve(e));
  }

  getCanonical(entityId: string): Entity | undefined {
    return this.entities.get(entityId);
  }

  getAllEntities(): readonly Entity[] {
    return [...this.entities.values()];
  }

  private findBySourceIds(entity: Entity): string | undefined {
    for (const [source, sourceId] of Object.entries(entity.sourceIds)) {
      const key = `${source}:${sourceId}`;
      const existing = this.sourceIndex.get(key);
      if (existing !== undefined) {
        return existing;
      }
    }
    return undefined;
  }

  private merge(existingId: string, incoming: Entity): Entity {
    const existing = this.entities.get(existingId);
    if (existing === undefined) {
      throw new Error(`Entity not found: ${existingId}`);
    }

    const merged: Entity = {
      ...existing,
      name: incoming.name || existing.name,
      sourceIds: { ...existing.sourceIds, ...incoming.sourceIds },
    };

    this.entities.set(existingId, merged);
    this.indexSourceIds(merged);
    return merged;
  }

  private indexSourceIds(entity: Entity): void {
    for (const [source, sourceId] of Object.entries(entity.sourceIds)) {
      this.sourceIndex.set(`${source}:${sourceId}`, entity.id);
    }
  }
}
