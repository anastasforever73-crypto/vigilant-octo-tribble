import path from "path";
import type { NextConfig } from "next";
import { codespaceOrigin } from './app/lib/request-origin';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', ...(codespaceOrigin() ? [new URL(codespaceOrigin()!).hostname] : [])],
  async headers() {
    return ['/login', '/api/auth/:path*'].map(source => ({
      source,
      headers: [
        // Omit URL paths/queries while preserving Origin on native POST forms.
        { key: 'Referrer-Policy', value: 'strict-origin' },
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      ],
    }));
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
