/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@ratio/ui", "@ratio/config", "@ratio/doppler"],
  async rewrites() {
    // static creator application in /public; bare path needs the explicit
    // index rewrite because the public dir does no directory resolution
    return [{ source: "/creator-apply", destination: "/creator-apply/index.html" }];
  },
  webpack: (config) => {
    // Privy's optional peer deps for features we will never use (Farcaster
    // mini-apps, Abstract, AA). Stub them so webpack stops resolving them;
    // X login + embedded wallets don't touch these paths.
    // Workspace packages use ESM ".js" specifiers against .ts sources
    // (tsx resolves them; webpack needs the alias spelled out).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@abstract-foundation/agw-client": false,
      permissionless: false,
    };
    return config;
  },
};
