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
    ];
  },
};

export default nextConfig;
