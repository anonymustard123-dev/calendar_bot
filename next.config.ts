import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    // Keep workspace discovery inside this deployable app when run from OneDrive.
    root: process.cwd(),
  },
};

export default nextConfig;
