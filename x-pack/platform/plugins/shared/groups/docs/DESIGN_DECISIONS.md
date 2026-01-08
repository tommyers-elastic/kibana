# Groups Plugin - Design Decisions

> **Key architectural and implementation decisions made during development**

This document captures important design decisions, trade-offs considered, and rationale for the chosen approach.

---

## Asset Existence Validation

**Decision:** Group membership does NOT validate that referenced assets exist.

**Date:** January 8, 2026  
**Phase:** Phase 4 (Membership APIs)

### Context

When adding an asset to a group (e.g., a dashboard ID), should we validate that the asset actually exists before creating the membership record?

### Options Considered

1. **No Validation** (✅ Chosen)
2. **Strict Validation** - Fail if asset doesn't exist
3. **Soft Validation** - Warn but allow
4. **Optional Validation** - Config flag to enable/disable

### Decision: No Validation

Groups store asset references without validating existence.

### Rationale

**Advantages:**
- **Performance** - No additional lookups required, especially for bulk operations
- **Simplicity** - No complex validation logic per asset type
- **Loose coupling** - Groups plugin doesn't depend on all other plugins
- **Flexibility** - Supports forward references (prepare group structure before assets exist)
- **Permission handling** - Avoids false negatives when user lacks read permission on existing asset
- **Cross-system compatibility** - Works with ES native resources, streams, and Kibana saved objects
- **Aligns with design** - Groups are organizational (like tags), not referential integrity system

**Trade-offs:**
- Possible orphaned references if assets are deleted
- No immediate feedback on typos in asset IDs
- Consumer applications must handle missing assets gracefully

### Implementation Notes

- Storage layer accepts any valid `assetType` and `assetId` strings
- No lookups to Saved Objects, Streams, or ES APIs
- Duplicate detection only (can't add same asset twice to same group)

### Future Enhancements

If validation becomes necessary, consider:
1. **UI-level validation** - Validate in public app before API call (better UX, no API complexity)
2. **Async cleanup job** - Background task to remove orphaned references
3. **Soft validation endpoint** - Separate API to check reference health without blocking operations
4. **Optional strict mode** - Feature flag to enable validation for specific use cases

### Documentation for Consumers

> **Note:** Groups store asset references without validating existence. Applications consuming group membership data should handle missing or inaccessible assets gracefully (e.g., skip them, show warning icon, etc.).

---

## Related Design Documents

- [DESIGN_RATIONALE.md](./DESIGN_RATIONALE.md) - Why Groups is separate from Streams
- [IMPLEMENTATION_CHECKLIST.md](./IMPLEMENTATION_CHECKLIST.md) - Implementation progress tracker
