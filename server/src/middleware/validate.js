// Usage: validate({ body: zodSchema, params: zodSchema, query: zodSchema })
// Parsed values land on req.valid.{body,params,query}; req.body is also replaced.
// (Express 5 makes req.query read-only, so query/params are only exposed via req.valid.)
export const validate = (schemas) => (req, res, next) => {
  req.valid ??= {};
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) return next(result.error);
    req.valid[key] = result.data;
    if (key === 'body') req.body = result.data;
  }
  next();
};
