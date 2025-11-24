FROM docker.io/cloudflare/sandbox:0.5.1



# Helpful for local wrangler dev with exposed ports
EXPOSE 3000

CMD ["node", "dist/agent-sdk.js"]
