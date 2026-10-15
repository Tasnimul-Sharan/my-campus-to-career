import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    const origin = (process.env.API_ORIGIN || 'http://127.0.0.1:4000').replace(/\/$/, '');
    return [{ source: '/api/v1/:path*', destination: `${origin}/api/v1/:path*` }];
  },
  poweredByHeader: false,
};

export default nextConfig;
