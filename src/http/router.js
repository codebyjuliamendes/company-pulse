'use strict';

/**
 * Minimal method + path router. Patterns use ":name" segments; matched values are
 * restricted to safe identifier characters, so handlers never see slashes or dots.
 */
function createRouter() {
  const routes = [];

  function add(method, pattern, options, handler) {
    const keys = [];
    const source = pattern.replace(/:([a-zA-Z]+)/g, (_m, key) => {
      keys.push(key);
      return '([A-Za-z0-9_-]{1,80})';
    });
    routes.push({ method, regex: new RegExp(`^${source}$`), keys, options, handler });
  }

  /** { route, params } | { allowed: [...] } when only the method differs | null. */
  function match(method, pathname) {
    const allowed = new Set();
    for (const route of routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
        allowed.add(route.method);
        continue;
      }
      return { route, params: Object.fromEntries(route.keys.map((key, i) => [key, found[i + 1]])) };
    }
    return allowed.size ? { allowed: [...allowed] } : null;
  }

  return { add, match, routes };
}

module.exports = { createRouter };
