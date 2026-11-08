import type { NextConfig } from 'next';
import { resolveApiOrigin } from './config/api-origin.mjs';

const apiOrigin = resolveApiOrigin();

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
  poweredByHeader: false,
};

export default nextConfig;
