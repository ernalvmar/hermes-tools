/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — mark as external for server components
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
  // Output as standalone for Docker
  output: 'standalone',
};

module.exports = nextConfig;
