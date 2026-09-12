import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingIncludes: {'/api/inventory/po': ['./public/po-logo.png']},
  async headers(){return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'Content-Security-Policy',value:"frame-ancestors 'self'; base-uri 'self'; object-src 'none'"}]}];},
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
