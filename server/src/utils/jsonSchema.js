// Convert zod-generated JSON Schema into each provider's structured-output dialect.

/** Gemini `responseSchema` (OpenAPI subset): uppercase types, string min/maxItems, propertyOrdering. */
export function toGeminiSchema(js) {
  const out = {};
  let type = js.type;
  if (Array.isArray(type)) {
    if (type.includes('null')) out.nullable = true;
    type = type.find((t) => t !== 'null');
  }
  if (type) out.type = String(type).toUpperCase();
  if (js.description) out.description = js.description;
  if (js.enum) out.enum = js.enum.map(String);
  if (js.minItems !== undefined) out.minItems = String(js.minItems);
  if (js.maxItems !== undefined) out.maxItems = String(js.maxItems);
  if (js.minimum !== undefined) out.minimum = js.minimum;
  if (js.maximum !== undefined) out.maximum = js.maximum;
  if (js.items) out.items = toGeminiSchema(js.items);
  if (js.properties) {
    out.properties = Object.fromEntries(Object.entries(js.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(js.properties);
    if (js.required) out.required = js.required;
  }
  return out;
}

/** OpenAI strict json_schema: every object closed and every property required. */
export function toOpenAIStrictSchema(js) {
  const { $schema, ...rest } = js; // eslint-disable-line no-unused-vars
  const walk = (node) => {
    if (!node || typeof node !== 'object') return node;
    const n = { ...node };
    if (n.properties) {
      n.properties = Object.fromEntries(Object.entries(n.properties).map(([k, v]) => [k, walk(v)]));
      n.required = Object.keys(n.properties);
      n.additionalProperties = false;
    }
    if (n.items) n.items = walk(n.items);
    return n;
  };
  return walk(rest);
}
