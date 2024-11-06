// In server/schemas/v1.ts
import { schema, TypeOf } from '@kbn/config-schema';

const entitySource = schema.object({
  name: schema.string(),
  index_patterns: schema.arrayOf(schema.string()),
  identity_fields: schema.arrayOf(schema.string()),
  metadata_fields: schema.maybe(schema.arrayOf(schema.object({
    name: schema.string(),
    field: schema.string(),
  }))),
})

export const entityDefintion = schema.object({
  type: schema.string(),
  description: schema.string(),
  metadata: schema.maybe(schema.arrayOf(schema.string())),
  sources: schema.arrayOf(entitySource),
});

export type EntityDefinition = TypeOf<typeof entityDefintion>;