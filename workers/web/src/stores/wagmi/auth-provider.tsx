'use client';

import { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';

import { config } from '../../config/wagmi-config';

const queryClient = new QueryClient();

export function AuthProvider({ children, initialState }: { children: ReactNode; initialState?: any }) {
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}