import { walletConnect } from "@wagmi/connectors";
import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

export const config = createConfig({
  chains: [mainnet, sepolia],
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  connectors: [
    walletConnect({
      projectId: "c17c648e814a42c99a410355f29b0ad5",
      metadata: {
        name: 'Unitoken',
        description: 'Unitoken',
        url: 'http://beta.unitoken.trade',
        icons: ['http://beta.unitoken.trade/icon.png'],
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
