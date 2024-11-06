// In server/schemas/v1.ts
import { schema, TypeOf } from '@kbn/config-schema';

export const entityDefintion = schema.object({
    type: schema.string(),
    description: schema.string(),
    sources: schema.arrayOf(schema.object({
        name: schema.string(),
        index_patterns: schema.arrayOf(schema.string()),
        identity_fields: schema.arrayOf(schema.string()),
    })),
});

export type EntityDefinition = TypeOf<typeof entityDefintion>;

export const entityInstance = schema.object({
    id: schema.string(),
    identityFields: schema.arrayOf(schema.string()),
    // metadata: schema.recordOf<string, schema.object({})>(),
    // sources: schema.arrayOf(schema.string()),
});

export type EntityInstance = TypeOf<typeof entityInstance>;

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literalSchema>;
type Json = Literal | { [key: string]: Json } | Json[];
const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)])
);
