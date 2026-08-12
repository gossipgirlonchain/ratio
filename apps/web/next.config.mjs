/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@ratio/ui", "@ratio/config"],
  webpack: (config) => {
    // Privy's optional peer deps for features we will never use (Farcaster
    // mini-apps, Abstract, AA). Stub them so webpack stops resolving them;
    // X login + embedded wallets don't touch these paths.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@abstract-foundation/agw-client": false,
      permissionless: false,
    };
    return config;
  },
};
