import { describe, it, expect, beforeEach } from "vitest";
import { EntityResolver } from "./entity-resolver.js";
import { EntityType, type Entity } from "./schema.js";

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "e1",
    type: EntityType.Person,
    name: "Alice",
    sourceIds: { slack: "U001" },
    ...overrides,
  };
}

describe("EntityResolver", () => {
  let resolver: EntityResolver;

  beforeEach(() => {
    resolver = new EntityResolver();
  });

  describe("resolve", () => {
    it("returns the entity unchanged when no match exists", () => {
      const entity = makeEntity();
      const result = resolver.resolve(entity);
      expect(result).toEqual(entity);
    });

    it("indexes and retrieves a resolved entity", () => {
      const entity = makeEntity();
      resolver.resolve(entity);
      expect(resolver.getCanonical("e1")).toEqual(entity);
    });

    it("merges entities with overlapping sourceIds", () => {
      const slackEntity = makeEntity({
        id: "e1",
        name: "Alice",
        sourceIds: { slack: "U001" },
      });
      const gmailEntity = makeEntity({
        id: "e2",
        name: "Alice Smith",
        sourceIds: { slack: "U001", gmail: "alice@co.com" },
      });

      resolver.resolve(slackEntity);
      const merged = resolver.resolve(gmailEntity);

      expect(merged.id).toBe("e1");
      expect(merged.name).toBe("Alice Smith");
      expect(merged.sourceIds).toEqual({
        slack: "U001",
        gmail: "alice@co.com",
      });
    });

    it("merges entities matched by different source key", () => {
      const slackEntity = makeEntity({
        id: "e1",
        name: "Bob",
        sourceIds: { slack: "U002" },
      });
      const gmailEntity = makeEntity({
        id: "e2",
        name: "Bob Jones",
        sourceIds: { gmail: "bob@co.com" },
      });

      resolver.resolve(slackEntity);
      // These have no overlapping sourceId, so they stay separate
      const result = resolver.resolve(gmailEntity);
      expect(result.id).toBe("e2");
      expect(resolver.getAllEntities()).toHaveLength(2);
    });

    it("uses incoming name when available during merge", () => {
      resolver.resolve(makeEntity({ id: "e1", name: "A", sourceIds: { slack: "U1" } }));
      const merged = resolver.resolve(
        makeEntity({ id: "e2", name: "Alice Full", sourceIds: { slack: "U1" } }),
      );
      expect(merged.name).toBe("Alice Full");
    });

    it("keeps existing name when incoming name is empty", () => {
      resolver.resolve(makeEntity({ id: "e1", name: "Alice", sourceIds: { slack: "U1" } }));
      const merged = resolver.resolve(
        makeEntity({ id: "e2", name: "", sourceIds: { slack: "U1" } }),
      );
      expect(merged.name).toBe("Alice");
    });
  });

  describe("resolveAll", () => {
    it("returns empty array for empty input", () => {
      expect(resolver.resolveAll([])).toEqual([]);
    });

    it("resolves multiple entities", () => {
      const entities = [
        makeEntity({ id: "e1", sourceIds: { slack: "U1" } }),
        makeEntity({ id: "e2", name: "Bob", sourceIds: { slack: "U2" } }),
      ];
      const result = resolver.resolveAll(entities);
      expect(result).toHaveLength(2);
    });

    it("merges duplicates within the same batch", () => {
      const entities = [
        makeEntity({ id: "e1", name: "Alice", sourceIds: { slack: "U1" } }),
        makeEntity({ id: "e2", name: "Alice S", sourceIds: { slack: "U1", gmail: "alice@co.com" } }),
      ];
      const result = resolver.resolveAll(entities);
      expect(result).toHaveLength(2);
      // Both should point to the same canonical entity
      expect(result[0].id).toBe("e1");
      expect(result[1].id).toBe("e1");
      expect(result[1].sourceIds).toEqual({ slack: "U1", gmail: "alice@co.com" });
    });
  });

  describe("getCanonical", () => {
    it("returns undefined for unknown ID", () => {
      expect(resolver.getCanonical("nonexistent")).toBeUndefined();
    });

    it("returns the merged state after resolution", () => {
      resolver.resolve(makeEntity({ id: "e1", sourceIds: { slack: "U1" } }));
      resolver.resolve(makeEntity({ id: "e2", sourceIds: { slack: "U1", gmail: "a@b.com" } }));

      const canonical = resolver.getCanonical("e1");
      expect(canonical?.sourceIds).toEqual({ slack: "U1", gmail: "a@b.com" });
    });
  });

  describe("getAllEntities", () => {
    it("returns empty when no entities resolved", () => {
      expect(resolver.getAllEntities()).toEqual([]);
    });

    it("returns all unique canonical entities", () => {
      resolver.resolve(makeEntity({ id: "e1", sourceIds: { slack: "U1" } }));
      resolver.resolve(makeEntity({ id: "e2", name: "Bob", sourceIds: { slack: "U2" } }));
      // This merges with e1
      resolver.resolve(makeEntity({ id: "e3", sourceIds: { slack: "U1", gmail: "a@b.com" } }));

      const all = resolver.getAllEntities();
      expect(all).toHaveLength(2);
    });
  });

  describe("cross-source resolution", () => {
    it("unifies person appearing in Slack and Gmail", () => {
      const slackAlice = makeEntity({
        id: "s1",
        name: "alice",
        type: EntityType.Person,
        sourceIds: { slack: "U_ALICE" },
      });
      const gmailAlice = makeEntity({
        id: "g1",
        name: "Alice Johnson",
        type: EntityType.Person,
        sourceIds: { slack: "U_ALICE", gmail: "alice@company.com" },
      });

      resolver.resolve(slackAlice);
      const unified = resolver.resolve(gmailAlice);

      expect(unified.id).toBe("s1");
      expect(unified.name).toBe("Alice Johnson");
      expect(unified.sourceIds).toEqual({
        slack: "U_ALICE",
        gmail: "alice@company.com",
      });
      expect(resolver.getAllEntities()).toHaveLength(1);
    });

    it("keeps distinct entities separate when no shared source ID", () => {
      resolver.resolve(makeEntity({ id: "e1", sourceIds: { slack: "U1" } }));
      resolver.resolve(makeEntity({ id: "e2", sourceIds: { gmail: "x@y.com" } }));
      resolver.resolve(makeEntity({ id: "e3", sourceIds: { linear: "lin-1" } }));

      expect(resolver.getAllEntities()).toHaveLength(3);
    });

    it("chains merges when new sourceId connects two groups", () => {
      // First entity from slack
      resolver.resolve(makeEntity({ id: "e1", sourceIds: { slack: "U1" } }));
      // Second entity adds gmail, matched via slack
      resolver.resolve(makeEntity({ id: "e2", sourceIds: { slack: "U1", gmail: "a@b.com" } }));
      // Third entity matched via gmail now resolves to the same canonical
      resolver.resolve(makeEntity({ id: "e3", sourceIds: { gmail: "a@b.com", linear: "L1" } }));

      const canonical = resolver.getCanonical("e1");
      expect(canonical?.sourceIds).toEqual({
        slack: "U1",
        gmail: "a@b.com",
        linear: "L1",
      });
      expect(resolver.getAllEntities()).toHaveLength(1);
    });
  });
});
