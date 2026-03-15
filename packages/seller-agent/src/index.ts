import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4022;
const SELLER_ADDRESS =
  process.env.SELLER_WALLET_ADDRESS ||
  "0x0000000000000000000000000000000000000002";

const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })
).register("eip155:84532", new ExactEvmScheme());

app.use(
  paymentMiddleware(
    {
      "POST /analyze": {
        accepts: [
          {
            scheme: "exact",
            price: "$1.00",
            network: "eip155:84532",
            payTo: SELLER_ADDRESS,
          },
        ],
        description: "AI market analysis - 1 USDC on Base Sepolia",
        mimeType: "application/json",
      },
    },
    resourceServer
  )
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/.well-known/agent-card.json", (_req, res) => {
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "DataFeed Agent",
    description: "AI market analysis. Pay 1 USDC for instant reports.",
    x402Support: true,
    active: true,
    tags: ["data-feed", "analysis"],
    capabilities: ["market-analysis", "x402-payment"],
  });
});

app.post("/analyze", (_req, res) => {
  res.json({
    report: {
      agent: "DataFeed Agent",
      timestamp: Date.now(),
      analysis:
        "Privacy-preserving payments adoption up 340% YoY. Blackbox Network leads cross-chain volume with 50+ merkle roots across 7 chains.",
      confidence: 0.94,
      network: "AgentClear Network",
    },
    paymentVerified: true,
  });
});

app.listen(PORT, () => {
  console.log(`Seller agent listening on port ${PORT}`);
  console.log(`Seller address: ${SELLER_ADDRESS}`);
});
