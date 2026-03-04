const nextConfig = {
  turbopack: {
    root: process.cwd()
  },
  async redirects() {
    return [
      {
        source: '/soul',
        destination: '/section/soul',
        permanent: true,
      },
      {
        source: '/soul/soul-baseline-v1',
        destination: '/soul/openclaw-template',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
