const stub = () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => {}) });
export { stub as createMediaIdentityCache, stub as createMediaManager };
