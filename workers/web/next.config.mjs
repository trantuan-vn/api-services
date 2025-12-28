// next.config.mjs (hoặc next.config.js với "type": "module" trong package.json)
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // compiler: {
  //   removeConsole: process.env.NODE_ENV === "production",
  // },
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/dashboard/default',
        permanent: false,
      },
    ];
  },
  // Webpack configuration với cú pháp hiện đại
  webpack: (config, { isServer }) => {
    // Thêm các externals cần thiết
    config.externals.push(
      'pino-pretty',
      'lokijs', 
      'encoding'
    );

    // Tối ưu hóa cho server/client bundle
    if (!isServer) {
      // Client-side optimizations
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    return config;
  },

  // Experimental features for Next.js 15
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      '@heroicons/react/24/outline',
    ],
    optimizeFonts: true,
  },

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  optimizeFonts: true,  
}

export default withNextIntl(nextConfig);
