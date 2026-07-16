import { siteConfig } from '@/config/site';

function normalizePath(path: string): string {
  if (path.length === 0 || path === '/') {
    return '/';
  }

  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  return withLeadingSlash.replace(/\/{2,}/g, '/');
}

export function siteHref(path: string): string {
  const normalizedBase = normalizePath(siteConfig.basePath);
  const normalizedPath = normalizePath(path);

  if (normalizedBase === '/') {
    return normalizedPath;
  }

  if (normalizedPath === '/') {
    return normalizedBase;
  }

  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, '/');
}
