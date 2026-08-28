import { siteConfig } from '@/config/site';

export const SiteLinks = {
  route(slug: string): string {
    if (slug === 'index') {
      return '/';
    }

    if (
      slug.length === 0 ||
      slug.startsWith('/') ||
      slug.endsWith('/') ||
      slug.endsWith('.md') ||
      slug.includes('//') ||
      slug.includes('\\') ||
      slug.includes('?') ||
      slug.includes('#') ||
      slug.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid documentation slug: ${slug}`);
    }

    return `/${slug}`;
  },

  site(path: string): string {
    const suffixIndex = path.search(/[?#]/);
    const pathname = suffixIndex === -1 ? path : path.slice(0, suffixIndex);
    if (
      pathname.length === 0 ||
      !pathname.startsWith('/') ||
      pathname.startsWith('//') ||
      pathname.includes('\\') ||
      pathname.includes('//') ||
      (pathname.length > 1 && pathname.endsWith('/')) ||
      pathname.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid canonical site path: ${path}`);
    }

    if (path === '/') {
      return siteConfig.basePath;
    }

    return siteConfig.basePath === '/' ? path : `${siteConfig.basePath}${path}`;
  },

  repository(path: string): string {
    if (
      path.length === 0 ||
      path.startsWith('/') ||
      path.endsWith('/') ||
      path.includes('\\') ||
      path.includes('//') ||
      path.includes('?') ||
      path.includes('#') ||
      path.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid canonical repository path: ${path}`);
    }

    return `${siteConfig.repoUrl}/blob/main/${path}`;
  }
};
